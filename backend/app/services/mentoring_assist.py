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

import json
from datetime import date, timedelta
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

