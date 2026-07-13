"""Grounded onboarding-profile summary and learner verification.

The results experience presents a small, child-friendly projection of the Shared
Learning Brain. The model may phrase only the supplied evidence-backed sources;
it cannot add traits. Learner feedback is written back to Memory v1 so disputed
claims stop influencing future agent behavior.
"""

from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
import json
import re
from typing import Any

from app.agents.safety import strip_pii
from app.brain.memory import (
    active_themes,
    contradict_theme_by_value,
    ensure_memory_state,
    upsert_theme,
)
from app.brain.repository import apply_brain_updates, get_brain
from app.core.localization import normalize_language
from app.services.ai_usage import UsageContext
from app.services.llm import call_llm


ALLOWED_ICON_KEYS = {
    "curiosity",
    "focus",
    "independence",
    "organization",
    "persistence",
    "self_awareness",
    "belonging",
    "technology",
    "visual",
    "feedback",
    "environment",
    "interest",
    "growth",
    "spark",
}

_CATEGORY_TO_MEMORY_KIND = {
    "strength": "characteristic",
    "characteristic": "characteristic",
    "preference": "preference",
    "interest": "interest",
    "support": "challenge",
}

_EVIDENCE_LABELS = {
    "he": {
        "questionnaire": "מבוסס על התשובות שלך בשאלון",
        "reflection": "מבוסס על הבחירות שלך בשיחות הקצרות עם יובי",
        "profile": "מבוסס על הדרך שבה תיארת שנוח לך ללמוד",
    },
    "en": {
        "questionnaire": "Based on your questionnaire answers",
        "reflection": "Based on your choices in the short conversations with Yuvi",
        "profile": "Based on how you described the way you like to learn",
    },
    "ar": {
        "questionnaire": "بناءً على إجاباتك في الاستبيان",
        "reflection": "بناءً على اختياراتك في المحادثات القصيرة مع يوفي",
        "profile": "بناءً على الطريقة التي وصفت بها ما يناسبك في التعلّم",
    },
}

_FALLBACK_COPY = {
    "he": {
        "hero": "חיברתי את התשובות והבחירות שלך לתמונה ראשונה של הדרך שנוחה לך ללמוד.",
        "strength": "זו חוזקה שאפשר להיעזר בה גם במשימות חדשות.",
        "characteristic": "זה משהו שסיפרת על הדרך שבה נוח לך לפעול וללמוד.",
        "preference": "כך אוכל לבחור הסברים וצעדים שמתאימים לך יותר.",
        "interest": "אפשר לחבר דוגמאות ופעילויות לעולם הזה כשזה מתאים.",
        "support": "כאן כדאי להציע צעד קטן, הסבר אחר או עזרה בזמן הנכון.",
    },
    "en": {
        "hero": "I connected your answers and choices into a first picture of how you prefer to learn.",
        "strength": "This is a strength you can use in new tasks too.",
        "characteristic": "This is something you shared about how you prefer to work and learn.",
        "preference": "This helps me choose explanations and steps that fit you better.",
        "interest": "When it fits, examples and activities can connect to this world.",
        "support": "Here it can help to offer a small step, another explanation, or support at the right time.",
    },
    "ar": {
        "hero": "ربطت إجاباتك واختياراتك في صورة أولى للطريقة التي تفضّل أن تتعلّم بها.",
        "strength": "هذه نقطة قوة يمكنك الاستفادة منها في مهام جديدة أيضًا.",
        "characteristic": "هذا شيء شاركته عن الطريقة التي تفضّل أن تعمل وتتعلّم بها.",
        "preference": "يساعدني هذا على اختيار شروحات وخطوات تلائمك بصورة أفضل.",
        "interest": "عندما يكون ذلك مناسبًا، يمكن ربط الأمثلة والأنشطة بهذا المجال.",
        "support": "هنا قد يفيد تقديم خطوة صغيرة أو شرح مختلف أو دعم في الوقت المناسب.",
    },
}

