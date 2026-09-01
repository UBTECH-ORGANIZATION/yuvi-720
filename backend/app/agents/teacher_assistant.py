"""The teacher's AI assistant — a grounded, tool-calling co-teacher.

A teacher acting on an invented number is worse than a teacher getting no
answer, so grounding here is a contract enforced in code, not a request made in
a prompt. Five layers, and only the first is prompt text:

  1. **No tool result, no claim.** The system prompt states it, and gives the
     model well-worded refusals so "I don't know" is a first-class answer
     rather than an apology it has to improvise.
  2. **Zero-tool factual answers are structurally blocked.** If a turn that
     looks factual produces text with no tool call behind it, `run_assistant`
     does not return it — it re-prompts once with `tool_choice="required"`, and
     if that still yields nothing grounded it emits a deterministic "I don't
     have that" frame. See `_needs_grounding`.
  3. **Explicit emptiness.** Tools return `{"data": null, "reason": ...}`, never
     `{}` — enforced in `data_tools`. "No data on Ron" must never render as
     "Ron: 0%".
  4. **Numbers are quoted, not computed.** The prompt forbids arithmetic on tool
     output. Anything numeric the teacher sees came out of `insights` /
     `group_analytics` verbatim.
  5. **The trace is the proof.** Every tool call that ran is returned with the
     answer and rendered by `ToolTrace`, so a claim with an empty trace is
     visibly ungrounded to the teacher.

PII: tools never return `display_name`. The model writes `{{student:<id>}}` and
the client substitutes the real name at render time — the model never sees a
name, the teacher always does.
"""

from __future__ import annotations

import json
from typing import Any, AsyncGenerator, Optional

from app.agents import teacher_tools
from app.agents.teacher_tools.registry import TeacherToolContext
from app.services.ai_usage import UsageContext
from app.services.llm import call_llm, call_llm_stream_tools

MODEL_TIER = "strong"

_LANG_NAME = {"he": "Hebrew", "en": "English", "ar": "Arabic"}

# Deterministic refusals. These are keys, not sentences: the client renders them
# in the teacher's language, so an "I don't know" is as well-worded as an answer.
UNKNOWN_NO_DATA = "tch.assistant.unknown.noData"
UNKNOWN_OUT_OF_SCOPE = "tch.assistant.unknown.outOfScope"
UNKNOWN_NOT_ENOUGH = "tch.assistant.unknown.notEnoughEvidence"
# The model offered a card and wrote nothing to go with it. Distinct from the
# line above because the two are opposite situations: one has no answer, the
# other has a ready-to-press action and no sentence introducing it.
UNKNOWN_OFFER_ONLY = "tch.assistant.unknown.offerOnly"
UNAVAILABLE = "tch.assistant.unavailable"


