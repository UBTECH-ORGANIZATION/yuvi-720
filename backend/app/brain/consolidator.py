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

from app.brain.memory import (
    MEMORY_KINDS,
    canonical_memory_key,
    contradict_theme_by_value,
    ensure_memory_state,
    forget_theme_by_value,
    normalize_memory_value,
    upsert_theme,
)
from app.brain.repository import apply_brain_updates, get_brain
from app.services.ai_usage import UsageContext
from app.services.llm import call_llm

_MAX_INTERESTS = 8
_MAX_CHARACTERISTICS = 8
_MAX_CLARIFICATIONS = 12

# The ONLY brain fields the chat-memory lane may write (§5.7 single-writer).
# Everything else — mastery, progress, activeness, wellbeing, description text —
# is owned by other lanes (events pipeline, safety, description regen); no
# extractor output can widen this surface. `student_description.stale` is a
# flag, not content: a memory change makes the portrait reconcile lazily.
CHAT_WRITABLE_FIELDS = {
    "memory",
    "profile.interests",
    "profile.preferences",
    "strategies",
    "student_description.stale",
}

_MEMORY_CANDIDATE_PROMPTS = {
    "he": (
        "אתה שכבת הזיכרון של מורה. קרא את הודעת התלמיד/ה ואת `already_known` (מה שכבר נשמר), "
        "והחלט אילו פרטי למידה עמידים כדאי לזכור או לעדכן — לפי המשמעות, לא לפי מילות מפתח. "
        "מותר: עניין, העדפת למידה, קושי מדווח, אסטרטגיה שעוזרת, אמונה עצמית, דפוס מוטיבציה או יעד. "
        "אסור: שם, גיל, כיתה, בית ספר, פרטי קשר, משפחה, בריאות או מידע רגיש. "
        "כללי החלטה: אל תחזור על פריט שכבר קיים ב-already_known; אם ההודעה מעדכנת או סותרת פריט קיים ציין אותו ב-replaces_value; "
        "חלץ רק מה שנאמר במפורש — אל תמציא תכונה. "
        "לעולם אל תחזיר תוכן מיני, וולגרי, פוגעני, אלים, שנאה, סמים או לא הולם לפרופיל חינוכי של קטין — התעלם ממנו. "
        "value = המושג עצמו בצורת בסיס בלבד (למשל 'כדורגל'), בלי פועל כמו 'אוהב', בלי 'מאוד' ובלי סיומת מגדר. "
        "אם התלמיד/ה אומר/ת שמשהו כבר לא נכון (\"כבר לא אוהב\", \"נמאס לי מ\") — החזר עבורו action=forget. "
        "החזר JSON בלבד: {\"candidates\":[{\"kind\":\"interest|preference|challenge|strategy|self_belief|motivation_pattern|goal\","
        "\"action\":\"upsert|forget\",\"value\":\"צירוף קצר בעברית\",\"replaces_value\":\"הפרט הישן אם זה תיקון\",\"confidence\":0.0}]}. "
        "אם אין פריט חדש ועמיד, החזר candidates ריק."
    ),
    "ar": (
        "أنت طبقة ذاكرة المعلّم. اقرأ رسالة الطالب و`already_known` (ما هو محفوظ مسبقًا)، وقرّر أي معلومات تعلّم دائمة "
        "تستحق الحفظ أو التحديث — حسب المعنى لا حسب الكلمات المفتاحية. المسموح: اهتمام، تفضيل تعلم، صعوبة ذاتية، "
        "استراتيجية مفيدة، اعتقاد ذاتي، نمط دافعية، أو هدف. يُمنع حفظ الاسم أو العمر أو المدرسة أو معلومات الاتصال "
        "أو العائلة أو الصحة. قواعد: لا تكرّر عنصرًا موجودًا في already_known؛ إن كانت الرسالة تحدّث أو تناقض عنصرًا "
        "قائمًا فاذكره في replaces_value؛ استخرج فقط ما صُرّح به ولا تستنتج صفة. "
        "لا تُعِد أبدًا محتوى جنسيًا أو بذيئًا أو مسيئًا أو عنيفًا أو كراهية أو مخدرات أو غير لائق بملف تعليمي لقاصر — تجاهله. "
        "value = المفهوم نفسه بصيغته الأساسية فقط (مثل 'كرة القدم')، دون فعل مثل 'أحب' ودون 'جدا'. "
        "إذا قال الطالب إن شيئًا لم يعد صحيحًا (\"لم أعد أحب\") فأعد له action=forget. أعد JSON فقط بالشكل "
        "{\"candidates\":[{\"kind\":\"interest|preference|challenge|strategy|self_belief|motivation_pattern|goal\","
        "\"action\":\"upsert|forget\",\"value\":\"عبارة عربية قصيرة\",\"replaces_value\":\"المعلومة القديمة عند التصحيح\",\"confidence\":0.0}]}. "
        "أعد قائمة فارغة إن لم توجد ذاكرة دائمة جديدة."
    ),
    "en": (
        "You are the tutor's memory layer. Read the learner message and `already_known` (what is already stored), and "
        "decide which durable learning facts are worth remembering or updating — by meaning, not keywords. "
        "Allowed: interest, learning preference, self-reported challenge, effective strategy, self-belief, motivation pattern, or goal. "
        "Never retain name, age, grade, school, contact, family, health, or other sensitive information. "
        "Rules: do not repeat an item already in already_known; if the message updates or contradicts an existing item, name it in replaces_value; "
        "extract only what was explicitly stated — do not infer an unstated trait. "
        "Never return sexual, vulgar, offensive, violent, hateful, drug-related, or otherwise minor-inappropriate content — ignore it. "
        "value = the concept itself in base form only (e.g. 'football'), never a verb like 'love' or an intensifier. "
        "If the learner says something no longer holds (\"I don't like X anymore\"), return action=forget for it. Return JSON only as "
        "{\"candidates\":[{\"kind\":\"interest|preference|challenge|strategy|self_belief|motivation_pattern|goal\","
        "\"action\":\"upsert|forget\",\"value\":\"short English phrase\",\"replaces_value\":\"old item when correcting it\",\"confidence\":0.0}]}. "
        "Return an empty list when there is no new durable memory."
    ),
}


