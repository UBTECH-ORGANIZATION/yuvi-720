"""Teacher data routes (F6) — thin: authorize, delegate, report.

Two invariants every route in this file keeps:

* **Access is checked before any brain read.** `_guard` raises 403 first; no
  handler touches learner data before it returns.
* **The LRS `dashboard viewed` statement is emitted only AFTER the check
  passes.** A 403 must never produce a "viewed" event — the teacher did not see
  anything.
"""

from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from app.auth.dependencies import require_teacher_session
from app.brain import org
from app.core.localization import normalize_language
from app.services import group_analytics, insights, teacher_insights_store
from app.services.lrs import reporter as lrs_reporter
from learner_state import normalize_learner_id  # type: ignore

router = APIRouter(prefix="/api/teacher", tags=["teacher"])

_NO_STORE = {"Cache-Control": "private, no-store"}


def _ok(content: Any) -> JSONResponse:
    return JSONResponse(content=content, headers=_NO_STORE)


def _denied() -> JSONResponse:
    return JSONResponse(content={"error": "forbidden"}, status_code=403, headers=_NO_STORE)


async def _guard_learner(session: dict, learner_id: str) -> Optional[str]:
    """Return the safe learner id, or None when the teacher may not read it."""
    safe_id = normalize_learner_id(learner_id)
    if not await org.teacher_can_access_learner(session["sub"], safe_id):
        return None
    return safe_id


async def _guard_group(session: dict, group_id: str) -> bool:
    return await org.teacher_can_access_group(session["sub"], group_id)


async def _report(session: dict, dashboard_type: str) -> None:
    """MoE 720 dashboard-viewed. Best-effort; never breaks the response."""
    if not session.get("sid"):
        return
    try:
        await lrs_reporter.report_dashboard_viewed(
            session["sub"], session["sid"], dashboard_type, None
        )
    except Exception as exc:  # pragma: no cover - reporting is never critical
        print(f"⚠️ dashboard-viewed report skipped: {type(exc).__name__}")


# ── roster ───────────────────────────────────────────────────────────────────

@router.get("/roster")
async def teacher_roster(session=Depends(require_teacher_session)):
    """Names for every learner this teacher teaches, across every group.

    Exists so a name never depends on the class picker. The assistant is scoped
    to the union of a teacher's groups, so a per-group name map turned "Tal"
    back into `demo-tal` the moment the teacher switched class. Cheap by
    construction — see `teacher_roster.roster_for_teacher`.
    """
    from app.services import teacher_roster as roster_service

    return _ok(await roster_service.roster_for_teacher(session["sub"]))


@router.get("/brief")
async def teacher_brief(
    group_id: str = Query(...),
    language: str = Query("he"),
    refresh: bool = Query(False),
    session=Depends(require_teacher_session),
):
    """What changed in this class since the teacher was last here.

    Generated on visit rather than on a clock — there is no scheduler here, and
    one that ran in-process would fan out per worker. The service caps itself at
    one generation per day per teacher per class; `refresh` is the manual
    override behind the card's own button.
    """
    if not await _guard_group(session, group_id):
        return _denied()

    from app.services import daily_brief

    return _ok(await daily_brief.get_brief(
        session["sub"], group_id,
        language=normalize_language(language), force=refresh,
    ))


# ── group ────────────────────────────────────────────────────────────────────

@router.get("/groups/{group_id}/snapshot")
async def group_snapshot(
    group_id: str,
    subject: Optional[str] = Query(None),
    language: str = Query("he"),
    session=Depends(require_teacher_session),
):
    """Group state: aggregate trends + per-student attention flags (F6 group §1)."""
    if not await _guard_group(session, group_id):
        return _denied()
    view = await insights.group_insights(group_id, normalize_language(language))
    await _report(session, "learning-group")
    return _ok(view)


@router.get("/groups/{group_id}/engagement")
async def group_engagement(
    group_id: str,
    days: int = Query(7, ge=1, le=90),
    session=Depends(require_teacher_session),
):
    """% active learners + average active minutes (F6 group §1, engagement)."""
    if not await _guard_group(session, group_id):
        return _denied()
    return _ok(await group_analytics.engagement(group_id, days=days))


