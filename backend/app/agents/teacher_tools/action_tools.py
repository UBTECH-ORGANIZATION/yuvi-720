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
