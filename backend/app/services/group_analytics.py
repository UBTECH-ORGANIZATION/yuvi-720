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


def _window_stats(
    events: list[dict[str, Any]], start: datetime, end: datetime,
    subject: Optional[str] = None,
) -> dict[str, Any]:
    """One learner's activity inside `[start, end)`.

    Events arrive newest-first, so the first one inside the window is the
    window's last activity.

    With `subject`, only events tagged with that subject count. An event whose
    subject is unknown is EXCLUDED rather than kept: the teacher asked for one
    subject, and folding untagged work into the answer would quietly report
    more than they asked about.
    """
    from app.services.learning_timing import capped_elapsed

    seconds = 0.0
    days_seen: set[str] = set()
    # Where the seconds fell, not just how many there were. The daily minutes
    # series is built from this, and it cannot be derived after the fact: a
    # window total divided by its days would report the same flat line for a
    # learner who worked one long session and one who worked every day.
    seconds_by_day: dict[str, float] = {}
    count = 0
    last_at: Optional[str] = None
    for event in events:
        parsed = _parse(event.get("stored_at"))
        if parsed is None or parsed < start or parsed >= end:
            continue
        if subject and event.get("subject") != subject:
            continue
        count += 1
        if last_at is None:
            last_at = event.get("stored_at")
        day = parsed.date().isoformat()
        elapsed = capped_elapsed(event.get("timing"))
        if elapsed is not None:
            seconds += elapsed
            seconds_by_day[day] = seconds_by_day.get(day, 0.0) + elapsed
        days_seen.add(day)
    return {
        "events": count,
        "minutes": seconds / 60.0,
        "days_active": len(days_seen),
        # Which days, not just how many. The per-day series is built from this;
        # it used to be built from `last_at` alone, which counted each learner
        # once on their most recent day — see `engagement`.
        "days_seen": days_seen,
        "seconds_by_day": seconds_by_day,
        "last_at": last_at,
    }


def _aggregate(rows: list[dict[str, Any]], students_total: int) -> dict[str, Any]:
    """The group-level shape of one window. Counts and averages only — nothing
    here orders learners against each other (C5)."""
    active = [row for row in rows if row["events"] > 0]
    with_minutes = [row for row in active if row["minutes"] > 0]
    return {
        "students_total": students_total,
        "active_students": len(active),
        "active_pct": round(100 * len(active) / students_total) if students_total else 0,
        "avg_active_minutes": (
            round(sum(row["minutes"] for row in with_minutes) / len(with_minutes), 1)
            if with_minutes else None
        ),
        "timing_available": bool(with_minutes),
        "avg_days_active": (
            round(sum(row["days_active"] for row in active) / len(active), 1)
            if active else 0
        ),
    }


