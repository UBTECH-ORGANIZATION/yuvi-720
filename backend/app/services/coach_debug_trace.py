"""Development-only technical traces for learner Coach execution.

Traces intentionally contain neither learner content nor model/tool inputs or
outputs. They are an operational timeline, not an explanation of model logic.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.brain.repository import _get_collection_named


_FALLBACK = Path(__file__).resolve().parents[2] / ".runtime" / "coach_debug_traces.json"
_ALLOWED_STATUSES = {"ok", "skipped", "blocked", "error"}
_ALLOWED_SOURCES = {"system", "agent"}
_MAX_STEPS = 24


def enabled() -> bool:
    return (os.environ.get("COACH_DEBUG_TRACE_ENABLED") or "").strip().lower() in {
        "1", "true", "yes", "on",
    }


def append(
    steps: list[dict[str, str]] | None,
    name: str,
    status: str = "ok",
    source: str = "system",
) -> None:
    """Add one fixed-shape, content-free diagnostic step to a local trace."""
    if steps is None or len(steps) >= _MAX_STEPS:
        return
    safe_name = str(name)
    if not re.fullmatch(r"[a-z][a-z0-9_:.]{0,79}", safe_name):
        return
    steps.append({
        "name": safe_name,
        "status": status if status in _ALLOWED_STATUSES else "error",
        "source": source if source in _ALLOWED_SOURCES else "system",
    })


def _read_fallback() -> dict[str, Any]:
    try:
        return json.loads(_FALLBACK.read_text(encoding="utf-8")) if _FALLBACK.exists() else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _write_fallback(data: dict[str, Any]) -> None:
    try:
        _FALLBACK.parent.mkdir(parents=True, exist_ok=True)
        _FALLBACK.write_text(json.dumps(data, ensure_ascii=True, indent=2), encoding="utf-8")
    except OSError as exc:
        print(f"Coach debug trace fallback write failed: {type(exc).__name__}")


async def record(exchange_id: str, steps: list[dict[str, str]]) -> None:
    """Store a bounded technical trace when explicitly enabled for development."""
    if not enabled() or not exchange_id:
        return
    document = {
        "_id": exchange_id,
        "steps": [dict(step) for step in steps[:_MAX_STEPS]],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    collection = _get_collection_named("coach_debug_traces")
    if collection is not None:
        try:
            await collection.update_one({"_id": exchange_id}, {"$set": document}, upsert=True)
            return
        except Exception as exc:
            print(f"Coach debug trace write failed: {type(exc).__name__}")
    fallback = _read_fallback()
    fallback[exchange_id] = document
    _write_fallback(fallback)


async def read(exchange_id: str) -> dict[str, Any] | None:
    """Return only a stored technical timeline; callers must enforce admin access."""
    if not enabled() or not exchange_id:
        return None
    collection = _get_collection_named("coach_debug_traces")
    if collection is not None:
        try:
            document = await collection.find_one({"_id": exchange_id}, {"_id": 0, "steps": 1, "created_at": 1})
            return _public_document(document) if isinstance(document, dict) else None
        except Exception as exc:
            print(f"Coach debug trace read failed: {type(exc).__name__}")
    document = _read_fallback().get(exchange_id)
    if not isinstance(document, dict):
        return None
    return _public_document(document)


def _public_document(document: dict[str, Any]) -> dict[str, Any]:
    """Normalize legacy traces while exposing only the fixed public shape."""
    steps = []
    for step in document.get("steps") or []:
        if not isinstance(step, dict):
            continue
        name = step.get("name")
        status = step.get("status")
        if not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9_:.]{0,79}", name):
            continue
        steps.append({
            "name": name,
            "status": status if status in _ALLOWED_STATUSES else "error",
            "source": step.get("source") if step.get("source") in _ALLOWED_SOURCES else "system",
        })
    return {"steps": steps[:_MAX_STEPS], "created_at": document.get("created_at")}