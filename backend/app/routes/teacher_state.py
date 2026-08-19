"""A teacher's own UI state. Read it, patch it — nothing else.

Scoped to the session and only the session: there is no learner id here and no
teacher id in the path, so there is nothing to authorize beyond "you are a
teacher". A teacher can only ever read and write their own row.
"""

from typing import Any, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.auth.dependencies import require_teacher_session
from app.services import teacher_state as store

router = APIRouter(prefix="/api/teacher", tags=["teacher"])

_NO_STORE = {"Cache-Control": "private, no-store"}


def _ok(content: Any) -> JSONResponse:
    return JSONResponse(content=content, headers=_NO_STORE)


class TeacherStatePatch(BaseModel):
    """`None` clears the draft; omitting the field leaves it alone."""

    mentoring_draft: Optional[Any] = None


@router.get("/state")
async def read_state(session=Depends(require_teacher_session)):
    return _ok(await store.get_teacher_state(session["sub"]))


@router.patch("/state")
async def patch_state(patch: TeacherStatePatch, session=Depends(require_teacher_session)):
    """Save the teacher's in-progress mentoring write-up.

    Called on a debounce while they type, so it has to be cheap and it has to
    be bounded — see `MAX_DRAFT_BYTES`. An oversized draft is refused rather
    than truncated: half a teacher's notes stored silently is worse than a
    save that says it failed.
    """
    try:
        state = await store.update_teacher_state(
            session["sub"],
            # `exclude_unset` so a PATCH that does not mention the draft cannot
            # blank it — `None` has to be sent on purpose to clear it.
            patch.model_dump(exclude_unset=True),
        )
    except store.TeacherStateError as exc:
        return JSONResponse(content={"error": exc.code}, status_code=400, headers=_NO_STORE)
    return _ok(state)
