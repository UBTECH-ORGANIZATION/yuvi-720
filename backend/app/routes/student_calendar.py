"""Session-owned, read-only learner calendar routes."""

from datetime import date

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from app.auth.dependencies import require_learner_session
from app.services import student_calendar


router = APIRouter(prefix="/api/calendar", tags=["calendar"])
_NO_STORE = {"Cache-Control": "private, no-store"}


@router.get("")
async def calendar_week(
    week: date | None = Query(default=None),
    session=Depends(require_learner_session),
):
    result = await student_calendar.get_week(session["sub"], week)
    return JSONResponse(content=result.model_dump(mode="json"), headers=_NO_STORE)


@router.get("/upcoming")
async def upcoming(
    limit: int = Query(default=3, ge=1, le=30),
    session=Depends(require_learner_session),
):
    result = await student_calendar.get_upcoming(session["sub"], limit)
    return JSONResponse(content=result.model_dump(mode="json"), headers=_NO_STORE)