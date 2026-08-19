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
    lrs_session_id: Optional[str] = None,
) -> dict[str, Any]:
    """Create a teacher-authored goal on a learner's profile.

    Routed through the ordinary `mentoring.create_conversation` with
    `author="teacher"` so `_new_goal`, `_project_goals` and `rewards.price_goal`
    all run once, in the path that is already tested.

    `lrs_session_id` is the teacher's MoE session. It has to be passed in
    because the reporting used to live in the learner's route, which this
    function does not go through — so until now a teacher-assigned goal
    produced **no xAPI at all**, while the docstring here claimed it did.

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
        "lrs_session_id": lrs_session_id,
        "goals": [{
            "title": title,
            "next_steps": (goal.get("next_steps") or "").strip(),
            "deadline": goal.get("deadline") or "",
            # `_new_goal` validates it; unknown shapes become None, so the
            # client cannot invent a trackable action that does not exist.
            "action": goal.get("action"),
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


# A talk produces a handful of goals, not a backlog. The cap is a sanity bound
# on a client payload, not a pedagogical opinion.
MAX_GOALS_PER_CONVERSATION = 6
_MAX_TITLE = 120
_MAX_NEXT_STEPS = 600


async def document_conversation(
    teacher_id: str,
    learner_id: str,
    *,
    notes: str = "",
    goals: Optional[list[dict[str, Any]]] = None,
    meeting_stage: str = "",
    teacher_only_note: str = "",
    visibility: str = "shared",
    draft_id: str = "",
    language: str = "he",
    lrs_session_id: Optional[str] = None,
) -> dict[str, Any]:
    """Record a mentoring conversation a teacher had, with the goals it produced.

    This is the write behind the mentoring page, and the reason it exists is
    that `assign_goal` creates **one conversation per goal**. A teacher who
    agreed three things in one talk got three unrelated records, none of which
    held what was actually discussed.

    Everything that must happen exactly once falls out of the single
    `create_conversation` call: pricing loops the goals before the insert,
    `_project_goals` rebuilds the brain mirror after it, and the LRS report
    sends one meeting plus one statement per shared goal. The notification is
    one bell for the conversation, not one per goal.

    Deliberately **not** deduped by title the way `assign_to_group` is: several
    goals in one talk are intentional, and re-setting last week's objective
    after this week's conversation is the normal case, not a double-click. The
    accident this actually needs protection from is a resubmitted form, which
    is what `draft_id` is for.
    """
    from app.brain import org
    from app.services import mentoring, notifications

    if not await org.teacher_can_access_learner(teacher_id, learner_id):
        raise ApprovalError("not_authorized")

    cleaned: list[dict[str, Any]] = []
    for goal in (goals or [])[:MAX_GOALS_PER_CONVERSATION]:
        if not isinstance(goal, dict):
            continue
        title = (goal.get("title") or "").strip()[:_MAX_TITLE]
        next_steps = (goal.get("next_steps") or "").strip()[:_MAX_NEXT_STEPS]
        if not title and not next_steps:
            continue
        cleaned.append({
            "title": title,
            "next_steps": next_steps,
            "deadline": goal.get("deadline") or "",
            # `_new_goal` normalizes this against the closed vocabulary, so an
            # invented action degrades to an untracked goal rather than an error.
            "action": goal.get("action"),
        })

    notes = (notes or "").strip()
    # A talk with no goal is still a talk worth recording; a submission with
    # neither notes nor goals is an empty form.
    if not notes and not cleaned:
        raise ApprovalError("empty_conversation")

    # A resubmit — a double-click, a retry, a back-then-forward — must not
    # produce a second record. Pricing runs a model call per goal, so the
    # window where the button is still live is seconds wide, not milliseconds.
    if draft_id:
        existing = await _conversation_for_draft(learner_id, draft_id)
        if existing is not None:
            return existing

    record = await mentoring.create_conversation({
        "learner_id": learner_id,
        "author": "teacher",
        "teacher_id": teacher_id,
        "source": "teacher",
        "language": language,
        "visibility": "teacher_only" if visibility == "teacher_only" else "shared",
        "meeting_stage": meeting_stage,
        "notes": notes,
        "teacher_only_note": (teacher_only_note or "").strip(),
        "draft_id": draft_id or None,
        "lrs_session_id": lrs_session_id,
        "goals": cleaned,
    })

    # One bell for the conversation. N goals were agreed in one sitting, so N
    # notifications would be one conversation ringing a child's phone six times.
    # Nothing is sent for a teacher-only record: the child cannot open it, so
    # the notification would be a dead link.
    if record.get("visibility") == "shared":
        await notifications.notify(
            learner_id,
            notifications.KIND_GOAL_ASSIGNED,
            notification_id=f"mentoring_documented:{record.get('id')}",
            title_key=(
                "notif.mentoring.documented" if cleaned
                else "notif.mentoring.documented.noGoals"
            ),
            params={"count": len(cleaned)},
            actions=[{
                "label_key": "notif.action.openGoal",
                "route": f"/mentoring?conversation={record.get('id')}",
            }],
            actor_id=teacher_id,
            recipient_role="learner",
        )
    return record


async def _conversation_for_draft(learner_id: str, draft_id: str) -> Optional[dict[str, Any]]:
    """The conversation already written for this composer draft, if any."""
    from app.services import mentoring
    try:
        rows = await mentoring.list_conversations(learner_id, "teacher")
    except Exception:      # a lookup failure must not block a legitimate write
        return None
    return next((row for row in rows if row.get("draft_id") == draft_id), None)


async def assign_to_group(
    teacher_id: str,
    group_id: str,
    learner_ids: list[str],
    goal: dict[str, Any],
    *,
    language: str = "he",
    lrs_session_id: Optional[str] = None,
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
            await assign_goal(
                teacher_id, learner_id, goal,
                language=language, lrs_session_id=lrs_session_id,
            )
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
