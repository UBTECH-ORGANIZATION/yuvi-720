"""Mentoring (F5) + feedback (F7) routes. Thin: validate + delegate."""

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.brain.repository import _get_collection_named
from app.services import mentoring
from learner_state import normalize_learner_id  # type: ignore


router = APIRouter(prefix="/api", tags=["mentoring-feedback"])


@router.post("/mentoring")
async def create_mentoring(data: dict):
    """Create a mentoring conversation (F5)."""
    record = await mentoring.create_conversation(data)
    return JSONResponse(content=record)


@router.get("/mentoring")
async def list_mentoring(learner_id: str, role: str = "teacher"):
    """List a learner's mentoring conversations (learner hides teacher-only notes)."""
    rows = await mentoring.list_conversations(normalize_learner_id(learner_id), role)
    return JSONResponse(content={"conversations": rows})


_FB_FALLBACK = Path(__file__).resolve().parents[2] / ".runtime" / "feedback.json"


@router.post("/feedback")
async def submit_feedback(data: dict):
    """Persist a technical/UX feedback report (F7), from inside or outside the app."""
    report = {
        "id": f"fb_{uuid.uuid4().hex[:10]}",
        "learner_id": normalize_learner_id(data.get("learner_id")) if data.get("learner_id") else None,
        "kind": data.get("kind", "issue"),          # issue | suggestion | content_fit
        "message": data.get("message", ""),
        "context": data.get("context", {}),          # route, ua, etc. (auto-attached client-side)
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    collection = _get_collection_named("feedback_reports")
    if collection is not None:
        try:
            await collection.insert_one(dict(report))
        except Exception as exc:
            print(f"⚠️ feedback write failed, using fallback: {exc}")
            _append_fallback(report)
    else:
        _append_fallback(report)
    return JSONResponse(content={"ok": True, "id": report["id"]})


def _append_fallback(report: dict[str, Any]) -> None:
    try:
        rows = json.loads(_FB_FALLBACK.read_text(encoding="utf-8")) if _FB_FALLBACK.exists() else []
    except (OSError, json.JSONDecodeError):
        rows = []
    rows.append(report)
    try:
        _FB_FALLBACK.parent.mkdir(parents=True, exist_ok=True)
        _FB_FALLBACK.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as exc:
        print(f"⚠️ feedback fallback write failed: {exc}")
