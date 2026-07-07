"""Agent session store — the Coach's WORKING memory (§4.5, §5.4).

Keyed by `{learner_id, session_id, role}` in the `agent_sessions` collection.
Holds the last N turns verbatim so the Coach can resume a chat where the learner
left off — no `localStorage`, all in Mongo (JSON fallback for the local demo).
Rolling-summary + entity-ledger compression is layered in P4; P3 keeps the
verbatim recent window.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from app.brain.repository import _get_collection_named
from learner_state import normalize_learner_id  # type: ignore

MAX_TURNS = 20                      # verbatim window cap (R2 — brain stays compact)
_FALLBACK = Path(__file__).resolve().parents[2] / ".runtime" / "agent_sessions.json"


def _key(learner_id: str, role: str, session_id: str = "default") -> str:
    return f"{normalize_learner_id(learner_id)}:{session_id}:{role}"


def _read_fallback() -> dict[str, Any]:
    try:
        return json.loads(_FALLBACK.read_text(encoding="utf-8")) if _FALLBACK.exists() else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _write_fallback(data: dict[str, Any]) -> None:
    try:
        _FALLBACK.parent.mkdir(parents=True, exist_ok=True)
        _FALLBACK.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as exc:
        print(f"⚠️ agent_sessions fallback write failed: {exc}")


async def get_recent(learner_id: str, role: str, limit: int = 8) -> list[dict[str, str]]:
    """Return the last `limit` turns as [{role, content}] (oldest→newest)."""
    key = _key(learner_id, role)
    collection = _get_collection_named("agent_sessions")
    if collection is not None:
        try:
            doc = await collection.find_one({"_id": key})
            turns = (doc or {}).get("turns", [])
            return turns[-limit:]
        except Exception as exc:
            print(f"⚠️ agent_sessions read failed, using fallback: {exc}")
    return (_read_fallback().get(key, {}).get("turns", []))[-limit:]


async def append_turn(learner_id: str, role: str, user: str, assistant: str) -> None:
    """Append a user+assistant exchange, capped to the recent window."""
    key = _key(learner_id, role)
    now = datetime.now(timezone.utc).isoformat()
    new_turns = [
        {"role": "user", "content": user, "at": now},
        {"role": "assistant", "content": assistant, "at": now},
    ]
    collection = _get_collection_named("agent_sessions")
    if collection is not None:
        try:
            doc = await collection.find_one({"_id": key})
            turns = ((doc or {}).get("turns", []) + new_turns)[-MAX_TURNS:]
            await collection.update_one(
                {"_id": key},
                {"$set": {"turns": turns, "learner_id": normalize_learner_id(learner_id),
                          "role": role, "updated_at": now}},
                upsert=True,
            )
            return
        except Exception as exc:
            print(f"⚠️ agent_sessions write failed, using fallback: {exc}")
    data = _read_fallback()
    entry = data.get(key, {"turns": []})
    entry["turns"] = (entry.get("turns", []) + new_turns)[-MAX_TURNS:]
    data[key] = entry
    _write_fallback(data)
