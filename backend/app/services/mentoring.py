"""Mentoring conversations (F5) — §5.3. Teacher and learner document in-person
goal-setting talks. Required fields: date, teacher, learner, meeting stage,
notes, next steps, deadline. Visibility is controlled; teacher-only notes are
hidden from the learner. Learner-visible goals mirror into `brain.goals` (F4).
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from app.brain.repository import _get_collection_named, apply_brain_updates, get_brain
from app.services import goal_progress, rewards
from learner_state import normalize_learner_id  # type: ignore

_FALLBACK = Path(__file__).resolve().parents[2] / ".runtime" / "mentoring.json"

REQUIRED_FIELDS = ("date", "teacher_name", "learner_name", "meeting_stage", "notes", "next_steps", "deadline")
PROGRESS_STAGES = {"chosen", "started", "progressed", "summarized"}


def _read_fallback() -> list[dict[str, Any]]:
    try:
        return json.loads(_FALLBACK.read_text(encoding="utf-8")) if _FALLBACK.exists() else []
    except (OSError, json.JSONDecodeError):
        return []


def _write_fallback(rows: list[dict[str, Any]]) -> None:
    try:
        _FALLBACK.parent.mkdir(parents=True, exist_ok=True)
        _FALLBACK.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as exc:
        print(f"⚠️ mentoring fallback write failed: {exc}")


# How many legacy goals we let one listing request price (see _backfill_goal_prices).
_PRICE_BACKFILL_LIMIT = 6


def _new_goal(data: dict[str, Any]) -> dict[str, Any]:
    """Build one goal object from client/legacy input."""
    stage = data.get("progress_stage", "chosen")
    if stage not in PROGRESS_STAGES:
        stage = "chosen"
    return {
        "id": data.get("id") or f"goal_{uuid.uuid4().hex[:10]}",
        "title": (data.get("title") or data.get("goal_title") or "").strip(),
        "next_steps": (data.get("next_steps") or "").strip(),
        "deadline": data.get("deadline", ""),
        # The observable platform action this goal asks for ({kind, target}),
        # validated to the closed vocabulary — None for hand-written goals.
        # This is what lets the teacher screen show "did it actually happen".
        "action": goal_progress.normalize_action(data.get("action")),
        "progress_stage": stage,
        "status": "done" if stage == "summarized" else "open",
        "from_yuvi": bool(data.get("from_yuvi")),
        "needs_help": bool(data.get("needs_help")),
        "help_requested_at": data.get("help_requested_at"),
        # What this goal is worth in sparks. Set by Yuvi at creation and never
        # accepted from the client, so the reward cannot be self-assigned.
        "reward_value": rewards.clamp_goal_value(data.get("reward_value")),
        "reward_why": (data.get("reward_why") or "").strip(),
        # Teacher approval (F6 → F5). Present from creation so every consumer can
        # read them without an existence check; `None` means "not yet approved",
        # which is different from "approved by nobody".
        "approved_by": data.get("approved_by"),
        "approved_at": data.get("approved_at"),
        "teacher_note": (data.get("teacher_note") or "").strip(),
        "deleted": False,
    }


def _ensure_goals(record: dict[str, Any]) -> dict[str, Any]:
    """Normalize a stored conversation to the goals[] model (legacy migration).

    Older records flattened a single goal onto the conversation itself
    (`goal_title`/`next_steps`/`deadline`/`progress_stage`). Read them back as a
    one-item `goals` list keyed by the conversation id so existing brain
    projections stay stable.
    """
    if isinstance(record.get("goals"), list):
        return record
    legacy_title = (record.get("goal_title") or record.get("next_steps") or "").strip()
    record["goals"] = (
        [_new_goal({
            "id": record.get("id"),
            "title": legacy_title,
            "next_steps": record.get("next_steps", ""),
            "deadline": record.get("deadline", ""),
            "progress_stage": record.get("progress_stage", "chosen"),
        })]
        if legacy_title else []
    )
    return record


def _active_goals(record: dict[str, Any]) -> list[dict[str, Any]]:
    return [g for g in (record.get("goals") or []) if not g.get("deleted")]


def _visibility(data: dict[str, Any]) -> str:
    """Resolve visibility from whichever way the caller expressed it.

    Callers arrived with two vocabularies — `visibility: "shared"|"teacher_only"`
    and a boolean `visible_to_learner` — and only the first was ever read, so a
    caller passing the boolean got `shared` by falling through to the default
    rather than by being understood. Both are accepted now, and only
    `visibility` is stored: two fields meaning the same thing is one of them
    eventually being wrong.
    """
    explicit = data.get("visibility")
    if explicit in ("shared", "teacher_only"):
        return explicit
    if "visible_to_learner" in data:
        return "shared" if data["visible_to_learner"] else "teacher_only"
    return "shared"


def _brain_goal_entry(conversation: dict[str, Any], goal: dict[str, Any]) -> dict[str, Any]:
    """Shape one goal for the F4 `brain.goals` learner-visible mirror."""
    stage = goal.get("progress_stage", "chosen")
    return {
        "id": goal.get("id"),
        "conversation_id": conversation.get("id"),
        "text": goal.get("title") or goal.get("next_steps") or "",
        "next_steps": goal.get("next_steps", ""),
        "deadline": goal.get("deadline", ""),
        "source": "mentoring",
        "status": "done" if stage == "summarized" else "open",
        "progress_stage": stage,
        "from_yuvi": bool(goal.get("from_yuvi")),
        "needs_help": bool(goal.get("needs_help")),
        # Carried into the dashboard so the goal's spark worth is visible
        # wherever the goal itself is.
        "reward_value": goal.get("reward_value"),
        # Surfaced on the student dashboard so an approved goal reads as approved
        # there too, not only in the teacher's view.
        "approved_by": goal.get("approved_by"),
        "approved_at": goal.get("approved_at"),
        "assigned_by_teacher": conversation.get("author") == "teacher",
        "visible_to_learner": conversation.get("visibility", "shared") == "shared",
    }


async def _raw_conversations(lid: str) -> list[dict[str, Any]]:
    """All non-deleted conversations for a learner (Mongo or fallback)."""
    collection = _get_collection_named("mentoring_conversations")
    if collection is not None:
        try:
            rows = [r async for r in collection.find({"learner_id": lid, "deleted": {"$ne": True}})]
            for r in rows:
                r.pop("_id", None)
            return rows
        except Exception as exc:
            print(f"⚠️ mentoring read failed, using fallback: {exc}")
    return [r for r in _read_fallback() if r.get("learner_id") == lid and not r.get("deleted")]


async def _load_conversation(lid: str, conversation_id: str) -> Optional[dict[str, Any]]:
    collection = _get_collection_named("mentoring_conversations")
    if collection is not None:
        try:
            record = await collection.find_one({"id": conversation_id, "learner_id": lid})
            if record is not None:
                record.pop("_id", None)
            return record
        except Exception as exc:
            print(f"⚠️ mentoring read failed, using fallback: {exc}")
    return next(
        (r for r in _read_fallback() if r.get("id") == conversation_id and r.get("learner_id") == lid),
        None,
    )


# What a re-save is allowed to write back. An allow-list, so a field read into
# a record and mutated cannot be quietly dropped on the way out — this used to
# be four literal keys, and anything else edited on a loaded conversation was
# discarded on save with no error. Key-presence guarded at the call site, so a
# legacy record missing `notes` is never overwritten with null.
_PERSISTED_FIELDS = (
    "goals", "deleted", "deleted_at",
    "notes", "teacher_only_note", "meeting_stage",
    "visibility", "teacher_id", "source",
)


async def _save_conversation(lid: str, record: dict[str, Any]) -> None:
    """Persist a mutated conversation (goals / soft-delete flags / notes)."""
    updated_at = datetime.now(timezone.utc).isoformat()
    collection = _get_collection_named("mentoring_conversations")
    if collection is not None:
        try:
            changes = {
                field: record[field] for field in _PERSISTED_FIELDS if field in record
            }
            changes.setdefault("goals", record.get("goals", []))
            changes.setdefault("deleted", record.get("deleted", False))
            changes["updated_at"] = updated_at
            await collection.update_one(
                {"id": record["id"], "learner_id": lid},
                {"$set": changes},
            )
            return
        except Exception as exc:
            print(f"⚠️ mentoring write failed, using fallback: {exc}")
    rows = _read_fallback()
    for index, row in enumerate(rows):
        if row.get("id") == record["id"] and row.get("learner_id") == lid:
            rows[index] = record
            _write_fallback(rows)
            return


#: How many mentoring-sourced goals `brain.goals` carries. The bound is on
#: THIS source alone, which is the whole point of it: the mirror used to be
#: `(preserved + mentoring)[-24:]`, and a slice drops from the front, where
#: `preserved` is. So a single conversation with four goals — routine now that
#: the composer exists, impossible when `assign_goal` wrote one at a time —
#: could evict four of the learner's own activeness goals from their brain.
#: Another source's data is never the right thing to spend on this one.
MENTORING_GOAL_SLOTS = 24


async def _project_goals(lid: str) -> None:
    """Rebuild only the mentoring slice of `brain.goals`, preserving other sources.

    `brain.goals` is shared with activeness self-goals (routes/brain.py), so we
    replace mentoring-sourced entries and keep everything else untouched.
    """
    conversations = await _raw_conversations(lid)
    mentoring_entries: list[dict[str, Any]] = []
    for conv in conversations:
        _ensure_goals(conv)
        if conv.get("visibility", "shared") != "shared":
            continue
        for goal in _active_goals(conv):
            if goal.get("title") or goal.get("next_steps"):
                mentoring_entries.append(_brain_goal_entry(conv, goal))
    brain = await get_brain(lid)
    preserved = [g for g in (brain.get("goals") or []) if g.get("source") != "mentoring"]
    # `_raw_conversations` reads in insertion order, so the tail is the newest
    # talks — the ones a teacher would expect to still be there.
    kept = mentoring_entries[-MENTORING_GOAL_SLOTS:]
    await apply_brain_updates(lid, {"goals": preserved + kept})


async def create_conversation(data: dict[str, Any]) -> dict[str, Any]:
    """Create a mentoring conversation with its goals list and mirror them (F5→F4).

    The conversation is the object of record (date, who, feeling, what was
    discussed); any goals agreed in the talk are a list, each with its own
    title / next step / deadline / progress.
    """
    learner_id = normalize_learner_id(data.get("learner_id"))
    goals_in = data.get("goals")
    if isinstance(goals_in, list) and goals_in:
        goals = [
            _new_goal(g) for g in goals_in
            if isinstance(g, dict) and (g.get("title") or g.get("goal_title") or g.get("next_steps"))
        ]
    elif data.get("goal_title") or data.get("next_steps"):
        goals = [_new_goal(data)]   # single-goal convenience / legacy body shape
    else:
        goals = []

    # Yuvi reads every new goal and decides what the learning behind it is worth.
    # Failures fall back to the default value inside `price_goal`, so a slow or
    # missing model never blocks documenting a conversation.
    language = data.get("language") or "he"
    for goal in goals:
        priced = await rewards.price_goal(
            learner_id,
            title=goal["title"],
            next_steps=goal["next_steps"],
            deadline=goal.get("deadline") or "",
            language=language,
        )
        goal["reward_value"] = priced["value"]
        goal["reward_why"] = priced["why"]

    record = {
        "id": f"ment_{uuid.uuid4().hex[:10]}",
        "learner_id": learner_id,
        "date": data.get("date") or datetime.now(timezone.utc).date().isoformat(),
        "teacher_name": data.get("teacher_name", ""),
        "learner_name": data.get("learner_name", ""),
        "meeting_stage": data.get("meeting_stage", ""),
        "notes": data.get("notes", ""),
        "author": data.get("author", "teacher"),          # teacher | learner
        "visibility": _visibility(data),                    # shared | teacher_only
        "teacher_only_note": data.get("teacher_only_note", ""),
        # Which teacher documented this. Was passed by `assign_goal` and
        # silently dropped here, so nothing recorded who set a child's goal and
        # the history rows had no one to attribute a talk to.
        "teacher_id": data.get("teacher_id") or None,
        "source": data.get("source") or (
            "teacher" if data.get("author", "teacher") == "teacher" else "learner"),
        # Idempotency key for the composer that produced this. A resubmitted
        # form finds its own record instead of writing a second one.
        "draft_id": data.get("draft_id") or None,
        "goals": goals,
        "deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    collection = _get_collection_named("mentoring_conversations")
    if collection is not None:
        try:
            await collection.insert_one(dict(record))
        except Exception as exc:
            print(f"⚠️ mentoring write failed, using fallback: {exc}")
            rows = _read_fallback(); rows.append(record); _write_fallback(rows)
    else:
        rows = _read_fallback(); rows.append(record); _write_fallback(rows)

    await _project_goals(learner_id)

    # Reported here, once, for every caller — the learner's own route, a
    # teacher assigning a goal, a teacher documenting a talk. Best-effort by
    # the façade's contract, but wrapped anyway: a conversation that was
    # written must not fail because a statement could not be sent.
    try:
        from app.services.lrs import reporter as lrs_reporter
        await lrs_reporter.report_mentoring_record(
            record, session_id=data.get("lrs_session_id"))
    except Exception as exc:  # pragma: no cover — reporting never breaks a write
        print(f"⚠️ mentoring LRS report failed for {record['id']}: {type(exc).__name__}")
    return record


async def update_goal_progress(
    learner_id: str, conversation_id: str, goal_id: str, progress_stage: str
) -> Optional[dict[str, Any]]:
    """Advance one goal's progress stage inside a conversation."""
    if progress_stage not in PROGRESS_STAGES:
        return None
    lid = normalize_learner_id(learner_id)
    record = await _load_conversation(lid, conversation_id)
    if record is None or record.get("deleted"):
        return None
    _ensure_goals(record)
    goal = next((g for g in record["goals"] if g.get("id") == goal_id and not g.get("deleted")), None)
    if goal is None:
        return None
    goal["progress_stage"] = progress_stage
    goal["status"] = "done" if progress_stage == "summarized" else "open"
    await _save_conversation(lid, record)
    await _project_goals(lid)
    # Sparks reward the *action* of moving a goal forward (F5 → F3 effort
    # encouragement). The amount is this goal's own price, split by stage, and
    # is idempotent per goal+stage, so re-saving pays nothing.
    reward = await rewards.grant_goal_stage(lid, goal_id, progress_stage, goal.get("reward_value"))
    record = dict(record)
    record.pop("teacher_only_note", None)
    record["goals"] = _active_goals(record)
    record["reward"] = reward
    return record


