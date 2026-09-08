"""The job consumer: turns a queued `learner_game_jobs` row into a game version.

Two transports, one handler:

* ``GAME_JOBS_MODE=mongo`` (default, local dev) — poll the jobs collection for
  ``status == "queued"`` rows and claim them atomically. The backend wrote the
  job; nothing else is needed. Set ``GAME_WORKER_ONCE=1`` to drain and exit.
* ``GAME_JOBS_MODE=servicebus`` (Azure, task #548) — receive pointer messages
  ``{job_id, game_id, learner_id, kind}`` from the ``game-jobs`` queue
  (sessions keyed by game id), renew the lock while the build runs, complete
  on success, abandon on transient failure, dead-letter after ``max_delivery``.

The handler itself never trusts the message beyond the job id: the job row in
Mongo is the source of truth (payload, context with correct answers, kind).

Runs with ``PYTHONPATH=workers:backend`` — it imports the backend's games
services directly (store, html_store, notify, ai_usage) instead of talking to
the API, exactly like the Manim worker does.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import socket
import time
from typing import Any, Optional

from . import config  # noqa: F401  (loads backend/.env for local runs)
from .context_pack import build_context_pack
from .pipeline import JobResult, JobSpec, run_job
from .usage import usage_context

log = logging.getLogger("game_gen.worker")

REPLICA = os.environ.get("CONTAINER_APP_REPLICA_NAME") or socket.gethostname()
POLL_SECONDS = float(os.environ.get("GAME_WORKER_POLL_SECONDS", "3"))
MAX_ATTEMPTS = int(os.environ.get("GAME_JOBS_MAX_DELIVERY", "3"))
SPARKS_PER_USD = float(os.environ.get("GAME_SPARKS_PER_USD", "100"))  # kid-facing "sparks" = cents
CODE_FRAME_INTERVAL_S = 1.0   # live-code frames to the player, at most this often…
CODE_FRAME_MAX = 6000         # …unless this much piled up first
THINK_FRAME_INTERVAL_S = 2.0  # "still thinking" frames while the model reasons
LIVE_SNAPSHOT_INTERVAL_S = 3.0  # the job row keeps a snapshot so a page opened mid-build catches up
LIVE_CODE_TAIL = 24_000


def _backend():
    """Late import so the module loads standalone (tests patch this)."""
    from app.services.games import html_store, notify, store  # type: ignore
    return store, html_store, notify


def _game_status_for(event: dict[str, Any]) -> Optional[str]:
    kind = event.get("type")
    if kind == "build" and event.get("status") == "start":
        return "building"
    if kind == "validate":
        return "validating"
    if kind == "judge" and event.get("status") == "start":
        return "validating"
    return None


def spec_from_job(job: dict[str, Any]) -> JobSpec:
    payload = job.get("payload") or {}
    ctx = payload.get("context") or {}
    pack, key = build_context_pack(
        ctx.get("component") or {},
        ctx.get("unit") or {},
        ctx.get("objective") or {},
        language=str(payload.get("language") or "he"),
        device=str(payload.get("device") or "keyboard"),
    )
    return JobSpec(
        job_id=str(job["_id"]),
        game_id=str(job["game_id"]),
        learner_id=str(job["learner_id"]),
        kind=str(job.get("kind") or "create"),
        pack=pack,
        answer_key=key,
        genre=str(payload.get("genre") or "surprise"),
        vibe=str(payload.get("vibe") or ""),
        clarifications=dict(payload.get("clarifications") or {}),
        inspirations=[str(x) for x in (payload.get("inspirations") or [])][:6],
        instruction=str(payload.get("instruction") or ""),
        current_html=str(payload.get("current_html") or ""),
        runtime_errors=list(payload.get("runtime_errors") or []),
        history=list(payload.get("history") or []),
        model=str(payload.get("model") or os.environ.get("COPILOT_MODEL") or "claude-opus-5"),
        reasoning_effort=str(payload.get("reasoning_effort") or "high"),
        max_ai_credits=float(os.environ["GAME_MAX_AI_CREDITS"]) if os.environ.get("GAME_MAX_AI_CREDITS") else None,
        usage_context=usage_context(
            actor_id=str(job["learner_id"]), game_id=str(job["game_id"]), job_id=str(job["_id"]), operation="game.build",
        ),
    )


async def _load_current_html(job: dict[str, Any]) -> str:
    """Edit/fix jobs start from the stored current version."""
    store, html_store, _ = _backend()
    game = await store.get_game(str(job["game_id"]))
    if not game:
        return ""
    entry = store.version_entry(game, job.get("version"))
    if not entry:
        return ""
    return (await html_store.get_html(entry["blob_path"])) or ""


async def handle_job(job: dict[str, Any]) -> JobResult:
    """Run one job to completion and persist everything it produced."""
    store, html_store, notify = _backend()
    job_id, game_id, learner_id = str(job["_id"]), str(job["game_id"]), str(job["learner_id"])
    kind = str(job.get("kind") or "create")
    log.info("job %s: %s for game %s (attempt %s)", job_id, kind, game_id, int(job.get("attempts") or 0) + 1)

    await store.update_job(job_id, status="running", started_at=time.time(), worker_replica=REPLICA,
                           attempts=int(job.get("attempts") or 0) + 1)
    if kind in ("edit", "fix"):
        job.setdefault("payload", {})["current_html"] = await _load_current_html(job)
    spec = spec_from_job(job)

    last_status = {"value": None}
    pending: list[asyncio.Task[Any]] = []  # status writes; awaited before the version lands
    # The code stream is coalesced: deltas pile up and go out about once a
    # second as one frame, so a 1500-line game is ~100 frames, not 20,000.
    code = {"buf": "", "at": 0.0, "len": 0, "tail": ""}
    live = {"phase": "thinking", "thinking_chars": 0, "code_len": 0, "code_tail": "", "updated_at": time.time()}
    think = {"at": 0.0}
    snap = {"at": 0.0}

    def snapshot(force: bool = False) -> None:
        """The job row remembers where the build is, so a page opened
        mid-build (or after a refresh) starts from the truth, not from empty."""
        now = time.monotonic()
        if not force and now - snap["at"] < LIVE_SNAPSHOT_INTERVAL_S:
            return
        snap["at"] = now
        live["code_len"] = code["len"] + len(code["buf"])
        live["code_tail"] = (code["tail"] + code["buf"])[-LIVE_CODE_TAIL:]
        live["updated_at"] = time.time()
        pending.append(asyncio.get_event_loop().create_task(store.update_job(job_id, live=dict(live))))

    def flush_code(force: bool = False) -> None:
        now = time.monotonic()
        if not code["buf"] or (not force and now - code["at"] < CODE_FRAME_INTERVAL_S and len(code["buf"]) < CODE_FRAME_MAX):
            return
        chunk, code["buf"], code["at"] = code["buf"], "", now
        code["len"] += len(chunk)
        code["tail"] = (code["tail"] + chunk)[-LIVE_CODE_TAIL:]
        notify.publish_progress(learner_id, game_id, "code", status=last_status["value"] or "building",
                                chunk=chunk, code_len=code["len"])
        snapshot()

    def progress(event: dict[str, Any]) -> None:
        kind = event.get("type")
        if kind == "tool_delta":
            live["phase"] = "writing"
            code["buf"] += str(event.get("text") or "")
            flush_code()
            return
        if kind == "reasoning_delta":
            live["phase"] = "thinking"
            live["thinking_chars"] += len(str(event.get("text") or ""))
            now = time.monotonic()
            if now - think["at"] >= THINK_FRAME_INTERVAL_S:
                think["at"] = now
                notify.publish_progress(learner_id, game_id, "thinking", status=last_status["value"] or "building",
                                        thinking_chars=live["thinking_chars"])
                snapshot()
            return
        if kind in {"validate", "validated"}:
            live["phase"] = "validating"
        elif kind == "judge":
            live["phase"] = "judging"
        elif kind == "build":
            live["phase"] = "thinking"
        status = _game_status_for(event)
        if status and status != last_status["value"]:
            last_status["value"] = status
            pending.append(asyncio.get_event_loop().create_task(store.update_status(game_id, status)))
        if kind in {"build", "validate", "validated", "judge", "tool"}:
            flush_code(force=True)
            snapshot(force=True)
            notify.publish_progress(learner_id, game_id, str(kind), status=status or "", detail=json.dumps(
                {k: v for k, v in event.items() if k not in {"type", "text"}}, ensure_ascii=False)[:300])

    await store.update_status(game_id, "building" if kind == "create" else "fixing")

    async def snapshot_clock() -> None:
        # Flushes only happen while chunks arrive; the clock keeps the row's
        # snapshot fresh through pauses, so a page opened mid-build catches up.
        while True:
            await asyncio.sleep(LIVE_SNAPSHOT_INTERVAL_S)
            snapshot(force=True)

    clock = asyncio.create_task(snapshot_clock())
    try:
        result = await run_job(spec, progress)
    finally:
        clock.cancel()
    # A late "validating" write must never overwrite the "ready"/"failed" below.
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)

    usage_summary = result.usage.as_dict()
    if result.ok and result.html:
        game = await store.get_game(game_id) or {"_id": game_id, "learner_id": learner_id}
        v = max((int(e.get("v") or 0) for e in game.get("versions") or []), default=0) + 1
        stored = await html_store.put_html(learner_id, game_id, v, result.html)
        thumb_path = None
        if result.screenshot_png:
            thumb_path = await html_store.put_bytes(learner_id, game_id, v, "thumb.png", result.screenshot_png, "image/png")
        entry = await store.add_version(
            game_id, blob_path=stored["blob_path"], sha256=stored["sha256"], source=kind,
            summary=result.summary, title=result.title or None, thumb_blob_path=thumb_path,
            sparks=int(round(result.usage.cost_usd * SPARKS_PER_USD)),
            design_brief=result.design_brief or None,
        )
        await store.update_job(job_id, status="done", finished_at=time.time(), usage_summary=usage_summary, error_class=None)
        game = await store.get_game(game_id) or game
        kind_map = {"create": "game_ready", "edit": "game_edit_ready", "fix": "game_fix_ready"}
        await notify.notify_game(kind_map.get(kind, "game_ready"), game, int(entry["v"]))
        log.info("job %s done: v%s %s ($%.3f, %.0fs)", job_id, entry["v"], result.title, result.usage.cost_usd, result.elapsed_s)
    else:
        error_class = (result.error or "failed").split(":")[0][:60]
        errors_last = [{"message": str(a.contract_reason or ""), "errors": a.errors[:5]} for a in result.attempts[-2:]]
        await store.update_job(job_id, status="failed", finished_at=time.time(), usage_summary=usage_summary, error_class=error_class)
        game = await store.get_game(game_id) or {"_id": game_id, "learner_id": learner_id}
        # A failed edit or fix leaves the game exactly as it was: the current
        # version still plays, so the card stays "ready". Only a create with
        # nothing to fall back to is a failed game.
        has_version = int(game.get("current_version") or 0) > 0
        await store.update_status(game_id, "ready" if has_version else "failed", errors_last=errors_last)
        game = await store.get_game(game_id) or game
        await notify.notify_game("game_failed", game, int(game.get("current_version") or 0))
        log.warning("job %s failed: %s", job_id, result.error)
    return result


# ── Mongo polling transport ─────────────────────────────────────────────────

async def _claim_next_mongo() -> Optional[dict[str, Any]]:
    """Atomically take one queued job (oldest first). Uses the raw collection
    so two replicas polling the same cluster never claim the same row."""
    store, _, _ = _backend()
    from app.brain.repository import _get_collection_named  # type: ignore
    coll = _get_collection_named(store.JOBS)
    if coll is None:  # JSON fallback: best effort, single process only
        rows = await store._find(store.JOBS, {"status": "queued"}, sort=("created_at", 1), limit=1)
        if not rows:
            return None
        return await store.update_job(str(rows[0]["_id"]), status="running", worker_replica=REPLICA)
    doc = await coll.find_one_and_update(
        {"status": "queued"},
        {"$set": {"status": "running", "worker_replica": REPLICA, "started_at": time.time()}},
        sort=[("created_at", 1)],
        return_document=True,
    )
    return doc


async def run_mongo_loop(once: bool = False) -> int:
    handled = 0
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:  # pragma: no cover (Windows)
            pass
    log.info("worker %s polling learner_game_jobs every %.0fs", REPLICA, POLL_SECONDS)
    while not stop.is_set():
        job = await _claim_next_mongo()
        if job is None:
            if once:
                break
            try:
                await asyncio.wait_for(stop.wait(), POLL_SECONDS)
            except asyncio.TimeoutError:
                pass
            continue
        try:
            await handle_job(job)
        except Exception:
            log.exception("job %s crashed", job.get("_id"))
            store, _, _ = _backend()
            attempts = int(job.get("attempts") or 0) + 1
            if attempts >= MAX_ATTEMPTS:
                await store.update_job(str(job["_id"]), status="failed", error_class="worker_crash", finished_at=time.time())
                await store.update_status(str(job["game_id"]), "failed")
            else:
                await store.update_job(str(job["_id"]), status="queued", attempts=attempts)
        handled += 1
    return handled


# ── Service Bus transport ─────────────────────────────────────────────────
# The queue requires sessions (session_id = game_id, infra/game-gen/main.bicep),
# so a receiver must accept a session: NEXT_AVAILABLE_SESSION takes whichever
# game has work, drains it, and moves on. With sessions the lock to renew is
# the session's, not the message's. No session within max_wait_time raises
# OperationTimeoutError; that is the idle case, not a failure.

SESSION_IDLE_WAIT_S = 30


async def run_servicebus_loop() -> None:  # pragma: no cover - needs Azure
    from azure.servicebus import NEXT_AVAILABLE_SESSION  # type: ignore
    from azure.servicebus.aio import ServiceBusClient  # type: ignore
    from azure.servicebus.exceptions import OperationTimeoutError  # type: ignore
    conn = (os.environ.get("GAME_JOBS_SERVICEBUS_CONNECTION_STRING") or "").strip()
    namespace = (os.environ.get("GAME_JOBS_SERVICEBUS_NAMESPACE") or "").strip()
    queue = os.environ.get("GAME_JOBS_QUEUE", "game-jobs")
    store, _, _ = _backend()
    if conn:
        client = ServiceBusClient.from_connection_string(conn)
    else:
        from azure.identity.aio import DefaultAzureCredential  # type: ignore
        client = ServiceBusClient(namespace, credential=DefaultAzureCredential())
    log.info("worker %s receiving from %s (%s)", REPLICA, queue, namespace or "connection string")
    async with client:
        while True:
            try:
                receiver = client.get_queue_receiver(
                    queue_name=queue, session_id=NEXT_AVAILABLE_SESSION, max_wait_time=SESSION_IDLE_WAIT_S,
                )
                async with receiver:
                    session_id = receiver.session.session_id
                    log.info("session %s accepted", session_id)
                    async for msg in receiver:
                        await _handle_servicebus_message(receiver, msg, store)
                    log.info("session %s drained", session_id)
            except OperationTimeoutError:
                continue  # no session had work; KEDA scales us to 0 when the queue stays empty
            except Exception:
                log.exception("service bus receive loop error; retrying")
                await asyncio.sleep(5)


async def _handle_servicebus_message(receiver: Any, msg: Any, store: Any) -> None:  # pragma: no cover
    body = json.loads(str(msg))
    job = await store.get_job(str(body.get("job_id") or ""))
    if not job or job.get("status") in ("done",):
        await receiver.complete_message(msg)
        return
    renew = asyncio.create_task(_renew_session(receiver))
    try:
        await handle_job(job)
        await receiver.complete_message(msg)
    except Exception:
        log.exception("job %s crashed", job.get("_id"))
        await receiver.abandon_message(msg)
    finally:
        renew.cancel()


async def _renew_session(receiver: Any) -> None:  # pragma: no cover
    while True:
        await asyncio.sleep(30)
        try:
            await receiver.session.renew_lock()
        except Exception as exc:
            log.warning("session lock renew failed: %s", exc)
            return


async def _with_realtime_bridge(coro: Any) -> Any:
    """Progress frames and bells cross to the app's SSE through the Redis
    bridge; without REDIS_CONNECTION_STRING publish() stays local (the bell row
    is still written to Mongo, so the kid sees it on the next refresh)."""
    try:
        from app.services import realtime  # type: ignore
    except Exception:
        realtime = None
    if realtime is not None:
        try:
            await realtime.start_bridge()
        except Exception as exc:  # pragma: no cover - env dependent
            log.warning("realtime bridge not started: %s", exc)
    try:
        return await coro
    finally:
        if realtime is not None:
            try:
                await realtime.stop_bridge()
            except Exception:
                pass


def main() -> None:
    logging.basicConfig(level=os.environ.get("GAME_WORKER_LOG_LEVEL", "INFO"),
                        format="%(asctime)s %(name)s %(levelname)s %(message)s")
    mode = os.environ.get("GAME_JOBS_MODE", "mongo").strip().lower()
    if mode == "servicebus":
        asyncio.run(_with_realtime_bridge(run_servicebus_loop()))
    else:
        asyncio.run(_with_realtime_bridge(run_mongo_loop(once=os.environ.get("GAME_WORKER_ONCE") == "1")))


if __name__ == "__main__":
    main()