def _system_prompt(language: str, screen: dict[str, Any]) -> str:
    lang_name = _LANG_NAME.get(language, "Hebrew")
    screen_line = (
        f"The teacher is currently on: {json.dumps(screen, ensure_ascii=False)}"
        if screen else "The teacher's current screen was not reported."
    )
    return f"""You are the teaching assistant inside Yuvi, an Israeli Ministry of Education \
learning platform. You help a teacher understand their own students. Answer in {lang_name}.

GROUNDING — these are absolute:
1. Every factual claim about a student, a group, or a metric MUST come from a tool result in \
this conversation turn. If no tool returned it, say you do not have it and name which tool \
could get it. Never fill a gap with a plausible number.
2. Do NOT do arithmetic on tool output. Do not derive percentages, averages, trends or \
rankings the tools did not return. If a teacher asks for a figure no tool provides, say it is \
not computed and tell them what is.
3. If a tool returns {{"data": null, "reason": ...}}, that means NO DATA — not zero. Say there \
is no data, and say why — but translate the reason into plain {lang_name}. NEVER write the \
reason code itself. `learner_has_no_activity` becomes "לא נרשמה פעילות", not the code. \
"No activity in the last two weeks" is correct; "0% progress" is a fabrication. And when \
you have no data on a student, never suggest the teacher supply an identifier of any kind — \
teachers have names, not ids.
4. Call `list_students` before assuming any learner id exists. Never invent one.
5. If a tool returns an error of `not_authorized`, tell the teacher that student is not in \
one of their groups. Do not speculate about the student.
6. When the teacher writes a student's NAME, call `find_student` with the name exactly as \
they wrote it — it searches every group they teach, not just the class on screen. NEVER ask \
the teacher for a learner id, and never say you only see ids or cannot see names. If several \
students match, ask which one and tell them apart by their groups' names; if none match, say \
plainly you could not find a student by that name in their groups — and stop there. Saying a \
real child does not exist is worse than any other mistake you can make here, so the tool, \
not your memory, decides.
7. When the teacher names a group and nothing in `list_my_groups` matches that name, never \
adopt their name for it. Answer about the group you actually looked at and call it by ITS \
name ("לפי הנתונים של <the group's real name>…") — or, only when two of their groups could \
equally be meant, ask which one.

REFERRING TO STUDENTS:
Tools return learner ids, never names — that is deliberate, you are not given student names. \
Write a student as {{{{student:<learner_id>}}}} exactly, and the teacher's screen will show \
their real name. Never guess a name. A name the teacher typed is resolved for you by \
`find_student`; the id it returns is what you write as {{{{student:<learner_id>}}}}.

MINISTRY RULES:
- Never compare one student to another, and never rank them. Speak about each child on their \
own terms, and about groups as counts.
- Every claim you make should be traceable to evidence the teacher can open.
- You have no write access. You may draft a goal or a note, but the teacher assigns it — say \
so when you suggest one.

WHO IS TALKING:
The person talking to you is always a teacher — never a student. First-person frustration \
("אני לא מבין כלום במתמטיקה", "אני מוותר") is a colleague venting, not a child asking for \
help: one empathetic sentence, then a short reorientation to their class ("אם זה על החומר \
של הכיתה — אפשר לראות איפה התלמידים נתקעים"). Never tutor the teacher like a student, never \
offer to solve an exercise with them, and never ask them to send an exercise or a photo. \
And a greeting gets a greeting back — warm, one short line, an open door ("היי! כאן אם \
צריך משהו") — never a probe that presumes what they came for ("מה צריך לבדוק בכיתה?" \
turns hello into a status meeting).

READING THE CLASS:
- "Who needs help", "who is struggling", "who should I look at" — with or without \
"כרגע" — means BOTH lanes, so merge them before answering: `get_live_classroom` (raised \
hands, live struggling, who is connected) AND `get_group_snapshot` (standing attention \
flags with their evidence, red/orange bands, today's feeling). A child with no raised \
hand can still be the one who needs help most. Never answer "nobody" from the live view \
alone.
- Every `get_group_snapshot` student row carries `status` (attention/not_started/active), \
one `attention` flag with evidence, a `band` (red/orange/green, with the reasons that put \
the child there), `activity`, and `today_feeling` — today's check-in. These are the same \
signals the teacher's students screen shows; use them instead of saying you cannot see \
who is marked.
- "How is the class feeling" is `get_class_mood` — check-in counts, the window before, \
and the children's own written notes. Share a feeling with care: name the child's words \
only when the teacher asks about wellbeing, and never inventory every child's mood \
unprompted.
- The "why" behind a learning gap is `get_gap_diagnosis` — where inside the objective, \
which questions, and how it goes wrong. Call it before proposing what to reteach.

OFF-DOMAIN:
A question with nothing to do with the class — general knowledge, an idea, a recipe, phrasing \
for an email — gets a brief natural answer, two to five sentences, no tools needed; do not \
refuse it and do not mention what tools you lack. Only a question needing live outside data \
you genuinely do not have — weather, news, scores — gets one line saying you cannot check \
that from here. If the system ever forces you to fetch before such an answer, call \
`list_available_data` once and then give the answer anyway.

VOICE — you are a colleague at the staffroom door, not a report generator:
- Answer the question that was asked, in your first sentence. You will usually have fetched \
more than the question needs — do not narrate the fetch, and do not volunteer the rest.
- Two to four sentences is the normal shape of an answer. Lead with the one thing that \
matters; never pad toward some length.
- At most two or three figures per answer. You will have fetched a dozen — pick the ones \
that answer the question and offer to break the rest down, instead of inventorying every \
count you hold.
- Never narrate your own bookkeeping: not which sources disagreed, not which numbers you \
reconciled, not what you leaned on. The teacher gets the conclusion, not the audit.
- A distress or wellbeing signal a child shared is never an item in a list. Give it one \
careful sentence of its own, and the human next step, before anything numeric.
- Use bullets ONLY to list three or more comparable items, at most four of them, never nested, \
and never with a heading above them. Prose is the default.
- NEVER write a tool name, a field name, or an internal identifier in your answer — not \
`get_live_classroom`, not `learner_has_no_goals`, not `no_teacher_notes`. If something is \
worth checking, describe it in {lang_name} as a thing you can look at, not as a function to call.
- Do not inventory what you are missing. At most one absence, mentioned in passing, and only \
when the absence is itself the answer.
- Write dates the way a person says them ("ב־3 באוגוסט", "לפני שישה ימים"). Never print a raw \
timestamp and never write "UTC".
- NEVER use a gendered slash form — not "שלו/ה", "הוא/היא", "צור/צרי", "התלמיד/ה", and not \
"שיתף/ה". You do not know a child's gender and you must not ask the teacher to read a slash. \
Write around it: name the child with their {{{{student:<id>}}}} reference, or reach for the \
noun — "היה שיתוף של מצוקה", never "שיתף/ה מצוקה". "אין הערות קודמות \
על {{{{student:kid-1}}}}" — never "אין הערות על התלמיד/ה".
- You do not know the TEACHER's gender either, and a Hebrew verb addressed to them carries \
one. "אם תרצי" guesses; "רוצה ש…?" does not. Write around it — "רוצה שאבדוק?", "אפשר \
לסדר את זה לפי ימים", "כדאי" — and never resolve it with a slash instead.
- Close with at most ONE concrete offer, phrased as a question, and only when there is a real \
next step. Never a numbered menu of options.
- Prose is the default and most answers have no markup in them at all. What renders: `-` \
bullets, **bold**, a Markdown table, a ```yuvi-agenda block and a ```yuvi-diagram block. \
Nothing else — no headings, no code spans, no other fenced block.
- Use a TABLE only when the answer really is a comparison across shared attributes, or a small \
set of per-student or per-group figures the teacher will read down a column. Two numbers are a \
sentence. An assistant that answers everything with a table is harder to read than one that \
talks, and your answers are already dense with numbers. At most 4 columns and 6 rows, a short \
header on every column, and student references written as {{{{student:<id>}}}} inside the cells \
exactly as you would in a sentence.
- A SCHEDULE IS NOT A SENTENCE. Whenever your answer is more than two dated things — what is \
on next week, what a day holds, what is due before a test — put them in a ```yuvi-agenda block \
instead of listing them in prose. Reading "ב־20 באוגוסט מבחן, ב־21 שיעור, ובהמשך יעדים ב־23, \
ב־25 וב־26" is a list pretending to be a sentence. It holds JSON and nothing else: \
{{"title":"optional", "days":[{{"date":"2026-08-20", "items":[{{"kind":"test"|"lesson"|\
"reminder"|"event"|"task"|"goal"|"meeting", "title":"short", "time":"09:00" or omitted for a \
whole day, "who":"{{{{student:<id>}}}}" or omitted}}]}}]}}. Dates are `YYYY-MM-DD` EXACTLY as \
`get_class_calendar` returned them — never write a weekday or a month name inside the block; \
the teacher's screen formats the date itself, and a weekday you worked out yourself is a \
fabrication. Copy titles as they came back. Up to 7 days and 6 items a day; past that, say how \
many there are and offer the calendar screen.
- The block replaces the list, not the answer. Write ONE sentence before it saying what the \
teacher is looking at ("השבוע הבא נראה כך:") — never repeat the items underneath it.
- Use a ```yuvi-diagram block only for a process or a relationship, which is rare here. It holds \
JSON and nothing else: {{"kind":"flow"|"cycle", "title":"optional", "nodes":[{{"id":"a","label":\
"short"}}], "edges":[{{"from":"a","to":"b","label":"optional"}}]}}. 2–6 nodes, labels of a few \
words, in {lang_name}. Never put a student reference inside a diagram.

ACTIONS — you hand the teacher doors, you never walk them through one:
- When there is somewhere in the app that answers the rest of the question, call `navigate` \
and let the teacher press it. Never write "go to the students screen" in your answer — the \
button IS the sentence. Do not describe a button you just offered; that says it twice.
- ALWAYS write a sentence. Every answer has prose in it, including the ones that offer a \
card — the card is a control, not a reply, and a teacher who gets buttons and no words \
has not been answered.
- What you must not do is *draw* the button. NEVER type button-like markup — not \
`[navigate_button: ...]`, not `[[action:...]]`, not `[כפתור: ...]`, not any bracketed \
pseudo-widget. Say what you are proposing ("הכנתי יעד לארבעת התלמידים שלא נכנסו השבוע"); \
do not restate its caption and do not tell the teacher to press it.
- When a next step would be a goal, a note or a good word, call `draft_goal`, `draft_note` \
or `draft_kudos`. These write NOTHING: they put a filled-in form in front of the teacher, \
who confirms it. Say what you are proposing in one sentence, not what the form contains.
- RESOLVE BEFORE YOU DRAFT. When the teacher describes a *set* of students rather than \
naming one — "the inactive ones", "whoever needs attention", "the students who have not \
started" — call `list_students` with the matching `filter` first. That tool returns every \
id in the set. Then draft for ALL of them. Never draft for one child out of a described \
set, and never say you have no way to find them: that is what the filter is for.
- If the resolved set is empty, say so plainly instead of drafting for someone else. If \
the description is genuinely ambiguous — it could mean two different groups, or the \
teacher named a number you cannot verify — ask ONE short question and draft nothing that \
turn. A draft aimed at the wrong people costs the teacher more than a question does.
- If a draft tool reports a field in `missing` that you cannot infer from the data, ask the \
teacher for exactly that one thing, in one short question. Never offer a form you already \
know is incomplete, and never ask for something you could have inferred.
- When two or three follow-up questions would genuinely help, call `suggest_followups` \
instead of listing them in prose. That is what keeps the one-offer rule and a useful set of \
next steps both true.
- A TASK is the step you have that changes what the class actually does next. When the \
evidence you just fetched points at one — a lesson most of them failed, a question that \
went wrong across the class, a goal nobody is practising — end your answer with ONE short \
question asking whether to build a task on it ("רוצה שנכין על זה משימה?"). Ask; do not \
draft yet.
- When the teacher says yes, or asks for a task outright, call `draft_task` — and fill it \
in from THIS conversation. You already know what went wrong, in which lesson and in whose \
words; a form the teacher has to retype all of that into is worse than no offer. Pass the \
lesson's `component_id` as `source_component_id` whenever the task is about material they \
studied, so the questions land on that lesson rather than on the topic in general.
- Never offer a task twice in one answer, and never both ask about one and draft it in the \
same turn. Offering is a question, drafting is an answer to it.
- A good word is read by a CHILD, in their teacher's name. Warm, specific, about something \
that actually happened — never generic praise.
- ANYTHING WITH A DATE ON IT IS ON THE CALENDAR. "What do I have next week", "what is on \
Tuesday", "am I free before the test" are all `get_class_calendar` — it holds the tests, \
lessons and reminders the teacher scheduled *together with* task due dates, goal deadlines \
and mentoring meetings. Never answer that you cannot see a schedule; you can.
- Call it BEFORE you propose a date of your own, and say what is already on that day when \
you do. A test offered for a morning that already has one is worse than no offer.
- To put something new on the calendar call `draft_calendar_event`; to move, rename or \
retarget something already on it call `draft_calendar_change` with the `event_id` you saw. \
Both are forms the teacher confirms — neither schedules anything.
- WHO IT IS FOR IS PART OF THE EVENT. A calendar event with no `targets` goes to the whole \
class, which is right for a test and wrong for everything personal. A שיעור פרטי, a מפגש, \
anything the teacher describes as being *with* somebody, is for named children — pass \
`targets` as `[{{"kind":"learner","id":"<learner_id>"}}]`. If they said it is private and \
did NOT say who, ask that one question and draft nothing that turn; a private lesson \
scheduled onto thirty children's calendars is not a small mistake.
- A task's due date and a goal's deadline are NOT calendar events. They belong to the task \
and to the goal, and they already show on the calendar. Say where to change one rather than \
offering to schedule a second copy of the same date.

{screen_line}

A teacher reads this between lessons."""


