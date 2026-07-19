"""Learner state API routes.

The learner id comes from the session cookie only — a client-supplied
`learner_id` in the query string or body is ignored.
"""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.auth.dependencies import require_learner
from learner_state import get_learner_state, update_learner_state


router = APIRouter(prefix="/api", tags=["learner-state"])


@router.get("/learner-state")
async def read_learner_state(learner_id: str = Depends(require_learner)):
    """Return persisted learner UI state from MongoDB, with local fallback."""
    return JSONResponse(content=await get_learner_state(learner_id))


@router.patch("/learner-state")
async def patch_learner_state(data: dict, learner_id: str = Depends(require_learner)):
    """Persist learner UI state such as language, mapping, profile, dashboard, or progress."""
    return JSONResponse(content=await update_learner_state(learner_id, data))
