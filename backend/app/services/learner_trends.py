"""One learner's shape over time — the series behind the profile's charts.

The student profile already had every number it needed and drew none of them:
per-day activity was fetched and rendered as a seven-column table, the mastery
timeline was rendered as a count, and the chart kit's `Sparkline` had zero
consumers anywhere in the app. This module is the missing half — the same
evidence, bucketed into series a chart can take.

**No new storage.** Everything here is derived on read from `learning_events`
and the brain's `mastery` map. A trends table would be a second copy of facts
that already exist, kept in sync by hand.

**The recipes are borrowed, not reinvented**, because a number that disagrees
with the same number one screen over is worse than no number:

  minutes — `group_analytics._per_learner` caps every inter-event gap at
            `PROLONGED_INTERACTION_SECONDS` and drops gaps the timing layer
            marked `unreliable`. A learner who left a tab open overnight
            otherwise registers as a marathon study session.
  streak  — `badges._longest_day_streak`, imported rather than copied.
  days    — distinct calendar days, the same definition both of those use.

**One learner, and only ever one.** The chart kit these series feed is
one-learner-only by documented design (MoE C5: children are never ranked against
each other), so this module takes a single `learner_id` and has no group entry
point to misuse.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

MAX_EVENTS = 2000
DEFAULT_DAYS = 30
MAX_DAYS = 120


def _parse(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _day(value: Any) -> Optional[str]:
    parsed = _parse(value)
    return parsed.date().isoformat() if parsed else None


def _rate(correct: int, attempts: int) -> Optional[float]:
    """A fraction or nothing. Never 0.0 for "we have no idea" — the whole app
    reads `success_rate` as a 0–1 fraction and renders `None` as an em dash."""
    return round(correct / attempts, 3) if attempts else None


def _every_day(days: int, today: date) -> list[str]:
    """The full window, including the days nothing happened.

    A sparkline drawn only over days with events is a lie shaped like a chart:
    a learner who worked twice in a month renders as two points side by side and
    reads like two consecutive days.
    """
    return [(today - timedelta(days=offset)).isoformat()
            for offset in range(days - 1, -1, -1)]


async def learner_trends(
    learner_id: str, *, days: Optional[int] = DEFAULT_DAYS,
) -> dict[str, Any]:
    """Per-day activity, per-subject success, streaks, and mastery milestones."""
    from app.brain.repository import get_brain
    from app.services.events import get_learner_events
    from app.services.learning_timing import capped_elapsed

    # `None` means "no preference" and takes the default; `0` is a request for
    # zero days and is clamped to one. `days or DEFAULT_DAYS` conflates them and
    # quietly answers a request for nothing with a month.
    requested = DEFAULT_DAYS if days is None else int(days)
    window = max(1, min(requested, MAX_DAYS))
    today = datetime.now(timezone.utc).date()
    first_day = today - timedelta(days=window - 1)

    events = await get_learner_events(learner_id, limit=MAX_EVENTS)

    buckets: dict[str, dict[str, float]] = {
        day: {"attempts": 0, "correct": 0, "seconds": 0.0}
        for day in _every_day(window, today)
    }
    subjects: dict[str, dict[str, dict[str, int]]] = {}

    for event in events:
        # `occurred_at` is when the learner did it; `stored_at` is when we heard
        # about it. A statement relayed hours later belongs to the day it
        # happened, so the child's Tuesday is the teacher's Tuesday.
        day = _day(event.get("occurred_at") or event.get("stored_at"))
        if not day or day < first_day.isoformat() or day > today.isoformat():
            continue

        elapsed = capped_elapsed(event.get("timing"))
        if elapsed is not None:
            buckets[day]["seconds"] += elapsed

        if event.get("verb") not in ("answered", "attempted"):
            continue
        success = (event.get("result") or {}).get("success") is True
        buckets[day]["attempts"] += 1
        if success:
            buckets[day]["correct"] += 1

        subject = event.get("subject") or "other"
        entry = subjects.setdefault(subject, {}).setdefault(
            day, {"attempts": 0, "correct": 0})
        entry["attempts"] += 1
        if success:
            entry["correct"] += 1

    per_day = [
        {
            "date": day,
            "attempts": int(row["attempts"]),
            "correct": int(row["correct"]),
            # Rounded per day, not per window: a chart's tooltip and its column
            # must be the same number.
            "minutes": round(row["seconds"] / 60.0, 1),
            "success_rate": _rate(int(row["correct"]), int(row["attempts"])),
        }
        for day, row in buckets.items()
    ]

    active = [row["date"] for row in per_day if row["attempts"] or row["minutes"]]
    return {
        "learner_id": learner_id,
        "days": window,
        "from": first_day.isoformat(),
        "to": today.isoformat(),
        "per_day": per_day,
        "per_subject": _per_subject(subjects, window, today),
        "active_days": len(active),
        "streak": _streak(active),
        "totals": {
            "attempts": sum(row["attempts"] for row in per_day),
            "correct": sum(row["correct"] for row in per_day),
            "minutes": round(sum(row["minutes"] for row in per_day), 1),
            "success_rate": _rate(
                sum(row["correct"] for row in per_day),
                sum(row["attempts"] for row in per_day)),
        },
        "mastered_steps": await _mastered_steps(get_brain, learner_id, first_day),
    }


def _per_subject(
    subjects: dict[str, dict[str, dict[str, int]]], window: int, today: date,
) -> list[dict[str, Any]]:
    """Per subject, the success rate on each day it was worked.

    `None` on a day with no attempts rather than 0 — a chart that plots a zero
    for "did not study maths on Saturday" draws a crash that never happened.
    Ordered by how much the learner actually did, so the busiest lane is first.
    """
    rows = []
    for subject, by_day in subjects.items():
        series = []
        attempts = 0
        for day in _every_day(window, today):
            entry = by_day.get(day)
            if entry:
                attempts += entry["attempts"]
            series.append({
                "date": day,
                "attempts": entry["attempts"] if entry else 0,
                "success_rate": _rate(entry["correct"], entry["attempts"]) if entry else None,
            })
        correct = sum(entry["correct"] for entry in by_day.values())
        rows.append({
            "subject": subject,
            "attempts": attempts,
            "success_rate": _rate(correct, attempts),
            "series": series,
        })
    rows.sort(key=lambda row: -row["attempts"])
    return rows


def _streak(active_days: list[str]) -> int:
    """Longest run of consecutive active days, by the badge engine's own rule."""
    from app.services.badges import _longest_day_streak

    return _longest_day_streak(set(active_days))


async def _mastered_steps(get_brain, learner_id: str, first_day: date) -> list[dict[str, Any]]:
    """When each objective was achieved, oldest first — a staircase, not a count.

    Read off the mastery entry's own `achieved_at`, so the claim is the brain's
    record rather than a re-derivation from events (`moments.py` reads it the
    same way, for the same reason).
    """
    try:
        brain = await get_brain(learner_id)
    except Exception:      # pragma: no cover - a profile chart never breaks a page
        return []

    steps = []
    for key, entry in (brain.get("mastery") or {}).items():
        if not isinstance(entry, dict) or not entry.get("achieved"):
            continue
        at = _parse(entry.get("achieved_at") or entry.get("updated_at"))
        if at is None or at.date() < first_day:
            continue
        steps.append({
            "at": at.isoformat(),
            # Mastery keys are dot-safe (Brain v2 stores `·` for `.`), so the
            # id is restored the same way `moments.py` restores it.
            "objective_id": entry.get("objective_id") or key.replace("·", "."),
            "level": entry.get("level") or "basic",
        })
    steps.sort(key=lambda step: step["at"])
    return steps
