"""Trigger engine (§5.5) — proactivity from REAL events, deterministic.

In-process pub/sub (asyncio queues) — the honest single-instance shape for the
pilot (R15); the seam swaps for Service Bus / change streams at scale with no
agent/brain contract change. `evaluate` is called on every ingested event and
detects idle/misconception/success from real data (never invented).
"""

from __future__ import annotations

import asyncio
from typing import Any, AsyncGenerator, Optional

from app.services.learning_timing import PROLONGED_INTERACTION_SECONDS

# learner_id → set of subscriber queues (proactive push channel — an interface).
_subscribers: dict[str, set[asyncio.Queue]] = {}

MISCONCEPTION_STREAK = 3   # K consecutive fails on the same objective

# Per-type cooldowns (seconds) + priority. The deep-flow test showed a generic
# `slow_progress` firing first and masking the more specific nudges the learner
# actually needed — so candidates are collected specific-first and a type on
# cooldown yields to the next, instead of winner-takes-the-stream.
_COOLDOWN_SECONDS = {
    "wheel_spinning": 600,
    "misconception": 180,
    "rapid_guessing": 240,
    "slow_progress": 300,
    "success": 120,
    "idle": 120,
}
_PRIORITY = ("wheel_spinning", "misconception", "rapid_guessing", "slow_progress", "success")
_last_published: dict[tuple[str, str], float] = {}


def _on_cooldown(learner_id: str, trigger_type: str) -> bool:
    import time
    last = _last_published.get((learner_id, trigger_type))
    return last is not None and time.monotonic() - last < _COOLDOWN_SECONDS.get(trigger_type, 180)


def _publish(learner_id: str, trigger: dict[str, Any]) -> None:
    import time
    _last_published[(learner_id, str(trigger.get("type")))] = time.monotonic()
    for queue in list(_subscribers.get(learner_id, ())):
        try:
            queue.put_nowait(trigger)
        except asyncio.QueueFull:  # pragma: no cover
            pass


async def evaluate(learner_id: str, event: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Detect proactive-trigger candidates from the just-ingested event, then
    publish the highest-priority one that is not on cooldown."""
    from app.brain import detectors                     # lazy: avoid import cycle
    from app.services.events import get_recent_events

    verb = event.get("verb")
    objective_id = event.get("objective_id")
    result = event.get("result") or {}
    candidates: dict[str, dict[str, Any]] = {}

    # Rapid-guess nudge (A-3): ≥3 non-effortful answers in the last 5 events →
    # a gentle "let's slow down", never a judgment or a score.
    if verb in ("answered", "attempted") and event.get("effortful") is False:
        recent_all = await get_recent_events(learner_id, limit=5)
        if detectors.count_recent_rapid_guesses(recent_all, window=5) >= 3:
            candidates["rapid_guessing"] = {"type": "rapid_guessing", "objective_id": objective_id}

    if verb in ("answered", "attempted") and result.get("success") is False and objective_id:
        recent = await get_recent_events(learner_id, objective_id, limit=20)  # newest first
        # Wheel-spinning (A-3): many opportunities without a mastery streak →
        # change the activity, don't repeat it (rapid guesses excluded).
        effortful_oldest_first = [
            e for e in reversed(recent) if e.get("effortful") is not False
        ]
        wheel = detectors.wheel_spinning_state(effortful_oldest_first)
        if wheel["spinning"] or wheel["early_warning"]:
            candidates["wheel_spinning"] = {
                "type": "wheel_spinning",
                "objective_id": objective_id,
                "opportunities": wheel["opportunities"],
                "early_warning": wheel["early_warning"],
            }
        streak = 0
        for e in recent[:8]:
            success = (e.get("result") or {}).get("success")
            if e.get("verb") == "completed" and success is True:
                break                                   # a recovery resets it
            if e.get("verb") not in ("answered", "attempted"):
                continue
            if e.get("effortful") is False:
                continue                                # rapid guesses aren't evidence
            if success is False:
                streak += 1
            elif success is True:
                break
        if streak >= MISCONCEPTION_STREAK:
            candidates["misconception"] = {"type": "misconception", "objective_id": objective_id,
                                           "misconception": event.get("misconception")}

    timing = event.get("timing") or {}
    elapsed = timing.get("elapsed_since_previous_seconds")
    if (
        verb in ("answered", "attempted")
        and isinstance(elapsed, (int, float))
        and elapsed >= PROLONGED_INTERACTION_SECONDS
    ):
        candidates["slow_progress"] = {
            "type": "slow_progress",
            "objective_id": objective_id,
            "question_id": event.get("question_id"),
            "elapsed_seconds": elapsed,
            "timing_quality": timing.get("quality"),
        }
    if verb == "completed" and result.get("success") is True:
        candidates["success"] = {"type": "success", "objective_id": objective_id}

    for trigger_type in _PRIORITY:
        trigger = candidates.get(trigger_type)
        if trigger is not None and not _on_cooldown(learner_id, trigger_type):
            _publish(learner_id, trigger)
            return trigger
    return None


def publish_idle(learner_id: str, objective_id: Optional[str] = None) -> None:
    """Client-reported idle (no interaction for N s) — absence isn't an event (R5)."""
    if _on_cooldown(learner_id, "idle"):
        return
    _publish(learner_id, {"type": "idle", "objective_id": objective_id})


async def subscribe(learner_id: str, heartbeat: float = 20.0) -> AsyncGenerator[dict[str, Any], None]:
    """Yield triggers for a learner (SSE). Heartbeats keep the connection alive."""
    queue: asyncio.Queue = asyncio.Queue()
    _subscribers.setdefault(learner_id, set()).add(queue)
    try:
        while True:
            try:
                yield await asyncio.wait_for(queue.get(), timeout=heartbeat)
            except asyncio.TimeoutError:
                yield {"type": "_heartbeat"}
    finally:
        subs = _subscribers.get(learner_id)
        if subs:
            subs.discard(queue)
            if not subs:
                _subscribers.pop(learner_id, None)