_SUMMARY_PROMPTS = {
    "he": """אתה סוכן ההיכרות של יובי. לפניך מקורות מאומתים בלבד מתוך תשובות המיפוי והבחירות הנוספות של הלומד/ת.
נסח תמונת למידה קצרה וחמה בעברית. אסור להוסיף תכונה, תחביב, קושי או העדפה שלא מופיעים במקורות.
לכל מקור החזר כרטיס אחד ושמור בדיוק על source_id. title הוא שם קצר של התובנה, description הוא משפט אחד שמסביר איך הדבר עשוי להשפיע על הלמידה בלי לקבוע עובדה מעבר למקור.
בחר icon_key רק מהרשימה המותרת. אין להזכיר ציונים, מספרים, זיכרון, מסד נתונים או מערכת פנימית. אל תשתמש באימוג'י.
החזר JSON בלבד: {\"hero_message\":\"משפט אחד\",\"claims\":[{\"source_id\":\"...\",\"title\":\"...\",\"description\":\"...\",\"icon_key\":\"...\"}]}""",
    "en": """You are Yuvi's onboarding agent. The sources below are the only verified facts from the learner's mapping answers and follow-up choices.
Write a short, warm learning portrait in English. Do not add any trait, hobby, difficulty, or preference that is not present in the sources.
Return one card per source and preserve each source_id exactly. The title is a short insight label; the description is one sentence about how it may affect learning without claiming more than the source supports.
Choose icon_key only from the allowed list. Do not mention scores, numbers, memory, databases, or internal systems. Do not use emoji.
Return JSON only: {\"hero_message\":\"one sentence\",\"claims\":[{\"source_id\":\"...\",\"title\":\"...\",\"description\":\"...\",\"icon_key\":\"...\"}]}""",
    "ar": """أنت وكيل التعرّف الخاص بيوفي. المصادر أدناه هي الحقائق الموثقة الوحيدة من إجابات التقييم والاختيارات الإضافية للمتعلم/ة.
اكتب صورة تعليمية قصيرة ودافئة بالعربية. لا تضف أي صفة أو هواية أو صعوبة أو تفضيل غير موجود في المصادر.
أعد بطاقة واحدة لكل مصدر وحافظ على source_id كما هو تمامًا. العنوان اسم قصير للفكرة، والوصف جملة واحدة تشرح كيف قد تؤثر في التعلّم من دون تجاوز ما يدعمه المصدر.
اختر icon_key فقط من القائمة المسموحة. لا تذكر الدرجات أو الأرقام أو الذاكرة أو قواعد البيانات أو الأنظمة الداخلية. لا تستخدم الرموز التعبيرية.
أعد JSON فقط: {\"hero_message\":\"جملة واحدة\",\"claims\":[{\"source_id\":\"...\",\"title\":\"...\",\"description\":\"...\",\"icon_key\":\"...\"}]}""",
}


def _safe_text(value: object, limit: int = 180) -> str:
    text, _ = strip_pii(str(value or ""))
    text = re.sub(r"\s+", " ", text).strip(" \t\n\r")
    return text.replace("<", "‹").replace(">", "›")[:limit]


def _source_id(prefix: str, value: str) -> str:
    digest = sha256(f"{prefix}:{value.casefold()}".encode("utf-8")).hexdigest()[:12]
    return f"{prefix}:{digest}"


def _feedback_status(item: dict[str, Any]) -> str | None:
    status = item.get("learner_feedback")
    return status if status in {"accurate", "unsure", "inaccurate"} else None


