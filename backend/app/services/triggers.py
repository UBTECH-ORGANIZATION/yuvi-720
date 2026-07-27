"""Trigger engine (§5.5) — proactivity from REAL events, deterministic.

In-process pub/sub (asyncio queues) — the honest single-instance shape for the
pilot (R15); the seam swaps for Service Bus / change streams at scale with no
agent/brain contract change. `evaluate` is called on every ingested event and
detects idle/misconception/success from real data (never invented).
"""

from __future__ import annotations

import asyncio
import os
from typing import Any, AsyncGenerator, Optional

from app.services.learning_timing import PROLONGED_INTERACTION_SECONDS

# learner_id → set of subscriber queues (proactive push channel — an interface).
_subscribers: dict[str, set[asyncio.Queue]] = {}

MISCONCEPTION_STREAK = 3   # K consecutive fails on the same objective
# No event for this long while a lesson is open → nudge. The iframe is
# cross-origin so the client can't observe idleness; the server event stream is
# the only honest signal, so the watchdog lives here (not in the browser).
IDLE_SECONDS = int(os.environ.get("LESSON_IDLE_SECONDS", "150"))

# Per-type cooldowns (seconds) + priority. The deep-flow test showed a generic
# `slow_progress` firing first and masking the more specific nudges the learner
# actually needed — so candidates are collected specific-first and a type on
# cooldown yields to the next, instead of winner-takes-the-stream.
_COOLDOWN_SECONDS = {
    "wheel_spinning": 600,
    "misconception": 180,
    "rapid_guessing": 240,
    "slow_progress": 300,
    # A learner making mistakes expects the companion to react. Per-question
    # dedupe (`_last_mistake_key`) already prevents nagging the SAME question, so
    # this cross-question cooldown can be short — long enough to avoid spamming a
    # rapid wrong-wrong burst, short enough to react on the next question.
    "mistake": 30,
    "success": 120,
    "idle": 120,
}
# Escalations first (repeated failure), then the gentle first-mistake nudge, then
# success. `idle` is published by the watchdog, not through this candidate loop.
_PRIORITY = (
    "wheel_spinning", "misconception", "rapid_guessing", "slow_progress",
    "mistake", "success",
)
_last_published: dict[tuple[str, str], float] = {}
# Per-question dedupe for the first-mistake nudge (learner → last nudged item).
_last_mistake_key: dict[str, str] = {}
# Last screen key pushed per learner — dedupes `screen_change` so repeated
# answers on the SAME screen don't re-publish. In-process, same single-instance
# shape as the rest of this module (§ header); a multi-worker deploy would need
# the shared-bus seam like everything else here.
_last_screen_key: dict[str, str] = {}
# Sustained-effort is celebrated once per session (learner → last streak session).
_last_streak_session: dict[str, str] = {}
# Live idle-watchdog timers, one per learner (reset on each activity event).
_idle_handles: dict[str, asyncio.TimerHandle] = {}


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


def _cancel_idle(learner_id: str) -> None:
    handle = _idle_handles.pop(learner_id, None)
    if handle is not None:
        handle.cancel()


