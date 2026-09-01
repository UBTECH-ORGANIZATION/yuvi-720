"""Yuvi writing assistant for mentoring conversation documentation (F5, §5.3).

Helps a young learner phrase what they discussed with their teacher. Uses the
shared Azure OpenAI model through APIM with a privacy-safe ``UsageContext``, and
a deterministic fallback so the demo runs without AI infra (never the prod path).

Child-safe: warm, first-person, everyday words, no numbers/grades, and the
suggestion never invents facts the learner did not share. Identity is never sent
in the prompt — only the learner's own free text and the (non-identifying)
feeling label.
"""

from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timedelta, timezone
from typing import Any

from app.services import goal_progress
from app.services.ai_usage import UsageContext
from app.services.llm import call_llm


_LANG_NAME = {"he": "Hebrew", "ar": "Arabic", "en": "English"}

_SYSTEM = (
    "You are Yuvi, a warm writing helper for a school student (grades 7-9). You help the student "
    "write, in their own name, a short documentation of a conversation or meeting they had with "
    "their teacher or mentor. This is NOT a free chat — you are a GUIDED WRITING assistant. "
    "You receive the questions already asked, the student's answers so far, and their current draft. "
    "Do TWO things, in {language}, warm and age-appropriate, short, with no numbers, grades, or scores: "
    "(1) Write the FULL draft: a first-person, warm documentation of the meeting, 2 to 6 short lines, "
    "everyday words, using ONLY what the student actually answered. NEVER invent feelings, decisions, "
    "or lessons they did not say. If a draft already exists (given as context), keep what the student "
    "wrote and build on it. If little was shared, keep the draft short. "
    "(2) If more would genuinely help, offer ONE short next question plus 2 to 4 short "
    "quick-choice options the student can simply tap (each just a few words, plain wording covering "
    "likely answers). Across the questions aim to cover: what the meeting was about, how they felt, "
    "what was said, and what they decided or want to improve. "
    "Use your OWN judgment to decide when the student has shared what they can: when the key points "
    "are covered, or when their answers become short, vague, or repetitive, STOP — set phase to "
    "'ready' and return an EMPTY question and EMPTY options. There is no fixed number of questions, "
    "but never loop endlessly (usually 3 to 5 questions is plenty), and never re-ask something "
    "already answered. Warm, encouraging, never blaming. No names, school, or private details. "
    "Return ONLY JSON: "
    '{{"draft": "<the full first-person draft so far>", "question": "<one short question>", '
    '"options": ["<short chip>", "<short chip>", "<short chip>"], "phase": "asking" | "ready"}}. '
    "Always answer in {language}."
)

_GUIDE = {
    "he": [
        {"q": "על מה בעיקר דיברתם בשיחה?", "options": ["על משהו שהצלחתי", "על קושי שהיה לי", "על יעד להמשך", "על ההתנהגות שלי"]},
        {"q": "ואיך הרגשת בשיחה הזו?", "options": ["הרגשתי טוב", "היה לי קצת קשה", "הרגשתי רגוע/ה", "הרגשתי גאה"]},
        {"q": "מה המורה אמר/ה, או מה הכי נשאר לך מהשיחה?", "options": ["שאני משתפר/ת", "שכדאי לשים לב למשהו", "שמאמינים בי", "משהו אחר"]},
        {"q": "מה החלטתם, או מה בא לך לשפר מכאן?", "options": ["להתאמץ יותר", "לבקש עזרה כשצריך", "לשים לב לזמנים", "להמשיך ככה"]},
    ],
    "ar": [
        {"q": "عمّ تحدثتم بشكل أساسي في المحادثة؟", "options": ["عن شيء نجحت فيه", "عن صعوبة واجهتني", "عن هدف للمستقبل", "عن سلوكي"]},
        {"q": "وكيف شعرت في هذه المحادثة؟", "options": ["شعرت بشعور جيد", "كان الأمر صعبًا قليلًا", "شعرت بالهدوء", "شعرت بالفخر"]},
        {"q": "ماذا قال المعلّم، أو ما الذي بقي معك أكثر من المحادثة؟", "options": ["أنني أتحسّن", "أن عليّ الانتباه لشيء", "أنهم يثقون بي", "شيء آخر"]},
        {"q": "ماذا قررتم، أو ما الذي تودّ تحسينه من الآن؟", "options": ["أن أبذل جهدًا أكبر", "أن أطلب المساعدة عند الحاجة", "أن أنتبه للوقت", "أن أستمر هكذا"]},
    ],
    "en": [
        {"q": "What did you mainly talk about?", "options": ["Something I did well", "A difficulty I had", "A goal for next time", "My behavior"]},
        {"q": "And how did you feel in this conversation?", "options": ["I felt good", "It was a bit hard", "I felt calm", "I felt proud"]},
        {"q": "What did the teacher say, or what stayed with you most?", "options": ["That I'm improving", "That I should watch something", "That they believe in me", "Something else"]},
        {"q": "What did you decide, or what would you like to improve from here?", "options": ["Try harder", "Ask for help when needed", "Watch my timing", "Keep it up"]},
    ],
}

_MORE_Q = {
    "he": "יש עוד משהו שתרצה/י להוסיף לתיעוד?",
    "ar": "هل هناك شيء آخر تودّ إضافته إلى التوثيق؟",
    "en": "Is there anything else you'd like to add?",
}
_MORE_OPTS = {
    "he": ["מה שהרגשתי אחרי", "מה שאני מקווה שיקרה", "משהו במילים שלי"],
    "ar": ["ما شعرت به بعد ذلك", "ما آمل أن يحدث", "شيء بكلماتي"],
    "en": ["How I felt after", "What I hope happens", "Something in my words"],
}


def _clean_qa(items: Any) -> list[dict[str, str]]:
    """Normalize the answered question/answer pairs to a capped, safe list."""
    out: list[dict[str, str]] = []
    if isinstance(items, list):
        for item in items[-8:]:
            if not isinstance(item, dict):
                continue
            q = str(item.get("q") or "").strip()[:300]
            a = str(item.get("a") or item.get("content") or "").strip()[:400]
            if a:
                out.append({"q": q, "a": a})
    return out


def _context_note(language: str, feeling: str, notes: str) -> str:
    parts = []
    if feeling.strip():
        parts.append(f"feeling label: {feeling.strip()[:120]}")
    if notes.strip():
        parts.append(f"notes so far: {notes.strip()[:400]}")
    return ("Context (do not repeat verbatim): " + "; ".join(parts)) if parts else ""


def _fallback_guide(language: str, qa: list[dict[str, str]], more: bool = False) -> dict[str, Any]:
    """Deterministic guided-writing script when the LLM is unavailable.

    Builds the draft honestly from the student's own answers, offers the next
    scripted question, and STOPS (phase 'ready') once the script is exhausted so
    it never loops — unless the student explicitly asks for another question.
    """
    guide = _GUIDE.get(language, _GUIDE["he"])
    answers = [p["a"] for p in qa if p.get("a")]
    draft = "\n".join(a for a in answers if a)[:2500]
    idx = len(answers)
    if idx < len(guide):
        item = guide[idx]
        return {"draft": draft, "question": item["q"], "options": list(item["options"]), "phase": "asking"}
    if more:
        return {
            "draft": draft,
            "question": _MORE_Q.get(language, _MORE_Q["he"]),
            "options": list(_MORE_OPTS.get(language, _MORE_OPTS["he"])),
            "phase": "asking",
        }
    return {"draft": draft, "question": "", "options": [], "phase": "ready"}


