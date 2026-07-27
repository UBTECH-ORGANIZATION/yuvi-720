"""Badge API — the learner's badges as a projection of the brain.

`GET /api/badges` returns the caller's own badges (no id in the URL).
`GET /api/badges/{learner_id}` is the teacher/authorized read, scoped like the
brain route. Both prime the Kata catalog so subject/objective titles resolve.
"""

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from app.auth.dependencies import assert_can_read_learner, current_user
from app.brain.repository import get_brain
from app.services import kata_catalog
from app.services.badges import project_badges
from app.services.events import get_learner_events
from learner_state import normalize_learner_id  # type: ignore

router = APIRouter(prefix="/api/badges", tags=["badges"])


async def _badges_for(learner_id: str, lang: str) -> list:
    await kata_catalog.ensure_loaded()
    brain = await get_brain(learner_id)
    try:
        events = await get_learner_events(learner_id)
    except Exception:
        events = []
    return project_badges(brain, locale=lang, events=events)


@router.get("")
async def read_own_badges(lang: str = Query("he"), actor: dict = Depends(current_user)):
    return JSONResponse(content=await _badges_for(actor["sub"], lang))


@router.get("/{learner_id}")
async def read_learner_badges(learner_id: str, lang: str = Query("he"), actor: dict = Depends(current_user)):
    safe_id = normalize_learner_id(learner_id)
    assert_can_read_learner(actor, safe_id)
    return JSONResponse(content=await _badges_for(safe_id, lang))