def _arm_idle(learner_id: str, objective_id: Optional[str]) -> None:
    """(Re)start the idle timer from the latest activity; a new event before it
    fires resets the clock. Fires at most one idle nudge per idle stretch (the
    next real event re-arms it), so a stuck learner is helped, not nagged."""
    _cancel_idle(learner_id)
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:  # no loop (sync test / worker) — idle handled elsewhere
        return
    _idle_handles[learner_id] = loop.call_later(
        IDLE_SECONDS, publish_idle, learner_id, objective_id
    )


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

        # First effortful mistake on a question — the gentlest nudge, so the kid
        # isn't left alone with a wrong answer. Deduped per item (never nag twice
        # on the same question); the repeated-failure escalations above outrank it.
        mistake_key = event.get("object_id") or f"{objective_id}|{event.get('question_id')}"
        if event.get("effortful") is not False and _last_mistake_key.get(learner_id) != mistake_key:
            candidates["mistake"] = {
                "type": "mistake",
                "objective_id": objective_id,
                "question_id": event.get("question_id"),
                "_key": mistake_key,
            }

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
    # Motivation (720): encourage on a completion, an improvement-after-errors
    # recovery, or sustained effort over time — all as one gentle `success` nudge.
    if result.get("success") is True and verb in ("answered", "attempted", "completed"):
        reason: Optional[str] = "completed" if verb == "completed" else None
        if reason is None and objective_id:
            recent = await get_recent_events(learner_id, objective_id, limit=20)
            prior = [e for e in recent if e.get("_id") != event.get("_id")]
            if detectors.detect_recovery(prior, event):
                reason = "recovery"
        streak_session = None
        if reason is None and event.get("session_id"):
            session_id = event["session_id"]
            if _last_streak_session.get(learner_id) != session_id:
                from app.services.events import get_session_events
                if detectors.detect_sustained_effort(
                    await get_session_events(learner_id, session_id)
                ):
                    reason, streak_session = "streak", session_id
        # A plain effortful correct answer also earns a short acknowledgement —
        # the 120s cooldown keeps it occasional, not a slot machine. (Observed
        # live: a learner answered correctly and the chat said nothing at all.)
        if reason is None and verb in ("answered", "attempted") and event.get("effortful") is not False:
            reason = "correct"
        if reason:
            candidates["success"] = {
                "type": "success", "objective_id": objective_id, "reason": reason,
            }
            if streak_session:
                candidates["success"]["_streak_session"] = streak_session

    # 720 misconception/wheel-spinning RESPONSE: serve a different REPRESENTATION.
    # Attach a same-objective alternative (video instead of text, …) so the UI
    # can offer a one-tap switch, not just talk about it. Best-effort.
    if ("misconception" in candidates or "wheel_spinning" in candidates) and objective_id:
        try:
            from app.services import content_catalog, kata_catalog
            await kata_catalog.ensure_loaded()
            alternative = content_catalog.alternate_representation(
                event.get("launch"), objective_id
            )
            if alternative:
                for key in ("misconception", "wheel_spinning"):
                    if key in candidates:
                        candidates[key]["alternative"] = alternative
        except Exception:  # never break trigger evaluation on catalog issues
            pass

    # Idle watchdog: reset on ANY interaction that reaches us (answers, hint
    # requests, selections, media) so we don't nudge an actively-engaged learner;
    # stand down when the lesson ends.
    if verb in ("answered", "attempted", "enter", "selected", "requested", "played", "paused"):
        _arm_idle(learner_id, objective_id)
    elif verb in ("completed", "exit"):
        _cancel_idle(learner_id)

    # 720 §"Completed": a COMPONENT-level completion is a STATE signal — flip the
    # roadmap node / finalize the lesson. Push it over the same SSE so the UI
    # reacts instantly instead of polling the catalog. Published DIRECTLY (not a
    # throttled candidate) so it always fires and rides alongside any `success`
    # nudge, rather than competing with it in the single-per-event priority loop.
    from app.services.events import is_component_completion  # lazy: import cycle
    if is_component_completion(event):
        _publish(learner_id, {
            "type": "completion",
            "component_id": event.get("launch"),
            "unit_id": event.get("unit_id"),
            "objective_id": objective_id,
        })

    for trigger_type in _PRIORITY:
        trigger = candidates.get(trigger_type)
        if trigger is not None and not _on_cooldown(learner_id, trigger_type):
            # Mark dedupe state only when the trigger actually wins (not when an
            # escalation outranks it) so each fires once per question / session.
            if trigger_type == "mistake":
                _last_mistake_key[learner_id] = trigger.get("_key")
            if trigger_type == "success" and trigger.get("_streak_session"):
                _last_streak_session[learner_id] = trigger["_streak_session"]
            for private in ("_key", "_streak_session"):
                trigger.pop(private, None)
            _publish(learner_id, trigger)
            return trigger
    return None


def publish_idle(learner_id: str, objective_id: Optional[str] = None) -> None:
    """Fire an idle nudge — the callback of the server-side idle watchdog
    (`_arm_idle`): no xAPI event for IDLE_SECONDS while a lesson is open. Absence
    isn't an event (R5), so the watchdog is the honest signal (the cross-origin
    iframe can't report idleness to the client)."""
    if _on_cooldown(learner_id, "idle"):
        return
    _publish(learner_id, {"type": "idle", "objective_id": objective_id})


def publish_screen_change(
    learner_id: str,
    question_key: str,
    *,
    component_id: Optional[str] = None,
    unit_id: Optional[str] = None,
) -> None:
    """The learner moved to a new question SCREEN — push it so the companion
    re-keys instantly instead of waiting for its ~2.5s support-state poll. The
    client scopes its message thread and re-arms one-shot buttons on this key.

    Direct-published (like `completion`): NOT a `_PRIORITY` candidate, so it never
    competes with or is throttled against nudges. Deduped per learner so repeated
    answers on the same screen don't re-emit; a same-screen relaunch is therefore
    silent here and healed by the poll. `screen_change` has no cooldown gate.
    """
    if _last_screen_key.get(learner_id) == question_key:
        return
    _last_screen_key[learner_id] = question_key
    # A genuine new question is a fresh reaction context: clear the per-question
    # dedupe and the reaction cooldowns so the next question gets its first
    # mistake/success nudge even if the previous one fired seconds ago (two
    # sub-questions on one screen, or a fast next-screen). Cross-question spam is
    # still bounded by per-question dedupe (`_last_mistake_key`, object_id-based)
    # and the success streak-session guard. Idle is the watchdog's, left alone.
    _last_mistake_key.pop(learner_id, None)
    for trigger_type in _PRIORITY:
        _last_published.pop((learner_id, trigger_type), None)
    _publish(learner_id, {
        "type": "screen_change",
        "question_key": question_key,
        "component_id": component_id,
        "unit_id": unit_id,
    })


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
