"""Teacher data routes (F6) — thin: authorize, delegate, report.

Two invariants every route in this file keeps:

* **Access is checked before any brain read.** `_guard` raises 403 first; no
  handler touches learner data before it returns.
* **The LRS `dashboard viewed` statement is emitted only AFTER the check
  passes.** A 403 must never produce a "viewed" event — the teacher did not see
  anything.
"""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from app.auth.dependencies import require_teacher_session
from app.brain import org
from app.core.localization import normalize_language
from app.services import (
    group_analytics, insights, kata_client, student_model_insight, teacher_insights_store,
)
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


# ── group ────────────────────────────────────────────────────────────────────

@router.get("/groups/{group_id}/snapshot")
async def group_snapshot(
    group_id: str,
    language: str = Query("he"),
    days: int = Query(7, ge=1, le=120),
    session=Depends(require_teacher_session),
):
    """Group state: aggregate trends + per-student attention flags (F6 group §1).

    Takes no `subject`: `group_insights` has no such parameter, so the one this
    signature used to declare was accepted and dropped on the floor. Harmless
    while the scope subject was permanently null, and a lie the moment a teacher
    could set one — the screens that read this endpoint (Home, the roster) are
    class-wide by design, and narrowing "who needs attention" by subject is a
    pedagogy question, not plumbing. Tracked as its own ADO item.

    It DOES take `days` — the dashboard's period — because that re-judges every
    band: over a month, a week of quiet is not the red signal it is over three
    days.
    """
    if not await _guard_group(session, group_id):
        return _denied()
    view = await insights.group_insights(
        group_id, normalize_language(language), window_days=days)
    await _report(session, "learning-group")
    return _ok(view)


@router.get("/groups/{group_id}/engagement")
async def group_engagement(
    group_id: str,
    days: int = Query(7, ge=1, le=90),
    subject: Optional[str] = Query(None),
    session=Depends(require_teacher_session),
):
    """% active learners + average active minutes (F6 group §1, engagement)."""
    if not await _guard_group(session, group_id):
        return _denied()
    return _ok(await group_analytics.engagement(
        group_id, days=days, subject=subject or None))


@router.get("/groups/{group_id}/mood")
async def group_mood(
    group_id: str,
    days: int = Query(7, ge=1, le=120),
    session=Depends(require_teacher_session),
):
    """How the class has been feeling over the window, and the one before it.

    The daily check-in has been storing an answer per child per school day
    since #452. Counts by valence lead; the current window also names the
    children behind each family (#505) so the teacher can open the right
    conversation — the same per-child feeling the live view already shows.
    Never a ranking and never an alarm (C5): the compare window stays
    aggregate, and each child's own history lives on their profile strip.
    """
    if not await _guard_group(session, group_id):
        return _denied()
    return _ok(await group_analytics.class_mood(group_id, days=days))


@router.get("/groups/{group_id}/gaps")
async def group_gaps(
    group_id: str,
    subject: Optional[str] = Query(None),
    language: str = Query("he"),
    days: int = Query(0, ge=0, le=120),
    session=Depends(require_teacher_session),
):
    """Group learning gaps + sub-group teaching moves (nice-to-have §3–4).

    `days` narrows to the objectives the class worked on in that trailing
    window and returns the window before it as `previous`, so the dashboard can
    say what the class is stuck on now AND what it was stuck on before. The
    default of 0 means the whole history — the shape every other caller reads.
    """
    if not await _guard_group(session, group_id):
        return _denied()
    if days:
        windows = await group_analytics.learning_gaps_compared(
            group_id, days=days, subject=subject)
        gaps, previous = windows["gaps"], windows["previous"]
    else:
        gaps, previous = await group_analytics.learning_gaps(
            group_id, subject=subject), []
    return _ok({
        "gaps": gaps,
        "previous_gaps": previous,
        "window_days": days or None,
        "recommendations": group_analytics.group_recommendations(
            gaps, normalize_language(language)
        ),
    })


@router.get("/groups/{group_id}/gaps/{objective_id}/diagnosis")
async def gap_diagnosis(
    group_id: str,
    objective_id: str,
    language: str = Query("he"),
    session=Depends(require_teacher_session),
):
    """The real answer behind a gap row's "למה?" (#507).

    The row's counters already say how many are stuck; this says WHERE inside
    the objective, on WHICH questions, and HOW it goes wrong — folded from
    stored evidence only (activity rows, the coach's own error-type reads),
    never generated. Read on click, not with the page: it fans out over the
    roster's events and decisions, and a teacher opens one gap at a time.
    """
    if not await _guard_group(session, group_id):
        return _denied()
    from app.services import learning_analytics
    return _ok(await learning_analytics.gap_diagnosis(
        group_id, objective_id, language=normalize_language(language)))


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
    from app.services import goal_progress, mentoring

    learner_ids = await org.learners_in_group(group_id)

    # Bounded fan-out: a class is ~30 learners, but never let one slow document
    # store turn this into an unbounded burst.
    semaphore = _asyncio.Semaphore(8)

    async def _one(learner_id: str) -> dict:
        async with semaphore:
            # No price backfill: this runs once per learner in the class, and
            # the pricing pass is per-learner bounded, not per-request.
            conversations = await mentoring.list_conversations(
                learner_id, "teacher", price_backfill=False)
            # Counts read nothing for learners with no action-tracked goal.
            await goal_progress.enrich_conversations(learner_id, conversations)
        return {"learner_id": learner_id, "conversations": conversations}

    rows = await _asyncio.gather(*(_one(learner_id) for learner_id in learner_ids))
    return _ok({"learners": rows})


