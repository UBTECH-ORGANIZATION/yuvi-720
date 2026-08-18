"""Persistence for teacher-authored tasks — five collections, one rule each.

    teacher_tasks      _id = task_id                    what the teacher asked for
    task_content       _id = "{task_id}:{component}"    what Yuvi generated
    task_launches      _id = "{task_id}:{seq}"          one OPENING of the task
    task_activations   _id = "{launch_id}:{learner_id}" what ONE child was given
    task_attempts      _id = "{launch_id}:{learner_id}" what that child did

This is a **separate store**: a teacher-authored task is not a Kata objective,
and forcing it into that taxonomy would distort mastery, the coach and the LRS
report. Nothing here writes to `learning_events`.

## A task is opened, not sent

The unit that goes to children is a **launch**, not the task. A task is a piece
of material; opening it to 7א in September and to 7ב in March are two different
events with different rosters, different deadlines, and results that must never
be averaged together. So a launch is a row, and everything a child does hangs
off it rather than off the task.

That is also what makes a retake possible at all. Papers used to be keyed
`{task_id}:{learner_id}`, which gave every child exactly one copy of a task for
all time — so "send it again" could only ever mean "catch up whoever was
missing". Keyed by launch, a second opening is a second blank paper, and the
first one keeps its answers and its score.

## The activation snapshot, which is the whole reason this is five collections

An activation carries its own frozen copy of the content. A teacher who edits a
task after it has gone out does not change the paper under a child who is
halfway through it — and a class where half the children answered version 1 and
half answered version 2 is a class whose per-question breakdown means nothing.

So :func:`activate` **never overwrites an existing activation**. Re-running it
against the same launch (a retry, a late joiner, a duplicate click) tops up the
learners who have none and leaves every existing snapshot exactly as it was.
Re-running it against a NEW launch is the retake, and is a different act.

## The word "component"

Here it means a part of a task — presentation, practice, test, interactive. It
does **not** mean a Kata component, which is what `component_id` means
everywhere else in this codebase. The two never appear in the same document.

Mongo is the source of truth; a JSON fallback under `.runtime/tasks.json` keeps
a credential-less dev box working, the same arrangement as `org_repository`.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from app.brain.repository import _get_collection_named

TASKS = "teacher_tasks"
CONTENT = "task_content"
LAUNCHES = "task_launches"
ACTIVATIONS = "task_activations"
ATTEMPTS = "task_attempts"

_FALLBACK_FILE = Path(__file__).resolve().parents[3] / ".runtime" / "tasks.json"
_FALLBACK_KEYS = {
    TASKS: "tasks", CONTENT: "content", LAUNCHES: "launches",
    ACTIVATIONS: "activations", ATTEMPTS: "attempts",
}

#: The parts a task can be made of. One generation pass and one player screen each.
COMPONENTS = ("presentation", "practice", "test", "interactive")

#: draft → generating → ready → live → closed. `ready` means the content exists;
#: `live` means children have it. Only `live` and `closed` have launches.
#:
#: From `ready` onwards the status is DERIVED from the launches — see
#: :func:`derived_status`. It is still stored, because a great deal of code
#: reads `task["status"]` and a task with no launches has a status that no
#: launch could tell you, but the launches are the authority.
STATUSES = ("draft", "generating", "ready", "live", "closed")

#: Who a task is for. A sub-group resolves to learner ids at launch time and is
#: never trusted as a stored list — see `subgroups.members_of`.
TARGET_KINDS = ("learner", "subgroup", "group")

#: An opening is open, or it is not. Deliberately not the task's ladder: a task
#: is `live` while ANY of its openings is active.
LAUNCH_STATUSES = ("active", "closed")

ATTEMPT_STATUSES = ("in_progress", "submitted", "graded")

#: A ceiling on one launch, so a mis-targeted task cannot fan out unbounded.
MAX_ACTIVATIONS = 200

#: And a ceiling on openings, so a stuck client cannot mint them forever.
MAX_LAUNCHES = 50


class TaskStoreError(Exception):
    """A refusal the caller may see. The message is a stable code."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_task_id() -> str:
    return f"tsk-{uuid.uuid4().hex[:12]}"


