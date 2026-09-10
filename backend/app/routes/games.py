"""Learning Game Lab routes — a learner's own games, and nothing else.

Every route is learner-scoped through the session. The one widening is a
teacher (or admin) reading a learner's games with ``?learner=``, which goes
through ``assert_can_read_learner`` — the same org scoping every other
teacher read composes. Mutations are owner-only; a teacher can look at a
child's game but cannot spend the child's daily cap.

Four things this module is careful about:

**The context never leaves.** A game document has no learning context; the
job payload (the trimmed catalog snapshot and the learning description) is
never returned; the picker (`/objectives`) projects components down to
id/title/purpose; and the served HTML gets the harness with titles and the
language only — the game grades its own questions in the page.

**Caps are enforced before anything is written.** Creates and edits per
learner per UTC day come from ``budget.effective_caps`` (an admin override, the
admin defaults, or the ``GAMES_DAILY_*_CAP`` env values), and at most two
fix jobs per version — a broken game that two repair rounds could not fix is
not going to be fixed by a third (§2.5).

**The model is decided at create.** ``GAME_MODEL_DEFAULT`` (or an admin's
pick — a learner's ``model`` is ignored, never refused) and the effort
(``medium`` with deep thinking, ``low`` otherwise) are stored on the game;
edits and fixes reuse them. Timings, judge verdicts and model names are
exposed on jobs to admins only.

**The harness is the worker's.** ``game_gen.harness`` is imported from
``<repo>/workers`` so the HTML served here is injected by exactly the code the
validator ran it under. The import is best-effort: without it the HTML route
answers 503 rather than serving a game without its bridge.
"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse, Response
from pydantic import BaseModel, Field

from app.auth.dependencies import (
    ROLE_ADMIN, ROLE_LEARNER, assert_can_read_learner, current_user, require_learner,
)
from app.services import content_filter, events, kata_catalog
from app.services.llm import call_llm
from app.services.ai_usage import UsageContext
from app.services.games import budget, html_store, jobs, learning_descriptions, narration, store
from app.services.learner_activity import HIDDEN_SUBJECTS

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/games", tags=["games"])

_NO_STORE = {"Cache-Control": "private, no-store"}

# The served document may run inline scripts and load the curated CDNs; it
# may not talk to anyone (`connect-src 'none'`) — the bridge is postMessage.
_GAME_CSP = (
    "default-src 'none'; "
    "script-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
    "style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; "
    "connect-src 'none'"
)

_WORKERS_DIR = Path(__file__).resolve().parents[3] / "workers"

_FIX_JOBS_PER_VERSION = 2


def _harness_module():
    """``game_gen.harness`` from the worker package, or None when the package
    is not on this box."""
    if str(_WORKERS_DIR) not in sys.path and _WORKERS_DIR.exists():
        sys.path.insert(0, str(_WORKERS_DIR))
    try:
        from game_gen import harness
    except Exception as exc:  # pragma: no cover - environment dependent
        log.warning("game harness unavailable: %s", type(exc).__name__)
        return None
    return harness


# ── request models ───────────────────────────────────────────────────────────

Language = Literal["he", "ar", "en"]
Device = Literal["keyboard", "touch"]


class CreateGameRequest(BaseModel):
    objective_id: str = Field(min_length=1, max_length=160)
    unit_id: str = Field(min_length=1, max_length=160)
    component_id: str = Field(min_length=1, max_length=160)
    # The kid's brief is the design input. `inspirations` are optional flavour
    # chips (context for the designer, never a constraint); `genre` stays for
    # the card's tile and defaults to "open" — Yuvi picks the form.
    genre: str = Field(default="open", min_length=1, max_length=32)
    inspirations: list[str] = Field(default_factory=list, max_length=6)
    vibe: str = Field(default="", max_length=600)
    # The kid's own name for the game. When given it stays; otherwise the
    # model titles the game and the card shows the component name until then.
    title: str = Field(default="", max_length=40)
    clarifications: dict[str, str] = Field(default_factory=dict)
    device: Device = "keyboard"
    language: Language = "he"
    deep_thinking: bool = False
    # Which model builds it. Honoured for an admin session only; a learner's
    # value is ignored (the game gets ``GAME_MODEL_DEFAULT``), never refused.
    model: Optional[str] = Field(default=None, max_length=80)


class EditRequest(BaseModel):
    instruction: str = Field(min_length=1, max_length=600)
    # The player's single chat: what the kid wrote, plus whatever runtime
    # errors the frame reported meanwhile, so one message fixes and changes.
    errors: list[dict[str, Any]] = Field(default_factory=list, max_length=20)


class BugReport(BaseModel):
    errors: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    note: str = Field(default="", max_length=600)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=600)


class RevertRequest(BaseModel):
    v: int = Field(ge=1)


# ── identity ─────────────────────────────────────────────────────────────────

async def _reader(
    learner: Optional[str] = Query(None, max_length=120),
    session: dict[str, Any] = Depends(current_user),
) -> str:
    """Whose games a READ is about. Without `?learner=` it is the session's
    own learner; with it, a teacher/admin scoped to that learner."""
    own = str(session.get("sub") or "")
    if learner and learner != own:
        await assert_can_read_learner(session, learner)
        return learner
    if ROLE_LEARNER not in (session.get("roles") or []):
        raise HTTPException(status_code=403, detail="learner_role_required")
    return own


def _is_admin(session: dict[str, Any]) -> bool:
    """The token's role — the gate for what a response shows (model names,
    timings, judge verdicts), not for what it changes."""
    return ROLE_ADMIN in (session.get("roles") or [])


async def _admin_reader(session: dict[str, Any] = Depends(current_user)) -> bool:
    return _is_admin(session)


async def _owned_game(game_id: str, learner_id: str) -> dict[str, Any]:
    """The game, if it exists, is not deleted, and belongs to `learner_id`.
    A foreign id is a 404, not a 403: the id space is guessable and the
    difference between "no such game" and "not yours" is information."""
    game = await store.get_game(game_id)
    if game is None or game.get("deleted_at") or str(game.get("learner_id")) != learner_id:
        raise HTTPException(status_code=404, detail="game_not_found")
    return game


def _refuse_if_flagged(text: str) -> None:
    verdict = content_filter.check_content(text)
    if verdict.flagged:
        raise HTTPException(status_code=422, detail="content_blocked")


# ── projections ──────────────────────────────────────────────────────────────

def _public_version(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "v": int(entry.get("v") or 0),
        "created_at": entry.get("created_at"),
        "source": entry.get("source"),
        "summary": entry.get("summary") or "",
        "sha256": entry.get("sha256"),
    }


def _public_job(job: Optional[dict[str, Any]], *, admin: bool = False) -> Optional[dict[str, Any]]:
    """Status and error class for everyone; never the payload (it holds the
    context). An admin also sees the instrumentation — model, effort,
    timings, attempts, the judge's verdict."""
    if not job:
        return None
    out: dict[str, Any] = {
        "job_id": job.get("_id"),
        "kind": job.get("kind"),
        "status": job.get("status"),
        "error_class": job.get("error_class"),
        "started_at": job.get("started_at"),
        "finished_at": job.get("finished_at"),
    }
    if admin:
        out.update({
            "model": job.get("model"),
            "reasoning_effort": job.get("reasoning_effort"),
            "timings": job.get("timings"),
            "attempts_detail": job.get("attempts_detail"),
            "judge": job.get("judge"),
            "usage_summary": job.get("usage_summary"),
        })
    return out


