"""What a teacher can do about a disclosure.

Thin, like every teacher route: authorize against the learner, delegate to
`app.services.wellbeing`, report nothing the caller did not earn.

Two things are stricter here than elsewhere, because of what these rows are:

* **Every write re-checks the learner scope**, not just the read. A flag id is
  guessable-ish, and "who may act on a child's disclosure" is not a question to
  answer from the id alone.
* **A suggestion is never an action.** `/suggest` returns words for the teacher
  to read and edit. Nothing on this router sends a message to a child, and the
  model is never given the ability to close a flag or write a log entry.
"""

from typing import Any, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.auth.dependencies import require_teacher_session
from app.brain import org
from app.core.localization import normalize_language
from app.services import wellbeing
from app.services.wellbeing import WellbeingError
from learner_state import normalize_learner_id  # type: ignore

router = APIRouter(prefix="/api/teacher", tags=["teacher"])

_NO_STORE = {"Cache-Control": "private, no-store"}

#: A bad body is the caller's fault; anything else refuses as a scope problem,
#: so "no such flag" and "not your student" stay indistinguishable.
_BAD_REQUEST = {"unknown_reason", "unknown_action", "already_closed"}


def _ok(content: Any) -> JSONResponse:
    return JSONResponse(content=content, headers=_NO_STORE)


def _denied() -> JSONResponse:
    return JSONResponse(content={"error": "forbidden"}, status_code=403, headers=_NO_STORE)


def _failed(error: WellbeingError) -> JSONResponse:
    code = str(error)
    if code in _BAD_REQUEST:
        return JSONResponse(content={"error": code}, status_code=400, headers=_NO_STORE)
    return _denied()


async def _may_read(session: dict, learner_id: str) -> Optional[str]:
    safe_id = normalize_learner_id(learner_id)
    if not await org.teacher_can_access_learner(session["sub"], safe_id):
        return None
    return safe_id


async def _flag_in_scope(session: dict, flag_id: str) -> Optional[dict[str, Any]]:
    """The flag, only if this teacher teaches the child it is about."""
    flag = await wellbeing.get(flag_id)
    if flag is None:
        return None
    if not await org.teacher_can_access_learner(session["sub"], str(flag.get("learner_id") or "")):
        return None
    return flag


class LogRequest(BaseModel):
    kind: str = Field(max_length=40)
    text: str = Field(default="", max_length=wellbeing.MAX_TEXT)


class CloseRequest(BaseModel):
    reason: str = Field(max_length=40)
    note: str = Field(default="", max_length=wellbeing.MAX_TEXT)


class SuggestRequest(BaseModel):
    #: Which decision the teacher is standing in front of: "message" (what to
    #: say to the child), "handle" (what to do), "close" (how to write it up).
    intent: str = Field(max_length=20)


@router.get("/student/{learner_id}/wellbeing")
async def list_flags(learner_id: str, session=Depends(require_teacher_session)) -> JSONResponse:
    safe_id = await _may_read(session, learner_id)
    if safe_id is None:
        return _denied()
    flags = await wellbeing.list_for_learner(safe_id)
    return _ok({"flags": flags, "close_reasons": list(wellbeing.CLOSE_REASONS),
                "action_kinds": list(wellbeing.ACTION_KINDS)})


@router.post("/wellbeing/{flag_id}/acknowledge")
async def acknowledge(flag_id: str, session=Depends(require_teacher_session)) -> JSONResponse:
    if await _flag_in_scope(session, flag_id) is None:
        return _denied()
    try:
        return _ok({"flag": await wellbeing.acknowledge(flag_id, session["sub"])})
    except WellbeingError as error:
        return _failed(error)


@router.post("/wellbeing/{flag_id}/log")
async def log_action(flag_id: str, body: LogRequest,
                     session=Depends(require_teacher_session)) -> JSONResponse:
    if await _flag_in_scope(session, flag_id) is None:
        return _denied()
    try:
        flag = await wellbeing.log_action(flag_id, session["sub"],
                                          kind=body.kind, text=body.text)
        return _ok({"flag": flag})
    except WellbeingError as error:
        return _failed(error)


@router.post("/wellbeing/{flag_id}/close")
async def close(flag_id: str, body: CloseRequest,
                session=Depends(require_teacher_session)) -> JSONResponse:
    if await _flag_in_scope(session, flag_id) is None:
        return _denied()
    try:
        return _ok({"flag": await wellbeing.close(flag_id, session["sub"],
                                                  reason=body.reason, note=body.note)})
    except WellbeingError as error:
        return _failed(error)


@router.post("/wellbeing/{flag_id}/reopen")
async def reopen(flag_id: str, session=Depends(require_teacher_session)) -> JSONResponse:
    if await _flag_in_scope(session, flag_id) is None:
        return _denied()
    try:
        return _ok({"flag": await wellbeing.reopen(flag_id, session["sub"])})
    except WellbeingError as error:
        return _failed(error)


@router.post("/wellbeing/{flag_id}/suggest")
async def suggest(flag_id: str, body: SuggestRequest,
                  session=Depends(require_teacher_session)) -> JSONResponse:
    """Words to start from, for a teacher who has just read something hard.

    Advisory and editable. The response also carries a fixed, non-generated line
    pointing at the school's own protocol — that sentence is too important to
    let a model phrase differently every time.
    """
    flag = await _flag_in_scope(session, flag_id)
    if flag is None:
        return _denied()
    from app.services import wellbeing_assist

    language = normalize_language(str(flag.get("language") or "he"))
    result = await wellbeing_assist.suggest(
        flag, intent=body.intent, language=language, teacher_id=session["sub"],
    )
    return _ok(result)
