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

from typing import Any, Optional

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


#: Filters that turn a description of a set into the actual ids in it.
#:
#: This exists because of an observed failure: asked about "the inactive
#: students", the assistant said it had no way to list them — untrue, the data
#: was two tool calls away — and then drafted a goal for one arbitrary child.
#: Nothing named a source for "who matches this description", so the model
#: guessed. `help_tools.ROSTER_FILTERS` deep-links the roster with these same
#: four words; a contract test keeps the two sets from drifting.
ROSTER_FILTERS = {"attention", "not_started", "active", "inactive"}

#: What "hasn't been here in a while" means when the teacher doesn't say.
DEFAULT_INACTIVE_DAYS = 7


def _matches(student: dict[str, Any], wanted: str, days: int) -> bool:
    """Whether one snapshot row is in the described set.

    `inactive` is deliberately not a status. The three statuses are about a
    learner's standing (needs attention / never started / progressing) and are
    mutually exclusive; "has not been seen in N days" cuts across all three — an
    `attention` learner is usually also inactive, and both facts are true.
    """
    if wanted == "inactive":
        elapsed = (student.get("activity") or {}).get("days_inactive")
        return isinstance(elapsed, (int, float)) and elapsed >= days
    return student.get("status") == wanted


async def _list_students(context: TeacherToolContext, args: dict) -> dict:
    """Ids only. The model needs to know who exists, not who they are.

    Also the guard against invented ids: the prompt instructs the model to call
    this before assuming any learner id, so a hallucinated id fails closed.

    With a `filter`, it answers the harder question — *which* of them match a
    description the teacher gave. Ids only there too: this resolves a set, and
    the per-student evidence behind it lives in `get_group_snapshot`.
    """
    from app.brain import org

    group_id = args.get("group_id")
    learner_ids = (
        await org.learners_in_group(str(group_id)) if group_id
        else sorted(context.allowed_learner_ids)
    )
    if not learner_ids:
        return empty("group_has_no_students" if group_id else "teacher_has_no_students")

    wanted = str(args.get("filter") or "").strip().lower()
    if not wanted:
        return {"data": [{"learner_id": learner_id} for learner_id in learner_ids],
                "note": "refer to a student as {{student:<learner_id>}}"}

    if wanted not in ROSTER_FILTERS:
        # Named, not silently ignored: a filter the model invented must not come
        # back looking like the whole class matched it.
        return empty("unknown_filter", filter=wanted,
                     supported=sorted(ROSTER_FILTERS))

    try:
        days = int(args.get("days") or DEFAULT_INACTIVE_DAYS)
    except (TypeError, ValueError):
        days = DEFAULT_INACTIVE_DAYS
    days = max(1, min(90, days))

    from app.services import insights

    # One snapshot per group the teacher owns, then filtered. Bounded by the
    # staff member's group list, and `group_insights` is the same call
    # `get_group_snapshot` makes — so the two tools can never disagree about
    # who is inactive.
    group_ids = [str(group_id)] if group_id else sorted(context.allowed_group_ids)
    allowed = set(learner_ids)
    matched: list[str] = []
    seen: set[str] = set()
    for gid in group_ids:
        snapshot = await insights.group_insights(gid, language=context.language)
        for student in (snapshot.get("students") or []):
            student_id = student.get("learner_id")
            if not student_id or student_id in seen or student_id not in allowed:
                continue
            if _matches(student, wanted, days):
                seen.add(student_id)
                matched.append(student_id)

    if not matched:
        return empty("no_students_match_filter", filter=wanted,
                     **({"days": days} if wanted == "inactive" else {}))

    return {
        "data": [{"learner_id": learner_id} for learner_id in matched],
        "filter": wanted,
        **({"days": days} if wanted == "inactive" else {}),
        "note": "these are ALL the students matching that description — "
                "draft for all of them, or ask the teacher which ones",
    }


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
    # `learner_ids` / `mastered_ids` are present so the teacher UI can act on
    # the sub-group and show whose it is. The model has no use for either and
    # every reason not to hold a roster slice, so they are dropped here rather
    # than scrubbed generically.
    dropped = {"learner_ids", "mastered_ids"}
    return {"data": [
        {k: v for k, v in scrub(gap).items() if k not in dropped} for gap in gaps
    ]}


# ── learnings ────────────────────────────────────────────────────────────────
# The lesson-shaped question — "which learning did they struggle with most?" —
# had no tool behind it, so the assistant answered "אין מספיק נתונים" about a
# screen the teacher can open in two clicks. `/teacher/learnings` was reading
# `learning_analytics` the whole time; the model simply had no door to it.