async def request_goal_help(
    learner_id: str, conversation_id: str, goal_id: str
) -> Optional[dict[str, Any]]:
    """Flag a goal as "the learner is struggling" so it can be escalated to the
    teacher later. Stored on the goal (and mirrored to the brain) for the future
    teacher view; the learner is not blamed.
    """
    lid = normalize_learner_id(learner_id)
    record = await _load_conversation(lid, conversation_id)
    if record is None or record.get("deleted"):
        return None
    _ensure_goals(record)
    goal = next((g for g in record["goals"] if g.get("id") == goal_id and not g.get("deleted")), None)
    if goal is None:
        return None
    goal["needs_help"] = True
    goal["help_requested_at"] = datetime.now(timezone.utc).isoformat()
    await _save_conversation(lid, record)
    await _project_goals(lid)
    # Asking for help is a self-regulation win, so it earns sparks (once).
    reward = await rewards.grant_help_request(lid, goal_id)
    record = dict(record)
    record.pop("teacher_only_note", None)
    record["goals"] = _active_goals(record)
    record["reward"] = reward
    return record


def _may_delete(record: dict[str, Any], *, actor: str, teacher_id: str) -> bool:
    """Whether this actor wrote the thing they are asking to remove."""
    author = record.get("author", "teacher")
    if actor == "learner":
        return author == "learner"
    if actor != "teacher" or author != "teacher":
        return False
    # Absent on records written before `teacher_id` was persisted — see the
    # docstring on `delete_conversation`.
    owner = record.get("teacher_id")
    return not owner or owner == teacher_id