async def guide_documentation(
    learner_id: str,
    *,
    language: str = "he",
    qa: Any = None,
    notes: str = "",
    feeling: str = "",
    more: bool = False,
    **_ignore: Any,
) -> dict[str, Any]:
    """One turn of Yuvi's guided writing helper.

    Returns ``{draft, question, options, phase, ai}``. ``draft`` is the full
    first-person documentation built only from what the student answered;
    ``question`` + ``options`` are the next single prompt and its quick chips.
    ``phase`` is ``ready`` once the key points are covered.
    """
    language = language if language in _LANG_NAME else "he"
    pairs = _clean_qa(qa)

    try:
        llm_messages: list[dict[str, str]] = [
            {"role": "system", "content": _SYSTEM.format(language=_LANG_NAME[language])},
        ]
        context = _context_note(language, feeling, notes)
        if context:
            llm_messages.append({"role": "system", "content": context})
        if pairs:
            transcript = "\n\n".join(f"Q: {p['q']}\nA: {p['a']}" for p in pairs)
            user = "Questions asked and the student's answers so far:\n" + transcript
            if more:
                user += (
                    "\n\nThe student tapped 'ask me another question' — offer ONE fresh, "
                    "different question (not already asked) with new options."
                )
        else:
            user = (
                "[The student just opened the writing helper and the draft is empty. "
                "Give a warm first question with 2-4 quick options; keep the draft empty.]"
            )
        llm_messages.append({"role": "user", "content": user})

        raw = await call_llm(
            llm_messages,
            usage_context=UsageContext(
                actor_id=learner_id,
                actor_type="learner",
                endpoint="/api/mentoring/assist",
                feature="feature_5_mentoring",
                operation="mentoring.documentation_chat",
                source="mentoring_yuvi",
            ),
            max_tokens=1400,
            json_mode=True,
            model_tier="mini",
        )
        data = json.loads(raw or "{}") or {}
        draft = str(data.get("draft") or "").strip()
        question = str(data.get("question") or "").strip()
        options = [str(o).strip() for o in (data.get("options") or []) if str(o).strip()][:4]
        phase = "ready" if str(data.get("phase")) == "ready" else "asking"
        if draft or question:
            from app.agents.safety import screen_output
            if draft:
                draft = screen_output(draft, language).text or draft
            if question:
                question = screen_output(question, language).text or question
            return {"draft": draft, "question": question, "options": options, "phase": phase, "ai": True}
    except Exception as exc:  # never break the composer — fall back
        print(f"⚠️ mentoring assist failed: {type(exc).__name__}")

    return {**_fallback_guide(language, pairs, more), "ai": False}


# --- Goal recommendation (F5→F4) --------------------------------------------
# After the child documents the talk + how they felt, Yuvi proposes ONE small,
# concrete goal reachable within a one-week window. The deadline is set by the
# backend (today + 7 days) so the window is guaranteed regardless of the model.

_GOAL_SYSTEM = (
    "You are Yuvi, a warm learning companion for a school student (grades 7-9). Based on the "
    "student's short documentation of a talk with their teacher and how they felt, propose ONE small, "
    "concrete, encouraging goal they could realistically reach within ONE WEEK. It must be a single "
    "clear action, doable and age-appropriate, in {language}, phrased positively and warmly (never "
    "blaming), with no numbers, grades, or scores. Use ONLY what the student shared; do not invent "
    "facts, names, or private details. "
    "Return ONLY JSON: "
    '{{"title": "<short goal, a few words>", "next_steps": "<one concrete first step, one short '
    'sentence>", "rationale": "<one short warm sentence, for the student, on why this goal fits>"}}. '
    "Always answer in {language}."
)

_GOAL_FALLBACK = {
    "he": {
        "title": "צעד קטן להמשך",
        "next_steps": "לבחור דבר אחד קטן לנסות השבוע.",
        "rationale": "צעד קטן וברור עוזר להתקדם בלי לחץ.",
    },
    "ar": {
        "title": "خطوة صغيرة للمتابعة",
        "next_steps": "اختيار شيء صغير واحد لتجربته هذا الأسبوع.",
        "rationale": "خطوة صغيرة وواضحة تساعد على التقدّم دون ضغط.",
    },
    "en": {
        "title": "A small next step",
        "next_steps": "Pick one small thing to try this week.",
        "rationale": "A small, clear step helps you move forward without pressure.",
    },
}


async def recommend_goal(
    learner_id: str,
    *,
    language: str = "he",
    notes: str = "",
    feeling: str = "",
) -> dict[str, Any]:
    """Suggest ONE small goal within a one-week window from the child's documentation.

    Returns ``{title, next_steps, rationale, deadline, ai}``. ``deadline`` is
    always today + 7 days so the weekly window holds even on the fallback path.
    """
    language = language if language in _LANG_NAME else "he"
    deadline = (date.today() + timedelta(days=7)).isoformat()
    notes = (notes or "").strip()

    try:
        llm_messages: list[dict[str, str]] = [
            {"role": "system", "content": _GOAL_SYSTEM.format(language=_LANG_NAME[language])},
        ]
        context = _context_note(language, feeling, notes)
        if context:
            llm_messages.append({"role": "system", "content": context})
        llm_messages.append({
            "role": "user",
            "content": notes or "[The student did not write much — suggest one gentle, general goal.]",
        })

        raw = await call_llm(
            llm_messages,
            usage_context=UsageContext(
                actor_id=learner_id,
                actor_type="learner",
                endpoint="/api/mentoring/recommend-goal",
                feature="feature_5_mentoring",
                operation="mentoring.goal_recommendation",
                source="mentoring_yuvi",
            ),
            max_tokens=260,
            json_mode=True,
            model_tier="mini",
        )
        data = json.loads(raw or "{}") or {}
        title = str(data.get("title") or "").strip()
        next_steps = str(data.get("next_steps") or "").strip()
        rationale = str(data.get("rationale") or "").strip()
        if title or next_steps:
            from app.agents.safety import screen_output
            if title:
                title = screen_output(title, language).text or title
            if next_steps:
                next_steps = screen_output(next_steps, language).text or next_steps
            if rationale:
                rationale = screen_output(rationale, language).text or rationale
            return {"title": title, "next_steps": next_steps, "rationale": rationale, "deadline": deadline, "ai": True}
    except Exception as exc:  # never break the composer — fall back
        print(f"⚠️ goal recommendation failed: {type(exc).__name__}")

    fallback = _GOAL_FALLBACK.get(language, _GOAL_FALLBACK["he"])
    return {**fallback, "deadline": deadline, "ai": False}



# ── teacher-facing goal suggestions (F6 → F5) ────────────────────────────────

# The goal is filed as the CHILD'S OWN goal — the child reads it and earns
# sparks for completing it — while the rationale stays on the teacher's screen.
# So the audience is named per field, not once for the whole prompt: flipping
# everything to "address the student" would hand the teacher a justification
# written to a child, and the old "address the teacher" produced teaching
# strategies a child cannot complete ("give the student an example first").
_TEACHER_GOAL_SYSTEM = (
    "You help a teacher set ONE small, concrete weekly goal for a student.\n"
    "The goal is filed as the STUDENT'S OWN goal: the student reads it and "
    "the student is the one who completes it.\n"
    "Write in {language}.\n"
    "`title` and `next_steps` are read by the STUDENT. Address the student "
    "in the second person, and describe an action THE STUDENT performs — "
    "never something the teacher does for them, watches for, or applies to "
    "them. In gendered languages use gender-inclusive second person "
    "(Hebrew: נסה/י, תסתכל/י).\n"
    "Every goal is an action the student takes INSIDE the learning platform "
    "— something the system can watch happen. The actions that exist: open a "
    "lesson and practise a named subject or topic; complete a task the "
    "teacher assigned; use a hint when stuck instead of guessing; ask Yuvi "
    "to explain something unclear before answering; try a question again "
    "after a wrong answer; come back to learn on more days of the week. "
    "Pick the action that answers the evidence and, when the evidence names "
    "a topic, attach it (e.g. לתרגל שיעור אחד בשברים השבוע; לבקש רמז "
    "כשנתקעים בתרגיל במקום לנחש; לשאול את יובי שאלה כשמשהו לא ברור).\n"
    "Never suggest study techniques the platform cannot see — saying things "
    "out loud, imagining, connecting to interests, working with paper. A "
    "goal like that can never be checked off, so it must not be suggested.\n"
    "If a piece of evidence cannot be answered by one of these platform "
    "actions, leave it out — do not bend it into a goal. Two goals that a "
    "student can really do beat three where one is forced.\n"
    "`rationale` is read by the TEACHER only: one short sentence on why this "
    "goal fits, for the person deciding whether to set it.\n"
    "Ground every suggestion ONLY in the evidence given. Do not invent a "
    "difficulty, a topic or a behaviour that is not in it.\n"
    "Each goal must be achievable in a week and observable — something the "
    "student either did or did not do.\n"
    'Return JSON: {{"goals": [{{"title": str, "next_steps": str, '
    '"rationale": str, "signal": str, "action": {{"kind": str, '
    '"target": int}}}}]}} with up to {count} goals.\n'
    "`action.kind` is the platform action the goal asks for, exactly one of: "
    "use_hint (use a hint when stuck), ask_yuvi (ask Yuvi a question), "
    "retry_after_wrong (try again after a wrong answer), practice (answer "
    "practice questions), complete_task (finish an assigned task), "
    "active_days (learn on distinct days). `action.target` is how many times "
    "within the week the goal means — small and honest (2-5 for most kinds, "
    "2-6 for active_days). The system counts these actions for the teacher, "
    "so kind and target must match what the goal text literally asks.\n"
    "`signal` names WHICH piece of the evidence the goal answers, copied "
    "verbatim from the evidence keys."
)