#: The catalogue is the listing's spine, so most rows are lessons nobody has
#: opened. Untouched rows are the answer to "what haven't they done yet" and
#: noise for anything else, so they are counted rather than listed.
MAX_LEARNING_ROWS = 12
MAX_HARD_QUESTIONS = 3


def _learning_title(row: dict[str, Any]) -> Optional[str]:
    """A name a teacher would recognise, never an id worn as a title.

    A learning the class worked that the catalogue no longer publishes carries
    its own component id in `title` — that is the listing's deliberate fallback,
    because the row must still appear. Read aloud in an answer it becomes
    "הלומדה שהכי התקשו בה היא ENG.G7.FAMILY.GRAMMAR-01", which tells a teacher
    nothing. The objective behind it usually does survive, and it is a name.
    """
    title = str(row.get("title") or "").strip()
    component_id = str(row.get("component_id") or "").strip()
    if title and title != component_id:
        return title
    for key in ("objective_title", "unit_title"):
        fallback = str(row.get(key) or "").strip()
        if fallback:
            return fallback
    return title or None


def _learning_row(row: dict[str, Any]) -> dict[str, Any]:
    """One learning, trimmed to what an answer can be built from.

    Everything numeric here is quoted from `learning_analytics`, never derived:
    the prompt forbids arithmetic on tool output, and a success rate the model
    computed from attempts and correct would be exactly that.
    """
    hard = [
        {"question": (question.get("label") or {}).get("question")
                     or question.get("question_id"),
         "screen": (question.get("label") or {}).get("screen"),
         "attempts": question.get("attempts"),
         "correct": question.get("correct"),
         "success_rate": question.get("success_rate")}
        for question in (row.get("hard_questions") or [])[:MAX_HARD_QUESTIONS]
    ]
    rate = row.get("success_rate")
    return {
        "component_id": row.get("component_id"),
        "title": _learning_title(row),
        "unit_title": row.get("unit_title"),
        "objective_title": row.get("objective_title"),
        "subject": row.get("subject"),
        "is_assessment": row.get("is_assessment"),
        "learners_engaged": row.get("learners_engaged"),
        "group_size": row.get("group_size"),
        "attempts": row.get("attempts"),
        "correct": row.get("correct"),
        "success_rate": rate,
        # The same number as a percentage, computed HERE. The prompt forbids the
        # model doing arithmetic on tool output, which left it quoting "הצלחה של
        # 0.0" at a teacher — technically faithful and unreadable. A figure a
        # person would say is part of the tool's job, not the model's.
        "success_percent": None if rate is None else round(rate * 100),
        "struggling_count": row.get("struggling_count"),
        "hints_used": row.get("hints_used"),
        "explanations_used": row.get("explanations_used"),
        "avg_minutes_per_learner": row.get("avg_minutes_per_learner"),
        "timing_available": row.get("timing_available"),
        "last_activity_at": row.get("last_activity_at"),
        "hard_questions": hard,
    }


#: How the caller wants the list cut. Named orderings rather than a free-text
#: sort field: "hardest" has one definition in this product and the tool holds
#: it, so two teachers asking the same question get the same lesson back.
LEARNING_SORTS = {"hardest", "most_recent", "most_worked"}


def _sorted(rows: list[dict[str, Any]], sort: str) -> list[dict[str, Any]]:
    if sort == "most_recent":
        return sorted(rows, key=lambda row: row.get("last_activity_at") or "", reverse=True)
    if sort == "most_worked":
        return sorted(rows, key=lambda row: row.get("attempts") or 0, reverse=True)
    # Hardest = lowest success first, and among equals the one with more
    # evidence behind it. A row with no rate at all is not "hardest" — nobody
    # answered anything in it — so it sorts LAST rather than first, which is
    # where a naive ascending sort on `None or 0` would have put it.
    return sorted(rows, key=lambda row: (
        1 if row.get("success_rate") is None else 0,
        row.get("success_rate") or 0,
        -(row.get("attempts") or 0),
    ))


