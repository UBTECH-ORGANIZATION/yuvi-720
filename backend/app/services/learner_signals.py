"""Durable per-learner signal episodes for teacher analytics.

The detectors already run — ``detect_recovery`` and ``detect_sustained_effort``
fire inside ``triggers.evaluate`` to nudge the learner, and the idle watchdog
fires ``publish_idle`` — but every firing was transient: published to the SSE
bus and gone. The Independence/Concentration scores (PBI 451) need to count
them over a window, so this module gives each firing one durable row.

Writes happen ONLY on the trigger/ingest path (``triggers.py``). The read
paths that also call the detectors (``moments.py``, ``insights.py``) re-run
them on every page view — hooking there would record one "firing" per view.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

from app.brain.repository import _get_collection_named

COLLECTION = "learner_signals"
# `question_quality` rides here as well as on the message row: the learning
# chat is a TEMPORARY `lesson_coach` thread whose messages are hard-deleted on
# lesson exit (`sessions.end_lesson_conversation`), so this collection is the
# durable home of the label. The message stamp is the write-once guard while
# the thread lives; this row is what the score reads.
KINDS = {"idle", "recovery", "sustained_effort", "question_quality"}
_FALLBACK = Path(__file__).resolve().parents[2] / ".runtime" / "learner_signals.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_fallback() -> list[dict[str, Any]]:
    try:
        return json.loads(_FALLBACK.read_text(encoding="utf-8")) if _FALLBACK.exists() else []
    except Exception:
        return []


def _write_fallback(rows: list[dict[str, Any]]) -> None:
    try:
        _FALLBACK.parent.mkdir(parents=True, exist_ok=True)
        _FALLBACK.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


async def record(
    learner_id: str,
    kind: str,
    *,
    objective_id: Optional[str] = None,
    session_id: Optional[str] = None,
    dedupe_key: Optional[str] = None,
    meta: Optional[dict[str, Any]] = None,
) -> None:
    """Append one signal episode. Best-effort; never raises.

    ``dedupe_key`` makes the write once-only (unique sparse index): a replayed
    xAPI statement re-enters ``triggers.evaluate``, and the in-memory
    once-per-session guards do not survive a restart.
    """
    if kind not in KINDS:
        return
    doc: dict[str, Any] = {
        "learner_id": learner_id,
        "kind": kind,
        "at": _now(),
        "objective_id": objective_id,
        "session_id": session_id,
    }
    if dedupe_key:
        doc["dedupe_key"] = dedupe_key
    if meta:
        doc["meta"] = meta
    collection = _get_collection_named(COLLECTION)
    if collection is not None:
        try:
            await collection.insert_one(dict(doc))
            return
        except Exception as exc:
            if "duplicate" in str(exc).lower() or "E11000" in str(exc):
                return
            print(f"⚠️ learner_signals write failed, using fallback: {exc}")
    rows = _read_fallback()
    if dedupe_key and any(r.get("dedupe_key") == dedupe_key for r in rows):
        return
    rows.append(doc)
    _write_fallback(rows)


async def recent(
    learner_id: str,
    *,
    since: str,
    kinds: Optional[Iterable[str]] = None,
) -> list[dict[str, Any]]:
    """Signal episodes for a learner at/after ``since`` (ISO string — ISO
    timestamps compare lexicographically, the codebase convention)."""
    wanted = set(kinds) if kinds else None
    collection = _get_collection_named(COLLECTION)
    if collection is not None:
        try:
            query: dict[str, Any] = {"learner_id": learner_id, "at": {"$gte": since}}
            if wanted:
                query["kind"] = {"$in": sorted(wanted)}
            return [row async for row in collection.find(query)]
        except Exception:
            pass
    return [
        row
        for row in _read_fallback()
        if row.get("learner_id") == learner_id
        and (row.get("at") or "") >= since
        and (wanted is None or row.get("kind") in wanted)
    ]


async def ensure_indexes() -> None:
    """(learner_id, at) serves the score window read; dedupe_key is the
    write-once guard. Wired into server.py's index_steps."""
    collection = _get_collection_named(COLLECTION)
    if collection is None:
        return
    try:
        await collection.create_index([("learner_id", 1), ("at", -1)], name="learner_at")
    except Exception as exc:
        print(f"⚠️ learner_signals learner_at index skipped: {type(exc).__name__}")
    try:
        await collection.create_index(
            [("dedupe_key", 1)], name="dedupe_unique", unique=True, sparse=True
        )
    except Exception as exc:
        print(f"⚠️ learner_signals dedupe index skipped: {type(exc).__name__}")
