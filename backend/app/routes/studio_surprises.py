"""Learner-scoped weekly surprise data for Yuvi Studio."""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.auth.dependencies import require_learner
from app.services import studio_surprises

router = APIRouter(prefix="/api/studio", tags=["studio"])


@router.get("/weekly-surprise")
async def read_weekly_surprise(learner_id: str = Depends(require_learner)):
    return JSONResponse(content=await studio_surprises.get_weekly_surprise(learner_id))