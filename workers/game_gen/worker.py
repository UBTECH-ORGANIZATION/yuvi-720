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
Mongo is the source of truth (payload, learning context, kind). At the end it
writes the job's timings, per-attempt detail and the judge's verdict.

Runs with ``PYTHONPATH=workers:backend`` — it imports the backend's games
services directly (store, html_store, notify, ai_usage) instead of talking to
the API, exactly like the Manim worker does.
"""
from __future__ import annotations

import asyncio
import inspect
import json
import re
import logging
import os
import signal
import socket
import time
from datetime import datetime
from typing import Any, Optional

from . import config  # noqa: F401  (loads backend/.env for local runs)
from .context_pack import build_context_pack
from .patch_engine import apply_line_patches, changed_ranges, extract_line_patches
from .pipeline import JobResult, JobSpec, run_job
from .usage import usage_context

log = logging.getLogger("game_gen.worker")

REPLICA = os.environ.get("CONTAINER_APP_REPLICA_NAME") or socket.gethostname()
POLL_SECONDS = float(os.environ.get("GAME_WORKER_POLL_SECONDS", "3"))
MAX_ATTEMPTS = int(os.environ.get("GAME_JOBS_MAX_DELIVERY", "3"))
SPARKS_PER_USD = float(os.environ.get("GAME_SPARKS_PER_USD", "100"))  # kid-facing "sparks" = cents
# The player paces its reveal to the gap between frames, so the gap IS the
# feel: ~7 code frames a second reads as typing; a frame every third of a
# second read as stalls with bursts between them.
CODE_FRAME_INTERVAL_S = 0.15  # live-code frames to the player, at most this often…
CODE_FRAME_MAX = 6000         # …unless this much piled up first
THINK_FRAME_INTERVAL_S = 0.4  # reasoning frames to the player, at most this often…
THINK_FRAME_MAX = 1500        # …unless this much piled up
LIVE_THINK_TAIL = 12_000      # reasoning kept on the job row for a page opened mid-think
LIVE_SNAPSHOT_INTERVAL_S = 3.0  # the job row keeps a snapshot so a page opened mid-build catches up
LIVE_CODE_TAIL = 240_000     # the whole game, so a reload mid-build shows every line
PROCESS_STARTED = time.time()  # wake_s: how long the first job waited for this process
_FIRST_JOB = {"pending": True}


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


def _parse_ts(value: Any) -> Optional[float]:
    """`created_at` is an ISO string from the store (`_now()`); a float is accepted too."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        text = str(value).strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        return datetime.fromisoformat(text).timestamp()
    except (TypeError, ValueError):
        return None


