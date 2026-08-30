"""Day-streak signals, derived from learning events.

Two different questions, deliberately kept apart:

- ``longest_day_streak`` — the best run the learner has ever had. Badges use
  this, so a coin once earned is never taken back.
- ``current_day_streak`` — the run they are on right now. Unlock rules use this,
  because "keep coming back" is only motivating while it is live.

The current streak allows one grace day: a learner who studied yesterday but has
not opened the app *yet today* is still on their streak. Without the grace day
every learner would watch their streak read zero every morning.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Iterable


def active_days(events: Iterable[dict[str, Any]] | None) -> set[str]:
    """Distinct calendar days (YYYY-MM-DD) the learner was active."""
    return {str(e.get("occurred_at"))[:10] for e in (events or []) if e.get("occurred_at")}


def _parsed(days: Iterable[str]) -> list[date]:
    out: list[date] = []
    for day in days:
        try:
            out.append(date.fromisoformat(day))
        except ValueError:
            continue
    out.sort()
    return out


def longest_day_streak(days: Iterable[str]) -> int:
    """Longest run of consecutive calendar days present in ``days``."""
    parsed = _parsed(days)
    if not parsed:
        return 0
    best = run = 1
    for prev, cur in zip(parsed, parsed[1:]):
        gap = (cur - prev).days
        if gap == 1:
            run += 1
            best = max(best, run)
        elif gap > 1:
            run = 1
    return best


def current_day_streak(days: Iterable[str], today: date | None = None) -> int:
    """Consecutive days ending today, or yesterday if today is still empty."""
    present = set(_parsed(days))
    if not present:
        return 0
    now = today or date.today()
    if now in present:
        cursor = now
    elif (now - timedelta(days=1)) in present:
        cursor = now - timedelta(days=1)
    else:
        return 0
    streak = 0
    while cursor in present:
        streak += 1
        cursor -= timedelta(days=1)
    return streak
