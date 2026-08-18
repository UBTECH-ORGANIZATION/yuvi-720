"""Action tools — the assistant offers, the teacher acts.

Every tool here **writes nothing**. That is the same invariant `registry.py`
states for the whole file set, and it survives this phase intact:

    The assistant drafts; the teacher clicks a real dependency-guarded endpoint.

What changes is that the draft now arrives as a *structured offer* instead of a
sentence. A tool returns

    {"data": {...}, "offer": {...}}

and `teacher_assistant._run_tools` harvests every `offer` into one `{"actions":
[...]}` frame. The browser renders each offer as a button or a form; pressing it
calls the same endpoint the goals screen calls. A jailbroken prompt can produce
a *suggestion* the teacher is free to ignore — it can never produce a write.

Three properties fall out of routing offers through the registry rather than
letting the model write them into its prose:

1. **Scope is checked.** Every `learner_id` in an offer is a declared
   `learner_args` entry, so `registry._authorize` re-checks it against the set
   resolved server-side before the model ran, plus a live DB check.
2. **It is audited.** Every offer is a tool call, so it lands in
   `teacher_tool_calls` like everything else.
3. **Nothing has to be parsed out of a stream.** An inline marker like
   `[[action:…]]` would have to be taught to `trimPartialMarkers`, or teachers
   would watch the syntax type itself out mid-answer.

Labels are locale **keys**, never sentences: a button caption is a lookup, not
an inference, so it renders identically in three languages with no provider
involved. Only the parts that require reading the data — a goal's title, its
next steps — are written by the model.
"""

from __future__ import annotations

import re
from typing import Any, Optional

from app.agents.teacher_tools.registry import TeacherTool, TeacherToolContext, register
from app.services.school_calendar import EVENT_KINDS as CALENDAR_KINDS

# The routes a `navigate` offer may point at. Validated against this rather than
# accepting a model-authored path, for the same reason `help_tools.ROUTES` does.
MAX_OFFER_LEARNERS = 60

#: A deadline the client can put straight into `<input type="date">`.
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _offer(kind: str, label_key: str, **payload: Any) -> dict[str, Any]:
    """One offer, in the single shape the dock knows how to render."""
    return {"kind": kind, "label_key": label_key, **payload}


def _clean(value: Any, limit: int = 400) -> str:
    return " ".join(str(value or "").split())[:limit]


def _in_scope(context: TeacherToolContext, learner_ids: list[str]) -> list[str]:
    """Keep only learners this teacher actually teaches.

    `registry._authorize` already checks the declared `learner_args`, but a
    *list* argument is not one id — so it is filtered here as well. Silently
    dropping an out-of-scope id is deliberate: the refusal must not tell a
    probing teacher whether the id exists.
    """
    if context.is_admin:
        return learner_ids[:MAX_OFFER_LEARNERS]
    return [
        learner_id for learner_id in learner_ids[:MAX_OFFER_LEARNERS]
        if learner_id in context.allowed_learner_ids
    ]


# ── drafting a goal ──────────────────────────────────────────────────────────

async def _draft_goal(context: TeacherToolContext, args: dict) -> dict:
    """Propose a goal. Writes nothing — the teacher assigns it from the card.

    `missing` is the guided-fill contract: rather than refusing a half-specified
    draft, the tool reports which required field is absent so the model can ask
    for it in one short question and the form can flag it. A teacher should be
    asked "what should it be called?", not handed an empty box.
    """
    raw_ids = args.get("learner_ids")
    named = [str(x) for x in raw_ids if x] if isinstance(raw_ids, list) else []
    learner_ids = _in_scope(context, named)

    # Two different emptinesses, two different answers.
    #
    # The model NAMED children and none of them survived the scope filter: that
    # is a request about somebody else's students, and it stays a refusal. The
    # form must not open, because the teacher asked for something they may not
    # have — and the reason stays vague so it cannot be used to probe whether an
    # id exists (see `_in_scope`).
    if named and not learner_ids:
        return {"data": None, "reason": "no_learners_in_scope_for_this_goal"}

    title = _clean(args.get("title"), 120)
    next_steps = _clean(args.get("next_steps"), 600)
    deadline = str(args.get("deadline") or "")
    if not _DATE.match(deadline):
        # A malformed date is dropped rather than repaired: the form defaults to
        # a week out, which is a better guess than half of what the model meant.
        deadline = ""

    # The model named NOBODY — it knows a goal is the right move but not who
    # for. `missing` used to be built from a one-element tuple and so could only
    # ever say "title", which meant this case produced a form pointed at nobody
    # and pressable. Who it is for is a required field like any other: reported
    # absent, it flows into the guided-fill contract and the teacher picks from
    # the roster.
    missing = [
        name for name, value in (("title", title), ("learners", learner_ids))
        if not value
    ]

    return {
        "data": {"learner_count": len(learner_ids), "missing": missing},
        "offer": _offer(
            "draft_goal",
            "tch.assistant.action.draftGoal",
            learner_ids=learner_ids,
            title=title,
            next_steps=next_steps,
            deadline=deadline,
            missing=missing,
            params={"count": len(learner_ids)},
            icon="target",
        ),
    }


