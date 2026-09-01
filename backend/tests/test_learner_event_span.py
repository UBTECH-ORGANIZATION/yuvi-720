"""The evidence fetch has to reach back as far as the maths reads.

`get_learner_events` returns newest-first, so a row cap trims the OLDEST rows —
exactly the week that every "what changed since last week" comparison is
measured against. A learner doing a few hundred events a day exhausts a 500-row
cap inside three days, and the dashboard then reports "you had no prior
activity" as improvement. That is not a thin-data edge case: it is guaranteed
for the most active learners, and invisible for the quiet ones.
"""

import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.brain.activeness import (  # noqa: E402
    EVIDENCE_SPAN_DAYS,
    MOVEMENT_DAYS,
    WINDOW_DAYS,
)
from app.services import events as events_mod  # noqa: E402

NOW = datetime.now(timezone.utc)


def _busy_history(per_day: int = 200, days: int = 40) -> dict[str, dict]:
    """A learner generating `per_day` events for `days` — a heavy but real load."""
    store = {}
    for day in range(days):
        for i in range(per_day):
            at = (NOW - timedelta(days=day, minutes=i)).isoformat()
            store[f"{day}-{i}"] = {
                "learner_id": "busy",
                "occurred_at": at,
                "stored_at": at,
                "verb": "answered",
            }
    return store


def _fetch(**kwargs) -> list[dict]:
    with (
        patch.object(events_mod, "_events_collection", AsyncMock(return_value=None)),
        patch.object(events_mod, "_fallback_read", lambda: _busy_history()),
    ):
        return asyncio.run(events_mod.get_learner_events("busy", **kwargs))


def _in_prior_window(events: list[dict]) -> int:
    lo, hi = MOVEMENT_DAYS, MOVEMENT_DAYS + WINDOW_DAYS
    n = 0
    for e in events:
        age = (NOW - datetime.fromisoformat(e["occurred_at"])).days
        if lo <= age <= hi:
            n += 1
    return n


def test_the_row_cap_hides_the_week_being_compared_against():
    """Documents the shape of the bug, so the fix cannot be quietly reverted."""
    assert _in_prior_window(_fetch()) == 0


def test_a_time_bounded_fetch_reaches_the_prior_window():
    events = _fetch(since=NOW - timedelta(days=EVIDENCE_SPAN_DAYS))
    assert _in_prior_window(events) > 0, "no prior week means no comparison to make"


def test_the_span_covers_both_windows_the_engine_reads():
    """The fetch is only correct if it reaches the far edge of the prior window."""
    events = _fetch(since=NOW - timedelta(days=EVIDENCE_SPAN_DAYS))
    oldest = max((NOW - datetime.fromisoformat(e["occurred_at"])).days for e in events)
    assert oldest >= MOVEMENT_DAYS + WINDOW_DAYS - 1
