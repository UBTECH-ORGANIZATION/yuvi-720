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
    draft = "\n".join(a for a in answers if a)[:800]
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
            max_tokens=480,
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

_TEACHER_GOAL_SYSTEM = (
    "You help a teacher set ONE small, concrete weekly goal for a student.\n"
    "Write in {language}. Address the teacher, not the student.\n"
    "Ground every suggestion ONLY in the evidence given. Do not invent a "
    "difficulty, a topic or a behaviour that is not in it.\n"
    "Each goal must be achievable in a week and observable — something the "
    "student either did or did not do.\n"
    'Return JSON: {{"goals": [{{"title": str, "next_steps": str, '
    '"rationale": str, "signal": str}}]}} with exactly {count} goals.\n'
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


def _goal_cache_id(learner_id: str, language: str, subject: str | None) -> str:
    """Language and subject key the row rather than the fingerprint: they change
    which suggestions are wanted, not whether the old ones are still true."""
    return f"{learner_id}|{language}|{subject or 'all'}"


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

_MEETING_SYSTEM = """You prepare a teacher for a one-to-one conversation with a \
student. Write in {language}.

You are given only real observations about this student. Rules:
- Every question and every insight must follow from an observation you were given. \
Do not invent events, scores or history.
- Questions are for the student to answer, open and non-accusatory. "What makes \
fractions feel hard?" — not "Why did you fail three times?".
- Never compare this student to anyone else.
- If the observations are thin, produce fewer items rather than padding.

Return JSON:
{{"questions": [{{"text": "...", "signal": "<which observation key>"}}],
  "insights":  [{{"text": "...", "signal": "<which observation key>"}}],
  "goal_ideas":[{{"text": "...", "signal": "<which observation key>"}}]}}"""


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


async def suggest_meeting_prep(
    learner_id: str,
    teacher_id: str,
    *,
    language: str = "he",
) -> dict[str, Any]:
    """What to ask, what to say, and what to aim at — each with its `because`.

    Grounded in the same `teacher_assistant` brain view as the goal suggestions,
    so a meeting sheet can never reference something the teacher cannot open.
    """
    language = language if language in _LANG_NAME else "he"

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
             "evidence": item.get("evidence")}
            for item in (student.get("struggle_items") or [])
        ][:4],
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
    }

    has_evidence = any(evidence[key] for key in
                       ("struggle_items", "strengths", "challenges", "open_goals")) \
        or _has_description(evidence["student_description"])
    if not has_evidence:
        return {
            "questions": [], "insights": [], "goal_ideas": [],
            "unavailable": True,
            "because": {"signal": "no_evidence", "value": None,
                        "raw": {"reason": "no_observations_for_this_learner"}},
        }

    try:
        raw = await call_llm(
            [
                {"role": "system",
                 "content": _MEETING_SYSTEM.format(language=_LANG_NAME[language])},
                {"role": "user", "content": json.dumps(evidence, ensure_ascii=False,
                                                       default=str)},
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
                                "raw": evidence.get(signal)},
                })
            return out

        result = {"questions": _rows("questions"), "insights": _rows("insights"),
                  "goal_ideas": _rows("goal_ideas")}
        if any(result.values()):
            return result
    except Exception as exc:
        print(f"⚠️ meeting prep suggestion failed: {type(exc).__name__}: {exc}")

    return _meeting_fallback(language, evidence)