@router.get("/groups/{group_id}/subjects")
async def group_subjects(
    group_id: str,
    language: str = Query("he"),
    session=Depends(require_teacher_session),
):
    """Which subjects this class can be narrowed to.

    Feeds the scope bar, which offers exactly these and nothing else. Per class
    rather than a fixed list because the portal's previous constant — math and
    science — was a guess that could not name a subject the class actually works
    in.
    """
    if not await _guard_group(session, group_id):
        return _denied()
    from app.services import learning_analytics
    return _ok({"subjects": await learning_analytics.class_subjects(
        group_id, language=normalize_language(language),
    )})


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
    import asyncio as _asyncio
    view, pulse = await _asyncio.gather(
        learning_analytics.group_learnings(group_id, subject=subject, language=lang),
        learning_analytics.learnings_pulse(group_id, subject=subject),
    )
    # The KPI strip's week-over-week figures; the all-time totals stay for the
    # catalogue coverage number.
    view["pulse"] = pulse
    gaps = await group_analytics.learning_gaps(group_id, subject=subject)
    view["recommendations"] = group_analytics.group_recommendations(gaps, lang)
    await _report(session, "learning-group")
    return _ok(view)


@router.post("/groups/{group_id}/learnings/find")
async def find_group_learnings(
    group_id: str, data: dict, session=Depends(require_teacher_session),
):
    """The pin dialog's smart search: a teacher's free-text description in,
    up to three ranked catalog matches out (or one adjacent-topic hint when
    nothing fits). Grounded in the group's own catalog — the service drops
    any id the model did not read off that list."""
    if not await _guard_group(session, group_id):
        return _denied()
    query = str(data.get("query") or "").strip()
    if not query or len(query) > 300:
        raise HTTPException(status_code=422, detail="bad_query")
    subject = str(data.get("subject") or "").strip() or None
    from app.services import learning_finder
    result = await learning_finder.find_learnings(
        group_id,
        query=query,
        subject=subject,
        language=normalize_language(str(data.get("language") or "he")),
        teacher_id=str(session.get("sub") or ""),
    )
    return _ok(result)


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
    language: str = Query("he"),
    session=Depends(require_teacher_session),
):
    """Per-question support usage — hints, explanations, chat turns, time.

    This is also where "what Yuvi already tried" comes from, so a teacher never
    walks into a conversation cold.
    """
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    from app.services import kata_catalog, learner_activity, learning_analytics

    rows = await learner_activity.question_summary(
        safe_id, component_id=component_id, subject=subject
    )
    # The catalogue is what turns `q1` into "שאלה 2 · סעיף א" and a component id
    # into a lesson name, so it has to be loaded before the rows are labelled.
    # A failure degrades to unlabelled rows rather than to no activity at all.
    try:
        await kata_catalog.ensure_loaded()
    except Exception:
        pass
    # Stored topic names + authored question text (#455): the same maps the
    # class-wide detail rides, so both screens name the same question the same
    # way. Read-only here — this path never generates.
    from app.services import question_topics

    lang = normalize_language(language)
    component_ids = list(dict.fromkeys(
        row.get("component_id") for row in rows if row.get("component_id")
    ))
    topics = await question_topics.topics_for_components(component_ids, lang)
    texts: dict[str, Optional[str]] = {}
    for cid in component_ids:
        texts.update(learning_analytics.question_texts(cid))
    return _ok({"questions": learning_analytics.label_learner_rows(
        rows, language=lang, topics=topics, texts=texts)})


@router.get("/students/{learner_id}/trends")
async def student_trends(
    learner_id: str,
    days: int = Query(30, ge=7, le=120),
    session=Depends(require_teacher_session),
):
    """The series behind the profile's charts — one learner, never a group."""
    from app.services import learner_trends

    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    return _ok(await learner_trends.learner_trends(safe_id, days=days))


@router.get("/students/{learner_id}/scores")
async def student_scores(
    learner_id: str,
    session=Depends(require_teacher_session),
):
    """Independence & Concentration (PBI 451) — weighted, evidence-gated,
    teacher-only. Every sub-score ships its raw evidence; missing signals are
    renormalized and reported in `coverage`, never silently scored around."""
    from app.services import learner_scores

    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    return _ok(await learner_scores.student_scores(safe_id))


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


@router.get("/students/{learner_id}/focus/roadmap")
async def student_focus_roadmap(
    learner_id: str,
    language: str = Query("he"),
    session=Depends(require_teacher_session),
):
    """The planner played forward: what it will serve after each completion.

    Deterministic — the same ranking function the live focus uses, run over a
    simulated mastery table. No model call, no store write."""
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    from app.brain.repository import get_brain
    from app.services import kata_catalog, planner

    try:
        await kata_catalog.ensure_loaded()
    except Exception:
        pass
    brain = await get_brain(safe_id)
    lang = normalize_language(language)
    steps = [
        {**step,
         "objective_title": kata_catalog.objective_title(step["objective_id"], lang)
         if step.get("objective_id") else None}
        for step in planner.focus_roadmap(brain)
    ]
    # Registry titles collide at sub-topic level; two identical stops on one
    # road read as a loop. The sub-material (unit) name rides along as its own
    # field instead of replacing the title — so every stop still says the same
    # words as the focus card, and the subtitle is what tells twins apart.
    for step in steps:
        step["unit_title"] = None
        if step.get("objective_id"):
            unit_ids = (kata_catalog.get_objective(step["objective_id"]) or {}).get("unit_ids") or []
            names = [n for n in (kata_catalog.unit_title(u, lang) for u in unit_ids) if n]
            if names:
                step["unit_title"] = " · ".join(dict.fromkeys(names))
    return _ok({"steps": steps})


