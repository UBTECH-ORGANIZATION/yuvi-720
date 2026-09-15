"""Admin control plane — org mutations with guardrails and an audit trail.

Ported from Spark's ``app/services/admin_org.py``. Routes stay thin; every
rule that protects a child's data lives here:

* **Archive, never delete.** A group with history keeps its referent.
* **Audit everything.** Every mutation writes an ``org_audit`` row whose
  ``actor_id`` is ``admin-console:<google email>``.
* **No self-lockout.** An admin cannot revoke their own grant, nor the last one.
* **Warn before a group goes unstaffed.** Removing the last teacher from a
  group with active learners needs ``confirm_unstaffed``.
"""

from __future__ import annotations

import secrets
import string
from typing import Any, Dict, List, Optional

from .org_repository import OrgRepository, enrollment_id, link_id
from .users import (
    DEFAULT_PREFERENCES,
    ROLES,
    UserRepository,
    hash_password,
    normalize_username,
    public_user,
)

ACTOR_PREFIX = "admin-console:"


def actor_id_for(admin: Dict[str, Any]) -> str:
    """The audit actor for a signed-in administrator (Google identity)."""
    email = str(admin.get("email") or admin.get("sub") or "").strip().lower()
    return ACTOR_PREFIX + email if email else ""


class AdminError(ValueError):
    """A guardrail refused the mutation. Carries a machine-readable ``code``."""

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code


_PASSWORD_ALPHABET = string.ascii_letters + string.digits


def _temp_password(length: int = 10) -> str:
    return "".join(secrets.choice(_PASSWORD_ALPHABET) for _ in range(length))


