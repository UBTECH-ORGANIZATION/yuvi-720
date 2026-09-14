"""Durable learner XP state and append-only award ledger."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.brain.repository import _get_collection_named
from app.services.progression.curve import RULES_VERSION, status_for_total_xp
from learner_state import normalize_learner_id  # type: ignore

_FALLBACK = Path(__file__).resolve().parents[3] / ".runtime" / "progression.json"
_fallback_lock = asyncio.Lock()
_indexes_ready = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _empty_progression(learner_id: str) -> dict[str, Any]:
    return {
        "_id": learner_id,
        "learner_id": learner_id,
        "total_xp": 0,
        "rules_version": RULES_VERSION,
        "milestones": {
            "first_objective_id": None,
            "qualifying_help_requests": 0,
            "claimed_help_thresholds": [],
        },
        "entitlements": {"extra_hint_tokens": 0},
        "claimed_level_rewards": [],
        "applied_claims": [],
        "updated_at": _now(),
    }


def _read_fallback() -> dict[str, Any]:
    try:
        if _FALLBACK.exists():
            return json.loads(_FALLBACK.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"⚠️ progression fallback read failed: {exc}")
    return {"progression": {}, "ledger": {}}


def _write_fallback(data: dict[str, Any]) -> None:
    try:
        _FALLBACK.parent.mkdir(parents=True, exist_ok=True)
        _FALLBACK.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except OSError as exc:
        print(f"⚠️ progression fallback write failed: {exc}")


def _public_progression(row: dict[str, Any]) -> dict[str, Any]:
    status = status_for_total_xp(int(row.get("total_xp") or 0))
    entitlements = row.get("entitlements") or {}
    status.update({
        "extraHintTokens": int(entitlements.get("extra_hint_tokens") or 0),
        "claimedLevelRewards": sorted({
            int(level) for level in row.get("claimed_level_rewards") or []
        }),
    })
    return status


async def _load_progression(learner_id: str) -> dict[str, Any]:
    collection = _get_collection_named("learner_progression")
    if collection is not None:
        try:
            return await collection.find_one({"_id": learner_id}) or _empty_progression(learner_id)
        except Exception as exc:
            print(f"⚠️ progression read failed, using fallback: {exc}")
    return (_read_fallback().get("progression") or {}).get(learner_id) or _empty_progression(learner_id)


async def ensure_indexes() -> None:
    global _indexes_ready
    if _indexes_ready:
        return
    collection = _get_collection_named("xp_ledger")
    if collection is None:
        return
    try:
        await collection.create_index([("learner_id", 1), ("at", -1)], name="learner_at")
        _indexes_ready = True
    except Exception as exc:
        print(f"⚠️ xp_ledger index setup skipped: {type(exc).__name__}")


async def get_status(learner_id: Optional[str]) -> dict[str, Any]:
    lid = normalize_learner_id(learner_id)
    return _public_progression(await _load_progression(lid))


async def claim_entitlement_once(
    learner_id: Optional[str], *, key: str, field: str, amount: int
) -> bool:
    """Increment a progression entitlement exactly once for a stable key."""
    lid = normalize_learner_id(learner_id)
    claim = f"entitlement:{key}"
    collection = _get_collection_named("learner_progression")
    if collection is not None:
        try:
            updated = await collection.find_one_and_update(
                {"_id": lid, "applied_claims": {"$ne": claim}},
                {
                    "$inc": {f"entitlements.{field}": int(amount)},
                    "$addToSet": {"applied_claims": claim},
                    "$set": {"learner_id": lid, "updated_at": _now()},
                    "$setOnInsert": {
                        "total_xp": 0,
                        "rules_version": RULES_VERSION,
                        "claimed_level_rewards": [],
                    },
                },
                upsert=True,
                return_document=ReturnDocument.AFTER,
            )
            return updated is not None
        except DuplicateKeyError:
            return False
        except Exception as exc:
            print(f"⚠️ progression entitlement write failed, using fallback: {exc}")
    async with _fallback_lock:
        data = _read_fallback()
        rows = data.setdefault("progression", {})
        row = rows.get(lid) or _empty_progression(lid)
        claims = row.setdefault("applied_claims", [])
        if claim in claims:
            return False
        claims.append(claim)
        entitlements = row.setdefault("entitlements", {})
        entitlements[field] = int(entitlements.get(field) or 0) + int(amount)
        row["updated_at"] = _now()
        rows[lid] = row
        _write_fallback(data)
        return True


async def consume_entitlement(
    learner_id: Optional[str], *, field: str, amount: int = 1
) -> dict[str, Any]:
    """Atomically consume a positive progression entitlement balance."""
    lid = normalize_learner_id(learner_id)
    safe_amount = max(1, int(amount))
    path = f"entitlements.{field}"
    collection = _get_collection_named("learner_progression")
    if collection is not None:
        try:
            row = await collection.find_one_and_update(
                {"_id": lid, path: {"$gte": safe_amount}},
                {"$inc": {path: -safe_amount}, "$set": {"updated_at": _now()}},
                return_document=ReturnDocument.AFTER,
            )
            remaining = int(((row or {}).get("entitlements") or {}).get(field) or 0)
            return {"consumed": row is not None, "remaining": remaining}
        except Exception as exc:
            print(f"⚠️ entitlement consumption failed, using fallback: {exc}")

    async with _fallback_lock:
        data = _read_fallback()
        rows = data.setdefault("progression", {})
        row = rows.get(lid) or _empty_progression(lid)
        entitlements = row.setdefault("entitlements", {})
        balance = int(entitlements.get(field) or 0)
        if balance < safe_amount:
            return {"consumed": False, "remaining": balance}
        remaining = balance - safe_amount
        entitlements[field] = remaining
        row["updated_at"] = _now()
        rows[lid] = row
        _write_fallback(data)
        return {"consumed": True, "remaining": remaining}


async def remember_first_objective(
    learner_id: Optional[str], objective_id: str
) -> str:
    """Persist the first objective once and return its stable ID."""
    lid = normalize_learner_id(learner_id)
    collection = _get_collection_named("learner_progression")
    if collection is not None:
        try:
            await collection.update_one(
                {
                    "_id": lid,
                    "$or": [
                        {"milestones.first_objective_id": None},
                        {"milestones.first_objective_id": {"$exists": False}},
                    ],
                },
                {
                    "$set": {
                        "learner_id": lid,
                        "milestones.first_objective_id": objective_id,
                        "updated_at": _now(),
                    },
                    "$setOnInsert": {
                        "total_xp": 0,
                        "rules_version": RULES_VERSION,
                        "claimed_level_rewards": [],
                    },
                },
                upsert=True,
            )
            row = await collection.find_one({"_id": lid}) or {}
            return str((row.get("milestones") or {}).get("first_objective_id") or objective_id)
        except DuplicateKeyError:
            row = await collection.find_one({"_id": lid}) or {}
            return str((row.get("milestones") or {}).get("first_objective_id") or objective_id)
        except Exception as exc:
            print(f"⚠️ first objective write failed, using fallback: {exc}")
    async with _fallback_lock:
        data = _read_fallback()
        rows = data.setdefault("progression", {})
        row = rows.get(lid) or _empty_progression(lid)
        milestones = row.setdefault("milestones", {})
        stored = milestones.get("first_objective_id")
        if not stored:
            milestones["first_objective_id"] = objective_id
            stored = objective_id
        row["updated_at"] = _now()
        rows[lid] = row
        _write_fallback(data)
        return str(stored)


async def record_help_request(
    learner_id: Optional[str], request_id: str
) -> dict[str, Any]:
    """Count one unique purposeful help request across all learning surfaces."""
    lid = normalize_learner_id(learner_id)
    claim = f"help:{request_id}"
    collection = _get_collection_named("learner_progression")
    if collection is not None:
        try:
            updated = await collection.find_one_and_update(
                {"_id": lid, "help_request_claims": {"$ne": claim}},
                {
                    "$inc": {"milestones.qualifying_help_requests": 1},
                    "$addToSet": {"help_request_claims": claim},
                    "$set": {"learner_id": lid, "updated_at": _now()},
                    "$setOnInsert": {
                        "total_xp": 0,
                        "rules_version": RULES_VERSION,
                        "claimed_level_rewards": [],
                    },
                },
                upsert=True,
                return_document=ReturnDocument.AFTER,
            )
            if updated is not None:
                count = int((updated.get("milestones") or {}).get("qualifying_help_requests") or 0)
                return {"counted": True, "count": count}
        except DuplicateKeyError:
            pass
        except Exception as exc:
            print(f"⚠️ help milestone write failed, using fallback: {exc}")
        row = await collection.find_one({"_id": lid}) or {}
        count = int((row.get("milestones") or {}).get("qualifying_help_requests") or 0)
        return {"counted": False, "count": count}

    async with _fallback_lock:
        data = _read_fallback()
        rows = data.setdefault("progression", {})
        row = rows.get(lid) or _empty_progression(lid)
        claims = row.setdefault("help_request_claims", [])
        milestones = row.setdefault("milestones", {})
        if claim in claims:
            return {
                "counted": False,
                "count": int(milestones.get("qualifying_help_requests") or 0),
            }
        claims.append(claim)
        count = int(milestones.get("qualifying_help_requests") or 0) + 1
        milestones["qualifying_help_requests"] = count
        row["updated_at"] = _now()
        rows[lid] = row
        _write_fallback(data)
        return {"counted": True, "count": count}


async def mark_level_reward_claimed(learner_id: Optional[str], level: int) -> None:
    lid = normalize_learner_id(learner_id)
    collection = _get_collection_named("learner_progression")
    if collection is not None:
        try:
            await collection.update_one(
                {"_id": lid},
                {
                    "$addToSet": {"claimed_level_rewards": int(level)},
                    "$set": {"learner_id": lid, "updated_at": _now()},
                },
                upsert=True,
            )
            return
        except Exception as exc:
            print(f"⚠️ level reward claim write failed, using fallback: {exc}")
    async with _fallback_lock:
        data = _read_fallback()
        rows = data.setdefault("progression", {})
        row = rows.get(lid) or _empty_progression(lid)
        claimed = row.setdefault("claimed_level_rewards", [])
        if int(level) not in claimed:
            claimed.append(int(level))
        row["updated_at"] = _now()
        rows[lid] = row
        _write_fallback(data)


async def list_ledger(learner_id: Optional[str], limit: int = 20) -> list[dict[str, Any]]:
    lid = normalize_learner_id(learner_id)
    bounded_limit = max(1, min(int(limit), 100))
    rows: list[dict[str, Any]] = []
    collection = _get_collection_named("xp_ledger")
    if collection is not None:
        try:
            cursor = collection.find({"learner_id": lid, "status": "applied"})
            rows = [row async for row in cursor.sort("at", -1).limit(bounded_limit)]
        except Exception as exc:
            print(f"⚠️ XP ledger read failed, using fallback: {exc}")
    if not rows:
        rows = sorted(
            [
                row for row in (_read_fallback().get("ledger") or {}).values()
                if row.get("learner_id") == lid and row.get("status") == "applied"
            ],
            key=lambda row: row.get("at") or "",
            reverse=True,
        )[:bounded_limit]
    return [
        {
            "id": row.get("_id"),
            "amount": int(row.get("amount") or 0),
            "reason": row.get("reason"),
            "source": row.get("source") or {},
            "totalAfter": int(row.get("total_after") or 0),
            "levelBefore": int(row.get("level_before") or 1),
            "levelAfter": int(row.get("level_after") or 1),
            "at": row.get("at"),
        }
        for row in rows
    ]


async def _award_fallback(
    learner_id: str, key: str, amount: int, reason: str, source: dict[str, Any]
) -> dict[str, Any]:
    async with _fallback_lock:
        data = _read_fallback()
        ledger = data.setdefault("ledger", {})
        progression_rows = data.setdefault("progression", {})
        row = progression_rows.get(learner_id) or _empty_progression(learner_id)
        existing = ledger.get(key)
        if existing:
            return {
                "awarded": 0,
                "duplicate": True,
                "entry": _public_entry(existing),
                "progression": _public_progression(row),
            }

        before = status_for_total_xp(int(row.get("total_xp") or 0))
        total_after = before["totalXp"] + amount
        after = status_for_total_xp(total_after)
        row["total_xp"] = total_after
        row["rules_version"] = RULES_VERSION
        row["updated_at"] = _now()
        row.setdefault("applied_claims", []).append(key)
        entry = {
            "_id": key,
            "learner_id": learner_id,
            "kind": "earn",
            "amount": amount,
            "reason": reason,
            "source": source,
            "status": "applied",
            "total_after": total_after,
            "level_before": before["level"],
            "level_after": after["level"],
            "rules_version": RULES_VERSION,
            "at": _now(),
        }
        progression_rows[learner_id] = row
        ledger[key] = entry
        _write_fallback(data)
        return {
            "awarded": amount,
            "duplicate": False,
            "entry": _public_entry(entry),
            "progression": _public_progression(row),
        }


def _public_entry(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": entry.get("_id"),
        "amount": int(entry.get("amount") or 0),
        "reason": entry.get("reason"),
        "source": entry.get("source") or {},
        "totalAfter": int(entry.get("total_after") or 0),
        "levelBefore": int(entry.get("level_before") or 1),
        "levelAfter": int(entry.get("level_after") or 1),
        "at": entry.get("at"),
    }


async def award_xp(
    learner_id: Optional[str],
    *,
    key: str,
    amount: int,
    reason: str,
    source: dict[str, Any],
) -> dict[str, Any]:
    """Apply a trusted XP award once and return a popup-ready receipt."""
    lid = normalize_learner_id(learner_id)
    safe_amount = int(amount)
    if safe_amount <= 0:
        return {"awarded": 0, "duplicate": False, "progression": await get_status(lid)}

    progression_collection = _get_collection_named("learner_progression")
    ledger_collection = _get_collection_named("xp_ledger")
    if progression_collection is None or ledger_collection is None:
        return await _award_fallback(lid, key, safe_amount, reason, dict(source))

    pending = {
        "_id": key,
        "learner_id": lid,
        "kind": "earn",
        "amount": safe_amount,
        "reason": reason,
        "source": dict(source),
        "status": "pending",
        "rules_version": RULES_VERSION,
        "at": _now(),
    }
    try:
        await ledger_collection.insert_one(dict(pending))
    except DuplicateKeyError:
        pass

    try:
        updated = await progression_collection.find_one_and_update(
            {"_id": lid, "applied_claims": {"$ne": key}},
            {
                "$inc": {"total_xp": safe_amount},
                "$addToSet": {"applied_claims": key},
                "$set": {
                    "learner_id": lid,
                    "rules_version": RULES_VERSION,
                    "updated_at": _now(),
                },
                "$setOnInsert": {
                    "milestones": {
                        "first_objective_id": None,
                        "qualifying_help_requests": 0,
                        "claimed_help_thresholds": [],
                    },
                    "entitlements": {"extra_hint_tokens": 0},
                    "claimed_level_rewards": [],
                },
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        applied = updated is not None
    except DuplicateKeyError:
        updated = None
        applied = False
    except Exception as exc:
        print(f"⚠️ XP award write failed, using fallback: {exc}")
        return await _award_fallback(lid, key, safe_amount, reason, dict(source))

    row = updated or await progression_collection.find_one({"_id": lid}) or _empty_progression(lid)
    after = status_for_total_xp(int(row.get("total_xp") or 0))
    before_total = max(0, after["totalXp"] - safe_amount) if applied else after["totalXp"]
    entry_update = {
        "status": "applied",
        "total_after": after["totalXp"],
        "level_before": status_for_total_xp(before_total)["level"],
        "level_after": after["level"],
    }
    await ledger_collection.update_one({"_id": key}, {"$set": entry_update})
    entry = {**pending, **entry_update}
    return {
        "awarded": safe_amount if applied else 0,
        "duplicate": not applied,
        "entry": _public_entry(entry),
        "progression": _public_progression(row),
    }