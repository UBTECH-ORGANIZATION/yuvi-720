"""Group-level learning analytics — the class picture per learning (F6).

A "learning" here is one Kata component: the lesson a learner launches, answers
questions in, and completes. Nothing new is collected — the rows aggregate what
:mod:`learner_activity.question_summary` already derives per learner (attempts,
correct, wall-clock seconds, hints, explanations, chat turns) across everyone in
the group.

**The catalogue is the spine, not the activity.** The listing starts from every
component Kata publishes and left-joins what the class did, so a lesson nobody
has opened still has a row that says so. A teacher planning next week needs to
find material by name, and a screen that can only show what was already done
cannot answer "what haven't they done yet".

Honesty rules, carried over from ``group_analytics``:

* Timing is wall-clock between events, not focused-attention time. When no
  learner produced timing evidence the aggregate says so (``timing_available:
  False``) instead of showing a confident 0.
* Counts only, never a per-student ranking (MoE C5). Learner ids never appear
  in the output — ``struggling_count`` is a number, and the per-question rows
  carry how many learners tried them, not who.
* Every "hard question" row IS its own evidence: the attempts/correct counters
  that put it there are the row.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any, Optional

# The MoE xAPI sub-content id: `…/item-id#q3` means question 3 of that screen.
_SUB_CONTENT_ID = re.compile(r"^q(\d+)$", re.IGNORECASE)

# A question is "hard" when the class kept getting it wrong with real evidence
# behind the claim — a single wrong answer is noise, not a signal.
HARD_QUESTION_MIN_ATTEMPTS = 4
HARD_QUESTION_MAX_SUCCESS = 0.6
HARD_QUESTIONS_PER_LEARNING = 3

# A learner "struggled" in a learning when they really worked at it and most
# attempts failed — same shape of threshold the gaps engine uses for mastery.
STRUGGLE_MIN_ATTEMPTS = 3
STRUGGLE_MAX_SUCCESS = 0.5

_FANOUT = 8


def _rate(correct: int, attempts: int) -> Optional[float]:
    if attempts <= 0:
        return None
    return round(correct / attempts, 3)


def _question_label(component_id: str, item_id: Optional[str],
                    question_id: Optional[str]) -> dict[str, Any]:
    """What this question IS, in the words the learner sees on screen.

    Without this a teacher reading "43% success" had no way to know which
    question failed — the row carried a raw provider id. The ordinal is the
    number the player's own navigation shows, the part index is the סעיף inside
    it, and the screen title is the content's own heading.
    """
    from app.services import kata_catalog

    ordinals = kata_catalog.question_item_ordinals(component_id)
    parts = kata_catalog.question_part_indexes(component_id)
    key = f"{item_id}|{question_id}"
    profile = kata_catalog.item_profile(component_id, item_id) if item_id else {}

    ordinal = ordinals.get(key) or ordinals.get(item_id or "")
    if ordinal is None and question_id:
        # The catalogue could not place this question — either the content has
        # moved on, or the events carry the MoE sub-content id (`…#q3`) rather
        # than a provider question id. In the second case the number IS the
        # content's own index for that screen, so it is a reading of the datum
        # rather than a guess. Anything else stays unlabelled.
        match = _SUB_CONTENT_ID.match(str(question_id))
        if match:
            ordinal = int(match.group(1))

    return {
        "ordinal": ordinal,
        "part": parts.get(key),
        "screen_title": profile.get("title") or "",
        "kind": profile.get("kind") or "",
    }


def _catalog_spine(language: str) -> dict[str, dict[str, Any]]:
    """Every publishable learning, keyed by component id, activity-free."""
    from app.services import kata_catalog

    spine: dict[str, dict[str, Any]] = {}
    for component in kata_catalog.all_components():
        component_id = component.get("id")
        if not component_id:
            continue
        unit_id = component.get("unit_id")
        unit = kata_catalog.get_unit(unit_id) if unit_id else None
        objective_id = component.get("objective_id")
        questions = component.get("questions_by_item") or {}
        spine[component_id] = {
            "component_id": component_id,
            "title": component.get("title") or component_id,
            "unit_id": unit_id,
            "unit_title": ((unit or {}).get("titles") or {}).get(language)
            or (unit or {}).get("title") or unit_id,
            "objective_id": objective_id,
            "objective_title": kata_catalog.localized_objective_title(objective_id, language)
            if objective_id else None,
            "subject": component.get("subject") or (unit or {}).get("subject"),
            "estimated_minutes": component.get("estimated_minutes"),
            "is_assessment": bool(component.get("is_assessment")),
            "order": component.get("order"),
            "screens_total": len(kata_catalog.item_profiles(component_id)),
            "questions_total": sum(len(rows or []) for rows in questions.values()),
        }
    return spine


def _blank_activity(group_size: int) -> dict[str, Any]:
    return {
        "learners_engaged": 0,
        "group_size": group_size,
        "attempts": 0,
        "correct": 0,
        "success_rate": None,
        "total_minutes": None,
        "avg_minutes_per_learner": None,
        "timing_available": False,
        "hints_used": 0,
        "explanations_used": 0,
        "chat_turns": 0,
        "struggling_count": 0,
        "last_activity_at": None,
        "hard_questions": [],
        "started": False,
    }


async def _per_learner_rows(
    learner_ids: list[str], subject: Optional[str]
) -> list[list[dict[str, Any]]]:
    from app.services import learner_activity

    semaphore = asyncio.Semaphore(_FANOUT)

    async def _rows(learner_id: str) -> list[dict[str, Any]]:
        async with semaphore:
            try:
                return await learner_activity.question_summary(learner_id, subject=subject)
            except Exception:
                return []

    return list(await asyncio.gather(*(_rows(learner_id) for learner_id in learner_ids)))


def _fold(per_learner: list[list[dict[str, Any]]]) -> dict[str, dict[str, Any]]:
    """Aggregate every learner's per-question rows into per-component buckets."""
    learnings: dict[str, dict[str, Any]] = {}
    for rows in per_learner:
        # Per-learner counters within one learning, folded once the learner's
        # rows are done — struggling is judged per learner, not per question.
        learner_in: dict[str, dict[str, int]] = {}
        for row in rows:
            component_id = row.get("component_id")
            if not component_id:
                continue
            agg = learnings.setdefault(component_id, {
                "objective_id": row.get("objective_id"),
                "subject": row.get("subject"),
                "learners": 0,
                "attempts": 0,
                "correct": 0,
                "time_seconds": 0.0,
                "timed_learners": 0,
                "hints_used": 0,
                "explanations_used": 0,
                "chat_turns": 0,
                "struggling_count": 0,
                "last_activity_at": None,
                "questions": {},
            })
            attempts = int(row.get("attempts") or 0)
            correct = int(row.get("correct") or 0)
            seconds = float(row.get("time_seconds") or 0)
            agg["attempts"] += attempts
            agg["correct"] += correct
            agg["time_seconds"] += seconds
            agg["hints_used"] += int(row.get("hints_used") or 0) + int(row.get("content_hints_used") or 0)
            agg["explanations_used"] += int(row.get("explanations_used") or 0)
            agg["chat_turns"] += int(row.get("chat_turns") or 0)

            last_at = row.get("last_at")
            if last_at and (agg["last_activity_at"] is None or last_at > agg["last_activity_at"]):
                agg["last_activity_at"] = last_at

            mine = learner_in.setdefault(component_id, {"attempts": 0, "correct": 0, "seconds": 0})
            mine["attempts"] += attempts
            mine["correct"] += correct
            mine["seconds"] += 1 if seconds > 0 else 0

            question_id = row.get("question_id") or row.get("item_id")
            if question_id and attempts:
                question = agg["questions"].setdefault(question_id, {
                    "question_id": question_id,
                    "item_id": row.get("item_id"),
                    "attempts": 0,
                    "correct": 0,
                    "time_seconds": 0.0,
                    "learners": 0,
                    "hints_used": 0,
                    "chat_turns": 0,
                })
                question["attempts"] += attempts
                question["correct"] += correct
                question["time_seconds"] += seconds
                question["learners"] += 1
                question["hints_used"] += int(row.get("hints_used") or 0) + int(row.get("content_hints_used") or 0)
                question["chat_turns"] += int(row.get("chat_turns") or 0)

        for component_id, mine in learner_in.items():
            agg = learnings[component_id]
            agg["learners"] += 1
            if mine["seconds"]:
                agg["timed_learners"] += 1
            rate = _rate(mine["correct"], mine["attempts"])
            if mine["attempts"] >= STRUGGLE_MIN_ATTEMPTS and rate is not None \
                    and rate < STRUGGLE_MAX_SUCCESS:
                agg["struggling_count"] += 1

    return learnings