@router.get("/groups/{group_id}/gaps")
async def group_gaps(
    group_id: str,
    subject: Optional[str] = Query(None),
    language: str = Query("he"),
    session=Depends(require_teacher_session),
):
    """Group learning gaps + sub-group teaching moves (nice-to-have §3–4)."""
    if not await _guard_group(session, group_id):
        return _denied()
    gaps = await group_analytics.learning_gaps(group_id, subject=subject)
    return _ok({
        "gaps": gaps,
        "recommendations": group_analytics.group_recommendations(
            gaps, normalize_language(language)
        ),
    })


@router.get("/groups/{group_id}/goals")
async def group_goals(group_id: str, session=Depends(require_teacher_session)):
    """Every learner's goals in one read — the class Goals screen.

    Exists so the goals workspace does not fan out N requests from the browser
    per visit. Same viewer_role="teacher" projection as the per-student route,
    so `teacher_only_note` stays teacher-side and a learner can never reach it
    (this route sits behind the teacher guard like every other group read).
    """
    import asyncio as _asyncio

    if not await _guard_group(session, group_id):
        return _denied()

    from app.brain import org
    from app.services import mentoring

    learner_ids = await org.learners_in_group(group_id)

    # Bounded fan-out: a class is ~30 learners, but never let one slow document
    # store turn this into an unbounded burst.
    semaphore = _asyncio.Semaphore(8)

    async def _one(learner_id: str) -> dict:
        async with semaphore:
            conversations = await mentoring.list_conversations(learner_id, "teacher")
        return {"learner_id": learner_id, "conversations": conversations}

    rows = await _asyncio.gather(*(_one(learner_id) for learner_id in learner_ids))
    return _ok({"learners": rows})


@router.get("/groups/{group_id}/learnings")
async def group_learnings(
    group_id: str,
    subject: Optional[str] = Query(None),
    language: str = Query("he"),
    session=Depends(require_teacher_session),
):
    """Per-learning class analytics: engagement, success, time, hard questions.

    The "AI analysis" lane rides the existing gaps engine — the recommendations
    already carry `because`, so this screen inherits explainability rather than
    inventing a second analysis path.
    """
    if not await _guard_group(session, group_id):
        return _denied()
    from app.services import learning_analytics
    lang = normalize_language(language)
    view = await learning_analytics.group_learnings(
        group_id, subject=subject, language=lang
    )
    gaps = await group_analytics.learning_gaps(group_id, subject=subject)
    view["recommendations"] = group_analytics.group_recommendations(gaps, lang)
    await _report(session, "learning-group")
    return _ok(view)


@router.get("/groups/{group_id}/learnings/{component_id:path}")
async def group_learning_detail(
    group_id: str,
    component_id: str,
    language: str = Query("he"),
    session=Depends(require_teacher_session),
):
    """One learning opened up: per-question and per-screen class results."""
    if not await _guard_group(session, group_id):
        return _denied()
    from app.services import learning_analytics
    view = await learning_analytics.learning_detail(
        group_id, component_id, language=normalize_language(language)
    )
    await _report(session, "learning-group")
    return _ok(view)


# ── student ──────────────────────────────────────────────────────────────────

@router.get("/students/{learner_id}")
async def student_overview(
    learner_id: str,
    subject: Optional[str] = Query(None),
    language: str = Query("he"),
    session=Depends(require_teacher_session),
):
    """Full explainable student view, optionally narrowed to one subject."""
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    view = await insights.student_insights(safe_id, normalize_language(language), subject)
    await _report(session, "student-view")
    return _ok(view)


@router.get("/students/{learner_id}/activity")
async def student_activity(
    learner_id: str,
    component_id: Optional[str] = Query(None),
    subject: Optional[str] = Query(None),
    session=Depends(require_teacher_session),
):
    """Per-question support usage — hints, explanations, chat turns, time.

    This is also where "what Yuvi already tried" comes from, so a teacher never
    walks into a conversation cold.
    """
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    from app.services import learner_activity
    rows = await learner_activity.question_summary(
        safe_id, component_id=component_id, subject=subject
    )
    return _ok({"questions": rows})


@router.get("/students/{learner_id}/badges")
async def student_badges(
    learner_id: str,
    lang: str = Query("he"),
    session=Depends(require_teacher_session),
):
    """Badges as learning evidence (design doc §22.7)."""
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    from app.brain.repository import get_brain
    from app.services.badges import project_badges
    from app.services.events import get_learner_events

    brain = await get_brain(safe_id)
    try:
        events = await get_learner_events(safe_id)
    except Exception:
        events = []
    return _ok({"badges": project_badges(brain, locale=lang, events=events)})


