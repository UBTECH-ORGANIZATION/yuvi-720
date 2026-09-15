"""Org persistence — schools · groups · teacher links · enrollments · admins.

Ported from Spark's ``app/services/org_repository.py`` (Mongo path only; this
service has no JSON fallback) plus the scoping helpers of ``app/brain/org.py``
that the console uses. Same collections, same document shapes:

    org_schools        _id = school_id
    org_groups         _id = group_id
    org_teacher_links  _id = "{teacher_id}:{group_id}"   teacher → group
    org_enrollments    _id = "{learner_id}:{group_id}"   learner → group
    org_admins         _id = user_id
    org_audit          append-only record of every membership mutation

A teacher is never linked to a learner directly: the *group* is the join.
Links and enrollments are deactivated, never deleted, so history and the audit
trail stay resolvable.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

SCHOOLS = "org_schools"
GROUPS = "org_groups"
TEACHER_LINKS = "org_teacher_links"
ENROLLMENTS = "org_enrollments"
ADMINS = "org_admins"
AUDIT = "org_audit"

# Link roles carry intent, not extra power: every active link grants the same
# read scope. `observer` exists so a counsellor can be recorded without
# pretending they teach the group.
LINK_ROLES = ("teacher", "homeroom", "counselor", "observer")

ADMIN_SCOPES = ("system", "school")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def link_id(teacher_id: str, group_id: str) -> str:
    return "{}:{}".format(teacher_id, group_id)


def enrollment_id(learner_id: str, group_id: str) -> str:
    return "{}:{}".format(learner_id, group_id)


def public_group(group: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Expose ``id`` alongside the Mongo ``_id`` — the key the UI reads."""
    if group is None:
        return None
    return {**group, "id": group.get("_id")}


