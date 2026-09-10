"""Admin control over the Learning Game Lab: who spent what, the daily caps,
and the job ledger (model, effort, timings, judge) the bake-off reads.

Same shape as ``admin_org``: every route behind ``require_admin``, thin
handlers, all rules in ``app.services.games.budget``. Caps are counts per UTC
day (creates and edits); cost is reported, never charged. The job listing
never returns a payload — the context is the worker's, not a report's.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.auth.dependencies import require_admin
from app.services.games import budget, store
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


def _job_row(job: dict[str, Any], title: str) -> dict[str, Any]:
    return {
        "job_id": job.get("_id"),
        "game_id": job.get("game_id"),
        "learner_id": job.get("learner_id"),
        "kind": job.get("kind"),
        "status": job.get("status"),
        "model": job.get("model"),
        "reasoning_effort": job.get("reasoning_effort"),
        "started_at": job.get("started_at"),
        "finished_at": job.get("finished_at"),
        "error_class": job.get("error_class"),
        "usage_summary": job.get("usage_summary"),
        "timings": job.get("timings"),
        "attempts_detail": job.get("attempts_detail"),
        "judge": job.get("judge"),
        "title": title,
    }


@router.get("/jobs")
async def read_jobs(
    limit: int = Query(200, ge=1, le=1000),
    since_hours: int = Query(168, ge=1, le=24 * 90),
    _: str = Depends(require_admin),
):
    """Every learner's jobs in the window, newest first, with the game's
    title — the raw rows behind ``games_report.py``'s per-model table."""
    jobs = await store.list_jobs_since(hours=since_hours, limit=limit)
    games = await store.get_games([str(job.get("game_id") or "") for job in jobs])
    return _ok({"items": [
        _job_row(job, str((games.get(str(job.get("game_id") or "")) or {}).get("title") or ""))
        for job in jobs
    ]})


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
