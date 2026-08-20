"""Approved provider catalog and signed learning-session routes."""

from __future__ import annotations

import asyncio
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth.dependencies import require_learner, require_teacher
from app.services import kata_client as content_provider
from app.services.learning_sessions import create_provider_session
from app.services.learning_progress import project_unit_roadmap
from app.services.learning_timing import summarize_session
from app.services.lesson_illustrations import find_for_lesson, localized_alt, public_metadata
from app.services.events import get_session_events, verify_launch


router = APIRouter(prefix="/api/learning", tags=["learning-catalog"])

# The provider's units, briefly held per language. Every dashboard visit was
# re-fetching the summary page plus every unit detail from CET over fresh TLS
# connections — most of this route's ~2s, paid for content that changes only
# on an import. Five minutes matches the staleness the kata_catalog snapshot
# already accepts. Projection stays per-request (it is the personalized part),
# and `project_unit_roadmap` deep-copies before projecting, so the cached
# units are never written to.
_UNITS_TTL_SECONDS = 300.0
_units_cache: dict[str, tuple[float, list[dict]]] = {}


async def _units_for(lang: str) -> list[dict]:
    import time

    held = _units_cache.get(lang)
    if held and (time.monotonic() - held[0]) < _UNITS_TTL_SECONDS:
        return held[1]
    units = await content_provider.list_units(language=lang)
    _units_cache[lang] = (time.monotonic(), units)
    return units


def reset_units_cache_for_tests() -> None:
    _units_cache.clear()


class LearningSessionRequest(BaseModel):
    # No learner_id: the session is always minted for the session learner.
    component_id: str = Field(min_length=1, max_length=160)
    unit_id: Optional[str] = Field(default=None, max_length=160)
    language: Literal["he", "ar", "en"] = "he"
    # 720 §6 explicit "redo the component" on re-entry after completion: a fresh
    # attempt that resets our coach thread + one-shot hint state. Default is
    # resume/continuity (never reset on an ordinary relaunch).
    restart: bool = False


@router.get("/catalog")
async def read_catalog(lang: str = "he", learner_id: str = Depends(require_learner)) -> dict:
    """Return provider-owned units and components through Spark's stable facade.

    The learner comes from the session cookie only (a client-supplied
    learner_id is never accepted). Each unit carries the cached AI lesson
    illustration (read-only; never generated here) so the dashboard can render
    a topic visual per lesson, localized by ``lang``.

    Every unit is projected through the ONE path engine, so its ordinals, totals
    and next step are the same ones the lesson flow and the launch gate use.
    """
    try:
        from app.services import kata_catalog
        await kata_catalog.ensure_loaded()
        units = await _units_for(lang)

        async def _project(unit: dict) -> dict:
            roadmap = await project_unit_roadmap(unit, learner_id, locale=lang)
            # The ministry's own names for where this unit sits (נושא → תת נושא).
            # The client used to map the dotted key through a hand-written table,
            # which could only ever cover the keys someone had already seen.
            goal = kata_catalog.get_objective(unit.get("objective_id") or "") or {}
            roadmap["sub_topic_title"] = goal.get("title") or ""
            roadmap["topic_title"] = goal.get("topic_title") or ""
            # A paragraph of real pedagogy ("…ימדדו מסת מוצקים במאזני כפות/זרוע…").
            # Not for display — it is what lets the card pick an illustration that
            # matches the lesson instead of a generic one per subject.
            roadmap["goal_description"] = goal.get("description") or ""
            roadmap["illustration"] = await _unit_illustration(roadmap, lang)
            # Per-item bot notes + question snapshots (with correct answers) are
            # server-only coach context; keep them off the client payload — the
            # aggregate ``information_to_bot`` stays for DTO parity.
            for component in roadmap.get("components") or []:
                component.pop("information_by_item", None)
                component.pop("questions_by_item", None)
            return roadmap

        # The per-unit reads (this learner's unit events, brain, illustration)
        # are independent of each other; awaiting them one unit at a time made
        # this route ~2s on a real account — the dashboard's "recent lessons"
        # rail visibly trailing the page. Concurrency, not caching: the payload
        # stays identical, order included (gather preserves it).
        units = list(await asyncio.gather(*(_project(unit) for unit in units)))
    except content_provider.ContentProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.code) from exc
    return {
        "source": "kata",
        "provider_status": "online",
        "units": units,
    }


async def _unit_illustration(unit: dict, lang: str) -> Optional[dict]:
    """Return cached illustration metadata for a unit, or ``None`` when absent."""
    asset = await find_for_lesson(
        unit.get("objective_id"),
        unit.get("current_component_id") or unit.get("next_component_id"),
    )
    if not asset:
        return None
    meta = public_metadata(asset, lang)
    meta["alt"] = localized_alt(lang, unit.get("title") or "", unit.get("subject") or "")
    return meta


@router.post("/sessions")
async def create_learning_session(
    data: LearningSessionRequest,
    request: Request,
    learner_id: str = Depends(require_learner),
) -> dict:
    """Validate approved content and mint an absolute cross-origin xAPI launch."""
    try:
        return await create_provider_session(
            learner_id,
            data.component_id,
            unit_id=data.unit_id,
            language=data.language,
            request_base_url=str(request.base_url),
            restart=data.restart,
        )
    except content_provider.ContentProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.code) from exc


class PathChoiceRequest(BaseModel):
    component_id: str = Field(min_length=1, max_length=160)
    choice: Literal["more_practice"]


@router.post("/path-choice")
async def record_path_choice(
    data: PathChoiceRequest, learner_id: str = Depends(require_learner),
) -> dict:
    """The learner asking for work their route had dropped (720 §1 פעלנות)."""
    from app.services import kata_catalog
    from app.services.events import record_path_choice as store
    await kata_catalog.ensure_loaded()
    component = kata_catalog.get_component(data.component_id) or {}
    await store(learner_id, data.component_id, component.get("unit_id"), data.choice)
    return {"ok": True}


@router.get("/units/{unit_id}/path")
async def explain_unit_path(
    unit_id: str,
    learner: str,
    lang: str = "he",
    teacher_id: str = Depends(require_teacher),
) -> dict:
    """Why this learner's path looks the way it does — teachers only.

    The learner's own payload carries reason *codes* and nothing else (§2: levels
    are internal, and no numeric score is shown). This is the other half: the
    band, the EWMA, the failing event id — the evidence behind each decision, for
    a teacher who needs to understand or challenge the route.
    """
    unit, _ = await content_provider.resolve_component(f"{unit_id}-01", unit_id)
    return await project_unit_roadmap(unit, learner, locale=lang, explain=True)


@router.get("/sessions/{session_id}/timing")
async def read_session_timing(
    session_id: str,
    authorization: Optional[str] = Header(default=None),
) -> dict:
    """Return transparent wall-clock timing evidence for one signed launch."""
    if not authorization or not authorization.startswith("Basic "):
        raise HTTPException(status_code=401, detail="invalid_launch_authorization")
    launch = verify_launch(authorization.removeprefix("Basic ").strip())
    if launch is None or launch.get("sid") != session_id:
        raise HTTPException(status_code=401, detail="invalid_launch_authorization")
    events = await get_session_events(launch["lid"], session_id)
    return summarize_session(events, session_id)
