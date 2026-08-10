"""Admin control plane routes (F8) — thin: authorize + delegate.

Every route sits behind `require_admin`, which checks BOTH the JWT role and a
live `org_admins` grant, so a revoked admin is locked out on the next request.
All guardrails and the audit trail live in `app.services.admin_org`.

This is the control plane only. The admin *dashboard* is the ordinary teacher
app with the group switcher unlocked — one implementation, no drift.
"""

from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from app.auth.dependencies import require_admin
from app.services import admin_org, org_repository
from app.services.admin_org import AdminError

router = APIRouter(prefix="/api/admin", tags=["admin"])

_NO_STORE = {"Cache-Control": "private, no-store"}


def _ok(content: Any) -> JSONResponse:
    return JSONResponse(content=content, headers=_NO_STORE)


def _failed(exc: AdminError) -> JSONResponse:
    # 409 for a guardrail refusal (the request was well-formed, the state says
    # no), 400 for malformed input.
    conflicts = {
        "would_leave_group_unstaffed", "cannot_revoke_self",
        "cannot_remove_last_admin", "username_taken", "user_id_taken",
    }
    status = 409 if exc.code in conflicts else 400
    return JSONResponse(content={"error": exc.code}, status_code=status, headers=_NO_STORE)


# ── overview ─────────────────────────────────────────────────────────────────

@router.get("/overview")
async def read_overview(_: str = Depends(require_admin)):
    return _ok(await admin_org.overview())


# ── people + connections ─────────────────────────────────────────────────────

@router.get("/people")
async def read_people(
    role: Optional[str] = Query(None, pattern="^(learner|teacher|admin)$"),
    q: Optional[str] = Query(None, max_length=80),
    _: str = Depends(require_admin),
):
    return _ok({"people": await admin_org.people(role=role, query=q)})


@router.get("/teachers/{teacher_id}/connections")
async def read_teacher_connections(teacher_id: str, _: str = Depends(require_admin)):
    return _ok(await admin_org.teacher_connections(teacher_id))


@router.get("/learners/{learner_id}/connections")
async def read_learner_connections(learner_id: str, _: str = Depends(require_admin)):
    return _ok(await admin_org.learner_connections(learner_id))


# ── org structure ────────────────────────────────────────────────────────────

@router.get("/org")
async def read_org(_: str = Depends(require_admin)):
    return _ok({
        "schools": await org_repository.list_schools(),
        "groups": await org_repository.list_groups(active_only=False),
        "teacher_links": await org_repository.list_teacher_links(),
        "enrollments": await org_repository.list_enrollments(),
    })


@router.post("/org/schools")
async def upsert_school(data: dict, actor_id: str = Depends(require_admin)):
    try:
        return _ok(await admin_org.save_school(actor_id, data))
    except AdminError as exc:
        return _failed(exc)


@router.post("/org/groups")
async def upsert_group(data: dict, actor_id: str = Depends(require_admin)):
    try:
        return _ok(await admin_org.save_group(actor_id, data))
    except AdminError as exc:
        return _failed(exc)


@router.post("/org/groups/{group_id}/archive")
async def archive_group(group_id: str, actor_id: str = Depends(require_admin)):
    """Archive, never delete — history must stay resolvable."""
    try:
        return _ok(await admin_org.archive_group(actor_id, group_id))
    except AdminError as exc:
        return _failed(exc)


# ── connections: link / unlink / enroll / unenroll ───────────────────────────

@router.post("/org/teacher-links")
async def link_teacher(data: dict, actor_id: str = Depends(require_admin)):
    try:
        return _ok(await admin_org.link_teacher(
            actor_id, (data.get("teacher_id") or "").strip(),
            (data.get("group_id") or "").strip(),
            data.get("link_role") or "teacher",
        ))
    except AdminError as exc:
        return _failed(exc)


@router.post("/org/teacher-links/remove")
async def unlink_teacher(data: dict, actor_id: str = Depends(require_admin)):
    """Deactivates the link. 409 `would_leave_group_unstaffed` unless the caller
    passes `confirm_unstaffed` — those learners would otherwise become invisible
    to every teacher at once, silently."""
    try:
        return _ok(await admin_org.unlink_teacher(
            actor_id, (data.get("teacher_id") or "").strip(),
            (data.get("group_id") or "").strip(),
            confirm_unstaffed=bool(data.get("confirm_unstaffed")),
        ))
    except AdminError as exc:
        return _failed(exc)


@router.post("/org/enrollments")
async def enroll(data: dict, actor_id: str = Depends(require_admin)):
    learner_ids = data.get("learner_ids")
    group_id = (data.get("group_id") or "").strip()
    try:
        if isinstance(learner_ids, list) and learner_ids:
            return _ok(await admin_org.bulk_enroll(actor_id, group_id, learner_ids))
        return _ok(await admin_org.enroll_learner(
            actor_id, (data.get("learner_id") or "").strip(), group_id
        ))
    except AdminError as exc:
        return _failed(exc)


@router.post("/org/enrollments/remove")
async def unenroll(data: dict, actor_id: str = Depends(require_admin)):
    try:
        return _ok(await admin_org.unenroll_learner(
            actor_id, (data.get("learner_id") or "").strip(),
            (data.get("group_id") or "").strip(),
        ))
    except AdminError as exc:
        return _failed(exc)


# ── admin grants ─────────────────────────────────────────────────────────────

@router.get("/admins")
async def list_admins(_: str = Depends(require_admin)):
    rows = [row for row in await org_repository.list_admins() if row.get("active") is not False]
    return _ok({"admins": rows})


@router.post("/admins")
async def grant_admin(data: dict, actor_id: str = Depends(require_admin)):
    try:
        return _ok(await admin_org.grant_admin(
            actor_id, (data.get("user_id") or "").strip(),
            scope=data.get("scope") or "system",
            school_ids=data.get("school_ids") or [],
        ))
    except AdminError as exc:
        return _failed(exc)


@router.post("/admins/revoke")
async def revoke_admin(data: dict, actor_id: str = Depends(require_admin)):
    try:
        return _ok(await admin_org.revoke_admin(actor_id, (data.get("user_id") or "").strip()))
    except AdminError as exc:
        return _failed(exc)


# ── accounts ─────────────────────────────────────────────────────────────────

@router.post("/users")
async def create_user(data: dict, actor_id: str = Depends(require_admin)):
    """Provision an account. The temp password is in the response ONCE."""
    try:
        return _ok(await admin_org.create_user(actor_id, data))
    except AdminError as exc:
        return _failed(exc)


# ── roster import ────────────────────────────────────────────────────────────

@router.post("/org/import")
async def import_roster(data: dict, actor_id: str = Depends(require_admin)):
    """Preview by default; pass `commit: true` to apply."""
    try:
        return _ok(await admin_org.import_roster(
            actor_id, data.get("roster") or {}, commit=bool(data.get("commit")),
        ))
    except AdminError as exc:
        return _failed(exc)


# ── audit ────────────────────────────────────────────────────────────────────

@router.get("/audit")
async def read_audit(
    actor_id: Optional[str] = Query(None),
    target_id: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    _: str = Depends(require_admin),
):
    return _ok({"entries": await org_repository.list_audit(
        actor_id=actor_id, target_id=target_id, limit=limit
    )})