async def delete_goal(learner_id: str, conversation_id: str, goal_id: str) -> str:
    """Soft-delete a single learner-authored goal. Returns deleted|not_found|forbidden."""
    lid = normalize_learner_id(learner_id)
    record = await _load_conversation(lid, conversation_id)
    if record is None or record.get("deleted"):
        return "not_found"
    if record.get("author") != "learner":
        return "forbidden"
    _ensure_goals(record)
    goal = next((g for g in record["goals"] if g.get("id") == goal_id and not g.get("deleted")), None)
    if goal is None:
        return "not_found"
    goal["deleted"] = True
    goal["deleted_at"] = datetime.now(timezone.utc).isoformat()
    await _save_conversation(lid, record)
    await _project_goals(lid)
    return "deleted"



async def delete_conversation(
    learner_id: str,
    conversation_id: str,
    *,
    actor: str = "learner",
    teacher_id: str = "",
) -> str:
    """Soft-delete a whole conversation (and all its goals).

    The record is retained in the DB (marked `deleted`, never removed); deleted
    rows are simply never listed again.

    **Each side may delete only what it wrote.** A learner deletes their own
    reflections and cannot touch a talk a teacher documented about them; a
    teacher deletes a talk they documented and cannot touch a child's own
    writing. The second half is new: teacher-documented records used to be
    undeletable by anyone, which was defensible while `assign_goal` was the
    only way to make one — it wrote a goal, not a paragraph about a child. Now
    that the composer files a write-up under a teacher's name, a talk recorded
    against the wrong student had no way back except a hand-written database
    update, which is what this call is instead of.

    A teacher may also delete a teacher-authored record that names no author at
    all: those predate storing `teacher_id`, and the alternative is that the
    oldest records in the system are permanently unremovable.

    Returns "deleted", "not_found", or "forbidden".
    """
    lid = normalize_learner_id(learner_id)
    record = await _load_conversation(lid, conversation_id)
    if record is None or record.get("deleted"):
        return "not_found"
    if not _may_delete(record, actor=actor, teacher_id=teacher_id):
        return "forbidden"
    record["deleted"] = True
    record["deleted_at"] = datetime.now(timezone.utc).isoformat()
    await _save_conversation(lid, record)
    await _project_goals(lid)
    return "deleted"