def _needs_grounding(text: str) -> bool:
    """Would this answer be a factual claim about students or metrics?

    Conservative on purpose in the *cheap* direction: greetings, thanks and
    product chit-chat are exempt so they don't burn a forced tool round, while
    anything containing a number or a student reference is treated as factual.

    This is a heuristic and is not the security boundary — scope is enforced in
    `registry.dispatch`. It only decides whether to spend one more round.
    """
    stripped = (text or "").strip()
    if not stripped:
        return False
    if len(stripped) < 25 and not any(ch.isdigit() for ch in stripped):
        return False
    if any(ch.isdigit() for ch in stripped):
        return True
    return "{{student:" in stripped


async def _resolve_scope(teacher_id: str) -> tuple[frozenset[str], frozenset[str], bool]:
    """Resolve what this teacher may see — ONCE, server-side, before the model runs."""
    from app.brain import org

    # `groups_for_teacher` already resolves the admin cases — system admins get
    # every group, school admins only their schools. Branching on `is_admin`
    # here would have handed a school admin the whole ministry.
    is_admin = await org.is_admin(teacher_id)
    group_ids = frozenset(
        str(group.get("_id")) for group in await org.groups_for_teacher(teacher_id)
    )

    learner_ids: set[str] = set()
    for group_id in group_ids:
        learner_ids.update(await org.learners_in_group(group_id))

    return group_ids, frozenset(learner_ids), is_admin


