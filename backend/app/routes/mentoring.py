"""Mentoring (F5) + feedback (F7) routes. Thin: validate + delegate."""

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from app.auth.dependencies import optional_user, require_learner, require_learner_session
from app.brain.repository import _get_collection_named
from app.services import mentoring
from app.services.lrs import reporter as lrs_reporter


router = APIRouter(prefix="/api", tags=["mentoring-feedback"])


@router.post("/mentoring")
async def create_mentoring(data: dict, session=Depends(require_learner_session)):
    """Create a mentoring conversation (F5)."""
    learner_id = session["sub"]
    # The whole dict is forwarded to the service, so pin the identity here.
    record = await mentoring.create_conversation({**data, "learner_id": learner_id})
    # MoE 720: the documented meeting → mentor-student-meeting `completed`;
    # a shared next-steps goal → student-goal `initialized`. Mentor/student
    # extension ids use the stub reporting identity until real MoE ids land.
    if session.get("sid"):
        from app.services.lrs import config as lrs_config
        stub_exid = lrs_config.test_exidentifier()
        await lrs_reporter.report_mentor_meeting_completed(
            learner_id,
            session["sid"],
            record["id"],
            mentor_exid=stub_exid,
            student_exid=stub_exid,
            meeting_date=record["date"],
            mentoring_phase=record.get("meeting_stage") or None,
        )
        if record.get("visibility") == "shared":
            for goal in record.get("goals", []):
                await lrs_reporter.report_student_goal(
                    learner_id,
                    session["sid"],
                    "initialized",
                    goal["id"],
                    "academic",
                    instructor_exid=stub_exid if record.get("author") == "teacher" else None,
                )
    return JSONResponse(content=record)


@router.get("/mentoring")
async def list_mentoring(role: str = "teacher", learner_id: str = Depends(require_learner)):
    """List a learner's mentoring conversations (learner hides teacher-only notes)."""
    rows = await mentoring.list_conversations(learner_id, role)
    return JSONResponse(content={"conversations": rows})


@router.post("/mentoring/assist")
async def mentoring_assist(data: dict, session=Depends(require_learner_session)):
    """Yuvi (LLM) guided-writing helper: builds a draft + next question/options (F5)."""
    from app.services import mentoring_assist as assist
    result = await assist.guide_documentation(
        session["sub"],
        language=data.get("language", "he"),
        qa=data.get("qa"),
        notes=data.get("notes", ""),
        feeling=data.get("feeling", ""),
        more=bool(data.get("more")),
    )
    return JSONResponse(content=result)


@router.post("/mentoring/recommend-goal")
async def mentoring_recommend_goal(data: dict, session=Depends(require_learner_session)):
    """Yuvi suggests ONE goal (within a one-week window) from the documented talk (F5).

    The suggestion is stored for every documented talk (status ``suggested``),
    whether or not the learner takes it, for future teacher-side surfacing.
    """
    from app.services import mentoring_assist as assist
    rec = await assist.recommend_goal(
        session["sub"],
        language=data.get("language", "he"),
        notes=data.get("notes", ""),
        feeling=data.get("feeling", ""),
    )
    rec["feeling"] = data.get("feeling", "")
    stored = await mentoring.save_goal_recommendation(session["sub"], rec)
    return JSONResponse(content={
        "id": stored["id"],
        "title": rec["title"],
        "next_steps": rec["next_steps"],
        "deadline": rec["deadline"],
        "rationale": rec.get("rationale", ""),
        "ai": rec.get("ai", False),
    })


@router.post("/mentoring/recommend-goal/{rec_id}/status")
async def mentoring_recommend_goal_status(
    rec_id: str, data: dict, session=Depends(require_learner_session)
):
    """Record whether the learner accepted or dismissed Yuvi's goal (kept either way)."""
    result = await mentoring.update_recommendation_status(session["sub"], rec_id, data.get("status", ""))
    if result is None:
        raise HTTPException(status_code=404, detail="Recommendation was not found")
    return JSONResponse(content=result)


@router.post("/mentoring/{conversation_id}/goals/{goal_id}/progress")
async def update_mentoring_goal_progress(
    conversation_id: str,
    goal_id: str,
    data: dict,
    session=Depends(require_learner_session),
):
    """Advance the progress stage of one goal inside a conversation."""
    record = await mentoring.update_goal_progress(
        session["sub"], conversation_id, goal_id, data.get("progress_stage", "")
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Mentoring goal was not found")
    # MoE 720 family 7: a moved goal is `updated`, a finished one `completed`.
    # No new verb is invented for the spark grant itself (internal telemetry).
    if session.get("sid"):
        stage = data.get("progress_stage", "")
        await lrs_reporter.report_student_goal(
            session["sub"],
            session["sid"],
            "completed" if stage == "summarized" else "updated",
            goal_id,
            "academic",
        )
    return JSONResponse(content=record)


@router.post("/mentoring/{conversation_id}/goals/{goal_id}/help")
async def request_mentoring_goal_help(
    conversation_id: str,
    goal_id: str,
    session=Depends(require_learner_session),
):
    """Flag a goal as "struggling" to escalate to the teacher later (stored in DB)."""
    record = await mentoring.request_goal_help(session["sub"], conversation_id, goal_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Mentoring goal was not found")
    return JSONResponse(content=record)


@router.delete("/mentoring/{conversation_id}/goals/{goal_id}")
async def delete_mentoring_goal(
    conversation_id: str,
    goal_id: str,
    session=Depends(require_learner_session),
):
    """Soft-delete one learner-authored goal (teacher-documented goals are protected)."""
    result = await mentoring.delete_goal(session["sub"], conversation_id, goal_id)
    if result == "not_found":
        raise HTTPException(status_code=404, detail="Mentoring goal was not found")
    if result == "forbidden":
        raise HTTPException(status_code=403, detail="Only learner-created goals can be deleted")
    return JSONResponse(content={"ok": True, "id": goal_id})


@router.delete("/mentoring/{conversation_id}")
async def delete_mentoring_conversation(
    conversation_id: str,
    session=Depends(require_learner_session),
):
    """Soft-delete a whole learner-authored conversation (teacher talks are protected)."""
    result = await mentoring.delete_conversation(session["sub"], conversation_id)
    if result == "not_found":
        raise HTTPException(status_code=404, detail="Mentoring conversation was not found")
    if result == "forbidden":
        raise HTTPException(status_code=403, detail="Only learner-created conversations can be deleted")
    return JSONResponse(content={"ok": True, "id": conversation_id})


_FB_FALLBACK = Path(__file__).resolve().parents[2] / ".runtime" / "feedback.json"


@router.post("/feedback")
async def submit_feedback(data: dict, session=Depends(optional_user)):
    """Persist a technical/UX feedback report (F7), from inside or outside the app.

    Stays reachable while logged out (the landing page can report issues), so the
    learner id is attached only when a session exists.
    """
    report = {
        "id": f"fb_{uuid.uuid4().hex[:10]}",
        "learner_id": session["sub"] if session else None,
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