def _is_pending(goal: dict[str, Any]) -> bool:
    """A goal the learner has finished that nobody has signed off.

    The single definition of "waiting for you" in this product — the goals
    screen's inbox, the assistant's `list_pending_goal_approvals` and the nav
    badge all mean this and must not drift into three meanings.
    """
    return (not goal.get("deleted")
            and goal.get("progress_stage") == "summarized"
            and not goal.get("approved_by"))


async def count_pending_approvals(learner_ids: list[str]) -> int:
    """How many finished goals across these learners still need sign-off.

    ONE query for the whole roster, not one read per learner. This number is
    fetched by the teacher app bar, which is on screen everywhere — the
    per-learner version that `list_pending_goal_approvals` uses would put forty
    round trips behind every teacher's page load.
    """
    ids = [normalize_learner_id(entry) for entry in learner_ids if entry]
    if not ids:
        return 0

    collection = _get_collection_named("mentoring_conversations")
    if collection is not None:
        try:
            cursor = collection.find(
                {"learner_id": {"$in": ids}, "deleted": {"$ne": True}},
                {"goals": 1, "_id": 0},
            )
            # Counted in a plain loop on purpose. `sum(1 async for row in ...
            # for goal in ...)` builds an ASYNC generator, which `sum` cannot
            # consume — it raised `'async_generator' object is not iterable`
            # on every call, and the except below turned that into the JSON
            # fallback, which on a Mongo deployment holds nothing. So the app
            # bar's badge read zero for everybody, always, and looked exactly
            # like a class with nothing waiting.
            total = 0
            async for row in cursor:
                total += sum(
                    1 for goal in (row.get("goals") or []) if _is_pending(goal)
                )
            return total
        except Exception as exc:
            print(f"⚠️ pending approval count failed, using fallback: {exc}")

    wanted = set(ids)
    return sum(
        1 for row in _read_fallback()
        if row.get("learner_id") in wanted and not row.get("deleted")
        for goal in (row.get("goals") or []) if _is_pending(goal)
    )


