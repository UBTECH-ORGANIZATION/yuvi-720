"""Independence & Concentration — the teacher's two habit scores (PBI 451).

Reut's rule: "בסוף זה טוב שהוא משתמש ביובי, השאלה איך הוא משתמש ביובי". A child
who asks "why was my answer wrong?" is MORE independent than one who never
opens the chat and never gets unstuck — so independence is scored from how the
child works and asks, not from how much help they took. התמדה is replaced by
קשב וריכוז, computed from attention signals, not a decorative arc.

Everything here is derived on read — no score documents. The headline is a
visible weighted mean over sub-scores; missing sub-scores renormalize the
weights (the ``tasks/attempts.py`` pattern) and are reported in ``coverage``,
never silently absorbed. Evidence gating copies ``brain/activeness.py``:
confidence ramps to 1.0 at ``EVIDENCE_FULL`` relevant units, and below
``MIN_CONF`` the API sends ``value: null`` — "not enough evidence" is never a
low number. Every sub-score carries its raw numbers (MoE C4).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app.brain import detectors
from app.services import learning_timing

WINDOW_DAYS = 7
EVIDENCE_FULL = 12   # brain/activeness.py — full confidence at 12 relevant units
MIN_CONF = 0.3       # below this the score is withheld, not shown
TREND_DEAD_ZONE = 3.0  # |points| under this reads as "flat", not a direction
MAX_EVENTS = 2000

INDEPENDENCE_WEIGHTS = {
    "tried_before_asking": 0.25,
    "question_quality": 0.25,
    "unassisted_success": 0.20,
    "persistence_vs_giving_up": 0.15,
    "recovery": 0.10,
    "support_depth": 0.05,
}
CONCENTRATION_WEIGHTS = {
    "on_task_share": 0.30,
    "idle_share": 0.25,
    "rapid_guess_rate": 0.20,
    "sustained_effort": 0.15,
    "off_topic_chat": 0.10,
}

# Question-quality taxonomy → independence value, per the PBI ordering.
# `off_topic` is deliberately absent: it feeds concentration, never this score.
QUALITY_VALUES = {
    "self_diagnostic": 1.0,
    "conceptual": 0.9,
    "verification": 0.6,
    "procedural": 0.45,
    "answer_seeking": 0.1,
}

# Few effortful attempts then walking away = giving up. MORE attempts without
# progress is wheel-spinning — persistence without progress — and must never
# score as giving up (excluded entirely, not counted against the child).
GIVE_UP_MAX_ATTEMPTS = 2

# Support rows that are explicit help REQUESTS. `yuvi_chat` is excluded here:
# a chat message is not necessarily a request for help (the question-quality
# score judges what it was).
SUPPORT_KINDS = {"hint", "explanation", "different_way", "content_hint"}

IDLE_SECONDS_DEFAULT = 150


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _stamp(event: dict[str, Any]) -> str:
    return event.get("occurred_at") or event.get("stored_at") or ""


def _q_key(event: dict[str, Any]) -> tuple:
    return (event.get("launch"), event.get("sub_item_id"), event.get("question_id"))


def _attempts(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [e for e in events if e.get("verb") in ("answered", "attempted")]


def _success(event: dict[str, Any]) -> Optional[bool]:
    return (event.get("result") or {}).get("success")


def _sub(value: Optional[float], n: int, evidence: dict[str, Any]) -> dict[str, Any]:
    return {"value": value, "n": n, "evidence": evidence}


# ---------------------------------------------------------------- independence


def _tried_before_asking(events: list[dict], activity: list[dict]) -> dict[str, Any]:
    """Share of explicit help requests that came AFTER at least one effortful
    attempt on the same question — the purest signal: timestamps, no inference."""
    attempts = [
        e for e in _attempts(events)
        if e.get("effortful") is not False and _stamp(e)
    ]
    first_try: dict[tuple, str] = {}
    for event in attempts:
        key = _q_key(event)
        stamp = _stamp(event)
        if key not in first_try or stamp < first_try[key]:
            first_try[key] = stamp
    requests = [row for row in activity if row.get("kind") in SUPPORT_KINDS]
    qualified = 0
    for row in requests:
        key = (row.get("component_id"), row.get("item_id"), row.get("question_id"))
        tried_at = first_try.get(key)
        if tried_at and tried_at < (row.get("at") or ""):
            qualified += 1
    total = len(requests)
    value = (qualified / total) if total else None
    return _sub(value, total, {"support_requests": total, "after_own_attempt": qualified})


def _question_quality(labels: list[dict]) -> dict[str, Any]:
    """Distribution over the taxonomy, weighted toward self-diagnostic and
    conceptual asks. Zero labels → not measured (renormalized + reported)."""
    counts: dict[str, int] = {}
    for row in labels:
        label = (row.get("meta") or {}).get("label")
        if label:
            counts[label] = counts.get(label, 0) + 1
    scored = [QUALITY_VALUES[l] for l, c in counts.items() if l in QUALITY_VALUES for _ in range(c)]
    n = len(scored)
    value = (sum(scored) / n) if n else None
    return _sub(value, n, {"labels": counts, "scored_messages": n})


def _unassisted_success(events: list[dict], activity: list[dict]) -> dict[str, Any]:
    """Share of solved questions solved with zero support events and zero chat
    turns. Direct evidence, confounded by difficulty — hence not the top weight."""
    solved: set[tuple] = set()
    for event in _attempts(events):
        if _success(event) is True:
            solved.add(_q_key(event))
    helped: set[tuple] = set()
    for row in activity:
        if row.get("kind") in SUPPORT_KINDS or row.get("kind") == "yuvi_chat":
            helped.add((row.get("component_id"), row.get("item_id"), row.get("question_id")))
    unassisted = len([key for key in solved if key not in helped])
    n = len(solved)
    value = (unassisted / n) if n else None
    return _sub(value, n, {"solved": n, "unassisted": unassisted})


def _persistence(events: list[dict]) -> dict[str, Any]:
    """1 − (give-ups ÷ struggled questions). A give-up is ≤GIVE_UP_MAX_ATTEMPTS
    effortful attempts, no success, then `skipped`/`exit` in that session.
    Wheel-spinning (many attempts, no progress) is excluded from BOTH sides —
    abandoning a spun-out question is productive disengagement, not giving up."""
    by_question: dict[tuple, list[dict]] = {}
    for event in _attempts(events):
        by_question.setdefault(_q_key(event), []).append(event)
    exits_by_session: dict[Any, list[str]] = {}
    for event in events:
        if event.get("verb") in ("skipped", "exit"):
            exits_by_session.setdefault(event.get("session_id"), []).append(_stamp(event))

    give_ups = 0
    eligible = 0
    for key, rows in by_question.items():
        rows.sort(key=_stamp)
        effortful = [e for e in rows if e.get("effortful") is not False]
        failed = [e for e in effortful if _success(e) is False]
        succeeded = any(_success(e) is True for e in rows)
        if not failed or succeeded:
            continue
        if len(effortful) > GIVE_UP_MAX_ATTEMPTS:
            # Persistence without progress — wheel-spinning territory, excluded.
            continue
        eligible += 1
        last_at = _stamp(rows[-1])
        session = rows[-1].get("session_id")
        walked_away = any(stamp >= last_at for stamp in exits_by_session.get(session, []))
        if walked_away:
            give_ups += 1
    value = (1 - give_ups / eligible) if eligible else None
    return _sub(value, eligible, {"struggled_questions": eligible, "gave_up": give_ups})


def _recovery(events: list[dict], signals: list[dict]) -> dict[str, Any]:
    """Recovered share of struggle runs. Evidence is the OPPORTUNITY count — a
    child who never hit a ≥2-fail run has no evidence, not a zero score."""
    by_objective: dict[Any, list[dict]] = {}
    for event in _attempts(events):
        if event.get("effortful") is False or _success(event) is None:
            continue
        if event.get("objective_id"):
            by_objective.setdefault(event["objective_id"], []).append(event)
    opportunities = 0
    for rows in by_objective.values():
        rows.sort(key=_stamp)
        run = 0
        for event in rows:
            if _success(event) is False:
                run += 1
            else:
                if run >= detectors.RECOVERY_MIN_FAILS:
                    opportunities += 1
                run = 0
        if run >= detectors.RECOVERY_MIN_FAILS:
            opportunities += 1
    firings = len([s for s in signals if s.get("kind") == "recovery"])
    opportunities = max(opportunities, firings)
    value = min(firings / opportunities, 1.0) if opportunities else None
    return _sub(value, opportunities, {"struggle_runs": opportunities, "recovered": firings})


def _support_depth(decisions: list[dict]) -> dict[str, Any]:
    """How deep the hint ladder went. Level 1 is the LIGHTEST rung — a child
    the first hint sufficed for scores full, and only climbing toward the
    ladder's top costs. (With today's MAX_HINT_LEVEL=1 every hint IS the
    lightest, so this reads 1.0 until the ladder grows — the earlier
    level/max formula scored "took the only, lightest hint" as zero.)"""
    from app.agents.tutor_decision import MAX_HINT_LEVEL

    levels = [
        int(d["hint_level"]) for d in decisions
        if isinstance(d.get("hint_level"), int) and d["hint_level"] >= 1
    ]
    n = len(levels)
    ceiling = max(MAX_HINT_LEVEL, 1)
    mean = (sum(levels) / n) if n else None
    value = None
    if mean is not None:
        value = max(0.0, min(1.0, 1 - (mean - 1) / max(ceiling - 1, 1)))
    return _sub(value, n, {"support_decisions": n,
                           "mean_hint_level": round(mean, 2) if mean is not None else None,
                           "ladder_max": ceiling})


# --------------------------------------------------------------- concentration


def _on_task_share() -> dict[str, Any]:
    """Needs the lesson/studio/chat/browsing surface signal from #249 §1, which
    does not exist yet. Reported missing + renormalized — never silently scored.
    Evidence stays EMPTY: the dialog's coverage note explains the absence in
    words; a machine value here would leak plumbing into a teacher's screen."""
    return _sub(None, 0, {})