def _question_rows(component_id: str, questions: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for question in questions.values():
        rate = _rate(question["correct"], question["attempts"])
        label = _question_label(component_id, question.get("item_id"), question["question_id"])
        rows.append({
            "question_id": question["question_id"],
            "item_id": question.get("item_id"),
            **label,
            "attempts": question["attempts"],
            "correct": question["correct"],
            "success_rate": rate,
            "avg_seconds": round(question["time_seconds"] / question["attempts"])
            if question["time_seconds"] else None,
            "learners": question["learners"],
            "hints_used": question.get("hints_used", 0),
            "chat_turns": question.get("chat_turns", 0),
        })
    rows.sort(key=lambda row: (row["ordinal"] or 999, row["part"] or 0))
    return rows


def _activity_view(component_id: str, agg: dict[str, Any], group_size: int) -> dict[str, Any]:
    timing_available = agg["timed_learners"] > 0
    hard = [
        row for row in _question_rows(component_id, agg["questions"])
        if row["attempts"] >= HARD_QUESTION_MIN_ATTEMPTS
        and row["success_rate"] is not None
        and row["success_rate"] <= HARD_QUESTION_MAX_SUCCESS
    ]
    hard.sort(key=lambda row: (row["success_rate"], -row["attempts"]))
    return {
        "learners_engaged": agg["learners"],
        "group_size": group_size,
        "attempts": agg["attempts"],
        "correct": agg["correct"],
        "success_rate": _rate(agg["correct"], agg["attempts"]),
        "total_minutes": round(agg["time_seconds"] / 60) if timing_available else None,
        "avg_minutes_per_learner": round(agg["time_seconds"] / 60 / agg["timed_learners"], 1)
        if timing_available else None,
        "timing_available": timing_available,
        "hints_used": agg["hints_used"],
        "explanations_used": agg["explanations_used"],
        "chat_turns": agg["chat_turns"],
        "struggling_count": agg["struggling_count"],
        "last_activity_at": agg["last_activity_at"],
        "hard_questions": hard[:HARD_QUESTIONS_PER_LEARNING],
        "started": agg["learners"] > 0,
    }


async def group_learnings(
    group_id: str,
    *,
    subject: Optional[str] = None,
    language: str = "he",
) -> dict[str, Any]:
    """Every learning in the catalogue, with what this class did in it."""
    from app.brain import org
    from app.services import kata_catalog

    try:
        await kata_catalog.ensure_loaded()
    except Exception:
        pass  # labels degrade to ids; the counters still stand

    learner_ids = await org.learners_in_group(group_id)
    group_size = len(learner_ids)

    spine = _catalog_spine(language)
    folded = _fold(await _per_learner_rows(learner_ids, subject))

    results: list[dict[str, Any]] = []
    for component_id, entry in spine.items():
        agg = folded.get(component_id)
        activity = _activity_view(component_id, agg, group_size) if agg \
            else _blank_activity(group_size)
        results.append({**entry, **activity, "evidence": {
            "struggle_threshold": STRUGGLE_MAX_SUCCESS,
            "struggle_min_attempts": STRUGGLE_MIN_ATTEMPTS,
            "hard_question_min_attempts": HARD_QUESTION_MIN_ATTEMPTS,
        }})

    # Anything the class touched that the catalogue no longer publishes still
    # deserves a row — the work happened, and hiding it would make the totals lie.
    for component_id, agg in folded.items():
        if component_id in spine:
            continue
        results.append({
            "component_id": component_id, "title": component_id,
            "unit_id": None, "unit_title": None,
            "objective_id": agg.get("objective_id"), "objective_title": None,
            "subject": agg.get("subject"), "estimated_minutes": None,
            "is_assessment": False, "order": None,
            "screens_total": 0, "questions_total": 0,
            **_activity_view(component_id, agg, group_size),
            "evidence": {},
        })

    if subject:
        results = [row for row in results if not row.get("subject") or row["subject"] == subject]

    # Most recently worked first, then the untouched in catalogue order — a
    # teacher looks for "what is live now" before "what exists".
    results.sort(key=lambda row: (
        row.get("last_activity_at") or "",
        -(row.get("order") or 0),
    ), reverse=True)

    started = [row for row in results if row["started"]]
    attempts_total = sum(row["attempts"] for row in started)
    correct_total = sum(row["correct"] for row in started)
    timed = [row for row in started if row["timing_available"]]
    return {
        "group_id": group_id,
        "subject": subject,
        "subjects": sorted({row["subject"] for row in results if row.get("subject")}),
        "learnings": results,
        "totals": {
            "learnings": len(started),
            "catalog_total": len(results),
            "attempts": attempts_total,
            "correct": correct_total,
            "success_rate": _rate(correct_total, attempts_total),
            "total_minutes": sum(row["total_minutes"] or 0 for row in timed) if timed else None,
            "timing_available": bool(timed),
            "active_learners": max((row["learners_engaged"] for row in started), default=0),
            "group_size": group_size,
        },
    }


async def learning_detail(
    group_id: str,
    component_id: str,
    *,
    language: str = "he",
) -> dict[str, Any]:
    """One learning, opened up: every question, every screen, class-wide.

    The listing answers "which lesson needs another pass"; this answers "what
    exactly went wrong inside it" — per question success, time and support use,
    plus the screens that ask nothing so the spine reads as the lesson does.
    """
    from app.brain import org
    from app.services import kata_catalog

    try:
        await kata_catalog.ensure_loaded()
    except Exception:
        pass

    learner_ids = await org.learners_in_group(group_id)
    group_size = len(learner_ids)

    spine = _catalog_spine(language).get(component_id)
    folded = _fold(await _per_learner_rows(learner_ids, None))
    agg = folded.get(component_id)

    activity = _activity_view(component_id, agg, group_size) if agg \
        else _blank_activity(group_size)
    questions = _question_rows(component_id, agg["questions"]) if agg else []

    # The screen spine, so a teacher sees the lesson's shape — including the
    # screens that only teach. A question row with no data is not a gap in the
    # report, it is a question the class has not reached.
    screens = []
    for profile in kata_catalog.item_profiles(component_id):
        item_id = profile.get("id")
        rows = [row for row in questions if row.get("item_id") == item_id]
        attempts = sum(row["attempts"] for row in rows)
        correct = sum(row["correct"] for row in rows)
        screens.append({
            "item_id": item_id,
            "title": profile.get("title") or "",
            "kind": kata_catalog.kind_for_row(profile),
            "question_count": profile.get("question_count") or 0,
            "attempts": attempts,
            "correct": correct,
            "success_rate": _rate(correct, attempts),
            "learners": max((row["learners"] for row in rows), default=0),
            "avg_seconds": round(
                sum((row["avg_seconds"] or 0) * row["attempts"] for row in rows) / attempts
            ) if attempts else None,
        })

    return {
        "group_id": group_id,
        "learning": {**(spine or {"component_id": component_id, "title": component_id}), **activity},
        "questions": questions,
        "screens": screens,
    }
