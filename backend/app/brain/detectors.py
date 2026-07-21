"""Behavior detectors (A-3) — training-free, explainable rules over real events.

All pure functions over timestamps/attempts/success we already store. They gate
what counts as *evidence* (rapid guesses must not move mastery) and surface
neutral behavior signals (wheel-spinning, answer cycling) — never an emotion or
an intent judgment about the child. Every flag carries the event ids behind it.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from statistics import median
from typing import Any, Optional

RAPID_FLOOR_SECONDS = 2.0
RAPID_COLD_START_SECONDS = 3.0
RAPID_CAP_SECONDS = 10.0
ITEM_STATS_MIN_N = 30
WHEEL_SPIN_OPPORTUNITIES = 10       # Beck & Gong: ≥10 opportunities, no mastery streak
WHEEL_SPIN_EARLY = 5
MASSED_GAP_SECONDS = 60.0
SLIP_STREAK = 3
SLIP_RT_RATIO = 0.5
CYCLING_WINDOW = 5
CYCLING_FAST_SECONDS = 7.0
CYCLING_MIN_FAST_WRONG = 3

_DURATION_RE = re.compile(
    r"^PT(?:(?P<h>\d+(?:\.\d+)?)H)?(?:(?P<m>\d+(?:\.\d+)?)M)?(?:(?P<s>\d+(?:\.\d+)?)S)?$"
)


def parse_iso_duration_seconds(value: object) -> Optional[float]:
    match = _DURATION_RE.match(str(value or "").strip())
    if not match or not any(match.groups()):
        return None
    hours = float(match.group("h") or 0)
    minutes = float(match.group("m") or 0)
    seconds = float(match.group("s") or 0)
    return hours * 3600 + minutes * 60 + seconds


def response_seconds(event: dict[str, Any]) -> Optional[float]:
    """The honest response time of one event: reported duration, else elapsed."""
    reported = parse_iso_duration_seconds((event.get("result") or {}).get("duration"))
    if reported is not None:
        return reported
    elapsed = (event.get("timing") or {}).get("elapsed_since_previous_seconds")
    return float(elapsed) if isinstance(elapsed, (int, float)) else None


def rapid_guess_threshold(item_mean_rt: Optional[float], n: int = 0) -> float:
    """< max(2s, min(10% of item mean RT, 10s)); 3s floor until n≥30 (cold start)."""
    if item_mean_rt is None or n < ITEM_STATS_MIN_N:
        return RAPID_COLD_START_SECONDS
    return max(RAPID_FLOOR_SECONDS, min(item_mean_rt * 0.1, RAPID_CAP_SECONDS))


def is_rapid_guess(
    event: dict[str, Any], item_mean_rt: Optional[float] = None, item_n: int = 0
) -> bool:
    """A response too fast to reflect effort — excluded from mastery evidence."""
    if event.get("verb") not in {"answered", "attempted"}:
        return False
    seconds = response_seconds(event)
    if seconds is None:
        return False
    return seconds < rapid_guess_threshold(item_mean_rt, item_n)


def is_probable_slip(
    entry: dict[str, Any], event: dict[str, Any], learner_median_rt: Optional[float]
) -> bool:
    """A miss on a clearly-known skill, answered unusually fast — a slip, not
    a misconception (own-history-relative, no population comparison)."""
    if (event.get("result") or {}).get("success") is not False:
        return False
    if int((entry or {}).get("consecutive_successes") or 0) < SLIP_STREAK:
        return False
    seconds = response_seconds(event)
    if seconds is None or not learner_median_rt:
        return False
    return seconds < learner_median_rt * SLIP_RT_RATIO


def learner_median_rt(events: list[dict[str, Any]]) -> Optional[float]:
    """Median response time over the learner's own scored events."""
    values = [
        seconds
        for e in events
        if e.get("verb") in {"answered", "attempted"}
        and (seconds := response_seconds(e)) is not None
    ]
    return median(values) if values else None


def wheel_spinning_state(objective_events: list[dict[str, Any]]) -> dict[str, Any]:
    """Mastery = 3 consecutive successes; ≥10 opportunities without one = spinning;
    early warning at ≥5 opportunities with massed (short-gap) attempts.

    `objective_events` = one objective's scored events, oldest first, rapid
    guesses already excluded.
    """
    scored = [
        e for e in objective_events
        if e.get("verb") in {"answered", "attempted", "completed"}
        and (e.get("result") or {}).get("success") is not None
    ]
    opportunities = len(scored)
    streak = best_streak = 0
    for e in scored:
        streak = streak + 1 if (e.get("result") or {}).get("success") else 0
        best_streak = max(best_streak, streak)
    mastered = best_streak >= 3

    massed = False
    if opportunities >= WHEEL_SPIN_EARLY:
        gaps = [
            (e.get("timing") or {}).get("elapsed_since_previous_seconds")
            for e in scored[-WHEEL_SPIN_EARLY:]
        ]
        known = [g for g in gaps if isinstance(g, (int, float))]
        massed = bool(known) and all(g < MASSED_GAP_SECONDS for g in known)

    return {
        "opportunities": opportunities,
        "mastered": mastered,
        "spinning": not mastered and opportunities >= WHEEL_SPIN_OPPORTUNITIES,
        "early_warning": (
            not mastered and WHEEL_SPIN_EARLY <= opportunities < WHEEL_SPIN_OPPORTUNITIES and massed
        ),
        "evidence_event_ids": [e.get("_id") for e in scored[-WHEEL_SPIN_OPPORTUNITIES:]],
    }


def detect_answer_cycling(recent_events: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Rapid wrong-answer cycling or the same response reused across questions.

    Internal signal only; surfaced to teachers as behavior + the exact
    statements — never the word "gaming", never an intent judgment.
    `recent_events` = the learner's latest events, newest first.
    """
    window = [
        e for e in recent_events[:CYCLING_WINDOW]
        if e.get("verb") in {"answered", "attempted"}
    ]
    if len(window) < CYCLING_MIN_FAST_WRONG:
        return None
    fast_wrong = [
        e for e in window
        if (e.get("result") or {}).get("success") is False
        and (seconds := response_seconds(e)) is not None
        and seconds < CYCLING_FAST_SECONDS
    ]
    wrong = [e for e in window if (e.get("result") or {}).get("success") is False]
    responses = [
        str((e.get("result") or {}).get("response") or "").strip()
        for e in wrong
    ]
    repeated_response = any(
        value and responses.count(value) >= CYCLING_MIN_FAST_WRONG for value in set(responses)
    ) and len({e.get("question_id") or e.get("object_id") for e in wrong}) > 1

    if len(fast_wrong) >= CYCLING_MIN_FAST_WRONG or repeated_response:
        return {
            "type": "rapid_answer_cycling",
            "at": datetime.now(timezone.utc).isoformat(),
            "evidence_event_ids": [e.get("_id") for e in window],
            "objective_id": window[0].get("objective_id"),
            "session_id": window[0].get("session_id"),
        }
    return None


def count_recent_rapid_guesses(recent_events: list[dict[str, Any]], window: int = 5) -> int:
    """How many of the last N events were flagged non-effortful at ingest."""
    return sum(
        1 for e in recent_events[:window] if e.get("effortful") is False
    )
