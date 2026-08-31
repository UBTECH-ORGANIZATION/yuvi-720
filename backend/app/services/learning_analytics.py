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
* Counts remain the default (MoE C5) — ``struggling_count`` is a number, and
  the per-question rows carry how many learners tried them, not who. The ONE
  exception is ``difficulties[].learner_ids`` on the detail view: present so
  the teacher can act on the sub-group (build a task, split the class) and so
  the row can say WHO it is about. The list arrives in roster order, unscored
  and unnumbered — a set of names, never a ranking — the same sanctioned shape
  as ``group_analytics.learning_gaps.learner_ids``. Nothing model-facing and
  nothing on the listing carries ids.
* Every "hard question" row IS its own evidence: the attempts/correct counters
  that put it there are the row.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any, Iterable, Optional

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
                    question_id: Optional[str],
                    *,
                    topics: Optional[dict[str, Optional[str]]] = None,
                    texts: Optional[dict[str, Optional[str]]] = None) -> dict[str, Any]:
    """What this question IS, in the words the learner sees on screen.

    Without this a teacher reading "43% success" had no way to know which
    question failed — the row carried a raw provider id. The ordinal is the
    number the player's own navigation shows, the part index is the סעיף inside
    it, and the screen title is the content's own heading.

    ``topics``/``texts`` are optional maps keyed ``component|item|question``:
    the stored generated topic (#455) and the authored question text. Passed
    only on teacher detail paths — when absent the fields are simply not in
    the row, so nothing model-facing or learner-facing grows them by accident.
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

    label: dict[str, Any] = {
        "ordinal": ordinal,
        "part": parts.get(key),
        "screen_title": profile.get("title") or "",
        "kind": profile.get("kind") or "",
    }
    if topics is not None or texts is not None:
        full_key = f"{component_id}|{item_id}|{question_id}"
        label["topic"] = (topics or {}).get(full_key)
        label["question_text"] = (texts or {}).get(full_key)
    return label


def _objective_title(objective_id: Optional[str], language: str) -> Optional[str]:
    """The objective's localized title, or ``None`` — never the dotted key.

    Thin wrapper over `kata_catalog.objective_title`, kept because this module's
    tests pin the behaviour and because the name reads better at the call sites
    below. `localized_objective_title` falls back to the key itself, which is
    the right answer for a log line and the wrong one for a screen.
    """
    from app.services import kata_catalog

    return kata_catalog.objective_title(objective_id, language)


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
            # Through the accessor, not off the row: Kata ships
            # `titleTranslations: null` on every component, so the name here is
            # a single Hebrew string and the locale-specific one lives in the
            # translation store. Reading the row directly is what put a Hebrew
            # lesson name on an English screen.
            "title": kata_catalog.component_title(component_id, language) or component_id,
            "unit_id": unit_id,
            # No `or unit_id` tail: an untitled unit used to hand its raw id to
            # the screen as a section heading. `unit_id` travels in its own
            # field, so a client that wants it still has it — and a client that
            # wants a HEADING gets a null it can label instead of an id it
            # cannot read.
            "unit_title": kata_catalog.unit_title(unit_id, language),
            "objective_id": objective_id,
            "objective_title": _objective_title(objective_id, language),
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
) -> list[tuple[str, list[dict[str, Any]]]]:
    """Each learner's per-question rows, WITH the learner id kept beside them.

    The id used to be dropped at this gather boundary, which made "who found
    this hard" unanswerable downstream. Order follows ``learner_ids`` — the
    roster — so anything accumulated in iteration order is roster-ordered.
    """
    from app.services import learner_activity

    semaphore = asyncio.Semaphore(_FANOUT)

    async def _rows(learner_id: str) -> tuple[str, list[dict[str, Any]]]:
        async with semaphore:
            try:
                return learner_id, await learner_activity.question_summary(learner_id, subject=subject)
            except Exception:
                return learner_id, []

    return list(await asyncio.gather(*(_rows(learner_id) for learner_id in learner_ids)))


def _fold(per_learner: list[tuple[str, list[dict[str, Any]]]]) -> dict[str, dict[str, Any]]:
    """Aggregate every learner's per-question rows into per-component buckets."""
    learnings: dict[str, dict[str, Any]] = {}
    for learner_id, rows in per_learner:
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
                    # Private (popped before any public row): who tried this
                    # question and who ever solved it, in roster order — the
                    # difficulties card's "who" is tried − solved.
                    "_tried": [],
                    "_solved": [],
                })
                question["attempts"] += attempts
                question["correct"] += correct
                question["time_seconds"] += seconds
                question["learners"] += 1
                question["hints_used"] += int(row.get("hints_used") or 0) + int(row.get("content_hints_used") or 0)
                question["chat_turns"] += int(row.get("chat_turns") or 0)
                if learner_id not in question["_tried"]:
                    question["_tried"].append(learner_id)
                if correct > 0 and learner_id not in question["_solved"]:
                    question["_solved"].append(learner_id)

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


