"""Grounded learner-profile summary and verification routes."""

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.localization import normalize_language
from app.services.profile_summary import apply_profile_feedback, generate_profile_summary
from learner_state import normalize_learner_id


router = APIRouter(prefix="/api", tags=["profile"])


class ProfileSummaryRequest(BaseModel):
    learner_id: str = Field(default="demo-learner", max_length=120)
    language: str = Field(default="he", max_length=5)


class ProfileFeedbackRequest(ProfileSummaryRequest):
    source_id: str = Field(min_length=3, max_length=120)
    verdict: Literal["accurate", "unsure", "inaccurate"]


@router.post("/profile-summary")
async def profile_summary(data: ProfileSummaryRequest) -> dict:
    """Phrase only evidence-backed Brain fields for learner verification (F2/F3)."""
    learner_id = normalize_learner_id(data.learner_id)
    language = normalize_language(data.language)
    return await generate_profile_summary(learner_id, language)


@router.post("/profile-feedback")
async def profile_feedback(data: ProfileFeedbackRequest) -> dict[str, bool | str]:
    """Record whether Yuvi understood a claim so future behavior can adapt."""
    learner_id = normalize_learner_id(data.learner_id)
    language = normalize_language(data.language)
    applied = await apply_profile_feedback(
        learner_id,
        data.source_id,
        data.verdict,
        language,
    )
    if not applied:
        raise HTTPException(status_code=404, detail="profile_claim_not_found")
    return {"ok": True, "verdict": data.verdict}