def _known_memory_summary(memory: dict[str, Any], limit: int = 24) -> list[str]:
    """Compact `kind: value` view of active themes, so the extractor can judge a
    turn against what is ALREADY stored (dedupe / detect updates) instead of
    re-proposing known facts."""
    out: list[str] = []
    for theme in (memory or {}).get("themes") or []:
        if not isinstance(theme, dict):
            continue
        if theme.get("status") not in (None, "active"):
            continue
        kind, value = theme.get("kind"), theme.get("value")
        if kind and value:
            out.append(f"{kind}: {value}")
    return out[:limit]


def _short_candidate_value(value: object, language: str) -> str:
    text = normalize_memory_value(value, 100)
    # Strip a leading "I (also) (really) like/love/prefer/enjoy" verb phrase,
    # including gendered forms (אוהב/ת) and intensifiers (מאוד), so the stored
    # value is the concept itself ("כדורגל") not the sentence around it.
    prefixes = {
        "he": r"^(?:אני\s+)?(?:גם\s+)?(?:אוהב|מתעניין|מעדיף|נהנה)(?:[/\\]?[הת])?(?:\s+מאוד)?(?:\s+(?:ב|את))?\s+",
        "ar": r"^(?:أنا\s+)?(?:أحب|مهتم(?:ة)?\s+ب|أفضل|أستمتع\s+ب)\s*",
        "en": r"^(?:i\s+)?(?:really\s+)?(?:like|love|am interested in|prefer|enjoy)\s+",
    }
    text = re.sub(prefixes.get(language, prefixes["he"]), "", text, flags=re.IGNORECASE).strip()
    # Safety net: drop any leftover gender-slash / punctuation / intensifier
    # residue at the start (e.g. a partial "/ת מאוד ...") so a malformed model
    # value can never be stored as a theme.
    text = re.sub(r"^[/\\\-–—,;:.\s]+", "", text)
    text = re.sub(r"^(?:[הת]|מאוד|جدا)\s+", "", text).strip()
    return text[:100]


