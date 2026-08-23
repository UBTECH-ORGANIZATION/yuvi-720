"""The daily feelings check-in (#452) — the learner's own lane only.

Every route resolves the learner from the session (no learner_id parameter),
answers `private, no-store`, and the flow service owns every rule: the school-
day boundary, idempotent creation, the feelings vocabulary, PII scrubbing.
`GET /pending` is deliberately cheap (no LLM, no event scan beyond the flow's
own gate) because it runs on every learner page load of the day.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from app.auth.dependencies import require_learner
from app.services import checkin_flow

router = APIRouter(prefix="/api/me/checkin", tags=["checkin"])

_NO_STORE = {"Cache-Control": "private, no-store"}


class StartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    language: Literal["he", "ar", "en"] = "he"


class AnswerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question_id: str = Field(min_length=1, max_length=40)
    answer: str = Field(max_length=2000)


class FeelingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    valence: str = Field(min_length=1, max_length=20)
    feeling: str = Field(min_length=1, max_length=40)
    language: Literal["he", "ar", "en"] = "he"


class SkipRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    steps: list[str] = Field(default_factory=list, max_length=8)


def _refused(error: checkin_flow.CheckinError) -> HTTPException:
    code = str(error)
    return HTTPException(status_code=404 if code == "checkin_not_found" else 422,
                         detail=code)


@router.get("/pending")
async def pending(
    response: Response, learner_id: str = Depends(require_learner)
) -> dict[str, Any]:
    response.headers.update(_NO_STORE)
    return {"due": await checkin_flow.is_due(learner_id)}


@router.post("/start")
async def start(
    data: StartRequest, response: Response, learner_id: str = Depends(require_learner)
) -> dict[str, Any]:
    response.headers.update(_NO_STORE)
    doc = await checkin_flow.start(learner_id, data.language)
    return checkin_flow.public_view(doc)


@router.post("/{checkin_id}/answer")
async def answer(
    checkin_id: str, data: AnswerRequest, response: Response,
    learner_id: str = Depends(require_learner),
) -> dict[str, Any]:
    response.headers.update(_NO_STORE)
    try:
        doc = await checkin_flow.record_answer(
            checkin_id, learner_id, data.question_id, data.answer)
    except checkin_flow.CheckinError as error:
        raise _refused(error) from error
    return checkin_flow.public_view(doc)


@router.post("/{checkin_id}/feeling")
async def feeling(
    checkin_id: str, data: FeelingRequest, response: Response,
    learner_id: str = Depends(require_learner),
) -> dict[str, Any]:
    """Performs the durable writes and returns `{closing_line}` — bailing
    before the closing screen still counts."""
    response.headers.update(_NO_STORE)
    try:
        doc = await checkin_flow.record_feeling(
            checkin_id, learner_id, data.valence, data.feeling, data.language)
    except checkin_flow.CheckinError as error:
        raise _refused(error) from error
    return checkin_flow.public_view(doc)


@router.post("/{checkin_id}/skip")
async def skip(
    checkin_id: str, data: SkipRequest, response: Response,
    learner_id: str = Depends(require_learner),
) -> dict[str, Any]:
    response.headers.update(_NO_STORE)
    try:
        doc = await checkin_flow.record_skip(checkin_id, learner_id, data.steps)
    except checkin_flow.CheckinError as error:
        raise _refused(error) from error
    return checkin_flow.public_view(doc)


@router.post("/{checkin_id}/complete")
async def complete(
    checkin_id: str, response: Response, learner_id: str = Depends(require_learner),
) -> dict[str, Any]:
    response.headers.update(_NO_STORE)
    try:
        doc = await checkin_flow.complete(checkin_id, learner_id)
    except checkin_flow.CheckinError as error:
        raise _refused(error) from error
    return checkin_flow.public_view(doc)
