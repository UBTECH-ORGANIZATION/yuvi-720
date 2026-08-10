"""Teacher approval of a learner's goal → sparks, honestly.

The hard part is already built. `mentoring.update_goal_progress(..., "summarized")`
runs `_save_conversation`, `_project_goals` and `wallet.grant_goal_stage`, all
under test. This module adds the approval semantics on top and does **not**
build a parallel path — a second way to grant sparks is a second way to grant
them twice.

Three independent layers stop a double grant:

1. the ledger's deterministic `_id` (`earn:{lid}:goal:{gid}:summarized`),
2. the `approved_by` stamp checked before any I/O,
3. the deterministic notification id.

**The consequence to be honest about:** approving a goal the learner already
summarized themselves grants **zero** sparks, because the ledger row exists. The
result says so (`granted: 0`) and the notification uses a different key. Faking a
grant would be easy and would corrupt the wallet; telling the teacher "they
already earned these" is the truthful version.

Likewise `DAILY_GOAL_CAP`: the fifth approval in a day quietly pays nothing, so
`capped` is surfaced rather than swallowed.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional


class ApprovalError(ValueError):
    """Carries a machine-readable `code` the route turns into a status."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _find_goal(record: dict[str, Any], goal_id: str) -> Optional[dict[str, Any]]:
    for goal in record.get("goals") or []:
        if goal.get("id") == goal_id and not goal.get("deleted"):
            return goal
    return None


async def approve_goal(
    teacher_id: str,
    learner_id: str,
    conversation_id: str,
    goal_id: str,
    *,
    teacher_note: str = "",
    language: str = "he",
) -> dict[str, Any]:
    """Approve one goal. Idempotent, scoped, and honest about what was granted."""
    from app.brain import org
    from app.services import mentoring, notifications

    if not await org.teacher_can_access_learner(teacher_id, learner_id):
        raise ApprovalError("not_authorized")

    record = await mentoring._load_conversation(learner_id, conversation_id)
    if record is None or record.get("deleted"):
        raise ApprovalError("conversation_not_found")
    goal = _find_goal(record, goal_id)
    if goal is None:
        raise ApprovalError("goal_not_found")

    # Domain idempotency, checked before any write. Cheaper than relying on the
    # ledger to reject the duplicate, and it lets the caller distinguish "already
    # done" from "done just now" — which the UI needs to avoid a second toast.
    if goal.get("approved_by"):
        return {
            "already_approved": True,
            "approved_by": goal["approved_by"],
            "approved_at": goal.get("approved_at"),
            "granted": 0,
            "capped": False,
            "goal": {"id": goal_id, "title": goal.get("title")},
        }

    already_summarized = goal.get("progress_stage") == "summarized"

    goal["approved_by"] = teacher_id
    goal["approved_at"] = _now()
    if teacher_note.strip():
        goal["teacher_note"] = teacher_note.strip()[:400]
    await mentoring._save_conversation(learner_id, record)

    # The one tested path to sparks. Returns `{"granted": n, "wallet": ...}`; a
    # goal the learner already summarized grants 0 because the ledger row exists.
    result = await mentoring.update_goal_progress(
        learner_id, conversation_id, goal_id, "summarized"
    )
    reward = (result or {}).get("reward") or {}
    granted = int(reward.get("granted") or 0)
    # The daily cap pays nothing on the fifth goal of a day. That is not the same
    # as "this goal was worth nothing", and the teacher should not have to guess
    # which one happened.
    capped = bool(reward.get("capped")) or (
        granted == 0 and not already_summarized and bool(goal.get("reward_value"))
    )

    await notifications.notify(
        learner_id,
        notifications.KIND_GOAL_APPROVED,
        notification_id=f"goal_approved:{goal_id}",
        title_key=("notif.goal.approved.withSparks" if granted
                   else "notif.goal.approved.noSparks"),
        params={"title": goal.get("title") or "", "sparks": granted},
        actions=[{
            "label_key": "notif.action.openGoal",
            # The deep link. `useRoute()` includes the search string, so the
            # mentoring page can select the conversation and scroll the goal in.
            "route": f"/mentoring?conversation={conversation_id}&goal={goal_id}",
        }],
        actor_id=teacher_id,
        recipient_role="learner",
    )

    return {
        "already_approved": False,
        "approved_by": teacher_id,
        "approved_at": goal["approved_at"],
        "granted": granted,
        # True when the learner had already banked these sparks themselves.
        "already_earned": already_summarized and granted == 0,
        "capped": capped,
        "wallet": reward.get("wallet"),
        "goal": {"id": goal_id, "title": goal.get("title")},
    }