def _idle_share(events: list[dict], signals: list[dict]) -> dict[str, Any]:
    idle_rows = [s for s in signals if s.get("kind") == "idle"]
    idle_seconds = sum(
        float((s.get("meta") or {}).get("idle_seconds") or IDLE_SECONDS_DEFAULT)
        for s in idle_rows
    )
    lesson_seconds = 0.0
    timed = 0
    for event in _attempts(events):
        seconds = learning_timing.capped_elapsed(event.get("timing"))
        if seconds is not None:
            lesson_seconds += seconds
            timed += 1
    share = min(idle_seconds / lesson_seconds, 1.0) if lesson_seconds else (1.0 if idle_rows else None)
    value = (1 - share) if share is not None else None
    return _sub(value, timed + len(idle_rows), {
        # Lower bound: each row is one fired watchdog (≥150s of silence), not a
        # measured stretch — honest about what the signal can claim.
        "idle_episodes": len(idle_rows),
        "idle_seconds_min": round(idle_seconds),
        "lesson_seconds": round(lesson_seconds),
    })


def _rapid_guess_rate(events: list[dict]) -> dict[str, Any]:
    flagged = [e for e in _attempts(events) if isinstance(e.get("effortful"), bool)]
    n = len(flagged)
    rapid = len([e for e in flagged if e.get("effortful") is False])
    value = (1 - rapid / n) if n else None
    return _sub(value, n, {"answers": n, "rapid_guesses": rapid})


