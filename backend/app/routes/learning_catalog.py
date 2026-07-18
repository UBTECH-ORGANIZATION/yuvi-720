"""Approved provider catalog and signed learning-session routes."""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.services import content_provider
from app.services.learning_sessions import create_provider_session
from app.services.learning_progress import project_unit_roadmap
from app.services.learning_timing import summarize_session
from app.services.lesson_illustrations import find_for_lesson, localized_alt, public_metadata
from app.services.events import get_session_events, verify_launch
from learner_state import normalize_learner_id  # type: ignore


router = APIRouter(prefix="/api/learning", tags=["learning-catalog"])


class LearningSessionRequest(BaseModel):
    learner_id: str = Field(default="demo-learner", max_length=120)
    component_id: str = Field(min_length=1, max_length=160)
    unit_id: Optional[str] = Field(default=None, max_length=160)
    language: Literal["he", "ar", "en"] = "he"


@router.get("/catalog")
async def read_catalog(learner_id: str = "demo-learner", lang: str = "he") -> dict:
    """Return provider-owned units and components through Spark's stable facade.

    Each unit carries the cached AI lesson illustration (read-only; never
    generated here) so the dashboard can render a topic visual per lesson.
    """
    try:
        units = await content_provider.list_units()
        safe_learner_id = normalize_learner_id(learner_id)
        projected = []
        for unit in units:
            roadmap = await project_unit_roadmap(unit, safe_learner_id)
            roadmap["illustration"] = await _unit_illustration(roadmap, lang)
            projected.append(roadmap)
        units = projected
    except content_provider.ContentProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.code) from exc
    return {
        "source": "content_provider",
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
async def create_learning_session(data: LearningSessionRequest, request: Request) -> dict:
    """Validate approved content and mint an absolute cross-origin xAPI launch."""
    try:
        return await create_provider_session(
            normalize_learner_id(data.learner_id),
            data.component_id,
            unit_id=data.unit_id,
            language=data.language,
            request_base_url=str(request.base_url),
        )
    except content_provider.ContentProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.code) from exc


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
