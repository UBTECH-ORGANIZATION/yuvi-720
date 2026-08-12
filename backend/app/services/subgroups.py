"""Named slices of one class.

A sub-group already existed for about thirty seconds at a time: `SubGroupAssign`
seeded a set of learner ids from a learning gap, the teacher assigned a goal to
them, and the selection was gone. Naming it makes the same set reusable for
goals, kudos and (next) tasks.

Two decisions carry the whole design:

**It is not a group.** `org_groups` has no parent, and the org model is explicit
that the link between a teacher and a learner is always the group. Making a
sub-group a real group would need a second `org_enrollments` row per learner,
and every learner in one would then be counted twice by `learners_in_group`,
`students_total`, every engagement percentage and `unassigned_learners`.

**Membership is resolved against the live roster on every read, not trusted from
storage.** A stored id list is a snapshot of who was in the class the day the
teacher drew the selection. A child who transfers out must not stay in a
sub-group by inertia — and the teacher must be told they dropped, not quietly
handed a shorter list.

Authorization is not a new path: whoever may read the parent group may read and
edit its slices, which is the same reason the tool registry was never made an
MCP server.
"""

from __future__ import annotations

import re
import uuid
from typing import Any, Optional

from app.brain import org
from app.services import org_repository

#: A class of 30 with room to spare. The cap exists so a crafted request cannot
#: turn one write into an unbounded fan-out downstream.
MAX_MEMBERS = 60
MAX_NAME = 60
#: Enough to organise a class, few enough that the switcher stays readable.
MAX_PER_GROUP = 20


class SubgroupError(Exception):
    """A refusal the client is allowed to see. The message is a stable code."""


def _clean_name(name: str) -> str:
    return re.sub(r"\s+", " ", str(name or "")).strip()[:MAX_NAME]


async def _authorize(teacher_id: str, group_id: str) -> None:
    """One gate, and it is the parent group's.

    A group this teacher does not teach and a group that does not exist are
    refused identically — the difference is not theirs to learn.

    The existence check is not redundant with the access check: an admin passes
    `teacher_can_access_group` for *any* id, including one that was never a
    group, because that function short-circuits on the admin grant. Without this
    an admin could name a sub-group of nothing, which would then be invisible
    from every screen and unreachable by every read.
    """
    if not await org.teacher_can_access_group(teacher_id, group_id):
        raise SubgroupError("not_authorized")
    if await org.get_group(group_id) is None:
        raise SubgroupError("not_authorized")


def _public(subgroup: dict[str, Any], members: list[str], dropped: list[str]) -> dict[str, Any]:
    return {
        "id": subgroup.get("_id"),
        "group_id": subgroup.get("group_id"),
        "name": subgroup.get("name"),
        "learner_ids": members,
        "size": len(members),
        # Named, not silently swallowed: a teacher who drew a group of six and
        # sees five needs to know the sixth left the class.
        "dropped": dropped,
        "created_by": subgroup.get("created_by"),
        "created_at": subgroup.get("created_at"),
    }


def _resolve(subgroup: dict[str, Any], enrolled: set[str]) -> tuple[list[str], list[str]]:
    """Split the stored list into who is still in the class, and who is not."""
    members, dropped = [], []
    for learner_id in subgroup.get("learner_ids") or []:
        (members if learner_id in enrolled else dropped).append(learner_id)
    return members, dropped


async def list_for_group(teacher_id: str, group_id: str) -> list[dict[str, Any]]:
    """Every sub-group of this class, with membership resolved as of now."""
    await _authorize(teacher_id, group_id)

    enrolled = set(await org.learners_in_group(group_id))
    rows = await org_repository.list_subgroups(group_id=group_id)
    resolved = []
    for subgroup in rows:
        members, dropped = _resolve(subgroup, enrolled)
        resolved.append(_public(subgroup, members, dropped))
    # By name, so the switcher does not reorder itself between page loads — the
    # same bug `groups_for_teacher` had.
    resolved.sort(key=lambda row: (str(row.get("name") or "").casefold(), str(row["id"])))
    return resolved