@router.get("/students/{learner_id}/reflections")
async def student_reflections(learner_id: str, session=Depends(require_teacher_session)):
    """Self-assessment vs. system assessment (nice-to-have §2)."""
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    from app.brain.repository import get_brain
    brain = await get_brain(safe_id)
    reflections = brain.get("reflections_recent") or []
    return _ok({
        "reflections": reflections,
        "self_awareness": insights._self_awareness_gap(reflections),
    })


# ── teacher-authored insights (MUST S3) ──────────────────────────────────────

@router.get("/students/{learner_id}/insights")
async def list_insights(learner_id: str, session=Depends(require_teacher_session)):
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    return _ok({"insights": await teacher_insights_store.list_for(safe_id)})


@router.post("/students/{learner_id}/insights")
async def create_insight(
    learner_id: str, data: dict, session=Depends(require_teacher_session)
):
    """Record a teacher's own read of the learner, into the learner profile.

    `visibility: "coach"` additionally steers what Yuvi says to the child — the
    client must label that explicitly; it is never the default.
    """
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    try:
        insight = await teacher_insights_store.create(
            learner_id=safe_id,
            teacher_id=session["sub"],
            kind=(data.get("kind") or "note"),
            text=data.get("text") or "",
            subject=data.get("subject"),
            visibility=(data.get("visibility") or "private"),
        )
    except ValueError as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=400, headers=_NO_STORE)
    return _ok(insight)


@router.delete("/students/{learner_id}/insights/{insight_id}")
async def delete_insight(
    learner_id: str, insight_id: str, session=Depends(require_teacher_session)
):
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    removed = await teacher_insights_store.soft_delete(insight_id, learner_id=safe_id)
    if not removed:
        return JSONResponse(content={"error": "not_found"}, status_code=404, headers=_NO_STORE)
    return _ok({"deleted": True})


# ── goals (F6 → F5) ──────────────────────────────────────────────────────────

@router.get("/students/{learner_id}/goals")
async def list_student_goals(learner_id: str, session=Depends(require_teacher_session)):
    """The learner's goals, teacher view.

    `viewer_role="teacher"` is what includes `teacher_only_note`; a learner-role
    read of the same conversations must never see it.
    """
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    from app.services import mentoring
    return _ok({"conversations": await mentoring.list_conversations(safe_id, "teacher")})


@router.post("/students/{learner_id}/goals/suggest")
async def suggest_student_goals(
    learner_id: str, data: dict, session=Depends(require_teacher_session)
):
    """Three AI drafts, each carrying the observation it came from.

    Drafts only — nothing is written to the learner's profile here. The teacher
    edits and then calls the assign endpoint, so the model can never put a goal
    in front of a child unattended.
    """
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    from app.services import mentoring_assist
    goals = await mentoring_assist.suggest_goals_for_teacher(
        safe_id, session["sub"],
        language=normalize_language(data.get("language")),
        subject=data.get("subject"),
    )
    return _ok({"goals": goals})


@router.post("/students/{learner_id}/goals")
async def assign_student_goal(
    learner_id: str, data: dict, session=Depends(require_teacher_session)
):
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    from app.services import goal_approval
    try:
        record = await goal_approval.assign_goal(
            session["sub"], safe_id, data.get("goal") or data,
            language=normalize_language(data.get("language")),
        )
    except goal_approval.ApprovalError as exc:
        status = 403 if exc.code == "not_authorized" else 400
        return JSONResponse(content={"error": exc.code}, status_code=status, headers=_NO_STORE)
    return _ok(record)


@router.post("/students/{learner_id}/goals/{goal_id}/approve")
async def approve_student_goal(
    learner_id: str, goal_id: str, data: dict, session=Depends(require_teacher_session)
):
    """Approve → sparks → the learner's bell.

    The response is deliberately explicit about `granted`, `already_earned` and
    `capped`: a goal the learner already summarized pays nothing, and so does the
    fifth approval of the day. Both are true outcomes the teacher should see
    rather than a silent zero.
    """
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    from app.services import goal_approval
    try:
        result = await goal_approval.approve_goal(
            session["sub"], safe_id,
            str(data.get("conversation_id") or ""), goal_id,
            teacher_note=str(data.get("teacher_note") or ""),
            language=normalize_language(data.get("language")),
        )
    except goal_approval.ApprovalError as exc:
        status = 403 if exc.code == "not_authorized" else 404
        return JSONResponse(content={"error": exc.code}, status_code=status, headers=_NO_STORE)
    return _ok(result)


