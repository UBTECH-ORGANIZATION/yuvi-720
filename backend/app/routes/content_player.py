"""The Yuvilab lomda player — our own content, served as a standalone document.

This is the runtime for everything we author ourselves (English). It is
deliberately the ONLY surface in the product that authenticates from a launch
token instead of the session cookie, because that is what makes it embeddable:
a 720 platform can drop ``/content/player/{component}?slxapi=…`` into an iframe
with no Yuvilab session at all, and the page renders content and nothing else —
no dashboard, no navigation, no app chrome (נספח 1 §5).

Three endpoints:
  * ``GET  /content/player/{component_id}``          — the shell (carries no content)
  * ``GET  /content/player/{component_id}/payload``  — what to render, keys stripped
  * ``POST /content/player/{component_id}/answer``   — grade one answer server-side

Answer keys never reach the browser. Progress reporting is xAPI, exactly as for
an external provider: the page posts to the ``slxapi`` endpoint it was launched
with, which is our own ingest.
"""

from __future__ import annotations

import os
import re
from typing import Any, Optional

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from app.core.paths import ENGLISH_PLAYER_DIR
from app.services import native_content
from app.services.events import verify_launch

router = APIRouter(prefix="/content/player", tags=["content"])

_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,159}$")
_DEFAULT_FRAME_ANCESTORS = "'self'"


def _frame_ancestors() -> str:
    """Who may frame the player. Only this route relaxes framing."""
    configured = (os.environ.get("CONTENT_FRAME_ANCESTORS") or "").strip()
    return f"{_DEFAULT_FRAME_ANCESTORS} {configured}".strip() if configured else _DEFAULT_FRAME_ANCESTORS


def _embeddable(response):
    response.headers["Content-Security-Policy"] = f"frame-ancestors {_frame_ancestors()}"
    # A legacy deny header would out-rank the CSP in older browsers.
    if "x-frame-options" in response.headers:
        del response.headers["x-frame-options"]
    return response


def _launch_for(request: Request, component_id: str) -> Optional[dict[str, Any]]:
    """The launch this request is authorized by, or None.

    Scope is checked as well as signature: a valid token for ANOTHER component
    must not open this one.
    """
    header = request.headers.get("authorization") or ""
    if not header.startswith("Basic "):
        return None
    payload = verify_launch(header[len("Basic "):].strip())
    if payload is None or payload.get("cmp") != component_id:
        return None
    return payload


def _unauthorized() -> JSONResponse:
    return JSONResponse(content={"error": "invalid_or_expired_launch"}, status_code=401)


def _public_question(question: dict[str, Any]) -> dict[str, Any]:
    """A question as the learner may see it — no key, no per-answer feedback."""
    return {
        "questionId": str(question.get("questionId") or ""),
        "questionType": str(question.get("questionType") or ""),
        "questionText": question.get("questionText") or "",
        "answers": list(question.get("answers") or []),
    }


def _public_item(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id"),
        "title": item.get("title"),
        "contentType": item.get("contentType"),
        "mediaFormat": item.get("mediaFormat"),
        "presentation": item.get("presentation") or {},
        "questions": [_public_question(q) for q in item.get("questions") or []],
    }


async def _resume_item(learner_id: str, component_id: str) -> Optional[str]:
    """Where this learner stopped inside THIS component (720 §1.7).

    Position is written by the player's own xAPI, so a mid-task close and a
    reopen land on the same screen without any extra bookkeeping.
    """
    try:
        from app.brain.repository import get_brain

        state = (await get_brain(learner_id)).get("current_state") or {}
    except Exception as exc:  # a resume failure must never block the lesson
        print(f"⚠️ resume lookup skipped: {type(exc).__name__}")
        return None
    if state.get("component_id") != component_id:
        return None
    item_id = state.get("item_id")
    return str(item_id) if item_id else None


@router.get("/{component_id}")
async def player_shell(component_id: str):
    """The player document. Holds no content — the payload call does."""
    index = ENGLISH_PLAYER_DIR / "index.html"
    if not _ID_PATTERN.fullmatch(component_id or ""):
        return JSONResponse(content={"error": "invalid_component_id"}, status_code=422)
    if not index.exists():
        return JSONResponse(content={"error": "player_not_built"}, status_code=503)
    return _embeddable(FileResponse(index, media_type="text/html"))


@router.get("/{component_id}/payload")
async def player_payload(component_id: str, request: Request, lang: str = "he"):
    launch = _launch_for(request, component_id)
    if launch is None:
        return _unauthorized()
    resolved = await native_content.get_raw_component(component_id, launch.get("unit"))
    if not resolved:
        return JSONResponse(content={"error": "content_not_found"}, status_code=404)
    unit, component = resolved

    from app.core.localization import normalize_language

    return _embeddable(JSONResponse(content={
        "language": normalize_language(lang),
        "unit": {
            "id": unit.get("id"),
            "title": unit.get("title"),
            "titles": unit.get("titleTranslations") or {},
            "objectiveId": unit.get("learningObjective"),
        },
        "component": {
            "id": component.get("id"),
            "title": component.get("title"),
            "purpose": component.get("componentPurpose"),
            "isAssessment": bool(component.get("isAssessment")),
            "estimatedMinutes": component.get("estimatedTimeInMinutes"),
        },
        "items": [_public_item(item) for item in component.get("subContent") or []],
        "resume": {"itemId": await _resume_item(launch["lid"], component_id)},
    }))


class AnswerRequest(BaseModel):
    itemId: str = Field(max_length=180)
    questionId: str = Field(max_length=80)
    response: str = Field(default="", max_length=2000)


def _normalize(text: str) -> str:
    return " ".join(str(text or "").strip().casefold().split())


@router.post("/{component_id}/answer")
async def player_answer(component_id: str, data: AnswerRequest, request: Request):
    """Grade one answer. The key stays on the server; the learner gets words."""
    launch = _launch_for(request, component_id)
    if launch is None:
        return _unauthorized()
    resolved = await native_content.get_raw_component(component_id, launch.get("unit"))
    if not resolved:
        return JSONResponse(content={"error": "content_not_found"}, status_code=404)
    _unit, component = resolved

    question = next(
        (
            q
            for item in component.get("subContent") or []
            if str(item.get("id")) == data.itemId
            for q in item.get("questions") or []
            if str(q.get("questionId")) == data.questionId
        ),
        None,
    )
    if question is None:
        return JSONResponse(content={"error": "question_not_found"}, status_code=404)

    keys = {_normalize(value) for value in question.get("correctAnswers") or []}
    correct = _normalize(data.response) in keys if keys else None
    feedback = question.get("feedback") or {}
    return _embeddable(JSONResponse(content={
        "correct": correct,
        # 720 §feedback: effort-based, action-specific, and it explains the
        # error — never a score, and never the answer itself.
        "feedback": feedback.get("correct" if correct else "incorrect") or {},
    }))