async def create(
    teacher_id: str, group_id: str, *, name: str, learner_ids: list[str],
) -> dict[str, Any]:
    """Name a selection. Refuses a learner who is not in the parent class."""
    await _authorize(teacher_id, group_id)

    clean = _clean_name(name)
    if not clean:
        raise SubgroupError("name_required")

    existing = await org_repository.list_subgroups(group_id=group_id)
    if len(existing) >= MAX_PER_GROUP:
        raise SubgroupError("too_many_subgroups")
    if any(_clean_name(row.get("name", "")).casefold() == clean.casefold() for row in existing):
        raise SubgroupError("name_taken")

    members, skipped = await _validate(group_id, learner_ids)
    if not members:
        raise SubgroupError("no_members_in_group")

    subgroup = await org_repository.upsert_subgroup(
        f"sg-{uuid.uuid4().hex[:12]}",
        group_id=group_id, name=clean, learner_ids=members, created_by=teacher_id,
    )
    return {**_public(subgroup, members, []), "skipped": skipped}


async def update(
    teacher_id: str, subgroup_id: str, *,
    name: Optional[str] = None, learner_ids: Optional[list[str]] = None,
) -> dict[str, Any]:
    """Rename, or redraw the membership. Both re-check against the live class."""
    subgroup = await org_repository.get_subgroup(subgroup_id)
    if subgroup is None or subgroup.get("active") is False:
        raise SubgroupError("not_found")
    await _authorize(teacher_id, str(subgroup.get("group_id")))

    group_id = str(subgroup.get("group_id"))
    skipped: list[dict[str, str]] = []
    members = list(subgroup.get("learner_ids") or [])
    if learner_ids is not None:
        members, skipped = await _validate(group_id, learner_ids)
        if not members:
            raise SubgroupError("no_members_in_group")

    clean = subgroup.get("name")
    if name is not None:
        clean = _clean_name(name)
        if not clean:
            raise SubgroupError("name_required")

    saved = await org_repository.upsert_subgroup(
        subgroup_id, group_id=group_id, name=str(clean), learner_ids=members,
        created_by=str(subgroup.get("created_by") or teacher_id),
        created_at=subgroup.get("created_at"),
    )
    return {**_public(saved, members, []), "skipped": skipped}


async def archive(teacher_id: str, subgroup_id: str) -> dict[str, Any]:
    subgroup = await org_repository.get_subgroup(subgroup_id)
    if subgroup is None or subgroup.get("active") is False:
        raise SubgroupError("not_found")
    await _authorize(teacher_id, str(subgroup.get("group_id")))

    await org_repository.archive_subgroup(subgroup_id)
    return {"id": subgroup_id, "archived": True}


async def members_of(teacher_id: str, subgroup_id: str) -> list[str]:
    """The learners a caller may act on — never the stored list directly.

    Every write path that targets a sub-group goes through here, so a goal, a
    kudos or a task can only ever reach a child who is in the class right now.
    """
    subgroup = await org_repository.get_subgroup(subgroup_id)
    if subgroup is None or subgroup.get("active") is False:
        raise SubgroupError("not_found")
    await _authorize(teacher_id, str(subgroup.get("group_id")))

    enrolled = set(await org.learners_in_group(str(subgroup.get("group_id"))))
    members, _ = _resolve(subgroup, enrolled)
    return members


async def _validate(group_id: str, learner_ids: list[str]) -> tuple[list[str], list[dict[str, str]]]:
    """Keep the learners actually enrolled here; report the rest by name.

    The same shape `goal_approval.assign_to_group` uses, and for the same
    reason: the list arrives from a client, so each id is checked individually
    rather than the group being trusted for all of them.
    """
    enrolled = set(await org.learners_in_group(group_id))
    members: list[str] = []
    skipped: list[dict[str, str]] = []
    for learner_id in list(dict.fromkeys(learner_ids))[:MAX_MEMBERS]:
        if learner_id in enrolled:
            members.append(learner_id)
        else:
            skipped.append({"learner_id": learner_id, "reason": "not_in_group"})
    return members, skipped
