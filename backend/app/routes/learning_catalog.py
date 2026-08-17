"""Approved provider catalog and signed learning-session routes."""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth.dependencies import require_learner, require_teacher
from app.services import content_providers as content_provider
from app.services.learning_sessions import create_provider_session
from app.services.learning_progress import project_unit_roadmap
from app.services.learning_timing import summarize_session
from app.services.lesson_illustrations import find_for_lesson, localized_alt, public_metadata
from app.services.events import get_session_events, verify_launch


router = APIRouter(prefix="/api/learning", tags=["learning-catalog"])


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
        units = await content_provider.list_units(language=lang)
        projected = []
        for unit in units:
            roadmap = await project_unit_roadmap(unit, learner_id, locale=lang)
            # The ministry's own names for where this unit sits (נושא → תת נושא).
            # The client used to map the dotted key through a hand-written table,
            # which could only ever cover the keys someone had already seen.
            goal = kata_catalog.get_objective(unit.get("objective_id") or "") or {}
            # The registry holds every locale at once, so the label is picked
            # here — otherwise a Hebrew learner reads the goal's English key.
            roadmap["sub_topic_title"] = (goal.get("titles") or {}).get(lang) or goal.get("title") or ""
            roadmap["topic_title"] = goal.get("topic_title") or ""
            # A paragraph of real pedagogy ("…ימדדו מסת מוצקים במאזני כפות/זרוע…").
            # Not for display — it is what lets the card pick an illustration that
            # matches the lesson instead of a generic one per subject.
            roadmap["goal_description"] = goal.get("description") or ""
            roadmap["cefr"] = _localized_cefr(goal.get("cefr") or {}, lang)
            roadmap["alignment"] = _localized_alignment(goal.get("alignment") or {}, lang)
            roadmap["illustration"] = await _unit_illustration(roadmap, lang)
            # Per-item bot notes + question snapshots (with correct answers) are
            # server-only coach context; keep them off the client payload — the
            # aggregate ``information_to_bot`` stays for DTO parity.
            for component in roadmap.get("components") or []:
                component.pop("information_by_item", None)
                component.pop("questions_by_item", None)
            projected.append(roadmap)
        units = projected
    except content_provider.ContentProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.code) from exc
    return {
        "source": "kata",
        "provider_status": "online",
        "units": units,
    }


def _localized_cefr(cefr: dict, lang: str) -> Optional[dict]:
    """The goal's CEFR level + its Can-Do descriptor in the learner's language.

    Curriculum information, not a mastery level: it says what the GOAL is
    written against, never how far this learner got (720 §2).
    """
    if not cefr:
        return None
    can_do = cefr.get("canDo") or {}
    return {
        "level": cefr.get("level"),
        "stretch": cefr.get("stretch"),
        "mode": cefr.get("mode"),
        "scale": cefr.get("scale"),
        "reference": cefr.get("reference"),
        "can_do": can_do.get(lang) or can_do.get("he") or can_do.get("en") or "",
    }


def _localized_alignment(alignment: dict, lang: str) -> Optional[dict]:
    """Where this goal sits in the national curriculum, and what it rehearses."""
    if not alignment:
        return None
    moe = alignment.get("moe") or {}
    domain_title = moe.get("domainTitle") or {}
    return {
        "curriculum": moe.get("curriculum"),
        "band": moe.get("band"),
        "domain": moe.get("domain"),
        "domain_title": domain_title.get(lang) or domain_title.get("he") or moe.get("domain") or "",
        "exams": alignment.get("exams") or [],
        "national": alignment.get("national") or [],
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