class OrgService:
    def __init__(self, org: OrgRepository, users: UserRepository) -> None:
        self.org = org
        self.users = users

    # ── overview ─────────────────────────────────────────────────────────────

    async def overview(self) -> Dict[str, Any]:
        """Counts plus the two things that otherwise go unnoticed: learners
        nobody teaches, and groups nobody staffs."""
        schools = await self.org.list_schools()
        groups = await self.org.list_groups()
        links = await self.org.list_teacher_links()
        enrollments = await self.org.list_enrollments()

        learners = await self.users.list_users(role="learner")
        learner_ids = [str(user.get("_id")) for user in learners]
        unassigned = await self.org.unassigned_learners(learner_ids)

        staffed = {link["group_id"] for link in links}
        teacherless = [
            {"id": group["_id"], "name": group.get("name")}
            for group in groups if group["_id"] not in staffed
        ]
        return {
            "counts": {
                "schools": len(schools),
                "groups": len(groups),
                "teachers": len(await self.users.list_users(role="teacher")),
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
            "recent_changes": await self.org.list_audit(limit=10),
        }

    # ── people directory + connections ───────────────────────────────────────

    async def people(
        self, *, role: Optional[str] = None, query: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        rows = []
        for document in await self.users.list_users(role=role, query=query):
            user = public_user(document) or {}
            user_id = user.get("user_id")
            roles = user.get("roles") or []
            entry: Dict[str, Any] = {**user, "groups": []}
            if "teacher" in roles:
                entry["groups"] = [
                    {"id": link["group_id"], "link_role": link.get("link_role")}
                    for link in await self.org.list_teacher_links(teacher_id=user_id)
                ]
            if "learner" in roles:
                entry["enrolled_in"] = await self.org.groups_for_learner(user_id)
            rows.append(entry)
        return rows

    async def teacher_connections(self, teacher_id: str) -> Dict[str, Any]:
        """Every group a teacher holds, and therefore every learner they can read."""
        groups = await self.org.groups_for_teacher(teacher_id)
        reachable: List[str] = []
        for group in groups:
            for learner_id in await self.org.learners_in_group(group["id"]):
                if learner_id not in reachable:
                    reachable.append(learner_id)
        return {
            "teacher_id": teacher_id,
            "is_admin": await self.org.is_admin(teacher_id),
            "groups": groups,
            "reachable_learners": reachable,
            "reachable_count": len(reachable),
        }

    async def learner_connections(self, learner_id: str) -> Dict[str, Any]:
        """Every teacher who can read this learner, and the group that grants it."""
        grants = []
        for group_id in await self.org.groups_for_learner(learner_id):
            group = await self.org.get_group(group_id)
            for link in await self.org.list_teacher_links(group_id=group_id):
                grants.append({
                    "teacher_id": link["teacher_id"],
                    "group_id": group_id,
                    "group_name": (group or {}).get("name"),
                    "link_role": link.get("link_role"),
                })
        return {"learner_id": learner_id, "granted_via": grants}

    # ── mutations (all audited) ──────────────────────────────────────────────

    async def _audit(
        self, actor_id: str, action: str, target_type: str, target_id: str,
        before: Any = None, after: Any = None, reason: Optional[str] = None,
    ) -> None:
        await self.org.record_audit(
            actor_id=actor_id, action=action, target_type=target_type,
            target_id=target_id, before=before, after=after, reason=reason,
        )

    async def save_school(self, actor_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        school_id = (payload.get("id") or "").strip()
        if not school_id:
            raise AdminError("school_id_required")
        before = await self.org.get_school(school_id)
        after = await self.org.upsert_school(
            school_id, name=payload.get("name") or school_id,
            moe_code=payload.get("moe_code"), city=payload.get("city"),
        )
        await self._audit(actor_id, "upsert_school", "school", school_id, before, after)
        return after

    async def save_group(self, actor_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        group_id = (payload.get("id") or "").strip()
        school_id = (payload.get("school_id") or "").strip()
        if not group_id or not school_id:
            raise AdminError("group_id_and_school_required")
        if await self.org.get_school(school_id) is None:
            raise AdminError("unknown_school")
        before = await self.org.get_group(group_id)
        after = await self.org.upsert_group(
            group_id, school_id=school_id, name=payload.get("name") or group_id,
            subject=payload.get("subject"), grade=payload.get("grade"),
            year=payload.get("year"), active=bool(payload.get("active", True)),
        )
        await self._audit(actor_id, "upsert_group", "group", group_id, before, after)
        return after

    async def archive_group(self, actor_id: str, group_id: str) -> Dict[str, Any]:
        before = await self.org.get_group(group_id)
        if before is None:
            raise AdminError("unknown_group")
        after = await self.org.archive_group(group_id)
        await self._audit(actor_id, "archive_group", "group", group_id, before, after)
        return after or {}

    async def link_teacher(
        self, actor_id: str, teacher_id: str, group_id: str, link_role: str = "teacher",
    ) -> Dict[str, Any]:
        if await self.users.get_user_by_id(teacher_id) is None:
            raise AdminError("unknown_teacher")
        group = await self.org.get_group(group_id)
        if group is None:
            raise AdminError("unknown_group")
        after = await self.org.link_teacher(
            teacher_id, group_id, school_id=group.get("school_id"), link_role=link_role,
        )
        await self._audit(actor_id, "link_teacher", "teacher_link",
                          link_id(teacher_id, group_id), None, after)
        return after

    async def unlink_teacher(
        self, actor_id: str, teacher_id: str, group_id: str, *, confirm_unstaffed: bool = False,
    ) -> Dict[str, Any]:
        links = await self.org.list_teacher_links(group_id=group_id)
        remaining = [link for link in links if link["teacher_id"] != teacher_id]
        learners = await self.org.learners_in_group(group_id)
        if not remaining and learners and not confirm_unstaffed:
            # Not a refusal on principle — a refusal to do it *silently*. Those
            # children would become invisible to every teacher at once.
            raise AdminError("would_leave_group_unstaffed")

        before = await self.org.get_teacher_link(teacher_id, group_id)
        if before is None:
            raise AdminError("unknown_link")
        after = await self.org.unlink_teacher(teacher_id, group_id)
        await self._audit(actor_id, "unlink_teacher", "teacher_link",
                          link_id(teacher_id, group_id), before, after)
        return after or {}

    async def enroll_learner(self, actor_id: str, learner_id: str, group_id: str) -> Dict[str, Any]:
        if await self.users.get_user_by_id(learner_id) is None:
            raise AdminError("unknown_learner")
        group = await self.org.get_group(group_id)
        if group is None:
            raise AdminError("unknown_group")
        after = await self.org.enroll_learner(learner_id, group_id, school_id=group.get("school_id"))
        await self._audit(actor_id, "enroll_learner", "enrollment",
                          enrollment_id(learner_id, group_id), None, after)
        return after

    async def unenroll_learner(self, actor_id: str, learner_id: str, group_id: str) -> Dict[str, Any]:
        before = await self.org.get_enrollment(learner_id, group_id)
        if before is None:
            raise AdminError("unknown_enrollment")
        after = await self.org.unenroll_learner(learner_id, group_id)
        await self._audit(actor_id, "unenroll_learner", "enrollment",
                          enrollment_id(learner_id, group_id), before, after)
        return after or {}

    async def bulk_enroll(
        self, actor_id: str, group_id: str, learner_ids: List[str]
    ) -> Dict[str, Any]:
        enrolled, skipped = [], []
        for learner_id in learner_ids:
            try:
                await self.enroll_learner(actor_id, learner_id, group_id)
                enrolled.append(learner_id)
            except AdminError as exc:
                skipped.append({"learner_id": learner_id, "reason": exc.code})
        return {"enrolled": enrolled, "skipped": skipped}

    # ── admin grants ─────────────────────────────────────────────────────────

    async def grant_admin(
        self, actor_id: str, user_id: str, *, scope: str = "system",
        school_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        if await self.users.get_user_by_id(user_id) is None:
            raise AdminError("unknown_user")
        after = await self.org.grant_admin(
            user_id, scope=scope, school_ids=school_ids, granted_by=actor_id
        )
        await self._audit(actor_id, "grant_admin", "admin", user_id, None, after)
        return after

    async def revoke_admin(self, actor_id: str, user_id: str) -> Dict[str, Any]:
        admins = [row for row in await self.org.list_admins() if row.get("active") is not False]
        if user_id == actor_id:
            raise AdminError("cannot_revoke_self")
        if len(admins) <= 1 and any(row["_id"] == user_id for row in admins):
            raise AdminError("cannot_remove_last_admin")
        before = await self.org.get_admin(user_id)
        if before is None:
            raise AdminError("unknown_admin")
        after = await self.org.revoke_admin(user_id)
        await self._audit(actor_id, "revoke_admin", "admin", user_id, before, after)
        return after or {}

    # ── account provisioning ─────────────────────────────────────────────────

    async def create_user(self, actor_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Provision an account. The temp password is returned exactly once.

        Admin-provisioned, never self-signup. ``must_change_password`` forces a
        reset on first login so the generated secret cannot become permanent.
        """
        username = normalize_username(payload.get("username") or "")
        if not username:
            raise AdminError("username_required")
        if await self.users.get_user_by_username(username) is not None:
            raise AdminError("username_taken")

        roles = [role for role in (payload.get("roles") or []) if role in ROLES]
        if not roles:
            raise AdminError("roles_required")

        user_id = (payload.get("user_id") or username).strip()
        if await self.users.get_user_by_id(user_id) is not None:
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
        await self.users.upsert_user(document)
        # A learner's brain document is created lazily by Spark on first
        # access (``get_brain``); the console does not seed it.

        await self._audit(actor_id, "create_user", "user", user_id, None,
                          {"username": username, "roles": roles})
        return {"user": public_user(document), "temp_password": password}

    # ── roster import ────────────────────────────────────────────────────────

    async def import_roster(
        self, actor_id: str, payload: Dict[str, Any], *, commit: bool
    ) -> Dict[str, Any]:
        """Diff first, mutate only on commit."""
        diff: Dict[str, List[Dict[str, Any]]] = {"added": [], "updated": [], "unchanged": []}

        def classify(kind: str, key: str, incoming: Dict[str, Any], existing: Optional[Dict]) -> None:
            entry = {"kind": kind, "id": key, "incoming": incoming}
            if existing is None:
                diff["added"].append(entry)
            elif any(existing.get(field) != value for field, value in incoming.items()):
                diff["updated"].append({**entry, "existing": existing})
            else:
                diff["unchanged"].append(entry)

        for school in payload.get("schools") or []:
            classify("school", school["id"], {"name": school.get("name")},
                     await self.org.get_school(school["id"]))
        for group in payload.get("groups") or []:
            classify("group", group["id"],
                     {"name": group.get("name"), "school_id": group.get("school_id")},
                     await self.org.get_group(group["id"]))
        for link in payload.get("teacher_links") or []:
            classify("teacher_link", link_id(link["teacher_id"], link["group_id"]),
                     {"active": True},
                     await self.org.get_teacher_link(link["teacher_id"], link["group_id"]))
        for enrollment in payload.get("enrollments") or []:
            classify("enrollment", enrollment_id(enrollment["learner_id"], enrollment["group_id"]),
                     {"active": True},
                     await self.org.get_enrollment(enrollment["learner_id"], enrollment["group_id"]))

        if not commit:
            return {"committed": False, "diff": diff}

        groups_by_id = {group["id"]: group for group in payload.get("groups") or []}
        for school in payload.get("schools") or []:
            await self.save_school(actor_id, school)
        for group in payload.get("groups") or []:
            await self.save_group(actor_id, group)
        for link in payload.get("teacher_links") or []:
            await self.link_teacher(actor_id, link["teacher_id"], link["group_id"],
                                    link.get("link_role") or "teacher")
        for enrollment in payload.get("enrollments") or []:
            group = groups_by_id.get(enrollment["group_id"]) or {}
            await self.org.enroll_learner(
                enrollment["learner_id"], enrollment["group_id"],
                school_id=group.get("school_id"),
            )
        await self._audit(actor_id, "import_roster", "roster", "import",
                          None, {"counts": {key: len(value) for key, value in diff.items()}})
        return {"committed": True, "diff": diff}