class OrgRepository:
    def __init__(self, db: Any) -> None:
        self._db = db

    # ── generic helpers ──────────────────────────────────────────────────────

    async def _find(self, collection: str, query: Dict[str, Any]) -> List[Dict[str, Any]]:
        return await self._db.collection(collection).find(query).to_list(length=5000)

    async def _find_one(self, collection: str, document_id: str) -> Optional[Dict[str, Any]]:
        return await self._db.collection(collection).find_one({"_id": document_id})

    async def _upsert(self, collection: str, document: Dict[str, Any]) -> Dict[str, Any]:
        payload = {**document, "updated_at": _now()}
        payload.setdefault("created_at", payload["updated_at"])
        document_id = payload.pop("_id")
        await self._db.collection(collection).update_one(
            {"_id": document_id},
            {"$set": payload, "$setOnInsert": {"_id": document_id}},
            upsert=True,
        )
        payload["_id"] = document_id
        return payload

    # ── schools ──────────────────────────────────────────────────────────────

    async def list_schools(self) -> List[Dict[str, Any]]:
        return await self._find(SCHOOLS, {})

    async def get_school(self, school_id: str) -> Optional[Dict[str, Any]]:
        return await self._find_one(SCHOOLS, school_id)

    async def upsert_school(
        self, school_id: str, *, name: str,
        moe_code: Optional[str] = None, city: Optional[str] = None,
    ) -> Dict[str, Any]:
        return await self._upsert(SCHOOLS, {
            "_id": school_id, "name": name, "moe_code": moe_code, "city": city,
        })

    # ── groups ───────────────────────────────────────────────────────────────

    async def list_groups(
        self, *, school_id: Optional[str] = None, active_only: bool = True
    ) -> List[Dict[str, Any]]:
        query: Dict[str, Any] = {}
        if school_id:
            query["school_id"] = school_id
        if active_only:
            query["active"] = True
        return await self._find(GROUPS, query)

    async def get_group(self, group_id: str) -> Optional[Dict[str, Any]]:
        return await self._find_one(GROUPS, group_id)

    async def upsert_group(
        self, group_id: str, *, school_id: str, name: str,
        subject: Optional[str] = None, grade: Optional[str] = None,
        year: Optional[str] = None, active: bool = True,
    ) -> Dict[str, Any]:
        return await self._upsert(GROUPS, {
            "_id": group_id, "school_id": school_id, "name": name, "subject": subject,
            "grade": grade, "year": year, "active": active,
        })

    async def archive_group(self, group_id: str) -> Optional[Dict[str, Any]]:
        """Archived, never deleted — history stays readable and the LRS record
        keeps its referent."""
        group = await self.get_group(group_id)
        if group is None:
            return None
        return await self._upsert(GROUPS, {**group, "_id": group_id, "active": False})

    # ── teacher links ────────────────────────────────────────────────────────

    async def list_teacher_links(
        self, *, teacher_id: Optional[str] = None, group_id: Optional[str] = None,
        active_only: bool = True,
    ) -> List[Dict[str, Any]]:
        query: Dict[str, Any] = {}
        if teacher_id:
            query["teacher_id"] = teacher_id
        if group_id:
            query["group_id"] = group_id
        if active_only:
            query["active"] = True
        return await self._find(TEACHER_LINKS, query)

    async def get_teacher_link(self, teacher_id: str, group_id: str) -> Optional[Dict[str, Any]]:
        return await self._find_one(TEACHER_LINKS, link_id(teacher_id, group_id))

    async def link_teacher(
        self, teacher_id: str, group_id: str, *, school_id: Optional[str] = None,
        link_role: str = "teacher", active: bool = True,
    ) -> Dict[str, Any]:
        role = link_role if link_role in LINK_ROLES else "teacher"
        return await self._upsert(TEACHER_LINKS, {
            "_id": link_id(teacher_id, group_id), "teacher_id": teacher_id,
            "group_id": group_id, "school_id": school_id, "link_role": role,
            "active": active,
        })

    async def unlink_teacher(self, teacher_id: str, group_id: str) -> Optional[Dict[str, Any]]:
        """Deactivate, never delete — the audit trail must stay answerable."""
        existing = await self.get_teacher_link(teacher_id, group_id)
        if existing is None:
            return None
        return await self._upsert(TEACHER_LINKS, {
            **existing, "_id": link_id(teacher_id, group_id),
            "active": False, "revoked_at": _now(),
        })

    # ── enrollments ──────────────────────────────────────────────────────────

    async def list_enrollments(
        self, *, learner_id: Optional[str] = None, group_id: Optional[str] = None,
        active_only: bool = True,
    ) -> List[Dict[str, Any]]:
        query: Dict[str, Any] = {}
        if learner_id:
            query["learner_id"] = learner_id
        if group_id:
            query["group_id"] = group_id
        if active_only:
            query["active"] = True
        return await self._find(ENROLLMENTS, query)

    async def get_enrollment(self, learner_id: str, group_id: str) -> Optional[Dict[str, Any]]:
        return await self._find_one(ENROLLMENTS, enrollment_id(learner_id, group_id))

    async def enroll_learner(
        self, learner_id: str, group_id: str, *, school_id: Optional[str] = None,
        active: bool = True,
    ) -> Dict[str, Any]:
        return await self._upsert(ENROLLMENTS, {
            "_id": enrollment_id(learner_id, group_id), "learner_id": learner_id,
            "group_id": group_id, "school_id": school_id, "active": active,
            "joined_at": _now(), "left_at": None,
        })

    async def unenroll_learner(self, learner_id: str, group_id: str) -> Optional[Dict[str, Any]]:
        existing = await self.get_enrollment(learner_id, group_id)
        if existing is None:
            return None
        return await self._upsert(ENROLLMENTS, {
            **existing, "_id": enrollment_id(learner_id, group_id),
            "active": False, "left_at": _now(),
        })

    # ── admins ───────────────────────────────────────────────────────────────

    async def get_admin(self, user_id: str) -> Optional[Dict[str, Any]]:
        row = await self._find_one(ADMINS, user_id)
        if row is None or row.get("active") is False:
            return None
        return row

    async def list_admins(self) -> List[Dict[str, Any]]:
        return await self._find(ADMINS, {})

    async def grant_admin(
        self, user_id: str, *, scope: str = "system",
        school_ids: Optional[List[str]] = None, granted_by: Optional[str] = None,
    ) -> Dict[str, Any]:
        return await self._upsert(ADMINS, {
            "_id": user_id, "scope": scope if scope in ADMIN_SCOPES else "system",
            "school_ids": list(school_ids or []), "granted_by": granted_by,
            "granted_at": _now(), "active": True,
        })

    async def revoke_admin(self, user_id: str) -> Optional[Dict[str, Any]]:
        existing = await self._find_one(ADMINS, user_id)
        if existing is None:
            return None
        return await self._upsert(ADMINS, {
            **existing, "_id": user_id, "active": False, "revoked_at": _now(),
        })

    # ── audit ────────────────────────────────────────────────────────────────

    async def record_audit(
        self, *, actor_id: str, action: str, target_type: str, target_id: str,
        before: Optional[Dict[str, Any]] = None, after: Optional[Dict[str, Any]] = None,
        reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Append-only record of a membership mutation. "Who gave this teacher
        access to this child, and when" must always be answerable."""
        at = _now()
        entry = {
            "_id": "aud_{}_{}_{}".format(target_type, target_id, at),
            "actor_id": actor_id, "action": action, "target_type": target_type,
            "target_id": target_id, "before": before, "after": after,
            "reason": reason, "at": at,
        }
        return await self._upsert(AUDIT, entry)

    async def list_audit(
        self, *, actor_id: Optional[str] = None, target_id: Optional[str] = None,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        query: Dict[str, Any] = {}
        if actor_id:
            query["actor_id"] = actor_id
        if target_id:
            query["target_id"] = target_id
        rows = await self._find(AUDIT, query)
        rows.sort(key=lambda row: row.get("at") or "", reverse=True)
        return rows[:limit]

    # ── scoping helpers (Spark's app/brain/org.py) ───────────────────────────

    async def is_admin(self, user_id: str) -> bool:
        """True iff the user holds an active grant in ``org_admins``."""
        return await self.get_admin(user_id) is not None

    @staticmethod
    def _ordered(groups: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return sorted(groups, key=lambda group: (
            str(group.get("name") or "").casefold(),
            str(group.get("id") or group.get("_id") or ""),
        ))

    async def groups_for_teacher(self, teacher_id: str) -> List[Dict[str, Any]]:
        """Groups the teacher may access (admin → all, school-admins → their schools)."""
        admin = await self.get_admin(teacher_id)
        if admin is not None:
            if admin.get("scope") == "school" and admin.get("school_ids"):
                scoped: List[Dict[str, Any]] = []
                for school_id in admin["school_ids"]:
                    scoped.extend(await self.list_groups(school_id=school_id))
                return self._ordered([public_group(group) for group in scoped])
            return self._ordered([public_group(group) for group in await self.list_groups()])

        groups = []
        for link in await self.list_teacher_links(teacher_id=teacher_id):
            group = await self.get_group(link["group_id"])
            if group is not None and group.get("active") is not False:
                groups.append(public_group(group))
        return self._ordered(groups)

    async def learners_in_group(self, group_id: str) -> List[str]:
        return [row["learner_id"] for row in await self.list_enrollments(group_id=group_id)]

    async def groups_for_learner(self, learner_id: str) -> List[str]:
        return [row["group_id"] for row in await self.list_enrollments(learner_id=learner_id)]

    async def unassigned_learners(self, known_learner_ids: List[str]) -> List[str]:
        """Learners enrolled in no active group — one query, not one per learner."""
        enrolled = {row["learner_id"] for row in await self.list_enrollments()}
        return [learner_id for learner_id in known_learner_ids if learner_id not in enrolled]
