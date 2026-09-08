"""Learning Game Lab routes — a learner's own games, and nothing else.

Every route is learner-scoped through the session. The one widening is a
teacher (or admin) reading a learner's games with ``?learner=``, which goes
through ``assert_can_read_learner`` — the same org scoping every other
teacher read composes. Mutations are owner-only; a teacher can look at a
child's game but cannot spend the child's daily cap.

Three things this module is careful about:

**Answers never leave.** A game document has no context; the job payload
(which has the correct answers) is never returned; the picker (`/objectives`)
projects components down to id/title/question_count; and the served HTML gets
the harness WITHOUT an answer key, so grading is ``POST /check`` only.

**Caps are enforced before anything is written.** ``GAMES_DAILY_CREATE_CAP``
(3) and ``GAMES_DAILY_EDIT_CAP`` (10) per learner per UTC day, and at most two
fix jobs per version — a broken game that two repair rounds could not fix is
not going to be fixed by a third (§2.5).

**The harness is the worker's.** ``game_gen.harness`` is imported from
``<repo>/workers`` so the HTML served here is injected by exactly the code the
validator ran it under. The import is best-effort: without it the HTML route
answers 503 rather than serving a game without its bridge.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

from app.auth.dependencies import ROLE_LEARNER, assert_can_read_learner, current_user, require_learner
from app.services import content_filter, events, kata_catalog
from app.services.games import grading, html_store, jobs, store
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

_DEFAULT_CREATE_CAP = 3
_DEFAULT_EDIT_CAP = 10
_FIX_JOBS_PER_VERSION = 2


def _cap(name: str, default: int) -> int:
    try:
        return max(0, int(os.environ.get(name) or default))
    except ValueError:
        return default


def _harness_module():
    """``game_gen.harness`` + ``game_gen.context_pack`` from the worker package,
    or None when the package is not on this box."""
    if str(_WORKERS_DIR) not in sys.path and _WORKERS_DIR.exists():
        sys.path.insert(0, str(_WORKERS_DIR))
    try:
        from game_gen import context_pack, harness
    except Exception as exc:  # pragma: no cover - environment dependent
        log.warning("game harness unavailable: %s", type(exc).__name__)
        return None
    return harness, context_pack


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
    clarifications: dict[str, str] = Field(default_factory=dict)
    device: Device = "keyboard"
    language: Language = "he"
    deep_thinking: bool = False


class EditRequest(BaseModel):
    instruction: str = Field(min_length=1, max_length=600)
    # The player's single chat: what the kid wrote, plus whatever runtime
    # errors the frame reported meanwhile, so one message fixes and changes.
    errors: list[dict[str, Any]] = Field(default_factory=list, max_length=20)


class BugReport(BaseModel):
    errors: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    note: str = Field(default="", max_length=600)


class CheckRequest(BaseModel):
    question_id: str = Field(min_length=1, max_length=200)
    answer: int | str
    latency_ms: Optional[int] = Field(default=None, ge=0, le=3_600_000)


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


def _public_job(job: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Status and error class only. The payload holds the answers."""
    if not job:
        return None
    return {
        "job_id": job.get("_id"),
        "kind": job.get("kind"),
        "status": job.get("status"),
        "error_class": job.get("error_class"),
        "started_at": job.get("started_at"),
        "finished_at": job.get("finished_at"),
    }