def build_profile_sources(
    brain: dict[str, Any],
    language: str,
    *,
    include_disputed: bool = False,
    max_sources: int | None = 6,
) -> list[dict[str, Any]]:
    """Return claims grounded in Brain fields.

    Profile generation uses the default bounded projection. Feedback lookup uses
    the complete catalog, including disputed and inactive entries, so saving a
    verdict cannot invalidate the identifiers of cards already on screen.
    """
    lang = normalize_language(language)
    document, _ = ensure_memory_state(brain)
    profile = document.get("profile") or {}
    memory = document.get("memory") or {}
    candidates: list[dict[str, Any]] = []

    def add(
        prefix: str,
        value: object,
        category: str,
        evidence_type: str,
        *,
        path: str,
        feedback_status: str | None = None,
        memory_kind: str | None = None,
    ) -> None:
        safe_value = _safe_text(value, 120)
        if not safe_value or (feedback_status == "inaccurate" and not include_disputed):
            return
        candidates.append({
            "source_id": _source_id(prefix, safe_value),
            "value": safe_value,
            "category": category,
            "evidence_type": evidence_type,
            "evidence_label": _EVIDENCE_LABELS[lang][evidence_type],
            "path": path,
            "feedback_status": feedback_status,
            "memory_kind": memory_kind or _CATEGORY_TO_MEMORY_KIND[category],
        })

    for index, item in enumerate(document.get("strengths") or []):
        if isinstance(item, dict):
            add(
                "strength",
                item.get("label"),
                "strength",
                "questionnaire",
                path=f"strengths.{index}",
                feedback_status=_feedback_status(item),
            )
        if max_sources is not None and len([c for c in candidates if c["category"] == "strength"]) >= 2:
            break

    memory_count = 0
    memory_themes = (
        [theme for theme in memory.get("themes") or [] if isinstance(theme, dict)]
        if include_disputed
        else active_themes(memory, {
            "interest", "preference", "characteristic", "self_belief",
            "motivation_pattern", "strategy",
        })
    )
    for theme in memory_themes:
        kind = str(theme.get("kind") or "characteristic")
        if kind not in {
            "interest", "preference", "characteristic", "self_belief",
            "motivation_pattern", "strategy",
        }:
            continue
        category = {
            "interest": "interest",
            "preference": "preference",
            "strategy": "preference",
        }.get(kind, "characteristic")
        source_types = set(theme.get("source_types") or [])
        evidence_type = "reflection" if "mapping_reflection" in source_types else "profile"
        add(
            "memory",
            theme.get("value"),
            category,
            evidence_type,
            path=f"memory.{theme.get('id')}",
            feedback_status="accurate" if theme.get("learner_confirmed") else None,
            memory_kind=kind,
        )
        memory_count += 1
        if max_sources is not None and memory_count >= 2:
            break

    add(
        "learning-style",
        profile.get("learning_style"),
        "preference",
        "profile",
        path="profile.learning_style",
    )

    for index, value in enumerate(profile.get("preferences") or []):
        add(
            "preference",
            value,
            "preference",
            "profile",
            path=f"profile.preferences.{index}",
        )
        if max_sources is not None:
            break

    for index, item in enumerate(document.get("challenges") or []):
        if isinstance(item, dict):
            add(
                "support",
                item.get("label"),
                "support",
                "questionnaire",
                path=f"challenges.{index}",
                feedback_status=_feedback_status(item),
            )
        break

    seen: set[str] = set()
    sources: list[dict[str, Any]] = []
    for candidate in candidates:
        key = (
            candidate["value"].casefold()
            if max_sources is not None
            else candidate["source_id"]
        )
        if key in seen:
            continue
        seen.add(key)
        sources.append(candidate)
        if max_sources is not None and len(sources) >= max_sources:
            break
    return sources


def _fallback_icon(category: str) -> str:
    return {
        "strength": "spark",
        "characteristic": "self_awareness",
        "preference": "visual",
        "interest": "interest",
        "support": "growth",
    }.get(category, "spark")


def fallback_profile_summary(sources: list[dict[str, Any]], language: str) -> dict[str, Any]:
    lang = normalize_language(language)
    copy = _FALLBACK_COPY[lang]
    return {
        "hero_message": copy["hero"],
        "claims": [
            {
                "id": source["source_id"],
                "source_id": source["source_id"],
                "category": source["category"],
                "title": source["value"],
                "description": copy[source["category"]],
                "icon_key": _fallback_icon(source["category"]),
                "evidence_label": source["evidence_label"],
                "feedback_status": source.get("feedback_status"),
            }
            for source in sources
        ],
    }


def _validated_summary(
    payload: dict[str, Any],
    sources: list[dict[str, Any]],
    language: str,
) -> dict[str, Any]:
    fallback = fallback_profile_summary(sources, language)
    source_by_id = {source["source_id"]: source for source in sources}
    raw_claims = payload.get("claims") if isinstance(payload, dict) else None
    raw_by_source = {
        str(item.get("source_id")): item
        for item in raw_claims or []
        if isinstance(item, dict) and str(item.get("source_id")) in source_by_id
    }

    claims: list[dict[str, Any]] = []
    fallback_by_id = {item["source_id"]: item for item in fallback["claims"]}
    for source in sources:
        source_id = source["source_id"]
        raw = raw_by_source.get(source_id) or {}
        title = _safe_text(raw.get("title"), 80) or fallback_by_id[source_id]["title"]
        description = _safe_text(raw.get("description"), 220) or fallback_by_id[source_id]["description"]
        icon_key = str(raw.get("icon_key") or "")
        if icon_key not in ALLOWED_ICON_KEYS:
            icon_key = fallback_by_id[source_id]["icon_key"]
        claims.append({
            "id": source_id,
            "source_id": source_id,
            "category": source["category"],
            "title": title,
            "description": description,
            "icon_key": icon_key,
            "evidence_label": source["evidence_label"],
            "feedback_status": source.get("feedback_status"),
        })

    hero = _safe_text(payload.get("hero_message") if isinstance(payload, dict) else "", 220)
    return {"hero_message": hero or fallback["hero_message"], "claims": claims}