@router.get("/students/{learner_id}/objectives")
async def student_objectives(
    learner_id: str,
    subject: str = Query(...),
    language: str = Query("he"),
    session=Depends(require_teacher_session),
):
    """The list behind a status dial: every objective in the subject, in
    curriculum order, with this child's mastery state and raw counts."""
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    from app.brain.repository import get_brain
    from app.services import kata_catalog, learner_activity

    try:
        await kata_catalog.ensure_loaded()
    except Exception:
        pass
    brain = await get_brain(safe_id)
    # The dialog says what the child DID on each objective, not only where
    # mastery stands — the same per-question rows the profile reads.
    try:
        activity_rows = await learner_activity.question_summary(safe_id, subject=subject)
    except Exception:
        activity_rows = []
    lang = normalize_language(language)
    rows = insights.objective_breakdown(
        brain, subject=subject, language=lang, activity_rows=activity_rows)

    # The hierarchy under each objective: its lomdot, wearing the SAME
    # projected states the child's own track shows (completed / current /
    # available / locked) — the ONE path engine, never a re-derivation.
    # Best-effort: a projection that fails leaves that objective flat.
    import asyncio as _asyncio

    from app.services.learning_progress import project_unit_roadmap

    unit_jobs: list[tuple[str, dict]] = []
    for objective in kata_catalog.objectives_for(subject):
        objective_id = str(objective.get("id") or "")
        for unit_id in objective.get("unit_ids") or []:
            unit = kata_catalog.get_unit(str(unit_id))
            if unit:
                unit_jobs.append((objective_id, unit))
    projections = await _asyncio.gather(
        *(project_unit_roadmap(unit, safe_id, locale=lang) for _, unit in unit_jobs),
        return_exceptions=True,
    )
    components_of: dict[str, list[dict]] = {}
    for (objective_id, _), projected in zip(unit_jobs, projections):
        if isinstance(projected, BaseException) or not isinstance(projected, dict):
            continue
        for node in projected.get("components") or []:
            components_of.setdefault(objective_id, []).append({
                "id": node.get("id"),
                "title": node.get("title"),
                "state": node.get("progress_state") or "available",
            })
    for row in rows:
        row["components"] = components_of.get(row["objective_id"], [])

    return _ok({"subject": subject, "objectives": rows})


@router.get("/students/{learner_id}/topics/digest")
async def cached_topic_digest(
    learner_id: str,
    language: str = Query("he"),
    subject: Optional[str] = Query(None),
    session=Depends(require_teacher_session),
):
    """The stored why-was-this-hard paragraphs. Never generates, so the profile
    can ask on every open for nothing."""
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    from app.services import topic_digest as digests
    return _ok(await digests.topic_digest(
        safe_id, session["sub"],
        language=normalize_language(language), subject=subject,
        allow_generate=False,
    ))


@router.post("/students/{learner_id}/topics/digest")
async def generate_topic_digest(
    learner_id: str, data: dict, session=Depends(require_teacher_session)
):
    """Write (or refresh) the digest — one mini call for all topics, cached
    until the child's work on them moves. Same answer to the same question."""
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    from app.services import topic_digest as digests
    return _ok(await digests.topic_digest(
        safe_id, session["sub"],
        language=normalize_language(data.get("language")),
        subject=data.get("subject"),
    ))


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


@router.post("/students/{learner_id}/model-insight")
async def add_model_insight(
    learner_id: str, data: dict, session=Depends(require_teacher_session)
):
    """A teacher insight entering the student model itself (#454).

    Unlike `/insights` above (notes beside the model), this writes into what
    Yuvi believes and acts on. A drastic change — touching `how_to_reach`,
    disagreeing with an active belief, or displacing a strongly-evidenced
    sentence — returns 409 with the diff until the client re-posts
    `confirmed: true`, so the warning cannot be skipped.
    """
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    try:
        result = await student_model_insight.add_insight(
            safe_id,
            session["sub"],
            block=str(data.get("block") or ""),
            text=str(data.get("text") or ""),
            confirmed=bool(data.get("confirmed")),
        )
    except student_model_insight.InsightError as exc:
        return JSONResponse(content={"error": exc.code}, status_code=422, headers=_NO_STORE)
    except student_model_insight.DrasticChange as exc:
        return JSONResponse(
            content={"needs_confirmation": True, "diff": exc.diff},
            status_code=409,
            headers=_NO_STORE,
        )
    return _ok(result)


@router.post("/students/{learner_id}/model-insight/withdraw")
async def withdraw_model_insight(
    learner_id: str, data: dict, session=Depends(require_teacher_session)
):
    """The regret path: withdraw a teacher-asserted sentence and restore what
    the model believed beforehand — bi-temporally, nothing erased."""
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    try:
        result = await student_model_insight.withdraw_insight(
            safe_id,
            session["sub"],
            block=str(data.get("block") or ""),
            text=str(data.get("text") or ""),
        )
    except student_model_insight.InsightError as exc:
        return JSONResponse(content={"error": exc.code}, status_code=422, headers=_NO_STORE)
    return _ok(result)


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
    from app.services import goal_progress, mentoring
    conversations = await mentoring.list_conversations(safe_id, "teacher")
    # Goals with a platform action get their count — the number the teacher
    # reads next to "did the child actually do this". No-op when none have one.
    await goal_progress.enrich_conversations(safe_id, conversations)
    return _ok({"conversations": conversations})


@router.get("/students/{learner_id}/goals/suggest")
async def cached_student_goal_suggestions(
    learner_id: str,
    language: str = "he",
    subject: str | None = None,
    session=Depends(require_teacher_session),
):
    """What was already suggested for this learner. Never generates.

    The goals tab opens with this, so a teacher who has been here before sees
    the same three suggestions they saw last time, immediately and for nothing.
    """
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    from app.services import mentoring_assist
    return _ok(await mentoring_assist.goal_suggestions(
        safe_id, session["sub"],
        language=normalize_language(language),
        subject=subject,
        allow_generate=False,
    ))


@router.post("/students/{learner_id}/goals/suggest")
async def suggest_student_goals(
    learner_id: str, data: dict, session=Depends(require_teacher_session)
):
    """Three AI drafts, each carrying the observation it came from.

    Drafts only — nothing is written to the learner's profile here. The teacher
    edits and then calls the assign endpoint, so the model can never put a goal
    in front of a child unattended.

    Cached: this returns what is stored unless the evidence behind it has moved.
    There is no way to ask for a different answer to the same question.
    """
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    from app.services import mentoring_assist
    return _ok(await mentoring_assist.goal_suggestions(
        safe_id, session["sub"],
        language=normalize_language(data.get("language")),
        subject=data.get("subject"),
    ))


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
            # The teacher's MoE session: this path does not go through the
            # learner's route, so without it the goal reports nothing.
            lrs_session_id=session.get("sid"),
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
            lrs_session_id=session.get("sid"),
        )
    except goal_approval.ApprovalError as exc:
        status = 403 if exc.code == "not_authorized" else 400
        return JSONResponse(content={"error": exc.code}, status_code=status, headers=_NO_STORE)
    return _ok(result)