# ── drafting a note ──────────────────────────────────────────────────────────

async def _draft_note(context: TeacherToolContext, args: dict) -> dict:
    learner_id = str(args.get("learner_id") or "")
    text = _clean(args.get("text"), 1000)
    # The same four kinds the notes panel writes. A fifth invented here would
    # save fine and then render as a blank chip on the student profile.
    kind = str(args.get("kind") or "note")
    if kind not in {"strength", "weakness", "challenge", "note"}:
        kind = "note"

    # Same shape as `draft_goal`: an offer with no learner is a card whose save
    # button posts to nobody. It reports the gap rather than rendering a dead
    # button, and the model asks the one question that fills it.
    missing = [name for name, value in (("text", text), ("learner", learner_id))
               if not value]
    return {
        "data": {"missing": missing},
        "offer": _offer(
            "draft_note",
            "tch.assistant.action.draftNote",
            learner_id=learner_id,
            text=text,
            note_kind=kind,
            missing=missing,
            params={"learner_id": learner_id},
            icon="note",
        ),
    }


# ── drafting a good word ─────────────────────────────────────────────────────

async def _draft_kudos(context: TeacherToolContext, args: dict) -> dict:
    """A message Yuvi will hand the child in their own chat.

    Grounding matters more here than anywhere else in this file: this text is
    read by a *child*, in the voice of their teacher. The prompt requires it to
    rest on something that actually happened.
    """
    learner_id = str(args.get("learner_id") or "")
    message = _clean(args.get("message"), 300)

    missing = [name for name, value in (("message", message), ("learner", learner_id))
               if not value]
    return {
        "data": {"missing": missing},
        "offer": _offer(
            "draft_kudos",
            "tch.assistant.action.draftKudos",
            learner_id=learner_id,
            message=message,
            missing=missing,
            params={"learner_id": learner_id},
            icon="spark",
        ),
    }


# ── goals waiting for approval ───────────────────────────────────────────────

async def _list_pending_goal_approvals(context: TeacherToolContext, args: dict) -> dict:
    """Goals a learner finished that still need this teacher's sign-off.

    Pending means summarized-but-unapproved, the same definition the goals
    screen uses — there is one meaning of "waiting for you" in this product.
    """
    from app.services import mentoring

    learner_id = args.get("learner_id")
    targets = (
        [str(learner_id)] if learner_id
        else sorted(context.allowed_learner_ids)[:MAX_OFFER_LEARNERS]
    )

    pending: list[dict[str, Any]] = []
    for target in targets:
        conversations = await mentoring.list_conversations(target, viewer_role="teacher")
        for conversation in (conversations or []):
            for goal in (conversation.get("goals") or []):
                if goal.get("progress_stage") != "summarized" or goal.get("approved_by"):
                    continue
                pending.append({
                    "learner_id": target,
                    "goal_id": goal.get("id"),
                    "conversation_id": conversation.get("id"),
                    "title": _clean(goal.get("title"), 120),
                    "reward_value": goal.get("reward_value"),
                })

    if not pending:
        return {"data": None, "reason": "nothing_waiting_for_approval"}

    head = pending[:6]
    return {
        "data": {"count": len(pending), "goals": head},
        "offer": _offer(
            "approve_goals",
            "tch.assistant.action.approveGoals",
            goals=head,
            params={"count": len(pending)},
            icon="check",
        ),
    }


# ── drafting a task ──────────────────────────────────────────────────────────

#: The three parts a task can be made of, as `spec.components` names them. Kept
#: as a set here rather than imported so a model naming the retired
#: `interactive` gets a clean drop instead of a task that generates nothing.
TASK_COMPONENTS = ("presentation", "practice", "test")
DEFAULT_COMPONENTS = ("practice",)


