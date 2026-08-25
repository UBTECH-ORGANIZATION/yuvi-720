"""Sub-group routes — name a slice of a class, and reuse it.

Thin by design: every one of these authorizes through the parent group and then
delegates to `app.services.subgroups`. There is no new permission model here,
which is the point — a sub-group is a label on learners the teacher can already
see, never a way to reach one they cannot.

Refusals are deliberately indistinguishable. A group belonging to another
teacher and a group that does not exist both return the same 403: which one it
was is not information this teacher is entitled to.
"""

from typing import Any, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from app.auth.dependencies import require_teacher_session
from app.services import subgroups as subgroup_service
from app.services.subgroups import MAX_MEMBERS, MAX_NAME, SubgroupError

router = APIRouter(prefix="/api/teacher", tags=["teacher"])

_NO_STORE = {"Cache-Control": "private, no-store"}

#: Which refusals are the caller's fault rather than a permission problem.
_BAD_REQUEST = {
    "name_required", "name_taken", "no_members_in_group", "too_many_subgroups",
}


def _ok(content: Any) -> JSONResponse:
    return JSONResponse(content=content, headers=_NO_STORE)


def _failed(error: SubgroupError) -> JSONResponse:
    code = str(error)
    if code == "not_found":
        # Same body as a scope refusal: "no such sub-group" and "not yours"
        # must not be tellable apart from the outside.
        return JSONResponse(content={"error": "forbidden"}, status_code=403, headers=_NO_STORE)
    status = 400 if code in _BAD_REQUEST else 403
    return JSONResponse(
        content={"error": "forbidden" if status == 403 else code},
        status_code=status, headers=_NO_STORE,
    )


class CreateSubgroupRequest(BaseModel):
    name: str = Field(max_length=MAX_NAME)
    learner_ids: list[str] = Field(default_factory=list, max_length=MAX_MEMBERS)


class UpdateSubgroupRequest(BaseModel):
    name: Optional[str] = Field(default=None, max_length=MAX_NAME)
    learner_ids: Optional[list[str]] = Field(default=None, max_length=MAX_MEMBERS)


@router.get("/groups/{group_id}/subgroups")
async def list_subgroups(group_id: str, session=Depends(require_teacher_session)):
    """This class's named slices, with membership as of right now."""
    try:
        return _ok({"subgroups": await subgroup_service.list_for_group(session["sub"], group_id)})
    except SubgroupError as error:
        return _failed(error)


@router.post("/groups/{group_id}/subgroups")
async def create_subgroup(
    group_id: str, payload: CreateSubgroupRequest, session=Depends(require_teacher_session),
):
    try:
        return _ok(await subgroup_service.create(
            session["sub"], group_id, name=payload.name, learner_ids=payload.learner_ids,
        ))
    except SubgroupError as error:
        return _failed(error)


@router.patch("/subgroups/{subgroup_id}")
async def update_subgroup(
    subgroup_id: str, payload: UpdateSubgroupRequest, session=Depends(require_teacher_session),
):
    try:
        return _ok(await subgroup_service.update(
            session["sub"], subgroup_id, name=payload.name, learner_ids=payload.learner_ids,
        ))
    except SubgroupError as error:
        return _failed(error)


@router.delete("/subgroups/{subgroup_id}")
async def delete_subgroup(subgroup_id: str, session=Depends(require_teacher_session)):
    """Archived, never deleted — a goal assigned to it keeps its referent."""
    try:
        return _ok(await subgroup_service.archive(session["sub"], subgroup_id))
    except SubgroupError as error:
        return _failed(error)


# ── addressing a sub-group ───────────────────────────────────────────────────
# The messages screen could write to one child at a time, which made "tell the
# six who are stuck that we are going over it on Thursday" six identical sends.
# These two routes are the group-addressed version — see
# `direct_messages.send_to_subgroup` for why it fans out rather than opening a
# shared room.


class SubgroupMessageRequest(BaseModel):
    text: str = Field(max_length=1000)
    language: Optional[str] = None


@router.get("/subgroups/{subgroup_id}/messages")
async def list_subgroup_messages(
    subgroup_id: str, session=Depends(require_teacher_session),
):
    """What this teacher has already said to this group, oldest first."""
    from app.services import direct_messages

    try:
        # Authorization is the read this line performs, not a separate check:
        # a teacher who may not see the group cannot get its member list.
        await subgroup_service.members_of(session["sub"], subgroup_id)
    except SubgroupError as error:
        return _failed(error)
    return _ok({"broadcasts": await direct_messages.list_subgroup_broadcasts(
        session["sub"], subgroup_id)})


@router.post("/subgroups/{subgroup_id}/messages")
async def send_subgroup_message(
    subgroup_id: str, payload: SubgroupMessageRequest,
    session=Depends(require_teacher_session),
):
    """Say one thing to everyone in the group. Screened before anybody has it."""
    from app.core.localization import normalize_language
    from app.services import direct_messages

    try:
        result = await direct_messages.send_to_subgroup(
            teacher_id=session["sub"],
            subgroup_id=subgroup_id,
            text=payload.text,
            language=normalize_language(payload.language),
        )
    except direct_messages.DirectMessageError as exc:
        # Same contract as the 1:1 send: `detail` is a STRING for a moderation
        # refusal, which is how the client tells it apart from FastAPI's own 422.
        return JSONResponse(content={"detail": exc.code},
                            status_code=exc.status_code, headers=_NO_STORE)
    return _ok(result)


class SubgroupKudosRequest(BaseModel):
    message: str = Field(max_length=400)
    language: Optional[str] = None
    # Optional gift (#467). Validated against the wallet's allowed set rather
    # than a range: a teacher picks from three buttons, so anything else is a
    # malformed request.
    sparks: int = 0
    draft_id: Optional[str] = Field(default=None, max_length=120)

    @field_validator("sparks")
    @classmethod
    def _allowed_amount(cls, value: int) -> int:
        from app.services import rewards

        if value and not rewards.is_teacher_spark_amount(value):
            raise ValueError("sparks must be one of "
                             f"{list(rewards.TEACHER_SPARK_AMOUNTS)}")
        return value


@router.post("/subgroups/{subgroup_id}/kudos")
async def send_subgroup_kudos(
    subgroup_id: str, payload: SubgroupKudosRequest,
    session=Depends(require_teacher_session),
):
    """One good word — and optionally one gift each — to a whole group (#467).

    Fans out per child so membership and both screens are re-checked per
    recipient; see `kudos.send_kudos_to_subgroup`.
    """
    from app.core.localization import normalize_language
    from app.services import kudos as kudos_service

    try:
        result = await kudos_service.send_kudos_to_subgroup(
            session["sub"], subgroup_id, payload.message,
            language=normalize_language(payload.language),
            sparks=payload.sparks,
            draft_id=payload.draft_id,
        )
    except kudos_service.KudosError as exc:
        status = 403 if exc.code == "not_authorized" else 400
        return JSONResponse(content={"error": exc.code},
                            status_code=status, headers=_NO_STORE)
    return _ok(result)
