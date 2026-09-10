"""Learner room-community routes with group-scoped, private sharing."""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.auth.dependencies import require_learner
from app.services import room_community


router = APIRouter(prefix="/api/community", tags=["room-community"])
_NO_STORE = {"Cache-Control": "private, no-store"}


class SharingUpdate(BaseModel):
    shared: bool


def _ok(content: object) -> JSONResponse:
    return JSONResponse(content=content, headers=_NO_STORE)


def _not_found() -> JSONResponse:
    return JSONResponse(content={"error": "not_found"}, status_code=404, headers=_NO_STORE)


@router.get("/rooms")
async def list_community_rooms(learner_id: str = Depends(require_learner)):
    return _ok(await room_community.list_rooms(learner_id))


@router.get("/rooms/{owner_id}")
async def get_community_room(owner_id: str, learner_id: str = Depends(require_learner)):
    try:
        room = await room_community.get_room(learner_id, owner_id)
    except ValueError:
        room = None
    return _ok(room) if room is not None else _not_found()


@router.get("/room-sharing")
async def get_room_sharing(learner_id: str = Depends(require_learner)):
    return _ok(await room_community.sharing_settings(learner_id))


@router.patch("/room-sharing")
async def update_room_sharing(
    update: SharingUpdate, learner_id: str = Depends(require_learner)
):
    return _ok(await room_community.set_sharing(learner_id, update.shared))


@router.put("/rooms/{owner_id}/like")
async def like_room(owner_id: str, learner_id: str = Depends(require_learner)):
    try:
        result = await room_community.set_like(learner_id, owner_id)
    except ValueError:
        return _not_found()
    return _ok(result)


@router.delete("/rooms/{owner_id}/like")
async def remove_room_like(
    owner_id: str, learner_id: str = Depends(require_learner)
):
    try:
        result = await room_community.remove_like(learner_id, owner_id)
    except ValueError:
        return _not_found()
    return _ok(result)
