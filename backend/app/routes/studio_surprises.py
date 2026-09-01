"""Learner-scoped weekly surprise data for Yuvi Studio."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from app.auth.dependencies import require_learner
from app.services import studio_surprises

router = APIRouter(prefix="/api/studio", tags=["studio"])


@router.get("/weekly-surprise")
async def read_weekly_surprise(learner_id: str = Depends(require_learner)):
    return JSONResponse(content=await studio_surprises.get_weekly_surprise(learner_id))


@router.post("/weekly-surprise/claim")
async def claim_weekly_surprise(learner_id: str = Depends(require_learner)):
    try:
        return JSONResponse(content=await studio_surprises.claim_weekly_surprise(learner_id))
    except studio_surprises.SurpriseClaimError as exc:
        raise HTTPException(status_code=409, detail=exc.code) from exc


@router.get("/surprise-rewards")
async def read_claimed_surprise_rewards(learner_id: str = Depends(require_learner)):
    return JSONResponse(content={"items": await studio_surprises.claimed_reward_kinds(learner_id)})