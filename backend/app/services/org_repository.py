"""Org persistence — schools · groups · teacher links · enrollments · admins.

The **only** module that touches the `org_*` collections. Everything else goes
through `app.brain.org`, which keeps the scoping API stable while this file owns
storage.

Shape (architecture doc §4.3, F8):

    org_schools        _id = school_id
    org_groups         _id = group_id
    org_teacher_links  _id = "{teacher_id}:{group_id}"   teacher → group
    org_enrollments    _id = "{learner_id}:{group_id}"   learner → group
    org_admins         _id = user_id
    org_audit          append-only record of every membership mutation

A teacher is never linked to a learner directly: the *group* is the join. That
is what makes "several teachers may see the same student" fall out for free and
makes revocation a single indexed write instead of an N-row migration.

Mongo is the source of truth; a JSON fallback under `.runtime/org.json` keeps a
credential-less dev box working, exactly like `brain/repository.py` (§15 R11).
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from app.brain.repository import _get_collection_named

BASE_DIR = Path(__file__).resolve().parents[2]
FALLBACK_ORG_FILE = BASE_DIR / ".runtime" / "org.json"

SCHOOLS = "org_schools"
GROUPS = "org_groups"
TEACHER_LINKS = "org_teacher_links"
ENROLLMENTS = "org_enrollments"
ADMINS = "org_admins"
AUDIT = "org_audit"

_FALLBACK_KEYS = {
    SCHOOLS: "schools",
    GROUPS: "groups",
    TEACHER_LINKS: "teacher_links",
    ENROLLMENTS: "enrollments",
    ADMINS: "admins",
    AUDIT: "audit",
}

# Link roles carry intent, not extra power: every active link grants the same
# read scope. `observer` exists so a counsellor can be recorded without pretending
# they teach the group.
LINK_ROLES = ("teacher", "homeroom", "counselor", "observer")

ADMIN_SCOPES = ("system", "school")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def link_id(teacher_id: str, group_id: str) -> str:
    return f"{teacher_id}:{group_id}"


def enrollment_id(learner_id: str, group_id: str) -> str:
    return f"{learner_id}:{group_id}"


# ── JSON fallback ────────────────────────────────────────────────────────────

def _read_fallback() -> dict[str, list[dict[str, Any]]]:
    try:
        if FALLBACK_ORG_FILE.exists():
            data = json.loads(FALLBACK_ORG_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return {key: list(data.get(key) or []) for key in _FALLBACK_KEYS.values()}
    except (OSError, json.JSONDecodeError) as exc:
        print(f"⚠️ Failed reading org fallback: {exc}")
    return {key: [] for key in _FALLBACK_KEYS.values()}


def _write_fallback(data: dict[str, list[dict[str, Any]]]) -> None:
    try:
        FALLBACK_ORG_FILE.parent.mkdir(parents=True, exist_ok=True)
        FALLBACK_ORG_FILE.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except OSError as exc:
        print(f"⚠️ Failed writing org fallback: {exc}")


def _fallback_rows(collection: str) -> list[dict[str, Any]]:
    return _read_fallback().get(_FALLBACK_KEYS[collection], [])


def _fallback_upsert(collection: str, document: dict[str, Any]) -> dict[str, Any]:
    data = _read_fallback()
    key = _FALLBACK_KEYS[collection]
    rows = data.get(key) or []
    for index, row in enumerate(rows):
        if row.get("_id") == document.get("_id"):
            rows[index] = {**row, **document}
            data[key] = rows
            _write_fallback(data)
            return rows[index]
    rows.append(document)
    data[key] = rows
    _write_fallback(data)
    return document


def _matches(row: dict[str, Any], query: dict[str, Any]) -> bool:
    return all(row.get(field) == value for field, value in query.items())


# ── generic helpers ──────────────────────────────────────────────────────────

async def _find(collection: str, query: dict[str, Any]) -> list[dict[str, Any]]:
    handle = _get_collection_named(collection)
    if handle is None:
        return [row for row in _fallback_rows(collection) if _matches(row, query)]
    try:
        return await handle.find(query).to_list(length=5000)
    except Exception as exc:  # pragma: no cover - network/credential issues
        print(f"⚠️ org read failed on {collection}: {type(exc).__name__}")
        return [row for row in _fallback_rows(collection) if _matches(row, query)]


async def _find_one(collection: str, document_id: str) -> Optional[dict[str, Any]]:
    handle = _get_collection_named(collection)
    if handle is None:
        for row in _fallback_rows(collection):
            if row.get("_id") == document_id:
                return row
        return None
    try:
        return await handle.find_one({"_id": document_id})
    except Exception as exc:  # pragma: no cover
        print(f"⚠️ org read failed on {collection}: {type(exc).__name__}")
        for row in _fallback_rows(collection):
            if row.get("_id") == document_id:
                return row
        return None


async def _upsert(collection: str, document: dict[str, Any]) -> dict[str, Any]:
    payload = {**document, "updated_at": _now()}
    payload.setdefault("created_at", payload["updated_at"])
    handle = _get_collection_named(collection)
    if handle is None:
        return _fallback_upsert(collection, payload)
    try:
        document_id = payload.pop("_id")
        await handle.update_one(
            {"_id": document_id},
            {"$set": payload, "$setOnInsert": {"_id": document_id}},
            upsert=True,
        )
        payload["_id"] = document_id
        return payload
    except Exception as exc:  # pragma: no cover
        print(f"⚠️ org write failed on {collection}: {type(exc).__name__}")
        return _fallback_upsert(collection, {**payload, "_id": document.get("_id")})


async def ensure_indexes() -> None:
    """Create the lookup indexes. Called once from the app lifespan; safe to
    re-run. Every index here backs a query on the authorization hot path."""
    plans = {
        GROUPS: [("school_id", 1), ("active", 1)],
        TEACHER_LINKS: [("teacher_id", 1), ("group_id", 1), ("active", 1)],
        ENROLLMENTS: [("learner_id", 1), ("group_id", 1), ("active", 1)],
        AUDIT: [("at", -1)],
    }
    for collection, keys in plans.items():
        handle = _get_collection_named(collection)
        if handle is None:
            continue
        for field, direction in keys:
            try:
                await handle.create_index([(field, direction)])
            except Exception as exc:  # pragma: no cover - index creation is best effort
                print(f"⚠️ org index {collection}.{field} failed: {type(exc).__name__}")


# ── schools ──────────────────────────────────────────────────────────────────

async def list_schools() -> list[dict[str, Any]]:
    return await _find(SCHOOLS, {})


async def get_school(school_id: str) -> Optional[dict[str, Any]]:
    return await _find_one(SCHOOLS, school_id)


async def upsert_school(
    school_id: str, *, name: str, moe_code: Optional[str] = None, city: Optional[str] = None
) -> dict[str, Any]:
    return await _upsert(SCHOOLS, {
        "_id": school_id, "name": name, "moe_code": moe_code, "city": city,
    })


# ── groups ───────────────────────────────────────────────────────────────────

async def list_groups(
    *, school_id: Optional[str] = None, active_only: bool = True
) -> list[dict[str, Any]]:
    query: dict[str, Any] = {}
    if school_id:
        query["school_id"] = school_id
    if active_only:
        query["active"] = True
    return await _find(GROUPS, query)


async def get_group(group_id: str) -> Optional[dict[str, Any]]:
    return await _find_one(GROUPS, group_id)


async def upsert_group(
    group_id: str,
    *,
    school_id: str,
    name: str,
    subject: Optional[str] = None,
    grade: Optional[str] = None,
    year: Optional[str] = None,
    active: bool = True,
) -> dict[str, Any]:
    return await _upsert(GROUPS, {
        "_id": group_id, "school_id": school_id, "name": name, "subject": subject,
        "grade": grade, "year": year, "active": active,
    })


async def archive_group(group_id: str) -> Optional[dict[str, Any]]:
    """Groups are archived, never deleted — history stays readable to admins and
    the LRS record keeps its referent."""
    group = await get_group(group_id)
    if group is None:
        return None
    return await _upsert(GROUPS, {**group, "_id": group_id, "active": False})


# ── teacher links ────────────────────────────────────────────────────────────

async def list_teacher_links(
    *,
    teacher_id: Optional[str] = None,
    group_id: Optional[str] = None,
    active_only: bool = True,
) -> list[dict[str, Any]]:
    query: dict[str, Any] = {}
    if teacher_id:
        query["teacher_id"] = teacher_id
    if group_id:
        query["group_id"] = group_id
    if active_only:
        query["active"] = True
    return await _find(TEACHER_LINKS, query)


async def link_teacher(
    teacher_id: str,
    group_id: str,
    *,
    school_id: Optional[str] = None,
    link_role: str = "teacher",
    active: bool = True,
) -> dict[str, Any]:
    role = link_role if link_role in LINK_ROLES else "teacher"
    return await _upsert(TEACHER_LINKS, {
        "_id": link_id(teacher_id, group_id), "teacher_id": teacher_id,
        "group_id": group_id, "school_id": school_id, "link_role": role,
        "active": active,
    })


async def unlink_teacher(teacher_id: str, group_id: str) -> Optional[dict[str, Any]]:
    """Deactivate, never delete — the audit trail must stay answerable."""
    existing = await _find_one(TEACHER_LINKS, link_id(teacher_id, group_id))
    if existing is None:
        return None
    return await _upsert(TEACHER_LINKS, {
        **existing, "_id": link_id(teacher_id, group_id),
        "active": False, "revoked_at": _now(),
    })


# ── enrollments ──────────────────────────────────────────────────────────────

async def list_enrollments(
    *,
    learner_id: Optional[str] = None,
    group_id: Optional[str] = None,
    active_only: bool = True,
) -> list[dict[str, Any]]:
    query: dict[str, Any] = {}
    if learner_id:
        query["learner_id"] = learner_id
    if group_id:
        query["group_id"] = group_id
    if active_only:
        query["active"] = True
    return await _find(ENROLLMENTS, query)


async def enroll_learner(
    learner_id: str,
    group_id: str,
    *,
    school_id: Optional[str] = None,
    active: bool = True,
) -> dict[str, Any]:
    return await _upsert(ENROLLMENTS, {
        "_id": enrollment_id(learner_id, group_id), "learner_id": learner_id,
        "group_id": group_id, "school_id": school_id, "active": active,
        "joined_at": _now(), "left_at": None,
    })


async def unenroll_learner(learner_id: str, group_id: str) -> Optional[dict[str, Any]]:
    existing = await _find_one(ENROLLMENTS, enrollment_id(learner_id, group_id))
    if existing is None:
        return None
    return await _upsert(ENROLLMENTS, {
        **existing, "_id": enrollment_id(learner_id, group_id),
        "active": False, "left_at": _now(),
    })


# ── admins ───────────────────────────────────────────────────────────────────

async def get_admin(user_id: str) -> Optional[dict[str, Any]]:
    row = await _find_one(ADMINS, user_id)
    if row is None or row.get("active") is False:
        return None
    return row


async def list_admins() -> list[dict[str, Any]]:
    return await _find(ADMINS, {})


async def grant_admin(
    user_id: str,
    *,
    scope: str = "system",
    school_ids: Optional[list[str]] = None,
    granted_by: Optional[str] = None,
) -> dict[str, Any]:
    return await _upsert(ADMINS, {
        "_id": user_id, "scope": scope if scope in ADMIN_SCOPES else "system",
        "school_ids": list(school_ids or []), "granted_by": granted_by,
        "granted_at": _now(), "active": True,
    })


async def revoke_admin(user_id: str) -> Optional[dict[str, Any]]:
    existing = await _find_one(ADMINS, user_id)
    if existing is None:
        return None
    return await _upsert(ADMINS, {
        **existing, "_id": user_id, "active": False, "revoked_at": _now(),
    })


# ── audit ────────────────────────────────────────────────────────────────────

async def record_audit(
    *,
    actor_id: str,
    action: str,
    target_type: str,
    target_id: str,
    before: Optional[dict[str, Any]] = None,
    after: Optional[dict[str, Any]] = None,
    reason: Optional[str] = None,
) -> dict[str, Any]:
    """Append-only record of a membership mutation.

    "Who gave this teacher access to this child, and when" must always be
    answerable — that is not optional for a system holding minors' data.
    """
    at = _now()
    entry = {
        "_id": f"aud_{target_type}_{target_id}_{at}",
        "actor_id": actor_id, "action": action, "target_type": target_type,
        "target_id": target_id, "before": before, "after": after,
        "reason": reason, "at": at,
    }
    return await _upsert(AUDIT, entry)


async def list_audit(
    *, actor_id: Optional[str] = None, target_id: Optional[str] = None, limit: int = 100
) -> list[dict[str, Any]]:
    query: dict[str, Any] = {}
    if actor_id:
        query["actor_id"] = actor_id
    if target_id:
        query["target_id"] = target_id
    rows = await _find(AUDIT, query)
    rows.sort(key=lambda row: row.get("at") or "", reverse=True)
    return rows[:limit]