# ── Phase 7: moments, kudos, digest, meeting prep ────────────────────────────

@router.get("/groups/{group_id}/moments")
async def group_moments(
    group_id: str,
    days: int = Query(14, ge=1, le=90),
    offset_days: int = Query(0, ge=0, le=90),
    subject: Optional[str] = Query(None),
    limit: int = Query(25, ge=1, le=60),
    language: str = Query("he"),
    session=Depends(require_teacher_session),
):
    """The story of the class — what changed, newest first (A11 #2).

    `offset_days` slides the window back a whole period, which is how the class
    book asks for the edition BEFORE this one.
    """
    if not await _guard_group(session, group_id):
        return _denied()
    from app.services import moments

    rows = await moments.moments_for_group(
        group_id, language=normalize_language(language), days=days, limit=limit,
        offset_days=offset_days, subject=subject or None)
    return _ok({"moments": rows, "subject": subject or None})


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
    """Teacher praise, delivered by Yuvi in the learner's own chat (A11 #4).

    Praise may carry a gift of sparks (#467). The amount is checked here rather
    than only inside the wallet, because the wallet's answer to a bad figure is
    to grant nothing — which would deliver the good word while quietly dropping
    the sparks the teacher believes they sent.
    """
    from app.services import kudos as kudos_service
    from app.services import rewards

    sparks = data.get("sparks") or 0
    if sparks and not rewards.is_teacher_spark_amount(sparks):
        return JSONResponse(content={"error": "invalid_sparks"},
                            status_code=400, headers=_NO_STORE)

    try:
        record = await kudos_service.send_kudos(
            session["sub"], normalize_learner_id(learner_id),
            str(data.get("message") or ""),
            moment=data.get("moment") if isinstance(data.get("moment"), dict) else None,
            language=normalize_language(data.get("language")),
            sparks=int(sparks or 0),
            draft_id=str(data.get("draft_id") or "") or None,
        )
    except kudos_service.KudosError as exc:
        status = 403 if exc.code == "not_authorized" else 400
        return JSONResponse(content={"error": exc.code}, status_code=status, headers=_NO_STORE)
    return _ok({
        "kudos_id": record["_id"],
        "message": record["message"],
        # What actually landed, not what was asked for.
        "sparks": int(record.get("sparks") or 0),
    })


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


# ── direct messages ──────────────────────────────────────────────────────────
# The teacher's half of the screened channel. The learner's half is in
# `routes/me.py`, where every other learner-scoped route lives — one service
# behind both, so there is exactly one place a message can be written.


@router.get("/students/{learner_id}/messages")
async def list_messages(
    learner_id: str, session=Depends(require_teacher_session)
):
    """This pair's thread, oldest first."""
    from app.services import direct_messages

    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    rows = await direct_messages.list_thread(session["sub"], safe_id)
    return _ok({"messages": [
        {
            "id": row["_id"],
            "sender": row.get("sender"),
            "text": row.get("text") or "",
            "created_at": row.get("created_at"),
            "read_at": row.get("read_at"),
        }
        for row in rows
    ]})


@router.post("/students/{learner_id}/messages")
async def send_message(
    learner_id: str, data: dict, session=Depends(require_teacher_session)
):
    """Write to one learner. Screened before it is stored; 422 if it is refused.

    No `_guard_learner` call here on purpose: `send_message` asserts the pair
    itself, so the check cannot be skipped by a future second caller. Doing it
    twice would also make the 403 depend on which check happened to run first.
    """
    from app.services import direct_messages

    try:
        record = await direct_messages.send_message(
            sender=direct_messages.SENDER_TEACHER,
            teacher_id=session["sub"],
            learner_id=normalize_learner_id(learner_id),
            text=str(data.get("text") or ""),
            language=normalize_language(data.get("language")),
        )
    except direct_messages.DirectMessageError as exc:
        # `detail` is a STRING for a moderation refusal, which is how the client
        # tells it apart from FastAPI's own 422 (whose detail is an array).
        return JSONResponse(content={"detail": exc.code},
                            status_code=exc.status_code, headers=_NO_STORE)
    return _ok({
        "id": record["_id"], "text": record["text"],
        "sender": record["sender"], "created_at": record["created_at"],
    })


@router.patch("/students/{learner_id}/messages/read")
async def mark_messages_read(
    learner_id: str, session=Depends(require_teacher_session)
):
    from app.services import direct_messages

    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    changed = await direct_messages.mark_read(
        session["sub"], safe_id, reader=direct_messages.SENDER_TEACHER)
    return _ok({"read": changed})


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


@router.get("/students/{learner_id}/read")
async def learner_read(
    learner_id: str,
    language: str = Query("he"),
    refresh: bool = Query(False),
    session=Depends(require_teacher_session),
):
    """What Yuvi makes of this student, in words. Cached per child per day.

    The goal composer's left-hand column. Not a draft of a goal — that is
    `/goals/suggest` — but the reading a teacher would otherwise have to
    assemble themselves from four panels on the profile.
    """
    from app.services import learner_read as reads

    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    try:
        return _ok(await reads.get(
            safe_id, session["sub"],
            language=normalize_language(language), refresh=refresh,
        ))
    except reads.LearnerReadError:
        # A blank panel that says why beats an error page over a dialog the
        # teacher opened to do something else entirely.
        return _ok({"unavailable": True})


# ── Mentoring: the talk a goal came out of ───────────────────────────────────

