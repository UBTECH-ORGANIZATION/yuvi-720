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

**Caps are enforced before anything is written.** Creates and edits per
learner per UTC day come from ``budget.effective_caps`` (an admin override, the
admin defaults, or the ``GAMES_DAILY_*_CAP`` env values), and at most two
fix jobs per version — a broken game that two repair rounds could not fix is
not going to be fixed by a third (§2.5).

**The harness is the worker's.** ``game_gen.harness`` is imported from
``<repo>/workers`` so the HTML served here is injected by exactly the code the
validator ran it under. The import is best-effort: without it the HTML route
answers 503 rather than serving a game without its bridge.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse, Response
from pydantic import BaseModel, Field

from app.auth.dependencies import ROLE_LEARNER, assert_can_read_learner, current_user, require_learner
from app.services import content_filter, events, kata_catalog
from app.services.llm import call_llm
from app.services.ai_usage import UsageContext
from app.services.games import blueprints, budget, distractors, grading, html_store, instances, jobs, narration, store
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
    # The kid's own name for the game. When given it stays; otherwise the
    # model titles the game and the card shows the component name until then.
    title: str = Field(default="", max_length=40)
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


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=600)


class CheckRequest(BaseModel):
    question_id: str = Field(min_length=1, max_length=200)
    answer: int | str
    latency_ms: Optional[int] = Field(default=None, ge=0, le=3_600_000)


class NextRequest(BaseModel):
    """One draw of a blueprint game: the run (a fresh id per play-through)
    and the question index inside it."""
    run_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_\-]+$")
    index: int = Field(ge=0, le=200)


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
        "question_mode": str(game.get("question_mode") or "legacy"),
        "question_total": int(game.get("question_total") or 0),
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

    cap = (await budget.effective_caps(learner_id))["create_per_day"]
    if await store.count_created_today(learner_id) >= cap:
        raise HTTPException(status_code=429, detail="daily_create_cap")

    learner_title = " ".join(data.title.split())[:40]
    title = learner_title or (kata_catalog.component_title(data.component_id, data.language)
                              or component.get("title") or data.component_id)
    game = await store.create_game(
        learner_id=learner_id, objective_id=data.objective_id, unit_id=data.unit_id,
        component_id=data.component_id, title=title, title_by_learner=bool(learner_title), genre=data.genre, prompt=data.vibe,
        language=data.language, device=data.device, question_mode="blueprints",
    )
    # Questions come from blueprints (generated once per component, cached):
    # every run draws fresh instances with the context the kid needs. The
    # first pick of a component means a model call, so the card answers now
    # and the build starts as soon as the blueprints are in.
    work = _prepare_and_enqueue(
        game, component, data, inspirations=inspirations, learner_title=learner_title, learner_id=learner_id,
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
    game: dict[str, Any], component: dict[str, Any], data: CreateGameRequest, *,
    inspirations: list[str], learner_title: str, learner_id: str,
) -> Optional[dict[str, Any]]:
    """Blueprints first, then the job. Returns the job, or None when the game
    was marked failed instead."""
    game_id = str(game["_id"])
    try:
        docs = await blueprints.ensure_blueprints(
            component, kata_catalog.get_unit(data.unit_id), kata_catalog.get_objective(data.objective_id),
            actor_id=learner_id, language=data.language,
        )
        usable_count = len(blueprints.usable(docs))
        if usable_count == 0:
            log.warning("game %s: no answerable questions for %s", game_id, data.component_id)
            await store.update_status(game_id, "failed", errors_last=[{"message": "no_answerable_questions"}])
            return None
        game = await store.update_game(game_id, question_total=blueprints.run_total(usable_count)) or game
        return await jobs.enqueue(
            game, "create", genre=data.genre, vibe=data.vibe, inspirations=inspirations,
            clarifications=data.clarifications, language=data.language,
            device=data.device, deep_thinking=data.deep_thinking,
            learner_title=learner_title,
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


@router.post("/prepare", status_code=202)
async def prepare_component(data: PrepareRequest, learner_id: str = Depends(require_learner)):
    """Warm a component's blueprints while the kid writes the brief. Answers
    at once with what is cached; generation, if needed, runs behind."""
    await kata_catalog.ensure_loaded()
    component = kata_catalog.get_component(data.component_id)
    if not component:
        raise HTTPException(status_code=404, detail="component_not_found")
    docs = await blueprints.cached_for_component(data.component_id, blueprints.profile_fingerprint(component))
    if not docs:
        unit = kata_catalog.get_unit(str(component.get("unit_id") or ""))
        objective = kata_catalog.get_objective(str((unit or {}).get("objective_id") or component.get("objective_id") or ""))
        _spawn(blueprints.ensure_blueprints(component, unit, objective, actor_id=learner_id))
    return JSONResponse(status_code=202, content={"ready": bool(docs), "usable": len(blueprints.usable(docs))}, headers=_NO_STORE)


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
    # The same options the build saw (cached distractors), and typed questions
    # only for games whose code renders an input box.
    component = await distractors.enrich_component(component, actor_id=learner_id)
    pack, _key = context_pack.build_context_pack(
        component, unit, objective,
        language=str(game.get("language") or "he"), device=str(game.get("device") or "keyboard"),
        typed="text" in (game.get("question_kinds") or []),
    )
    # `answer_key` deliberately absent: the bridge grades through /check.
    learn_data = pack.to_learn_data()
    if game.get("question_mode") == "blueprints":
        # No questions in the page: the bridge asks `/next` for each draw.
        learn_data = {
            "mode": "blueprints", "total": int(game.get("question_total") or 0),
            "language": learn_data.get("language"), "component": learn_data.get("component"),
            "objective": learn_data.get("objective"), "questions": [],
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


@router.post("/{game_id}/check")
async def check_answer(game_id: str, data: CheckRequest, learner_id: str = Depends(require_learner)):
    game = await _owned_game(game_id, learner_id)
    try:
        if instances.is_instance_id(data.question_id):
            result = await instances.grade(game, data.question_id, data.answer, latency_ms=data.latency_ms)
        else:
            result = await grading.grade(game, data.question_id, data.answer, latency_ms=data.latency_ms)
    except (grading.GradingError, instances.InstanceError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    return JSONResponse(content={**result, "feedback": None}, headers=_NO_STORE)


@router.post("/{game_id}/next")
async def next_question(game_id: str, data: NextRequest, learner_id: str = Depends(require_learner)):
    """The next question of a blueprint game: a fresh instance (text, options,
    figure) whose answer stays here. `null` past the end of the run."""
    game = await _owned_game(game_id, learner_id)
    if game.get("question_mode") != "blueprints":
        raise HTTPException(status_code=409, detail="not_a_blueprint_game")
    try:
        question = await instances.next_instance(game, run_id=data.run_id, index=data.index)
    except instances.InstanceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
    return JSONResponse(content={"question": question}, headers=_NO_STORE)


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