async def _get_group_learnings(context: TeacherToolContext, args: dict) -> dict:
    """What the class did in each lesson — the per-learning picture.

    This is the tool behind "which learning are they struggling with", and the
    honest answer to it is a *ranking of lessons*, which is allowed. Ranking
    students is not, and nothing here carries a learner id.
    """
    from app.services import learning_analytics

    view = await learning_analytics.group_learnings(
        str(args["group_id"]), subject=args.get("subject") or None,
        language=context.language,
    )
    started = [row for row in (view.get("learnings") or []) if row.get("started")]
    if not started:
        # Named separately from an empty group: "nobody has opened a lesson yet"
        # and "this class has no students" are different things to be told.
        return empty("no_learning_activity_yet",
                     catalog_total=(view.get("totals") or {}).get("catalog_total"))

    sort = str(args.get("sort") or "hardest").strip().lower()
    if sort not in LEARNING_SORTS:
        sort = "hardest"
    ordered = _sorted(started, sort)

    rows = [_learning_row(row) for row in ordered[:MAX_LEARNING_ROWS]]
    untouched = len(view.get("learnings") or []) - len(started)
    return {
        "data": {
            "sorted_by": sort,
            "learnings": scrub(rows),
            "totals": view.get("totals") or {},
            "subjects": view.get("subjects") or [],
            "not_started_in_catalog": max(0, untouched),
        },
        "note": "Say the figure as `success_percent` — it is already computed. "
                "Name a lesson by its `title`, never by its component_id. "
                "A ranking of LESSONS is fine; a ranking of students is not.",
    }


async def _get_learning_detail(context: TeacherToolContext, args: dict) -> dict:
    """One lesson opened up: which questions inside it went wrong."""
    from app.services import learning_analytics

    view = await learning_analytics.learning_detail(
        str(args["group_id"]), str(args["component_id"]), language=context.language,
    )
    learning = view.get("learning") or {}
    if not learning.get("started"):
        return empty("nobody_has_opened_this_learning",
                     component_id=args.get("component_id"))

    questions = sorted(
        (row for row in (view.get("questions") or []) if row.get("attempts")),
        key=lambda row: (row.get("success_rate") if row.get("success_rate") is not None else 2,
                         -(row.get("attempts") or 0)),
    )[:8]
    return {"data": scrub({
        "learning": _learning_row(learning),
        "hardest_questions": [
            {"question": (row.get("label") or {}).get("question") or row.get("question_id"),
             "screen": (row.get("label") or {}).get("screen"),
             "teaches": row.get("teaches"),
             "learners": row.get("learners"),
             "attempts": row.get("attempts"),
             "correct": row.get("correct"),
             "success_rate": row.get("success_rate"),
             "hints_used": row.get("hints_used"),
             "explanations_used": row.get("explanations_used")}
            for row in questions
        ],
    })}


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

    # An alert the teacher has now read is one they can close from here. The
    # offer carries ids only; acknowledging is a real POST from the browser.
    open_alerts = [
        {"alert_id": str(alert.get("_id")), "learner_id": alert.get("learner_id"),
         "kind": alert.get("kind"), "severity": alert.get("severity")}
        for alert in alerts if alert.get("status") == teacher_alerts.STATUS_OPEN
    ][:6]

    result: dict[str, Any] = {"data": scrub(alerts)}
    if open_alerts:
        result["offer"] = {
            "kind": "ack_alerts",
            "label_key": "tch.assistant.action.ackAlerts",
            "alerts": open_alerts,
            "params": {"count": len(open_alerts)},
            "icon": "bell",
        }
    return result


# ── the class calendar ───────────────────────────────────────────────────────

#: How far ahead "what is coming up" looks when the teacher names no window.
DEFAULT_CALENDAR_DAYS = 14

#: The most rows one answer carries. A month of a busy class is well over a
#: hundred items, and a model handed all of them summarises the middle of the
#: list rather than the next thing that matters.
MAX_CALENDAR_ITEMS = 40