async def _draft_task(context: TeacherToolContext, args: dict) -> dict:
    """Propose a task, filled in from the conversation. Writes nothing.

    This is the one draft whose *reason* usually lives in the chat rather than
    in a form: a teacher who has just been told which lesson went worst, and for
    whom, should not have to retype any of that into the builder. So the offer
    carries the lesson it came from — `source_component_id`, an id the teacher
    can see and the generator resolves against the live catalogue — and the
    topic in the teacher's own words.

    Confirming it calls the same `POST /api/teacher/tasks` the builder calls.
    """
    from app.services import kata_catalog

    title = _clean(args.get("title"), 120)
    topic = _clean(args.get("topic"), 600)
    subject = _clean(args.get("subject"), 40)

    raw_components = args.get("components")
    components = [
        str(entry) for entry in (raw_components if isinstance(raw_components, list) else [])
        if str(entry) in TASK_COMPONENTS
    ]
    # Order is the order a child meets them, not the order the model listed.
    components = [part for part in TASK_COMPONENTS if part in components] \
        or list(DEFAULT_COMPONENTS)

    # The catalogue is the authority on both of these. A subject with no
    # material behind it produces a task the tasks list can never filter to,
    # and a made-up component id would send the generator looking for a lesson
    # that does not exist.
    try:
        await kata_catalog.ensure_loaded()
    except Exception:      # pragma: no cover — the draft is still useful
        pass

    known_subjects = set(kata_catalog.subjects() or [])
    if subject and known_subjects and subject not in known_subjects:
        subject = ""

    source_id = _clean(args.get("source_component_id"), 200)
    lesson = kata_catalog.get_component(source_id) if source_id else None
    if source_id and lesson is None:
        source_id = ""
    if lesson and not subject:
        subject = _clean(lesson.get("subject"), 40)

    difficulty = str(args.get("difficulty") or "medium")
    if difficulty not in {"easy", "medium", "hard"}:
        difficulty = "medium"

    # Same guided-fill contract as the other drafts: a gap is reported so the
    # model can ask one short question, never so a dead form can be rendered.
    # "Subject matter" is satisfied by EITHER a topic or a catalogue lesson —
    # that is the rule `assist.missing_fields` applies server-side.
    missing = [name for name, value in (
        ("title", title),
        ("subject", subject),
        ("subject_matter", topic or source_id),
    ) if not value]

    return {
        "data": {"components": components, "missing": missing,
                 "from_lesson": bool(source_id)},
        "offer": _offer(
            "draft_task",
            "tch.assistant.action.draftTask",
            title=title,
            topic=topic,
            subject=subject,
            components=components,
            difficulty=difficulty,
            source_component_id=source_id,
            missing=missing,
            params={"title": title},
            icon="backpack",
        ),
    }


# ── putting something on the calendar ────────────────────────────────────────
#
# Two offers, one form. Creating and editing an event are the same set of
# fields, so the difference is only whether the offer carries an `event_id` —
# and the difference that matters is which endpoint the teacher's press calls.
#
# Neither writes. `POST /groups/{id}/calendar/events` and
# `PATCH /calendar/events/{id}` both re-derive access from the session and run
# every target through `assign.resolve_targets`, so a draft that names a class
# this teacher does not teach dies at the press, not at the draft. Refusing
# early here as well is not about safety — it is so the teacher is never handed
# a form that cannot succeed.


def _event_date(value: Any, all_day: bool) -> str:
    """A start the calendar will accept, or "" for the form to fill in.

    The all-day rule is the one that produces silent bugs: an all-day event
    holding a timestamp slides across the date line, so the server refuses the
    mix outright. Rather than pass a shape that will be rejected on press, a
    timestamp given for an all-day event is cut back to its day.
    """
    text = _clean(value, 40)
    if not text:
        return ""
    if all_day:
        return text[:10] if _DATE.match(text[:10]) else ""
    # A timed event needs an instant; a bare date is the model forgetting the
    # clock, and the form asks for the time rather than inventing one.
    return "" if _DATE.match(text) else text