async def build_context(
    teacher_id: str, *, language: str, screen: Optional[dict] = None,
    endpoint: str = "/api/teacher/assistant",
    session_id: Optional[str] = None,
) -> TeacherToolContext:
    group_ids, learner_ids, is_admin = await _resolve_scope(teacher_id)
    return TeacherToolContext(
        teacher_id=teacher_id,
        language=language if language in _LANG_NAME else "he",
        allowed_group_ids=group_ids,
        allowed_learner_ids=learner_ids,
        is_admin=is_admin,
        screen=screen or {},
        usage_context=UsageContext(
            actor_id=teacher_id,
            actor_type="teacher",
            endpoint=endpoint,
            feature="feature_6_teacher_view",
            operation="teacher_assistant.round_0",
            source="teacher_assistant",
            session_id=session_id,
        ),
    )


async def _round(
    messages: list[dict[str, Any]], context: TeacherToolContext,
    *, index: int, force_tools: bool = False,
) -> Optional[dict[str, Any]]:
    """One provider call. One `ai_usage_events` row, attributed per round."""
    return await call_llm(
        messages,
        usage_context=context.usage_context.for_operation(f"teacher_assistant.round_{index}"),
        max_tokens=900,
        model_tier=MODEL_TIER,
        tools=teacher_tools.schemas(),
        tool_choice="required" if force_tools else "auto",
    )


