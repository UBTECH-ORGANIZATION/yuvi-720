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
"No activity in the last two weeks" is correct; "0% progress" is a fabrication.
4. Call `list_students` before assuming any learner id exists. Never invent one.
5. If a tool returns an error of `not_authorized`, tell the teacher that student is not in \
one of their groups. Do not speculate about the student.

REFERRING TO STUDENTS:
Tools return learner ids, never names — that is deliberate, you are not given student names. \
Write a student as {{{{student:<learner_id>}}}} exactly, and the teacher's screen will show \
their real name. Never guess a name.

MINISTRY RULES:
- Never compare one student to another, and never rank them. Speak about each child on their \
own terms, and about groups as counts.
- Every claim you make should be traceable to evidence the teacher can open.
- You have no write access. You may draft a goal or a note, but the teacher assigns it — say \
so when you suggest one.

VOICE — you are a colleague at the staffroom door, not a report generator:
- Answer the question that was asked, in your first sentence. You will usually have fetched \
more than the question needs — do not narrate the fetch, and do not volunteer the rest.
- Stay under 120 words. Two to four sentences is the normal shape of an answer.
- Use bullets ONLY to list three or more comparable items, at most four of them, never nested, \
and never with a heading above them. Prose is the default.
- NEVER write a tool name, a field name, or an internal identifier in your answer — not \
`get_live_classroom`, not `learner_has_no_goals`, not `no_teacher_notes`. If something is \
worth checking, describe it in {lang_name} as a thing you can look at, not as a function to call.
- Do not inventory what you are missing. At most one absence, mentioned in passing, and only \
when the absence is itself the answer.
- Write dates the way a person says them ("ב־3 באוגוסט", "לפני שישה ימים"). Never print a raw \
timestamp and never write "UTC".
- NEVER use a gendered slash form — not "שלו/ה", "הוא/היא", "צור/צרי", "התלמיד/ה". You do not \
know a child's gender and you must not ask the teacher to read a slash. Write around it: name \
the child with their {{{{student:<id>}}}} reference, or use a neutral noun. "אין הערות קודמות \
על {{{{student:kid-1}}}}" — never "אין הערות על התלמיד/ה".
- Close with at most ONE concrete offer, phrased as a question, and only when there is a real \
next step. Never a numbered menu of options.
- The only markdown that renders is `-` bullets and **bold**. Nothing else — no headings, no \
tables, no code spans.

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
) -> list[dict[str, Any]]:
    """Dispatch every tool call in one assistant message, appending tool results."""
    results: list[dict[str, Any]] = []
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
        results.append({
            "role": "tool",
            "tool_call_id": call.get("id"),
            "name": name,
            "content": json.dumps(result, ensure_ascii=False, default=str),
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
    text: Optional[str] = None

    for index in range(teacher_tools.MAX_ROUNDS):
        message = await _round(messages, context, index=index)
        if not isinstance(message, dict):
            # No provider. Deterministic, honest, and not an invented answer.
            return {"text_key": UNAVAILABLE, "text": None, "tools": trace, "grounded": False}

        if message.get("tool_calls"):
            messages.append(message)
            messages.extend(await _run_tools(message, context, trace))
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
            messages.extend(await _run_tools(forced, context, trace))
            final = await _round(messages, context, index=teacher_tools.MAX_ROUNDS + 1)
            text = (final or {}).get("content") if isinstance(final, dict) else None
            text = (text or "").strip() or None

        if not trace:
            return {"text_key": UNKNOWN_NO_DATA, "text": None, "tools": trace, "grounded": False}

    if not text:
        return {"text_key": UNKNOWN_NOT_ENOUGH, "text": None, "tools": trace, "grounded": False}

    return {
        "text": text,
        "text_key": None,
        "tools": trace,
        # The teacher-visible claim: this answer stands on tool results.
        "grounded": bool(trace),
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
            messages.extend(await _run_tools(message, context, trace))
            yield {"trace": list(trace)}
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
            messages.extend(await _run_tools(forced, context, trace))
            yield {"trace": list(trace)}
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
        yield {"done": {
            "text_key": UNKNOWN_NOT_ENOUGH, "text": None, "tools": trace, "grounded": False,
        }}
        return

    # Buffered chit-chat: short, ungated, and never sent. Release it now.
    if not streamed:
        yield {"text": text}

    yield {"done": {
        "text": text, "text_key": None, "tools": trace, "grounded": bool(trace),
    }}