def _question_rows(
    component_id: str,
    questions: dict[str, dict[str, Any]],
    *,
    topics: Optional[dict[str, Optional[str]]] = None,
    texts: Optional[dict[str, Optional[str]]] = None,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for question in questions.values():
        rate = _rate(question["correct"], question["attempts"])
        label = _question_label(component_id, question.get("item_id"), question["question_id"],
                                topics=topics, texts=texts)
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


# The vendor opens every `informationToBot` with the same label. Repeated down
# a list of twenty items it is the widest column on the screen and says nothing
# — the panel is already headed "what each screen taught".
_TEACHES_PREFIXES = ("מטרת הפריט:", "מטרת הפעילות:", "Item goal:", "Purpose:")


def _teaches(raw: Optional[str]) -> Optional[str]:
    """The content's description of an item, without the boilerplate opener."""
    text = (raw or "").strip()
    for prefix in _TEACHES_PREFIXES:
        if text.startswith(prefix):
            text = text[len(prefix):].strip()
            break
    return text or None


def label_learner_rows(
    rows: list[dict[str, Any]], *, language: str = "he",
    topics: Optional[dict[str, Optional[str]]] = None,
    texts: Optional[dict[str, Optional[str]]] = None,
) -> list[dict[str, Any]]:
    """Attach what each per-question row IS, for a teacher reading one child.

    The rows come out of `learner_activity.question_summary` carrying provider
    ids and nothing else, and the profile printed them: `q1`, `q1`, `q1` — the
    same three characters for three different questions, because the content
    numbers questions WITHIN a screen — and `ENG.G7.FAMILY.GRAMMAR-01-04` for a
    screen the child only read. A teacher could see that something went badly
    and not what it was.

    Everything attached here is authored content read out of the catalogue:
    the learning's title, the objective it serves, the question number the
    LEARNER sees on screen (`_question_label`, the same resolver the class-wide
    learnings page uses, so both screens number the same question the same way),
    the screen's own heading, and `teaches` — the content's own
    `informationToBot` description of that item. None of it is inferred and none
    of it is generated; where the catalogue is silent the field is null and the
    client says so.
    """
    from app.services import kata_catalog

    titles: dict[str, dict[str, Any]] = {}
    labelled: list[dict[str, Any]] = []
    for row in rows:
        component_id = row.get("component_id") or ""
        if component_id not in titles:
            component = kata_catalog.get_component(component_id) or {}
            titles[component_id] = {
                # Empty rather than the id: the client owns the "untitled"
                # wording, and it already has one (Phase 5's `learningName`).
                "learning_title": kata_catalog.component_title(component_id, language) or "",
                "unit_title": kata_catalog.unit_title(component.get("unit_id"), language),
            }
        label = _question_label(component_id, row.get("item_id"), row.get("question_id"),
                                topics=topics, texts=texts)
        teaches = _teaches(kata_catalog.information_for_item(component_id, row.get("item_id")))
        labelled.append({
            **row,
            **titles[component_id],
            **label,
            "objective_title": _objective_title(row.get("objective_id"), language),
            # The content's own description of what this item is about. Long —
            # the client truncates — and the single most direct answer to "what
            # was this child actually working on".
            "teaches": teaches,
        })
    return labelled


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


def _subjects_of(rows: Iterable[dict[str, Any]]) -> list[str]:
    """The subjects a set of learning rows names, in a stable order.

    One definition, because two callers must agree exactly: the learnings screen
    lists these as its own filter, and the scope bar offers them portal-wide. A
    bar that offers a subject this set does not contain narrows a screen to
    nothing and gives the teacher no way to see why.
    """
    return sorted({row["subject"] for row in rows if row.get("subject")})


# The subject list is chrome: the scope bar reads it on every teacher page
# load, and it is folded from every learner's rows, so an uncached read would
# put the cost of opening the learnings screen behind opening any screen at all.
# What it answers changes about as often as the catalogue does — a class that
# starts a new subject sees it within the window.
_SUBJECTS_CACHE_TTL = 10 * 60
_subjects_cache: dict[tuple[str, str], tuple[float, list[str]]] = {}


async def class_subjects(group_id: str, *, language: str = "he") -> list[str]:
    """Every subject this class has material or history in.

    Deliberately per class and from observed rows rather than from the catalogue
    alone. ``kata_client.subject_from_objective`` collapses anything that is not
    SCI or MATH into ``other``, so the catalogue cannot name English — the only
    place a real subject beyond that trio surfaces is a component the class
    worked in that the catalogue no longer publishes, which is exactly what the
    fold below picks up and the spine does not.
    """
    import time

    from app.brain import org
    from app.services import kata_catalog

    key = (group_id, language)
    cached = _subjects_cache.get(key)
    if cached and cached[0] > time.monotonic():
        return list(cached[1])

    try:
        await kata_catalog.ensure_loaded()
    except Exception:
        pass  # the spine degrades to empty; the observed rows still stand

    spine = _catalog_spine(language)
    folded = _fold(await _per_learner_rows(await org.learners_in_group(group_id), None))
    subjects = _subjects_of([
        *spine.values(),
        *(agg for component_id, agg in folded.items() if component_id not in spine),
    ])
    _subjects_cache[key] = (time.monotonic() + _SUBJECTS_CACHE_TTL, subjects)
    return list(subjects)


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
        # The component is gone from the catalogue, but its OBJECTIVE usually is
        # not — and that title is the only human name such a row can ever have.
        # It used to be hard-coded `None`, which is why these rows reached the
        # teacher wearing their component id as a title.
        objective_id = agg.get("objective_id")
        results.append({
            "component_id": component_id, "title": component_id,
            "unit_id": None, "unit_title": None,
            "objective_id": objective_id,
            "objective_title": _objective_title(objective_id, language),
            "subject": agg.get("subject"), "estimated_minutes": None,
            "is_assessment": False, "order": None,
            "screens_total": 0, "questions_total": 0,
            **_activity_view(component_id, agg, group_size),
            "evidence": {},
        })

    # Read the offered subjects BEFORE narrowing to one of them. Computed after,
    # picking "math" left the list holding only "math" — the chips that had just
    # been used to filter erased every other way back out.
    subjects = _subjects_of(results)

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
        "subjects": subjects,
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


def question_texts(component_id: str) -> dict[str, Optional[str]]:
    """The authored question text per question, keyed ``component|item|question``.

    A deliberate, scoped projection of the server-only snapshots: the TEXT
    travels (truncated, for a teacher's tooltip), ``answers`` and
    ``correctAnswers`` never do — the same discipline as
    ``lrs/hierarchy._question_digest``. Teacher detail paths only.
    """
    from app.services import kata_catalog

    texts: dict[str, Optional[str]] = {}
    for profile in kata_catalog.item_profiles(component_id):
        item_id = profile.get("id")
        for question in kata_catalog.questions_for_item(component_id, item_id):
            question_id = question.get("questionId")
            if not question_id:
                continue
            text = str(question.get("questionText") or "").strip()
            texts[f"{component_id}|{item_id}|{question_id}"] = text[:300] or None
    return texts


async def learning_detail(
    group_id: str,
    component_id: str,
    *,
    language: str = "he",
) -> dict[str, Any]:
    """One learning, opened up: every question plus the difficulties, class-wide.

    The listing answers "which lesson needs another pass"; this answers "what
    exactly went wrong inside it and what to do next" — per question success,
    time and support use, and the ``difficulties`` rows: the hard questions,
    who tried them and never got them, and the evidence behind the claim.
    """
    from app.brain import org
    from app.services import kata_catalog, question_topics

    try:
        await kata_catalog.ensure_loaded()
    except Exception:
        pass

    learner_ids = await org.learners_in_group(group_id)
    group_size = len(learner_ids)

    spine = _catalog_spine(language).get(component_id)
    folded = _fold(await _per_learner_rows(learner_ids, None))
    agg = folded.get(component_id)

    texts = question_texts(component_id)
    topics = await question_topics.topics_for(component_id, language)

    activity = _activity_view(component_id, agg, group_size) if agg \
        else _blank_activity(group_size)
    questions = _question_rows(component_id, agg["questions"],
                               topics=topics, texts=texts) if agg else []

    # A key with no stored decision (even a stored null IS a decision) means
    # the topic generator has not seen this question — the client fires one
    # POST /topics and patches the rows from its answer.
    topics_pending = any(
        f"{component_id}|{row.get('item_id')}|{row.get('question_id')}" not in topics
        for row in questions
    )

    # The difficulties: the same hard-question judgement the listing already
    # makes, opened up with WHO — learners who attempted the question and never
    # answered it correctly (roster order; a selection, never a ranking).
    by_id = (agg or {}).get("questions", {})
    difficulties = []
    for row in questions:
        if row["attempts"] < HARD_QUESTION_MIN_ATTEMPTS:
            continue
        if row["success_rate"] is None or row["success_rate"] > HARD_QUESTION_MAX_SUCCESS:
            continue
        bucket = by_id.get(row["question_id"]) or {}
        tried = bucket.get("_tried") or []
        solved = set(bucket.get("_solved") or [])
        failed = [learner for learner in tried if learner not in solved]
        difficulties.append({
            **row,
            "learner_ids": failed,
            "evidence": {
                "hard_question_min_attempts": HARD_QUESTION_MIN_ATTEMPTS,
                "hard_question_max_success": HARD_QUESTION_MAX_SUCCESS,
                "tried_count": len(tried),
                "failed_count": len(failed),
            },
        })
    difficulties.sort(key=lambda row: (row["success_rate"], -row["attempts"]))
    difficulties = difficulties[:HARD_QUESTIONS_PER_LEARNING]

    # Off the catalogue, the objective is the only human name the row can carry —
    # the same fallback the listing builds, so the card and the page it opens
    # agree on what this learning is called.
    off_catalogue = {
        "component_id": component_id,
        "title": component_id,
        "unit_id": None,
        "unit_title": None,
        "objective_id": (agg or {}).get("objective_id"),
        "objective_title": _objective_title((agg or {}).get("objective_id"), language),
        "subject": (agg or {}).get("subject"),
    }
    return {
        "group_id": group_id,
        "learning": {**(spine or off_catalogue), **activity},
        "questions": questions,
        "difficulties": difficulties,
        "topics_pending": topics_pending,
    }


# Coach error-types worth telling a teacher about. `right-idea`/`no-attempt`/
# `unknown` describe the coach's bookkeeping, not a class pattern.
_DIAGNOSTIC_ERROR_TYPES = {"guess", "partial", "misinterpret", "careless"}
# Newest decisions per learner that count toward the tally — one stuck child
# looping all afternoon must not outvote the rest of the class.
_ERROR_TALLY_PER_LEARNER = 6


async def _error_type_tally(
    learner_ids: list[str], objective_id: str,
) -> list[tuple[str, int]]:
    """How the class gets this objective wrong, per the coach's own reads.

    Every tutor decision already carries a deterministic `error_type`
    (`tutor_decision.classify_error_type`) — this folds the newest few per
    learner, scoped to the objective, into class-level counts. Counts of
    DECISIONS, not children, said as such by the caller's copy.
    """
    from app.agents.tutor_decision import recent_tutor_decisions

    semaphore = asyncio.Semaphore(_FANOUT)

    async def _one(learner_id: str) -> list[dict[str, Any]]:
        async with semaphore:
            try:
                rows = await recent_tutor_decisions(learner_id, limit=60)
            except Exception:
                return []
        return [row for row in rows if row.get("objective_id") == objective_id]

    counts: dict[str, int] = {}
    for rows in await asyncio.gather(*(_one(lid) for lid in learner_ids)):
        for row in rows[:_ERROR_TALLY_PER_LEARNER]:
            error_type = row.get("error_type")
            if error_type in _DIAGNOSTIC_ERROR_TYPES:
                counts[error_type] = counts.get(error_type, 0) + 1
    return sorted(counts.items(), key=lambda item: -item[1])


# One diagnosis per (class, objective, language) per window: the fold fans out
# over the roster's events and decisions and the focus text costs a model call,
# while the underlying evidence moves at classroom speed. Same shape and TTL
# philosophy as `_subjects_cache`.
_DIAGNOSIS_CACHE_TTL = 10 * 60
_diagnosis_cache: dict[tuple[str, str, str], tuple[float, dict[str, Any]]] = {}


_FOCUS_PROMPT = (
    "You help a teacher plan what to do about one learning objective their "
    "class is stuck on. You get the objective's name, its learnings with "
    "success rates, the TOPIC DESCRIPTIONS of the specific questions the "
    "class fails (written by the content's authors), and the coach's tallied "
    "error kinds.\n"
    "Write ONE short paragraph (2-4 sentences) IN THE GIVEN LANGUAGE, spoken "
    "directly to the teacher. Open with what is actually hard for the class, "
    "in plain everyday words — name the concept from the topic descriptions, "
    "never a question number and never a topic that is not described. Then "
    "give one or two concrete moves for the next lesson (what to open with, "
    "what to practice, what to ask the students to explain). Warm and direct, "
    "no jargon, no student names, no numbers the input does not contain, no "
    "greetings, do not quote the answer values from the descriptions. "
    "Return JSON: {\"text\": \"...\"}."
)


async def _phrase_focus(
    payload: dict[str, Any], language: str,
) -> Optional[str]:
    """The diagnosis said as guidance — grounded phrasing, never new facts.

    The model only rewords what the fold already produced: the failing
    questions' own `informationToBot` topic descriptions plus the counters.
    Anything that fails — no descriptions, no endpoint, bad JSON — returns
    None and the client composes its deterministic sentences instead.
    """
    topics = [
        {
            "topic": question.get("teaches"),
            "success_pct": round((question.get("success_rate") or 0) * 100),
        }
        for question in payload["hard_questions"] if question.get("teaches")
    ]
    if not topics and not payload["parts"]:
        return None

    import json as _json

    from app.services.ai_usage import UsageContext
    from app.services.llm import call_llm

    try:
        raw = await asyncio.wait_for(call_llm(
            [
                {"role": "system", "content": _FOCUS_PROMPT},
                {"role": "user", "content": _json.dumps({
                    "language": language,
                    "objective": payload.get("objective_title"),
                    "parts": [
                        {
                            "title": part["title"],
                            "success_pct": round((part["success_rate"] or 0) * 100)
                            if part["success_rate"] is not None else None,
                            "struggling": part["struggling_count"],
                        }
                        for part in payload["parts"][:3]
                    ],
                    "hard_topics": topics,
                    "error_kinds": payload["error_types"],
                }, ensure_ascii=False)},
            ],
            usage_context=UsageContext(
                actor_id="system",
                actor_type="system",
                endpoint="/api/teacher/groups/gaps/diagnosis",
                feature="feature_6_teacher_insights",
                operation="teacher.gap_diagnosis_focus",
                source="learning_analytics",
            ),
            max_tokens=260,
            json_mode=True,
            model_tier="mini",
        ), timeout=8.0)
        text = str((_json.loads(raw or "{}") or {}).get("text") or "").strip()
        return text if 20 <= len(text) <= 600 else None
    except Exception as exc:
        print(f"⚠️ gap diagnosis focus phrasing failed: {type(exc).__name__}")
        return None


async def gap_diagnosis(
    group_id: str, objective_id: str, *, language: str = "he",
) -> dict[str, Any]:
    """A real answer to "למה?" on a class gap (#507).

    The gaps card's counters say HOW MANY are stuck; this says WHERE inside the
    objective (per learning, hardest first), on WHICH questions (the same
    hard-question rule the learnings screen uses, with the learner-facing
    labels and the content's own topic description of each), and HOW it goes
    wrong (the coach's own error-type reads). The folded rows are evidence;
    `focus_text` is the one generated field — a grounded rewording of those
    rows into what to focus on, absent whenever phrasing is unavailable.
    """
    import time as _time

    from app.brain import org
    from app.services import kata_catalog

    cache_key = (group_id, objective_id, language)
    cached = _diagnosis_cache.get(cache_key)
    if cached and cached[0] > _time.monotonic():
        return cached[1]

    try:
        await kata_catalog.ensure_loaded()
    except Exception:
        pass  # labels degrade; the counters still stand

    learner_ids = await org.learners_in_group(group_id)
    per_learner = await _per_learner_rows(learner_ids, None)
    folded = _fold(per_learner)

    parts: list[dict[str, Any]] = []
    hard: list[dict[str, Any]] = []
    for component_id, agg in folded.items():
        if agg.get("objective_id") != objective_id:
            continue
        parts.append({
            "component_id": component_id,
            "title": kata_catalog.component_title(component_id, language) or "",
            "attempts": agg["attempts"],
            "correct": agg["correct"],
            "success_rate": _rate(agg["correct"], agg["attempts"]),
            "learners": agg["learners"],
            "struggling_count": agg["struggling_count"],
        })
        for row in _question_rows(component_id, agg["questions"]):
            if row["attempts"] >= HARD_QUESTION_MIN_ATTEMPTS \
                    and row["success_rate"] is not None \
                    and row["success_rate"] <= HARD_QUESTION_MAX_SUCCESS:
                hard.append({
                    **row,
                    "component_id": component_id,
                    "learning_title":
                        kata_catalog.component_title(component_id, language) or "",
                    # The content's own description of what this question
                    # teaches (`informationToBot`) — the topic behind the
                    # number, and the ground the focus phrasing stands on.
                    "teaches": _teaches(kata_catalog.information_for_item(
                        component_id, row.get("item_id"))),
                })

    parts.sort(key=lambda part: (
        part["success_rate"] if part["success_rate"] is not None else 2.0,
        -part["attempts"],
    ))
    hard.sort(key=lambda row: (row["success_rate"], -row["attempts"]))

    # Only learners who actually met the objective feed the error tally — the
    # rest of the roster has no decisions to read and costs a fan-out anyway.
    tried = [
        learner_id for learner_id, rows in per_learner
        if any(row.get("objective_id") == objective_id
               and (row.get("attempts") or 0) for row in rows)
    ]
    payload = {
        "objective_id": objective_id,
        "objective_title": _objective_title(objective_id, language),
        "parts": parts,
        "hard_questions": hard[:HARD_QUESTIONS_PER_LEARNING],
        "error_types": await _error_type_tally(tried, objective_id),
    }
    payload["focus_text"] = await _phrase_focus(payload, language)
    _diagnosis_cache[cache_key] = (
        _time.monotonic() + _DIAGNOSIS_CACHE_TTL, payload)
    return payload
