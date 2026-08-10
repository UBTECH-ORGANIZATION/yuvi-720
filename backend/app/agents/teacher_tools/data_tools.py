"""Data tools — group, student and live reads.

Two contracts every tool in this file keeps.

**No PII reaches the model.** `student_insights` and `group_insights` both carry
`display_name`, because the teacher UI needs it. The model must not see it, so
`scrub()` strips the key recursively on the way out — structurally, rather than
by each tool remembering. The model refers to a learner as `{{student:<id>}}`
and `StudentRef.tsx` substitutes the real name at render time: the model never
sees a name, the teacher always does.

**Emptiness is explicit, never silent.** Every tool returns
`{"data": None, "reason": "..."}` rather than `{}` or `[]` when there is nothing
to report. A student with no activity must produce "אין נתונים" — never "0%".
An empty dict reads to a model as a zero, and a teacher acting on a fabricated
zero is the exact failure this phase is built to prevent.
"""

from __future__ import annotations

from typing import Any

from app.agents.teacher_tools.registry import TeacherTool, TeacherToolContext, register

# Keys that must never leave the server inside a tool result.
_PII_KEYS = {"display_name", "full_name", "username", "email", "national_id"}


def scrub(value: Any) -> Any:
    """Recursively drop PII keys from a tool result."""
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items() if k not in _PII_KEYS}
    if isinstance(value, list):
        return [scrub(item) for item in value]
    return value


def empty(reason: str, **extra: Any) -> dict[str, Any]:
    """The honest no-data shape (anti-hallucination layer 3)."""
    return {"data": None, "reason": reason, **extra}


# ── group ────────────────────────────────────────────────────────────────────

async def _list_my_groups(context: TeacherToolContext, args: dict) -> dict:
    from app.brain import org

    groups = await org.groups_for_teacher(context.teacher_id)
    if not groups:
        return empty("teacher_has_no_groups")
    return {"data": [
        {"group_id": group.get("_id"), "name": group.get("name"),
         "subject": group.get("subject"), "grade": group.get("grade")}
        for group in groups
    ]}


async def _list_students(context: TeacherToolContext, args: dict) -> dict:
    """Ids only. The model needs to know who exists, not who they are.

    Also the guard against invented ids: the prompt instructs the model to call
    this before assuming any learner id, so a hallucinated id fails closed.
    """
    from app.brain import org

    group_id = args.get("group_id")
    learner_ids = (
        await org.learners_in_group(str(group_id)) if group_id
        else sorted(context.allowed_learner_ids)
    )
    if not learner_ids:
        return empty("group_has_no_students" if group_id else "teacher_has_no_students")
    return {"data": [{"learner_id": learner_id} for learner_id in learner_ids],
            "note": "refer to a student as {{student:<learner_id>}}"}


async def _get_group_snapshot(context: TeacherToolContext, args: dict) -> dict:
    from app.services import insights

    result = await insights.group_insights(str(args["group_id"]), language=context.language)
    if not (result.get("students") or []):
        return empty("group_has_no_students")
    return {"data": scrub(result)}


async def _get_group_engagement(context: TeacherToolContext, args: dict) -> dict:
    from app.services import group_analytics

    days = int(args.get("days") or 7)
    result = await group_analytics.engagement(str(args["group_id"]), days=days)
    if not result or not result.get("students_total"):
        return empty("group_has_no_students", days=days)
    return {"data": scrub(result)}


async def _get_group_learning_gaps(context: TeacherToolContext, args: dict) -> dict:
    from app.services import group_analytics

    gaps = await group_analytics.learning_gaps(
        str(args["group_id"]), subject=args.get("subject") or None
    )
    if not gaps:
        return empty("no_objective_meets_the_gap_threshold")
    # `learner_ids` is present so the teacher UI can act on the sub-group. The
    # model has no use for it and every reason not to hold a roster slice, so
    # it is dropped here rather than scrubbed generically.
    return {"data": [
        {k: v for k, v in scrub(gap).items() if k != "learner_ids"} for gap in gaps
    ]}


# ── student ──────────────────────────────────────────────────────────────────