@router.post("/students/{learner_id}/mentoring")
async def document_mentoring(
    learner_id: str, data: dict, session=Depends(require_teacher_session)
):
    """Record a conversation the teacher had, with the goals agreed in it.

    The teacher's counterpart to `POST /api/mentoring`, which is learner-only.
    Until this existed the only way for a teacher to create a mentoring record
    was `POST .../goals`, which makes one conversation per goal and has nowhere
    to put what was discussed.

    Several goals arrive together and become one conversation, so the pricing
    loop, the brain projection, the LRS report and the learner's notification
    each run once for the talk rather than once per goal.
    """
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    from app.services import goal_approval
    try:
        record = await goal_approval.document_conversation(
            session["sub"], safe_id,
            notes=str(data.get("notes") or ""),
            goals=data.get("goals") or [],
            meeting_stage=str(data.get("meeting_stage") or ""),
            teacher_only_note=str(data.get("teacher_only_note") or ""),
            visibility=str(data.get("visibility") or "shared"),
            draft_id=str(data.get("draft_id") or ""),
            language=normalize_language(data.get("language")),
            lrs_session_id=session.get("sid"),
        )
    except goal_approval.ApprovalError as exc:
        status = 403 if exc.code == "not_authorized" else 400
        return JSONResponse(content={"error": exc.code}, status_code=status, headers=_NO_STORE)
    return _ok(record)


@router.post("/students/{learner_id}/mentoring/assist")
async def mentoring_assist_for_teacher(
    learner_id: str, data: dict, session=Depends(require_teacher_session)
):
    """Yuvi helps the teacher write the conversation up.

    The learner's `/api/mentoring/assist` writes in the child's first person,
    so it cannot serve this: a teacher records what a student said, they do not
    say it. Same turn contract, different voice.

    Guarded per learner even though the learner id never enters the prompt —
    the teacher is documenting a conversation with a specific child, and who
    they may write about is exactly the roster question.
    """
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    from app.services import mentoring_assist as assist
    return _ok(await assist.guide_teacher_documentation(
        session["sub"],
        language=normalize_language(data.get("language")),
        qa=data.get("qa"),
        notes=str(data.get("notes") or ""),
        more=bool(data.get("more")),
    ))


@router.post("/students/{learner_id}/mentoring/goal-ideas")
async def mentoring_goal_ideas(
    learner_id: str, data: dict, session=Depends(require_teacher_session)
):
    """Goals that follow from the write-up the teacher just wrote.

    The other flavour — `/goals/suggest` — reads observed evidence and never
    sees the conversation. Both are offered side by side on the goals step,
    because "what the numbers say" and "what we just agreed" are different
    questions and a teacher wants both.
    """
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    from app.services import mentoring_assist as assist
    goals = await assist.suggest_goals_from_conversation(
        safe_id, session["sub"],
        language=normalize_language(data.get("language")),
        notes=str(data.get("notes") or ""),
        count=int(data.get("count") or 3),
    )
    return _ok({"goals": goals})


@router.get("/goals/pending-count")
async def pending_goal_count(
    group_id: str | None = None, session=Depends(require_teacher_session)
):
    """How many finished goals in the selected class await sign-off.

    Its own endpoint, and deliberately the cheapest one in this file: the app
    bar shows this number on every screen, so a teacher learns there is
    something waiting without having to open the mentoring page to find out.
    `GET /groups/{id}/goals` would answer the same question by shipping every
    conversation of every learner on every page load.

    `group_id` narrows to one class so the badge agrees with the class picker
    and with the inbox under it. It is honored only when it names one of the
    session's own groups — a foreign id counts nothing rather than leaking a
    number. Without it, the count spans every class the teacher has.
    """
    from app.brain import org
    from app.services import mentoring

    groups = await org.groups_for_teacher(session["sub"])
    if group_id:
        groups = [g for g in groups if str(g.get("_id") or "") == group_id]
    learner_ids: list[str] = []
    seen: set[str] = set()
    for group in groups:
        for learner_id in await org.learners_in_group(str(group.get("_id") or "")):
            if learner_id not in seen:
                seen.add(learner_id)
                learner_ids.append(learner_id)

    return _ok({"count": await mentoring.count_pending_approvals(learner_ids)})


@router.delete("/students/{learner_id}/mentoring/{conversation_id}")
async def remove_mentoring(
    learner_id: str, conversation_id: str, session=Depends(require_teacher_session)
):
    """Remove a conversation this teacher documented.

    Filing a talk against the wrong child was, until now, permanent: the
    service refused every delete whose author was not the learner, which was
    the right rule while `assign_goal` was the only way a teacher could make a
    record — it wrote a goal, not a paragraph about a student. The composer
    writes paragraphs, so the mistake it makes possible needs an undo.

    The scope gate answers "may you see this child"; `mentoring.delete_
    conversation` answers the narrower question this actually turns on — did
    YOU write it. A colleague's write-up, and a child's own reflection, are
    both refused here.
    """
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    from app.services import mentoring

    outcome = await mentoring.delete_conversation(
        safe_id, conversation_id, actor="teacher", teacher_id=session["sub"],
    )
    if outcome == "not_found":
        return JSONResponse({"ok": False, "error": "not_found"}, status_code=404)
    if outcome == "forbidden":
        return _denied()
    return _ok({"deleted": True})


# ── pinning (#249 shipped the component slice; #244 completed the instrument) ─

class _BadPin(Exception):
    """A pin request that must not become a pin; `.args[0]` is the 422 error."""


