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
from learner_state import normalize_learner_id  # type: ignore

_FALLBACK = Path(__file__).resolve().parents[2] / ".runtime" / "mentoring.json"

REQUIRED_FIELDS = ("date", "teacher_name", "learner_name", "meeting_stage", "notes", "next_steps", "deadline")


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


async def create_conversation(data: dict[str, Any]) -> dict[str, Any]:
    """Create a mentoring conversation and mirror a learner-visible goal (F5→F4)."""
    learner_id = normalize_learner_id(data.get("learner_id"))
    record = {
        "id": f"ment_{uuid.uuid4().hex[:10]}",
        "learner_id": learner_id,
        "date": data.get("date") or datetime.now(timezone.utc).date().isoformat(),
        "teacher_name": data.get("teacher_name", ""),
        "learner_name": data.get("learner_name", ""),
        "meeting_stage": data.get("meeting_stage", ""),
        "notes": data.get("notes", ""),
        "next_steps": data.get("next_steps", ""),
        "deadline": data.get("deadline", ""),
        "author": data.get("author", "teacher"),        # teacher | learner
        "visibility": data.get("visibility", "shared"),   # shared | teacher_only
        "teacher_only_note": data.get("teacher_only_note", ""),
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

    # Mirror a learner-visible goal into the brain (F4 shows mentoring goals).
    if record["visibility"] == "shared" and record["next_steps"]:
        brain = await get_brain(learner_id)
        goals = list(brain.get("goals") or [])
        goals.append({
            "id": record["id"], "text": record["next_steps"], "deadline": record["deadline"],
            "source": "mentoring", "status": "open", "visible_to_learner": True,
        })
        await apply_brain_updates(learner_id, {"goals": goals[-12:]})

    return record


async def list_conversations(learner_id: str, viewer_role: str = "teacher") -> list[dict[str, Any]]:
    """List a learner's conversations. Learners never see teacher-only notes."""
    lid = normalize_learner_id(learner_id)
    collection = _get_collection_named("mentoring_conversations")
    rows: list[dict[str, Any]]
    if collection is not None:
        try:
            rows = [r async for r in collection.find({"learner_id": lid}).sort("created_at", -1)]
            for r in rows:
                r.pop("_id", None)
        except Exception as exc:
            print(f"⚠️ mentoring read failed, using fallback: {exc}")
            rows = [r for r in _read_fallback() if r["learner_id"] == lid]
    else:
        rows = [r for r in _read_fallback() if r["learner_id"] == lid]

    if viewer_role != "teacher":
        rows = [{k: v for k, v in r.items() if k != "teacher_only_note"} for r in rows]
    return rows