async def _get_class_calendar(context: TeacherToolContext, args: dict) -> dict:
    """Everything dated in one class, over a window — the same fold the
    calendar screen renders.

    Read-only, and read from `school_calendar.collect` rather than from a
    second query of its own: a task's due date, a goal's deadline and a
    meeting all live in their own stores, and the assistant must never
    describe a week the screen would draw differently.

    Learner ids are returned, never names — `scrub` guarantees it and the
    `{{student:…}}` substitution puts the names back in the teacher's browser.
    """
    from datetime import date, timedelta

    from app.services import school_calendar

    group_id = str(args["group_id"])

    # A window the model can express either way: two explicit days, or "the
    # next N". `normalize_range` is what the route uses, so a malformed date
    # degrades to the same default month rather than to an error.
    from_day = str(args.get("from") or "").strip()
    to_day = str(args.get("to") or "").strip()
    if not from_day and not to_day:
        days = args.get("days")
        days = days if isinstance(days, int) and 1 <= days <= 120 else DEFAULT_CALENDAR_DAYS
        today = date.today()
        from_day = today.isoformat()
        to_day = (today + timedelta(days=days)).isoformat()
    start, end = school_calendar.normalize_range(from_day or None, to_day or None)

    learner_id = str(args.get("learner_id") or "").strip()
    scope = {learner_id} if learner_id else None

    items = await school_calendar.collect(group_id, start, end, scope)
    if not items:
        return empty("nothing_scheduled_in_window", **{"from": start, "to": end})

    # Trimmed to what a sentence can honestly be built from, and the truncation
    # is stated: "there are 12 more" is usable, a silently short list is not.
    head = [
        {"event_id": item.get("id"), "day": item.get("day"), "at": item.get("at"),
         "all_day": item.get("all_day"), "source": item.get("source"),
         "kind": item.get("kind"), "title": item.get("title"),
         "subject": item.get("subject"),
         "learner_ids": item.get("learner_ids") or []}
        for item in items[:MAX_CALENDAR_ITEMS]
    ]
    return {"data": scrub({
        "from": start, "to": end,
        "timezone": school_calendar.SCHOOL_TIMEZONE,
        "total": len(items),
        "shown": len(head),
        "items": head,
    })}


async def _get_live_classroom(context: TeacherToolContext, args: dict) -> dict:
    from app.services import presence

    group_id = str(args["group_id"])
    snapshot = await presence.snapshot_for_group(group_id)
    if not snapshot:
        return empty("group_has_no_students")
    return {"data": scrub(snapshot)}


# ── registration ─────────────────────────────────────────────────────────────

# ── mentoring ────────────────────────────────────────────────────────────────