def _sustained_effort(events: list[dict], signals: list[dict]) -> dict[str, Any]:
    sessions = {e.get("session_id") for e in _attempts(events) if e.get("session_id")}
    n = len(sessions)
    firings = len([s for s in signals if s.get("kind") == "sustained_effort"])
    value = min(firings / n, 1.0) if n else None
    return _sub(value, n, {"work_sessions": n, "sustained_streaks": firings})


def _off_topic_chat(labels: list[dict]) -> dict[str, Any]:
    n = len(labels)
    off_topic = len([
        row for row in labels if (row.get("meta") or {}).get("label") == "off_topic"
    ])
    value = (1 - off_topic / n) if n else None
    return _sub(value, n, {"labeled_messages": n, "off_topic": off_topic})


# ------------------------------------------------------------------- composite


def _composite(subs: dict[str, dict], weights: dict[str, float]) -> dict[str, Any]:
    """Visible weighted mean, renormalized over the sub-scores that actually
    have evidence (tasks/attempts.py pattern). Missing keys land in coverage."""
    weighted = 0.0
    weight_total = 0.0
    evidence_units = 0
    missing: list[str] = []
    subscores = []
    for key, weight in weights.items():
        sub = subs[key]
        included = sub["value"] is not None and sub["n"] > 0
        if included:
            weighted += sub["value"] * weight
            weight_total += weight
            evidence_units += sub["n"]
        else:
            missing.append(key)
        subscores.append({
            "key": key,
            "weight": weight,
            "value": round(sub["value"] * 100) if sub["value"] is not None else None,
            "evidence": sub["evidence"],
        })
    confidence = min(evidence_units / EVIDENCE_FULL, 1.0)
    evidence_ok = weight_total > 0 and confidence >= MIN_CONF
    value = round(100 * weighted / weight_total) if evidence_ok else None
    return {
        "value": value,
        "confidence": round(confidence, 2),
        "evidenceOk": evidence_ok,
        "subscores": subscores,
        "coverage": {"missing": missing, "renormalized": bool(missing)},
        "_raw": (100 * weighted / weight_total) if weight_total else None,
    }