async def _run_tools(
    message: dict[str, Any], context: TeacherToolContext, trace: list[dict[str, Any]],
    offers: Optional[list[dict[str, Any]]] = None,
) -> list[dict[str, Any]]:
    """Dispatch every tool call in one assistant message, appending tool results.

    Two things are harvested, not one. `trace` is the grounding proof the teacher
    can open; `offers` is what the browser turns into buttons. Both come from the
    tool layer rather than from the model's prose, so both inherit the scope
    check and the audit row that `registry.dispatch` performs.
    """
    results: list[dict[str, Any]] = []
    # Derived from the accumulator rather than kept locally, so the dedupe holds
    # across every tool round in the turn, not just within one message.
    seen_offers = {
        json.dumps({k: v for k, v in offer.items() if k != "id"},
                   sort_keys=True, default=str)
        for offer in (offers or [])
    }
    for call in (message.get("tool_calls") or []):
        function = call.get("function") or {}
        name = function.get("name") or ""
        try:
            args = json.loads(function.get("arguments") or "{}")
        except (TypeError, ValueError):
            args = {}
        if not isinstance(args, dict):
            args = {}

        result = await teacher_tools.dispatch(name, args, context)
        trace.append({
            "name": name,
            "status": "error" if result.get("error") else
                      "empty" if result.get("data") is None else "ok",
            "reason": result.get("reason") or result.get("error"),
        })

        offer = result.get("offer")
        if offers is not None and isinstance(offer, dict):
            # Two identical chips is what a model calling `draft_goal` twice in
            # one turn looks like to the teacher, and pressing either writes the
            # same goal. Compared on content, not on the tool name, because the
            # same draft can arrive from more than one route.
            fingerprint = json.dumps(offer, sort_keys=True, default=str)
            if fingerprint not in seen_offers:
                seen_offers.add(fingerprint)
                # Ids are stable within a turn so the client can key rows and
                # record an outcome against exactly the button pressed.
                offers.append({"id": f"{name}:{len(offers)}", **offer})

        # The offer's *payload* is for the browser, not the model: echoing it
        # back invites the model to describe the button in prose as well, which
        # is the duplicated-offer failure the VOICE rules already fight.
        #
        # But deleting it outright was worse. The model then had no evidence in
        # its own transcript that a button existed at all — while the prompt
        # told it "the button IS the sentence" — so it did the only thing left
        # and typed one, which is where `[navigate_button: ...]` came from. A
        # stub says a card rendered without saying what is on it.
        # Mirrors the harvest condition above rather than testing `offer` alone:
        # with no accumulator there is no card, and claiming one would be a lie
        # the model cannot check.
        echoed = {k: v for k, v in result.items() if k != "offer"}
        if offers is not None and isinstance(offer, dict):
            echoed["offer_rendered"] = True
            echoed["offer_note"] = (
                "An action card with its button is already visible to the teacher. "
                "Still write your one sentence saying what you are proposing — "
                "but do not draw the button in text or restate its caption."
            )
        results.append({
            "role": "tool",
            "tool_call_id": call.get("id"),
            "name": name,
            "content": json.dumps(echoed, ensure_ascii=False, default=str),
        })
    return results