def _teacher_goal_fallback(language: str, gaps: list[dict[str, Any]], deadline: str
                           ) -> list[dict[str, Any]]:
    """Deterministic drafts from the top unmastered objectives.

    The teacher must be able to work when the model is unavailable, and a goal
    derived from a real mastery gap is a genuinely useful suggestion — not a
    placeholder. Every one still carries its `because`.
    """
    base = _GOAL_FALLBACK.get(language, _GOAL_FALLBACK["he"])
    drafts = []
    for gap in gaps[:3]:
        label = gap.get("label") or gap.get("objective_id") or ""
        drafts.append({
            "title": f"{base['title']}: {label}".strip(": "),
            "next_steps": base["next_steps"],
            "rationale": base["rationale"],
            "deadline": deadline,
            "ai": False,
            "because": _because("mastery_gap", {"struggle_items": [gap]}),
        })
    if not drafts:
        drafts.append({**base, "deadline": deadline, "ai": False,
                       "because": {"signal": "no_evidence", "value": None,
                                   "raw": {"reason": "no_mastery_evidence"}}})
    return drafts



def _has_description(description: Any) -> bool:
    """True only when `student_description` actually says something.

    The brain always returns the container — `{"blocks": {...}, "text": None}` —
    so a plain truthiness test passes for a learner nobody has observed yet, and
    the "no evidence" card never fires. Emptiness has to be checked on content.
    """
    if isinstance(description, str):
        return bool(description.strip())
    if not isinstance(description, dict):
        return bool(description)
    if str(description.get("text") or "").strip():
        return True
    blocks = description.get("blocks") or {}
    return any(bool(value) for value in blocks.values()) if isinstance(blocks, dict) else False


def _description_line(description: Any, limit: int = 220) -> str:
    """The description as ONE readable line.

    The brain hands back a container — `{"blocks": {...}, "text": …, "stale":
    …, "events_since_generation": …}` — and passing that straight through as
    evidence is how a teacher ended up reading `blocks [object Object]` and
    `events since generation 4` in a panel that was supposed to explain a
    suggestion. Only the prose comes out, and only as much as a person reads.
    """
    if isinstance(description, str):
        text = description
    elif isinstance(description, dict):
        text = str(description.get("text") or "").strip()
        if not text:
            blocks = description.get("blocks")
            parts = [str(value).strip() for value in blocks.values()
                     if isinstance(blocks, dict) and str(value or "").strip()]
            text = " · ".join(parts)
    else:
        text = str(description or "")
    text = " ".join(text.split())
    return text[:limit].rstrip() + "…" if len(text) > limit else text


def _because(signal: str, evidence: dict[str, Any]) -> dict[str, Any]:
    """The grounding a teacher can read, not the payload it came from.

    Explainability (MoE F6) asks for the datum behind a suggestion. It does not
    ask for the request body: a list of dicts and a description container
    rendered as `label: value` lines is technically the evidence and is not an
    explanation of anything. Each signal gets the few words that answer "why
    this goal, for this child".
    """
    labels = [str(gap.get("label") or gap.get("objective_id") or "").strip()
              for gap in (evidence.get("struggle_items") or [])]
    labels = [label for label in labels if label][:3]
    challenges = [item for item in (evidence.get("challenges") or []) if str(item).strip()][:3]
    line = _description_line(evidence.get("student_description"))

    if signal in ("struggle_items", "mastery_gap") and labels:
        return {"signal": "struggle_items", "value": None, "raw": {"labels": labels}}
    if signal == "challenges" and challenges:
        return {"signal": "challenges", "value": None, "raw": {"challenges": challenges}}
    if signal == "student_description" and line:
        return {"signal": "student_description", "value": None, "raw": {"observation": line}}

    # The model named a key that carries nothing, or none at all. Fall to the
    # strongest evidence there actually is rather than shipping everything.
    if labels:
        return {"signal": "struggle_items", "value": None, "raw": {"labels": labels}}
    if challenges:
        return {"signal": "challenges", "value": None, "raw": {"challenges": challenges}}
    if line:
        return {"signal": "student_description", "value": None, "raw": {"observation": line}}
    return {"signal": "no_evidence", "value": None, "raw": {}}