async def _backfill_goal_prices(lid: str, rows: list[dict[str, Any]]) -> None:
    """Price goals created before Yuvi valued them, a few per request.

    Goals documented earlier have no `reward_value`, so the learner would see a
    goal with no worth. We price the newest unpriced ones on read, persist the
    result, and let the next load pick up the rest — bounded so a page load
    never fans out into dozens of model calls.
    """
    pending: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for row in rows:
        for goal in _active_goals(row):
            if not goal.get("reward_value"):
                pending.append((row, goal))
    if not pending:
        return
    for row, goal in pending[:_PRICE_BACKFILL_LIMIT]:
        priced = await rewards.price_goal(
            lid,
            title=goal.get("title", ""),
            next_steps=goal.get("next_steps", ""),
            deadline=goal.get("deadline") or "",
            language="he",
        )
        goal["reward_value"] = priced["value"]
        goal["reward_why"] = priced["why"]
        await _save_conversation(lid, row)
    await _project_goals(lid)


async def list_conversations(
    learner_id: str,
    viewer_role: str = "learner",
    *,
    price_backfill: bool = True,
) -> list[dict[str, Any]]:
    """List a learner's conversations, each with its active (non-deleted) goals.

    Soft-deleted conversations/goals are retained in the DB but never listed.
    Learners never see teacher-only notes.

    The default is the LEAST privileged view. It used to be "teacher", which
    made forgetting the argument leak the notes written about a child; every
    caller passes it explicitly, so the safe default costs nothing and means a
    future one has to ask for the privileged view on purpose.

    `price_backfill=False` skips the legacy pricing pass. It is bounded per
    learner, which is fine for one child's page — but callers that fan out
    across a class multiply it by the roster, and a single group read could
    spend hundreds of model calls to fill in a number nobody asked for. Those
    callers opt out; the next single-learner read still does the work.
    """
    lid = normalize_learner_id(learner_id)
    rows = await _raw_conversations(lid)
    rows.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    for row in rows:
        _ensure_goals(row)
    if price_backfill:
        await _backfill_goal_prices(lid, rows)
    result: list[dict[str, Any]] = []
    for row in rows:
        conversation = dict(row)
        conversation["goals"] = _active_goals(conversation)
        if viewer_role != "teacher":
            conversation.pop("teacher_only_note", None)
        result.append(conversation)
    return result