async def _get_student_overview(context: TeacherToolContext, args: dict) -> dict:
    from app.services import insights

    learner_id = str(args["learner_id"])
    result = await insights.student_insights(
        learner_id, language=context.language, subject=args.get("subject") or None
    )
    if not result.get("progress") and not result.get("struggle_items"):
        return empty("learner_has_no_activity", learner_id=learner_id)
    return {"data": scrub(result)}


async def _get_student_mastery(context: TeacherToolContext, args: dict) -> dict:
    from app.brain.context_engine import view_for

    learner_id = str(args["learner_id"])
    view = await view_for("teacher_assistant", learner_id)
    mastery = view.get("mastery") or {}
    if not mastery:
        return empty("learner_has_no_mastery_evidence", learner_id=learner_id)
    return {"data": {"mastery": scrub(mastery), "progress": view.get("progress") or {}}}


async def _get_student_activity(context: TeacherToolContext, args: dict) -> dict:
    from app.services import learner_activity

    learner_id = str(args["learner_id"])
    limit = int(args.get("limit") or 20)
    rows = await learner_activity.question_summary(
        learner_id, subject=args.get("subject") or None
    )
    if not rows:
        return empty("no_events_in_window", learner_id=learner_id)
    return {"data": scrub(rows[:limit])}


async def _get_student_goals(context: TeacherToolContext, args: dict) -> dict:
    from app.services import mentoring

    learner_id = str(args["learner_id"])
    conversations = await mentoring.list_conversations(learner_id, viewer_role="teacher")
    goals = [goal for row in (conversations or []) for goal in (row.get("goals") or [])]
    if not goals:
        return empty("learner_has_no_goals", learner_id=learner_id)
    return {"data": scrub(goals)}


async def _get_student_reflections(context: TeacherToolContext, args: dict) -> dict:
    from app.brain.context_engine import view_for

    learner_id = str(args["learner_id"])
    view = await view_for("teacher_assistant", learner_id)
    reflections = view.get("reflections_recent") or []
    if not reflections:
        return empty("learner_has_no_reflections", learner_id=learner_id)
    return {"data": scrub(reflections)}


async def _get_teacher_notes(context: TeacherToolContext, args: dict) -> dict:
    from app.services import teacher_insights_store

    learner_id = str(args["learner_id"])
    # Scoped to this teacher's own notes: another teacher's private note about a
    # shared student is theirs, not assistant fuel.
    notes = await teacher_insights_store.list_for(learner_id, teacher_id=context.teacher_id)
    if not notes:
        return empty("no_teacher_notes", learner_id=learner_id)
    return {"data": scrub(notes)}


async def _get_student_description(context: TeacherToolContext, args: dict) -> dict:
    """The curated projection — deliberately NOT the learner's private memory."""
    from app.brain.context_engine import view_for

    learner_id = str(args["learner_id"])
    view = await view_for("teacher_assistant", learner_id)
    description = view.get("student_description") or {}
    if not description:
        return empty("no_description_yet", learner_id=learner_id)
    return {"data": scrub(description)}


# ── live ─────────────────────────────────────────────────────────────────────

async def _get_my_alerts(context: TeacherToolContext, args: dict) -> dict:
    from app.services import teacher_alerts

    alerts = await teacher_alerts.list_alerts(
        context.teacher_id, status=teacher_alerts.LIVE, limit=int(args.get("limit") or 20)
    )
    if not alerts:
        return empty("no_open_alerts")
    return {"data": scrub(alerts)}


async def _get_live_classroom(context: TeacherToolContext, args: dict) -> dict:
    from app.services import presence

    group_id = str(args["group_id"])
    snapshot = await presence.snapshot_for_group(group_id)
    if not snapshot:
        return empty("group_has_no_students")
    return {"data": scrub(snapshot)}


# ── registration ─────────────────────────────────────────────────────────────

_GROUP_ID = {"group_id": {"type": "string", "description": "A group id from list_my_groups."}}
_LEARNER_ID = {"learner_id": {"type": "string", "description": "A learner id from list_students."}}


