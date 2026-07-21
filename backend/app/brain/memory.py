"""Evidence-backed learner memory helpers for the Shared Learning Brain.

The brain remains the compact, canonical projection of what the platform currently
believes about a learner. Raw conversations, xAPI events, reflections, and mentoring
records stay in their append-only collections; memory themes keep only privacy-safe
values plus references to that evidence.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import re
from typing import Any, Iterable, Optional


MEMORY_KINDS = {
    "interest",
    "preference",
    "characteristic",
    "challenge",
    "strategy",
    "self_belief",
    "motivation_pattern",
    "goal",
}
MEMORY_STATUSES = {"candidate", "active", "uncertain", "contradicted", "forgotten", "expired"}
MEMORY_VERSION = 1
_MAX_THEMES = 40
_MAX_EVIDENCE_REFS = 8
_MIN_ACTIVE_CONFIDENCE = 0.55

_PROFILE_QUERY_PATTERNS = {
    "he": re.compile(r"מה.{0,18}(?:יודע|יודעת|מכיר|מכירה|זוכר|זוכרת|למדת).{0,30}(?:עלי|עליי|אותי|דרך הלמידה שלי)|איך אני לומד|מי אני", re.IGNORECASE),
    "ar": re.compile(r"ماذا.{0,18}(?:تعرف|تتذكر|تعلمت).{0,30}(?:عني|عن طريقة تعلمي)|كيف أتعلم|من أنا", re.IGNORECASE),
    "en": re.compile(r"what (?:do you|have you) (?:know|remember|learned) about (?:me|how i learn)|how do i learn|who am i", re.IGNORECASE),
}
_FORGET_PATTERNS = {
    "he": re.compile(r"(?:אל|לא)\s+ת(?:זכור|זכרי|שמור|שמרי)|תשכח|תשכחי|מחק", re.IGNORECASE),
    "ar": re.compile(r"لا\s+(?:تتذكر|تحفظ)|انس|احذف", re.IGNORECASE),
    "en": re.compile(r"(?:do not|don't) remember|forget|delete (?:that|this)", re.IGNORECASE),
}
_CORRECTION_PATTERNS = {
    "he": re.compile(r"זה לא (?:נכון|מדויק)|בעצם|אני דווקא|תתקן|תקני", re.IGNORECASE),
    "ar": re.compile(r"هذا غير (?:صحيح|دقيق)|في الحقيقة|صحح", re.IGNORECASE),
    "en": re.compile(r"that(?:'s| is) not (?:right|accurate)|actually|correct that", re.IGNORECASE),
}
# NOTE: the old `_MEMORY_SIGNAL_PATTERNS` regex pre-filter was removed — memory
# capture is judged by the mini-LLM against the current memory on every real
# turn (consolidator), never by keyword matching.


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def memory_defaults() -> dict[str, Any]:
    return {
        "version": MEMORY_VERSION,
        "themes": [],
        "open_questions": [],
        "legacy_profile_refs": [],
        "updated_at": None,
    }


def _parse_time(value: object) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def normalize_memory_value(value: object, limit: int = 120) -> str:
    """Return a bounded, PII-redacted memory value suitable for model context."""
    from app.agents.safety import strip_pii

    text, _ = strip_pii(str(value or ""))
    text = re.sub(r"\s+", " ", text).strip(" \t\n\r.,;:!?؟")
    return text.replace("<", "‹").replace(">", "›")[:limit]


def canonical_memory_key(kind: str, value: object) -> str:
    normalized = normalize_memory_value(value).casefold()
    normalized = re.sub(r"[^\w\u0590-\u05ff\u0600-\u06ff]+", "-", normalized, flags=re.UNICODE)
    normalized = normalized.strip("-")[:80]
    return f"{kind}:{normalized}"


def _theme_id(key: str) -> str:
    return f"mem_{sha256(key.encode('utf-8')).hexdigest()[:16]}"


def _evidence_ref(source: str, reference: Optional[str], at: Optional[str] = None) -> dict[str, str]:
    return {
        "source": source[:40],
        "ref": (reference or "unreferenced")[:160],
        "at": at or _now(),
    }


def _confidence(value: object, default: float = 0.65) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return default


def upsert_theme(
    memory: dict[str, Any],
    *,
    kind: str,
    value: object,
    source: str,
    reference: Optional[str],
    confidence: float,
    explicit: bool = False,
    at: Optional[str] = None,
) -> tuple[dict[str, Any], Optional[dict[str, Any]], bool]:
    """Create or reaffirm a typed theme without retaining a raw learner quote."""
    if kind not in MEMORY_KINDS:
        return deepcopy(memory), None, False
    safe_value = normalize_memory_value(value)
    if not safe_value:
        return deepcopy(memory), None, False

    state = deepcopy(memory or memory_defaults())
    themes = list(state.get("themes") or [])
    key = canonical_memory_key(kind, safe_value)
    evidence = _evidence_ref(source, reference, at)
    now = evidence["at"]

    for index, existing in enumerate(themes):
        if not isinstance(existing, dict) or existing.get("key") != key:
            continue
        refs = [item for item in existing.get("evidence_refs") or [] if isinstance(item, dict)]
        is_new_ref = not any(
            item.get("source") == evidence["source"] and item.get("ref") == evidence["ref"]
            for item in refs
        )
        if is_new_ref:
            refs.append(evidence)
        reaffirmations = int(existing.get("reaffirmations") or 1) + (1 if is_new_ref else 0)
        old_confidence = _confidence(existing.get("confidence"))
        proposed = _confidence(confidence)
        combined = max(old_confidence, min(0.98, old_confidence + (proposed * 0.12 if is_new_ref else 0.0)))
        updated = {
            **existing,
            "value": safe_value,
            "confidence": round(combined, 3),
            "status": "active" if combined >= _MIN_ACTIVE_CONFIDENCE else "uncertain",
            "source_types": sorted(set(existing.get("source_types") or []) | {source}),
            "evidence_refs": refs[-_MAX_EVIDENCE_REFS:],
            "last_seen": now,
            "reaffirmations": reaffirmations,
            "learner_confirmed": bool(existing.get("learner_confirmed")) or explicit,
        }
        themes[index] = updated
        state.update({"version": MEMORY_VERSION, "themes": themes, "updated_at": now})
        return state, updated, updated != existing

    initial_confidence = max(_confidence(confidence), 0.9 if explicit else 0.0)
    theme = {
        "id": _theme_id(key),
        "kind": kind,
        "key": key,
        "value": safe_value,
        "confidence": round(initial_confidence, 3),
        "status": "active" if initial_confidence >= _MIN_ACTIVE_CONFIDENCE else "candidate",
        "source_types": [source],
        "evidence_refs": [evidence],
        "first_seen": now,
        "last_seen": now,
        "reaffirmations": 1,
        "learner_confirmed": explicit,
    }
    themes.append(theme)
    # Retain active/uncertain themes first, then the most recent candidates.
    themes = themes[-_MAX_THEMES:]
    state.update({"version": MEMORY_VERSION, "themes": themes, "updated_at": now})
    return state, theme, True


def forget_theme(memory: dict[str, Any], theme_id: str, *, at: Optional[str] = None) -> tuple[dict[str, Any], bool]:
    state = deepcopy(memory or memory_defaults())
    changed = False
    now = at or _now()
    themes: list[dict[str, Any]] = []
    for theme in state.get("themes") or []:
        if isinstance(theme, dict) and theme.get("id") == theme_id and theme.get("status") != "forgotten":
            theme = {**theme, "status": "forgotten", "forgotten_at": now, "last_seen": now}
            changed = True
        themes.append(theme)
    if changed:
        state.update({"themes": themes, "version": MEMORY_VERSION, "updated_at": now})
    return state, changed


def forget_theme_by_value(
    memory: dict[str, Any], kind: str, value: object, *, at: Optional[str] = None
) -> tuple[dict[str, Any], list[str]]:
    """Forget active themes matching a normalized value, returning their ids."""
    state = deepcopy(memory or memory_defaults())
    target = normalize_memory_value(value).casefold()
    if not target:
        return state, []
    forgotten: list[str] = []
    now = at or _now()
    themes: list[dict[str, Any]] = []
    for theme in state.get("themes") or []:
        if not isinstance(theme, dict):
            themes.append(theme)
            continue
        current = normalize_memory_value(theme.get("value")).casefold()
        same_kind = kind not in MEMORY_KINDS or theme.get("kind") == kind
        matches = current == target or (len(target) >= 3 and (target in current or current in target))
        if same_kind and matches and theme.get("status") not in {"forgotten", "expired"}:
            theme = {**theme, "status": "forgotten", "forgotten_at": now, "last_seen": now}
            forgotten.append(str(theme.get("id") or ""))
        themes.append(theme)
    if forgotten:
        state.update({"themes": themes, "version": MEMORY_VERSION, "updated_at": now})
    return state, [item for item in forgotten if item]


def contradict_theme_by_value(
    memory: dict[str, Any],
    kind: str,
    value: object,
    *,
    reference: Optional[str],
    at: Optional[str] = None,
) -> tuple[dict[str, Any], list[str]]:
    """Supersede a matching belief while retaining an evidence-linked audit trail."""
    state = deepcopy(memory or memory_defaults())
    target = normalize_memory_value(value).casefold()
    if not target:
        return state, []
    contradicted: list[str] = []
    now = at or _now()
    themes: list[dict[str, Any]] = []
    for theme in state.get("themes") or []:
        if not isinstance(theme, dict):
            themes.append(theme)
            continue
        current = normalize_memory_value(theme.get("value")).casefold()
        matches = current == target or (len(target) >= 3 and (target in current or current in target))
        if (
            theme.get("kind") == kind
            and matches
            and theme.get("status") not in {"contradicted", "forgotten", "expired"}
        ):
            refs = list(theme.get("evidence_refs") or [])
            refs.append(_evidence_ref("learner_correction", reference, now))
            theme = {
                **theme,
                "status": "contradicted",
                "contradicted_at": now,
                "last_seen": now,
                "source_types": sorted(
                    set(theme.get("source_types") or []) | {"learner_correction"}
                ),
                "evidence_refs": refs[-_MAX_EVIDENCE_REFS:],
            }
            contradicted.append(str(theme.get("id") or ""))
        themes.append(theme)
    if contradicted:
        state.update({"themes": themes, "version": MEMORY_VERSION, "updated_at": now})
    return state, [item for item in contradicted if item]


def correct_theme(
    memory: dict[str, Any], theme_id: str, value: object, *, at: Optional[str] = None
) -> tuple[dict[str, Any], Optional[dict[str, Any]]]:
    state = deepcopy(memory or memory_defaults())
    safe_value = normalize_memory_value(value)
    if not safe_value:
        return state, None
    now = at or _now()
    themes = list(state.get("themes") or [])
    for index, theme in enumerate(themes):
        if not isinstance(theme, dict) or theme.get("id") != theme_id:
            continue
        key = canonical_memory_key(str(theme.get("kind") or "characteristic"), safe_value)
        updated = {
            **theme,
            "key": key,
            "value": safe_value,
            "confidence": 0.98,
            "status": "active",
            "learner_confirmed": True,
            "last_seen": now,
            "source_types": sorted(set(theme.get("source_types") or []) | {"learner_correction"}),
            "evidence_refs": (
                list(theme.get("evidence_refs") or [])
                + [_evidence_ref("learner_correction", f"memory:{theme_id}", now)]
            )[-_MAX_EVIDENCE_REFS:],
        }
        themes[index] = updated
        state.update({"themes": themes, "version": MEMORY_VERSION, "updated_at": now})
        return state, updated
    return state, None


def active_themes(
    memory: dict[str, Any],
    kinds: Optional[Iterable[str]] = None,
    *,
    minimum_confidence: float = _MIN_ACTIVE_CONFIDENCE,
    limit: Optional[int] = None,
) -> list[dict[str, Any]]:
    allowed = set(kinds or MEMORY_KINDS)
    now = datetime.now(timezone.utc)
    selected: list[dict[str, Any]] = []
    for theme in memory.get("themes") or []:
        if not isinstance(theme, dict) or theme.get("kind") not in allowed:
            continue
        if theme.get("status") in {"contradicted", "forgotten", "expired"}:
            continue
        confidence = _confidence(theme.get("confidence"))
        # Unconfirmed chat-only beliefs gradually lose retrieval priority after 120 days.
        last_seen = _parse_time(theme.get("last_seen"))
        if (
            last_seen
            and not theme.get("learner_confirmed")
            and set(theme.get("source_types") or []) <= {"coach_chat"}
        ):
            age_days = max(0, (now - last_seen).days)
            confidence *= max(0.35, 1.0 - age_days / 120)
        if confidence < minimum_confidence:
            continue
        selected.append({**theme, "retrieval_confidence": round(confidence, 3)})
    selected.sort(
        key=lambda item: (
            bool(item.get("learner_confirmed")),
            float(item.get("retrieval_confidence") or 0),
            item.get("last_seen") or "",
        ),
        reverse=True,
    )
    return selected[:limit] if limit is not None else selected


def ensure_memory_state(brain: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Migrate legacy string profile fields into stable evidence-backed themes."""
    document = deepcopy(brain)
    memory = document.get("memory") if isinstance(document.get("memory"), dict) else memory_defaults()
    memory = {**memory_defaults(), **memory}
    changed = document.get("memory") != memory
    profile = document.get("profile") or {}
    profile_source = str(profile.get("source") or "profile")
    profile_updated = profile.get("updated_at") or document.get("created_at") or _now()
    migrated_refs = {
        str(reference)
        for reference in memory.get("legacy_profile_refs") or []
        if reference
    }
    # Backfill the marker for brains migrated by the first v2 implementation.
    migrated_refs.update(
        str(item.get("ref"))
        for theme in memory.get("themes") or []
        if isinstance(theme, dict)
        for item in theme.get("evidence_refs") or []
        if isinstance(item, dict) and str(item.get("ref") or "").startswith("profile:")
    )

    sources: list[tuple[str, object, float]] = []
    for value in profile.get("interests") or []:
        raw = value.get("text") or value.get("label") if isinstance(value, dict) else value
        sources.append(("interest", raw, 0.78))
    for value in profile.get("preferences") or []:
        raw = value.get("text") or value.get("label") if isinstance(value, dict) else value
        sources.append(("preference", raw, 0.82))
    for value in profile.get("characteristics") or []:
        raw = value.get("text") or value.get("label") if isinstance(value, dict) else value
        sources.append(("characteristic", raw, 0.72))
    if profile.get("learning_style"):
        sources.append(("preference", profile.get("learning_style"), 0.85))
    if profile.get("environment"):
        sources.append(("preference", profile.get("environment"), 0.78))

    for kind, value, confidence in sources:
        reference = f"profile:{canonical_memory_key(kind, value)}"
        if reference in migrated_refs:
            continue
        migrated, _theme, did_change = upsert_theme(
            memory,
            kind=kind,
            value=value,
            source=profile_source,
            reference=reference,
            confidence=confidence,
            at=profile_updated,
        )
        if did_change:
            memory = migrated
            changed = True
        migrated_refs.add(reference)
    stable_refs = sorted(migrated_refs)[-80:]
    if memory.get("legacy_profile_refs") != stable_refs:
        memory["legacy_profile_refs"] = stable_refs
        changed = True
    document["memory"] = memory
    return document, changed