async def _extract_memory_candidates(
    learner_id: str,
    text: str,
    language: str,
    *,
    session_id: str | None,
    exchange_id: str | None,
    known_memory: list[str] | None = None,
) -> list[dict[str, Any]]:
    """The mini model reads the turn AND the current memory and decides — by
    meaning, not keywords — what durable learning facts to store or update.

    Replaces the old regex pre-filter, which silently dropped natural phrasings
    like "אני גם אוהב מאוד כדורגל" and all non-Hebrew. A trivially short turn is
    the only thing skipped without a model call (avoids an LLM on "ok")."""
    stripped = (text or "").strip()
    if len(stripped) < 2:
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
    user_payload: dict[str, Any] = {"learner_message": text}
    if known_memory:
        user_payload["already_known"] = known_memory
    raw = await call_llm(
        [
            {"role": "system", "content": _MEMORY_CANDIDATE_PROMPTS[lang]},
            {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
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

    return candidates[:4]


async def capture_and_consolidate(
    learner_id: str,
    user_text: str,
    language: str,
    *,
    session_id: str | None = None,
    exchange_id: str | None = None,
    force: bool = False,
) -> list[str]:
    """Capture, validate, and consolidate durable learner-stated memory.

    Reads the brain first so the extractor can weigh the turn against what is
    already stored (`force` is retained for API compatibility; the extractor is
    now the sole judge, so it no longer gates)."""
    brain = await get_brain(learner_id)
    brain, _ = ensure_memory_state(brain)
    memory = brain.get("memory") or {}
    candidates = await _extract_memory_candidates(
        learner_id,
        user_text or "",
        language,
        session_id=session_id,
        exchange_id=exchange_id,
        known_memory=_known_memory_summary(memory),
    )
    if not candidates:
        return []

    # Content-safety guardian (independent LLM): never store a value that is
    # inappropriate for a minor's profile, even if the extractor proposed it
    # (e.g. a vulgar word wrongly read as an "interest"). Fails closed.
    from app.agents import safety
    unsafe = await safety.screen_memory_values(
        [c["value"] for c in candidates] + [c.get("replaces_value") for c in candidates if c.get("replaces_value")],
        language,
    )
    if unsafe:
        candidates = [
            c for c in candidates
            if c["value"] not in unsafe and c.get("replaces_value") not in unsafe
        ]
    if not candidates:
        return []

    profile = brain.get("profile") or {}
    legacy_interests = list(profile.get("interests") or [])
    legacy_preferences = list(profile.get("preferences") or [])
    changed_values: list[str] = []
    # Reaffirmation dedupes per SESSION (not per exchange, B-3): repeating the
    # same fact five times in one conversation is one piece of evidence, not five.
    source_ref = f"chat:{session_id or 'default'}"

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
    updates: dict[str, Any] = {
        "memory": memory,
        "profile.interests": legacy_interests,
        "profile.preferences": legacy_preferences,
        # Ripple: the portrait may lean on what just changed (e.g. "connects
        # through football" after the learner said they no longer like it) —
        # stale makes the next bundle build reconcile it against active themes.
        "student_description.stale": True,
    }
    strategies = _promote_strategies(memory, brain.get("strategies") or [])
    if strategies is not None:
        updates["strategies"] = strategies
    # Hard boundary: chat consolidation can never write outside its lane.
    updates = {key: value for key, value in updates.items() if key in CHAT_WRITABLE_FIELDS}
    await apply_brain_updates(learner_id, updates)
    return changed_values


_MAX_STRATEGIES = 8


def _promote_strategies(
    memory: dict[str, Any], existing: list[Any]
) -> list[dict[str, Any]] | None:
    """Promote `strategy` themes reaffirmed from ≥2 DISTINCT sessions into the
    durable `strategies[]` (procedural memory, §4.5) — the field the coach's
    "prefer a known-working strategy" instruction reads. Never fired before B-3
    because nothing wrote it."""
    promoted = [dict(s) for s in existing if isinstance(s, dict)]
    known = {normalize_memory_value(s.get("note") or s.get("text")).casefold() for s in promoted}
    changed = False
    for theme in memory.get("themes") or []:
        if not isinstance(theme, dict) or theme.get("kind") != "strategy":
            continue
        if theme.get("status") in {"forgotten", "contradicted", "expired"}:
            continue
        sessions = {
            str(ref.get("ref"))
            for ref in theme.get("evidence_refs") or []
            if isinstance(ref, dict)
        }
        confirmed = theme.get("learner_confirmed") and len(sessions) >= 2
        if not confirmed:
            continue
        value = normalize_memory_value(theme.get("value"))
        if not value or value.casefold() in known:
            continue
        promoted.append({
            "note": value,
            "confidence": float(theme.get("confidence") or 0.7),
            "source": "memory_theme",
            "theme_id": theme.get("id"),
            "promoted_at": datetime.now(timezone.utc).isoformat(),
        })
        known.add(value.casefold())
        changed = True
    return promoted[-_MAX_STRATEGIES:] if changed else None


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