def days_since(day: Any) -> Optional[int]:
    """Whole days from a `YYYY-MM-DD` to today, or None if it cannot be read.

    Shared with `action_tools.suggest_students_to_meet`, which ranks by exactly
    this number — two copies of "how long ago was that" is two answers to the
    question the assistant is about to say out loud.
    """
    from datetime import datetime, timezone

    try:
        then = datetime.strptime(str(day)[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None
    return max(0, (datetime.now(timezone.utc).date() - then).days)


async def _get_student_mentorings(context: TeacherToolContext, args: dict) -> dict:
    """The conversations held with one student, newest first.

    `get_student_goals` flattens the same records down to their goals, which
    answers "what was agreed" and loses "when did anyone last sit with this
    child, and about what". Both questions are asked; only one had a tool.

    One deliberate narrowing: `teacher_only_note` is returned only when THIS
    teacher wrote it. `get_teacher_notes` already draws that line — another
    teacher's private note about a shared student is theirs, not assistant fuel
    — and a teachers-only note is the same kind of writing under another name.
    """
    from app.services import mentoring

    learner_id = str(args["learner_id"])
    try:
        limit = int(args.get("limit") or 5)
    except (TypeError, ValueError):
        limit = 5
    limit = max(1, min(20, limit))

    # Read-only and possibly one of many in a turn, so the legacy pricing pass
    # stays off: nothing here renders a spark value.
    conversations = await mentoring.list_conversations(
        learner_id, viewer_role="teacher", price_backfill=False)
    if not conversations:
        return empty("no_mentoring_conversations", learner_id=learner_id)

    rows = []
    for conversation in conversations[:limit]:
        mine = str(conversation.get("teacher_id") or "") == context.teacher_id
        rows.append({
            "conversation_id": conversation.get("id"),
            "date": conversation.get("date"),
            "days_ago": days_since(conversation.get("date")),
            # `teacher_name` is deliberately absent — the model refers to people
            # by id, and a staff member's name is no more its business than a
            # child's.
            "author": conversation.get("author"),
            "by_me": mine,
            "meeting_stage": conversation.get("meeting_stage") or "",
            "visible_to_learner": conversation.get("visibility", "shared") == "shared",
            "notes": conversation.get("notes") or "",
            **({"teacher_only_note": conversation.get("teacher_only_note") or ""}
               if mine and conversation.get("teacher_only_note") else {}),
            "goals": [{
                "goal_id": goal.get("id"),
                "title": goal.get("title"),
                "deadline": goal.get("deadline"),
                "progress_stage": goal.get("progress_stage"),
                "approved": bool(goal.get("approved_by")),
                "needs_help": bool(goal.get("needs_help")),
            } for goal in (conversation.get("goals") or [])],
        })

    return {"data": scrub(rows), "total": len(conversations)}


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
            "Call this before assuming any learner id exists.\n"
            "THIS IS ALSO HOW YOU RESOLVE A DESCRIPTION INTO PEOPLE. When the "
            "teacher says 'the inactive students', 'whoever needs attention', "
            "'the ones who haven't started', pass `filter` and you get exactly "
            "that set — never guess at it and never act on a subset of it."
        ),
        parameters={"type": "object", "properties": {
            **_GROUP_ID,
            "filter": {
                "type": "string", "enum": sorted(ROSTER_FILTERS),
                "description": (
                    "Optional. `attention` = flagged as needing attention; "
                    "`not_started` = enrolled but never produced any activity; "
                    "`active` = progressing; `inactive` = no activity for `days` "
                    "days (cuts across the other three)."
                ),
            },
            "days": {
                "type": "integer",
                "description": f"`inactive` only. Default {DEFAULT_INACTIVE_DAYS}.",
            },
        }},
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
        name="get_group_learnings",
        description=(
            "What the class did in each LESSON (learning): how many worked on it, "
            "success rate, time, hint and explanation use, and the questions inside "
            "it that went worst.\n"
            "THIS IS THE TOOL FOR ANY QUESTION ABOUT LESSONS — 'which learning did "
            "they struggle with most', 'what should we go over again', 'which lesson "
            "took the longest', 'what have they not opened yet'. Ranking lessons is "
            "allowed; ranking students is not, and this returns no learner ids."
        ),
        parameters={"type": "object", "properties": {
            **_GROUP_ID,
            "subject": {"type": "string", "description": "Optional subject filter."},
            "sort": {
                "type": "string", "enum": sorted(LEARNING_SORTS),
                "description": (
                    "`hardest` (default) = lowest success rate first; "
                    "`most_recent` = last worked on first; "
                    "`most_worked` = most answers first."
                ),
            },
        }, "required": ["group_id"]},
        handler=_get_group_learnings, group_args=("group_id",),
    ))
    register(TeacherTool(
        name="get_learning_detail",
        description=(
            "One lesson opened up: the questions inside it, worst first, with how "
            "many tried each and what support they used. Call it after "
            "get_group_learnings when the teacher asks what went wrong INSIDE a lesson."
        ),
        parameters={"type": "object", "properties": {
            **_GROUP_ID,
            "component_id": {"type": "string",
                             "description": "A component_id from get_group_learnings."},
        }, "required": ["group_id", "component_id"]},
        handler=_get_learning_detail, group_args=("group_id",),
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
    register(TeacherTool(
        name="get_class_calendar",
        description=(
            "Everything with a date on it in one class over a window: tests, lessons "
            "and reminders the teacher scheduled, task due dates, goal deadlines and "
            "mentoring meetings — the same timeline the calendar screen shows.\n"
            "CALL THIS BEFORE PROPOSING ANY DATE. It is how you know a Tuesday "
            "already has a test on it, that a goal is due the same week as the task "
            "you are about to suggest, or that the class has nothing scheduled at "
            "all. Also call it whenever the teacher asks what is coming up, what is "
            "on a given day, or whether they are free.\n"
            "Read-only: scheduling something is draft_calendar_event."
        ),
        parameters={"type": "object", "properties": {
            **_GROUP_ID,
            "from": {"type": "string",
                     "description": "First day, `YYYY-MM-DD`. Omit with `to` to use `days`."},
            "to": {"type": "string", "description": "Last day, `YYYY-MM-DD`."},
            "days": {
                "type": "integer",
                "description": (
                    "Instead of from/to: how many days ahead from today. "
                    f"Default {DEFAULT_CALENDAR_DAYS}, max 120."
                ),
            },
            "learner_id": {
                "type": "string",
                "description": "Optional — narrow to one child. Class-wide items stay.",
            },
        }, "required": ["group_id"]},
        handler=_get_class_calendar,
        group_args=("group_id",), learner_args=("learner_id",),
    ))
    register(TeacherTool(
        name="get_student_mentorings",
        description=(
            "The conversations documented with one student — when they were, who "
            "wrote them up, what was discussed, and which goals came out of each.\n"
            "Use it for anything about MEETING a student: when they were last "
            "spoken to, what was agreed then, whether a follow-up is overdue. "
            "get_student_goals gives the goals alone and cannot answer any of that."
        ),
        parameters={"type": "object", "properties": {
            **_LEARNER_ID,
            "limit": {"type": "integer",
                      "description": "How many of the most recent (default 5, max 20)."},
        }, "required": ["learner_id"]},
        handler=_get_student_mentorings, learner_args=("learner_id",),
    ))