def _public_game(game: dict[str, Any], *, lang: str = "he",
                 last_job: Optional[dict[str, Any]] = None, admin: bool = False) -> dict[str, Any]:
    return {
        "game_id": game.get("_id"),
        "learner_id": game.get("learner_id"),
        "objective_id": game.get("objective_id"),
        "unit_id": game.get("unit_id"),
        "component_id": game.get("component_id"),
        "objective_title": kata_catalog.objective_title(game.get("objective_id"), lang),
        "component_title": kata_catalog.component_title(game.get("component_id"), lang),
        "title": game.get("title") or "",
        "genre": game.get("genre"),
        "prompt": game.get("prompt") or "",
        "language": game.get("language"),
        "device": game.get("device"),
        "status": game.get("status"),
        "current_version": int(game.get("current_version") or 0),
        "versions": [_public_version(entry) for entry in (game.get("versions") or [])],
        "has_thumb": bool(game.get("thumb_blob_path")),
        "errors_last": list(game.get("errors_last") or [])[:5],
        "sparks_spent": int(game.get("sparks_spent") or 0),
        "model": game.get("model"),
        "reasoning_effort": str(game.get("reasoning_effort") or "low"),
        "description": str(game.get("description") or ""),
        "created_at": game.get("created_at"),
        "updated_at": game.get("updated_at"),
        "last_job": _public_job(last_job, admin=admin),
    }