async def engagement(
    group_id: str, days: int = DEFAULT_WINDOW_DAYS, *, compare: bool = True,
    subject: Optional[str] = None,
) -> dict[str, Any]:
    """Engagement: share of active learners + average active minutes (F6 §1).

    "Active minutes" is measured from real inter-event timing, and events whose
    timing evidence is untrustworthy are excluded rather than guessed. When no
    usable timing exists the field is reported as `None` with
    `timing_available: False` — an honest gap beats a confident zero.

    With `compare`, the SAME window length immediately before this one is
    reported alongside as `previous`, so the dashboard can show a direction
    without asking twice. Both windows are read from one fetch per learner:
    the previous window is not a second round trip, it is a second filter over
    events already in hand.

    Windows are trailing, not calendar-anchored — `days` back from now, and the
    `days` before that. Both are therefore always the same length, so the
    comparison never measures a part-finished week against a whole one.
    """
    learner_ids = await learners_in_group(group_id)
    now = datetime.now(timezone.utc)
    current_start = now - timedelta(days=days)
    previous_start = now - timedelta(days=2 * days)

    # The read has to cover BOTH windows, so it scales with the span rather than
    # sitting at a flat 1000 — at a month's comparison that is 60 days of
    # evidence, and a busy learner would have had the older half truncated away,
    # which reads as "they stopped" rather than "we stopped looking".
    limit = max(1000, min(6000, days * 2 * 50))

    async def _for(learner_id: str) -> dict[str, Any]:
        events = await get_learner_events(learner_id, limit=limit)
        return {
            "learner_id": learner_id,
            **_window_stats(events, current_start, now, subject),
            "previous": _window_stats(events, previous_start, current_start, subject),
        }

    rows = await _gather(learner_ids, _for)

    # How many learners were active on each day of the window.
    #
    # This counted each learner ONCE, on the day of their most recent event
    # (`row["last_at"]`), so a child who worked every day appeared on one day
    # and the series summed to at most `active_students`. It was never rendered,
    # which is why the error survived: as a chart it would have drawn a
    # confident, wrong picture of the week. `days_seen` is every day the learner
    # actually produced something.
    per_day: dict[str, int] = {}
    today_key = now.date().isoformat()
    # Seconds and the head-count they came from, per day. The average has to be
    # taken over the learners who actually studied that day — dividing by the
    # whole class would turn a quiet Friday into a collapse in the average
    # rather than into what it is, fewer people present.
    seconds_day: dict[str, float] = {}
    counted_day: dict[str, int] = {}
    for index in range(days):
        day = (now - timedelta(days=index)).date().isoformat()
        per_day[day] = 0
        seconds_day[day] = 0.0
        counted_day[day] = 0
    for row in rows:
        for day in row["days_seen"]:
            if day in per_day:
                per_day[day] += 1
        for day, seconds in row["seconds_by_day"].items():
            if day in seconds_day and seconds > 0:
                seconds_day[day] += seconds
                counted_day[day] += 1

    payload = {
        "group_id": group_id,
        "window_days": days,
        # Echoed so a client can never show a narrowed figure under a heading
        # that says otherwise.
        "subject": subject,
        **_aggregate(rows, len(learner_ids)),
        # `partial` marks a bucket the window only half covers — today, which
        # is being lived through. Reported rather than dropped here, because
        # "how many worked today so far" is a real answer to a real question;
        # it is the SHAPE that must not include it. A series ending on a
        # half-finished day always dips at the right, and a teacher reads that
        # dip as the class falling off rather than as lunchtime.
        "per_day_active": [
            {"date": day, "active": count, "partial": day == today_key}
            for day, count in sorted(per_day.items())
        ],
        # Same shape and the same rule as the headline average, one day at a
        # time: minutes per learner who had usable timing that day, 0 when
        # nobody did. Reported even when `timing_available` is false, in which
        # case it is all zeros and the client draws nothing.
        "per_day_minutes": [
            {
                "date": day,
                "minutes": round(seconds_day[day] / 60.0 / counted_day[day], 1)
                if counted_day[day] else 0.0,
                "partial": day == today_key,
            }
            for day in sorted(seconds_day)
        ],
    }
    if compare:
        payload["previous"] = _aggregate(
            [row["previous"] for row in rows], len(learner_ids))
    return payload


Window = tuple[datetime, datetime]


def trailing_windows(days: int, now: Optional[datetime] = None) -> tuple[Window, Window]:
    """The current window and the one of equal length immediately before it.

    Trailing rather than calendar-anchored, so both halves are always the same
    length and a comparison is never a part-finished period measured against a
    whole one.
    """
    now = now or datetime.now(timezone.utc)
    current_start = now - timedelta(days=days)
    return (current_start, now), (now - timedelta(days=2 * days), current_start)


def _in_window(stamp: Any, window: Optional[Window]) -> bool:
    if window is None:
        return True
    parsed = _parse(stamp if isinstance(stamp, str) else None)
    return parsed is not None and window[0] <= parsed < window[1]


