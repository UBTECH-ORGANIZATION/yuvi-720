"""Opening a task: who it reaches, and telling them.

A target is `{kind: learner|subgroup|group, id}`, and resolving it is the only
place a task turns from a document into a list of children. So it is the only
place that has to be right about scope, and every branch re-checks against the
org rather than trusting a stored id — a task written last term must not still
reach a child who has since left the class.

## A launch, not a send

Opening a task creates a `task_launches` row and hangs every paper off it. The
same task opened to 7א in September and to 7ב in March is two openings with two
rosters and two sets of results, and a child can sit the same task twice
because the second opening is a second paper rather than a write to the first.

## Many targets, one refusal

A launch takes a LIST of targets — three sub-groups and two individual children
is one opening, not five. Every one of them is resolved through the same gate,
and **one unauthorised id refuses the whole launch** rather than quietly
sending to the rest: a teacher who selected five things and was told "sent"
must not have to count the recipients to discover only four went.

Notification ids are deterministic — `task_assigned:{launch_id}:{learner_id}` —
which is the whole contract of that lane: a retry or a double click cannot ring
a bell that already rang. Keyed by launch rather than by task, so a genuine
second opening *does* ring, because it is genuinely a new assignment.
"""

from __future__ import annotations

from typing import Any, Optional

from app.brain import org
from app.services import notifications, subgroups
from app.services.tasks import store


class AssignError(Exception):
    """A refusal the caller may see. The message is a stable code."""


async def resolve_one(teacher_id: str, target: dict[str, Any]) -> list[str]:
    """The learners one target reaches, as of now — never as of when it was set.

    A group and a sub-group both resolve through the live roster. A single
    learner is checked individually, because a target written by the chat
    builder is ultimately a model-supplied id.
    """
    kind, target_id = str(target.get("kind") or ""), str(target.get("id") or "")
    if not target_id:
        raise AssignError("bad_target")

    if kind == "learner":
        if not await org.teacher_can_access_learner(teacher_id, target_id):
            raise AssignError("not_authorized")
        return [target_id]

    if kind == "group":
        if not await org.teacher_can_access_group(teacher_id, target_id):
            raise AssignError("not_authorized")
        if await org.get_group(target_id) is None:
            # An admin passes the access check on any id, including one that was
            # never a group — the same hole `subgroups._authorize` closes.
            raise AssignError("not_authorized")
        return list(await org.learners_in_group(target_id))

    if kind == "subgroup":
        try:
            return await subgroups.members_of(teacher_id, target_id)
        except subgroups.SubgroupError as error:
            raise AssignError("not_authorized" if str(error) in
                              ("not_found", "not_authorized") else str(error))

    raise AssignError("bad_target")


async def resolve_target(teacher_id: str, task: dict[str, Any]) -> list[str]:
    """The learners a task's own default target reaches.

    Kept because `create_task` still validates that its default target is
    reachable before anything is generated — finding out that a task can reach
    nobody *after* paying for four generation passes is the wrong order.
    """
    return await resolve_one(teacher_id, task.get("target") or {})


async def resolve_targets(
    teacher_id: str, targets: list[dict[str, Any]],
) -> list[str]:
    """The union of several targets, de-duplicated, order preserved.

    A child in two of the selected sub-groups gets one paper, not two.
    """
    if not targets:
        raise AssignError("bad_target")
    learners: list[str] = []
    for target in targets:
        learners.extend(await resolve_one(teacher_id, target))
    return list(dict.fromkeys(learners))


async def _owned(teacher_id: str, task_id: str) -> dict[str, Any]:
    task = await store.get_task(task_id)
    if task is None or task.get("teacher_id") != teacher_id:
        # "Not yours" and "does not exist" are the same refusal.
        raise AssignError("not_authorized")
    return task


async def launch(
    teacher_id: str, task_id: str, *,
    targets: Optional[list[dict[str, Any]]] = None,
    due_at: Optional[str] = None,
) -> dict[str, Any]:
    """Open the task to these targets: a new launch, frozen papers, one bell each.

    Falls back to the task's own default target when none is given, which is
    what keeps the chat-built path and the older clients working.
    """
    task = await _owned(teacher_id, task_id)
    if task.get("status") in ("draft", "generating"):
        raise AssignError("not_ready")

    chosen = targets if targets else [task.get("target") or {}]
    learner_ids = await resolve_targets(teacher_id, chosen)
    if not learner_ids:
        raise AssignError("no_learners")

    row = await store.create_launch(
        task_id, teacher_id=teacher_id, group_id=str(task.get("group_id") or ""),
        targets=chosen, learner_ids=learner_ids, due_at=due_at,
    )
    launch_id = str(row["_id"])
    result = await store.activate(launch_id, learner_ids, due_at=due_at)
    await store.update_task(task_id, status="live",
                            deadline=due_at or task.get("deadline"))

    title = (task.get("spec") or {}).get("title") or ""
    for learner_id in result["activated"]:
        await notifications.notify(
            learner_id,
            notifications.KIND_TASK_ASSIGNED,
            notification_id=f"task_assigned:{launch_id}:{learner_id}",
            title_key="notif.task.assigned",
            body_key="notif.task.assignedBody",
            params={"title": title},
            actions=[{"label_key": "notif.action.openTask",
                      "route": f"/tasks/{launch_id}"}],
            actor_id=teacher_id,
            recipient_role="learner",
        )

    return {"task_id": task_id, "launch_id": launch_id, "seq": row["seq"],
            "assigned": len(result["activated"]),
            "already_assigned": len(result["already_active"]),
            "learner_ids": result["activated"]}


async def close(
    teacher_id: str, task_id: str, *, launch_id: Optional[str] = None,
) -> dict[str, Any]:
    """Stop accepting work — on one opening, or on all of them.

    Activations and attempts are kept either way: a closed task is still the
    evidence behind every grade it produced.
    """
    task = await _owned(teacher_id, task_id)
    launches = await store.list_launches(task_id)
    doomed = ([row for row in launches if row["_id"] == launch_id]
              if launch_id else launches)
    if launch_id and not doomed:
        raise AssignError("not_found")

    for row in doomed:
        await store.set_launch_status(str(row["_id"]), "closed")

    remaining = await store.list_launches(task_id)
    status = store.derived_status({**task, "status": "closed"}, remaining)
    await store.update_task(task_id, status=status)
    return {"task_id": task_id, "status": status,
            "closed": [str(row["_id"]) for row in doomed]}


async def reopen(teacher_id: str, task_id: str, launch_id: str) -> dict[str, Any]:
    """Take an opening off the shelf so it accepts work again.

    Nothing is regenerated and nobody is re-notified: the children who had this
    paper still have exactly the paper they had, which is the point — reopening
    is for the child who was away on the day, not for a fresh round. A fresh
    round is a new launch.
    """
    task = await _owned(teacher_id, task_id)
    row = await store.get_launch(launch_id)
    if row is None or row.get("task_id") != task_id:
        raise AssignError("not_found")

    await store.set_launch_status(launch_id, "active")
    launches = await store.list_launches(task_id)
    status = store.derived_status(task, launches)
    await store.update_task(task_id, status=status)
    return {"task_id": task_id, "launch_id": launch_id, "status": status}