def _trend(current: dict[str, Any], prior: dict[str, Any]) -> dict[str, Any]:
    """Direction only when BOTH windows pass the evidence gate — no honest
    comparison, no arrow (the StatDelta contract)."""
    if not (current["evidenceOk"] and prior["evidenceOk"]):
        return {"direction": None, "deltaPoints": None}
    delta = (current["_raw"] or 0.0) - (prior["_raw"] or 0.0)
    if abs(delta) < TREND_DEAD_ZONE:
        direction = "flat"
    else:
        direction = "up" if delta > 0 else "down"
    return {"direction": direction, "deltaPoints": round(delta, 1)}


def _window(items: list[dict], key, start: str, end: str) -> list[dict]:
    return [item for item in items if start <= (key(item) or "") < end]


async def student_scores(learner_id: str, *, window_days: int = WINDOW_DAYS) -> dict[str, Any]:
    from app.agents.tutor_decision import recent_tutor_decisions
    from app.auth.repository import get_user_by_id
    from app.services import learner_activity, learner_signals
    from app.services.events import get_learner_events

    now = _now()
    current_start = (now - timedelta(days=window_days)).isoformat()
    prior_start = (now - timedelta(days=2 * window_days)).isoformat()
    now_iso = now.isoformat()

    events = await get_learner_events(learner_id, limit=MAX_EVENTS)
    activity = await learner_activity.rows(learner_id)
    decisions = await recent_tutor_decisions(learner_id)
    signals = await learner_signals.recent(learner_id, since=prior_start)
    labels = [s for s in signals if s.get("kind") == "question_quality"]
    try:
        user = await get_user_by_id(learner_id)
    except Exception:
        user = None

    # The newest-first slab may not reach 14 days back — say so, never pretend.
    truncated = bool(
        len(events) >= MAX_EVENTS and events and _stamp(events[-1]) > prior_start
    )

    def block(start: str, end: str) -> tuple[dict[str, Any], dict[str, Any]]:
        window_events = _window(events, _stamp, start, end)
        window_activity = _window(activity, lambda r: r.get("at"), start, end)
        window_decisions = _window(decisions, lambda d: d.get("at"), start, end)
        window_signals = _window(signals, lambda s: s.get("at"), start, end)
        window_labels = _window(labels, lambda s: s.get("at"), start, end)
        independence = _composite({
            "tried_before_asking": _tried_before_asking(window_events, window_activity),
            "question_quality": _question_quality(window_labels),
            "unassisted_success": _unassisted_success(window_events, window_activity),
            "persistence_vs_giving_up": _persistence(window_events),
            "recovery": _recovery(window_events, window_signals),
            "support_depth": _support_depth(window_decisions),
        }, INDEPENDENCE_WEIGHTS)
        concentration = _composite({
            "on_task_share": _on_task_share(),
            "idle_share": _idle_share(window_events, window_signals),
            "rapid_guess_rate": _rapid_guess_rate(window_events),
            "sustained_effort": _sustained_effort(window_events, window_signals),
            "off_topic_chat": _off_topic_chat(window_labels),
        }, CONCENTRATION_WEIGHTS)
        return independence, concentration

    independence, concentration = block(current_start, now_iso)
    prior_independence, prior_concentration = block(prior_start, current_start)
    independence["trend"] = _trend(independence, prior_independence)
    concentration["trend"] = _trend(concentration, prior_concentration)

    connected_minutes: Optional[int] = None
    last_login = (user or {}).get("last_login_at")
    if isinstance(last_login, str) and last_login:
        try:
            connected_minutes = max(
                0, round((now - datetime.fromisoformat(last_login)).total_seconds() / 60)
            )
        except ValueError:
            connected_minutes = None
    current_events = _window(events, _stamp, current_start, now_iso)
    concentration["sessionShape"] = {
        # The normaliser, never a weighted sub-score: long connection is
        # neither good nor bad — it is what the five signals are read against.
        "connectedMinutes": connected_minutes,
        "questionsAnswered": len(_attempts(current_events)),
    }

    for score in (independence, prior_independence, concentration, prior_concentration):
        score.pop("_raw", None)

    return {
        "independence": independence,
        "concentration": concentration,
        "windowDays": window_days,
        "windowTruncated": truncated,
    }