def _gaps_from_brains(
    learner_ids: list[str],
    brains: list[Any],
    *,
    subject: Optional[str],
    threshold: float,
    window: Optional[Window],
) -> list[dict[str, Any]]:
    """The gap computation itself, over brains already in hand.

    Split out from `learning_gaps` so the dashboard can read two windows from
    one fan-out: a teacher comparing this week to last week must not cost twice
    the roster.

    `window` restricts the evidence to objectives a learner actually WORKED ON
    in that span, by `last_evidence_at`. The mastery score itself stays the
    cumulative one — the brain keeps a single timestamp per objective, not a
    history — which is exact whenever a learner's last evidence falls inside the
    window (nothing has moved it since) and an approximation only for a learner
    who practised in both windows. Said plainly rather than hidden: this is the
    limit of what the stored shape supports.
    """
    from app.brain.mastery import entry_for
    from app.services import kata_catalog

    gaps: list[dict[str, Any]] = []
    for subject_id in kata_catalog.subjects():
        if subject and subject_id != subject:
            continue
        for objective in kata_catalog.objectives_for(subject_id):
            objective_id = objective.get("id")
            struggling, mastered, misconceptions = [], [], {}
            with_evidence = 0
            for learner_id, brain in zip(learner_ids, brains):
                entry = entry_for((brain or {}).get("mastery"), objective_id)
                if not entry or not entry.get("attempts"):
                    continue
                if not _in_window(entry.get("last_evidence_at"), window):
                    continue
                with_evidence += 1
                if entry.get("achieved"):
                    mastered.append(learner_id)
                elif (entry.get("score_ewma") or 0) < 0.6 or entry.get("needs_review"):
                    struggling.append(learner_id)
                for misconception in (entry.get("misconceptions") or []):
                    if not isinstance(misconception, dict) or misconception.get("resolved"):
                        continue
                    # A misconception carries its own `last_seen`, so a windowed
                    # read shows the ones the class actually hit in that span
                    # rather than every unresolved one ever recorded.
                    if not _in_window(misconception.get("last_seen"), window):
                        continue
                    tag = misconception.get("tag")
                    misconceptions[tag] = misconceptions.get(tag, 0) + 1

            if with_evidence < MIN_GROUP_EVIDENCE:
                continue
            struggle_share = len(struggling) / with_evidence
            mastery_share = len(mastered) / with_evidence
            if struggle_share < threshold and mastery_share < threshold:
                continue

            gaps.append({
                "objective_id": objective_id,
                "subject": subject_id,
                # The screen-facing accessor: empty rather than the dotted MOE key,
                # which is what reached the dashboard's gaps list. The clients
                # below already drop an empty label instead of printing it.
                "label": kata_catalog.objective_title(objective_id, "he") or "",
                "struggling_count": len(struggling),
                "mastered_count": len(mastered),
                "with_evidence": with_evidence,
                "group_size": len(learner_ids),
                "struggle_share": round(struggle_share, 2),
                "mastery_share": round(mastery_share, 2),
                "kind": "gap" if struggle_share >= threshold else "strength",
                # Present so the teacher can act on the sub-group (assign a
                # goal, split the class) and so the row can show WHO it is
                # about. Both lists arrive in roster order, unscored and
                # unnumbered — a set of names, never a ranking.
                "learner_ids": struggling,
                # The other half of a "split the class" move. A strength row's
                # sub-group is the children who mastered it, and without this
                # the only ids on the row belonged to the opposite group.
                "mastered_ids": mastered,
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


async def _roster_brains(group_id: str) -> tuple[list[str], list[Any]]:
    from app.services import kata_catalog

    await kata_catalog.ensure_loaded()
    learner_ids = await learners_in_group(group_id)
    if not learner_ids:
        return [], []
    return learner_ids, await _gather(learner_ids, get_brain)


async def learning_gaps(
    group_id: str,
    *,
    subject: Optional[str] = None,
    threshold: float = GAP_THRESHOLD,
    window_days: Optional[int] = None,
) -> list[dict[str, Any]]:
    """Objectives where a meaningful share of the group struggles — or excels.

    Nice-to-have §3. Counts only: `struggling`/`mastered` are numbers, never an
    ordered list of children.

    Without `window_days` this reads the whole history, which is what every
    caller outside the dashboard wants.
    """
    learner_ids, brains = await _roster_brains(group_id)
    if not learner_ids:
        return []
    window = trailing_windows(window_days)[0] if window_days else None
    return _gaps_from_brains(
        learner_ids, brains, subject=subject, threshold=threshold, window=window)


async def learning_gaps_compared(
    group_id: str,
    *,
    days: int,
    subject: Optional[str] = None,
    threshold: float = GAP_THRESHOLD,
) -> dict[str, list[dict[str, Any]]]:
    """This window's gaps and the previous window's, from one fan-out.

    The dashboard needs both to say what the class is stuck on now AND what it
    was stuck on before. Two `learning_gaps` calls would read every brain in the
    class twice for an answer that is one pass over the same data.
    """
    learner_ids, brains = await _roster_brains(group_id)
    if not learner_ids:
        return {"gaps": [], "previous": []}
    current, previous = trailing_windows(days)
    return {
        "gaps": _gaps_from_brains(
            learner_ids, brains, subject=subject, threshold=threshold, window=current),
        "previous": _gaps_from_brains(
            learner_ids, brains, subject=subject, threshold=threshold, window=previous),
    }


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


# ── the class's mood ─────────────────────────────────────────────────────────
# The daily check-in (#452) has been asking every child how the day feels and
# storing the answer per learner per school day. Nothing has ever read those
# answers at CLASS level — a teacher could see one child's strip on their
# profile and never the shape of the room.
#
# Reported as a distribution first, with the names behind each family one
# deliberate click deeper (ADO #505) — never as an alert. The check-in's rule
# (`checkin_flow`) stands: a feeling is a conversation opener, not an alarm.
# The click-through exists so the teacher can open that conversation with the
# right child, the same per-child feeling the live view already shows (#452);
# what C5 still forbids is a ranking, and a list of who said "hard" is kept
# unordered by anything that could read as one.

# Below this many answers the shape is noise, and a confident "68% feel good"
# built on two children is worse than saying nothing — the same evidence gate
# `engagement` applies to timing.
MIN_MOOD_ANSWERS = 3

# The dialog's notes tab is a read, not an archive — enough to hear the room,
# few enough to actually be read.
MAX_MOOD_NOTES = 60


def _mood_window(days: int, offset: int = 0) -> list[str]:
    """The school-date keys of one window, newest first.

    Day-granular by necessity: a check-in IS a day-shaped fact, so unlike the
    engagement windows — which are raw trailing hours — this counts whole
    school days back from today.
    """
    from app.services.school_calendar import today_school_date

    today = datetime.fromisoformat(today_school_date()).date()
    return [
        (today - timedelta(days=index + offset)).isoformat()
        for index in range(days)
    ]


def _mood_shape(
    rows: list[dict[str, Any]], keys: set[str], roster: int, *, names: bool = False,
) -> dict[str, Any]:
    """Counts by valence over one window, plus the share that read positive.

    With `names`, each family also carries the children behind it (#505) —
    one entry per child per family, their most recent answer in the window,
    so a teacher can open the conversation the number is asking for. The
    compare window stays aggregate: last period's names serve no conversation.
    """
    from app.services.checkin_flow import POSITIVE_VALENCES, VALENCES

    by_valence = {valence: 0 for valence in VALENCES}
    students: dict[str, dict[str, dict[str, Any]]] = {v: {} for v in VALENCES}
    answered_by: set[str] = set()
    skipped = 0
    for row in rows:
        if row.get("date") not in keys:
            continue
        valence = row.get("valence")
        if valence in by_valence:
            by_valence[valence] += 1
            answered_by.add(row["learner_id"])
            held = students[valence].get(row["learner_id"])
            if held is None or (row.get("date") or "") > (held.get("date") or ""):
                students[valence][row["learner_id"]] = {
                    "learner_id": row["learner_id"],
                    "date": row.get("date"),
                    "feeling": row.get("feeling"),
                }
        else:
            skipped += 1

    answers = sum(by_valence.values())
    positive = sum(by_valence[valence] for valence in POSITIVE_VALENCES)
    shape: dict[str, Any] = {}
    if names:
        shape["students"] = {
            valence: sorted(held.values(), key=lambda row: row["date"] or "",
                            reverse=True)
            for valence, held in students.items() if held
        }
    return {
        **shape,
        "students_total": roster,
        # Distinct children who said something, which is what the hint reports.
        # NOT the same as `answers`: one child over a month answers many times,
        # and "24 answers" from four children is not a class of twenty-four.
        "answered_students": len(answered_by),
        "answers": answers,
        "skipped": skipped,
        "by_valence": by_valence,
        # Share of ANSWERS, not of the class — the caller must say so, because
        # "68% feel good" reads as a fact about everyone otherwise.
        "positive_pct": round(100 * positive / answers) if answers else 0,
        # Below the gate the numbers above are still returned (they are true),
        # but the screen is told not to lead with a share built on nothing.
        "enough": answers >= MIN_MOOD_ANSWERS,
    }


async def class_mood(group_id: str, *, days: int, compare: bool = True) -> dict[str, Any]:
    """How the class has been feeling over a window, and over the one before.

    The current window carries the children behind each family (#505), so the
    click on "3 said hard" can land on the right conversations — the same
    per-child feeling the live view already shows (#452). The compare window
    stays aggregate, and nothing here orders children against each other (C5):
    a mood is the most personal thing the product holds, and it leaves as a
    conversation opener, never as a ranking or an alarm.
    """
    from app.services import checkin_flow

    learner_ids = await learners_in_group(group_id)
    if not learner_ids:
        return {"window_days": days, **_mood_shape([], set(), 0)}

    current = set(_mood_window(days))
    previous = set(_mood_window(days, offset=days))

    async def _for(learner_id: str) -> list[dict[str, Any]]:
        try:
            rows = await checkin_flow.history(
                learner_id, limit=2 * days + 2, with_text=True)
        except Exception:      # one child's bad row is not the class's problem
            return []
        return [{**row, "learner_id": learner_id} for row in rows]

    gathered = await _gather(learner_ids, _for)
    rows = [row for batch in gathered for row in batch]

    payload = {
        "window_days": days,
        **_mood_shape(rows, current, len(learner_ids), names=True),
        # The written words behind the numbers (#505) — current window only,
        # newest first, and only days a child actually wrote something. The
        # question rides along: a quote without what it answered is noise.
        "notes": sorted(
            (
                {
                    "learner_id": row["learner_id"],
                    "date": row.get("date"),
                    "valence": row.get("valence"),
                    "feeling": row.get("feeling"),
                    "question": (row.get("note") or {}).get("question"),
                    "text": (row.get("note") or {}).get("text"),
                }
                for row in rows
                if row.get("date") in current and (row.get("note") or {}).get("text")
            ),
            key=lambda note: note["date"] or "", reverse=True,
        )[:MAX_MOOD_NOTES],
    }
    if compare:
        payload["previous"] = _mood_shape(rows, previous, len(learner_ids))
    return payload
