"""Admin control plane — org mutations with guardrails and an audit trail.

Routes stay thin; every rule that protects a child's data lives here:

* **Archive, never delete.** A group with history keeps its referent — the LRS
  statements and mentoring records that point at it must stay resolvable.
* **Audit everything.** "Who gave this teacher access to this child, and when"
  must always be answerable. Every mutation writes an `org_audit` row.
* **No self-lockout.** An admin cannot revoke their own last grant, because the
  recovery path would be a database console at 2am.
* **Warn before a group goes unstaffed.** Removing the last teacher from a group
  with active learners is allowed — those children just became invisible to
  every teacher, so the caller has to say it meant it.
"""

from __future__ import annotations

import secrets
import string
from typing import Any, Optional

from app.auth.repository import (
    DEFAULT_PREFERENCES,
    get_user_by_id,
    get_user_by_username,
    list_users,
    normalize_username,
    public_user,
    upsert_user,
)
from app.brain import org
from app.services import org_repository


class AdminError(ValueError):
    """A guardrail refused the mutation. Carries a machine-readable `code`."""

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code


# ── overview ─────────────────────────────────────────────────────────────────

async def overview() -> dict[str, Any]:
    """Counts plus the two things that otherwise go unnoticed: learners nobody
    teaches, and groups nobody staffs."""
    schools = await org_repository.list_schools()
    groups = await org_repository.list_groups()
    links = await org_repository.list_teacher_links()
    enrollments = await org_repository.list_enrollments()

    learners = await list_users(role="learner")
    learner_ids = [str(user.get("_id")) for user in learners]
    unassigned = await org.unassigned_learners(learner_ids)

    staffed = {link["group_id"] for link in links}
    teacherless = [
        {"id": group["_id"], "name": group.get("name")}
        for group in groups if group["_id"] not in staffed
    ]

    return {
        "counts": {
            "schools": len(schools),
            "groups": len(groups),
            "teachers": len(await list_users(role="teacher")),
            "students": len(learners),
            "active_links": len(links),
            "enrollments": len(enrollments),
        },
        "unassigned_learners": [
            {"learner_id": lid, "display_name": next(
                (u.get("display_name") for u in learners if str(u.get("_id")) == lid), lid
            )}
            for lid in unassigned
        ],
        "teacherless_groups": teacherless,
        "recent_changes": await org_repository.list_audit(limit=10),
    }


# ── people directory + connections ───────────────────────────────────────────

async def people(*, role: Optional[str] = None, query: Optional[str] = None) -> list[dict[str, Any]]:
    rows = []
    for document in await list_users(role=role, query=query):
        user = public_user(document) or {}
        user_id = user.get("user_id")
        roles = user.get("roles") or []
        entry: dict[str, Any] = {**user, "groups": []}
        if "teacher" in roles:
            entry["groups"] = [
                {"id": link["group_id"], "link_role": link.get("link_role")}
                for link in await org_repository.list_teacher_links(teacher_id=user_id)
            ]
        if "learner" in roles:
            entry["enrolled_in"] = await org.groups_for_learner(user_id)
        rows.append(entry)
    return rows


async def teacher_connections(teacher_id: str) -> dict[str, Any]:
    """Every group a teacher holds, and therefore every learner they can read.

    "Which students can this teacher see?" is the question a data-protection
    review asks first — it should take one request to answer.
    """
    groups = await org.groups_for_teacher(teacher_id)
    reachable: list[str] = []
    for group in groups:
        for learner_id in await org.learners_in_group(group["id"]):
            if learner_id not in reachable:
                reachable.append(learner_id)
    return {
        "teacher_id": teacher_id,
        "is_admin": await org.is_admin(teacher_id),
        "groups": groups,
        "reachable_learners": reachable,
        "reachable_count": len(reachable),
    }


async def learner_connections(learner_id: str) -> dict[str, Any]:
    """Every teacher who can read this learner, and the group that grants it.

    This is the view that makes the many-to-many honest instead of implied.
    """
    grants = []
    for group_id in await org.groups_for_learner(learner_id):
        group = await org_repository.get_group(group_id)
        for link in await org_repository.list_teacher_links(group_id=group_id):
            grants.append({
                "teacher_id": link["teacher_id"],
                "group_id": group_id,
                "group_name": (group or {}).get("name"),
                "link_role": link.get("link_role"),
            })
    return {"learner_id": learner_id, "granted_via": grants}


# ── mutations (all audited) ──────────────────────────────────────────────────

async def _audit(actor_id: str, action: str, target_type: str, target_id: str,
                 before: Any = None, after: Any = None, reason: Optional[str] = None) -> None:
    await org_repository.record_audit(
        actor_id=actor_id, action=action, target_type=target_type,
        target_id=target_id, before=before, after=after, reason=reason,
    )