async def assign_goal(
    teacher_id: str,
    learner_id: str,
    goal: dict[str, Any],
    *,
    language: str = "he",
) -> dict[str, Any]:
    """Create a teacher-authored goal on a learner's profile.

    Routed through the ordinary `mentoring.create_conversation` with
    `author="teacher"` so `_new_goal`, `_project_goals`, `pricing.price_goal` and
    the LRS `student-goal initialized` report (which already attaches
    `instructor_exid` for teacher-authored goals) all run once, in the path that
    is already tested.

    A teacher-assigned goal is worth sparks exactly like a self-authored one —
    the child still does the work.
    """
    from app.brain import org
    from app.services import mentoring, notifications

    if not await org.teacher_can_access_learner(teacher_id, learner_id):
        raise ApprovalError("not_authorized")

    title = (goal.get("title") or "").strip()
    if not title:
        raise ApprovalError("title_required")

    record = await mentoring.create_conversation({
        "learner_id": learner_id,
        "author": "teacher",
        "teacher_id": teacher_id,
        "language": language,
        "source": "teacher",
        "visible_to_learner": True,
        "goals": [{
            "title": title,
            "next_steps": (goal.get("next_steps") or "").strip(),
            "deadline": goal.get("deadline") or "",
        }],
    })

    created = (record.get("goals") or [{}])[0]
    await notifications.notify(
        learner_id,
        notifications.KIND_GOAL_ASSIGNED,
        notification_id=f"goal_assigned:{created.get('id')}",
        title_key="notif.goal.assigned",
        params={"title": title},
        actions=[{
            "label_key": "notif.action.openGoal",
            "route": f"/mentoring?conversation={record.get('id')}&goal={created.get('id')}",
        }],
        actor_id=teacher_id,
        recipient_role="learner",
    )
    return record


async def assign_to_group(
    teacher_id: str,
    group_id: str,
    learner_ids: list[str],
    goal: dict[str, Any],
    *,
    language: str = "he",
) -> dict[str, Any]:
    """One goal to a sub-group — the actionable form of "split into sub-groups".

    Each learner is checked individually rather than trusting the group: the list
    arrives from the client, and a learner id that is not actually in this
    teacher's group must be refused, not assigned to.
    """
    from app.brain import org

    if not await org.teacher_can_access_group(teacher_id, group_id):
        raise ApprovalError("not_authorized")

    title = (goal.get("title") or "").strip()
    if not title:
        raise ApprovalError("title_required")

    enrolled = set(await org.learners_in_group(group_id))
    assigned, skipped = [], []
    for learner_id in learner_ids[:60]:
        if learner_id not in enrolled:
            skipped.append({"learner_id": learner_id, "reason": "not_in_group"})
            continue
        # A double-click, a retried request, or a teacher re-opening the panel
        # must not fan the same goal out twice. Scoped to the week so the same
        # objective can legitimately be set again next week.
        if await _already_assigned_this_week(learner_id, title):
            skipped.append({"learner_id": learner_id, "reason": "already_assigned_this_week"})
            continue
        try:
            await assign_goal(teacher_id, learner_id, goal, language=language)
            assigned.append(learner_id)
        except ApprovalError as exc:
            skipped.append({"learner_id": learner_id, "reason": exc.code})
    return {"assigned": assigned, "skipped": skipped}


def _week_key(value: str) -> str:
    """ISO year-week of a timestamp, for the assignment dedupe window."""
    from datetime import datetime

    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return ""
    year, week, _ = parsed.isocalendar()
    return f"{year}-W{week:02d}"


async def _already_assigned_this_week(learner_id: str, title: str) -> bool:
    """Has this learner already been given a goal with this title this week?

    Compared on the normalized title rather than an id, because the teacher is
    assigning the *same* goal to several learners — each gets its own goal id, so
    ids cannot dedupe across a double-click.
    """
    from datetime import datetime, timezone

    from app.services import mentoring

    wanted = title.strip().casefold()
    now_week = _week_key(datetime.now(timezone.utc).isoformat())
    try:
        conversations = await mentoring.list_conversations(learner_id, viewer_role="teacher")
    except Exception:      # a lookup failure must not block a real assignment
        return False

    for conversation in conversations or []:
        if conversation.get("author") != "teacher":
            continue
        stamp = conversation.get("created_at") or conversation.get("date") or ""
        if _week_key(stamp) != now_week:
            continue
        for existing in conversation.get("goals") or []:
            if (existing.get("title") or "").strip().casefold() == wanted:
                return True
    return False
