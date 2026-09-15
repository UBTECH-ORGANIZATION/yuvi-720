"""Console routes — thin: authorize + delegate. The HTTP contract is identical
to Spark's former ``/api/admin`` and ``/api/admin/games`` routers.

Every route depends on the strict ``admin_required`` (never ``usage_access``),
so public-preview mode gets 401 everywhere. Guardrail refusals answer 409,
malformed input 400, both as ``{"error": code}`` with ``private, no-store``.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .games_budget import MAX_CAP, GamesBudget, GameStoreError, GamesStore
from .org_repository import OrgRepository
from .org_service import AdminError, OrgService, actor_id_for
from .users import UserRepository

_NO_STORE = {"Cache-Control": "private, no-store"}
_CONFLICTS = {
    "would_leave_group_unstaffed", "cannot_revoke_self",
    "cannot_remove_last_admin", "username_taken", "user_id_taken",
}


def _ok(content: Any) -> JSONResponse:
    return JSONResponse(content=content, headers=_NO_STORE)


def _failed(exc: AdminError) -> JSONResponse:
    status = 409 if exc.code in _CONFLICTS else 400
    return JSONResponse(content={"error": exc.code}, status_code=status, headers=_NO_STORE)


def _bad(code: str) -> JSONResponse:
    return JSONResponse(content={"error": code}, status_code=400, headers=_NO_STORE)


class CapsBody(BaseModel):
    create_per_day: int = Field(ge=0, le=MAX_CAP)
    edit_per_day: int = Field(ge=0, le=MAX_CAP)
    note: str = Field("", max_length=200)


class Console:
    """Per-request bundle of the services over one database handle."""

    def __init__(self, db: Any, admin: Dict[str, Any]) -> None:
        self.org = OrgRepository(db)
        self.users = UserRepository(db)
        self.service = OrgService(self.org, self.users)
        self.games = GamesBudget(GamesStore(db), self.users, self.org)
        self.actor_id = actor_id_for(admin)


def _job_row(job: Dict[str, Any], title: str) -> Dict[str, Any]:
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


def build_router(admin_required: Callable[..., Any], get_db: Callable[..., Any]) -> APIRouter:
    """``admin_required`` yields the signed-in administrator (``sub``/``email``);
    ``get_db`` yields the ``ConsoleDatabase`` (or a test stand-in)."""

    async def console(
        admin: Dict[str, Any] = Depends(admin_required), db: Any = Depends(get_db),
    ) -> Console:
        bundle = Console(db, admin)
        if not bundle.actor_id:
            raise HTTPException(status_code=401, detail="admin_authentication_required")
        return bundle

    router = APIRouter(prefix="/api/admin", tags=["console"])

    # ── overview ─────────────────────────────────────────────────────────────

    @router.get("/overview")
    async def read_overview(c: Console = Depends(console)):
        return _ok(await c.service.overview())

    # ── people + connections ─────────────────────────────────────────────────

    @router.get("/people")
    async def read_people(
        role: Optional[str] = Query(None, pattern="^(learner|teacher|admin)$"),
        q: Optional[str] = Query(None, max_length=80),
        c: Console = Depends(console),
    ):
        return _ok({"people": await c.service.people(role=role, query=q)})

    @router.get("/teachers/{teacher_id}/connections")
    async def read_teacher_connections(teacher_id: str, c: Console = Depends(console)):
        return _ok(await c.service.teacher_connections(teacher_id))

    @router.get("/learners/{learner_id}/connections")
    async def read_learner_connections(learner_id: str, c: Console = Depends(console)):
        return _ok(await c.service.learner_connections(learner_id))

    # ── org structure ────────────────────────────────────────────────────────

    @router.get("/org")
    async def read_org(c: Console = Depends(console)):
        return _ok({
            "schools": await c.org.list_schools(),
            "groups": await c.org.list_groups(active_only=False),
            "teacher_links": await c.org.list_teacher_links(),
            "enrollments": await c.org.list_enrollments(),
        })

    @router.post("/org/schools")
    async def upsert_school(data: dict, c: Console = Depends(console)):
        try:
            return _ok(await c.service.save_school(c.actor_id, data))
        except AdminError as exc:
            return _failed(exc)

    @router.post("/org/groups")
    async def upsert_group(data: dict, c: Console = Depends(console)):
        try:
            return _ok(await c.service.save_group(c.actor_id, data))
        except AdminError as exc:
            return _failed(exc)

    @router.post("/org/groups/{group_id}/archive")
    async def archive_group(group_id: str, c: Console = Depends(console)):
        try:
            return _ok(await c.service.archive_group(c.actor_id, group_id))
        except AdminError as exc:
            return _failed(exc)

    # ── connections: link / unlink / enroll / unenroll ───────────────────────

    @router.post("/org/teacher-links")
    async def link_teacher(data: dict, c: Console = Depends(console)):
        try:
            return _ok(await c.service.link_teacher(
                c.actor_id, (data.get("teacher_id") or "").strip(),
                (data.get("group_id") or "").strip(),
                data.get("link_role") or "teacher",
            ))
        except AdminError as exc:
            return _failed(exc)

    @router.post("/org/teacher-links/remove")
    async def unlink_teacher(data: dict, c: Console = Depends(console)):
        try:
            return _ok(await c.service.unlink_teacher(
                c.actor_id, (data.get("teacher_id") or "").strip(),
                (data.get("group_id") or "").strip(),
                confirm_unstaffed=bool(data.get("confirm_unstaffed")),
            ))
        except AdminError as exc:
            return _failed(exc)

    @router.post("/org/enrollments")
    async def enroll(data: dict, c: Console = Depends(console)):
        learner_ids = data.get("learner_ids")
        group_id = (data.get("group_id") or "").strip()
        try:
            if isinstance(learner_ids, list) and learner_ids:
                return _ok(await c.service.bulk_enroll(c.actor_id, group_id, learner_ids))
            return _ok(await c.service.enroll_learner(
                c.actor_id, (data.get("learner_id") or "").strip(), group_id
            ))
        except AdminError as exc:
            return _failed(exc)

    @router.post("/org/enrollments/remove")
    async def unenroll(data: dict, c: Console = Depends(console)):
        try:
            return _ok(await c.service.unenroll_learner(
                c.actor_id, (data.get("learner_id") or "").strip(),
                (data.get("group_id") or "").strip(),
            ))
        except AdminError as exc:
            return _failed(exc)

    # ── admin grants ─────────────────────────────────────────────────────────

    @router.get("/admins")
    async def list_admins(c: Console = Depends(console)):
        rows = [row for row in await c.org.list_admins() if row.get("active") is not False]
        return _ok({"admins": rows})

    @router.post("/admins")
    async def grant_admin(data: dict, c: Console = Depends(console)):
        try:
            return _ok(await c.service.grant_admin(
                c.actor_id, (data.get("user_id") or "").strip(),
                scope=data.get("scope") or "system",
                school_ids=data.get("school_ids") or [],
            ))
        except AdminError as exc:
            return _failed(exc)

    @router.post("/admins/revoke")
    async def revoke_admin(data: dict, c: Console = Depends(console)):
        try:
            return _ok(await c.service.revoke_admin(c.actor_id, (data.get("user_id") or "").strip()))
        except AdminError as exc:
            return _failed(exc)

    # ── accounts ─────────────────────────────────────────────────────────────

    @router.post("/users")
    async def create_user(data: dict, c: Console = Depends(console)):
        """Provision an account. The temp password is in the response ONCE."""
        try:
            return _ok(await c.service.create_user(c.actor_id, data))
        except AdminError as exc:
            return _failed(exc)

    # ── roster import ────────────────────────────────────────────────────────

    @router.post("/org/import")
    async def import_roster(data: dict, c: Console = Depends(console)):
        """Preview by default; pass ``commit: true`` to apply."""
        try:
            return _ok(await c.service.import_roster(
                c.actor_id, data.get("roster") or {}, commit=bool(data.get("commit")),
            ))
        except AdminError as exc:
            return _failed(exc)

    # ── audit ────────────────────────────────────────────────────────────────

    @router.get("/audit")
    async def read_audit(
        actor_id: Optional[str] = Query(None),
        target_id: Optional[str] = Query(None),
        limit: int = Query(100, ge=1, le=500),
        c: Console = Depends(console),
    ):
        return _ok({"entries": await c.org.list_audit(
            actor_id=actor_id, target_id=target_id, limit=limit
        )})

    # ── Learning Game Lab ────────────────────────────────────────────────────

    @router.get("/games/usage")
    async def read_games_usage(c: Console = Depends(console)):
        return _ok(await c.games.usage_report())

    @router.get("/games/jobs")
    async def read_games_jobs(
        limit: int = Query(200, ge=1, le=1000),
        since_hours: int = Query(168, ge=1, le=24 * 90),
        c: Console = Depends(console),
    ):
        jobs = await c.games.store.list_jobs_since(hours=since_hours, limit=limit)
        games = await c.games.store.get_games([str(job.get("game_id") or "") for job in jobs])
        return _ok({"items": [
            _job_row(job, str((games.get(str(job.get("game_id") or "")) or {}).get("title") or ""))
            for job in jobs
        ]})

    @router.post("/games/limits/defaults")
    async def write_games_defaults(body: CapsBody, c: Console = Depends(console)):
        try:
            caps = await c.games.set_defaults(
                c.actor_id, create_per_day=body.create_per_day, edit_per_day=body.edit_per_day,
            )
        except GameStoreError as exc:
            return _bad(str(exc))
        return _ok(caps)

    @router.post("/games/limits/{learner_id}")
    async def write_learner_games_caps(
        learner_id: str, body: CapsBody, c: Console = Depends(console),
    ):
        if learner_id.startswith("__"):
            return _bad("bad_learner")
        try:
            caps = await c.games.set_learner_caps(
                c.actor_id, learner_id, create_per_day=body.create_per_day,
                edit_per_day=body.edit_per_day, note=body.note,
            )
        except GameStoreError as exc:
            return _bad(str(exc))
        return _ok(caps)

    @router.post("/games/limits/{learner_id}/reset")
    async def reset_learner_games_caps(learner_id: str, c: Console = Depends(console)):
        return _ok(await c.games.clear_learner_caps(c.actor_id, learner_id))

    return router