def spec_from_job(job: dict[str, Any]) -> JobSpec:
    payload = job.get("payload") or {}
    pack = build_context_pack(
        payload.get("context") or {},
        language=str(payload.get("language") or "he"),
        device=str(payload.get("device") or "keyboard"),
    )
    return JobSpec(
        job_id=str(job["_id"]),
        game_id=str(job["game_id"]),
        learner_id=str(job["learner_id"]),
        kind=str(job.get("kind") or "create"),
        pack=pack,
        genre=str(payload.get("genre") or "surprise"),
        vibe=str(payload.get("vibe") or ""),
        clarifications=dict(payload.get("clarifications") or {}),
        inspirations=[str(x) for x in (payload.get("inspirations") or [])][:6],
        learner_title=str(payload.get("learner_title") or "")[:40],
        instruction=str(payload.get("instruction") or ""),
        current_html=str(payload.get("current_html") or ""),
        runtime_errors=list(payload.get("runtime_errors") or []),
        history=list(payload.get("history") or []),
        model=str(payload.get("model") or os.environ.get("COPILOT_MODEL") or "claude-sonnet-5"),
        reasoning_effort=str(payload.get("reasoning_effort") or "low"),
        judge=bool(payload.get("judge", True)),
        plan=bool(payload.get("plan", True)),
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


class _ToolInputDecoder:
    """Turns the streamed JSON of a `submit_game` / `patch_game` call into the
    plain code string: waits for the `"html":"` (or `"patches":"`) key, then
    undoes JSON string escapes chunk by chunk, carrying a split escape over."""

    KEYS = ('"html":"', '"html": "', '"patches":"', '"patches": "')

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.started = False
        self.head = ""
        self.carry = ""

    def feed(self, text: str) -> str:
        if not self.started:
            self.head += text
            for key in self.KEYS:
                idx = self.head.find(key)
                if idx >= 0:
                    self.started = True
                    rest = self.head[idx + len(key):]
                    self.head = ""
                    return self._unescape(rest)
            self.head = self.head[-64:] if len(self.head) > 4096 else self.head
            return ""
        return self._unescape(text)

    def _unescape(self, text: str) -> str:
        text = self.carry + text
        self.carry = ""
        # A trailing backslash or a cut \uXXXX waits for the next chunk.
        m = re.search(r"(\\u[0-9a-fA-F]{0,3}|\\)$", text)
        if m:
            self.carry = m.group(0)
            text = text[: m.start()]
        return _JSON_ESCAPE.sub(_unescape_one, text)


_JSON_ESCAPE = re.compile(r"\\(u[0-9a-fA-F]{4}|.)", re.S)
_SIMPLE_ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", '"': '"', "\\": "\\", "/": "/"}


def _unescape_one(match: "re.Match[str]") -> str:
    token = match.group(1)
    if token.startswith("u"):
        return chr(int(token[1:], 16))
    return _SIMPLE_ESCAPES.get(token, match.group(0))


#: The SUMMARY line is complete once its newline arrived.
_SUMMARY_DONE = re.compile(r"^\s*SUMMARY:\s*(.+?)\s*\n", re.MULTILINE)


class _PatchStreamer:
    """Turns the patch text of an edit reply into what the kid should see:
    the game file with the change applied, as each operation completes.

    Feed the reply text as it streams. Whenever a REPLACE/INSERT/DELETE
    operation closes, every operation so far is applied to the ORIGINAL file
    (that is what the line numbers refer to) and `frame()` returns the
    patched file plus the changed ranges (patched numbering) and the line to
    scroll to. A ```html fence means the model chose a full rewrite: the
    streamer steps aside (`rewrite` becomes True) and the fence decoder
    takes over."""

    def __init__(self, original: str) -> None:
        self.rebase(original)

    def rebase(self, original: str) -> None:
        """Start over against a new original (the judge's revision of a create)."""
        self.original = original
        self.buf = ""
        self.ops_seen = 0
        self.rewrite = False

    def feed(self, text: str) -> Optional[dict[str, Any]]:
        if self.rewrite or not self.original:
            return None
        self.buf += text
        if "```html" in self.buf:
            self.rewrite = True
            return None
        ops = extract_line_patches(self.buf)
        if len(ops) <= self.ops_seen:
            return None
        self.ops_seen = len(ops)
        patched, err = apply_line_patches(self.original, ops)
        if err:
            return None
        ranges = changed_ranges(ops)
        latest = ranges[-1][0] if ranges else None
        return {"html": patched, "changed": ranges, "focus_line": latest}


class _FenceDecoder:
    """Streams the inside of a ```html block out of message text. Returns
    (code_chunk, restarted): `restarted` is True when a new ```html fence
    opens after code already streamed (the model started the file over)."""

    OPEN = "```html"

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.inside = False
        self.done_once = False
        self.head = ""
        self.carry = ""

    def feed(self, text: str) -> tuple[str, bool]:
        restarted = False
        out = ""
        buf = self.carry + text
        self.carry = ""
        while buf:
            if not self.inside:
                idx = buf.find(self.OPEN)
                if idx < 0:
                    # keep a tail in case the fence is split across chunks
                    self.carry = buf[-len(self.OPEN):] if len(buf) >= len(self.OPEN) else buf
                    return out, restarted
                rest = buf[idx + len(self.OPEN):]
                if rest.startswith("\n"):
                    rest = rest[1:]
                elif not rest:
                    self.carry = self.OPEN  # wait for the newline
                    return out, restarted
                if self.done_once or out:
                    restarted = True
                    out = ""
                self.inside = True
                self.done_once = True
                buf = rest
                continue
            end = buf.find("```")
            if end < 0:
                # a partial closing fence may be split across chunks
                keep = 0
                for n in (2, 1):
                    if buf.endswith("`" * n):
                        keep = n
                        break
                out += buf[: len(buf) - keep] if keep else buf
                self.carry = buf[len(buf) - keep:] if keep else ""
                return out, restarted
            out += buf[:end]
            self.inside = False
            buf = buf[end + 3:]
        return out, restarted


def _code_from_arguments(arguments: Any) -> str:
    if not isinstance(arguments, dict):
        return ""
    for key in ("html", "patches"):
        value = arguments.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


async def handle_job(job: dict[str, Any]) -> JobResult:
    """Run one job to completion and persist everything it produced."""
    store, html_store, notify = _backend()
    job_id, game_id, learner_id = str(job["_id"]), str(job["game_id"]), str(job["learner_id"])
    kind = str(job.get("kind") or "create")
    log.info("job %s: %s for game %s (attempt %s)", job_id, kind, game_id, int(job.get("attempts") or 0) + 1)

    started_at = time.time()
    created_at = _parse_ts(job.get("created_at"))
    queued_s = max(0.0, started_at - created_at) if created_at is not None else 0.0
    # The first job of a process is the one that woke it (a scale-from-zero
    # start): the wait between the job's birth and the process is its wake.
    wake_s = 0.0
    if _FIRST_JOB["pending"]:
        _FIRST_JOB["pending"] = False
        if created_at is None or created_at <= PROCESS_STARTED:
            wake_s = max(0.0, started_at - PROCESS_STARTED)
    await store.update_job(job_id, status="running", started_at=started_at, worker_replica=REPLICA,
                           attempts=int(job.get("attempts") or 0) + 1)
    if kind in ("edit", "fix"):
        job.setdefault("payload", {})["current_html"] = await _load_current_html(job)
    spec = spec_from_job(job)

    last_status = {"value": None}
    pending: list[asyncio.Task[Any]] = []  # status writes; awaited before the version lands
    # The code stream is coalesced: deltas pile up and go out about once a
    # second as one frame, so a 1500-line game is ~100 frames, not 20,000.
    code = {"buf": "", "at": 0.0, "len": 0, "tail": ""}
    # The tool input is JSON; the player only ever sees the decoded `html` /
    # `patches` string, so the key is found here and escapes are undone here.
    decoder = _ToolInputDecoder()
    fence = _FenceDecoder()
    patcher = _PatchStreamer(spec.current_html if kind in ("edit", "fix") else "")
    if patcher.original:
        # An edit starts from the game as it is: the kid sees the file at once
        # and then watches the changed places light up.
        notify.publish_progress(learner_id, game_id, "code", status="building", chunk=patcher.original,
                                code_len=len(patcher.original), reset=True, instant=True)
    live = {"phase": "thinking", "thinking_chars": 0, "thinking_tail": "", "code_len": 0, "code_tail": "", "updated_at": time.time()}
    # The reasoning streams too, coalesced like the code: a page shows the
    # kid what Yuvi is weighing, not just that it is thinking.
    think = {"at": 0.0, "buf": ""}
    snap = {"at": 0.0}
    # An edit's reply streams as text the kid must not see raw (SUMMARY line,
    # then patch DSL). The summary is in the kid's language: it goes out the
    # moment it is complete, and until the first operation lands the page
    # hears how far the patch has come, so the wait is never blank.
    edit = {"text": "", "summary": "", "at": 0.0}

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
            code["buf"] += decoder.feed(str(event.get("text") or ""))
            flush_code()
            return
        if kind == "text_delta":
            text = str(event.get("text") or "")
            if patcher.original and not patcher.rewrite:
                # An edit as patches: show the patched file each time an
                # operation completes, with the changed lines marked.
                edit["text"] += text
                if not edit["summary"]:
                    m = _SUMMARY_DONE.search(edit["text"])
                    if m:
                        edit["summary"] = m.group(1).strip()
                        notify.publish_progress(learner_id, game_id, "summary", status=last_status["value"] or "building",
                                                detail=edit["summary"][:300])
                frame = patcher.feed(text)
                if not frame:
                    now = time.monotonic()
                    if now - edit["at"] >= THINK_FRAME_INTERVAL_S:
                        edit["at"] = now
                        notify.publish_progress(learner_id, game_id, "patching", status=last_status["value"] or "building",
                                                chars=len(edit["text"]))
                if frame:
                    live["phase"] = "writing"
                    code["len"], code["tail"], code["buf"] = len(frame["html"]), frame["html"][-LIVE_CODE_TAIL:], ""
                    notify.publish_progress(learner_id, game_id, "code", status=last_status["value"] or "building",
                                            chunk=frame["html"], code_len=len(frame["html"]), reset=True, instant=True,
                                            changed=frame["changed"], focus_line=frame["focus_line"])
                    snapshot()
                if not patcher.rewrite:
                    return
            # Text delivery: the game is a ```html block in the reply. A new
            # fence after a cut-off is the model restarting the file: the
            # player starts over with it too.
            chunk, restarted = fence.feed(text)
            if restarted:
                code["buf"], code["len"], code["tail"] = "", 0, ""
                notify.publish_progress(learner_id, game_id, "code", status=last_status["value"] or "building",
                                        chunk="", code_len=0, reset=True)
            if chunk:
                live["phase"] = "writing"
                code["buf"] += chunk
                flush_code()
            return
        if kind == "plan":
            # The pitch: the kid reads the concept while the builder starts.
            if event.get("status") == "done":
                text = str(event.get("text") or "")[:600]
                notify.publish_progress(learner_id, game_id, "plan", status=last_status["value"] or "building", detail=text)
                update_game = getattr(store, "update_game", None)
                if text and update_game is not None:
                    pending.append(asyncio.get_event_loop().create_task(update_game(game_id, pitch=text)))
            return
        if kind == "revise":
            # The judge asked for one fix: from here the reply streams like an
            # edit — the kid sees the accepted game, then the changed lines.
            if event.get("status") == "start":
                original = str(event.get("html") or "")
                patcher.rebase(original)
                fence.reset()
                edit["text"], edit["summary"], edit["at"] = "", "", 0.0
                code["buf"], code["len"], code["tail"] = "", len(original), original[-LIVE_CODE_TAIL:]
                notify.publish_progress(learner_id, game_id, "code", status=last_status["value"] or "building",
                                        chunk=original, code_len=len(original), reset=True, instant=True)
                snapshot(force=True)
            return
        if kind == "build":
            fence.reset()
        if kind == "tool" and event.get("status") == "start":
            # Deltas are best-effort (they stop early on long inputs); the
            # start event carries the whole input, so the player gets the
            # complete code the moment Yuvi hands it in.
            full = _code_from_arguments(event.get("arguments"))
            if full and len(full) > code["len"] + len(code["buf"]):
                code["buf"], code["len"], code["tail"] = "", 0, ""
                first = True
                for start in range(0, len(full), CODE_FRAME_MAX):
                    chunk = full[start:start + CODE_FRAME_MAX]
                    code["len"] += len(chunk)
                    code["tail"] = (code["tail"] + chunk)[-LIVE_CODE_TAIL:]
                    notify.publish_progress(learner_id, game_id, "code", status=last_status["value"] or "building",
                                            chunk=chunk, code_len=code["len"], reset=first)
                    first = False
            decoder.reset()
        elif kind == "tool":
            decoder.reset()
        if kind == "reasoning_delta":
            live["phase"] = "thinking"
            text = str(event.get("text") or "")
            live["thinking_chars"] += len(text)
            live["thinking_tail"] = (live["thinking_tail"] + text)[-LIVE_THINK_TAIL:]
            think["buf"] += text
            now = time.monotonic()
            if now - think["at"] >= THINK_FRAME_INTERVAL_S or len(think["buf"]) >= THINK_FRAME_MAX:
                chunk, think["buf"], think["at"] = think["buf"], "", now
                notify.publish_progress(learner_id, game_id, "thinking", status=last_status["value"] or "building",
                                        thinking_chars=live["thinking_chars"], chunk=chunk)
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
    attempts_detail = [a.as_detail() for a in result.attempts]

    def timings(persist_s: float = 0.0) -> dict[str, Any]:
        out = dict(result.timings or {})
        out.update({"queued_s": round(queued_s, 3), "wake_s": round(wake_s, 3),
                    "persist_s": round(persist_s, 3), "total_s": round(time.time() - started_at, 3)})
        return out

    if result.ok and result.html:
        t_persist = time.perf_counter()
        game = await store.get_game(game_id) or {"_id": game_id, "learner_id": learner_id}
        v = max((int(e.get("v") or 0) for e in game.get("versions") or []), default=0) + 1
        stored = await html_store.put_html(learner_id, game_id, v, result.html)
        thumb_path = None
        if result.screenshot_png:
            thumb_path = await html_store.put_bytes(learner_id, game_id, v, "thumb.png", result.screenshot_png, "image/png")
        version_kwargs: dict[str, Any] = dict(
            blob_path=stored["blob_path"], sha256=stored["sha256"], source=kind,
            summary=result.summary, title=result.title or None, thumb_blob_path=thumb_path,
            sparks=int(round(result.usage.cost_usd * SPARKS_PER_USD)),
            design_brief=result.design_brief or None,
        )
        if _accepts_kwarg(store.add_version, "judge"):
            version_kwargs["judge"] = result.judge
        entry = await store.add_version(game_id, **version_kwargs)
        persist_s = time.perf_counter() - t_persist
        await store.update_job(job_id, status="done", finished_at=time.time(), usage_summary=usage_summary, error_class=None,
                               timings=timings(persist_s), attempts_detail=attempts_detail, judge=result.judge,
                               model=spec.model, reasoning_effort=spec.reasoning_effort)
        game = await store.get_game(game_id) or game
        kind_map = {"create": "game_ready", "edit": "game_edit_ready", "fix": "game_fix_ready"}
        await notify.notify_game(kind_map.get(kind, "game_ready"), game, int(entry["v"]))
        log.info("job %s done: v%s %s ($%.3f, %.0fs)", job_id, entry["v"], result.title, result.usage.cost_usd, result.elapsed_s)
    else:
        error_class = (result.error or "failed").split(":")[0][:60]
        errors_last = [{"message": str(a.reason or ""), "errors": a.errors[:5]} for a in result.attempts[-2:]]
        await store.update_job(job_id, status="failed", finished_at=time.time(), usage_summary=usage_summary, error_class=error_class,
                               timings=timings(), attempts_detail=attempts_detail, judge=result.judge,
                               model=spec.model, reasoning_effort=spec.reasoning_effort)
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


def _accepts_kwarg(fn: Any, name: str) -> bool:
    """True when `fn(..., name=…)` is a valid call (named or **kwargs)."""
    try:
        params = inspect.signature(fn).parameters
    except (TypeError, ValueError):
        return True
    return name in params or any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values())


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
        try:
            job = await _claim_next_mongo()
        except Exception as exc:
            # A Cosmos read timeout or a dropped socket must not kill the
            # worker: a queued job would then wait for a process that no
            # longer exists. Log, back off, poll again.
            log.warning("claim failed (%s); retrying in %.0fs", type(exc).__name__, POLL_SECONDS * 2)
            try:
                await asyncio.wait_for(stop.wait(), POLL_SECONDS * 2)
            except asyncio.TimeoutError:
                pass
            continue
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
SESSION_RENEW_EVERY_S = 20
#: A running job whose snapshot moved within this window is alive on some
#: replica: a redelivery of its message is a duplicate, not a retry.
LIVE_JOB_FRESH_S = 90.0


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


