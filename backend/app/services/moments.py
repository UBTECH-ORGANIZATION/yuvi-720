"""Teachable moments — the story of the class, not a log table (A11 #2).

A dashboard tells a teacher *what is true now*. It cannot tell them what
*changed*, and change is where teaching happens: "Ron recovered on linear
equations after three failed attempts — his first success in eight days" is a
sentence a teacher can act on before the lesson starts. A mastery percentage is
not.

**Derived on read, never written.** The detectors already run inside
`triggers.evaluate` to fire nudges, but transiently — nothing is persisted. Two
options existed: write a moment row from the trigger path, or recompute from the
events that are already stored. This module does the latter, deliberately:

  * `triggers.py` carries hard-won dedupe state and the plan explicitly warns
    against reaching into it. A new write there risks a real regression in the
    learner's experience to power a teacher panel.
  * Moments are a projection of evidence, so recomputing them is *correct by
    construction* — a moment can always be traced back to the events it came
    from, and a bug fix in a detector retroactively fixes the feed.
  * This is a "depth" panel, loaded on demand, not something on the hot path.

**Every moment carries its evidence** (MoE C4) and the feed is chronological,
never ranked (C5). Text is a locale key plus params — never a rendered sentence,
because the teacher can switch language at any time.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

# How far back a feed looks, and how many events are worth scanning per learner.
DEFAULT_WINDOW_DAYS = 14
EVENT_SCAN_LIMIT = 300

# A return after this long away is a comeback worth naming.
COMEBACK_GAP_DAYS = 5

KIND_RECOVERY = "recovery"
KIND_SUSTAINED_EFFORT = "sustained_effort"
KIND_FIRST_MASTERY = "first_mastery"
KIND_COMEBACK = "comeback"
KIND_MISCONCEPTION_RESOLVED = "misconception_resolved"
# Added because the feed was reporting small mechanical wins while the two
# things a teacher actually leans forward for had no row at all: a child who
# fought an objective for weeks and finally has it, and a child who said
# something to Yuvi that needs a person.
KIND_BREAKTHROUGH = "breakthrough"
KIND_WELLBEING_SHARED = "wellbeing_shared"
KIND_GOAL_DONE = "goal_done"

TEXT_KEYS = {
    KIND_RECOVERY: "tch.moment.recovery",
    KIND_SUSTAINED_EFFORT: "tch.moment.sustainedEffort",
    KIND_FIRST_MASTERY: "tch.moment.firstMastery",
    KIND_COMEBACK: "tch.moment.comeback",
    KIND_MISCONCEPTION_RESOLVED: "tch.moment.misconceptionResolved",
    KIND_BREAKTHROUGH: "tch.moment.breakthrough",
    KIND_WELLBEING_SHARED: "tch.moment.wellbeingShared",
    KIND_GOAL_DONE: "tch.moment.goalDone",
}

# How much a teacher would want to be told this, 0–100. Used to CHOOSE which
# moments survive the cut — never to order the feed, which stays chronological
# (C5). Without it the limit was a recency filter, so twenty "answered ten in a
# row" rows could bury the one child who is struggling to stay afloat.
BASE_WEIGHT = {
    KIND_WELLBEING_SHARED: 100,
    KIND_BREAKTHROUGH: 80,
    KIND_GOAL_DONE: 60,
    KIND_RECOVERY: 40,
    KIND_FIRST_MASTERY: 35,
    KIND_MISCONCEPTION_RESOLVED: 30,
    KIND_COMEBACK: 25,
    KIND_SUSTAINED_EFFORT: 10,
}

# Anything at or above this is rendered as a headline row by the client.
HEADLINE_WEIGHT = 60

# A struggle long enough that finishing it is news, not routine.
BREAKTHROUGH_MIN_FAILURES = 5

# One child cannot own the class feed. Their own profile shows everything.
MAX_PER_LEARNER = 2


def _parse(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _stamp(event: dict[str, Any]) -> Optional[datetime]:
    return _parse(event.get("occurred_at") or event.get("stored_at"))


def _label(objective_id: Optional[str], language: str) -> str:
    if not objective_id:
        return ""
    from app.services import kata_catalog
    return kata_catalog.localized_objective_title(objective_id, language) or objective_id


def _moment(kind: str, at: datetime, *, raw: dict[str, Any],
            objective_id: Optional[str] = None, label: str = "",
            params: Optional[dict[str, Any]] = None,
            boost: int = 0) -> dict[str, Any]:
    weight = min(100, BASE_WEIGHT.get(kind, 10) + max(0, boost))
    return {
        "kind": kind,
        "at": at.isoformat(),
        "objective_id": objective_id,
        "label": label,
        "text_key": TEXT_KEYS[kind],
        "params": {"label": label, **(params or {})},
        # C4: the datum behind the sentence, always openable.
        "evidence": {"raw": raw},
        "weight": weight,
        "headline": weight >= HEADLINE_WEIGHT,
    }


def _trim(moments: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    """Collapse repeats, keep what matters, hand back newest-first.

    Two passes. First a dedupe by (kind, objective): the same child recovering
    on the same objective four times in a week is one story told four times, and
    it was crowding out four other children. Then the cut is by weight rather
    than by recency, because "someone shared something heavy on Sunday" must
    outlive "someone answered ten in a row this morning". Display order goes
    back to chronological once the set is chosen.
    """
    best: dict[tuple[str, str], dict[str, Any]] = {}
    for moment in moments:
        key = (moment["kind"], str(moment.get("objective_id") or ""))
        current = best.get(key)
        if current is None or (moment["weight"], moment["at"]) > (current["weight"], current["at"]):
            best[key] = moment

    chosen = sorted(best.values(), key=lambda row: (row["weight"], row["at"]), reverse=True)[:limit]
    chosen.sort(key=lambda row: row["at"], reverse=True)
    return chosen


async def moments_for_learner(
    learner_id: str, *, language: str = "he", days: int = DEFAULT_WINDOW_DAYS,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Narrated changes for one learner, newest first."""
    from app.brain import detectors
    from app.brain.repository import get_brain
    from app.services import kata_catalog
    from app.services.events import get_learner_events

    await kata_catalog.ensure_loaded()
    events = await get_learner_events(learner_id, limit=EVENT_SCAN_LIMIT)
    if not events:
        return []

    now = datetime.now(timezone.utc)
    cutoff = now.timestamp() - days * 86400

    # Oldest first: recovery needs the events that came *before* each success.
    ordered = sorted(
        (event for event in events if _stamp(event)),
        key=lambda event: _stamp(event),  # type: ignore[arg-type]
    )

    moments: list[dict[str, Any]] = []
    by_objective: dict[str, list[dict[str, Any]]] = {}
    seen_success: set[str] = set()
    previous_stamp: Optional[datetime] = None

    for index, event in enumerate(ordered):
        at = _stamp(event)
        if at is None:
            continue
        objective_id = event.get("objective_id")
        history = by_objective.setdefault(str(objective_id), [])
        recent_window = at.timestamp() >= cutoff

        # ── comeback: a real gap in activity, then a return ──────────────────
        if previous_stamp is not None and recent_window:
            gap_days = (at - previous_stamp).days
            if gap_days >= COMEBACK_GAP_DAYS:
                moments.append(_moment(
                    KIND_COMEBACK, at,
                    raw={"days_away": gap_days, "threshold": COMEBACK_GAP_DAYS,
                         "last_event_at": previous_stamp.isoformat(),
                         "event_id": str(event.get("_id") or "")},
                    params={"days": gap_days},
                ))
        previous_stamp = at

        # ── recovery: success ending a run of effortful failures ────────────
        if recent_window and objective_id:
            # `detect_recovery` wants the objective's prior events newest first.
            prior = list(reversed(history))
            if detectors.detect_recovery(prior, event):
                fails = sum(
                    1 for item in prior
                    if (item.get("result") or {}).get("success") is False
                    and item.get("effortful") is not False
                )
                label = _label(objective_id, language)
                moments.append(_moment(
                    KIND_RECOVERY, at, objective_id=objective_id, label=label,
                    raw={"failures_before": fails,
                         "objective_id": objective_id,
                         "event_id": str(event.get("_id") or "")},
                    params={"failures": fails},
                    # A comeback after twenty failures is a bigger deal than one
                    # after three, and the feed should rank it that way.
                    boost=min(20, fails * 2),
                ))

            # ── first success on this objective ─────────────────────────────
            success = (event.get("result") or {}).get("success") is True
            if success and str(objective_id) not in seen_success:
                seen_success.add(str(objective_id))
                # Only interesting if they had actually tried and failed first.
                attempts = len(history)
                if attempts >= 2:
                    label = _label(objective_id, language)
                    moments.append(_moment(
                        KIND_FIRST_MASTERY, at, objective_id=objective_id, label=label,
                        raw={"attempts_before_first_success": attempts,
                             "objective_id": objective_id,
                             "event_id": str(event.get("_id") or "")},
                        params={"attempts": attempts},
                    ))
        elif (event.get("result") or {}).get("success") is True and objective_id:
            seen_success.add(str(objective_id))

        history.append(event)

    # ── sustained effort, per session ───────────────────────────────────────
    sessions: dict[str, list[dict[str, Any]]] = {}
    for event in ordered:
        session_id = event.get("session_id")
        if session_id:
            sessions.setdefault(str(session_id), []).append(event)
    for session_id, session_events in sessions.items():
        last = _stamp(session_events[-1])
        if last is None or last.timestamp() < cutoff:
            continue
        if detectors.detect_sustained_effort(session_events):
            effortful = [e for e in session_events if e.get("effortful") is not False]
            first_at, last_at = _stamp(session_events[0]), last
            minutes = int(((last_at - first_at).total_seconds() // 60)) if first_at else 0
            moments.append(_moment(
                KIND_SUSTAINED_EFFORT, last_at,
                raw={"answers": len(effortful), "minutes": minutes,
                     "session_id": session_id},
                params={"minutes": minutes, "answers": len(effortful)},
            ))

    brain = await get_brain(learner_id)

    # ── breakthrough: the long fight, finally won ───────────────────────────
    # The single row a teacher most wants and the old feed could not produce:
    # not "recovered in this session" but "this objective has been hard for
    # weeks, and it is now mastered". Read off the mastery entry, so the claim
    # is the brain's own record rather than a re-derivation.
    for key, entry in (brain.get("mastery") or {}).items():
        if not isinstance(entry, dict) or not entry.get("achieved"):
            continue
        failures = int(entry.get("failures") or 0)
        if failures < BREAKTHROUGH_MIN_FAILURES:
            continue
        at = _parse(entry.get("achieved_at") or entry.get("updated_at") or entry.get("last_seen"))
        if at is None or at.timestamp() < cutoff:
            continue
        objective_id = entry.get("objective_id") or key.replace("·", ".")
        moments.append(_moment(
            KIND_BREAKTHROUGH, at, objective_id=objective_id,
            label=_label(objective_id, language),
            raw={"failures": failures, "attempts": entry.get("attempts"),
                 "successes": entry.get("successes"), "level": entry.get("level"),
                 "objective_id": objective_id},
            params={"failures": failures},
            boost=min(20, failures),
        ))

    # ── something a child said that needs a person ──────────────────────────
    # The narrow, deliberate exception to "the teacher does not read the kid's
    # chat": the flagged evidence only, never the transcript around it. Same
    # datum the attention inbox already shows — here it is in the story, dated.
    for flag in (brain.get("wellbeing_flags") or []):
        if not isinstance(flag, dict) or flag.get("category") == "review":
            continue
        at = _parse(flag.get("at"))
        if at is None or at.timestamp() < cutoff:
            continue
        moments.append(_moment(
            KIND_WELLBEING_SHARED, at,
            raw={"evidence": flag.get("evidence"), "source": flag.get("source"),
                 "category": flag.get("category") or "distress",
                 "resolved": bool(flag.get("resolved"))},
            params={},
            # An unresolved flag outranks one a teacher has already handled.
            boost=0 if flag.get("resolved") else 10,
        ))

    # ── a goal the learner carried to the end ───────────────────────────────
    for goal in (brain.get("goals") or []):
        if not isinstance(goal, dict):
            continue
        if goal.get("progress_stage") != "summarized" and goal.get("status") != "done":
            continue
        at = _parse(goal.get("summarized_at") or goal.get("updated_at") or goal.get("deadline"))
        if at is None or at.timestamp() < cutoff:
            continue
        moments.append(_moment(
            KIND_GOAL_DONE, at,
            raw={"goal_id": goal.get("id"), "source": goal.get("source"),
                 "approved_by": goal.get("approved_by")},
            params={"title": goal.get("title") or ""},
            # A goal the teacher set and the child finished is worth a mention
            # above one they set themselves — it closes a loop the teacher opened.
            boost=10 if goal.get("source") == "teacher" else 0,
        ))

    # ── misconceptions the brain records as resolved ────────────────────────
    for key, entry in (brain.get("mastery") or {}).items():
        if not isinstance(entry, dict):
            continue
        for misconception in (entry.get("misconceptions") or []):
            if not isinstance(misconception, dict) or not misconception.get("resolved"):
                continue
            at = _parse(misconception.get("resolved_at"))
            if at is None or at.timestamp() < cutoff:
                continue
            objective_id = entry.get("objective_id") or key.replace("·", ".")
            moments.append(_moment(
                KIND_MISCONCEPTION_RESOLVED, at,
                objective_id=objective_id, label=_label(objective_id, language),
                raw={"tag": misconception.get("tag"), "objective_id": objective_id,
                     "resolved_at": misconception.get("resolved_at")},
                params={"tag": misconception.get("tag") or ""},
            ))

    return _trim(moments, limit)


async def moments_for_group(
    group_id: str, *, language: str = "he", days: int = DEFAULT_WINDOW_DAYS,
    limit: int = 25,
) -> list[dict[str, Any]]:
    """The class's story: every learner's moments, merged newest first.

    Chronological, never ranked — this is a feed of what happened, not a
    league table of who is doing best (C5). Each row names one child and
    describes only that child.
    """
    import asyncio

    from app.brain import org

    learner_ids = await org.learners_in_group(group_id)
    if not learner_ids:
        return []

    # Bounded fan-out: the group snapshot already taught us that one round-trip
    # per learner, serialized, is what makes a 30-student page feel broken.
    semaphore = asyncio.Semaphore(6)

    async def one(learner_id: str) -> list[dict[str, Any]]:
        async with semaphore:
            try:
                rows = await moments_for_learner(
                    learner_id, language=language, days=days, limit=limit)
            except Exception as exc:      # one learner's bad data is not the feed's problem
                print(f"⚠️ moments failed for {learner_id}: {type(exc).__name__}")
                return []
        # Their best two. One very active child used to fill the entire class
        # feed with their own week while eleven others went unmentioned; the
        # rest of their story is one click away on their profile.
        rows = sorted(rows, key=lambda row: (row["weight"], row["at"]), reverse=True)[:MAX_PER_LEARNER]
        for row in rows:
            row["learner_id"] = learner_id
        return rows

    gathered = await asyncio.gather(*(one(learner_id) for learner_id in learner_ids))
    merged = [row for rows in gathered for row in rows]
    # Weight decides who makes the page; time decides the order they read in.
    merged.sort(key=lambda moment: (moment["weight"], moment["at"]), reverse=True)
    merged = merged[:limit]
    merged.sort(key=lambda moment: moment["at"], reverse=True)
    return merged
