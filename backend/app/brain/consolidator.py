"""Memory consolidator (§5.7) — the SINGLE writer that promotes chat signals.

Capture may only *stage*; this is the only place soft, chat-sourced signals
(interests) are merged into the durable `profile`. Keeping one writer means no
races between agents "discovering" profile facts mid-conversation. Chat-sourced
interests are soft (deduped, capped); event-facts always win — and **chat never
sets mastery** (that stays in the event pipeline).
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from app.agents.onboarding import _extract_interests
from app.brain.memory import (
    MEMORY_KINDS,
    canonical_memory_key,
    contradict_theme_by_value,
    ensure_memory_state,
    forget_theme_by_value,
    looks_like_memory_signal,
    normalize_memory_value,
    upsert_theme,
)
from app.brain.repository import apply_brain_updates, get_brain
from app.services.ai_usage import UsageContext
from app.services.llm import call_llm

_MAX_INTERESTS = 8
_MAX_HOBBIES = 8
_MAX_CHARACTERISTICS = 8
_MAX_CLARIFICATIONS = 12

_MEMORY_CANDIDATE_PROMPTS = {
    "he": (
        "חלץ רק פרטי למידה שהתלמיד/ה אמר/ה במפורש ושכדאי לזכור לשיחות עתידיות. "
        "מותר: עניין, העדפת למידה, קושי מדווח, אסטרטגיה שעוזרת, אמונה עצמית, דפוס מוטיבציה או יעד. "
        "אסור: שם, גיל, כיתה, בית ספר, פרטי קשר, משפחה, בריאות או מידע רגיש. "
        "החזר JSON בלבד: {\"candidates\":[{\"kind\":\"interest|preference|challenge|strategy|self_belief|motivation_pattern|goal\","
        "\"action\":\"upsert|forget\",\"value\":\"צירוף קצר בעברית\",\"replaces_value\":\"הפרט הישן אם זה תיקון\",\"confidence\":0.0}]}. "
        "אל תסיק תכונה שלא נאמרה. אם אין פריט עמיד, החזר candidates ריק."
    ),
    "ar": (
        "استخرج فقط معلومات تعلم صرّح بها الطالب وتفيد المحادثات القادمة. المسموح: اهتمام، تفضيل تعلم، "
        "صعوبة ذاتية، استراتيجية مفيدة، اعتقاد ذاتي، نمط دافعية، أو هدف. يُمنع حفظ الاسم أو العمر أو المدرسة "
        "أو معلومات الاتصال أو العائلة أو الصحة. أعد JSON فقط بالشكل "
        "{\"candidates\":[{\"kind\":\"interest|preference|challenge|strategy|self_belief|motivation_pattern|goal\","
        "\"action\":\"upsert|forget\",\"value\":\"عبارة عربية قصيرة\",\"replaces_value\":\"المعلومة القديمة عند التصحيح\",\"confidence\":0.0}]}. "
        "لا تستنتج صفة لم تُذكر، وأعد قائمة فارغة إن لم توجد ذاكرة دائمة."
    ),
    "en": (
        "Extract only durable learning information the learner explicitly stated and that can improve future support. "
        "Allowed: interest, learning preference, self-reported challenge, effective strategy, self-belief, motivation pattern, or goal. "
        "Never retain name, age, grade, school, contact, family, health, or other sensitive information. Return JSON only as "
        "{\"candidates\":[{\"kind\":\"interest|preference|challenge|strategy|self_belief|motivation_pattern|goal\","
        "\"action\":\"upsert|forget\",\"value\":\"short English phrase\",\"replaces_value\":\"old item when correcting it\",\"confidence\":0.0}]}. "
        "Do not infer a trait that was not stated. Return an empty list when there is no durable memory."
    ),
}


def _short_candidate_value(value: object, language: str) -> str:
    text = normalize_memory_value(value, 100)
    prefixes = {
        "he": r"^(?:אני\s+)?(?:אוהב(?:ת)?|מתעניין(?:ת)?|מעדיף(?:ה)?)(?:\s+ב|\s+את|\s+)?",
        "ar": r"^(?:أنا\s+)?(?:أحب|مهتم(?:ة)?\s+ب|أفضل)\s*",
        "en": r"^(?:i\s+)?(?:like|love|am interested in|prefer)\s+",
    }
    return re.sub(prefixes.get(language, prefixes["he"]), "", text, flags=re.IGNORECASE).strip()[:100]


async def _extract_memory_candidates(
    learner_id: str,
    text: str,
    language: str,
    *,
    session_id: str | None,
    exchange_id: str | None,
) -> list[dict[str, Any]]:
    """Use the mini model only for turns likely to contain durable memory."""
    if not looks_like_memory_signal(text, language):
        return []
    lang = language if language in _MEMORY_CANDIDATE_PROMPTS else "he"
    context = UsageContext(
        actor_id=learner_id,
        actor_type="learner",
        endpoint="/api/agent/coach/stream",
        feature="feature_3_learning_companion",
        operation="memory.candidate_extraction",
        source="coach_memory_curator",
        session_id=session_id,
        exchange_id=exchange_id,
    )
    raw = await call_llm(
        [
            {"role": "system", "content": _MEMORY_CANDIDATE_PROMPTS[lang]},
            {"role": "user", "content": json.dumps({"learner_message": text}, ensure_ascii=False)},
        ],
        usage_context=context,
        max_tokens=280,
        json_mode=True,
        model_tier="mini",
    )
    candidates: list[dict[str, Any]] = []
    if raw:
        try:
            payload = json.loads(raw)
            rows = payload.get("candidates") if isinstance(payload, dict) else []
            for row in rows if isinstance(rows, list) else []:
                if not isinstance(row, dict):
                    continue
                kind = str(row.get("kind") or "").strip()
                action = str(row.get("action") or "upsert").strip()
                value = _short_candidate_value(row.get("value"), lang)
                if kind in MEMORY_KINDS and action in {"upsert", "forget"} and value:
                    candidates.append({
                        "kind": kind,
                        "action": action,
                        "value": value,
                        "replaces_value": _short_candidate_value(row.get("replaces_value"), lang),
                        "confidence": max(0.55, min(0.95, float(row.get("confidence") or 0.75))),
                    })
        except (TypeError, ValueError, json.JSONDecodeError):
            candidates = []

    if candidates:
        return candidates[:4]

    # Honest degraded mode: preserve only explicit interests using the existing
    # extractor. It never promotes mastery, traits, or inferred strategies.
    interests = await _extract_interests(text, lang, context.for_operation("memory.interest_fallback"))
    return [
        {"kind": "interest", "action": "upsert", "value": _short_candidate_value(value, lang), "confidence": 0.7}
        for value in interests
        if _short_candidate_value(value, lang)
    ][:4]


async def capture_and_consolidate(
    learner_id: str,
    user_text: str,
    language: str,
    *,
    session_id: str | None = None,
    exchange_id: str | None = None,
) -> list[str]:
    """Capture, validate, and consolidate durable learner-stated memory."""
    candidates = await _extract_memory_candidates(
        learner_id,
        user_text or "",
        language,
        session_id=session_id,
        exchange_id=exchange_id,
    )
    if not candidates:
        return []

    brain = await get_brain(learner_id)
    brain, _ = ensure_memory_state(brain)
    memory = brain.get("memory") or {}
    profile = brain.get("profile") or {}
    legacy_interests = list(profile.get("interests") or [])
    legacy_preferences = list(profile.get("preferences") or [])
    changed_values: list[str] = []
    source_ref = f"chat:{session_id or 'default'}:{exchange_id or 'turn'}"

    for candidate in candidates:
        kind = candidate["kind"]
        value = candidate["value"]
        if candidate["action"] == "forget":
            memory, forgotten = forget_theme_by_value(memory, kind, value)
            if forgotten:
                changed_values.append(value)
                if kind == "interest":
                    target = value.casefold()
                    legacy_interests = [item for item in legacy_interests if target not in str(item).casefold()]
                if kind == "preference":
                    target = value.casefold()
                    legacy_preferences = [item for item in legacy_preferences if target not in str(item).casefold()]
            continue
        replaces_value = candidate.get("replaces_value")
        if replaces_value:
            memory, contradicted = contradict_theme_by_value(
                memory,
                kind,
                replaces_value,
                reference=source_ref,
            )
            if contradicted:
                changed_values.append(str(replaces_value))
        memory, theme, changed = upsert_theme(
            memory,
            kind=kind,
            value=value,
            source="coach_chat",
            reference=source_ref,
            confidence=candidate["confidence"],
            explicit=True,
        )
        if changed and theme:
            changed_values.append(str(theme.get("value") or value))
            if kind == "interest":
                legacy_interests = _merge_soft(legacy_interests, [str(theme.get("value") or value)], _MAX_INTERESTS) or legacy_interests
            if kind == "preference":
                legacy_preferences = _merge_soft(legacy_preferences, [str(theme.get("value") or value)], 8) or legacy_preferences

    if not changed_values:
        return []
    await apply_brain_updates(learner_id, {
        "memory": memory,
        "profile.interests": legacy_interests,
        "profile.preferences": legacy_preferences,
    })
    return changed_values


def _merge_soft(existing: list[Any], candidates: list[str], cap: int) -> list[str]:
    """Dedup (case-insensitive) and cap a soft, chat-sourced string list."""
    current = [str(x) for x in (existing or [])]
    seen = {c.lower() for c in current}
    added = [c for c in candidates if c and c.lower() not in seen]
    if not added:
        return []
    return (current + added)[-cap:]


async def capture_reflection_choices(
    learner_id: str,
    phase_title: str,
    choices: list[dict[str, Any]],
    language: str,
) -> dict[str, Any]:
    """Deterministic capture of tap-to-answer reflection picks (§5.7 — no LLM).

    Each choice is `{label, signal}`: the localized text the learner tapped plus
    a stable signal code. We merge the labels into soft `characteristics` and keep
    a per-phase clarification note (with the codes) for provenance. The raw MoE
    scores are never touched.
    """
    labels = [(c.get("label") or "").strip() for c in choices if (c.get("label") or "").strip()]
    if not labels:
        return {}
    signals = [(c.get("signal") or "").strip() for c in choices if (c.get("signal") or "").strip()]

    brain = await get_brain(learner_id)
    brain, _ = ensure_memory_state(brain)
    profile = brain.get("profile") or {}
    memory = brain.get("memory") or {}
    updates: dict[str, Any] = {}

    merged = _merge_soft(profile.get("characteristics") or [], labels, _MAX_CHARACTERISTICS)
    if merged:
        updates["profile.characteristics"] = merged

    note = {
        "phase": phase_title,
        "text": "\n".join(labels)[:400],
        "language": language,
        "source": "mapping_reflection_mc",
        "signals": signals,
        "at": datetime.now(timezone.utc).isoformat(),
    }
    clarifications = list(profile.get("mapping_clarifications") or [])
    for existing in clarifications:
        if existing.get("phase") == phase_title and existing.get("source") == "mapping_reflection_mc":
            existing.update(note)
            break
    else:
        clarifications.append(note)
    updates["profile.mapping_clarifications"] = clarifications[-_MAX_CLARIFICATIONS:]

    for index, label in enumerate(labels):
        signal = signals[index] if index < len(signals) else canonical_memory_key("characteristic", label)
        memory, _theme, _changed = upsert_theme(
            memory,
            kind="characteristic",
            value=label,
            source="mapping_reflection",
            reference=f"reflection:{phase_title}:{signal}",
            confidence=0.76,
            explicit=True,
        )
    updates["memory"] = memory

    await apply_brain_updates(learner_id, updates)
    return updates