def _public_game(game: dict[str, Any], *, lang: str = "he",
                 last_job: Optional[dict[str, Any]] = None) -> dict[str, Any]:
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
        "description": str(game.get("description") or ""),
        "created_at": game.get("created_at"),
        "updated_at": game.get("updated_at"),
        "last_job": _public_job(last_job),
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
):
    await kata_catalog.ensure_loaded()
    rows, next_cursor = await store.list_games(
        learner_id, component_id=component, objective_id=objective,
        cursor=cursor, limit=limit,
    )
    return JSONResponse(
        content={"games": [_public_game(row, lang=lang) for row in rows],
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
    rest of the subject catalog follows. Only components with gradeable
    questions are offered — a game needs something to gate progress on.
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
                count = jobs.gradeable_question_count(component)
                if count == 0:
                    continue
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
                    "question_count": count,
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
async def create_game(data: CreateGameRequest, learner_id: str = Depends(require_learner)):
    if data.genre not in jobs.GENRES:
        raise HTTPException(status_code=422, detail="bad_genre")
    inspirations = [chip for chip in data.inspirations if chip in jobs.INSPIRATIONS][:6]
    _refuse_if_flagged(" ".join([data.vibe, *data.clarifications.values()]))

    await kata_catalog.ensure_loaded()
    component = kata_catalog.get_component(data.component_id)
    if not component or jobs.gradeable_question_count(component) == 0:
        raise HTTPException(status_code=404, detail="component_not_found")
    if component.get("unit_id") and component["unit_id"] != data.unit_id:
        raise HTTPException(status_code=422, detail="unit_mismatch")

    cap = _cap("GAMES_DAILY_CREATE_CAP", _DEFAULT_CREATE_CAP)
    if await store.count_created_today(learner_id) >= cap:
        raise HTTPException(status_code=429, detail="daily_create_cap")

    title = (kata_catalog.component_title(data.component_id, data.language)
             or component.get("title") or data.component_id)
    game = await store.create_game(
        learner_id=learner_id, objective_id=data.objective_id, unit_id=data.unit_id,
        component_id=data.component_id, title=title, genre=data.genre, prompt=data.vibe,
        language=data.language, device=data.device,
    )
    try:
        job = await jobs.enqueue(
            game, "create", genre=data.genre, vibe=data.vibe, inspirations=inspirations,
            clarifications=data.clarifications, language=data.language,
            device=data.device, deep_thinking=data.deep_thinking,
        )
    except jobs.EnqueueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
    return JSONResponse(
        status_code=201,
        content={"game_id": game["_id"], "job_id": job["_id"], "status": "queued"},
        headers=_NO_STORE,
    )


@router.get("/{game_id}")
async def read_game(
    game_id: str, lang: str = Query("he", max_length=5), learner_id: str = Depends(_reader),
):
    game = await _owned_game(game_id, learner_id)
    await kata_catalog.ensure_loaded()
    last = await store.latest_job(game_id)
    return JSONResponse(content=_public_game(game, lang=lang, last_job=last), headers=_NO_STORE)


@router.get("/{game_id}/html")
async def read_game_html(
    game_id: str, v: Optional[int] = Query(None, ge=1), learner_id: str = Depends(_reader),
):
    """The game, with the serve-time harness and WITHOUT an answer key."""
    game = await _owned_game(game_id, learner_id)
    entry = store.version_entry(game, v)
    if entry is None:
        raise HTTPException(status_code=404, detail="version_not_found")
    modules = _harness_module()
    if modules is None:
        raise HTTPException(status_code=503, detail="harness_unavailable")
    harness, context_pack = modules

    try:
        html = await html_store.get_html(str(entry.get("blob_path") or entry.get("html_path") or ""))
    except html_store.HtmlStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
    if html is None:
        raise HTTPException(status_code=404, detail="html_not_found")

    await kata_catalog.ensure_loaded()
    component = kata_catalog.get_component(str(game.get("component_id") or "")) or {
        "id": game.get("component_id"), "title": game.get("title"),
    }
    unit = kata_catalog.get_unit(str(game.get("unit_id") or ""))
    objective = kata_catalog.get_objective(str(game.get("objective_id") or ""))
    pack, _key = context_pack.build_context_pack(
        component, unit, objective,
        language=str(game.get("language") or "he"), device=str(game.get("device") or "keyboard"),
    )
    # `answer_key` deliberately absent: the bridge grades through /check.
    fragment = harness.build_harness(pack.to_learn_data())
    return HTMLResponse(
        content=harness.inject_harness(html, fragment),
        headers={
            **_NO_STORE,
            "Content-Security-Policy": _GAME_CSP,
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "SAMEORIGIN",
        },
    )


@router.post("/{game_id}/edit")
async def edit_game(game_id: str, data: EditRequest, learner_id: str = Depends(require_learner)):
    game = await _owned_game(game_id, learner_id)
    if game.get("status") != "ready" or not store.version_entry(game):
        raise HTTPException(status_code=409, detail="game_busy")
    _refuse_if_flagged(data.instruction)
    cap = _cap("GAMES_DAILY_EDIT_CAP", _DEFAULT_EDIT_CAP)
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


@router.post("/{game_id}/check")
async def check_answer(game_id: str, data: CheckRequest, learner_id: str = Depends(require_learner)):
    game = await _owned_game(game_id, learner_id)
    try:
        result = await grading.grade(game, data.question_id, data.answer, latency_ms=data.latency_ms)
    except grading.GradingError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    return JSONResponse(content={**result, "feedback": None}, headers=_NO_STORE)


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