@router.post("/groups/{group_id}/goals/assign")
async def assign_group_goal(
    group_id: str, data: dict, session=Depends(require_teacher_session)
):
    """One goal to several learners — the actionable form of "split into
    sub-groups" from the learning-gaps panel."""
    if not await _guard_group(session, group_id):
        return _denied()
    from app.services import goal_approval
    try:
        result = await goal_approval.assign_to_group(
            session["sub"], group_id,
            [str(value) for value in (data.get("learner_ids") or [])],
            data.get("goal") or {},
            language=normalize_language(data.get("language")),
        )
    except goal_approval.ApprovalError as exc:
        status = 403 if exc.code == "not_authorized" else 400
        return JSONResponse(content={"error": exc.code}, status_code=status, headers=_NO_STORE)
    return _ok(result)


# ── Phase 7: moments, kudos, digest, meeting prep ────────────────────────────

@router.get("/groups/{group_id}/moments")
async def group_moments(
    group_id: str,
    days: int = Query(14, ge=1, le=60),
    limit: int = Query(25, ge=1, le=60),
    language: str = Query("he"),
    session=Depends(require_teacher_session),
):
    """The story of the class — what changed, newest first (A11 #2)."""
    if not await _guard_group(session, group_id):
        return _denied()
    from app.services import moments

    rows = await moments.moments_for_group(
        group_id, language=normalize_language(language), days=days, limit=limit)
    return _ok({"moments": rows})


@router.get("/students/{learner_id}/moments")
async def student_moments(
    learner_id: str,
    days: int = Query(14, ge=1, le=60),
    limit: int = Query(20, ge=1, le=60),
    language: str = Query("he"),
    session=Depends(require_teacher_session),
):
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    from app.services import moments

    rows = await moments.moments_for_learner(
        safe_id, language=normalize_language(language), days=days, limit=limit)
    return _ok({"moments": rows})


@router.post("/students/{learner_id}/kudos")
async def send_kudos(
    learner_id: str, data: dict, session=Depends(require_teacher_session)
):
    """Teacher praise, delivered by Yuvi in the learner's own chat (A11 #4)."""
    from app.services import kudos as kudos_service

    try:
        record = await kudos_service.send_kudos(
            session["sub"], normalize_learner_id(learner_id),
            str(data.get("message") or ""),
            moment=data.get("moment") if isinstance(data.get("moment"), dict) else None,
            language=normalize_language(data.get("language")),
        )
    except kudos_service.KudosError as exc:
        status = 403 if exc.code == "not_authorized" else 400
        return JSONResponse(content={"error": exc.code}, status_code=status, headers=_NO_STORE)
    return _ok({"kudos_id": record["_id"], "message": record["message"]})


@router.get("/students/{learner_id}/kudos")
async def list_kudos(
    learner_id: str, session=Depends(require_teacher_session)
):
    """This teacher's own praise record for the learner — the messages screen.

    Scoped twice: the learner guard first, then filtered to the requesting
    teacher — a co-teacher's private words to a child are theirs, not shared
    staff-room material.
    """
    from app.services import kudos as kudos_service

    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    rows = await kudos_service.list_for_learner(safe_id, limit=50)
    return _ok({"kudos": [
        {
            "id": row["_id"],
            "message": row.get("message") or "",
            "created_at": row.get("created_at"),
            "delivered_at": row.get("delivered_at"),
        }
        for row in rows if row.get("teacher_id") == session["sub"]
    ]})


@router.get("/groups/{group_id}/digest")
async def group_digest(
    group_id: str,
    language: str = Query("he"),
    refresh: bool = Query(False),
    session=Depends(require_teacher_session),
):
    """This week's three-bullet brief, cached per group per week (A11 #3)."""
    if not await _guard_group(session, group_id):
        return _denied()
    from app.services import weekly_digest

    digest = await weekly_digest.get_digest(
        group_id, language=normalize_language(language), force=refresh)
    return _ok(digest)


@router.get("/students/{learner_id}/meeting-prep")
async def student_meeting_prep(
    learner_id: str,
    language: str = Query("he"),
    session=Depends(require_teacher_session),
):
    """Questions, insights and goal ideas for a one-to-one — each with its why."""
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    from app.services import mentoring_assist

    prep = await mentoring_assist.suggest_meeting_prep(
        safe_id, session["sub"], language=normalize_language(language))
    return _ok(prep)