async def _build_pin(
    data: dict, learner_id: str, teacher_id: str
) -> dict[str, Any]:
    """Resolve a pin request into the record the brain stores.

    Exactly one target: `objective_id` (a learning GOAL — the planner keeps
    allocating the fitting component inside it), `launch_id` (a task the
    learner was actually assigned), or `component_id` (kept for older callers
    and live #249 pins). Everything else on the record is resolved
    server-side, so the stored pin can never disagree with what the learner's
    route will actually open. An id we cannot resolve raises `_BadPin`, a
    422, never a pin that silently steers nowhere.
    """
    from datetime import datetime, timezone

    from app.services import kata_catalog

    # No end date, by design (Gal, 2026-08-30): a pin holds until the child
    # finishes what it points at, or until the teacher unpins it.
    base = {
        "pinned_by": teacher_id,
        "pinned_at": datetime.now(timezone.utc).isoformat(),
    }

    launch_id = str(data.get("launch_id") or "")
    if launch_id:
        from app.services.tasks import store as task_store

        # The activation IS the authorization boundary — the same rule the
        # learner's own `/api/tasks/{launch_id}` applies. A task the child was
        # never given cannot be made their next step.
        activation = await task_store.get_activation(launch_id, learner_id)
        if activation is None:
            raise _BadPin("not_assigned")
        task_id = task_store.task_of_launch(launch_id)
        task = await task_store.get_task(task_id) or {}
        return {
            "kind": "task",
            "task_id": task_id,
            "launch_id": launch_id,
            # Frozen at pin time: the one honest headline for content the
            # catalog has never seen, and the notification's title too.
            "title": (task.get("spec") or {}).get("title") or "",
            **base,
        }

    # A `component_id` wins over a stray `objective_id` riding the same body:
    # #249 clients sent the component with its coordinates alongside, and
    # those coordinates must stay ignored, never promoted to the target.
    component_id = str(data.get("component_id") or "")
    if component_id:
        component = kata_catalog.get_component(component_id)
        if component is None:
            raise _BadPin("unknown_component")
        return {
            "kind": "component",
            "component_id": component_id,
            "unit_id": component.get("unit_id"),
            "objective_id": component.get("objective_id"),
            "pinned_by": teacher_id,
            **base,
        }

    objective_id = str(data.get("objective_id") or "")
    objective = kata_catalog.get_objective(objective_id) if objective_id else None
    if objective is None:
        raise _BadPin("unknown_objective")
    return {
        "kind": "objective",
        "objective_id": objective_id,
        # The subject rides the record so the class focus map can label
        # the row without resolving the objective per learner.
        "subject": objective.get("subject"),
        **base,
    }


async def _write_pin(safe_id: str, pin: dict[str, Any], actor_id: str) -> None:
    """Store one learner's pin and ring their bell once.

    Shared by the single and the bulk routes so the two can never drift on
    what a pin write means. The notification id is deterministic per (learner,
    target): a retry or double-click re-writes the same object and rings no
    second bell; a different target is a new fact and rings once.
    """
    from app.brain.repository import apply_brain_updates
    from app.services import kata_catalog, notifications

    await apply_brain_updates(safe_id, {"pinned_next": pin})

    if pin.get("kind") == "task":
        target = str(pin["launch_id"])
        title = pin.get("title") or ""
        action = {"label_key": "notif.action.openTask", "route": f"/tasks/{target}"}
    elif pin.get("kind") == "objective":
        # A goal, not a single lesson: WHICH component serves it is re-judged
        # per read, so the bell points at the dashboard hero — the surface
        # that always shows the goal's current allocation.
        target = str(pin["objective_id"])
        title = kata_catalog.localized_objective_title(target, "he") or ""
        action = {"label_key": "notif.action.openLesson", "route": "/student-dashboard"}
    else:
        target = str(pin["component_id"])
        title = (kata_catalog.get_component(target) or {}).get("title") or ""
        action = {
            "label_key": "notif.action.openLesson",
            "route": (
                f"/learning/lesson?component={target}"
                + (f"&unit={pin['unit_id']}" if pin.get("unit_id") else "")
            ),
        }
    await notifications.notify(
        safe_id,
        notifications.KIND_PINNED_NEXT,
        notification_id=f"pinned_next:{safe_id}:{target}",
        title_key="notif.pinnedNext",
        params={"title": title},
        actions=[action],
        actor_id=actor_id,
    )


@router.post("/students/{learner_id}/pin-next")
async def pin_next(
    learner_id: str, data: dict, session=Depends(require_teacher_session)
):
    """Pin a catalog component or an assigned task as this learner's next step.

    Written via `apply_brain_updates` — the authenticated portal write lane,
    the same one directives use — never an agent write scope.
    """
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()

    from app.services import kata_catalog

    await kata_catalog.ensure_loaded()
    try:
        pin = await _build_pin(data, safe_id, session["sub"])
    except _BadPin as error:
        return JSONResponse(
            content={"error": error.args[0]}, status_code=422, headers=_NO_STORE
        )
    await _write_pin(safe_id, pin, session["sub"])
    return _ok({"pinned": pin})