def classify_query_intent(message: str, language: str) -> str:
    lang = language if language in _PROFILE_QUERY_PATTERNS else "he"
    text = message or ""
    if _FORGET_PATTERNS[lang].search(text):
        return "memory_forget"
    if _CORRECTION_PATTERNS[lang].search(text):
        return "memory_correct"
    if _PROFILE_QUERY_PATTERNS[lang].search(text):
        return "profile_question"
    lower = text.casefold()
    if any(token in lower for token in ("קשה לי", "לא מצליח", "محبط", "صعب", "frustrated", "too hard")):
        return "encouragement"
    if any(token in lower for token in ("מטרה", "יעד", "هدف", "goal", "next")):
        return "goal_planning"
    return "learning_help"


def build_learner_portrait(brain: dict[str, Any], locale: str) -> dict[str, Any]:
    """Build a compact, grounded portrait for self-knowledge queries."""
    document, _ = ensure_memory_state(brain)
    memory = document.get("memory") or memory_defaults()
    profile = document.get("profile") or {}

    interests = [item["value"] for item in active_themes(memory, {"interest"}, limit=3)]
    preferences = [item["value"] for item in active_themes(memory, {"preference"}, limit=3)]
    characteristics = [item["value"] for item in active_themes(memory, {"characteristic", "self_belief"}, limit=2)]
    strategies = [
        normalize_memory_value(item.get("note") or item.get("text"))
        for item in document.get("strategies") or []
        if isinstance(item, dict) and _confidence(item.get("confidence"), 1.0) >= 0.65
    ][:2]
    strengths = [
        normalize_memory_value(item.get("label") if isinstance(item, dict) else item)
        for item in document.get("strengths") or []
        if not isinstance(item, dict) or item.get("learner_feedback") != "inaccurate"
    ][:2]
    goals = [
        normalize_memory_value(item.get("text"))
        for item in document.get("goals") or []
        if isinstance(item, dict)
        and item.get("visible_to_learner", True)
        and item.get("status", "open") == "open"
    ][:1]

    return {
        "interests": [value for value in interests if value],
        "preferences": [value for value in preferences if value],
        "characteristics": [value for value in characteristics if value],
        "strengths": [value for value in strengths if value],
        "strategies": [value for value in strategies if value],
        "active_goal": goals[0] if goals else "",
        "locale": locale,
        "evidence_count": sum(len(item.get("evidence_refs") or []) for item in active_themes(memory)),
    }


