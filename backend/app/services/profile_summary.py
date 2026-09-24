"""Onboarding-profile summary and learner verification.

The results screen shows five fixed insights selected deterministically from the
learner's official MoE measure averages (`profile_insights`) — no LLM. Learner
feedback is written back to the Brain. The legacy claim lookup below only serves
verdicts on summaries generated before the fixed catalog existed.
"""

from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
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
from app.services import profile_insights
from learner_state import get_learner_state


SUMMARY_VERSION = 2
_INSIGHT_PREFIX = "insight:"

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
            # Only the learner's OWN verdict on this claim counts. A theme
            # confirmed elsewhere (e.g. a mapping reflection) must not arrive
            # pre-marked "accurate" — that answers the verification question for
            # them, which is the one thing this screen exists to avoid.
            feedback_status=_feedback_status(theme),
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


async def generate_profile_summary(learner_id: str, language: str) -> dict[str, Any]:
    """Five fixed insights chosen from the learner's official measure averages."""
    lang = normalize_language(language)
    brain = await get_brain(learner_id)
    state = await get_learner_state(learner_id)
    profile = brain.get("profile") or {}
    measures = profile.get("mapping_measures") or (state.get("mapping_results") or {}).get("measure_results")
    gender = "female" if state.get("gender") == "female" else "male"
    feedback = profile.get("insight_feedback") or {}

    claims = []
    values = profile_insights.measure_values(measures)
    for insight, opening in profile_insights.select_insights(values, learner_id):
        claim = profile_insights.render_claim(insight, opening, lang, gender)
        verdict = (feedback.get(insight.id) or {}).get("verdict")
        claim["feedback_status"] = verdict if verdict in {"accurate", "unsure", "inaccurate"} else None
        claims.append(claim)
    return {"version": SUMMARY_VERSION, "hero_message": "", "claims": claims}


async def _apply_insight_feedback(learner_id: str, insight_id: str, verdict: str) -> bool:
    insight = profile_insights.CATALOG_BY_ID.get(insight_id)
    if insight is None:
        return False
    await apply_brain_updates(learner_id, {
        f"profile.insight_feedback.{insight.id}": {
            "verdict": verdict,
            "measures": profile_insights.insight_measures(insight),
            "at": datetime.now(timezone.utc).isoformat(),
        },
    })
    return True


async def apply_profile_feedback(
    learner_id: str,
    source_id: str,
    verdict: str,
    language: str,
) -> bool:
    """Apply learner verification so future agents stop using disputed claims."""
    if verdict not in {"accurate", "unsure", "inaccurate"}:
        return False
    if source_id.startswith(_INSIGHT_PREFIX):
        return await _apply_insight_feedback(learner_id, source_id[len(_INSIGHT_PREFIX):], verdict)

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