@router.post("/groups/{group_id}/pin-next")
async def bulk_pin_next(
    group_id: str, data: dict, session=Depends(require_teacher_session)
):
    """One pin, many children: a class, a sub-group, or a named few (#244).

    Membership resolves through `tasks.assign.resolve_targets` — the one path
    that re-reads a sub-group against the live roster and refuses a foreign
    target BEFORE any write, so a stale member list can neither pin a child
    who left nor skip one who joined. The pin target is validated once; what
    is per-child is only the task activation check, and a child the task was
    never given is reported in `skipped`, never silently pinned to a 404.
    """
    if not await _guard_group(session, group_id):
        return _denied()

    from app.services import kata_catalog
    from app.services.tasks.assign import AssignError, resolve_targets

    await kata_catalog.ensure_loaded()
    targets = data.get("targets") or []
    try:
        learner_ids = await resolve_targets(session["sub"], targets)
    except AssignError as error:
        code = str(error) or "bad_target"
        if code == "not_authorized":
            return _denied()
        return JSONResponse(
            content={"error": code}, status_code=422, headers=_NO_STORE
        )
    if not learner_ids:
        return JSONResponse(
            content={"error": "no_learners"}, status_code=422, headers=_NO_STORE
        )
    # The same cap the goal fan-out wears: nothing legitimate pins more than a
    # class at once, and a runaway target list must fail loudly, not slowly.
    if len(learner_ids) > 60:
        return JSONResponse(
            content={"error": "too_many_learners"}, status_code=422, headers=_NO_STORE
        )

    pin_body = data.get("pin") or {}
    payload = dict(pin_body)
    launch_id = str(pin_body.get("launch_id") or "")

    # Validate the shared target once, against the first learner — for a
    # component pin the answer is learner-independent, and `_BadPin` here
    # means nobody gets pinned rather than sixty identical failures.
    try:
        first_pin = await _build_pin(payload, learner_ids[0], session["sub"])
    except _BadPin as error:
        if not (launch_id and error.args[0] == "not_assigned"):
            return JSONResponse(
                content={"error": error.args[0]}, status_code=422, headers=_NO_STORE
            )
        first_pin = None

    pinned: list[str] = []
    skipped: list[dict[str, str]] = []
    for index, one in enumerate(learner_ids):
        if launch_id:
            # Per-child boundary: only children the task was actually
            # activated for can have it pinned.
            if index == 0 and first_pin is not None:
                pin = first_pin
            else:
                try:
                    pin = await _build_pin(payload, one, session["sub"])
                except _BadPin:
                    skipped.append({"learner_id": one, "reason": "not_assigned"})
                    continue
        else:
            pin = dict(first_pin or {})
        await _write_pin(one, pin, session["sub"])
        pinned.append(one)

    return _ok({"pinned": pinned, "skipped": skipped})


@router.get("/groups/{group_id}/focus")
async def group_focus(
    group_id: str,
    language: str = Query("he"),
    session=Depends(require_teacher_session),
):
    """Where the planner is pointing each learner right now (#249).

    One row per learner: the subject and objective their route would open on —
    a teacher-set pin included, because the route honours it. This is the
    class-wide version of the profile's "מיקוד": the live view's rows and its
    per-subject division both read from it.

    Deliberately cheap: one brain read per learner and the pure `next_focus`
    over it. The exact next component needs each learner's event history, so
    it lives on the single-learner pin read, never in this fan-out.
    """
    if not await _guard_group(session, group_id):
        return _denied()
    from app.brain.context_engine import today_valid_feeling
    from app.brain.repository import get_brain
    from app.brain.schema import get_path
    from app.services import kata_catalog
    from app.services.dashboard import SUBJECT_NAMES, _t
    from app.services.planner import next_focus

    await kata_catalog.ensure_loaded()
    from app.services import pinning

    lang = normalize_language(language)
    learners = []
    for learner_id in await org.learners_in_group(group_id):
        brain = await get_brain(learner_id)
        # `active_pin` is the shared judgement (#244): an expired pin stops
        # counting here in the same moment it stops steering the child.
        pinned = pinning.active_pin(brain)
        title_override = None
        if pinned is not None and pinning.pin_kind(pinned) == pinning.KIND_TASK:
            # A task has no catalog coordinates; its frozen title is the row.
            subject = None
            objective_id = None
            title_override = pinned.get("title")
            is_pinned = True
        elif pinned is not None and pinning.pin_kind(pinned) == pinning.KIND_OBJECTIVE:
            # The goal itself IS the row — which component serves it today is
            # a per-learner event read this fan-out deliberately skips.
            subject = pinned.get("subject")
            objective_id = pinned.get("objective_id")
            is_pinned = True
        elif pinned is not None:
            component = kata_catalog.get_component(str(pinned["component_id"])) or {}
            subject = component.get("subject")
            objective_id = pinned.get("objective_id") or component.get("objective_id")
            is_pinned = True
        else:
            focus = next_focus(brain)
            subject = focus.get("subject")
            objective_id = focus.get("objective_id")
            is_pinned = False
        # Today's check-in feeling (#452) rides the same brain read — the live
        # row wears it as a small face. Read-side expiry: gone at the Israeli
        # midnight, exactly like the coach's copy.
        feeling = today_valid_feeling(get_path(brain, "current_state.daily_feeling"))
        learners.append({
            "learner_id": learner_id,
            "subject": subject,
            "subject_name": _t(SUBJECT_NAMES, subject, lang) or (subject or ""),
            "objective_id": objective_id,
            "objective_title": title_override
            or (kata_catalog.localized_objective_title(objective_id, lang)
                if objective_id else None),
            "pinned": is_pinned,
            "feeling": (
                {"valence": feeling.get("valence"), "feeling": feeling.get("feeling")}
                if feeling else None
            ),
        })
    return _ok({"learners": learners})


@router.get("/messages-unread")
async def messages_unread(session=Depends(require_teacher_session)):
    """Per-learner unread message counts, plus the total for the nav badge.

    One cheap indexed read over the conversation counters — polled from the
    app bar, so it must never fan out into the threads themselves.
    """
    from app.services import direct_messages

    unread = await direct_messages.unread_for_teacher(session["sub"])
    return _ok({"unread": unread, "total": sum(unread.values())})