def _job_is_live(job: dict[str, Any], now: Optional[float] = None) -> bool:
    """True when the job is running and its row moved recently: another
    replica (or an earlier delivery in this one) is building it right now.
    A lost session lock re-delivers the message; running the job twice
    streamed two games into one page (seen 2026-09-10)."""
    if job.get("status") != "running":
        return False
    seen = _parse_ts(job.get("updated_at"))
    if seen is None:
        return False
    return (now if now is not None else time.time()) - seen < LIVE_JOB_FRESH_S


async def _handle_servicebus_message(receiver: Any, msg: Any, store: Any) -> None:  # pragma: no cover
    body = json.loads(str(msg))
    job = await store.get_job(str(body.get("job_id") or ""))
    if not job or job.get("status") in ("done",):
        await receiver.complete_message(msg)
        return
    if _job_is_live(job):
        log.warning("job %s: redelivered while a run is live (delivery %s); skipping the duplicate",
                    job.get("_id"), getattr(msg, "delivery_count", "?"))
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
    """Keeps the session lock while the build runs. A transient AMQP timeout
    (the bus link drops while Chromium saturates the CPU) is retried on the
    next tick; giving up on the first one let the lock expire and the job be
    delivered again mid-build. Only a lock already lost ends the renewer."""
    while True:
        await asyncio.sleep(SESSION_RENEW_EVERY_S)
        try:
            await receiver.session.renew_lock()
        except Exception as exc:
            name = type(exc).__name__
            log.warning("session lock renew failed (%s): %s", name, exc)
            if "LockLost" in name or "lock" in str(exc).lower() and "lost" in str(exc).lower():
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