# ── routes ───────────────────────────────────────────────────────────────────

@router.get("")
async def list_games(
    component: Optional[str] = Query(None, max_length=160),
    objective: Optional[str] = Query(None, max_length=160),
    cursor: Optional[str] = Query(None, max_length=64),
    limit: int = Query(20, ge=1, le=store.MAX_PAGE),
    lang: str = Query("he", max_length=5),
    learner_id: str = Depends(_reader),
    admin: bool = Depends(_admin_reader),
):
    await kata_catalog.ensure_loaded()
    rows, next_cursor = await store.list_games(
        learner_id, component_id=component, objective_id=objective,
        cursor=cursor, limit=limit,
    )
    return JSONResponse(
        content={"games": [_public_game(row, lang=lang, admin=admin) for row in rows],
                 "next_cursor": next_cursor},
        headers=_NO_STORE,
    )


@router.get("/objectives")
async def picker_objectives(
    lang: str = Query("he", max_length=5),
    learner_id: str = Depends(_reader),
):
    """The Create wizard's first two steps: subjects → objectives → components.

    Objectives and components the learner has already visited come first
    (their recent events name the objective and the launched component); the
    rest of the subject catalog follows. Every component is offered — the
    game is built around what the lesson teaches, not around its questions.
    """
    await kata_catalog.ensure_loaded()
    visited_objectives: set[str] = set()
    visited_components: set[str] = set()
    try:
        for event in await events.get_recent_events(learner_id, limit=200):
            if event.get("objective_id"):
                visited_objectives.add(str(event["objective_id"]))
            if event.get("launch"):
                visited_components.add(str(event["launch"]))
    except Exception as exc:  # the picker still works without history
        log.warning("game picker: recent events unavailable: %s", type(exc).__name__)

    subjects_out: list[dict[str, Any]] = []
    for subject in kata_catalog.subjects():
        if subject in HIDDEN_SUBJECTS:
            continue
        # The catalog splits one MOE objective into several ids with the same
        # title (e.g. COMPL / PLOT / WRITE); the kid sees one card, and each
        # component carries the objective id it really belongs to.
        merged: dict[tuple[str, str], dict[str, Any]] = {}
        for objective in kata_catalog.objectives_for(subject):
            oid = str(objective.get("id") or "")
            components_out: list[dict[str, Any]] = []
            for component in kata_catalog.components_for(oid):
                cid = str(component.get("id") or "")
                components_out.append({
                    "id": cid,
                    "objective_id": oid,
                    "unit_id": component.get("unit_id"),
                    "unit_title": kata_catalog.unit_title(component.get("unit_id"), lang),
                    "title": kata_catalog.component_title(cid, lang) or component.get("title") or "",
                    "purpose": component.get("purpose"),
                    "difficulty": component.get("relative_difficulty"),
                    "is_assessment": bool(component.get("is_assessment")),
                    "visited": cid in visited_components,
                })
            if not components_out:
                continue
            title = kata_catalog.objective_title(oid, lang) or objective.get("title") or ""
            topic = str(objective.get("topic_title") or "")
            row = merged.get((topic, title))
            if row is None:
                row = merged[(topic, title)] = {
                    "id": oid, "title": title, "topic_title": topic, "visited": False, "components": [],
                }
            row["components"].extend(components_out)
            row["visited"] = row["visited"] or oid in visited_objectives or any(c["visited"] for c in components_out)
        objectives_out = list(merged.values())
        for row in objectives_out:
            row["components"].sort(key=lambda c: not c["visited"])
        if not objectives_out:
            continue
        objectives_out.sort(key=lambda row: not row["visited"])
        subjects_out.append({"subject": subject, "objectives": objectives_out})
    return JSONResponse(content={"subjects": subjects_out}, headers=_NO_STORE)