def _targets(context: TeacherToolContext, group_id: str,
             raw: Any) -> tuple[list[dict[str, str]], list[str]]:
    """Who the event is for, filtered to what this teacher can reach.

    An out-of-scope learner is dropped silently, for the same reason
    `_in_scope` drops one: the refusal must not tell a probing teacher whether
    an id exists. A draft left with no targets at all falls back to the whole
    class, which is what "put a test on Tuesday" means.
    """
    targets: list[dict[str, str]] = []
    learners: list[str] = []
    for entry in (raw if isinstance(raw, list) else []):
        if not isinstance(entry, dict):
            continue
        kind, target_id = str(entry.get("kind") or ""), str(entry.get("id") or "")
        if not target_id or kind not in {"learner", "subgroup", "group"}:
            continue
        if kind == "learner":
            if not context.is_admin and target_id not in context.allowed_learner_ids:
                continue
            learners.append(target_id)
        if kind == "group" and not context.is_admin \
                and target_id not in context.allowed_group_ids:
            continue
        if {"kind": kind, "id": target_id} not in targets:
            targets.append({"kind": kind, "id": target_id})
    if not targets and group_id:
        targets = [{"kind": "group", "id": group_id}]
    return targets[:MAX_OFFER_LEARNERS], learners


async def _draft_calendar_event(context: TeacherToolContext, args: dict) -> dict:
    """Propose something for the class calendar. Writes nothing."""
    from app.services import school_calendar

    group_id = str(args.get("group_id") or "")
    title = _clean(args.get("title"), 120)
    description = _clean(args.get("description"), 600)

    kind = str(args.get("kind") or "event")
    if kind not in school_calendar.EVENT_KINDS:
        kind = "event"

    all_day = args.get("all_day")
    all_day = True if all_day is None else bool(all_day)
    start_at = _event_date(args.get("start_at"), all_day)
    end_at = _event_date(args.get("end_at"), all_day)
    # An end before its start is the server's `end_before_start` refusal waiting
    # to happen; dropped so the form opens on a date the teacher can fix.
    if end_at and start_at and end_at < start_at:
        end_at = ""

    targets, _ = _targets(context, group_id, args.get("targets"))

    missing = [name for name, value in (
        ("title", title), ("date", start_at), ("group", group_id),
    ) if not value]

    return {
        "data": {"kind": kind, "all_day": all_day, "missing": missing,
                 "target_count": len(targets)},
        "offer": _offer(
            "draft_calendar_event",
            "tch.assistant.action.draftCalendarEvent",
            group_id=group_id,
            title=title,
            description=description,
            event_kind=kind,
            all_day=all_day,
            start_at=start_at,
            end_at=end_at,
            targets=targets,
            missing=missing,
            params={"title": title},
            icon="calendar",
        ),
    }


async def _draft_calendar_change(context: TeacherToolContext, args: dict) -> dict:
    """Propose a change to an event that already exists. Writes nothing.

    Unlike every other tool here, the scope check cannot be declared: the group
    is a property of the stored event, not an argument, so `registry._authorize`
    has nothing to check and this handler does it itself. Only free events are
    editable — a task's due date belongs to the task and a goal's deadline to
    the goal, and the model is told to say so rather than offer a form that
    would edit the wrong thing.
    """
    from app.services import school_calendar

    event_id = _clean(args.get("event_id"), 120)
    event = await school_calendar.get_event(event_id) if event_id else None
    group_id = str((event or {}).get("group_id") or "")

    # Indistinguishable from "no such event", deliberately — the same rule the
    # registry's own refusal follows.
    if event is None or (not context.is_admin and group_id not in context.allowed_group_ids):
        return {"data": None, "reason": "no_such_calendar_event"}

    all_day = args.get("all_day")
    all_day = bool(event.get("all_day")) if all_day is None else bool(all_day)

    kind = str(args.get("kind") or event.get("kind") or "event")
    if kind not in school_calendar.EVENT_KINDS:
        kind = str(event.get("kind") or "event")

    # Every field falls back to what is stored, so a model that names only the
    # new date proposes exactly that change and nothing else. Changing all-day
    # is the exception: the stored start is then the wrong SHAPE, so it is
    # re-read through the same rule a creation uses and reported missing if it
    # cannot survive the switch.
    start_at = _event_date(args.get("start_at") or event.get("start_at"), all_day)
    end_at = _event_date(args.get("end_at") or event.get("end_at"), all_day)
    if end_at and start_at and end_at < start_at:
        end_at = ""

    title = _clean(args.get("title") or event.get("title"), 120)
    description = _clean(
        args.get("description") if args.get("description") is not None
        else event.get("description"), 600)

    raw_targets = args.get("targets")
    targets, _ = _targets(context, group_id,
                          raw_targets if raw_targets is not None else event.get("targets"))

    missing = [name for name, value in (("title", title), ("date", start_at)) if not value]

    return {
        "data": {"event_id": event_id, "kind": kind, "all_day": all_day,
                 "missing": missing, "was": {"day": event.get("start_at"),
                                             "title": event.get("title")}},
        "offer": _offer(
            "edit_calendar_event",
            "tch.assistant.action.editCalendarEvent",
            event_id=event_id,
            group_id=group_id,
            title=title,
            description=description,
            event_kind=kind,
            all_day=all_day,
            start_at=start_at,
            end_at=end_at,
            targets=targets,
            missing=missing,
            params={"title": title},
            icon="calendar",
        ),
    }


