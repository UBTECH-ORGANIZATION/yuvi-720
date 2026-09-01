"""Learner Brain API routes (P0).

Thin router: validate + delegate to the Context Engine. No prompt logic here.
`GET /api/brain/{learner_id}` returns the UI projection of the brain (this is a
UI surface, so `identity.display_name` is allowed here — it is *never* placed in
an AI prompt; that boundary is the Context bundle, §4.4).
"""

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.auth.dependencies import assert_can_read_learner, current_user
from app.brain.context_engine import build_coach_bundle, view_for, AgentScopeError
from app.brain.repository import get_brain, apply_brain_updates
from app.services import kata_catalog
from app.services.dashboard import project_dashboard, project_hero_metrics
from app.services.events import get_learner_events
from app.services.lesson_illustrations import find_for_lesson, localized_alt, public_metadata
from learner_state import normalize_learner_id  # type: ignore

import uuid


router = APIRouter(prefix="/api/brain", tags=["brain"])


async def _authorized_id(actor: dict[str, Any], learner_id: str) -> str:
    """Sanitize the path id and prove the caller may read it.

    Every route in this router takes `learner_id` from the URL, so without this
    check any authenticated caller could read any learner's brain.
    """
    safe_id = normalize_learner_id(learner_id)
    await assert_can_read_learner(actor, safe_id)
    return safe_id


@router.get("/me")
async def read_own_brain(actor: dict = Depends(current_user)):
    """Own brain, so the client never needs to put an id in a URL."""
    return JSONResponse(content=await get_brain(actor["sub"]))


@router.get("/{learner_id}")
async def read_brain(learner_id: str, actor: dict = Depends(current_user)):
    """Return the brain document for UI rendering (dashboards, results, teacher)."""
    brain = await get_brain(await _authorized_id(actor, learner_id))
    return JSONResponse(content=brain)


@router.post("/{learner_id}/activeness-goal")
async def create_activeness_goal(learner_id: str, data: dict, actor: dict = Depends(current_user)):
    """Create a learner self-goal derived from an activeness domain (F5 mirror).

    Writes a `visible_to_learner` goal into `brain.goals` so it appears in the
    dashboard "My goals" card, tagged with its source activeness `domain`.

    NOTE: currently has no caller. The affordance lived on the island world's
    activeness map, which was removed in c00747d; `ActivenessWeb` renders the
    same domains but is display-only. Kept rather than deleted because this is
    the only producer of the MoE `student-goal initialized` statement for a
    learner-authored goal — deleting it would turn an unwired 720 F5 flow into
    a missing one. Re-point the dashboard at it when the affordance returns.
    """
    safe_id = await _authorized_id(actor, learner_id)
    text = (data.get("text") or "").strip()
    if not text:
        return JSONResponse(status_code=400, content={"error": "text required"})
    domain = (data.get("domain") or "").strip()
    brain = await get_brain(safe_id)
    goals = list(brain.get("goals") or [])
    goal = {
        "id": f"act-{uuid.uuid4().hex[:8]}",
        "text": text,
        "source": "self",
        "status": "new",
        "steps": {"done": 0, "total": 3},
        "visible_to_learner": True,
        "domain": domain,
        "meta": "activeness",
    }
    goals.append(goal)
    await apply_brain_updates(safe_id, {"goals": goals[-12:]})
    await _report_goal_event(safe_id, "initialized", goal)
    return JSONResponse(content=goal)


async def _report_goal_event(learner_id: str, action: str, goal: dict[str, Any]) -> None:
    """MoE 720 `student-goal` initialized/updated/completed from the REAL goal
    workflow (creation + status changes in the dashboard card). Report-and-forget;
    grouped under the learner's active MoE login session like content forwards."""
    try:
        from app.auth.repository import get_user_by_id
        from app.services.lrs import reporter as lrs_reporter

        user = await get_user_by_id(learner_id)
        session_id = (user or {}).get("current_moe_session_id")
        if not session_id or not goal.get("id"):
            return
        await lrs_reporter.report_student_goal(
            learner_id, session_id, action, str(goal["id"]),
            goal.get("type") or "academic",
        )
    except Exception as exc:  # reporting must never break the goal workflow
        print(f"⚠️ student-goal report skipped: {type(exc).__name__}")


@router.post("/{learner_id}/goals/{goal_id}/status")
async def update_goal_status(
    learner_id: str, goal_id: str, data: dict, actor: dict = Depends(current_user)
):
    """Learner updates a goal's progress from the "My goals" card.

    `in_progress` reports MoE `student-goal/updated`; `done` reports
    `student-goal/completed` — both from this real product action.
    """
    safe_id = await _authorized_id(actor, learner_id)
    status = (data.get("status") or "").strip()
    if status not in {"in_progress", "done"}:
        return JSONResponse(status_code=400, content={"error": "invalid status"})
    brain = await get_brain(safe_id)
    goals = list(brain.get("goals") or [])
    goal = next(
        (g for g in goals if isinstance(g, dict) and str(g.get("id")) == goal_id),
        None,
    )
    if goal is None:
        return JSONResponse(status_code=404, content={"error": "goal not found"})
    goal["status"] = status
    if status == "done":
        goal["done"] = True
        steps = goal.get("steps")
        if isinstance(steps, dict) and steps.get("total"):
            steps["done"] = steps["total"]
    await apply_brain_updates(safe_id, {"goals": goals})
    await _report_goal_event(safe_id, "completed" if status == "done" else "updated", goal)
    return JSONResponse(content=goal)