@router.post("", status_code=201)
async def create_game(
    data: CreateGameRequest, learner_id: str = Depends(require_learner),
    session: dict[str, Any] = Depends(current_user),
):
    if data.genre not in jobs.GENRES:
        raise HTTPException(status_code=422, detail="bad_genre")
    inspirations = [chip for chip in data.inspirations if chip in jobs.INSPIRATIONS][:6]
    _refuse_if_flagged(" ".join([data.vibe, *data.clarifications.values()]))

    await kata_catalog.ensure_loaded()
    component = kata_catalog.get_component(data.component_id)
    if not component:
        raise HTTPException(status_code=404, detail="component_not_found")
    if component.get("unit_id") and component["unit_id"] != data.unit_id:
        raise HTTPException(status_code=422, detail="unit_mismatch")

    cap = (await budget.effective_caps(learner_id))["create_per_day"]
    if await store.count_created_today(learner_id) >= cap:
        raise HTTPException(status_code=429, detail="daily_create_cap")

    learner_title = " ".join(data.title.split())[:40]
    title = learner_title or (kata_catalog.component_title(data.component_id, data.language)
                              or component.get("title") or data.component_id)
    requested_model = " ".join((data.model or "").split())[:80]
    model = requested_model if (requested_model and _is_admin(session)) else jobs.default_model()
    game = await store.create_game(
        learner_id=learner_id, objective_id=data.objective_id, unit_id=data.unit_id,
        component_id=data.component_id, title=title, title_by_learner=bool(learner_title), genre=data.genre, prompt=data.vibe,
        language=data.language, device=data.device,
        model=model, reasoning_effort="medium" if data.deep_thinking else "low",
    )
    # The job needs the lesson's learning description (one cached mini call
    # on a component's first pick), so the card answers now and the build
    # starts as soon as the paragraph is in.
    work = _prepare_and_enqueue(
        game, data, inspirations=inspirations, learner_title=learner_title,
    )
    job = None
    if INLINE_BACKGROUND:
        job = await work
    else:
        _spawn(work)
    return JSONResponse(
        status_code=201,
        content={"game_id": game["_id"], "job_id": job["_id"] if job else None, "status": "queued"},
        headers=_NO_STORE,
    )


#: Tests flip this so a create finishes its preparation before answering
#: (TestClient cannot wait for a task on the app's loop).
INLINE_BACKGROUND = False
_background: set["asyncio.Task[Any]"] = set()


def _spawn(coro: Any) -> None:
    task = asyncio.create_task(coro)
    _background.add(task)
    task.add_done_callback(_background.discard)


async def _prepare_and_enqueue(
    game: dict[str, Any], data: CreateGameRequest, *,
    inspirations: list[str], learner_title: str,
) -> Optional[dict[str, Any]]:
    """Build the context (the learning description, cached or generated)
    and enqueue. Returns the job, or None when the game was marked failed."""
    game_id = str(game["_id"])
    try:
        return await jobs.enqueue(
            game, "create", genre=data.genre, vibe=data.vibe, inspirations=inspirations,
            clarifications=data.clarifications, language=data.language,
            device=data.device, learner_title=learner_title,
        )
    except Exception as exc:
        log.warning("game %s: prepare/enqueue failed: %s", game_id, type(exc).__name__)
        try:
            await store.update_status(game_id, "failed", errors_last=[{"message": f"enqueue_failed:{type(exc).__name__}"}])
        except Exception:
            pass
        return None


class PrepareRequest(BaseModel):
    component_id: str = Field(min_length=1, max_length=160)
    language: Language = "he"


@router.post("/prepare", status_code=202)
async def prepare_component(data: PrepareRequest, learner_id: str = Depends(require_learner)):
    """Warm a component's learning description while the kid writes the
    brief. Answers at once with whether it is cached; generation, if needed,
    runs behind (and the create that follows joins the same task)."""
    await kata_catalog.ensure_loaded()
    component = kata_catalog.get_component(data.component_id)
    if not component:
        raise HTTPException(status_code=404, detail="component_not_found")
    unit = kata_catalog.get_unit(str(component.get("unit_id") or ""))
    objective = kata_catalog.get_objective(
        str(component.get("objective_id") or (unit or {}).get("objective_id") or "")
    )
    text = await learning_descriptions.cached(
        data.component_id, data.language,
        fingerprint=learning_descriptions.fingerprint(component, unit, objective),
    )
    if text is None:
        _spawn(learning_descriptions.ensure_description(
            component, unit, objective, actor_id=learner_id, language=data.language,
        ))
    return JSONResponse(status_code=202, content={"ready": text is not None}, headers=_NO_STORE)


@router.get("/{game_id}")
async def read_game(
    game_id: str, lang: str = Query("he", max_length=5), learner_id: str = Depends(_reader),
    admin: bool = Depends(_admin_reader),
):
    game = await _owned_game(game_id, learner_id)
    await kata_catalog.ensure_loaded()
    last = await store.latest_job(game_id)
    return JSONResponse(content=_public_game(game, lang=lang, last_job=last, admin=admin), headers=_NO_STORE)