async def save_school(actor_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    school_id = (payload.get("id") or "").strip()
    if not school_id:
        raise AdminError("school_id_required")
    before = await org_repository.get_school(school_id)
    after = await org_repository.upsert_school(
        school_id, name=payload.get("name") or school_id,
        moe_code=payload.get("moe_code"), city=payload.get("city"),
    )
    await _audit(actor_id, "upsert_school", "school", school_id, before, after)
    return after


async def save_group(actor_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    group_id = (payload.get("id") or "").strip()
    school_id = (payload.get("school_id") or "").strip()
    if not group_id or not school_id:
        raise AdminError("group_id_and_school_required")
    if await org_repository.get_school(school_id) is None:
        raise AdminError("unknown_school")
    before = await org_repository.get_group(group_id)
    after = await org_repository.upsert_group(
        group_id, school_id=school_id, name=payload.get("name") or group_id,
        subject=payload.get("subject"), grade=payload.get("grade"),
        year=payload.get("year"), active=bool(payload.get("active", True)),
    )
    await _audit(actor_id, "upsert_group", "group", group_id, before, after)
    return after


async def archive_group(actor_id: str, group_id: str) -> dict[str, Any]:
    before = await org_repository.get_group(group_id)
    if before is None:
        raise AdminError("unknown_group")
    after = await org_repository.archive_group(group_id)
    await _audit(actor_id, "archive_group", "group", group_id, before, after)
    return after or {}


async def link_teacher(actor_id: str, teacher_id: str, group_id: str,
                       link_role: str = "teacher") -> dict[str, Any]:
    if await get_user_by_id(teacher_id) is None:
        raise AdminError("unknown_teacher")
    group = await org_repository.get_group(group_id)
    if group is None:
        raise AdminError("unknown_group")
    after = await org_repository.link_teacher(
        teacher_id, group_id, school_id=group.get("school_id"), link_role=link_role,
    )
    await _audit(actor_id, "link_teacher", "teacher_link",
                 org_repository.link_id(teacher_id, group_id), None, after)
    return after


async def unlink_teacher(actor_id: str, teacher_id: str, group_id: str,
                         *, confirm_unstaffed: bool = False) -> dict[str, Any]:
    links = await org_repository.list_teacher_links(group_id=group_id)
    remaining = [link for link in links if link["teacher_id"] != teacher_id]
    learners = await org.learners_in_group(group_id)
    if not remaining and learners and not confirm_unstaffed:
        # Not a refusal on principle — a refusal to do it *silently*. Those
        # children would become invisible to every teacher at once.
        raise AdminError("would_leave_group_unstaffed")

    before = await org_repository._find_one(
        org_repository.TEACHER_LINKS, org_repository.link_id(teacher_id, group_id)
    )
    if before is None:
        raise AdminError("unknown_link")
    after = await org_repository.unlink_teacher(teacher_id, group_id)
    await _audit(actor_id, "unlink_teacher", "teacher_link",
                 org_repository.link_id(teacher_id, group_id), before, after)
    return after or {}


async def enroll_learner(actor_id: str, learner_id: str, group_id: str) -> dict[str, Any]:
    if await get_user_by_id(learner_id) is None:
        raise AdminError("unknown_learner")
    group = await org_repository.get_group(group_id)
    if group is None:
        raise AdminError("unknown_group")
    after = await org_repository.enroll_learner(
        learner_id, group_id, school_id=group.get("school_id")
    )
    await _audit(actor_id, "enroll_learner", "enrollment",
                 org_repository.enrollment_id(learner_id, group_id), None, after)
    return after


async def unenroll_learner(actor_id: str, learner_id: str, group_id: str) -> dict[str, Any]:
    before = await org_repository._find_one(
        org_repository.ENROLLMENTS, org_repository.enrollment_id(learner_id, group_id)
    )
    if before is None:
        raise AdminError("unknown_enrollment")
    after = await org_repository.unenroll_learner(learner_id, group_id)
    await _audit(actor_id, "unenroll_learner", "enrollment",
                 org_repository.enrollment_id(learner_id, group_id), before, after)
    return after or {}


async def bulk_enroll(actor_id: str, group_id: str, learner_ids: list[str]) -> dict[str, Any]:
    enrolled, skipped = [], []
    for learner_id in learner_ids:
        try:
            await enroll_learner(actor_id, learner_id, group_id)
            enrolled.append(learner_id)
        except AdminError as exc:
            skipped.append({"learner_id": learner_id, "reason": exc.code})
    return {"enrolled": enrolled, "skipped": skipped}


# ── admin grants ─────────────────────────────────────────────────────────────

async def grant_admin(actor_id: str, user_id: str, *, scope: str = "system",
                      school_ids: Optional[list[str]] = None) -> dict[str, Any]:
    if await get_user_by_id(user_id) is None:
        raise AdminError("unknown_user")
    after = await org_repository.grant_admin(
        user_id, scope=scope, school_ids=school_ids, granted_by=actor_id
    )
    await _audit(actor_id, "grant_admin", "admin", user_id, None, after)
    return after


async def revoke_admin(actor_id: str, user_id: str) -> dict[str, Any]:
    admins = [row for row in await org_repository.list_admins() if row.get("active") is not False]
    if user_id == actor_id:
        raise AdminError("cannot_revoke_self")
    if len(admins) <= 1 and any(row["_id"] == user_id for row in admins):
        raise AdminError("cannot_remove_last_admin")
    before = await org_repository.get_admin(user_id)
    if before is None:
        raise AdminError("unknown_admin")
    after = await org_repository.revoke_admin(user_id)
    await _audit(actor_id, "revoke_admin", "admin", user_id, before, after)
    return after or {}


# ── account provisioning ─────────────────────────────────────────────────────

_PASSWORD_ALPHABET = string.ascii_letters + string.digits


def _temp_password(length: int = 10) -> str:
    return "".join(secrets.choice(_PASSWORD_ALPHABET) for _ in range(length))


async def create_user(actor_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Provision an account. The temp password is returned exactly once.

    Admin-provisioned, never self-signup. `must_change_password` forces a reset
    on first login so the generated secret cannot become a permanent one.
    """
    from app.auth.passwords import hash_password

    username = normalize_username(payload.get("username") or "")
    if not username:
        raise AdminError("username_required")
    if await get_user_by_username(username) is not None:
        raise AdminError("username_taken")

    roles = [role for role in (payload.get("roles") or []) if role in {"learner", "teacher", "admin"}]
    if not roles:
        raise AdminError("roles_required")

    user_id = (payload.get("user_id") or username).strip()
    if await get_user_by_id(user_id) is not None:
        raise AdminError("user_id_taken")

    password = payload.get("password") or _temp_password()
    document = {
        "_id": user_id,
        "username": username,
        "display_name": (payload.get("display_name") or username).strip(),
        "roles": roles,
        "password": hash_password(password),
        "must_change_password": True,
        "preferences": {**DEFAULT_PREFERENCES, "language": payload.get("language") or "he"},
    }
    await upsert_user(document)

    # A learner needs a brain document or every downstream read invents one
    # lazily under a different code path.
    if "learner" in roles:
        from app.brain.repository import apply_brain_updates, get_brain
        await get_brain(user_id)
        await apply_brain_updates(user_id, {
            "identity.display_name": document["display_name"],
            "identity.locale": document["preferences"]["language"],
        })

    await _audit(actor_id, "create_user", "user", user_id, None,
                 {"username": username, "roles": roles})
    return {"user": public_user(document), "temp_password": password}


# ── roster import ────────────────────────────────────────────────────────────

async def import_roster(actor_id: str, payload: dict[str, Any], *, commit: bool) -> dict[str, Any]:
    """Diff first, mutate only on commit.

    A roster import is the single most destructive operation an admin can run;
    it should never be the first time they learn what it was going to do.
    """
    diff: dict[str, list[dict[str, Any]]] = {"added": [], "updated": [], "unchanged": []}

    async def classify(kind: str, key: str, incoming: dict[str, Any], existing: Optional[dict]) -> None:
        entry = {"kind": kind, "id": key, "incoming": incoming}
        if existing is None:
            diff["added"].append(entry)
        elif any(existing.get(field) != value for field, value in incoming.items()):
            diff["updated"].append({**entry, "existing": existing})
        else:
            diff["unchanged"].append(entry)

    for school in payload.get("schools") or []:
        await classify("school", school["id"], {"name": school.get("name")},
                       await org_repository.get_school(school["id"]))
    for group in payload.get("groups") or []:
        await classify("group", group["id"],
                       {"name": group.get("name"), "school_id": group.get("school_id")},
                       await org_repository.get_group(group["id"]))
    for link in payload.get("teacher_links") or []:
        key = org_repository.link_id(link["teacher_id"], link["group_id"])
        await classify("teacher_link", key, {"active": True},
                       await org_repository._find_one(org_repository.TEACHER_LINKS, key))
    for enrollment in payload.get("enrollments") or []:
        key = org_repository.enrollment_id(enrollment["learner_id"], enrollment["group_id"])
        await classify("enrollment", key, {"active": True},
                       await org_repository._find_one(org_repository.ENROLLMENTS, key))

    if not commit:
        return {"committed": False, "diff": diff}

    groups_by_id = {group["id"]: group for group in payload.get("groups") or []}
    for school in payload.get("schools") or []:
        await save_school(actor_id, school)
    for group in payload.get("groups") or []:
        await save_group(actor_id, group)
    for link in payload.get("teacher_links") or []:
        await link_teacher(actor_id, link["teacher_id"], link["group_id"],
                           link.get("link_role") or "teacher")
    for enrollment in payload.get("enrollments") or []:
        group = groups_by_id.get(enrollment["group_id"]) or {}
        await org_repository.enroll_learner(
            enrollment["learner_id"], enrollment["group_id"],
            school_id=group.get("school_id"),
        )
    await _audit(actor_id, "import_roster", "roster", "import",
                 None, {"counts": {key: len(value) for key, value in diff.items()}})
    return {"committed": True, "diff": diff}