async def _goal_evidence(
    learner_id: str, language: str, subject: str | None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """What the system has observed about this learner, for goal setting."""
    # The privacy gate. `teacher_assistant` is the view without identity, raw
    # instrument scores, or the learner's private memory.
    from app.brain.context_engine import AgentScopeError, view_for
    from app.services import insights

    try:
        view = await view_for("teacher_assistant", learner_id)
    except AgentScopeError:
        # A missing scope entry is a programming error, not a runtime condition —
        # swallowing it once cost us a phase of silently ungrounded suggestions.
        raise
    except Exception:
        view = {}       # a brain read failure degrades to the insights-only lane

    student = await insights.student_insights(learner_id, language=language, subject=subject)
    gaps = [
        {"objective_id": item.get("objective_id"), "label": item.get("label"),
         "evidence": item.get("evidence")}
        for item in (student.get("struggle_items") or [])
    ][:5]
    # A challenge is `{"label": …, "status": "working"}` in this scope, and
    # `str()` on it put `{'label': …, 'status': 'working'}` in front of a teacher
    # — and in the model's prompt. Only the words come out.
    challenges: list[str] = []
    for item in (view.get("challenges") or [])[:5]:
        text = (item.get("label") or item.get("text") or "") if isinstance(item, dict) else item
        text = " ".join(str(text).split())
        if text:
            challenges.append(text)

    description = view.get("student_description") or ""

    return {
        "struggle_items": gaps,
        "challenges": challenges,
        "student_description": description,
    }, gaps


async def suggest_goals_for_teacher(
    learner_id: str,
    teacher_id: str,
    *,
    language: str = "he",
    subject: str | None = None,
    count: int = 3,
) -> list[dict[str, Any]]:
    """Three goal DRAFTS for a teacher, grounded in the brain.

    Grounded differently from `recommend_goal`, deliberately. That one is built
    from what the *child wrote*; this one is built from what the system has
    *observed* — mastery gaps, open challenges, recent struggle items — because a
    teacher is choosing where to intervene, not reflecting on a conversation.

    Returns three candidates rather than one: the teacher picks and edits, and
    the AI never writes a goal into a child's profile unattended. Every draft
    carries `because`, the same explainability contract as every other AI surface
    in the teacher app.

    Generates every time it is called. `goal_suggestions` is the cached door in
    front of it, and the one the routes use.
    """
    language = language if language in _LANG_NAME else "he"
    deadline = (date.today() + timedelta(days=7)).isoformat()
    count = max(1, min(count, 5))

    evidence, gaps = await _goal_evidence(learner_id, language, subject)
    description = evidence["student_description"]
    challenges = evidence["challenges"]

    if not gaps and not challenges and not _has_description(description):
        # No evidence means no grounded suggestion. Saying so is the honest
        # answer; inventing three plausible goals would be exactly the
        # hallucination this system is supposed to refuse.
        return [{
            "title": "", "next_steps": "", "rationale": "", "deadline": deadline,
            "ai": False, "unavailable": True,
            "because": {"signal": "no_evidence", "value": None,
                        "raw": {"reason": "no_observations_for_this_learner"}},
        }]

    try:
        raw = await call_llm(
            [
                {"role": "system", "content": _TEACHER_GOAL_SYSTEM.format(
                    language=_LANG_NAME[language], count=count)},
                {"role": "user", "content": json.dumps(evidence, ensure_ascii=False)},
            ],
            usage_context=UsageContext(
                actor_id=teacher_id,
                actor_type="teacher",
                endpoint="/api/teacher/students/{id}/goals/suggest",
                feature="feature_6_teacher_view",
                operation="teacher.goal_suggestion",
                source="mentoring_assist",
            ),
            model_tier="mini",
            json_mode=True,
        )
        parsed = json.loads(raw) if isinstance(raw, str) else (raw or {})
        drafts = []
        for item in (parsed.get("goals") or [])[:count]:
            title = str(item.get("title") or "").strip()
            if not title:
                continue
            signal = str(item.get("signal") or "student_description")
            drafts.append({
                "title": title,
                "next_steps": str(item.get("next_steps") or "").strip(),
                "rationale": str(item.get("rationale") or "").strip(),
                "deadline": deadline,
                "ai": True,
                # The countable promise. Validated against the closed
                # vocabulary; a bad shape degrades to an untracked goal
                # rather than an error.
                "action": goal_progress.normalize_action(item.get("action")),
                # Mandatory. A teacher acting on a suggestion must be able to see
                # which observation produced it — as a sentence, not as the blob
                # the model was handed.
                "because": _because(signal, evidence),
            })
        if drafts:
            return drafts
    except Exception as exc:
        print(f"⚠️ teacher goal suggestion failed: {type(exc).__name__}")

    return _teacher_goal_fallback(language, gaps, deadline)


# ── the cache in front of them ───────────────────────────────────────────────
#
# Goal suggestions were regenerated on every press of the button, which is wrong
# in three ways at once. It spends a model call on a question whose answer has
# not changed. It gives a teacher three different answers to the same question
# within a minute, which is the fastest way to teach someone that none of them
# mean anything. And it invites re-rolling until the wording is agreeable —
# turning a grounded suggestion into a slot machine.
#
# So they are generated once and kept, and the only thing that brings new ones
# is new evidence. What counts as new evidence is the fingerprint below: the
# objectives the child is struggling with, the open challenges, and the text of
# the description. Not the timestamps around them, not the order they arrive in,
# and not the teacher's patience.
#
# Deliberately NOT in the fingerprint: goals already assigned. Assigning one
# does not change what the child needs, and regenerating on every assignment
# would put the spend back exactly where it was removed from.

GOAL_SUGGESTION_COLLECTION = "goal_suggestions"

# Part of the cache id, not the fingerprint. Bump when _TEACHER_GOAL_SYSTEM
# changes in a way that makes previously cached suggestions wrong (v2: goals
# address the child, not the teacher; v3: goals must name the topic/material
# they apply to; v4: goals are observable in-platform actions — practise,
# hint, ask Yuvi, retry, return — never off-platform study techniques). Old
# rows become unreachable — a teacher never sees old-voice text again — while
# the fingerprint keeps meaning exactly "the evidence moved" and the
# anti-reroll property is untouched. v5: unmappable evidence is skipped, up to
# {count} goals rather than exactly. v6: each goal carries a machine-readable
# `action` {kind, target} so goal progress is countable.
_GOAL_PROMPT_VERSION = "v6"


def _goal_cache_id(learner_id: str, language: str, subject: str | None) -> str:
    """Language and subject key the row rather than the fingerprint: they change
    which suggestions are wanted, not whether the old ones are still true."""
    return f"{learner_id}|{language}|{subject or 'all'}|{_GOAL_PROMPT_VERSION}"


def _goal_fingerprint(evidence: dict[str, Any]) -> str:
    """What the suggestions were grounded in, canonicalised.

    Sorted, so a reordered struggle list is not new evidence. Labels and ids
    only — `evidence` strings under a struggle item carry counts that move on
    every answered question, and a suggestion does not stop being right because
    a child got one more sum wrong.
    """
    material = {
        "objectives": sorted(
            str(gap.get("objective_id") or gap.get("label") or "")
            for gap in (evidence.get("struggle_items") or [])),
        "challenges": sorted(str(item) for item in (evidence.get("challenges") or [])),
        "description": _description_line(evidence.get("student_description"), limit=400),
    }
    blob = json.dumps(material, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()[:16]


async def _load_goal_suggestions(cache_id: str) -> dict[str, Any] | None:
    from app.brain.repository import _get_collection_named
    collection = _get_collection_named(GOAL_SUGGESTION_COLLECTION)
    if collection is None:
        return None
    try:
        return await collection.find_one({"_id": cache_id})
    except Exception:  # pragma: no cover - a cache miss is not an error
        return None


async def _store_goal_suggestions(cache_id: str, document: dict[str, Any]) -> None:
    from app.brain.repository import _get_collection_named
    collection = _get_collection_named(GOAL_SUGGESTION_COLLECTION)
    if collection is None:
        return
    try:
        await collection.update_one({"_id": cache_id},
                                    {"$set": {"_id": cache_id, **document}}, upsert=True)
    except Exception as exc:  # pragma: no cover - never fail the request
        print(f"⚠️ goal suggestions not cached: {type(exc).__name__}: {exc}")


async def goal_suggestions(
    learner_id: str,
    teacher_id: str,
    *,
    language: str = "he",
    subject: str | None = None,
    count: int = 3,
    allow_generate: bool = True,
) -> dict[str, Any]:
    """The cached door in front of `suggest_goals_for_teacher`.

    ``allow_generate=False`` never calls the model: it answers from the cache or
    says there is nothing, which is what a page opening asks. The teacher's
    button asks with it True — and only when there is nothing cached, or when
    the evidence has moved since.

    Returns ``{goals, cached, generated_at, stale, evidence}`` where `stale`
    means "these are real, and something has happened since". The screen shows
    them anyway and offers new ones; it does not quietly hide a grounded
    suggestion because a fingerprint changed.
    """
    language = language if language in _LANG_NAME else "he"
    cache_id = _goal_cache_id(learner_id, language, subject)

    evidence, _ = await _goal_evidence(learner_id, language, subject)
    fingerprint = _goal_fingerprint(evidence)
    has_evidence = bool(
        evidence["struggle_items"] or evidence["challenges"]
        or _has_description(evidence["student_description"]))

    cached = await _load_goal_suggestions(cache_id)
    if cached and cached.get("goals"):
        stale = str(cached.get("fingerprint") or "") != fingerprint
        if not stale or not allow_generate:
            return {
                "goals": cached["goals"],
                "cached": True,
                "generated_at": cached.get("generated_at"),
                "stale": stale,
                "has_evidence": has_evidence,
            }

    if not allow_generate:
        return {"goals": [], "cached": False, "generated_at": None,
                "stale": False, "has_evidence": has_evidence}

    goals = await suggest_goals_for_teacher(
        learner_id, teacher_id, language=language, subject=subject, count=count)
    generated_at = datetime.now(timezone.utc).isoformat()

    # An "no evidence for this learner" card is a true answer, not a result to
    # keep: the day an observation arrives, the button must produce real ones.
    if goals and not any(goal.get("unavailable") for goal in goals):
        await _store_goal_suggestions(cache_id, {
            "learner_id": learner_id,
            "language": language,
            "subject": subject,
            "fingerprint": fingerprint,
            "generated_at": generated_at,
            "generated_by": teacher_id,
            "goals": goals,
        })

    return {"goals": goals, "cached": False, "generated_at": generated_at,
            "stale": False, "has_evidence": has_evidence}


async def ensure_goal_suggestion_indexes() -> None:
    from app.brain.repository import _get_collection_named
    collection = _get_collection_named(GOAL_SUGGESTION_COLLECTION)
    if collection is None:
        return
    try:
        await collection.create_index([("learner_id", 1)])
    except Exception as exc:  # pragma: no cover
        print(f"⚠️ goal suggestion indexes: {type(exc).__name__}: {exc}")


# ── meeting preparation (F5, Phase 7) ────────────────────────────────────────

#: Which `attention_all` rows may be handed to the prep model — an ALLOW-list,
#: deliberately, because the one kind that must never appear here is the one a
#: block-list would forget. `kind: "wellbeing"` carries the child's own words
#: from a distress disclosure (`insights.py`), and handing that to a model to
#: paraphrase puts a private sentence — possibly a WRONG private sentence — on
#: a sheet the teacher reads with the child walking toward them. The presence
#: of such a flag still reaches the sheet, through `wellbeing_open`; the words
#: stay on the profile, behind the affordance built for them.
_BEHAVIOUR_KINDS = frozenset({
    "inactivity", "low_success", "slow_progress",
    "rapid_guessing", "wheel_spinning", "overdue_goal", "help_requested",
})

_MEETING_SYSTEM = """You are an experienced pedagogical adviser preparing a \
teacher for a one-to-one conversation with a student. They will read what you \
write in the thirty seconds before that student sits down. Write in {language}.

You are given `observations`, all of them real. `struggle_items`, \
`objectives_progress` and `open_goals` say where this student STANDS. \
`behaviour`, `recommendations` and `focus` say how they WORK and what the \
platform would do next. `strengths`, `challenges` and `student_description` \
say who they are.

THE TEST EVERY LINE MUST PASS: read on its own, by someone who has seen none \
of this data, is it clear WHAT was observed and WHY it is worth raising? \
"In space, it is worth opening through the wish to succeed" fails — the \
subject is a bare noun and "it" refers to nothing. "Fractions take a lot of \
tries, but the same student explains mass and volume confidently — worth \
asking what makes the difference" passes.

- Ground every line in the observations. Never invent an event, a score, a \
date or a trajectory. You have no history, so nothing improved, dropped or \
changed over time.
- WRITE IT SO IT STANDS ALONE. Name the subject, the topic or the behaviour in \
full words. No bare labels, no pronoun without the thing it refers to, no \
shorthand only the data explains.
- One or two sentences, up to about 30 words. Long enough to carry the \
context, short enough to read standing up. Prefer the shorter version that \
still explains itself; a line the teacher has to decode is worse than a long \
one.
- LEAD WITH BEHAVIOUR AND STRATEGY, not with score-keeping. What they do when \
it is hard, what they avoid, what they lean on, what already works. A teacher \
can read the counts on the profile; they cannot read this anywhere.
- A number earns its place only when it carries information: many tries on one \
objective, a long silence, a streak. NEVER write a count that says nothing — \
"0 of 1 goals", "0 days since the last event", "1 of 2".
- Insights are for the TEACHER: the thing worth noticing, or what to steer the \
conversation toward. At most one may restate the standing.
- Questions are for the STUDENT, in the second person, and each is one move: \
say the observation in plain words, then ask about THEIR experience of it — \
what helps, what gets in the way, what it is like when it happens. Never two \
questions in one, never "why did you", never an accusation.
- Use the strengths. At least one question starts from something that already \
works for this student and asks how to carry it into what does not.
- Goal ideas are what the two of them could agree on, addressed to the student, \
small enough to be true within a week, and each says what to DO — not what to \
be better at.
- If `wellbeing_open` is true, one insight may tell the teacher to leave room \
for how the student is doing, without guessing at what they said.
- Never compare this student to anyone else, and never turn a total into a \
verdict ("weak", "behind").
- GIVE THREE OF EACH. Three questions, three insights, three goal ideas, each \
resting on a DIFFERENT observation. Fall to two only when there is genuinely \
nothing else grounded to say, and never pad with a line that could have been \
written about any student.
- NEVER ASSUME THE STUDENT'S GENDER. You have not been told it. In Hebrew and \
Arabic use gender-free phrasing, or the slash forms the platform already uses \
("נסה/י", "תלמיד/ה"). Never a bare masculine "אתה" or a bare imperative.
- `signal` must be exactly one of `valid_signals` — the key of the observation \
the line rests on. A line whose signal is not in that list is discarded.

Return JSON:
{{"questions": [{{"text": "...", "signal": "<one of valid_signals>"}}],
  "insights":  [{{"text": "...", "signal": "<one of valid_signals>"}}],
  "goal_ideas":[{{"text": "...", "signal": "<one of valid_signals>"}}]}}"""


def _meeting_raw(signal: str, evidence: dict[str, Any]) -> dict[str, Any]:
    """The `raw` the disclosure can turn into a sentence, per signal.

    `describeSignal` writes one localized line per signal from a shape it knows
    — `{"labels": [...]}` for the objective lists, `{"observation": "..."}` for
    the description. Handing it the evidence object verbatim, which is what
    this did, made it fall through to the generic renderer and print the
    payload the model was given. The row still cites the same signal; it just
    arrives in the shape the reader speaks.
    """
    value = evidence.get(signal)
    if signal == "struggle_items":
        return {"labels": [item.get("label") for item in (value or []) if item.get("label")],
                "items": value or []}
    if signal == "strengths":
        return {"labels": [str(item) for item in (value or []) if item]}
    if signal == "challenges":
        return {"challenges": list(value or [])}
    if signal == "open_goals":
        return {"labels": [goal.get("title") for goal in (value or []) if goal.get("title")]}
    if signal == "student_description":
        return {"observation": " ".join(str(value or "").split())[:200]}
    if signal == "behaviour":
        return {"labels": [item.get("observed") for item in (value or [])
                           if item.get("observed")]}
    if signal == "recommendations":
        return {"labels": [row.get("text") for row in (value or []) if row.get("text")]}
    if signal == "focus":
        return {"observation": (value or {}).get("objective_title") or ""}
    # `objectives_progress`, `activity` and `self_awareness_gap` are already
    # small keyed objects the renderer reads directly.
    return value if isinstance(value, dict) else {"value": value}


def _meeting_fallback(language: str, evidence: dict[str, Any]) -> dict[str, Any]:
    """A usable prep sheet with no LLM — derived straight from the observations."""
    questions, insights_out, goals = [], [], []

    for item in (evidence.get("struggle_items") or [])[:2]:
        label = item.get("label") or ""
        questions.append({
            "text_key": "tch.meeting.fallback.question.struggle",
            "params": {"label": label},
            "because": {"signal": "struggle_items", "value": label, "raw": item},
        })
        goals.append({
            "text_key": "tch.meeting.fallback.goal.struggle",
            "params": {"label": label},
            "because": {"signal": "struggle_items", "value": label, "raw": item},
        })

    for item in (evidence.get("strengths") or [])[:1]:
        label = item if isinstance(item, str) else str(item)
        insights_out.append({
            "text_key": "tch.meeting.fallback.insight.strength",
            "params": {"label": label},
            "because": {"signal": "strengths", "value": label, "raw": {"strength": label}},
        })

    gap = evidence.get("self_awareness_gap")
    if gap:
        insights_out.append({
            "text_key": "tch.meeting.fallback.insight.awareness",
            "params": {"kind": gap.get("kind") or ""},
            "because": {"signal": "self_awareness_gap", "value": gap.get("kind"), "raw": gap},
        })
        questions.append({
            "text_key": "tch.meeting.fallback.question.awareness",
            "params": {},
            "because": {"signal": "self_awareness_gap", "value": gap.get("kind"), "raw": gap},
        })

    return {"questions": questions, "insights": insights_out, "goal_ideas": goals}


MEETING_PREP_COLLECTION = "meeting_prep"

#: A week. The sheet is grounded in a term's worth of learning, not in this
#: morning — and regenerating it on every composer open cost a model call per
#: open and, worse, handed the teacher three DIFFERENT things to raise each
#: time they looked. Prep a teacher cannot rely on is prep they stop reading.
#: The window is deliberately long for the same reason `goal_suggestions` is
#: cached at all: suggestions that change under you are suggestions you learn
#: to disbelieve.
_PREP_TTL_SECONDS = 7 * 24 * 60 * 60

#: Part of the id, so a prompt change makes old rows unreachable rather than
#: mixing two generations of wording in one class. v1: the sheet was rewritten
#: to quote the numbers from the learnings map. v2: one short sentence per
#: line. v3: behaviour and strategy over score-keeping — v2 quoted the counts
#: faithfully and produced "0 of 1 learning goals", which is bookkeeping a
#: teacher can already read on the profile. v4: lines that stand on their own,
#: three per band — v3 bought its brevity with sentences only the data
#: explained, and lost most of its rows to invented citation keys. v5:
#: gender-free — v4 addressed every child as "אתה".
_PREP_VERSION = "v5"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _prep_cache_id(learner_id: str, language: str) -> str:
    """Keyed by the LEARNER, not the teacher.

    Two teachers preparing for the same child should read the same sheet — it
    is a reading of that child's learning, not of who is about to talk to them
    — and the second one should not pay for it again.
    """
    return f"{learner_id}|{language}|{_PREP_VERSION}"


def _prep_is_fresh(document: dict[str, Any] | None) -> bool:
    if not document or not document.get("generated_at"):
        return False
    try:
        made = datetime.fromisoformat(str(document["generated_at"]))
    except ValueError:
        return False
    if made.tzinfo is None:
        made = made.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - made).total_seconds() < _PREP_TTL_SECONDS


async def _load_meeting_prep(cache_id: str) -> dict[str, Any] | None:
    from app.brain.repository import _get_collection_named
    collection = _get_collection_named(MEETING_PREP_COLLECTION)
    if collection is None:
        return None
    try:
        return await collection.find_one({"_id": cache_id})
    except Exception:      # pragma: no cover — a cache miss is not an error
        return None


async def _store_meeting_prep(cache_id: str, document: dict[str, Any]) -> None:
    from app.brain.repository import _get_collection_named
    collection = _get_collection_named(MEETING_PREP_COLLECTION)
    if collection is None:
        return
    try:
        await collection.update_one({"_id": cache_id},
                                    {"$set": {"_id": cache_id, **document}}, upsert=True)
    except Exception as exc:      # pragma: no cover — never fail the request
        print(f"⚠️ meeting prep not cached: {type(exc).__name__}: {exc}")


async def suggest_meeting_prep(
    learner_id: str,
    teacher_id: str,
    *,
    language: str = "he",
    refresh: bool = False,
) -> dict[str, Any]:
    """What to ask, what to say, and what to aim at — each with its `because`.

    Grounded in the same `teacher_assistant` brain view as the goal suggestions,
    so a meeting sheet can never reference something the teacher cannot open.

    Cached for a week (see `_PREP_TTL_SECONDS`). `refresh=True` is the explicit
    "this is out of date" door; nothing calls it on a page load.
    """
    language = language if language in _LANG_NAME else "he"
    cache_id = _prep_cache_id(learner_id, language)

    if not refresh:
        cached = await _load_meeting_prep(cache_id)
        if _prep_is_fresh(cached) and cached is not None:
            return {"questions": cached.get("questions") or [],
                    "insights": cached.get("insights") or [],
                    "goal_ideas": cached.get("goal_ideas") or [],
                    "generated_at": cached.get("generated_at"),
                    **({"unavailable": True} if cached.get("unavailable") else {})}

    from app.brain.context_engine import AgentScopeError, view_for
    from app.services import insights

    try:
        view = await view_for("teacher_assistant", learner_id)
    except AgentScopeError:
        raise
    except Exception:
        view = {}

    student = await insights.student_insights(learner_id, language=language)

    evidence: dict[str, Any] = {
        "struggle_items": [
            {"objective_id": item.get("objective_id"), "label": item.get("label"),
             "subject": item.get("subject"),
             "evidence": item.get("evidence"),
             # The counts, not only the label. Without them the model can say
             # "there is difficulty in mass and volume", which the teacher
             # already knew; with them it can say "80 right out of 164 tries",
             # which is a sentence worth opening a conversation with.
             **{key: (item.get("raw_evidence") or {}).get(key)
                for key in ("attempts", "successes", "failures", "level")
                if (item.get("raw_evidence") or {}).get(key) is not None},
             }
            for item in (student.get("struggle_items") or [])
        ][:4],
        # The learnings map: how much of each subject's objectives this learner
        # has actually mastered. The one place the prep can say what MOVED.
        "objectives_progress": {
            subject: {
                "mastered": row.get("objectives_mastered"),
                "total": row.get("objectives_total"),
                "in_progress": row.get("objectives_in_progress"),
                "percent": row.get("percent"),
            }
            for subject, row in (student.get("objectives_progress") or {}).items()
            if row.get("objectives_total")
        },
        # Whether they are here at all, and when they last were. A prep sheet
        # that ignores a fortnight of silence is preparing the wrong meeting.
        "activity": student.get("activity") or {},
        "strengths": [
            item.get("label") if isinstance(item, dict) else str(item)
            for item in (student.get("strengths_detail") or [])
        ][:3],
        "challenges": [str(item) for item in (view.get("challenges") or [])][:4],
        "student_description": view.get("student_description") or "",
        "self_awareness_gap": student.get("self_awareness_gap"),
        "open_goals": [
            {"title": goal.get("title"), "stage": goal.get("progress_stage")}
            for goal in (view.get("goals") or []) if not goal.get("approved_by")
        ][:3],
        # ── how this learner WORKS, not how much they have done ──────────────
        # The counts above say where a learner stands. These say what they do
        # when it gets hard — going round in circles on one objective, guessing
        # fast, sitting on a question for eleven minutes, letting a deadline
        # pass. That is the material a conversation is actually made of, and
        # the sheet was preparing teachers without it.
        "behaviour": [
            {"kind": item.get("kind"), "observed": item.get("evidence"),
             **{key: (item.get("raw_evidence") or {}).get(key)
                for key in ("objective_id", "objective_title", "opportunities",
                            "fail_streak", "days_inactive", "rapid_guesses",
                            "elapsed_seconds")
                if (item.get("raw_evidence") or {}).get(key) is not None}}
            for item in (student.get("attention_all") or [])
            if item.get("kind") in _BEHAVIOUR_KINDS
        ][:4],
        # The platform's own pedagogical reading, already categorised the way
        # the ministry categorises it (practise / reinforce / deepen / refer)
        # and already naming the topic. A prep sheet that ignores it is asking
        # a model to re-derive, worse, what the system already decided.
        "recommendations": [
            {"category": row.get("category"), "text": row.get("text")}
            for row in (student.get("recommendations") or [])
        ][:4],
        # Where the platform would take this child next — the same "next" the
        # child's own dashboard shows, so a goal agreed in the room and the
        # goal the system is about to offer cannot contradict each other.
        "focus": {key: (student.get("focus") or {}).get(key)
                  for key in ("subject", "objective_title", "mode")
                  if (student.get("focus") or {}).get(key)},
        # Presence only, never the words. What a child disclosed to Yuvi is on
        # the profile behind its own affordance; a prep card repeating it would
        # put a private sentence in front of whoever is standing behind the
        # teacher — and a model paraphrasing it would put a WRONG one there.
        "wellbeing_open": bool(student.get("wellbeing_flags")),
    }

    # `objectives_progress` counts too: a learner who has mastered nine of
    # twenty objectives and struggles with none is a real, preparable
    # conversation — the sheet used to call that "no observations".
    has_evidence = any(evidence[key] for key in
                       ("struggle_items", "strengths", "challenges", "open_goals",
                        "objectives_progress", "behaviour", "recommendations")) \
        or _has_description(evidence["student_description"])
    if not has_evidence:
        # Cached too, and for the same week. "There is nothing to prepare from"
        # is an answer worth not recomputing on every composer open.
        empty = {
            "questions": [], "insights": [], "goal_ideas": [],
            "unavailable": True,
            "because": {"signal": "no_evidence", "value": None,
                        "raw": {"reason": "no_observations_for_this_learner"}},
        }
        await _store_meeting_prep(cache_id, {**empty, "generated_at": _now_iso()})
        return empty

    try:
        raw = await call_llm(
            [
                {"role": "system",
                 "content": _MEETING_SYSTEM.format(language=_LANG_NAME[language])},
                # The valid citations are named, not left to be inferred from
                # the payload's shape. A row whose `signal` is not a real key
                # is dropped below, and the model was quietly losing two of
                # every three lines to invented key names.
                {"role": "user", "content": json.dumps(
                    {"observations": evidence, "valid_signals": sorted(evidence)},
                    ensure_ascii=False, default=str)},
            ],
            usage_context=UsageContext(
                actor_id=teacher_id,
                actor_type="teacher",
                endpoint="/api/teacher/students/{id}/meeting-prep",
                feature="feature_5_mentoring",
                operation="teacher.meeting_prep",
                source="mentoring_assist",
            ),
            model_tier="mini",
            json_mode=True,
        )
        parsed = json.loads(raw) if isinstance(raw, str) else (raw or {})

        from app.agents.safety import screen_output

        def _rows(key: str) -> list[dict[str, Any]]:
            out = []
            for item in (parsed.get(key) or [])[:4]:
                text = str(item.get("text") or "").strip()
                signal = str(item.get("signal") or "")
                # No citation, no row: an unattributed suggestion is the thing a
                # teacher cannot check, and F6 makes that a defect.
                if not text or signal not in evidence:
                    continue
                screened = screen_output(text, language)
                out.append({
                    "text": (getattr(screened, "text", None) or text).strip(),
                    "because": {"signal": signal, "value": None,
                                "raw": _meeting_raw(signal, evidence)},
                })
            return out

        result = {"questions": _rows("questions"), "insights": _rows("insights"),
                  "goal_ideas": _rows("goal_ideas")}
        if any(result.values()):
            generated_at = _now_iso()
            await _store_meeting_prep(cache_id, {**result, "generated_at": generated_at})
            return {**result, "generated_at": generated_at}
    except Exception as exc:
        print(f"⚠️ meeting prep suggestion failed: {type(exc).__name__}: {exc}")

    # The deterministic sheet is NOT cached: it is what we fall back to when the
    # model was unavailable, and storing it for a week would keep answering with
    # the fallback long after the model came back.
    return _meeting_fallback(language, evidence)


# ── teacher-facing guided writing (F5) ───────────────────────────────────────

# The learner's `guide_documentation` writes in the child's first person: "I
# felt", "we decided". A teacher writing up the same conversation is a
# different voice about a different subject — they are recording what a student
# said, not saying it — so this cannot reuse that prompt. What it does reuse is
# the shape: one question at a time, chips to tap, a draft rebuilt from the
# answers, and a stop.
#
# The no-invention rule is carried over word for word, and matters MORE here.
# A model that fills a gap in a child's own account writes a sentence they
# might have said; a model that fills a gap here fabricates what a child said
# to their teacher, inside a record the child can read.
_TEACHER_DOC_SYSTEM = (
    "You help a TEACHER write up a one-to-one conversation they have just had "
    "with a student. This is NOT a free chat — you are a GUIDED WRITING "
    "assistant. You receive the questions already asked, the teacher's answers "
    "so far, and the current draft.\n"
    "Write in {language}.\n"
    "VOICE: the teacher is writing. Refer to the student in the THIRD person "
    "and to the teacher in the first ('דיברנו על…', 'היא סיפרה ש…'). NEVER "
    "write in the student's first person — no 'הרגשתי', no 'אני'. This is a "
    "record about a student, not a diary by one.\n"
    "The student's name is never given to you and must never be invented: "
    "write 'התלמיד/ה' or the equivalent, and the screen fills the name in.\n"
    "Do TWO things:\n"
    "(1) Write the FULL draft: a short professional write-up, 2 to 6 lines, "
    "plain language, using ONLY what the teacher actually answered. NEVER "
    "invent what the student said, felt or agreed to. This is the record of a "
    "real conversation and the student can read it — a plausible sentence "
    "nobody said is a false record, not a helpful draft. If a draft already "
    "exists, keep the teacher's wording and build on it.\n"
    "EVERY SENTENCE MUST CARRY A FACT. A sentence that only reports that a "
    "topic came up is padding and must not be written: never 'the student "
    "spoke about a difficulty', never 'the student described the difficulty', "
    "never 'we discussed the matter'. If all you know is that a subject came "
    "up, do not write a sentence about it — ASK what it was instead. A "
    "three-line draft that says three real things beats a six-line one that "
    "says the conversation happened.\n"
    "(2) If more would genuinely help, offer ONE short next question plus 2 to "
    "4 quick-choice options the teacher can tap.\n"
    "THE OPTIONS ARE ANSWERS, NOT PROMPTS. Each one must be a complete, "
    "plausible ANSWER to the question you just asked, in the teacher's own "
    "voice, ready to be written into the record as it stands ('שהחומר מרגיש "
    "לה גדול מדי', 'שהיא מתביישת לשאול מול הכיתה'). NEVER offer an option "
    "that is itself a question or a topic label ('how they described it', "
    "'what might help', 'something else') — the teacher taps it and it becomes "
    "their answer, so a topic label becomes a sentence that says nothing.\n"
    "DIG IN RATHER THAN MOVE ON. When the teacher names a difficulty, a "
    "behaviour or an achievement in general terms, your next question asks for "
    "the specific: which topic, which moment, what the student actually said, "
    "what has already been tried. Move to the next area only once the current "
    "one holds something concrete. Across the questions aim to cover: what was "
    "discussed, what the student said or how they explained it, what was "
    "agreed, and what the teacher will watch for before the next conversation. "
    "Do NOT ask how the student felt — a feeling is the student's to report, "
    "not the teacher's to record.\n"
    "Use your OWN judgment about when enough is written: when the key points "
    "are covered, or the answers become short or repetitive, STOP — set phase "
    "to 'ready' and return an EMPTY question and EMPTY options. Usually 3 to 5 "
    "questions is plenty; never loop, never re-ask something already answered.\n"
    "No grades, no scores, no other students, no private details.\n"
    "Return ONLY JSON: "
    '{{"draft": "<the full write-up so far>", "question": "<one short question>", '
    '"options": ["<short chip>", "<short chip>", "<short chip>"], '
    '"phase": "asking" | "ready"}}. '
    "Always answer in {language}."
)

# Deliberately four steps, matching the coverage the prompt asks for, with the
# feeling step of `_GUIDE` replaced by what the student said. A teacher
# documenting a talk has no feeling of their own to file.
#
# Every option is a finished ANSWER, phrased the way a teacher would write it
# into the record — because tapping one IS the answer. The first version mixed
# in topic labels ("on a difficulty", "something else"), and a topic label
# filed as an answer produces exactly the write-up this whole prompt exists to
# prevent: "the student spoke about a difficulty". "Something else" is gone as
# well; the composer already carries a "in my own words" button, which is the
# honest version of the same escape hatch.
_TEACHER_GUIDE = {
    "he": [
        {"q": "על מה דיברתם בשיחה?",
         "options": ["על משהו שהצליח לאחרונה", "על חומר שמרגיש קשה",
                     "על מה שקורה בשיעור עצמו", "על מה שרוצים לשפר עד השיחה הבאה"]},
        {"q": "מה התלמיד/ה סיפר/ה, במילים שלו/ה?",
         "options": ["שקשה להתרכז לאורך זמן", "שהחומר מרגיש גדול מדי",
                     "שמתביישים לשאול מול הכיתה", "שכשמבינים את השלב הראשון השאר זורם"]},
        {"q": "מה סיכמתם יחד?",
         "options": ["לפרק כל משימה לשלבים לפני שמתחילים", "לשאול את יובי לפני שמוותרים",
                     "לתרגל קצת בכל יום במקום הרבה בבת אחת", "לשבת שוב בעוד שבועיים"]},
        {"q": "על מה תשימו לב עד השיחה הבאה?",
         "options": ["אם מבקשים עזרה כשנתקעים", "אם המשימות מוגשות בזמן",
                     "אם ההתמדה נשמרת גם בימים עמוסים", "אם ההשתתפות בשיעור עולה"]},
    ],
    "ar": [
        {"q": "عمّ تحدثتم في المحادثة؟",
         "options": ["عن شيء نجح مؤخرًا", "عن مادة تبدو صعبة",
                     "عمّا يجري داخل الحصة نفسها", "عمّا نريد تحسينه حتى المحادثة القادمة"]},
        {"q": "ماذا قال الطالب/ة بكلماته الخاصة؟",
         "options": ["أن التركيز لوقت طويل صعب", "أن المادة تبدو كبيرة جدًا",
                     "أن السؤال أمام الصف محرج", "أنه حين يفهم الخطوة الأولى يسير الباقي"]},
        {"q": "ماذا اتفقتم عليه معًا؟",
         "options": ["تقسيم كل مهمة إلى خطوات قبل البدء", "سؤال يوفي قبل الاستسلام",
                     "التدرّب قليلًا كل يوم بدل الكثير دفعة واحدة", "الجلوس معًا بعد أسبوعين"]},
        {"q": "ما الذي ستنتبهون له حتى المحادثة القادمة؟",
         "options": ["إن طلب المساعدة عند التعثّر", "إن سُلّمت المهام في وقتها",
                     "إن استمرت المثابرة في الأيام المزدحمة", "إن ازدادت المشاركة في الحصة"]},
    ],
    "en": [
        {"q": "What did you talk about?",
         "options": ["Something that went well recently", "Material that feels hard",
                     "What happens during the lesson itself",
                     "What to improve before the next conversation"]},
        {"q": "What did the student say, in their own words?",
         "options": ["That concentrating for long is hard", "That the material feels too big",
                     "That asking in front of the class is embarrassing",
                     "That once the first step makes sense the rest follows"]},
        {"q": "What did you agree together?",
         "options": ["Break every task into steps before starting",
                     "Ask Yuvi before giving up",
                     "Practise a little daily rather than a lot at once",
                     "Sit down together again in two weeks"]},
        {"q": "What will you watch for before the next conversation?",
         "options": ["Whether they ask for help when stuck",
                     "Whether tasks are handed in on time",
                     "Whether persistence holds on busy days",
                     "Whether participation in class goes up"]},
    ],
}

_TEACHER_MORE_Q = {
    "he": "יש עוד משהו שכדאי לתעד מהשיחה?",
    "ar": "هل هناك شيء آخر يستحق التوثيق من المحادثة؟",
    "en": "Anything else worth recording from the conversation?",
}
_TEACHER_MORE_OPTS = {
    "he": ["הקשר מהבית או מהכיתה", "מה ניסינו כבר", "משהו במילים שלי"],
    "ar": ["سياق من البيت أو الصف", "ما جرّبناه سابقًا", "شيء بكلماتي"],
    "en": ["Context from home or class", "What we already tried", "Something in my words"],
}


def _fallback_teacher_guide(
    language: str, qa: list[dict[str, str]], more: bool = False
) -> dict[str, Any]:
    """The scripted walk, for when the model is unavailable.

    Same contract as `_fallback_guide`: the draft is the teacher's own answers
    joined together — honest, if plain — and the script stops rather than
    looping once it is exhausted.
    """
    guide = _TEACHER_GUIDE.get(language, _TEACHER_GUIDE["he"])
    answers = [pair["a"] for pair in qa if pair.get("a")]
    draft = "\n".join(answers)[:2500]
    index = len(answers)
    if index < len(guide):
        item = guide[index]
        return {"draft": draft, "question": item["q"],
                "options": list(item["options"]), "phase": "asking"}
    if more:
        return {
            "draft": draft,
            "question": _TEACHER_MORE_Q.get(language, _TEACHER_MORE_Q["he"]),
            "options": list(_TEACHER_MORE_OPTS.get(language, _TEACHER_MORE_OPTS["he"])),
            "phase": "asking",
        }
    return {"draft": draft, "question": "", "options": [], "phase": "ready"}


async def guide_teacher_documentation(
    teacher_id: str,
    *,
    language: str = "he",
    qa: Any = None,
    notes: str = "",
    more: bool = False,
    **_ignore: Any,
) -> dict[str, Any]:
    """One turn of the teacher's guided write-up.

    Same `{draft, question, options, phase, ai}` contract as the learner's
    `guide_documentation`, so one composer shape serves both. The difference is
    entirely the voice and the questions.
    """
    language = language if language in _LANG_NAME else "he"
    pairs = _clean_qa(qa)

    try:
        llm_messages: list[dict[str, str]] = [
            {"role": "system", "content": _TEACHER_DOC_SYSTEM.format(language=_LANG_NAME[language])},
        ]
        if notes.strip():
            llm_messages.append({
                "role": "system",
                "content": "Context (do not repeat verbatim): draft so far: "
                           + notes.strip()[:400],
            })
        if pairs:
            transcript = "\n\n".join(f"Q: {p['q']}\nA: {p['a']}" for p in pairs)
            user = "Questions asked and the teacher's answers so far:\n" + transcript
            if more:
                user += (
                    "\n\nThe teacher tapped 'ask me another question' — offer ONE fresh, "
                    "different question (not already asked) with new options."
                )
        else:
            user = (
                "[The teacher just opened the writing helper and the draft is empty. "
                "Give a first question with 2-4 quick options; keep the draft empty.]"
            )
        llm_messages.append({"role": "user", "content": user})

        raw = await call_llm(
            llm_messages,
            usage_context=UsageContext(
                actor_id=teacher_id,
                actor_type="teacher",
                endpoint="/api/teacher/students/{id}/mentoring/assist",
                feature="feature_5_mentoring",
                operation="teacher.mentoring_documentation",
                source="mentoring_assist",
            ),
            max_tokens=1400,
            json_mode=True,
            model_tier="mini",
        )
        data = json.loads(raw or "{}") or {}
        draft = str(data.get("draft") or "").strip()
        question = str(data.get("question") or "").strip()
        options = [str(o).strip() for o in (data.get("options") or []) if str(o).strip()][:4]
        phase = "ready" if str(data.get("phase")) == "ready" else "asking"
        if draft or question:
            from app.agents.safety import screen_output
            if draft:
                draft = screen_output(draft, language).text or draft
            if question:
                question = screen_output(question, language).text or question
            return {"draft": draft, "question": question,
                    "options": options, "phase": phase, "ai": True}
    except Exception as exc:      # never break the composer — fall back
        print(f"⚠️ teacher mentoring assist failed: {type(exc).__name__}")

    return {**_fallback_teacher_guide(language, pairs, more), "ai": False}


# ── goals grounded in the conversation just written (F5) ─────────────────────

# Distinct from the two generators that already exist, and it has to be:
#   * `recommend_goal` reads what a CHILD wrote and answers in the child's
#     voice, one goal, learner-side;
#   * `suggest_goals_for_teacher` reads OBSERVED evidence — mastery gaps,
#     challenges, the student description — and never sees the conversation.
# Neither can answer "what should come out of the talk we just had", which is
# the whole premise of the mentoring page.
#
# Deliberately NOT cached. `goal_suggestions`' cache id is
# `{learner}|{language}|{subject}|{version}` with no notes component, and its
# fingerprint excludes free text on purpose — so routing these through it would
# either return the evidence-flavoured goals under this heading or poison the
# shared row. The anti-reroll property is preserved a different way: this is
# called once on entering the goals step, and there is no button to ask again.
_CONVERSATION_GOAL_SYSTEM = (
    "A teacher has just written up a one-to-one conversation with a student. "
    "Propose up to {count} small weekly goals that follow from THAT "
    "conversation.\n"
    "Write in {language}.\n"
    "`title` and `next_steps` are read by the STUDENT. Address the student in "
    "the second person, and describe an action THE STUDENT performs — never "
    "something the teacher does for them. In gendered languages use "
    "gender-inclusive second person (Hebrew: נסה/י, תסתכל/י).\n"
    "Every goal is an action the student takes INSIDE the learning platform, "
    "something the system can watch happen: open a lesson and practise a named "
    "topic; complete an assigned task; use a hint when stuck instead of "
    "guessing; ask Yuvi to explain something before answering; try a question "
    "again after a wrong answer; come back to learn on more days.\n"
    "Never suggest study techniques the platform cannot see — saying things "
    "out loud, imagining, working with paper. A goal like that can never be "
    "checked off, so it must not be suggested.\n"
    "Ground every goal ONLY in what the write-up actually says. If the "
    "conversation does not support a goal, return fewer — or none at all. Do "
    "not invent a difficulty, a topic or an agreement that is not written "
    "there.\n"
    "`rationale` is read by the TEACHER only: one short sentence on why this "
    "follows from the conversation.\n"
    "`quote` is the phrase FROM THE WRITE-UP the goal came out of, copied "
    "verbatim and kept short — it is what lets the teacher check the goal "
    "against what they wrote.\n"
    'Return JSON: {{"goals": [{{"title": str, "next_steps": str, '
    '"rationale": str, "quote": str, "action": {{"kind": str, '
    '"target": int}}}}]}}.\n'
    "`action.kind` is exactly one of: use_hint, ask_yuvi, retry_after_wrong, "
    "practice, complete_task, active_days. `action.target` is how many times "
    "within the week — small and honest (2-5 for most kinds, 2-6 for "
    "active_days), and it must match what the goal text literally asks."
)


async def suggest_goals_from_conversation(
    learner_id: str,
    teacher_id: str,
    *,
    language: str = "he",
    notes: str = "",
    count: int = 3,
) -> list[dict[str, Any]]:
    """Goals that follow from the write-up the teacher just produced.

    Returns the same draft shape the goals step already renders — `title`,
    `next_steps`, `rationale`, `deadline`, `action`, `because`, `ai` — so the
    existing card renders these beside the evidence-grounded ones with no new
    component.

    Returns `[]` rather than inventing anything: with no notes, or a model that
    failed, there is nothing this function knows. `suggest_goals_for_teacher`
    makes the same choice when it has no evidence, and for the same reason —
    a suggestion with nothing behind it is worse than an empty column.
    """
    language = language if language in _LANG_NAME else "he"
    notes = (notes or "").strip()
    if len(notes) < 20:
        return []
    count = max(1, min(int(count or 3), 5))
    deadline = (date.today() + timedelta(days=7)).isoformat()

    try:
        raw = await call_llm(
            [
                {"role": "system", "content": _CONVERSATION_GOAL_SYSTEM.format(
                    language=_LANG_NAME[language], count=count)},
                {"role": "user", "content": "The write-up of the conversation:\n"
                                            + notes[:1500]},
            ],
            usage_context=UsageContext(
                actor_id=teacher_id,
                actor_type="teacher",
                endpoint="/api/teacher/students/{id}/mentoring/goal-ideas",
                feature="feature_5_mentoring",
                operation="teacher.goals_from_conversation",
                source="mentoring_assist",
            ),
            max_tokens=700,
            json_mode=True,
            model_tier="mini",
        )
        data = json.loads(raw or "{}") or {}
    except Exception as exc:
        print(f"⚠️ conversation goal suggestion failed: {type(exc).__name__}")
        return []

    from app.agents.safety import screen_output

    drafts: list[dict[str, Any]] = []
    for item in (data.get("goals") or [])[:count]:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        if not title:
            continue
        quote = str(item.get("quote") or "").strip()[:200]
        drafts.append({
            "title": (screen_output(title, language).text or title).strip(),
            "next_steps": str(item.get("next_steps") or "").strip(),
            "rationale": str(item.get("rationale") or "").strip(),
            "deadline": deadline,
            # Normalized against the closed vocabulary, so an invented action
            # degrades to an untracked goal rather than a broken one.
            "action": goal_progress.normalize_action(item.get("action")),
            "ai": True,
            # A new signal: the grounding is the teacher's own sentence, which
            # is the one piece of evidence they can check without leaving the
            # screen. `describeSignal` needs a matching entry for "conversation".
            "because": {"signal": "conversation", "value": None,
                        "raw": {"observation": quote}} if quote else
                       {"signal": "no_evidence", "value": None, "raw": {}},
        })
    return drafts
