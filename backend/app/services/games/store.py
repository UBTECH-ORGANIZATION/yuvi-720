"""Persistence for learner-made games — three collections, one rule each.

    learner_games         _id = game_id                       what the learner asked for, and every version built
    learner_game_jobs     _id = job_id                        one unit of worker work (create | edit | fix)
    learner_game_answers  _id = "{game_id}:{learner_id}:{seq}" one graded answer inside a game

## The game document is the learner's view; the job carries the context

A game row is what the learner sees on a card: title, genre, status, versions.
It deliberately holds NO learning context — the component's questions and
their correct answers travel in the **job payload** (``jobs.py``), which only
the worker and the grader read. Keeping the two apart is what lets every route
return a game document verbatim without a redaction step that someone will one
day forget.

## HTML is never here

A version is a pointer: ``{v, blob_path, sha256, created_at, source, summary}``.
The file itself lives in the html store (local disk or Blob). A 200 KB game in
a Mongo document would blow the card list's payload and Cosmos' RU budget for
no benefit — the page is served as a whole, never queried.

## Caps count what was asked for, not what survived

``count_created_today`` counts deleted games too. The daily cap exists to bound
spend, and a game that was built and then deleted has already cost its tokens;
deleting to make room would turn the cap into a suggestion.

Mongo is the source of truth; a JSON fallback under ``.runtime/games.json``
keeps a credential-less dev box working, the same arrangement as
``tasks/store.py``.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from app.brain.repository import _get_collection_named

log = logging.getLogger(__name__)

GAMES = "learner_games"
JOBS = "learner_game_jobs"
ANSWERS = "learner_game_answers"

_FALLBACK_FILE = Path(__file__).resolve().parents[3] / ".runtime" / "games.json"
_FALLBACK_KEYS = {GAMES: "games", JOBS: "jobs", ANSWERS: "answers"}

#: queued → planning → building → validating → (fixing) → ready | failed.
#: The worker owns every transition after `queued`; the app only ever writes
#: `queued` (a new job) and `ready` (a revert to an existing version).
STATUSES = ("queued", "planning", "building", "validating", "fixing", "ready", "failed")

#: What a job does. `create` builds from the context pack alone; `edit` and
#: `fix` start from the current version's HTML.
JOB_KINDS = ("create", "edit", "fix")

#: A job's own ladder, separate from the game's: the game says what the learner
#: sees, the job says what the worker did.
JOB_STATUSES = ("queued", "running", "done", "failed")

#: Where a version came from — mirrors JOB_KINDS on purpose.
VERSION_SOURCES = ("create", "edit", "fix")

#: The most rows one listing call reads before paging.
MAX_PAGE = 50


class GameStoreError(Exception):
    """A refusal the caller may see. The message is a stable code."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _day_start() -> str:
    """UTC midnight as an ISO string. Timestamps here are ISO-8601 in UTC, so a
    string comparison is a time comparison — the same trick `tasks/store.py`
    relies on for sorting."""
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()


def new_game_id() -> str:
    return f"gm-{uuid.uuid4().hex[:12]}"


def new_job_id() -> str:
    return f"gj-{uuid.uuid4().hex[:12]}"


def answer_id(game_id: str, learner_id: str, seq: int) -> str:
    """``gm-abc:kid:3`` — the third graded answer of that learner in that game."""
    return f"{game_id}:{learner_id}:{int(seq)}"


# ── JSON fallback ────────────────────────────────────────────────────────────

