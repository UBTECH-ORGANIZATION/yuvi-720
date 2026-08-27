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

from app.services import realtime
from app.services.learning_timing import PROLONGED_INTERACTION_SECONDS


def _topic(learner_id: str) -> str:
    return f"learner:{learner_id}"

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
# Screens already congratulated, per learner, keyed `session|item|question`.
# Kata re-emits `completed` every time a learner walks back through a screen they
# already passed (observed: paging back to question 1 and pressing "המשך" praised
# them for it a second time, minutes later). A re-emitted completion is not new
# evidence — a NEW `answered` still is, so a genuine second attempt is celebrated.
_success_acknowledged: dict[str, set[str]] = {}
_SUCCESS_MEMORY_LIMIT = 200
# Strong refs for fire-and-forget signal writes from sync callbacks (the loop
# only weak-refs tasks; without this a GC could cancel one mid-write).
_signal_tasks: set[asyncio.Task] = set()


async def _record_signal(learner_id: str, kind: str, **kwargs: Any) -> None:
    """Persist one detector firing (PBI 451). Guarded — a signals failure must
    never break trigger evaluation (same stance as the teacher escalation)."""
    try:
        from app.services import learner_signals
        await learner_signals.record(learner_id, kind, **kwargs)
    except Exception as exc:
        print(f"⚠️ signal persistence failed: {type(exc).__name__}: {exc}")


def _screen_success_key(event: dict[str, Any]) -> str:
    """Identity of "this screen, in this sitting" for the praise dedupe.

    Deliberately SCREEN-level. It used to include `question_id`, but `answered`
    carries `q1` and `completed` never carries a question at all — so the key
    written on the answer could never match the key checked on the completion and
    the guard never fired once (observed live: praise on `answered …-001/q1`,
    then praise again on the re-emitted `completed …-001` minutes later). Only
    the 120s cooldown was hiding it.

    A screen with two sub-questions is unaffected: `already` is consulted for
    `completed` alone, so answering סעיף ב is still new evidence and still earns
    its own acknowledgement.
    """
    return "|".join(
        str(part or "")
        for part in (
            event.get("session_id"),
            event.get("sub_item_id") or event.get("launch"),
        )
    )


async def _already_praised(learner_id: str, key: str) -> bool:
    """Was this screen's success already acknowledged?

    Process memory is the fast path, the brain is the truth: the trigger engine
    holds no durable state, so a reload (dev `--reload`) or a second worker would
    otherwise forget and congratulate the same screen a second time.
    """
    if key in _success_acknowledged.get(learner_id, set()):
        return True
    try:
        from app.brain.repository import get_brain
        stored = ((await get_brain(learner_id)).get("current_state") or {}).get("praised_screens") or []
    except Exception:  # the guard must never break trigger evaluation
        return False
    if key in stored:
        _success_acknowledged.setdefault(learner_id, set()).update(stored)
        return True
    return False


async def _remember_success(learner_id: str, key: str) -> None:
    seen = _success_acknowledged.setdefault(learner_id, set())
    if len(seen) >= _SUCCESS_MEMORY_LIMIT:
        seen.clear()   # a sitting never has this many screens; bound the memory
    seen.add(key)
    try:
        from app.brain.repository import apply_brain_operators, get_brain
        stored = ((await get_brain(learner_id)).get("current_state") or {}).get("praised_screens") or []
        if key in stored:
            return
        await apply_brain_operators(learner_id, {
            "current_state.praised_screens": [*stored, key][-_SUCCESS_MEMORY_LIMIT:],
        })
    except Exception:  # best-effort; the in-memory set still guards this process
        pass
# Live idle-watchdog timers, one per learner (reset on each activity event).
_idle_handles: dict[str, asyncio.TimerHandle] = {}
# The objective the live watchdog was armed with, so chat activity can re-arm it
# without the caller having to know where the learner is.
_idle_objective: dict[str, Optional[str]] = {}
# Last time the learner and the companion exchanged anything in the CHAT
# (learner → monotonic seconds). The watchdog only ever saw xAPI, so a learner
# who had stopped touching the content because they were busy typing to Yuvi
# still got "אני כאן איתך…" on top of the conversation they were already having.
_last_chat_activity: dict[str, float] = {}


def _on_cooldown(learner_id: str, trigger_type: str) -> bool:
    import time
    last = _last_published.get((learner_id, trigger_type))
    return last is not None and time.monotonic() - last < _COOLDOWN_SECONDS.get(trigger_type, 180)


