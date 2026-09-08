"""Admin control over the Learning Game Lab: who spent what, and the daily caps.

Same shape as ``admin_org``: every route behind ``require_admin``, thin
handlers, all rules in ``app.services.games.budget``. Caps are counts per UTC
day (creates and edits); cost is reported, never charged.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.auth.dependencies import require_admin
from app.services.games import budget
from app.services.games.store import GameStoreError

router = APIRouter(prefix="/api/admin/games", tags=["admin"])

_NO_STORE = {"Cache-Control": "private, no-store"}


def _ok(content: Any) -> JSONResponse:
    return JSONResponse(content=content, headers=_NO_STORE)


def _failed(exc: GameStoreError) -> JSONResponse:
    return JSONResponse(content={"error": str(exc)}, status_code=400, headers=_NO_STORE)


class CapsBody(BaseModel):
    create_per_day: int = Field(ge=0, le=budget.MAX_CAP)
    edit_per_day: int = Field(ge=0, le=budget.MAX_CAP)
    note: str = Field("", max_length=200)


@router.get("/usage")
async def read_usage(_: str = Depends(require_admin)):
    return _ok(await budget.usage_report())


@router.post("/limits/defaults")
async def write_defaults(body: CapsBody, actor_id: str = Depends(require_admin)):
    try:
        caps = await budget.set_defaults(
            actor_id, create_per_day=body.create_per_day, edit_per_day=body.edit_per_day,
        )
    except GameStoreError as exc:
        return _failed(exc)
    return _ok(caps)


@router.post("/limits/{learner_id}")
async def write_learner_caps(learner_id: str, body: CapsBody, actor_id: str = Depends(require_admin)):
    if learner_id.startswith("__"):
        return JSONResponse(content={"error": "bad_learner"}, status_code=400, headers=_NO_STORE)
    try:
        caps = await budget.set_learner_caps(
            actor_id, learner_id, create_per_day=body.create_per_day,
            edit_per_day=body.edit_per_day, note=body.note,
        )
    except GameStoreError as exc:
        return _failed(exc)
    return _ok(caps)


@router.post("/limits/{learner_id}/reset")
async def reset_learner_caps(learner_id: str, actor_id: str = Depends(require_admin)):
    return _ok(await budget.clear_learner_caps(actor_id, learner_id))