def profile_answer_fallback(portrait: dict[str, Any], locale: str) -> str:
    interests = portrait.get("interests") or []
    preferences = portrait.get("preferences") or []
    strengths = portrait.get("strengths") or []
    goal = portrait.get("active_goal") or ""
    if not any((interests, preferences, strengths, goal)):
        return {
            "he": "אני עדיין לומד להכיר את דרך הלמידה שלך. ככל שנלמד ונדבר, אוכל להתאים את העזרה טוב יותר — ותמיד אפשר לתקן אותי.",
            "ar": "ما زلت أتعرف إلى طريقة تعلّمك. كلما تعلمنا وتحدثنا سأتمكن من ملاءمة المساعدة بشكل أفضل، ويمكنك دائمًا تصحيحي.",
            "en": "I'm still learning how you learn. As we work together I can tailor the help better, and you can always correct me.",
        }.get(locale, "I'm still learning how you learn, and you can always correct me.")

    if locale == "ar":
        first = "مما تعلمته حتى الآن، "
        if preferences:
            first += f"ترتاح أكثر عندما تكون طريقة التعلّم {preferences[0]}"
        elif interests:
            first += f"تتفاعل أكثر مع أمثلة ترتبط بـ {', '.join(interests[:2])}"
        else:
            first += f"تستطيع البناء على قوتك في {strengths[0]}"
        second = f" وهدفك الحالي هو {goal}." if goal else "."
        return first + second + " إذا كان شيء غير دقيق، صححني."
    if locale == "en":
        first = "From what I've learned so far, "
        if preferences:
            first += f"you are more comfortable when learning includes {preferences[0]}"
        elif interests:
            first += f"you engage more with examples connected to {', '.join(interests[:2])}"
        else:
            first += f"you can build on your strength in {strengths[0]}"
        second = f" Your current goal is {goal}." if goal else "."
        return first + second + " If anything feels inaccurate, correct me."

    first = "ממה שלמדתי עד עכשיו, "
    if preferences:
        first += f"נוח לך יותר כשהלמידה כוללת {preferences[0]}"
    elif interests:
        first += f"קל לך להתחבר לדוגמאות מעולמות כמו {', '.join(interests[:2])}"
    else:
        first += f"אפשר לבנות על החוזקה שלך ב{strengths[0]}"
    if interests and preferences:
        first += f", במיוחד כשמחברים אותן לעולמות כמו {', '.join(interests[:2])}"
    first += "."
    second = f" כרגע המטרה שלך היא {goal}." if goal else ""
    return first + second + " אם משהו כאן לא מדויק, אפשר לתקן אותי."


def public_memory_projection(brain: dict[str, Any]) -> dict[str, Any]:
    """Return learner-reviewable memory without confidence numbers or raw evidence."""
    document, _ = ensure_memory_state(brain)
    themes = active_themes(document.get("memory") or memory_defaults(), minimum_confidence=0.0)
    return {
        "themes": [
            {
                "id": item.get("id"),
                "kind": item.get("kind"),
                "value": item.get("value"),
                "status": item.get("status"),
                "learner_confirmed": bool(item.get("learner_confirmed")),
                "sources": item.get("source_types") or [],
                "first_seen": item.get("first_seen"),
                "last_seen": item.get("last_seen"),
            }
            for item in themes
        ],
        "updated_at": (document.get("memory") or {}).get("updated_at"),
    }