@router.get("/{game_id}/html")
async def read_game_html(
    game_id: str, v: Optional[int] = Query(None, ge=1), learner_id: str = Depends(_reader),
):
    """The game, with the serve-time harness. The bridge gets titles and the
    language only — the game carries its own questions and grades them in
    the page; nothing here knows an answer."""
    game = await _owned_game(game_id, learner_id)
    entry = store.version_entry(game, v)
    if entry is None:
        raise HTTPException(status_code=404, detail="version_not_found")
    harness = _harness_module()
    if harness is None:
        raise HTTPException(status_code=503, detail="harness_unavailable")

    try:
        html = await html_store.get_html(str(entry.get("blob_path") or entry.get("html_path") or ""))
    except html_store.HtmlStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
    if html is None:
        raise HTTPException(status_code=404, detail="html_not_found")

    await kata_catalog.ensure_loaded()
    language = str(game.get("language") or "he")
    component_id = str(game.get("component_id") or "")
    objective_id = str(game.get("objective_id") or "")
    component = kata_catalog.get_component(component_id) or {}
    objective = kata_catalog.get_objective(objective_id) or {}
    learn_data = {
        "component": {
            "id": component_id,
            "title": kata_catalog.component_title(component_id, language)
                     or str(component.get("title") or game.get("title") or ""),
        },
        "objective": {
            "id": objective_id,
            "title": kata_catalog.objective_title(objective_id, language)
                     or str(objective.get("title") or ""),
        },
        "language": language,
    }
    fragment = harness.build_harness(learn_data)
    return HTMLResponse(
        content=harness.inject_harness(html, fragment),
        headers={
            **_NO_STORE,
            "Content-Security-Policy": _GAME_CSP,
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "SAMEORIGIN",
        },
    )


@router.get("/{game_id}/live")
async def read_game_live(game_id: str, learner_id: str = Depends(_reader)):
    """Where the current build is: phase, how much thinking, the code so far.
    A page opened mid-build reads this once, then follows the realtime frames."""
    game = await _owned_game(game_id, learner_id)
    job = await store.latest_job(game_id)
    if not job or job.get("status") not in ("queued", "running"):
        return JSONResponse(content={"active": False}, headers=_NO_STORE)
    live = dict(job.get("live") or {})
    return JSONResponse(content={
        "active": True,
        "job_id": job["_id"],
        "kind": job.get("kind"),
        "started_at": job.get("started_at") or job.get("created_at"),
        "phase": live.get("phase") or "thinking",
        "thinking_chars": int(live.get("thinking_chars") or 0),
        "thinking_tail": str(live.get("thinking_tail") or ""),
        "code_len": int(live.get("code_len") or 0),
        "code_tail": str(live.get("code_tail") or ""),
        "updated_at": live.get("updated_at"),
    }, headers=_NO_STORE)


@router.get("/{game_id}/narration")
async def read_game_narration(game_id: str, learner_id: str = Depends(_reader)):
    """What Yuvi is doing right now, one short sentence per stretch of
    thinking, in the kid's language. Polled by the build page."""
    game = await _owned_game(game_id, learner_id)
    job = await store.latest_job(game_id)
    live = dict(job.get("live") or {}) if job and job.get("status") in ("queued", "running") else None
    result = await narration.narrate(game, live, actor_id=learner_id)
    return JSONResponse(content=result, headers=_NO_STORE)


@router.get("/{game_id}/thumb")
async def read_game_thumb(game_id: str, learner_id: str = Depends(_reader)):
    """The validator's screenshot of the current version — the card's tile."""
    game = await _owned_game(game_id, learner_id)
    key = str(game.get("thumb_blob_path") or "")
    if not key:
        raise HTTPException(status_code=404, detail="no_thumb")
    try:
        data = await html_store.get_bytes(key)
    except html_store.HtmlStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
    if not data:
        raise HTTPException(status_code=404, detail="no_thumb")
    return Response(content=data, media_type="image/png",
                    headers={"Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff"})


_ASK_SYSTEM = (
    "You are Yuvi (יובי), the game developer who built the kid's learning game. The kid asks about "
    "the game: how it works, why something happens, what a part of the code does, how to win. Answer "
    "from the GAME SOURCE only, in the kid's language ({lang}), warmly, in at most 4 short sentences. "
    "Never reveal correct answers to the learning questions, never reveal model names or vendors. "
    "If the kid wants a change, say they can send it as a change request in the same chat."
)