def _publish(learner_id: str, trigger: dict[str, Any]) -> None:
    """Stamp the cooldown clock, then hand the frame to the bus.

    The stamp stays HERE and happens unconditionally, including when nobody is
    listening: the cooldown ladder is about how often this engine is willing to
    fire, not about whether anyone saw it. Moving it into the bus would make
    every cooldown depend on the learner having a tab open.
    """
    import time
    _last_published[(learner_id, str(trigger.get("type")))] = time.monotonic()
    realtime.publish(_topic(learner_id), trigger)


def _cancel_idle(learner_id: str) -> None:
    handle = _idle_handles.pop(learner_id, None)
    _idle_objective.pop(learner_id, None)
    if handle is not None:
        handle.cancel()


def _arm_idle(
    learner_id: str, objective_id: Optional[str], delay: Optional[float] = None
) -> None:
    """(Re)start the idle timer from the latest activity; a new event before it
    fires resets the clock. Fires at most one idle nudge per idle stretch (the
    next real event re-arms it), so a stuck learner is helped, not nagged.

    `delay` shortens the wait to the silence that is actually still owed — used
    when the timer fires but the learner was talking to Yuvi in the meantime.
    """
    _cancel_idle(learner_id)
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:  # no loop (sync test / worker) — idle handled elsewhere
        return
    _idle_objective[learner_id] = objective_id
    _idle_handles[learner_id] = loop.call_later(
        IDLE_SECONDS if delay is None else max(delay, 1.0),
        publish_idle, learner_id, objective_id,
    )