def _read_fallback() -> dict[str, list[dict[str, Any]]]:
    try:
        if _FALLBACK_FILE.exists():
            data = json.loads(_FALLBACK_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return {key: list(data.get(key) or []) for key in _FALLBACK_KEYS.values()}
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("games fallback read failed: %s", exc)
    return {key: [] for key in _FALLBACK_KEYS.values()}


def _write_fallback(data: dict[str, list[dict[str, Any]]]) -> None:
    try:
        _FALLBACK_FILE.parent.mkdir(parents=True, exist_ok=True)
        _FALLBACK_FILE.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except OSError as exc:
        log.warning("games fallback write failed: %s", exc)


def _matches(row: dict[str, Any], query: dict[str, Any]) -> bool:
    """The subset of Mongo's query language the fallback needs: equality,
    ``$in``, ``$gte`` / ``$lt`` on ISO strings, and one-level dotted paths."""
    for field, value in query.items():
        actual: Any = row
        for part in field.split("."):
            actual = actual.get(part) if isinstance(actual, dict) else None
        if isinstance(value, dict):
            if "$in" in value and actual not in value["$in"]:
                return False
            if "$gte" in value and not (actual is not None and str(actual) >= str(value["$gte"])):
                return False
            if "$lt" in value and not (actual is not None and str(actual) < str(value["$lt"])):
                return False
        elif actual != value:
            return False
    return True


# ── generic helpers ──────────────────────────────────────────────────────────

async def _find(
    collection: str, query: dict[str, Any], *,
    sort: Optional[tuple[str, int]] = None, limit: int = 5000,
) -> list[dict[str, Any]]:
    handle = _get_collection_named(collection)
    if handle is not None:
        try:
            cursor = handle.find(query)
            if sort is not None:
                cursor = cursor.sort(*sort)
            return await cursor.limit(limit).to_list(length=limit)
        except Exception as exc:  # pragma: no cover - network/credential issues
            log.warning("game read failed on %s: %s", collection, type(exc).__name__)
    rows = [row for row in _read_fallback().get(_FALLBACK_KEYS[collection], [])
            if _matches(row, query)]
    if sort is not None:
        field, direction = sort
        rows.sort(key=lambda row: str(row.get(field) or ""), reverse=direction < 0)
    return rows[:limit]


async def _count(collection: str, query: dict[str, Any]) -> int:
    handle = _get_collection_named(collection)
    if handle is not None:
        try:
            return int(await handle.count_documents(query))
        except Exception as exc:  # pragma: no cover
            log.warning("game count failed on %s: %s", collection, type(exc).__name__)
    return len([row for row in _read_fallback().get(_FALLBACK_KEYS[collection], [])
                if _matches(row, query)])


async def _find_one(collection: str, document_id: str) -> Optional[dict[str, Any]]:
    handle = _get_collection_named(collection)
    if handle is not None:
        try:
            return await handle.find_one({"_id": document_id})
        except Exception as exc:  # pragma: no cover
            log.warning("game read failed on %s: %s", collection, type(exc).__name__)
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
            log.warning("game write failed on %s, using fallback: %s", collection, exc)
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
    """Create, or leave what is already there. Returns whether it created."""
    handle = _get_collection_named(collection)
    if handle is not None:
        try:
            result = await handle.update_one(
                {"_id": document["_id"]}, {"$setOnInsert": document}, upsert=True
            )
            return bool(getattr(result, "upserted_id", None))
        except Exception as exc:
            log.warning("game insert failed on %s, using fallback: %s", collection, exc)
    data = _read_fallback()
    key = _FALLBACK_KEYS[collection]
    rows = data.get(key) or []
    if any(row.get("_id") == document["_id"] for row in rows):
        return False
    rows.append(document)
    data[key] = rows
    _write_fallback(data)
    return True


# ── learner_games ────────────────────────────────────────────────────────────

async def create_game(
    *, learner_id: str, objective_id: str, unit_id: str, component_id: str,
    title: str, genre: str, prompt: str = "", language: str = "he",
    device: str = "keyboard", path_node_id: Optional[str] = None,
) -> dict[str, Any]:
    """Record what the learner asked for. The build is a separate job.

    `title` is provisional — the worker replaces it with the one the model
    chose (``SubmitParams.title``) when the first version lands. Until then the
    card shows the component's name, which is what the game is about anyway.
    """
    document = {
        "_id": new_game_id(),
        "learner_id": learner_id,
        "objective_id": objective_id,
        "unit_id": unit_id,
        "component_id": component_id,
        "path_node_id": path_node_id,
        "title": (title or "")[:80],
        "genre": genre,
        "prompt": (prompt or "")[:600],
        "language": language,
        "device": device,
        "status": "queued",
        "current_version": 0,
        "versions": [],
        "thumb_blob_path": None,
        # The last runtime errors the player reported — what a fix job starts
        # from, and what the card shows under "Yuvi noticed a bug".
        "errors_last": [],
        # Kid-facing budget. The worker adds each job's cost bucket here.
        "sparks_spent": 0,
        "created_at": _now(),
        "updated_at": _now(),
        "deleted_at": None,
    }
    return await _upsert(GAMES, document)


async def get_game(game_id: str) -> Optional[dict[str, Any]]:
    """The row, deleted or not. Callers that show it check `deleted_at`."""
    return await _find_one(GAMES, game_id)


async def list_games(
    learner_id: str, *, component_id: Optional[str] = None,
    objective_id: Optional[str] = None, cursor: Optional[str] = None,
    limit: int = 20, include_deleted: bool = False,
) -> tuple[list[dict[str, Any]], Optional[str]]:
    """Newest first, paged by `created_at`.

    The cursor is the `created_at` of the last row shown; the next page is
    everything strictly older. Two games created in the same microsecond by
    one learner would need a tie-break, and the daily cap makes that
    impossible in practice — so a single field, and no opaque token.
    """
    limit = max(1, min(int(limit), MAX_PAGE))
    query: dict[str, Any] = {"learner_id": learner_id}
    if not include_deleted:
        query["deleted_at"] = None
    if component_id:
        query["component_id"] = component_id
    if objective_id:
        query["objective_id"] = objective_id
    if cursor:
        query["created_at"] = {"$lt": str(cursor)}
    rows = await _find(GAMES, query, sort=("created_at", -1), limit=limit + 1)
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        next_cursor = str(rows[-1].get("created_at") or "") or None
    return rows, next_cursor


async def update_game(game_id: str, **fields: Any) -> Optional[dict[str, Any]]:
    game = await get_game(game_id)
    if game is None:
        return None
    if "status" in fields and fields["status"] not in STATUSES:
        raise GameStoreError("bad_status")
    return await _upsert(GAMES, {**game, **fields, "_id": game_id, "updated_at": _now()})


async def update_status(
    game_id: str, status: str, *, errors_last: Optional[list[dict[str, Any]]] = None,
) -> Optional[dict[str, Any]]:
    """Move the game along its ladder. `errors_last` replaces the stored list
    when given (a fix job starts from these), and is left alone otherwise."""
    if status not in STATUSES:
        raise GameStoreError("bad_status")
    fields: dict[str, Any] = {"status": status}
    if errors_last is not None:
        fields["errors_last"] = list(errors_last)[:20]
    return await update_game(game_id, **fields)


async def add_version(
    game_id: str, *, blob_path: str, sha256: str, source: str, summary: str = "",
    title: Optional[str] = None, thumb_blob_path: Optional[str] = None,
    sparks: int = 0, design_brief: Optional[str] = None,
) -> dict[str, Any]:
    """Append a built version and make it current. The game becomes `ready`
    and its error list is cleared — whatever was broken, this build replaced it.

    Returns the version entry, not the game, because the caller's next step
    (notify) is keyed by `v`.
    """
    if source not in VERSION_SOURCES:
        raise GameStoreError("bad_source")
    game = await get_game(game_id)
    if game is None:
        raise GameStoreError("not_found")
    versions = list(game.get("versions") or [])
    v = max((int(entry.get("v") or 0) for entry in versions), default=0) + 1
    entry = {
        "v": v,
        "blob_path": blob_path,
        "sha256": sha256,
        "created_at": _now(),
        "source": source,
        "summary": (summary or "")[:300],
    }
    fields: dict[str, Any] = {
        "versions": versions + [entry],
        "current_version": v,
        "status": "ready",
        "errors_last": [],
        "sparks_spent": int(game.get("sparks_spent") or 0) + max(0, int(sparks)),
    }
    if title:
        fields["title"] = str(title)[:80]
    if thumb_blob_path:
        fields["thumb_blob_path"] = thumb_blob_path
    if design_brief:  # Yuvi's own words about the game, shown in the player
        fields["description"] = str(design_brief)[:600]
    await update_game(game_id, **fields)
    return entry


def version_entry(game: dict[str, Any], v: Optional[int] = None) -> Optional[dict[str, Any]]:
    """The version `v` of a game, or the current one when `v` is None."""
    wanted = int(v) if v is not None else int(game.get("current_version") or 0)
    for entry in game.get("versions") or []:
        if int(entry.get("v") or 0) == wanted:
            return entry
    return None


async def set_current_version(game_id: str, v: int) -> dict[str, Any]:
    """Revert (or re-advance) to a version that already exists. No rebuild."""
    game = await get_game(game_id)
    if game is None:
        raise GameStoreError("not_found")
    if version_entry(game, v) is None:
        raise GameStoreError("bad_version")
    updated = await update_game(game_id, current_version=int(v), status="ready", errors_last=[])
    return updated or game


async def soft_delete(game_id: str) -> Optional[dict[str, Any]]:
    """Stamp `deleted_at`. The row — and its cost — stay on the record."""
    game = await get_game(game_id)
    if game is None:
        return None
    if game.get("deleted_at"):
        return game
    return await update_game(game_id, deleted_at=_now())


async def count_created_today(learner_id: str) -> int:
    """Games this learner created since UTC midnight, deleted ones included."""
    return await _count(GAMES, {"learner_id": learner_id, "created_at": {"$gte": _day_start()}})


# ── learner_game_jobs ────────────────────────────────────────────────────────

async def create_job(
    *, game_id: str, learner_id: str, kind: str, payload: dict[str, Any],
    version: Optional[int] = None,
) -> dict[str, Any]:
    """One unit of worker work. `version` is the game version an edit or fix
    starts from — it is what the per-version fix cap counts by."""
    if kind not in JOB_KINDS:
        raise GameStoreError("bad_kind")
    document = {
        "_id": new_job_id(),
        "game_id": game_id,
        "learner_id": learner_id,
        "kind": kind,
        "version": int(version) if version is not None else None,
        "payload": payload,
        "status": "queued",
        "attempts": 0,
        "worker_replica": None,
        "started_at": None,
        "finished_at": None,
        "error_class": None,
        "usage_summary": None,
        "created_at": _now(),
        "updated_at": _now(),
    }
    return await _upsert(JOBS, document)


async def get_job(job_id: str) -> Optional[dict[str, Any]]:
    return await _find_one(JOBS, job_id)


async def update_job(job_id: str, **fields: Any) -> Optional[dict[str, Any]]:
    job = await get_job(job_id)
    if job is None:
        return None
    if "status" in fields and fields["status"] not in JOB_STATUSES:
        raise GameStoreError("bad_status")
    return await _upsert(JOBS, {**job, **fields, "_id": job_id, "updated_at": _now()})


async def list_jobs(game_id: str) -> list[dict[str, Any]]:
    """Every job of a game, newest first."""
    return await _find(JOBS, {"game_id": game_id}, sort=("created_at", -1))


async def latest_job(game_id: str) -> Optional[dict[str, Any]]:
    rows = await _find(JOBS, {"game_id": game_id}, sort=("created_at", -1), limit=1)
    return rows[0] if rows else None


async def count_jobs_today(learner_id: str, kind: str) -> int:
    return await _count(JOBS, {
        "learner_id": learner_id, "kind": kind, "created_at": {"$gte": _day_start()},
    })


async def count_fix_jobs_for_version(game_id: str, v: int) -> int:
    """How many repair attempts a version has already had — the auto-fix cap."""
    return await _count(JOBS, {"game_id": game_id, "kind": "fix", "version": int(v)})


# ── learner_game_answers ─────────────────────────────────────────────────────

async def record_answer(
    *, game_id: str, learner_id: str, question_id: str, item_id: str,
    component_id: str, correct: bool, latency_ms: Optional[int] = None,
) -> dict[str, Any]:
    """One graded answer. The sequence is per (game, learner), so a learner's
    play-through reads back in order without a timestamp sort.

    `$setOnInsert` with a retry rather than a count-then-write: two answers
    posted in the same tick would otherwise both claim the same sequence and
    one of them would silently overwrite the other.
    """
    document: dict[str, Any] = {
        "game_id": game_id,
        "learner_id": learner_id,
        "question_id": question_id,
        "item_id": item_id,
        "component_id": component_id,
        "correct": bool(correct),
        "latency_ms": int(latency_ms) if latency_ms is not None else None,
        "at": _now(),
    }
    base = await _count(ANSWERS, {"game_id": game_id, "learner_id": learner_id})
    for offset in range(1, 6):
        seq = base + offset
        candidate = {**document, "_id": answer_id(game_id, learner_id, seq), "seq": seq}
        if await _insert_if_absent(ANSWERS, candidate):
            return candidate
    raise GameStoreError("answer_sequence_contended")


async def list_answers(game_id: str, learner_id: str) -> list[dict[str, Any]]:
    rows = await _find(ANSWERS, {"game_id": game_id, "learner_id": learner_id})
    rows.sort(key=lambda row: int(row.get("seq") or 0))
    return rows


# ── indexes ──────────────────────────────────────────────────────────────────

async def ensure_indexes() -> None:
    """The card list reads (learner, created_at); the caps count (learner,
    created_at) and (learner, kind, created_at); the worker polls (status,
    created_at) and the fix cap counts (game, kind, version)."""
    plan = {
        GAMES: ([("learner_id", 1), ("created_at", -1)],
                [("learner_id", 1), ("component_id", 1), ("created_at", -1)]),
        JOBS: ([("status", 1), ("created_at", 1)],
               [("game_id", 1), ("created_at", -1)],
               [("learner_id", 1), ("kind", 1), ("created_at", -1)],
               [("game_id", 1), ("kind", 1), ("version", 1)]),
        ANSWERS: ([("game_id", 1), ("learner_id", 1), ("seq", 1)],
                  [("learner_id", 1), ("at", -1)]),
    }
    for collection, indexes in plan.items():
        handle = _get_collection_named(collection)
        if handle is None:
            continue
        for keys in indexes:
            try:
                await handle.create_index(keys)
            except Exception:  # pragma: no cover - best effort
                log.warning("game index %s on %s failed", keys, collection)