@router.get("/students/{learner_id}/pin-next")
async def get_pin_next(
    learner_id: str,
    language: str = Query("he"),
    session=Depends(require_teacher_session),
):
    """The standing pin, plus where the planner is pointing THIS learner.

    The focus panel grounds its recommendation on this: the subject and
    objective the route would open on, and the exact component the planner
    would serve next — so "the step that fits now" is the planner's own answer,
    never a guess over the catalog. One learner, so the event read is fine
    here; the group fan-out (`/groups/{id}/focus`) deliberately omits it.
    """
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    from app.brain.mastery import entry_for
    from app.brain.repository import get_brain
    from app.services import content_catalog, kata_catalog, pinning
    from app.services.dashboard import SUBJECT_NAMES, _t
    from app.services.events import get_learner_events
    from app.services.planner import next_focus
    from app.services.tasks import learner as learner_tasks

    await kata_catalog.ensure_loaded()
    lang = normalize_language(language)
    brain = await get_brain(safe_id)
    # One learner, so the event read is affordable here — and it serves twice:
    # the planner's exact next component, and the spent-pin gate below. This is
    # the single-learner read; the group fan-out deliberately skips both.
    events = await get_learner_events(safe_id)
    completed_ids = content_catalog.completed_component_ids(events)
    focus = next_focus(brain)
    payload: dict[str, Any] = {
        "subject": focus.get("subject"),
        "subject_name": _t(SUBJECT_NAMES, focus.get("subject"), lang)
        or (focus.get("subject") or ""),
        "objective_id": focus.get("objective_id"),
        "objective_title": None,
        "next_component_id": None,
    }
    if focus.get("objective_id"):
        objective_id = str(focus["objective_id"])
        payload["objective_title"] = kata_catalog.localized_objective_title(objective_id, lang)
        plan = content_catalog.objective_plan(
            objective_id,
            mastery_entry=entry_for(brain.get("mastery"), objective_id),
            completed_ids=completed_ids,
            signals=content_catalog.learner_signals(brain),
            locale=lang,
        ) or {}
        payload["next_component_id"] = plan.get("next_component_id")

    # The raw record goes out even when it no longer steers — the teacher who
    # set it must be able to SEE that it lapsed or was already finished;
    # `pin_state` says which reading is true. Judged with `completed_ids`, the
    # SAME gate the hero applies: a pin on a component the child had already
    # finished must not read "active" to the teacher while steering nobody.
    # `last` is how the previous pin ended (#244): "done ✓" and "never pinned"
    # stopped being the same blank.
    raw_pin = brain.get("pinned_next") or None
    pin_state = None
    if raw_pin:
        live = pinning.active_pin(brain, completed_ids=completed_ids)
        if live is not None and pinning.pin_kind(live) == pinning.KIND_OBJECTIVE \
                and pinning.objective_next(live, brain, completed_ids, lang) is None:
            # The goal ran dry for this learner — the same resolution the hero
            # applies, so "active" here can never mean "steering nobody".
            live = None
        pin_state = "active" if live is not None else "spent"

    # What the panel's task tab can offer: openings that are still open and
    # not yet handed in. The learner's own list route builds these rows, so
    # the tab can never offer a paper the child could not actually open.
    tasks = [
        {
            "launch_id": row["launch_id"],
            "task_id": row["task_id"],
            "title": row["title"],
            "due_at": row["due_at"],
            "status": row["status"],
        }
        for row in await learner_tasks.list_for_learner(safe_id)
        if not row["closed"] and row["status"] not in ("submitted", "graded")
    ]

    def _title_of(pin: Optional[dict]) -> Optional[str]:
        """A display name for a stored pin: the task's frozen title, or the
        pinned learning's — resolved here because the profile has no catalog
        of its own to look one up in."""
        if not pin:
            return None
        if pin.get("kind") == "task":
            return pin.get("title") or None
        objective_id = pin.get("objective_id")
        if objective_id:
            title = kata_catalog.localized_objective_title(str(objective_id), lang)
            if title:
                return title
        component = kata_catalog.get_component(str(pin.get("component_id") or ""))
        return (component or {}).get("title") or pin.get("component_id")

    return _ok({
        "pinned": raw_pin,
        "pinned_title": _title_of(raw_pin),
        "pin_state": pin_state,
        "last": brain.get("pinned_last") or None,
        "last_title": _title_of(brain.get("pinned_last")),
        "tasks": tasks,
        "focus": payload,
    })


@router.delete("/students/{learner_id}/pin-next")
async def unpin_next(learner_id: str, session=Depends(require_teacher_session)):
    """Clear the pin. Silent for the learner — un-choosing is not an event a
    child needs a bell for, and the hero simply returns to the planner's pick.

    The ending is recorded (#244): `unpinned`, the teacher withdrew it — the
    only ending besides completion now that a pin has no clock.
    """
    safe_id = await _guard_learner(session, learner_id)
    if safe_id is None:
        return _denied()
    from app.brain.repository import apply_brain_updates, get_brain
    from app.services import pinning

    pin = (await get_brain(safe_id)).get("pinned_next") or {}
    updates: dict[str, Any] = {"pinned_next": None}
    if pin:
        updates["pinned_last"] = pinning.spent_record(pin, pinning.OUTCOME_UNPINNED)
    await apply_brain_updates(safe_id, updates)
    return _ok({"pinned": None})


@router.post("/groups/{group_id}/learnings/{component_id:path}/topics")
async def generate_question_topics(
    group_id: str,
    component_id: str,
    data: dict,
    session=Depends(require_teacher_session),
):
    """Generate-and-store topic names for this lomda's questions (#455).

    The write half of the split: `learning_detail` (the GET) only ever reads
    stored decisions, so opening the screen never pays a model call; this is
    what the client fires once when the detail arrives with `topics_pending`.
    Idempotent and anti-reroll — questions already decided (topic or null) are
    never re-asked; only fingerprint drift (the vendor changed the content)
    regenerates a row.
    """
    if not await _guard_group(session, group_id):
        return _denied()
    from app.services import question_topics

    language = normalize_language(str((data or {}).get("language") or "he"))
    result = await question_topics.ensure_topics(
        component_id, session["sub"], language=language,
    )
    return _ok(result)


@router.post("/learnings/{component_id:path}/preview")
async def preview_learning(
    component_id: str,
    request: Request,
    session=Depends(require_teacher_session),
):
    """A content-only launch URL so the teacher can open the lomda themselves.

    Teacher-scoped, group-free: previewing is looking at the catalog, not at
    learners. The launch carries a sink xAPI context (see
    ``learning_sessions.create_preview_launch``) — nothing a teacher does in
    the preview is recorded anywhere.
    """
    from app.services import learning_sessions

    try:
        view = await learning_sessions.create_preview_launch(
            session["sub"], component_id, request_base_url=str(request.base_url)
        )
    except kata_client.KataError as exc:
        return JSONResponse(content={"error": exc.code}, status_code=exc.status_code)
    return _ok(view)