def note_chat_activity(learner_id: str, *, by_learner: bool = True) -> None:
    """A turn happened in the companion chat.

    Idleness means "not working", and typing to Yuvi IS working: the watchdog
    only ever watched xAPI, so a learner mid-conversation was told "אני כאן
    איתך…" while they were plainly already with us.

    `by_learner=False` is Yuvi's own turn. It only stamps the clock — it must
    NOT restart the watchdog, or the nudge restarts the timer that produced it
    and the learner is nudged forever. That is not hypothetical: an abandoned
    tab collected 46 identical "רק רציתי לבדוק…" messages, one every 152s, for
    two and a half hours.

    Never arms a watchdog of its own either — only resets a running one. Idle
    nudges belong to an open lesson; arming from chat would start nagging
    learners chatting on the dashboard, where there is no screen to be stuck on.
    """
    import time
    _last_chat_activity[learner_id] = time.monotonic()
    if by_learner:
        # Typing to Yuvi is a sign of life for the teacher's live strip too.
        # Yuvi's own turn is not — it would keep a learner who left "online".
        from app.services import presence
        presence.note_activity(learner_id)
    if by_learner and learner_id in _idle_handles:
        _arm_idle(learner_id, _idle_objective.get(learner_id))


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
                                           # The count itself, not just the fact
                                           # that it crossed the line: the teacher's
                                           # alert says "N wrong in a row" and had
                                           # to hardcode the threshold to say it.
                                           "streak": streak,
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
                # Durable trail (PBI 451): the firing used to vanish with the
                # nudge. Recorded here — the only once-per-event path — never on
                # the read paths (moments/insights re-run detectors per view).
                # Deduped by event id: ingest is idempotent, replays re-enter.
                await _record_signal(
                    learner_id, "recovery",
                    objective_id=objective_id,
                    session_id=event.get("session_id"),
                    dedupe_key=f"recovery:{event.get('_id')}",
                )
        streak_session = None
        if reason is None and event.get("session_id"):
            session_id = event["session_id"]
            if _last_streak_session.get(learner_id) != session_id:
                from app.services.events import get_session_events
                if detectors.detect_sustained_effort(
                    await get_session_events(learner_id, session_id)
                ):
                    reason, streak_session = "streak", session_id
                    # Once per session even across restarts (the in-memory
                    # `_last_streak_session` guard above does not survive one).
                    await _record_signal(
                        learner_id, "sustained_effort",
                        objective_id=objective_id,
                        session_id=session_id,
                        dedupe_key=f"sustained:{learner_id}:{session_id}",
                    )
        # A plain effortful correct answer also earns a short acknowledgement —
        # the 120s cooldown keeps it occasional, not a slot machine. (Observed
        # live: a learner answered correctly and the chat said nothing at all.)
        if reason is None and verb in ("answered", "attempted") and event.get("effortful") is not False:
            reason = "correct"
        # A completion the learner triggers by walking back through a screen they
        # already passed is not an achievement — it is a re-emit. Praising it
        # again reads as the chat losing track of what already happened.
        success_key = _screen_success_key(event)
        if reason and verb == "completed" and await _already_praised(learner_id, success_key):
            reason = None
        if reason:
            candidates["success"] = {
                "type": "success", "objective_id": objective_id, "reason": reason,
                "_success_key": success_key,
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
            if trigger_type == "success" and trigger.get("_success_key"):
                await _remember_success(learner_id, trigger["_success_key"])
            for private in ("_key", "_streak_session", "_success_key"):
                trigger.pop(private, None)
            _publish(learner_id, trigger)
            # Mirror into the teacher's live view. Guarded: the learner's nudge
            # has already been delivered and must not be undone by a roster
            # lookup or an alert write failing.
            try:
                from app.services import teacher_alerts
                await teacher_alerts.escalate_trigger(learner_id, trigger)
            except Exception as exc:
                print(f"⚠️ teacher escalation failed: {type(exc).__name__}: {exc}")
            return trigger
    return None


def publish_idle(learner_id: str, objective_id: Optional[str] = None) -> None:
    """Fire an idle nudge — the callback of the server-side idle watchdog
    (`_arm_idle`): no xAPI event for IDLE_SECONDS while a lesson is open. Absence
    isn't an event (R5), so the watchdog is the honest signal (the cross-origin
    iframe can't report idleness to the client).

    Chat counts as activity too, and it is checked HERE as well as on the re-arm:
    the stream that carries a chat turn can outlive the timer it reset (a long
    answer, a visual tail), and `note_chat_activity` may run in a worker with no
    loop to re-arm from. Rather than swallow the tick, wait out the silence the
    conversation still owes.
    """
    # This watchdog is SPENT the moment it fires. `_idle_handles` used to keep
    # the fired handle, so everything that asks "is a watchdog running?" — the
    # chat-activity reset above all — answered yes and re-armed it, turning one
    # nudge per idle stretch into a nudge every 2.5 minutes forever. Only a real
    # event (or the re-arm below, which owes a specific remainder) starts a new
    # one.
    _idle_handles.pop(learner_id, None)
    _idle_objective.pop(learner_id, None)
    if _on_cooldown(learner_id, "idle"):
        return
    import time
    chatted_ago = time.monotonic() - _last_chat_activity.get(learner_id, float("-inf"))
    if chatted_ago < IDLE_SECONDS:
        _arm_idle(learner_id, objective_id, delay=IDLE_SECONDS - chatted_ago)
        return
    _publish(learner_id, {"type": "idle", "objective_id": objective_id})
    # Durable trail (PBI 451): one row per genuinely fired idle episode — past
    # the cooldown and chat-rearm returns above, so retro idle-share can be
    # computed. No dedupe key: each firing is a distinct ≥IDLE_SECONDS stretch
    # by construction (the handle is spent; only a real event re-arms). This is
    # a sync loop callback, so the write is a fire-and-forget task.
    try:
        from app.services import learner_signals
        task = asyncio.get_running_loop().create_task(learner_signals.record(
            learner_id, "idle", objective_id=objective_id,
            meta={"idle_seconds": IDLE_SECONDS, "lesson_open": True},
        ))
        _signal_tasks.add(task)
        task.add_done_callback(_signal_tasks.discard)
    except Exception as exc:
        print(f"⚠️ idle signal write skipped: {type(exc).__name__}")
    # Idle is published straight from the watchdog, not through `evaluate`'s
    # priority loop, so the teacher escalation there never saw it. A learner
    # sitting on one screen doing nothing is exactly what the live strip is for.
    # Presence only — an idle stretch is not a teacher interrupt.
    try:
        from app.services import presence
        presence.note_struggle(learner_id, "idle", {"idle_seconds": IDLE_SECONDS,
                                                    "objective_id": objective_id})
    except Exception as exc:
        print(f"⚠️ idle presence update failed: {type(exc).__name__}")


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


def subscriber_count(learner_id: str) -> int:
    """How many live connections this learner currently holds.

    Public because it is the only honest way to ask "is anyone listening?" from
    outside — presence needs it, and tests must not have to reach into the
    queue map to find out.
    """
    return realtime.subscriber_count(_topic(learner_id))


async def subscribe(learner_id: str, heartbeat: float = 20.0) -> AsyncGenerator[dict[str, Any], None]:
    """Yield triggers for a learner (SSE). Heartbeats keep the connection alive.

    Subscribes to the learner's own `user:` topic as well, so notifications
    addressed to them ride the connection the coach already holds instead of
    opening a second EventSource against the ~6-per-origin browser cap.
    """
    async for event in realtime.subscribe(
        _topic(learner_id), f"user:{learner_id}", heartbeat=heartbeat
    ):
        yield event