@router.post("/{game_id}/ask")
async def ask_about_game(game_id: str, data: AskRequest, learner_id: str = Depends(require_learner)):
    """A question about the game, answered without a rebuild (mini tier)."""
    game = await _owned_game(game_id, learner_id)
    entry = store.version_entry(game)
    if not entry:
        raise HTTPException(status_code=409, detail="game_busy")
    _refuse_if_flagged(data.question)
    try:
        html = await html_store.get_html(str(entry.get("blob_path") or entry.get("html_path") or ""))
    except html_store.HtmlStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
    source = (html or "")[:60_000]
    lang = str(game.get("language") or "he")
    answer = await call_llm(
        [
            {"role": "system", "content": _ASK_SYSTEM.format(lang=lang)},
            {"role": "user", "content": f"GAME TITLE: {game.get('title')}\n\nGAME SOURCE:\n{source}\n\nKID'S QUESTION: {data.question.strip()}"},
        ],
        usage_context=UsageContext(
            actor_id=learner_id, actor_type="learner", endpoint="internal:game_ask",
            feature="feature_7_learning_games", operation="game.ask", source="games.ask",
        ),
        max_tokens=400, model_tier="mini", timeout=40,
    )
    if not answer:
        raise HTTPException(status_code=503, detail="ask_unavailable")
    return JSONResponse(content={"answer": str(answer).strip()}, headers=_NO_STORE)


@router.post("/{game_id}/edit")
async def edit_game(game_id: str, data: EditRequest, learner_id: str = Depends(require_learner)):
    game = await _owned_game(game_id, learner_id)
    if game.get("status") != "ready" or not store.version_entry(game):
        raise HTTPException(status_code=409, detail="game_busy")
    _refuse_if_flagged(data.instruction)
    cap = (await budget.effective_caps(learner_id))["edit_per_day"]
    if await store.count_jobs_today(learner_id, "edit") >= cap:
        raise HTTPException(status_code=429, detail="daily_edit_cap")
    errors = [dict(error) for error in data.errors][:20]
    if errors:
        game = await store.update_status(game_id, "ready", errors_last=errors) or game
    try:
        job = await jobs.enqueue(game, "edit", instruction=data.instruction,
                                 runtime_errors=errors, version=int(game.get("current_version") or 0))
    except jobs.EnqueueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
    return JSONResponse(content={"job_id": job["_id"], "status": "queued"}, headers=_NO_STORE)


@router.post("/{game_id}/report-bug")
async def report_bug(game_id: str, data: BugReport, learner_id: str = Depends(require_learner)):
    """Runtime errors from the player → a fix job, at most two per version.

    The errors are stored on the game even when the cap refuses the job, so
    the card can still say what broke and a later edit starts from the truth.
    """
    game = await _owned_game(game_id, learner_id)
    if game.get("status") != "ready" or not store.version_entry(game):
        raise HTTPException(status_code=409, detail="game_busy")
    _refuse_if_flagged(data.note)
    v = int(game.get("current_version") or 0)
    errors = [dict(error) for error in data.errors][:20]
    if await store.count_fix_jobs_for_version(game_id, v) >= _FIX_JOBS_PER_VERSION:
        await store.update_status(game_id, "ready", errors_last=errors)
        raise HTTPException(status_code=429, detail="fix_cap_reached")
    game = await store.update_status(game_id, "ready", errors_last=errors) or game
    try:
        job = await jobs.enqueue(game, "fix", instruction=data.note,
                                 runtime_errors=errors, version=v)
    except jobs.EnqueueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
    return JSONResponse(content={"job_id": job["_id"], "status": "queued"}, headers=_NO_STORE)


@router.post("/{game_id}/revert")
async def revert_game(game_id: str, data: RevertRequest, learner_id: str = Depends(require_learner)):
    game = await _owned_game(game_id, learner_id)
    if game.get("status") not in ("ready", "failed"):
        raise HTTPException(status_code=409, detail="game_busy")
    try:
        updated = await store.set_current_version(game_id, data.v)
    except store.GameStoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    await kata_catalog.ensure_loaded()
    return JSONResponse(content=_public_game(updated), headers=_NO_STORE)


@router.delete("/{game_id}")
async def delete_game(game_id: str, learner_id: str = Depends(require_learner)):
    await _owned_game(game_id, learner_id)
    await store.soft_delete(game_id)
    return JSONResponse(content={"ok": True}, headers=_NO_STORE)
