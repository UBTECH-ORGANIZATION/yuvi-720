"""Retry/Resend queue + permanent send-ledger for outbound MoE-LRS statements.

One Mongo collection (`lrs_outbox`) plays both roles — spec-mandated
reliability AND a durable audit ledger:

- Near-Real-Time: `enqueue` persists the statement then immediately fires a
  shielded send task.
- Retry/Resend: failures schedule exponential-backoff retries via `sweep()`;
  the SAME statement id is resent every time, so the LRS's duplicate-id
  rejection is the spec's own de-dup working as intended (we treat a 409-ish
  rejection of a known id as delivered).
- Ledger: rows are NEVER deleted. Each carries denormalized filter fields
  (learner_id, verb, session_id, status, …) plus the full statement and the
  LRS response — "what exactly did we report, when, and what did the LRS
  say" for every message.

JSON fallback (`.runtime/lrs_outbox.json`) keeps dev machines working
without Mongo — never the production path (same pattern as events.py).
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from app.brain.repository import _get_collection_named
from app.services.lrs import client, config

_FALLBACK = Path(__file__).resolve().parents[2] / ".runtime" / "lrs_outbox.json"

MAX_BACKOFF_SECONDS = 600
BASE_BACKOFF_SECONDS = 15
SWEEP_INTERVAL_SECONDS = 30
SWEEP_BATCH = 50


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _backoff(attempts: int) -> timedelta:
    return timedelta(
        seconds=min(MAX_BACKOFF_SECONDS, BASE_BACKOFF_SECONDS * (2 ** max(0, attempts - 1)))
    )


def _collection():
    return _get_collection_named("lrs_outbox")


def _row(
    statement: dict[str, Any],
    *,
    learner_id: Optional[str],
    source: str,
) -> dict[str, Any]:
    """Ledger row: full statement + denormalized filter fields."""
    verb_iri = (statement.get("verb") or {}).get("id") or ""
    obj = statement.get("object") or {}
    obj_type_iri = ((obj.get("definition") or {}).get("type") or "")
    session_id = None
    for group in ((statement.get("context") or {}).get("contextActivities") or {}).get(
        "grouping", []
    ):
        gid = str(group.get("id") or "")
        if "/session/" in gid:
            session_id = gid.rsplit("/session/", 1)[-1]
            break
    return {
        "_id": statement["id"],
        "statement": statement,
        "learner_id": learner_id,
        "exidentifier": ((statement.get("actor") or {}).get("account") or {}).get("name"),
        "verb": verb_iri.rsplit("/", 1)[-1],
        "activity_type": obj_type_iri.rsplit("/", 1)[-1],
        "object_id": obj.get("id"),
        "session_id": session_id,
        "source": source,  # "platform" | "kata"
        "status": "pending",
        "attempts": 0,
        "next_attempt_at": _iso(_now()),
        "last_error": None,
        "last_response": None,
        "occurred_at": statement.get("timestamp"),
        "created_at": _iso(_now()),
        "sent_at": None,
    }


_indexes_ensured = False


async def _ensure_indexes(collection) -> None:
    global _indexes_ensured
    if _indexes_ensured:
        return
    _indexes_ensured = True
    try:
        for key in ("learner_id", "status", "verb", "session_id", "created_at", "exidentifier"):
            await collection.create_index(key)
        await collection.create_index([("status", 1), ("next_attempt_at", 1)])
    except Exception:  # pragma: no cover — best effort
        pass


# ── JSON fallback (dev only) ─────────────────────────────────────────────────
def _fallback_read() -> dict[str, Any]:
    try:
        return json.loads(_FALLBACK.read_text(encoding="utf-8")) if _FALLBACK.exists() else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _fallback_write(data: dict[str, Any]) -> None:
    try:
        _FALLBACK.parent.mkdir(parents=True, exist_ok=True)
        _FALLBACK.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as exc:
        print(f"⚠️ lrs_outbox fallback write failed: {exc}")


# ── Enqueue + send ───────────────────────────────────────────────────────────
async def enqueue(
    statement: dict[str, Any],
    *,
    learner_id: Optional[str] = None,
    source: str = "platform",
) -> None:
    """Persist the statement (idempotent on its id), then send immediately."""
    row = _row(statement, learner_id=learner_id, source=source)
    collection = _collection()
    if collection is not None:
        try:
            await _ensure_indexes(collection)
            await collection.update_one(
                {"_id": row["_id"]}, {"$setOnInsert": row}, upsert=True
            )
        except Exception as exc:
            print(f"⚠️ lrs_outbox write failed, using fallback: {exc}")
            data = _fallback_read()
            data.setdefault(row["_id"], row)
            _fallback_write(data)
    else:
        data = _fallback_read()
        data.setdefault(row["_id"], row)
        _fallback_write(data)

    # Near-Real-Time: fire-and-forget immediate attempt (shielded from caller).
    asyncio.create_task(_attempt_send(row["_id"]))


async def _load_row(statement_id: str) -> Optional[dict[str, Any]]:
    collection = _collection()
    if collection is not None:
        try:
            return await collection.find_one({"_id": statement_id})
        except Exception as exc:
            print(f"⚠️ lrs_outbox read failed, using fallback: {exc}")
    return _fallback_read().get(statement_id)


async def _update_row(statement_id: str, fields: dict[str, Any]) -> None:
    collection = _collection()
    if collection is not None:
        try:
            await collection.update_one({"_id": statement_id}, {"$set": fields})
            return
        except Exception as exc:
            print(f"⚠️ lrs_outbox update failed, using fallback: {exc}")
    data = _fallback_read()
    if statement_id in data:
        data[statement_id].update(fields)
        _fallback_write(data)


async def _attempt_send(statement_id: str) -> None:
    row = await _load_row(statement_id)
    if not row or row.get("status") == "sent":
        return
    attempts = int(row.get("attempts", 0)) + 1
    try:
        response = await client.post_statement(row["statement"])
        await _update_row(
            statement_id,
            {
                "status": "sent",
                "attempts": attempts,
                "sent_at": _iso(_now()),
                "last_response": response,
                "last_error": None,
            },
        )
    except client.LrsError as exc:
        # A duplicate-id rejection means the LRS already has it — delivered.
        duplicate = exc.status_code == 409
        # A 4xx (bad request / unauthorized / forbidden / not-found) is a
        # PERMANENT rejection — the same bytes will be rejected forever. Mark it
        # `rejected` (terminal, still audited) so the sweeper stops re-hammering
        # the Ministry LRS with a structurally invalid statement. 408/429 are
        # transient and stay retryable.
        status = int(exc.status_code or 0)
        permanent = 400 <= status < 500 and status not in (408, 409, 429)
        if duplicate:
            new_status = "sent"
        elif permanent:
            new_status = "rejected"
        elif attempts >= 3:
            new_status = "failed"
        else:
            new_status = "pending"
        await _update_row(
            statement_id,
            {
                "status": new_status,
                "attempts": attempts,
                "sent_at": _iso(_now()) if duplicate else row.get("sent_at"),
                "next_attempt_at": _iso(_now() + _backoff(attempts)),
                "last_error": f"{exc.code}:{exc.status_code}",
            },
        )
    except Exception as exc:  # auth errors etc. — retry later, never raise
        await _update_row(
            statement_id,
            {
                "status": "failed" if attempts >= 3 else "pending",
                "attempts": attempts,
                "next_attempt_at": _iso(_now() + _backoff(attempts)),
                "last_error": type(exc).__name__,
            },
        )


# ── Sweeper ──────────────────────────────────────────────────────────────────
async def sweep() -> int:
    """Retry due pending/failed rows (same ids). Returns how many were tried."""
    now_iso = _iso(_now())
    due: list[str] = []
    collection = _collection()
    if collection is not None:
        try:
            cursor = (
                collection.find(
                    {"status": {"$in": ["pending", "failed"]},
                     "next_attempt_at": {"$lte": now_iso}},
                    {"_id": 1},
                )
                .sort("next_attempt_at", 1)
                .limit(SWEEP_BATCH)
            )
            due = [row["_id"] async for row in cursor]
        except Exception as exc:
            print(f"⚠️ lrs_outbox sweep read failed, using fallback: {exc}")
    if not due:
        due = [
            sid
            for sid, row in _fallback_read().items()
            if row.get("status") in {"pending", "failed"}
            and str(row.get("next_attempt_at") or "") <= now_iso
        ][:SWEEP_BATCH]
    for statement_id in due:
        await _attempt_send(statement_id)
    return len(due)


async def run_sweeper() -> None:
    """Background loop started once at app startup (guarded by is_enabled)."""
    while True:
        try:
            await sweep()
        except Exception as exc:  # the sweeper must never die
            print(f"⚠️ lrs sweeper error: {exc}")
        await asyncio.sleep(SWEEP_INTERVAL_SECONDS)