@router.get("/{learner_id}/dashboard")
async def read_dashboard(learner_id: str, lang: str = "he", actor: dict = Depends(current_user)):
    """Return the F4 dashboard DTO projected from the brain (real numbers).

    If mapping scores exist but the profile hasn't been derived yet (e.g. a
    learner migrated from legacy state), seed it via the Onboarding agent so
    competencies/strengths render (same behavior as POST /generate-dashboard).
    """
    safe_id = await _authorized_id(actor, learner_id)
    await kata_catalog.ensure_loaded()
    brain = await get_brain(safe_id)
    scores = (brain.get("profile") or {}).get("mapping_scores")
    if isinstance(scores, dict) and "scores" in scores and "academic" not in scores:
        scores = scores["scores"]   # tolerate pre-fix legacy blob shape
    if scores and not (brain.get("profile") or {}).get("activeness"):
        try:
            from app.agents.onboarding import run_onboarding
            await run_onboarding(safe_id, scores, lang)
            brain = await get_brain(safe_id)
        except Exception as exc:
            print(f"⚠️ dashboard onboarding seed failed: {exc}")
    events = await get_learner_events(safe_id)
    # Dynamic activeness: the questionnaire base nudged by recent activity.
    from app.brain.activeness import EVIDENCE_SPAN_DAYS, effective_activeness
    from app.agents.tutor_decision import recent_tutor_decisions
    decisions = await recent_tutor_decisions(
        safe_id, since=datetime.now(timezone.utc) - timedelta(days=EVIDENCE_SPAN_DAYS)
    )
    # Its own fetch, spanning both comparison windows. The shared one above is
    # capped by row count, which for an active learner stops short of last week.
    activeness_events = await get_learner_events(
        safe_id, since=datetime.now(timezone.utc) - timedelta(days=EVIDENCE_SPAN_DAYS)
    )
    effective = effective_activeness(brain, activeness_events, decisions)
    # Park the strongest driver per domain on the brain. The companion is a
    # different request with no access to this computation, and without it a kid
    # asking "why did this go down?" gets plausible guesses instead of their week.
    # A list, not a dict: `flatten_updates` deep-merges dicts, which would leave
    # a domain's stale driver behind after it stops driving anything.
    #
    # Only a driver pushing the same way as the arrow. Handing the coach the
    # first one regardless let a domain the card drew in decline be explained in
    # chat as an improvement — the learner was told both, in the same minute.
    def _explaining(row: dict) -> dict | None:
        moved = row["value"] - row["prior_value"]
        if not moved:
            return None
        want = "up" if moved > 0 else "down"
        return next((d for d in row.get("drivers") or [] if d.get("dir") == want), None)

    movement = [
        {"key": key, **driver}
        for key, row in effective.items()
        if (driver := _explaining(row))
    ]
    if movement != ((brain.get("profile") or {}).get("activeness_drivers") or []):
        try:
            await apply_brain_updates(safe_id, {"profile.activeness_drivers": movement})
        except Exception as exc:
            print(f"⚠️ activeness drivers not persisted: {exc}")
    from app.services.content_catalog import completed_component_ids
    dashboard = project_dashboard(
        brain,
        brain.get("identity", {}).get("display_name") or "",
        lang,
        effective_activeness=effective,
        completed_component_ids=completed_component_ids(events),
    )
    hero = dashboard["hero"]
    hero["stats"] = project_hero_metrics(brain, events)
    if hero.get("mode") != "complete":
        asset = await find_for_lesson(hero.get("objectiveId"), hero.get("componentId"))
        if asset:
            illustration = public_metadata(asset, lang)
            illustration["alt"] = localized_alt(
                lang,
                hero.get("objectiveTitle") or "",
                hero.get("subjectName") or "",
            )
            hero["illustration"] = illustration
        else:
            hero["illustration"] = None
    else:
        hero["illustration"] = None
    return JSONResponse(content=dashboard)


@router.get("/{learner_id}/context/coach")
async def read_coach_bundle(learner_id: str, actor: dict = Depends(current_user)):
    """Return the non-identifying Coach Context bundle — proves the PII boundary.

    Useful for verification: this payload is exactly what the Coach agent will
    see, and it must contain no name/PII (§4.1, §11).
    """
    bundle = await build_coach_bundle(await _authorized_id(actor, learner_id))
    return JSONResponse(content=bundle)


@router.get("/{learner_id}/view/{agent}")
async def read_agent_view(learner_id: str, agent: str, actor: dict = Depends(current_user)):
    """Return an agent's scoped read view — demonstrates least-context (§5.8)."""
    try:
        view = await view_for(agent, await _authorized_id(actor, learner_id))
    except AgentScopeError as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=404)
    return JSONResponse(content=view)
