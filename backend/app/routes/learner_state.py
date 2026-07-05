"""Learner state API routes."""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from learner_state import get_learner_state, normalize_learner_id, update_learner_state


router = APIRouter(prefix="/api", tags=["learner-state"])


@router.get("/learner-state")
async def read_learner_state(request: Request):
    """Return persisted learner UI state from MongoDB, with local fallback."""
    learner_id = normalize_learner_id(request.query_params.get("learner_id"))
    return JSONResponse(content=await get_learner_state(learner_id))


@router.patch("/learner-state")
async def patch_learner_state(data: dict):
    """Persist learner UI state such as language, mapping, profile, dashboard, or progress."""
    learner_id = normalize_learner_id(data.get("learner_id"))
    return JSONResponse(content=await update_learner_state(learner_id, data))