def content_id(task_id: str, component: str) -> str:
    return f"{task_id}:{component}"


def launch_id(task_id: str, seq: int) -> str:
    """``tsk-abc:2`` — the second opening of that task.

    A composed id rather than a uuid, for two reasons: a paper's id then names
    the task it belongs to without a lookup, and the sequence a teacher sees
    ("פתיחה 2") is the id rather than a second number that could disagree
    with it.
    """
    return f"{task_id}:{int(seq)}"


def task_of_launch(launch: str) -> str:
    """The task a launch id belongs to. The composition, read backwards."""
    return str(launch).rsplit(":", 1)[0]


def activation_id(launch: str, learner_id: str) -> str:
    """``tsk-abc:2:dvir`` — one child's paper for one opening."""
    return f"{launch}:{learner_id}"


# ── JSON fallback ────────────────────────────────────────────────────────────

def _read_fallback() -> dict[str, list[dict[str, Any]]]:
    try:
        if _FALLBACK_FILE.exists():
            data = json.loads(_FALLBACK_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return {key: list(data.get(key) or []) for key in _FALLBACK_KEYS.values()}
    except (OSError, json.JSONDecodeError) as exc:
        print(f"⚠️ Failed reading tasks fallback: {exc}")
    return {key: [] for key in _FALLBACK_KEYS.values()}


def _write_fallback(data: dict[str, list[dict[str, Any]]]) -> None:
    try:
        _FALLBACK_FILE.parent.mkdir(parents=True, exist_ok=True)
        _FALLBACK_FILE.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except OSError as exc:
        print(f"⚠️ Failed writing tasks fallback: {exc}")


def _matches(row: dict[str, Any], query: dict[str, Any]) -> bool:
    for field, value in query.items():
        if isinstance(value, dict) and "$in" in value:
            if row.get(field) not in value["$in"]:
                return False
        elif row.get(field) != value:
            return False
    return True


# ── generic helpers ──────────────────────────────────────────────────────────

async def _find(collection: str, query: dict[str, Any]) -> list[dict[str, Any]]:
    handle = _get_collection_named(collection)
    if handle is not None:
        try:
            return await handle.find(query).to_list(length=5000)
        except Exception as exc:  # pragma: no cover - network/credential issues
            print(f"⚠️ task read failed on {collection}: {type(exc).__name__}")
    rows = _read_fallback().get(_FALLBACK_KEYS[collection], [])
    return [row for row in rows if _matches(row, query)]


async def _find_one(collection: str, document_id: str) -> Optional[dict[str, Any]]:
    handle = _get_collection_named(collection)
    if handle is not None:
        try:
            return await handle.find_one({"_id": document_id})
        except Exception as exc:  # pragma: no cover
            print(f"⚠️ task read failed on {collection}: {type(exc).__name__}")
    for row in _read_fallback().get(_FALLBACK_KEYS[collection], []):
        if row.get("_id") == document_id:
            return row
    return None


async def _upsert(collection: str, document: dict[str, Any]) -> dict[str, Any]:
    handle = _get_collection_named(collection)
    if handle is not None:
        try:
            await handle.update_one(
                {"_id": document["_id"]}, {"$set": document}, upsert=True
            )
            return document
        except Exception as exc:
            print(f"⚠️ task write failed on {collection}, using fallback: {exc}")
    data = _read_fallback()
    key = _FALLBACK_KEYS[collection]
    rows = data.get(key) or []
    for index, row in enumerate(rows):
        if row.get("_id") == document["_id"]:
            rows[index] = {**row, **document}
            data[key] = rows
            _write_fallback(data)
            return rows[index]
    rows.append(document)
    data[key] = rows
    _write_fallback(data)
    return document


async def _insert_if_absent(collection: str, document: dict[str, Any]) -> bool:
    """Create, or leave what is already there. Returns whether it created.

    `$setOnInsert` rather than `$set`: this is what makes activation freezing
    and attempt creation idempotent under a retry or a double click, without a
    read-then-write race in between.
    """
    handle = _get_collection_named(collection)
    if handle is not None:
        try:
            result = await handle.update_one(
                {"_id": document["_id"]}, {"$setOnInsert": document}, upsert=True
            )
            return bool(getattr(result, "upserted_id", None))
        except Exception as exc:
            print(f"⚠️ task insert failed on {collection}, using fallback: {exc}")
    data = _read_fallback()
    key = _FALLBACK_KEYS[collection]
    rows = data.get(key) or []
    if any(row.get("_id") == document["_id"] for row in rows):
        return False
    rows.append(document)
    data[key] = rows
    _write_fallback(data)
    return True


# ── teacher_tasks ────────────────────────────────────────────────────────────

async def create_task(
    *, teacher_id: str, group_id: str, target: Optional[dict[str, Any]] = None,
    spec: dict[str, Any], deadline: Optional[str] = None,
) -> dict[str, Any]:
    """Record what the teacher asked for. Who it goes to is not decided here.

    `target` is optional and is only a *default* for the launch dialog. Who
    receives a task is a decision made when it is sent — the same material goes
    to different children in different weeks, and freezing an audience at the
    moment of writing was what made a task feel like a one-shot document.
    """
    kind = str((target or {}).get("kind") or "")
    if target is not None:
        if kind not in TARGET_KINDS:
            raise TaskStoreError("bad_target")
        if not target.get("id"):
            raise TaskStoreError("bad_target")

    document = {
        "_id": new_task_id(),
        "teacher_id": teacher_id,
        "group_id": group_id,
        "target": {"kind": kind, "id": str(target["id"])} if target else None,
        "spec": spec or {},
        "status": "draft",
        # An append-only log of every generation pass: which component, whether
        # it worked, and why not. A teacher whose task is stuck deserves better
        # than a spinner, and a failed pass must stay visible after a retry.
        "generation": [],
        "deadline": deadline,
        "created_at": _now(),
        "updated_at": _now(),
    }
    return await _upsert(TASKS, document)


async def get_task(task_id: str) -> Optional[dict[str, Any]]:
    return await _find_one(TASKS, task_id)


async def list_tasks(
    *, teacher_id: Optional[str] = None, group_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    query: dict[str, Any] = {}
    if teacher_id:
        query["teacher_id"] = teacher_id
    if group_id:
        query["group_id"] = group_id
    rows = await _find(TASKS, query)
    rows.sort(key=lambda row: str(row.get("created_at") or ""), reverse=True)
    return rows


async def update_task(task_id: str, **fields: Any) -> Optional[dict[str, Any]]:
    task = await get_task(task_id)
    if task is None:
        return None
    if "status" in fields and fields["status"] not in STATUSES:
        raise TaskStoreError("bad_status")
    return await _upsert(TASKS, {**task, **fields, "_id": task_id, "updated_at": _now()})


async def record_generation(
    task_id: str, *, component: str, ok: bool, detail: str = "",
) -> None:
    """Append one pass to the task's generation log. Never raises."""
    task = await get_task(task_id)
    if task is None:
        return
    entry = {"component": component, "ok": bool(ok), "at": _now()}
    if detail:
        entry["detail"] = detail[:300]
    log = list(task.get("generation") or [])[-19:]
    await _upsert(TASKS, {**task, "_id": task_id, "generation": log + [entry],
                          "updated_at": _now()})


# ── task_content ─────────────────────────────────────────────────────────────

async def put_content(
    task_id: str, component: str, content: dict[str, Any], *, source: str = "llm",
) -> dict[str, Any]:
    if component not in COMPONENTS:
        raise TaskStoreError("bad_component")
    return await _upsert(CONTENT, {
        "_id": content_id(task_id, component),
        "task_id": task_id,
        "component": component,
        "content": content,
        "source": source,
        "generated_at": _now(),
    })


async def get_content(task_id: str, component: str) -> Optional[dict[str, Any]]:
    return await _find_one(CONTENT, content_id(task_id, component))


async def all_content(task_id: str) -> dict[str, Any]:
    """Every generated component of a task, keyed by component name."""
    rows = await _find(CONTENT, {"task_id": task_id})
    return {
        str(row.get("component")): row.get("content") or {}
        for row in rows if row.get("component") in COMPONENTS
    }


# ── task_launches ────────────────────────────────────────────────────────────

async def create_launch(
    task_id: str, *, teacher_id: str, group_id: str,
    targets: list[dict[str, Any]], learner_ids: list[str],
    due_at: Optional[str] = None,
) -> dict[str, Any]:
    """Open the task. The sequence number is the count of openings so far + 1.

    `learner_ids` is stored resolved and then frozen. That is deliberate and it
    is the opposite of how the *task's* target behaves: a task resolves its
    target live at every send, so it never reaches a child who has left the
    class, while an opening is a historical fact — "these are the children who
    were given it in September" — and must not silently change when somebody
    transfers out in March.
    """
    existing = await list_launches(task_id)
    if len(existing) >= MAX_LAUNCHES:
        raise TaskStoreError("too_many_launches")
    seq = max((int(row.get("seq") or 0) for row in existing), default=0) + 1

    document = {
        "_id": launch_id(task_id, seq),
        "task_id": task_id,
        "teacher_id": teacher_id,
        "group_id": group_id,
        "seq": seq,
        "targets": [{"kind": str(entry.get("kind")), "id": str(entry.get("id"))}
                    for entry in targets],
        "learner_ids": list(dict.fromkeys(learner_ids))[:MAX_ACTIVATIONS],
        "status": "active",
        "due_at": due_at,
        "opened_at": _now(),
        "closed_at": None,
    }
    return await _upsert(LAUNCHES, document)


async def get_launch(launch: str) -> Optional[dict[str, Any]]:
    return await _find_one(LAUNCHES, launch)


async def list_launches(task_id: str) -> list[dict[str, Any]]:
    """Every opening of a task, oldest first — the order they happened in."""
    rows = await _find(LAUNCHES, {"task_id": task_id})
    rows.sort(key=lambda row: int(row.get("seq") or 0))
    return rows


async def list_launches_for_group(group_id: str) -> list[dict[str, Any]]:
    """Every opening in one class, by due date — what the calendar reads.

    Group-scoped rather than task-scoped because the calendar asks "what is due
    in this class", a question the per-task listing can only answer with an
    N+1. Undated launches sort last: they are real work, just not work with a
    day, and the caller drops them from a date range.
    """
    rows = await _find(LAUNCHES, {"group_id": group_id})
    rows.sort(key=lambda row: (not row.get("due_at"), str(row.get("due_at") or "")))
    return rows


async def set_launch_status(launch: str, status: str) -> Optional[dict[str, Any]]:
    if status not in LAUNCH_STATUSES:
        raise TaskStoreError("bad_status")
    row = await get_launch(launch)
    if row is None:
        return None
    return await _upsert(LAUNCHES, {
        **row, "_id": launch, "status": status,
        "closed_at": _now() if status == "closed" else None,
    })


def derived_status(task: dict[str, Any], launches: list[dict[str, Any]]) -> str:
    """The task's status, from its openings.

    Before anything is opened the stored value is the truth — `draft` and
    `generating` are states no launch could describe. After that the launches
    are: a task is `live` while any opening is active, and `closed` only when
    every one of them is shut. Which is what makes reopening possible without a
    second flag to keep in sync.
    """
    stored = str(task.get("status") or "draft")
    if not launches:
        return "closed" if stored == "closed" else stored
    return "live" if any(row.get("status") == "active" for row in launches) else "closed"


# ── task_activations ─────────────────────────────────────────────────────────

async def activate(
    launch: str, learner_ids: list[str], *, due_at: Optional[str] = None,
) -> dict[str, Any]:
    """Give this opening to these learners, freezing the content for each.

    Idempotent **within one opening**. A learner who already has an activation
    for this launch keeps the snapshot they were given — that is the guarantee
    that an edit to a live task cannot change the paper under a child who is
    halfway through it. A learner activated on a *different* launch is a
    different row entirely, which is what a retake is.

    Returns the learners newly activated and those that already had it, because
    the caller has to know who to notify.
    """
    task_id = task_of_launch(launch)
    snapshot = await all_content(task_id)
    if not snapshot:
        raise TaskStoreError("no_content")

    created: list[str] = []
    existing: list[str] = []
    for learner_id in list(dict.fromkeys(learner_ids))[:MAX_ACTIVATIONS]:
        was_new = await _insert_if_absent(ACTIVATIONS, {
            "_id": activation_id(launch, learner_id),
            "launch_id": launch,
            "task_id": task_id,
            "learner_id": learner_id,
            "content_snapshot": snapshot,
            "assigned_at": _now(),
            "due_at": due_at,
        })
        (created if was_new else existing).append(learner_id)
    return {"activated": created, "already_active": existing}


async def get_activation(launch: str, learner_id: str) -> Optional[dict[str, Any]]:
    return await _find_one(ACTIVATIONS, activation_id(launch, learner_id))


async def list_activations(launch: str) -> list[dict[str, Any]]:
    """The papers handed out in ONE opening."""
    return await _find(ACTIVATIONS, {"launch_id": launch})


async def list_activations_for_task(task_id: str) -> list[dict[str, Any]]:
    """Every paper of every opening. For counts across a whole task."""
    return await _find(ACTIVATIONS, {"task_id": task_id})


async def list_activations_for_learner(learner_id: str) -> list[dict[str, Any]]:
    rows = await _find(ACTIVATIONS, {"learner_id": learner_id})
    rows.sort(key=lambda row: str(row.get("assigned_at") or ""), reverse=True)
    return rows


# ── task_attempts ────────────────────────────────────────────────────────────

async def get_attempt(launch: str, learner_id: str) -> Optional[dict[str, Any]]:
    return await _find_one(ATTEMPTS, activation_id(launch, learner_id))


async def start_attempt(launch: str, learner_id: str) -> dict[str, Any]:
    """The attempt row, creating it on first touch. Never resets a live one."""
    document = {
        "_id": activation_id(launch, learner_id),
        "launch_id": launch,
        "task_id": task_of_launch(launch),
        "learner_id": learner_id,
        "answers": {},
        "questions": {},
        "score": None,
        "feedback": None,
        "time_spent": 0,
        "status": "in_progress",
        "started_at": _now(),
        "completed_at": None,
    }
    await _insert_if_absent(ATTEMPTS, document)
    attempt = await get_attempt(launch, learner_id)
    return attempt or document


async def save_attempt(
    launch: str, learner_id: str, *, status: Optional[str] = None, **fields: Any,
) -> dict[str, Any]:
    attempt = await start_attempt(launch, learner_id)
    if status is not None and status not in ATTEMPT_STATUSES:
        raise TaskStoreError("bad_status")
    update = {**attempt, **fields, "_id": activation_id(launch, learner_id)}
    if status is not None:
        update["status"] = status
        if status in ("submitted", "graded") and not update.get("completed_at"):
            update["completed_at"] = _now()
    update["updated_at"] = _now()
    return await _upsert(ATTEMPTS, update)


async def list_attempts(launch: str) -> list[dict[str, Any]]:
    """The papers written in ONE opening."""
    return await _find(ATTEMPTS, {"launch_id": launch})


async def list_attempts_for_task(task_id: str) -> list[dict[str, Any]]:
    return await _find(ATTEMPTS, {"task_id": task_id})


async def list_attempts_for_learner(learner_id: str) -> list[dict[str, Any]]:
    return await _find(ATTEMPTS, {"learner_id": learner_id})


async def latest_completion(learner_id: str) -> Optional[str]:
    """When this learner last finished a task, or None.

    Exists because `days_inactive` is computed from `learning_events`, which a
    teacher-authored task deliberately never writes to. Without this the roster
    reports "10 ימים ללא פעילות" for a child who completed three tasks this
    week — the teacher's own portal contradicting itself.
    """
    stamps = [
        str(attempt.get("completed_at"))
        for attempt in await list_attempts_for_learner(learner_id)
        if attempt.get("completed_at")
    ]
    return max(stamps) if stamps else None
