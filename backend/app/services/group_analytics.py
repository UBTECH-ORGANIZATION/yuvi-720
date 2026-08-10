"""Group-level analytics (F6 group §1–2 + nice-to-have §3–4).

Aggregates only. **No structure in this module may rank, order or pair
learners** — the spec forbids student-to-student comparison, so gaps and trends
are reported as counts over the group, and the one place a learner id appears
(`learner_ids` on a gap) exists so the teacher can act, not so the UI can build
a leaderboard. Callers that render must keep it that way.

Everything here is deterministic: numbers come from `learning_events`,
`learner_activity` and the brain. Nothing is estimated and nothing is invented.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app.brain.org import learners_in_group
from app.brain.repository import get_brain
from app.services.events import get_learner_events

# A learner counts as "active" if they produced any event in the window.
DEFAULT_WINDOW_DAYS = 7
# Share of the group that must struggle (or excel) on an objective before it is
# reported as a group-level gap/strength rather than an individual matter.
GAP_THRESHOLD = 0.3
# Minimum learners with evidence before we call anything a group pattern — below
# this, one child's bad afternoon would look like a curriculum problem.
MIN_GROUP_EVIDENCE = 2

REC = {
    "revisit": {"he": "חזרה על הנושא במליאה", "ar": "مراجعة الموضوع مع الصف",
                "en": "Revisit the topic with the whole class"},
    "change_pace": {"he": "האטת הקצב בנושא זה", "ar": "إبطاء الوتيرة في هذا الموضوع",
                    "en": "Slow the pace on this topic"},
    "adapt_method": {"he": "התאמת שיטת ההוראה (ייצוג חלופי, המחשה)",
                     "ar": "تعديل طريقة التدريس (تمثيل بديل)",
                     "en": "Adapt the teaching method (alternative representation)"},
    "split_groups": {"he": "פיצול לתתי קבוצות לפי רמת שליטה",
                     "ar": "تقسيم إلى مجموعات فرعية حسب الإتقان",
                     "en": "Split into sub-groups by mastery"},
    "extend": {"he": "העשרה לקבוצה שכבר שולטת", "ar": "إثراء للمجموعة المتقنة",
               "en": "Enrichment for the group that already mastered it"},
}


def _t(table: dict, key: str, language: str) -> str:
    return table.get(key, {}).get(language) or table.get(key, {}).get("he") or key


def _parse(iso: Optional[str]) -> Optional[datetime]:
    if not iso:
        return None
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return None


async def _gather(learner_ids: list[str], factory) -> list[Any]:
    """Fan out over the roster with a cap — a 30-student group must not become
    30 sequential round trips (the mistake `group_insights` used to make)."""
    semaphore = asyncio.Semaphore(8)

    async def _one(learner_id: str):
        async with semaphore:
            return await factory(learner_id)

    return list(await asyncio.gather(*(_one(lid) for lid in learner_ids)))


async def engagement(group_id: str, days: int = DEFAULT_WINDOW_DAYS) -> dict[str, Any]:
    """Engagement: share of active learners + average active minutes (F6 §1).

    "Active minutes" is measured from real inter-event timing, and events whose
    timing evidence is untrustworthy are excluded rather than guessed. When no
    usable timing exists the field is reported as `None` with
    `timing_available: False` — an honest gap beats a confident zero.
    """
    from app.services.learning_timing import PROLONGED_INTERACTION_SECONDS

    learner_ids = await learners_in_group(group_id)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    async def _for(learner_id: str) -> dict[str, Any]:
        events = await get_learner_events(learner_id, limit=1000)
        recent = [
            event for event in events
            if (parsed := _parse(event.get("stored_at"))) and parsed >= cutoff
        ]
        seconds = 0.0
        for event in recent:
            elapsed = (event.get("timing") or {}).get("elapsed_since_previous_seconds")
            quality = (event.get("timing") or {}).get("quality")
            # Cap each gap: a learner who left the tab open overnight would
            # otherwise register as a marathon study session.
            if isinstance(elapsed, (int, float)) and quality != "unreliable":
                seconds += min(float(elapsed), PROLONGED_INTERACTION_SECONDS)
        days_active = len({
            parsed.date().isoformat()
            for event in recent if (parsed := _parse(event.get("stored_at")))
        })
        return {
            "learner_id": learner_id,
            "events": len(recent),
            "minutes": seconds / 60.0,
            "days_active": days_active,
            "last_at": recent[0].get("stored_at") if recent else None,
        }

    rows = await _gather(learner_ids, _for)
    active = [row for row in rows if row["events"] > 0]
    with_minutes = [row for row in active if row["minutes"] > 0]

    per_day: dict[str, int] = {}
    for index in range(days):
        day = (datetime.now(timezone.utc) - timedelta(days=index)).date().isoformat()
        per_day[day] = 0
    for row in rows:
        parsed = _parse(row["last_at"])
        if parsed and parsed.date().isoformat() in per_day:
            per_day[parsed.date().isoformat()] += 1

    return {
        "group_id": group_id,
        "window_days": days,
        "students_total": len(learner_ids),
        "active_students": len(active),
        "active_pct": round(100 * len(active) / len(learner_ids)) if learner_ids else 0,
        "avg_active_minutes": (
            round(sum(row["minutes"] for row in with_minutes) / len(with_minutes), 1)
            if with_minutes else None
        ),
        "timing_available": bool(with_minutes),
        "avg_days_active": (
            round(sum(row["days_active"] for row in active) / len(active), 1)
            if active else 0
        ),
        "per_day_active": [{"date": day, "active": count} for day, count in sorted(per_day.items())],
    }


async def learning_gaps(
    group_id: str, *, subject: Optional[str] = None, threshold: float = GAP_THRESHOLD
) -> list[dict[str, Any]]:
    """Objectives where a meaningful share of the group struggles — or excels.

    Nice-to-have §3. Counts only: `struggling`/`mastered` are numbers, never an
    ordered list of children.
    """
    from app.brain.mastery import entry_for
    from app.services import kata_catalog

    await kata_catalog.ensure_loaded()
    learner_ids = await learners_in_group(group_id)
    if not learner_ids:
        return []

    brains = await _gather(learner_ids, get_brain)

    gaps: list[dict[str, Any]] = []
    for subject_id in kata_catalog.subjects():
        if subject and subject_id != subject:
            continue
        for objective in kata_catalog.objectives_for(subject_id):
            objective_id = objective.get("id")
            struggling, mastered, misconceptions = [], 0, {}
            with_evidence = 0
            for learner_id, brain in zip(learner_ids, brains):
                entry = entry_for((brain or {}).get("mastery"), objective_id)
                if not entry or not entry.get("attempts"):
                    continue
                with_evidence += 1
                if entry.get("achieved"):
                    mastered += 1
                elif (entry.get("score_ewma") or 0) < 0.6 or entry.get("needs_review"):
                    struggling.append(learner_id)
                for misconception in (entry.get("misconceptions") or []):
                    if isinstance(misconception, dict) and not misconception.get("resolved"):
                        tag = misconception.get("tag")
                        misconceptions[tag] = misconceptions.get(tag, 0) + 1

            if with_evidence < MIN_GROUP_EVIDENCE:
                continue
            struggle_share = len(struggling) / with_evidence
            mastery_share = mastered / with_evidence
            if struggle_share < threshold and mastery_share < threshold:
                continue

            gaps.append({
                "objective_id": objective_id,
                "subject": subject_id,
                "label": kata_catalog.localized_objective_title(objective_id, "he"),
                "struggling_count": len(struggling),
                "mastered_count": mastered,
                "with_evidence": with_evidence,
                "group_size": len(learner_ids),
                "struggle_share": round(struggle_share, 2),
                "mastery_share": round(mastery_share, 2),
                "kind": "gap" if struggle_share >= threshold else "strength",
                # Present so the teacher can act on the sub-group (assign a
                # goal, split the class). Never for ranking or display order.
                "learner_ids": struggling,
                "evidence": {
                    "sample_misconceptions": sorted(
                        misconceptions.items(), key=lambda item: -item[1]
                    )[:3],
                    "threshold": threshold,
                    "min_group_evidence": MIN_GROUP_EVIDENCE,
                },
            })

    gaps.sort(key=lambda gap: -gap["struggle_share"])
    return gaps


def group_recommendations(
    gaps: list[dict[str, Any]], language: str = "he"
) -> list[dict[str, Any]]:
    """Sub-group teaching moves, one per gap (nice-to-have §4).

    Deterministic: the shape of the gap picks the move, and the gap travels with
    the recommendation so the teacher sees what prompted it.
    """
    recommendations: list[dict[str, Any]] = []
    for gap in gaps:
        if gap["kind"] == "strength":
            key = "extend"
        elif gap["struggle_share"] >= 0.6:
            # Most of the group is stuck — that is a whole-class problem.
            key = "revisit"
        elif gap["mastered_count"] and gap["struggling_count"]:
            # The group has split in two; teach it as two groups.
            key = "split_groups"
        elif gap["evidence"]["sample_misconceptions"]:
            # A shared misconception responds to a different representation,
            # not to more of the same practice.
            key = "adapt_method"
        else:
            key = "change_pace"

        recommendations.append({
            "action": key,
            "text": _t(REC, key, language),
            "objective_id": gap["objective_id"],
            "subject": gap["subject"],
            "label": gap["label"],
            "because": {
                "signal": "group_gap" if gap["kind"] == "gap" else "group_strength",
                "value": gap["struggle_share"] if gap["kind"] == "gap" else gap["mastery_share"],
                "raw": {
                    "struggling_count": gap["struggling_count"],
                    "mastered_count": gap["mastered_count"],
                    "with_evidence": gap["with_evidence"],
                    "group_size": gap["group_size"],
                    "sample_misconceptions": gap["evidence"]["sample_misconceptions"],
                },
            },
        })
    return recommendations[:8]


async def group_analytics(
    group_id: str, *, subject: Optional[str] = None, language: str = "he",
    days: int = DEFAULT_WINDOW_DAYS,
) -> dict[str, Any]:
    """Everything the group screen needs, in one round trip."""
    engagement_stats, gaps = await asyncio.gather(
        engagement(group_id, days=days),
        learning_gaps(group_id, subject=subject),
    )
    return {
        "engagement": engagement_stats,
        "gaps": gaps,
        "recommendations": group_recommendations(gaps, language),
    }
