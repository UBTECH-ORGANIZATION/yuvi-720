"""Organization model + permission scoping (F8, §4.1/§5.8).

Schools · teachers · groups · enrollments. Access is enforced **server-side
before any brain read**: a teacher sees only learners in their groups; an admin
sees all.

The link between a teacher and a learner is always the **group** — never a
direct edge. That is what makes "several teachers may see the same student" fall
out for free (both linked to a group the learner is enrolled in), and makes
revocation one indexed write instead of an N-row migration.

Storage lives in `app.services.org_repository` (the `org_*` collections). This
module is the scoping API every caller uses; it is **async** because
authorization is read per request from the database rather than from a cache or
from the session token. A revoked teacher therefore loses access on the very
next call — no re-login, no cache to wait out. That matters: roles are baked
into a 12-hour JWT (`app/auth/tokens.py`), so the token cannot be the authority
on scope.
"""

from __future__ import annotations

from typing import Any, Optional

from app.services import org_repository


def _public_group(group: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Expose `id` alongside the Mongo `_id`.

    The client (`services/teacher.ts`) and `insights.group_insights` have always
    keyed groups by `id`; storage keys by `_id`. Normalizing here keeps that
    contract instead of rippling a rename through the UI.
    """
    if group is None:
        return None
    return {**group, "id": group.get("_id")}


async def get_teacher(teacher_id: str) -> Optional[dict[str, Any]]:
    """A teacher's org record: their active links and the schools they reach.

    There is no separate `teachers` collection — a teacher *is* a user with the
    teacher role, and their org identity is the set of links they hold.
    """
    links = await org_repository.list_teacher_links(teacher_id=teacher_id)
    admin = await org_repository.get_admin(teacher_id)
    if not links and admin is None:
        return None
    return {
        "id": teacher_id,
        "group_ids": [link["group_id"] for link in links],
        "school_ids": sorted({link.get("school_id") for link in links if link.get("school_id")}),
        "role": "admin" if admin else "teacher",
        "admin_scope": (admin or {}).get("scope"),
    }


async def is_admin(user_id: str) -> bool:
    """True iff the user holds an active grant in `org_admins`.

    Deliberately a database read, not a token claim: the JWT's `roles` gates the
    route, this decides scope.
    """
    return await org_repository.get_admin(user_id) is not None


def _ordered(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """A stable order, by the name the teacher actually reads.

    `list_groups` has no sort, so the driver returned natural order — which for
    an admin (who gets every group) meant the class picker defaulted to a
    different class on different page loads, and the dashboard silently changed
    which class it was describing. Sorted here rather than at each call site
    because this is the one funnel every caller goes through.
    """
    return sorted(groups, key=lambda group: (
        str(group.get("name") or "").casefold(), str(group.get("id") or group.get("_id") or "")
    ))


async def groups_for_teacher(teacher_id: str) -> list[dict[str, Any]]:
    """Groups the teacher may access (admin → all, school-admins → their schools)."""
    admin = await org_repository.get_admin(teacher_id)
    if admin is not None:
        if admin.get("scope") == "school" and admin.get("school_ids"):
            scoped: list[dict[str, Any]] = []
            for school_id in admin["school_ids"]:
                scoped.extend(await org_repository.list_groups(school_id=school_id))
            return _ordered([_public_group(group) for group in scoped])
        return _ordered(
            [_public_group(group) for group in await org_repository.list_groups()]
        )

    links = await org_repository.list_teacher_links(teacher_id=teacher_id)
    groups = []
    for link in links:
        group = await org_repository.get_group(link["group_id"])
        if group is not None and group.get("active") is not False:
            groups.append(_public_group(group))
    return _ordered(groups)


async def learners_in_group(group_id: str) -> list[str]:
    rows = await org_repository.list_enrollments(group_id=group_id)
    return [row["learner_id"] for row in rows]


async def groups_for_learner(learner_id: str) -> list[str]:
    rows = await org_repository.list_enrollments(learner_id=learner_id)
    return [row["group_id"] for row in rows]


async def teachers_for_learner(learner_id: str) -> list[str]:
    """Every teacher who may currently read this learner.

    The realtime fanout resolves recipients through this at publish time, so a
    teacher can never be handed an event for a learner outside their groups.
    Admins are deliberately excluded: they can *read* everything on demand, but
    flooding an admin with every child's live alerts is not a feature.
    """
    teacher_ids: list[str] = []
    for group_id in await groups_for_learner(learner_id):
        for link in await org_repository.list_teacher_links(group_id=group_id):
            if link["teacher_id"] not in teacher_ids:
                teacher_ids.append(link["teacher_id"])
    return teacher_ids


async def teacher_can_access_group(teacher_id: str, group_id: str) -> bool:
    if await is_admin(teacher_id):
        return True
    return any(group["_id"] == group_id for group in await groups_for_teacher(teacher_id))


async def teacher_can_access_learner(teacher_id: str, learner_id: str) -> bool:
    """True iff the learner is enrolled in one of the teacher's groups (or admin)."""
    if await is_admin(teacher_id):
        return True
    allowed = {group["_id"] for group in await groups_for_teacher(teacher_id)}
    if not allowed:
        return False
    return any(group_id in allowed for group_id in await groups_for_learner(learner_id))


async def get_group(group_id: str) -> Optional[dict[str, Any]]:
    return _public_group(await org_repository.get_group(group_id))


async def list_schools() -> list[dict[str, Any]]:
    return await org_repository.list_schools()


async def unassigned_learners(known_learner_ids: list[str]) -> list[str]:
    """Learners enrolled in no active group.

    Without this they are invisible to every teacher *and* to the admin, which
    is the failure mode where a child quietly receives no attention at all.

    One query, not one per learner. The obvious loop over `groups_for_learner`
    costs a round trip per child, which on a remote database made the admin
    Overview tab take longer to load than the browser check would wait for — and
    it gets worse exactly as the school gets bigger.
    """
    enrolled = {row["learner_id"] for row in await org_repository.list_enrollments()}
    return [learner_id for learner_id in known_learner_ids if learner_id not in enrolled]