# --- Yuvi goal recommendations (F5) -----------------------------------------
# Stored for EVERY conversation the child documents, whether or not they take
# the suggestion, so the teacher side can later surface "Yuvi suggested…".

_REC_FALLBACK = Path(__file__).resolve().parents[2] / ".runtime" / "mentoring_goal_recs.json"
_REC_STATUSES = {"suggested", "accepted", "dismissed"}


def _read_rec_fallback() -> list[dict[str, Any]]:
    try:
        return json.loads(_REC_FALLBACK.read_text(encoding="utf-8")) if _REC_FALLBACK.exists() else []
    except (OSError, json.JSONDecodeError):
        return []


def _write_rec_fallback(rows: list[dict[str, Any]]) -> None:
    try:
        _REC_FALLBACK.parent.mkdir(parents=True, exist_ok=True)
        _REC_FALLBACK.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as exc:
        print(f"⚠️ goal-rec fallback write failed: {exc}")


async def save_goal_recommendation(learner_id: str, rec: dict[str, Any]) -> dict[str, Any]:
    """Persist one Yuvi goal recommendation (status ``suggested``) and return it."""
    lid = normalize_learner_id(learner_id)
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": f"grec_{uuid.uuid4().hex[:10]}",
        "learner_id": lid,
        "title": (rec.get("title") or "").strip(),
        "next_steps": (rec.get("next_steps") or "").strip(),
        "deadline": rec.get("deadline", ""),
        "rationale": (rec.get("rationale") or "").strip(),
        "feeling": (rec.get("feeling") or "").strip(),
        "source": "yuvi",
        "ai": bool(rec.get("ai")),
        "status": "suggested",
        "created_at": now,
        "updated_at": now,
    }
    collection = _get_collection_named("mentoring_goal_recommendations")
    if collection is not None:
        try:
            await collection.insert_one(dict(doc))
            doc.pop("_id", None)
            return doc
        except Exception as exc:
            print(f"⚠️ goal-rec write failed, using fallback: {exc}")
    rows = _read_rec_fallback()
    rows.append(doc)
    _write_rec_fallback(rows)
    return doc


async def update_recommendation_status(
    learner_id: str, rec_id: str, status: str
) -> Optional[dict[str, Any]]:
    """Mark a recommendation ``accepted`` or ``dismissed`` (kept either way)."""
    if status not in _REC_STATUSES:
        return None
    lid = normalize_learner_id(learner_id)
    now = datetime.now(timezone.utc).isoformat()
    collection = _get_collection_named("mentoring_goal_recommendations")
    if collection is not None:
        try:
            res = await collection.update_one(
                {"id": rec_id, "learner_id": lid},
                {"$set": {"status": status, "updated_at": now}},
            )
            return {"ok": True, "id": rec_id, "status": status} if res.matched_count else None
        except Exception as exc:
            print(f"⚠️ goal-rec status update failed, using fallback: {exc}")
    rows = _read_rec_fallback()
    hit = next((r for r in rows if r.get("id") == rec_id and r.get("learner_id") == lid), None)
    if hit is None:
        return None
    hit["status"] = status
    hit["updated_at"] = now
    _write_rec_fallback(rows)
    return {"ok": True, "id": rec_id, "status": status}