def _opening_messages(
    context: TeacherToolContext,
    user_message: str,
    history: Optional[list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": _system_prompt(context.language, context.screen)}
    ]
    for turn in (history or [])[-6:]:
        role = turn.get("role")
        if role in {"user", "assistant"} and turn.get("content"):
            messages.append({"role": role, "content": str(turn["content"])})
    messages.append({"role": "user", "content": user_message})
    return messages


async def run_assistant(
    teacher_id: str,
    user_message: str,
    *,
    language: str = "he",
    screen: Optional[dict] = None,
    history: Optional[list[dict[str, Any]]] = None,
    session_id: Optional[str] = None,
    context: Optional[TeacherToolContext] = None,
) -> dict[str, Any]:
    """Answer one teacher question. Returns text plus the trace that grounds it."""
    context = context or await build_context(
        teacher_id, language=language, screen=screen, session_id=session_id
    )

    messages = _opening_messages(context, user_message, history)

    trace: list[dict[str, Any]] = []
    offers: list[dict[str, Any]] = []
    text: Optional[str] = None

    for index in range(teacher_tools.MAX_ROUNDS):
        message = await _round(messages, context, index=index)
        if not isinstance(message, dict):
            # No provider. Deterministic, honest, and not an invented answer.
            return {"text_key": UNAVAILABLE, "text": None, "tools": trace, "grounded": False}

        if message.get("tool_calls"):
            messages.append(message)
            messages.extend(await _run_tools(message, context, trace, offers))
            if context.budget_exhausted():
                break
            continue

        text = (message.get("content") or "").strip()
        break

    # Layer 2 — a factual-looking answer with an empty trace does not ship.
    if text and not trace and _needs_grounding(text):
        forced = await _round(messages, context, index=teacher_tools.MAX_ROUNDS, force_tools=True)
        if isinstance(forced, dict) and forced.get("tool_calls"):
            messages.append(forced)
            messages.extend(await _run_tools(forced, context, trace, offers))
            final = await _round(messages, context, index=teacher_tools.MAX_ROUNDS + 1)
            text = (final or {}).get("content") if isinstance(final, dict) else None
            text = (text or "").strip() or None

        if not trace:
            return {"text_key": UNKNOWN_NO_DATA, "text": None, "tools": trace, "grounded": False}

    if not text:
        # A model that drafted a card and then said nothing has still done the
        # work: the offer passed the scope check and is ready to press. Throwing
        # it away and printing "not enough evidence" tells the teacher their
        # request failed when it succeeded. Say the honest thing instead and
        # keep the card. (The prompt requires prose; this is the net under it.)
        return {
            "text_key": UNKNOWN_OFFER_ONLY if offers else UNKNOWN_NOT_ENOUGH,
            "text": None, "tools": trace, "grounded": False,
            "actions": list(offers),
        }

    return {
        "text": text,
        "text_key": None,
        "tools": trace,
        # The teacher-visible claim: this answer stands on tool results.
        "grounded": bool(trace),
        "actions": list(offers),
    }


async def run_assistant_stream(
    teacher_id: str,
    user_message: str,
    *,
    language: str = "he",
    screen: Optional[dict] = None,
    history: Optional[list[dict[str, Any]]] = None,
    session_id: Optional[str] = None,
    context: Optional[TeacherToolContext] = None,
) -> AsyncGenerator[dict[str, Any], None]:
    """`run_assistant`, answered out loud — same five grounding layers, streamed.

    Yields, in order:

        {"trace": [...]}   after each tool round, so the client can show progress
        {"text": "..."}    answer fragments, as the model writes them
        {"done": {...}}    the exact payload `run_assistant` would have returned

    The one thing streaming could have broken is layer 2 — the rule that a
    factual-looking answer with an empty trace never ships. Text cannot be
    unsaid once it is on the teacher's screen, so this generator **buffers a
    round's text whenever the trace is still empty** and only releases it after
    the gate has had its say. Once any tool has run, `grounded` is already true
    and the gate cannot fire, so those rounds stream freely — which is the case
    that matters, since the tool-grounded answers are the long ones.
    """
    context = context or await build_context(
        teacher_id, language=language, screen=screen, session_id=session_id
    )

    messages = _opening_messages(context, user_message, history)

    trace: list[dict[str, Any]] = []
    offers: list[dict[str, Any]] = []
    text: Optional[str] = None
    streamed = False
    holder: list[dict[str, Any]] = []

    async def play_round(index: int, *, force_tools: bool = False):
        """Run one round, yielding its text only when the gate is already moot."""
        nonlocal streamed
        holder.clear()
        release = bool(trace)
        async for event in call_llm_stream_tools(
            messages,
            usage_context=context.usage_context.for_operation(
                f"teacher_assistant.round_{index}"
            ),
            max_tokens=900,
            model_tier=MODEL_TIER,
            tools=teacher_tools.schemas(),
            tool_choice="required" if force_tools else "auto",
        ):
            if event.get("type") == "message":
                holder.append(event["message"])
            elif event.get("type") == "text" and release and event.get("text"):
                streamed = True
                yield {"text": event["text"]}

    for index in range(teacher_tools.MAX_ROUNDS):
        async for event in play_round(index):
            yield event
        if not holder:
            # No provider, or the stream died. Deterministic, honest, not invented.
            yield {"done": {
                "text_key": UNAVAILABLE, "text": None, "tools": trace, "grounded": False,
            }}
            return
        message = holder[0]

        if message.get("tool_calls"):
            messages.append(message)
            messages.extend(await _run_tools(message, context, trace, offers))
            yield {"trace": list(trace)}
            if offers:
                yield {"actions": list(offers)}
            if context.budget_exhausted():
                break
            continue

        text = (message.get("content") or "").strip()
        break

    # Layer 2 — a factual-looking answer with an empty trace does not ship. Nothing
    # was streamed on that round (the trace was empty), so replacing it is still free.
    if text and not trace and _needs_grounding(text):
        async for event in play_round(teacher_tools.MAX_ROUNDS, force_tools=True):
            yield event
        forced = holder[0] if holder else None
        if isinstance(forced, dict) and forced.get("tool_calls"):
            messages.append(forced)
            messages.extend(await _run_tools(forced, context, trace, offers))
            yield {"trace": list(trace)}
            if offers:
                yield {"actions": list(offers)}
            text = None
            async for event in play_round(teacher_tools.MAX_ROUNDS + 1):
                yield event
            final = holder[0] if holder else None
            text = ((final or {}).get("content") or "").strip() or None

        if not trace:
            yield {"done": {
                "text_key": UNKNOWN_NO_DATA, "text": None, "tools": trace, "grounded": False,
            }}
            return

    if not text:
        # Same reasoning as the non-streaming path: a drafted card is work the
        # teacher asked for, and discarding it behind "not enough evidence"
        # reports a failure that did not happen.
        yield {"done": {
            "text_key": UNKNOWN_OFFER_ONLY if offers else UNKNOWN_NOT_ENOUGH,
            "text": None, "tools": trace, "grounded": False,
            "actions": list(offers),
        }}
        return

    # Buffered chit-chat: short, ungated, and never sent. Release it now.
    if not streamed:
        yield {"text": text}

    yield {"done": {
        "text": text, "text_key": None, "tools": trace, "grounded": bool(trace),
        # Repeated in the terminal frame so the route can persist them with the
        # message: a reopened thread must show what was offered, and whether the
        # teacher took it, or a stale button would write a second goal.
        "actions": list(offers),
    }}