async def generate_profile_summary(learner_id: str, language: str) -> dict[str, Any]:
    """Phrase the current Brain as a grounded, learner-reviewable profile."""
    lang = normalize_language(language)
    brain = await get_brain(learner_id)
    sources = build_profile_sources(brain, lang)
    fallback = fallback_profile_summary(sources, lang)
    if not sources:
        return fallback

    model_sources = [
        {
            "source_id": source["source_id"],
            "category": source["category"],
            "verified_value": source["value"],
        }
        for source in sources
    ]
    prompt = (
        f"{_SUMMARY_PROMPTS[lang]}\n\n"
        f"Allowed icon keys: {sorted(ALLOWED_ICON_KEYS)}\n"
        f"Verified sources: {json.dumps(model_sources, ensure_ascii=False)}"
    )
    result = await call_llm(
        [{"role": "user", "content": prompt}],
        usage_context=UsageContext(
            actor_id=learner_id,
            actor_type="learner",
            endpoint="/api/profile-summary",
            feature="feature_2_mapping",
            operation="onboarding.profile_summary",
            source="profile_summary_service",
        ),
        max_tokens=1800,
        json_mode=True,
        model_tier="strong",
    )
    if not result:
        return fallback
    try:
        parsed = json.loads(result)
    except json.JSONDecodeError:
        print("⚠️ profile summary returned invalid JSON; using grounded fallback")
        return fallback
    return _validated_summary(parsed, sources, lang)


async def apply_profile_feedback(
    learner_id: str,
    source_id: str,
    verdict: str,
    language: str,
) -> bool:
    """Apply learner verification so future agents stop using disputed claims."""
    if verdict not in {"accurate", "unsure", "inaccurate"}:
        return False

    brain = await get_brain(learner_id)
    sources = build_profile_sources(
        brain,
        language,
        include_disputed=True,
        max_sources=None,
    )
    source = next((item for item in sources if item["source_id"] == source_id), None)
    if not source:
        return False

    document, _ = ensure_memory_state(brain)
    memory = document.get("memory") or {}
    value = source["value"]
    kind = source["memory_kind"] if source["memory_kind"] in {
        "interest", "preference", "characteristic", "challenge", "strategy",
        "self_belief", "motivation_pattern", "goal",
    } else _CATEGORY_TO_MEMORY_KIND[source["category"]]
    now = datetime.now(timezone.utc).isoformat()
    reference = f"profile_feedback:{source_id}:{verdict}"

    open_questions = [
        item for item in memory.get("open_questions") or []
        if isinstance(item, dict) and item.get("source_id") != source_id
    ]
    if verdict == "accurate":
        memory, _theme, _changed = upsert_theme(
            memory,
            kind=kind,
            value=value,
            source="learner_profile_feedback",
            reference=reference,
            confidence=0.98,
            explicit=True,
            at=now,
        )
    elif verdict == "inaccurate":
        memory, _theme, _changed = upsert_theme(
            memory,
            kind=kind,
            value=value,
            source="learner_profile_feedback",
            reference=reference,
            confidence=0.65,
            explicit=False,
            at=now,
        )
        memory, _ = contradict_theme_by_value(
            memory,
            kind,
            value,
            reference=reference,
            at=now,
        )
    else:
        open_questions.append({
            "source_id": source_id,
            "value": value,
            "kind": kind,
            "status": "unsure",
            "at": now,
        })
    memory["open_questions"] = open_questions[-12:]
    memory["updated_at"] = now

    updates: dict[str, Any] = {"memory": memory}
    path = source["path"]
    if path.startswith("strengths."):
        strengths = list(document.get("strengths") or [])
        for item in strengths:
            if isinstance(item, dict) and _safe_text(item.get("label"), 120).casefold() == value.casefold():
                item["learner_feedback"] = verdict
                item["feedback_at"] = now
        updates["strengths"] = strengths
    elif path.startswith("challenges."):
        challenges = list(document.get("challenges") or [])
        for item in challenges:
            if isinstance(item, dict) and _safe_text(item.get("label"), 120).casefold() == value.casefold():
                item["learner_feedback"] = verdict
                item["feedback_at"] = now
        updates["challenges"] = challenges
    elif verdict == "inaccurate" and path == "profile.learning_style":
        updates["profile.learning_style"] = None
    elif verdict == "inaccurate" and path == "profile.environment":
        updates["profile.environment"] = None
    elif verdict == "inaccurate" and path.startswith("profile.preferences."):
        updates["profile.preferences"] = [
            item for item in profile_values(document, "preferences")
            if _safe_text(item, 120).casefold() != value.casefold()
        ]

    await apply_brain_updates(learner_id, updates)
    return True


def profile_values(brain: dict[str, Any], field: str) -> list[Any]:
    profile = brain.get("profile") or {}
    value = profile.get(field) or []
    return list(value) if isinstance(value, list) else []