def register_all() -> None:
    register(TeacherTool(
        name="list_my_groups",
        description="The groups this teacher teaches. Call before any group tool.",
        parameters={"type": "object", "properties": {}},
        handler=_list_my_groups,
    ))
    register(TeacherTool(
        name="list_students",
        description=(
            "Learner ids in a group, or across all the teacher's groups. "
            "Call this before assuming any learner id exists."
        ),
        parameters={"type": "object", "properties": dict(_GROUP_ID)},
        handler=_list_students, group_args=("group_id",),
    ))
    register(TeacherTool(
        name="get_group_snapshot",
        description="Group overview: totals, active count, and who needs attention with evidence.",
        parameters={"type": "object", "properties": dict(_GROUP_ID), "required": ["group_id"]},
        handler=_get_group_snapshot, group_args=("group_id",),
    ))
    register(TeacherTool(
        name="get_group_engagement",
        description="Engagement for a group over a window: active share and average active minutes.",
        parameters={"type": "object", "properties": {
            **_GROUP_ID,
            "days": {"type": "integer", "description": "Window in days (default 7)."},
        }, "required": ["group_id"]},
        handler=_get_group_engagement, group_args=("group_id",),
    ))
    register(TeacherTool(
        name="get_group_learning_gaps",
        description=(
            "Objectives a meaningful share of the group struggles with, or excels at. "
            "Counts only — never a ranking of students."
        ),
        parameters={"type": "object", "properties": {
            **_GROUP_ID,
            "subject": {"type": "string", "description": "Optional subject filter."},
        }, "required": ["group_id"]},
        handler=_get_group_learning_gaps, group_args=("group_id",),
    ))
    register(TeacherTool(
        name="get_student_overview",
        description="One student: progress, struggle items, strengths and attention flags, each with evidence.",
        parameters={"type": "object", "properties": {
            **_LEARNER_ID,
            "subject": {"type": "string", "description": "Optional subject filter."},
        }, "required": ["learner_id"]},
        handler=_get_student_overview, learner_args=("learner_id",),
    ))
    register(TeacherTool(
        name="get_student_mastery",
        description="Per-objective mastery for one student, derived from real events only.",
        parameters={"type": "object", "properties": dict(_LEARNER_ID), "required": ["learner_id"]},
        handler=_get_student_mastery, learner_args=("learner_id",),
    ))
    register(TeacherTool(
        name="get_student_activity",
        description="Recent per-question activity for one student, including what the AI coach tried.",
        parameters={"type": "object", "properties": {
            **_LEARNER_ID,
            "limit": {"type": "integer", "description": "How many questions (default 20)."},
            "subject": {"type": "string", "description": "Optional subject filter."},
        }, "required": ["learner_id"]},
        handler=_get_student_activity, learner_args=("learner_id",),
    ))
    register(TeacherTool(
        name="get_student_goals",
        description="Goals for one student: self-authored and teacher-assigned, with approval state.",
        parameters={"type": "object", "properties": dict(_LEARNER_ID), "required": ["learner_id"]},
        handler=_get_student_goals, learner_args=("learner_id",),
    ))
    register(TeacherTool(
        name="get_student_reflections",
        description="The student's recent self-ratings, for comparing self-view against evidence.",
        parameters={"type": "object", "properties": dict(_LEARNER_ID), "required": ["learner_id"]},
        handler=_get_student_reflections, learner_args=("learner_id",),
    ))
    register(TeacherTool(
        name="get_student_description",
        description=(
            "How the system sees this learner — a curated, evidence-backed summary. "
            "This is NOT the student's private conversations with the AI companion."
        ),
        parameters={"type": "object", "properties": dict(_LEARNER_ID), "required": ["learner_id"]},
        handler=_get_student_description, learner_args=("learner_id",),
    ))
    register(TeacherTool(
        name="get_teacher_notes",
        description="Notes this teacher recorded about a student.",
        parameters={"type": "object", "properties": dict(_LEARNER_ID), "required": ["learner_id"]},
        handler=_get_teacher_notes, learner_args=("learner_id",),
    ))
    register(TeacherTool(
        name="get_my_alerts",
        description="This teacher's open alerts, newest first, each with its raw evidence.",
        parameters={"type": "object", "properties": {
            "limit": {"type": "integer", "description": "How many (default 20)."},
        }},
        handler=_get_my_alerts,
    ))
    register(TeacherTool(
        name="get_live_classroom",
        description="Who in a group is online, in a lesson, struggling, or has asked for help right now.",
        parameters={"type": "object", "properties": dict(_GROUP_ID), "required": ["group_id"]},
        handler=_get_live_classroom, group_args=("group_id",),
    ))
