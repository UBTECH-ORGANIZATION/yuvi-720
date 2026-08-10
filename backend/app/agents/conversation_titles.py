"""Naming a chat thread — shared by the learner's coach and the teacher's assistant.

A thread list is only navigable if the titles are *about* something. The rule
that matters here is the rejection at the bottom of `generate_conversation_title`:
a title that is merely the first message with the punctuation filed off tells a
reader nothing they cannot already see in the preview, so it is thrown away in
favour of an honest generic. Same for anything the model padded past eight words.

Lives in its own module rather than in `coach.py` because the teacher assistant
needs it too, and importing the coach agent to name a thread would drag in the
whole learner brain — context builders, triggers, visuals — for one mini-model
call.
"""

from __future__ import annotations

import re
from typing import Optional

from app.agents import safety
from app.services.ai_usage import UsageContext
from app.services.llm import call_llm

TITLE_INSTRUCTIONS = {
    "he": (
        "צור כותרת קצרה בעברית, בת 2–6 מילים, לנושא השיחה של התלמיד/ה. "
        "הכותרת חייבת להיות צירוף שמני מסכם ולא העתק, ציטוט או ניסוח מחדש של השאלה. "
        "אל תוסיף מרכאות, נקודתיים, הסבר או סימן שאלה. החזר רק את הכותרת."
    ),
    "ar": (
        "أنشئ عنوانًا عربيًا قصيرًا من كلمتين إلى ست كلمات لموضوع محادثة الطالب/ة. "
        "يجب أن يكون عبارة اسمية تلخّص الموضوع، لا نسخة أو اقتباسًا أو إعادة صياغة للسؤال. "
        "لا تضف علامات اقتباس أو نقطتين أو شرحًا أو علامة استفهام. أعد العنوان فقط."
    ),
    "en": (
        "Create a concise 2–6 word English title for the learner's conversation topic. "
        "Use a summarizing noun phrase, never a copy, quotation, or restatement of the question. "
        "Do not add quotes, a label, an explanation, or a question mark. Return only the title."
    ),
}

TITLE_FALLBACK = {
    "he": "למידה עם יובי",
    "ar": "التعلّم مع يوفي",
    "en": "Learning with Yuvi",
}

# The teacher's threads are about children and classes, not about their own
# learning, so "Learning with Yuvi" would be a lie on that side of the product.
TEACHER_TITLE_FALLBACK = {
    "he": "שיחה עם עוזר ההוראה",
    "ar": "محادثة مع مساعد التدريس",
    "en": "Teaching assistant chat",
}


def _normalized_title_text(value: str) -> str:
    return re.sub(r"[^\w֐-׿؀-ۿ]+", "", value.casefold())


async def generate_conversation_title(
    user_message: str,
    language: str,
    usage_context: Optional[UsageContext] = None,
    *,
    fallback: Optional[dict[str, str]] = None,
) -> tuple[str, str]:
    """Use the mini model once to name a new thread without copying its first message."""
    lang = language if language in TITLE_INSTRUCTIONS else "he"
    fallbacks = fallback or TITLE_FALLBACK
    result = await call_llm(
        [
            {"role": "system", "content": TITLE_INSTRUCTIONS[lang]},
            {"role": "user", "content": f"<first_message>{user_message}</first_message>"},
        ],
        usage_context=usage_context or UsageContext(
            actor_id="system",
            actor_type="system",
            endpoint="internal:coach-title",
            feature="feature_3_learning_companion",
            operation="coach.title",
            source="coach_agent",
        ),
        max_tokens=48,
        model_tier="mini",
    )
    candidate = safety.screen_output(result or "", lang).text
    candidate = re.sub(
        r"^(?:title|conversation title|כותרת|عنوان)\s*[:：-]\s*",
        "",
        candidate.strip(),
        flags=re.IGNORECASE,
    )
    candidate = candidate.splitlines()[0].strip(" \t\"'`“”‘’*-–—:：?.!؟")[:72]
    if (
        not candidate
        or _normalized_title_text(candidate) == _normalized_title_text(user_message)
        or len(candidate.split()) > 8
    ):
        return fallbacks.get(lang) or TITLE_FALLBACK[lang], "fallback"
    return candidate, "model"