# ── follow-up questions ──────────────────────────────────────────────────────

async def _suggest_followups(context: TeacherToolContext, args: dict) -> dict:
    """Two next questions the teacher might ask. Chips, not a menu in prose.

    This exists so the VOICE rule ("at most one offer, never a numbered menu")
    and a genuinely useful set of next steps can both be true: the prose stays
    one clean sentence, the options become buttons.
    """
    raw = args.get("questions")
    questions = [
        _clean(question, 90) for question in (raw if isinstance(raw, list) else [])
    ]
    questions = [question for question in questions if question][:3]
    if not questions:
        return {"data": None, "reason": "no_followups_suggested"}

    return {
        "data": {"count": len(questions)},
        "offer": _offer("followups", "", questions=questions),
    }


# ── registration ─────────────────────────────────────────────────────────────

def register_all() -> None:
    register(TeacherTool(
        name="draft_goal",
        description=(
            "Propose a goal for one student or a sub-group and offer it to the teacher "
            "as a form they confirm. This does NOT assign it — the teacher does. "
            "Call it once you know who it is for; if you cannot infer a title, call it "
            "anyway and ask the teacher for one in your reply."
        ),
        parameters={"type": "object", "properties": {
            "learner_ids": {
                "type": "array", "items": {"type": "string"},
                "description": "Learner ids from list_students. One id for a single student.",
            },
            "title": {"type": "string", "description": "Short, concrete, in the teacher's language."},
            "next_steps": {"type": "string", "description": "What the student should actually do."},
            "deadline": {"type": "string", "description": "YYYY-MM-DD. Omit if unknown."},
        }, "required": ["learner_ids"]},
        handler=_draft_goal,
    ))
    register(TeacherTool(
        name="draft_note",
        description=(
            "Propose a note about a student for the teacher to save. Writes nothing. "
            "Ground it in something a tool returned this turn."
        ),
        parameters={"type": "object", "properties": {
            "learner_id": {"type": "string"},
            "text": {"type": "string"},
            "kind": {"type": "string", "enum": ["strength", "weakness", "challenge", "note"]},
        }, "required": ["learner_id"]},
        handler=_draft_note, learner_args=("learner_id",),
    ))
    register(TeacherTool(
        name="draft_kudos",
        description=(
            "Propose a good word Yuvi will deliver to the student in their own chat, "
            "in the teacher's name. The child reads this: keep it warm, specific and "
            "about something that actually happened. Writes nothing."
        ),
        parameters={"type": "object", "properties": {
            "learner_id": {"type": "string"},
            "message": {"type": "string", "description": "One or two sentences, to the child."},
        }, "required": ["learner_id"]},
        handler=_draft_kudos, learner_args=("learner_id",),
    ))
    register(TeacherTool(
        name="draft_task",
        description=(
            "Propose a TASK — a presentation, practice questions or a test that Yuvi "
            "writes and the class then works through — and offer it to the teacher as "
            "a form they confirm. This does NOT create it; the teacher does, and picks "
            "who gets it afterwards.\n"
            "Use it when the conversation has just established something a task would "
            "answer: a lesson the class did badly in, a question most of them got "
            "wrong, a goal that needs practice behind it. Pass `source_component_id` "
            "when the task should be built on a catalogue lesson you saw in "
            "get_group_learnings — that is what keeps the questions on the material "
            "they actually studied."
        ),
        parameters={"type": "object", "properties": {
            "title": {"type": "string",
                      "description": "What the teacher would call it, in their language."},
            "topic": {"type": "string",
                      "description": "What it should cover, in the teacher's language. "
                                     "Be specific — this is what Yuvi writes from."},
            "subject": {"type": "string",
                        "description": "The subject id, e.g. `math` or `science`."},
            "components": {
                "type": "array", "items": {"type": "string", "enum": list(TASK_COMPONENTS)},
                "description": "presentation = slides that teach; practice = questions "
                               "with hints; test = questions with a pass mark and no help.",
            },
            "difficulty": {"type": "string", "enum": ["easy", "medium", "hard"]},
            "source_component_id": {
                "type": "string",
                "description": "Optional — a component_id from get_group_learnings.",
            },
        }, "required": ["title"]},
        handler=_draft_task,
    ))
    register(TeacherTool(
        name="draft_calendar_event",
        description=(
            "Propose something for the class calendar — a test, a lesson, a reminder "
            "or a class event — and offer it to the teacher as a form they confirm. "
            "This does NOT schedule it; the teacher does.\n"
            "CALL get_class_calendar FIRST so you are not putting a test on a day "
            "that already has one, and say what else is on that day when you offer.\n"
            "Only use this for things nothing else owns. A task's due date belongs to "
            "draft_task, and a goal's deadline to draft_goal — both already appear on "
            "the calendar, and scheduling a second copy here creates two dates for one "
            "piece of work."
        ),
        parameters={"type": "object", "properties": {
            "group_id": {"type": "string", "description": "The class, from list_my_groups."},
            "title": {"type": "string",
                      "description": "What the class would call it, in the teacher's language."},
            "kind": {"type": "string", "enum": list(CALENDAR_KINDS),
                     "description": "test = an exam; lesson = a scheduled lesson; "
                                    "reminder = something to remember; event = anything else."},
            "description": {"type": "string", "description": "Optional detail, one or two lines."},
            "all_day": {"type": "boolean",
                        "description": "True (the default) for a whole day; false for a time."},
            "start_at": {"type": "string",
                         "description": "`YYYY-MM-DD` when all_day, otherwise a full "
                                        "ISO timestamp. Never mix the two."},
            "end_at": {"type": "string", "description": "Optional, same shape as start_at."},
            "targets": {
                "type": "array",
                "items": {"type": "object", "properties": {
                    "kind": {"type": "string", "enum": ["group", "subgroup", "learner"]},
                    "id": {"type": "string"},
                }, "required": ["kind", "id"]},
                "description": "Who it is for. Omit for the whole class.",
            },
        }, "required": ["group_id", "title"]},
        handler=_draft_calendar_event, group_args=("group_id",),
    ))
    register(TeacherTool(
        name="draft_calendar_change",
        description=(
            "Propose a change to an event ALREADY on the calendar — move it, rename "
            "it, retarget it — and offer it to the teacher as a form they confirm. "
            "This does NOT change it; the teacher does.\n"
            "`event_id` comes from get_class_calendar, and only rows with "
            "`source: \"event\"` can be edited here. A task, a goal deadline or a "
            "meeting is owned by its own screen: say where to change it instead of "
            "offering a form that would edit something else.\n"
            "Pass ONLY the fields that change; everything else keeps its current value."
        ),
        parameters={"type": "object", "properties": {
            "event_id": {"type": "string",
                         "description": "From get_class_calendar, where source is `event`."},
            "title": {"type": "string"},
            "kind": {"type": "string", "enum": list(CALENDAR_KINDS)},
            "description": {"type": "string"},
            "all_day": {"type": "boolean"},
            "start_at": {"type": "string",
                         "description": "`YYYY-MM-DD` when all_day, else an ISO timestamp."},
            "end_at": {"type": "string"},
            "targets": {
                "type": "array",
                "items": {"type": "object", "properties": {
                    "kind": {"type": "string", "enum": ["group", "subgroup", "learner"]},
                    "id": {"type": "string"},
                }, "required": ["kind", "id"]},
            },
        }, "required": ["event_id"]},
        handler=_draft_calendar_change,
    ))
    register(TeacherTool(
        name="list_pending_goal_approvals",
        description=(
            "Goals students finished that are waiting for this teacher's approval. "
            "Offers an approve button per goal."
        ),
        parameters={"type": "object", "properties": {
            "learner_id": {"type": "string", "description": "Optional — omit for every student."},
        }},
        handler=_list_pending_goal_approvals, learner_args=("learner_id",),
    ))
    register(TeacherTool(
        name="suggest_followups",
        description=(
            "Offer up to three next questions as buttons. Use INSTEAD of listing "
            "options in your answer — never write a numbered menu."
        ),
        parameters={"type": "object", "properties": {
            "questions": {
                "type": "array", "items": {"type": "string"},
                "description": "Short questions in the teacher's language.",
            },
        }, "required": ["questions"]},
        handler=_suggest_followups,
    ))
