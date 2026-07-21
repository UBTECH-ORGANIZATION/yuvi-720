"""Onboarding Agent (F2) — turns mapping scores into the brain `profile`.

Design law: **numbers are deterministic** (derived from the MoE-scored
questionnaire), the LLM only *phrases* and may *extract interests* from free
text. Activeness, strengths, challenges, learning style, preferences, and
environment are all projections of what the questionnaire actually measures —
so they are explainable and never invented. Writes go through the onboarding
agent's scoped allow-list (§5.8); `profile.mapping_scores` is written by the
submit route (system lane), not here.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

from app.brain.context_engine import apply_writes
from app.services.ai_usage import UsageContext
from app.services.llm import call_llm


# ── Deterministic mapping: 10 questionnaire sub-dimensions → 6 MoE activeness ──
def derive_activeness(scores: dict[str, Any]) -> dict[str, int]:
    """Map the scored sub-dimensions onto the six פעלנות components (0-100).

    Internal metric for F4 competencies — never shown as a number to learners.
    """
    ac = scores.get("academic", {})
    ps = scores.get("psycho_pedagogical", {})
    en = scores.get("environmental", {})

    def avg(*vals: Any) -> int:
        nums = [v for v in vals if isinstance(v, (int, float))]
        return round(sum(nums) / len(nums)) if nums else 60

    return {
        "motivation_relevance": avg(ac.get("interest"), ac.get("relevance"), ps.get("motivation")),
        "growth_mindset": avg(ac.get("investment"), ps.get("motivation")),
        "initiative_responsibility": avg(ps.get("autonomy")),
        "self_regulation": avg(ps.get("cognitive"), en.get("focus")),
        "self_awareness": avg(ps.get("self_awareness")),
        "support_emotional": avg(en.get("school_climate")),
    }


# ── Localized labels (he source; ar/en translations) ──────────────────────────
STRENGTH_LABELS = {
    "interest":       {"he": "סקרנות", "en": "Curiosity", "ar": "الفضول"},
    "relevance":      {"he": "חיבור ללמידה", "en": "Connecting to learning", "ar": "ربط التعلم بالحياة"},
    "investment":     {"he": "רצון להצליח", "en": "Drive to succeed", "ar": "الرغبة في النجاح"},
    "motivation":     {"he": "מוטיבציה וחוסן", "en": "Motivation & resilience", "ar": "الدافعية والمرونة"},
    "autonomy":       {"he": "עצמאות ויוזמה", "en": "Independence & initiative", "ar": "الاستقلالية والمبادرة"},
    "cognitive":      {"he": "חשיבה וארגון", "en": "Thinking & organization", "ar": "التفكير والتنظيم"},
    "self_awareness": {"he": "מודעות עצמית", "en": "Self-awareness", "ar": "الوعي الذاتي"},
    "school_climate": {"he": "תחושת שייכות בכיתה", "en": "Belonging in class", "ar": "الانتماء في الصف"},
    "tech_comfort":   {"he": "שליטה בטכנולוגיה", "en": "Comfort with technology", "ar": "الراحة مع التكنولوجيا"},
    "focus":          {"he": "ריכוז ומיקוד", "en": "Focus & concentration", "ar": "التركيز"},
}
CHALLENGE_LABELS = {
    "interest":       {"he": "למצוא עניין בלמידה", "en": "Finding interest in learning", "ar": "إيجاد اهتمام بالتعلم"},
    "relevance":      {"he": "לחבר את הלמידה לחיים", "en": "Connecting learning to life", "ar": "ربط التعلم بالحياة"},
    "investment":     {"he": "להתמיד גם כשקשה", "en": "Persisting when it's hard", "ar": "المثابرة عند الصعوبة"},
    "motivation":     {"he": "לשמור על מוטיבציה", "en": "Keeping motivation", "ar": "الحفاظ على الدافعية"},
    "autonomy":       {"he": "ללמוד באופן עצמאי", "en": "Learning independently", "ar": "التعلم باستقلالية"},
    "cognitive":      {"he": "לארגן ולתכנן מידע", "en": "Organizing & planning", "ar": "تنظيم المعلومات والتخطيط"},
    "self_awareness": {"he": "לזהות מה עוזר לי ללמוד", "en": "Noticing what helps me learn", "ar": "معرفة ما يساعدني على التعلم"},
    "school_climate": {"he": "להרגיש בנוח בכיתה", "en": "Feeling at ease in class", "ar": "الشعور بالراحة في الصف"},
    "tech_comfort":   {"he": "להשתמש בכלים דיגיטליים", "en": "Using digital tools", "ar": "استخدام الأدوات الرقمية"},
    "focus":          {"he": "לשמור על ריכוז לאורך זמן", "en": "Staying focused over time", "ar": "الحفاظ على التركيز"},
}
LEARNING_STYLE = {
    "independent": {"he": "עצמאי/ת — אוהב/ת לגלות לבד לפני שמבקש/ת עזרה",
                    "en": "Independent — likes to explore before asking for help",
                    "ar": "مستقل — يحب الاكتشاف قبل طلب المساعدة"},
    "guided":      {"he": "אוהב/ת ללמוד עם הכוונה ומשוב מיידי",
                    "en": "Learns best with guidance and immediate feedback",
                    "ar": "يتعلم بشكل أفضل مع التوجيه والتغذية الراجعة الفورية"},
    "short_bursts":{"he": "לומד/ת טוב במנות קצרות עם משוב מיידי",
                    "en": "Learns well in short bursts with quick feedback",
                    "ar": "يتعلم جيدًا على دفعات قصيرة مع تغذية راجعة سريعة"},
}
PREFERENCE_LABELS = {
    "independent_first": {"he": "התנסות עצמאית תחילה", "en": "Independent practice first", "ar": "التجربة المستقلة أولاً"},
    "visual":            {"he": "הסברים חזותיים", "en": "Visual explanations", "ar": "شروحات مرئية"},
    "immediate_feedback":{"he": "משוב מיידי", "en": "Immediate feedback", "ar": "تغذية راجعة فورية"},
    "digital":           {"he": "כלים דיגיטליים", "en": "Digital tools", "ar": "أدوات رقمية"},
}
ENVIRONMENT_LABELS = {
    "quiet_digital": {"he": "סביבה שקטה, מעדיף/ה דיגיטלי", "en": "Quiet, prefers digital", "ar": "بيئة هادئة، يفضل الرقمي"},
    "supported":     {"he": "סביבה עם תמיכה זמינה", "en": "An environment with support nearby", "ar": "بيئة مع دعم متاح"},
    "quiet":         {"he": "סביבה שקטה", "en": "A quiet environment", "ar": "بيئة هادئة"},
}


def _all_subdims(scores: dict[str, Any]) -> dict[str, int]:
    flat: dict[str, int] = {}
    for group in ("academic", "psycho_pedagogical", "environmental"):
        for key, value in (scores.get(group) or {}).items():
            if key != "overall" and isinstance(value, (int, float)):
                flat[key] = int(value)
    return flat


def _lbl(table: dict, key: str, language: str) -> str:
    entry = table.get(key, {})
    return entry.get(language) or entry.get("he") or key


def derive_profile(scores: dict[str, Any], language: str) -> dict[str, Any]:
    """Deterministic profile projection from the questionnaire (no invention)."""
    subdims = _all_subdims(scores)
    ranked = sorted(subdims.items(), key=lambda kv: kv[1], reverse=True)
    top = [k for k, _ in ranked[:3]]
    bottom = [k for k, v in reversed(ranked) if v < 60][:3]

    autonomy = subdims.get("autonomy", 60)
    focus = subdims.get("focus", 60)
    tech = subdims.get("tech_comfort", 60)
    climate = subdims.get("school_climate", 60)

    if autonomy >= 70:
        style_key = "independent"
    elif focus < 55:
        style_key = "short_bursts"
    else:
        style_key = "guided"

    preferences = []
    if autonomy >= 65:
        preferences.append(_lbl(PREFERENCE_LABELS, "independent_first", language))
    if tech >= 65:
        preferences.append(_lbl(PREFERENCE_LABELS, "digital", language))
    preferences.append(_lbl(PREFERENCE_LABELS, "immediate_feedback", language))

    if tech >= 65 and climate < 60:
        env_key = "quiet_digital"
    elif climate < 55:
        env_key = "supported"
    else:
        env_key = "quiet"

    return {
        "activeness": derive_activeness(scores),
        "learning_style": _lbl(LEARNING_STYLE, style_key, language),
        "preferences": preferences,
        "environment": _lbl(ENVIRONMENT_LABELS, env_key, language),
        "strengths": [{"label": _lbl(STRENGTH_LABELS, k, language), "source": "mapping"} for k in top],
        "challenges": [{"label": _lbl(CHALLENGE_LABELS, k, language), "status": "working"} for k in bottom],
    }


async def _extract_interests(
    free_text: str,
    language: str,
    usage_context: UsageContext,
) -> list[str]:
    """LLM only extracts genuine interest topics the learner stated (no invention)."""
    if not free_text or not free_text.strip():
        return []
    prompt = (
        "Extract up to 4 concrete personal interests/hobbies the student explicitly "
        "mentions in the text below (e.g. football, space, drawing). Return ONLY a JSON "
        'array of short strings in the same language. If none are stated, return []. '
        f"Text:\n{free_text}"
    )
    result = await call_llm(
        [{"role": "user", "content": prompt}],
        usage_context=usage_context,
        max_tokens=200,
        json_mode=False,
    )
    if not result:
        return []
    try:
        start, end = result.find("["), result.rfind("]")
        if start == -1 or end == -1:
            return []
        items = json.loads(result[start:end + 1])
        return [str(x).strip() for x in items if str(x).strip()][:4]
    except (ValueError, json.JSONDecodeError):
        return []


async def run_onboarding(
    learner_id: str,
    scores: dict[str, Any],
    language: str = "he",
    free_text: Optional[str] = None,
    usage_context: Optional[UsageContext] = None,
) -> dict[str, Any]:
    """Populate the brain `profile` from mapping scores (+ optional free text)."""
    profile = derive_profile(scores, language)
    context = usage_context or UsageContext(
        actor_id=learner_id,
        actor_type="learner",
        endpoint="internal:onboarding",
        feature="feature_2_mapping",
        operation="onboarding.interest_extraction",
        source="onboarding_agent",
    )
    interests = await _extract_interests(free_text or "", language, context)
    if interests:
        # Same content-safety guardian as chat memory: free-text mapping answers
        # must not seed an inappropriate "interest" into the profile either.
        from app.agents import safety
        unsafe = await safety.screen_memory_values(interests, language, usage_context=context)
        if unsafe:
            interests = [i for i in interests if i not in unsafe]

    updates = {
        "profile.activeness": profile["activeness"],
        "profile.learning_style": profile["learning_style"],
        "profile.preferences": profile["preferences"],
        "profile.environment": profile["environment"],
        "profile.source": "mapping",
        "profile.updated_at": datetime.now(timezone.utc).isoformat(),
        "strengths": profile["strengths"],
        "challenges": profile["challenges"],
    }
    if interests:
        updates["profile.interests"] = interests

    await apply_writes("onboarding", learner_id, updates)
    return {"profile": profile, "interests": interests}
