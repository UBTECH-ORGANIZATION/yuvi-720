"""Product help + metric definitions for the teacher assistant.

Two lanes:

`how_to(topic)` — short, factual answers about using the teacher app. Static
text, because "how do I filter by subject" has one correct answer and paying a
`strong`-tier model to improvise it every time would be both slower and less
reliable.

`explain_metric(metric)` — **derived from the live constants**, never restated.
`INACTIVITY_DAYS` is read from `insights` at call time, so if someone changes 6
to 8 the assistant's answer changes with it. A hardcoded "6 days" here would
silently become a lie the moment the threshold moved, and the assistant's whole
value rests on it never stating something the system does not actually do.

Everything returns a `{key, params}` pair for localizable text plus the raw
numeric fact, so the client renders in the teacher's language while the model
reasons over the number.
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from app.core.paths import LOCALES_DIR

# Topic → the locale key the client renders. Keys live in `tch.help.*`.
HELP_TOPICS: dict[str, str] = {
    "subject_filter": "tch.help.subjectFilter",
    "attention_inbox": "tch.help.attentionInbox",
    "evidence": "tch.help.evidence",
    "goals": "tch.help.goals",
    "goal_approval": "tch.help.goalApproval",
    "sub_groups": "tch.help.subGroups",
    "live_classroom": "tch.help.liveClassroom",
    "alerts": "tch.help.alerts",
    "notes": "tch.help.notes",
    "coach_directive": "tch.help.coachDirective",
    # The custom task builder — generation, the automatic quality checks, and
    # the two edit paths. Added because the assistant, asked "is there no
    # automatic refinement after building a task?", improvised a "no" when the
    # review screen runs quality checks and offers AI-edit (2026-08-27).
    "custom_tasks": "tch.help.customTasks",
    "notifications": "tch.help.notifications",
    "groups": "tch.help.groups",
    "no_comparisons": "tch.help.noComparisons",
    "privacy": "tch.help.privacy",
}


def topics() -> list[str]:
    return sorted(HELP_TOPICS)


@lru_cache(maxsize=8)
def _locale_texts(lang: str) -> dict[str, str]:
    path = LOCALES_DIR / f"{lang}.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def how_to(topic: str, language: str = "he") -> dict[str, Any]:
    key = HELP_TOPICS.get(str(topic or "").strip())
    if key is None:
        return {"data": None, "reason": "unknown_topic", "available_topics": topics()}
    # The resolved text rides the result because the MODEL is the reader: a
    # tool call that returns only a locale key satisfies the grounding gate
    # while leaving the model to improvise the substance — which is how the
    # assistant told a teacher there is no automatic refinement after building
    # a task, when the review screen runs exactly that (2026-08-27).
    lang = str(language or "he").split("-")[0] or "he"
    text = _locale_texts(lang).get(key) or _locale_texts("he").get(key)
    return {"data": {"topic": topic, "text_key": key, "text": text}}


def _metrics() -> dict[str, dict[str, Any]]:
    """Built per call so the constants are read live, not frozen at import."""
    from app.services import group_analytics, insights

    return {
        "inactivity": {
            "text_key": "tch.metric.inactivity",
            "threshold_days": insights.INACTIVITY_DAYS,
            "source": "insights.INACTIVITY_DAYS",
        },
        "low_success_streak": {
            "text_key": "tch.metric.lowSuccessStreak",
            "threshold_attempts": insights.LOW_SUCCESS_STREAK,
            "source": "insights.LOW_SUCCESS_STREAK",
        },
        "prolonged_interaction": {
            "text_key": "tch.metric.prolongedInteraction",
            "threshold_seconds": insights.PROLONGED_INTERACTION_SECONDS,
            "source": "insights.PROLONGED_INTERACTION_SECONDS",
        },
        "learning_gap": {
            "text_key": "tch.metric.learningGap",
            "threshold_share": group_analytics.GAP_THRESHOLD,
            "min_students_with_evidence": group_analytics.MIN_GROUP_EVIDENCE,
            "source": "group_analytics.GAP_THRESHOLD",
        },
        "engagement": {
            "text_key": "tch.metric.engagement",
            "window_days": group_analytics.DEFAULT_WINDOW_DAYS,
            "source": "group_analytics.DEFAULT_WINDOW_DAYS",
        },
        "mastery": {
            "text_key": "tch.metric.mastery",
            "source": "brain.mastery.score_ewma",
        },
        "recommendation_categories": {
            "text_key": "tch.metric.recommendationCategories",
            "categories": [
                insights.CATEGORY_REINFORCE, insights.CATEGORY_EXTRA_PRACTICE,
                insights.CATEGORY_DEEPEN, insights.CATEGORY_ENRICH,
                insights.CATEGORY_REFER,
            ],
            "source": "insights.CATEGORY_*",
        },
    }


def metrics() -> list[str]:
    return sorted(_metrics())


def explain_metric(metric: str) -> dict[str, Any]:
    table = _metrics()
    entry = table.get(str(metric or "").strip())
    if entry is None:
        return {"data": None, "reason": "unknown_metric", "available_metrics": sorted(table)}
    return {"data": {"metric": metric, **entry}}
