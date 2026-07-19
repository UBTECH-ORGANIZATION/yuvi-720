"""Grounded learner-profile summary and verification routes."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth.dependencies import require_learner
from app.core.localization import normalize_language
from app.services.profile_summary import apply_profile_feedback, generate_profile_summary


router = APIRouter(prefix="/api", tags=["profile"])


class ProfileSummaryRequest(BaseModel):
    # No learner_id: identity is derived from the session, never the body.
    language: str = Field(default="he", max_length=5)


class ProfileFeedbackRequest(ProfileSummaryRequest):
    source_id: str = Field(min_length=3, max_length=120)
    verdict: Literal["accurate", "unsure", "inaccurate"]


@router.post("/profile-summary")
async def profile_summary(
    data: ProfileSummaryRequest,
    learner_id: str = Depends(require_learner),
) -> dict:
    """Phrase only evidence-backed Brain fields for learner verification (F2/F3)."""
    language = normalize_language(data.language)
    return await generate_profile_summary(learner_id, language)


@router.post("/profile-feedback")
async def profile_feedback(
    data: ProfileFeedbackRequest,
    learner_id: str = Depends(require_learner),
) -> dict[str, bool | str]:
    """Record whether Yuvi understood a claim so future behavior can adapt."""
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
