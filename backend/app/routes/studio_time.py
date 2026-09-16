"""Authenticated time-budget endpoints for Yuvi Studio."""

from fastapi import APIRouter, Depends

from app.auth.dependencies import require_learner
from app.services.studio_time import enter_studio, leave_studio, studio_time_status


router = APIRouter(prefix="/api/studio-time", tags=["studio-time"])


@router.get("")
async def get_studio_time(learner_id: str = Depends(require_learner)):
    return await studio_time_status(learner_id)


@router.post("/enter")
async def post_studio_enter(learner_id: str = Depends(require_learner)):
    return await enter_studio(learner_id)


@router.post("/leave")
async def post_studio_leave(learner_id: str = Depends(require_learner)):
    return await leave_studio(learner_id)