"""Learner Brain API routes (P0).

Thin router: validate + delegate to the Context Engine. No prompt logic here.
`GET /api/brain/{learner_id}` returns the UI projection of the brain (this is a
UI surface, so `identity.display_name` is allowed here — it is *never* placed in
an AI prompt; that boundary is the Context bundle, §4.4).
"""

from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.auth.dependencies import assert_can_read_learner, current_user
from app.brain.context_engine import build_coach_bundle, view_for, AgentScopeError
from app.brain.repository import get_brain, apply_brain_updates
from app.services.dashboard import project_dashboard, project_hero_metrics
from app.services.events import get_learner_events
from app.services.lesson_illustrations import find_for_lesson, localized_alt, public_metadata
from learner_state import normalize_learner_id  # type: ignore

import uuid


router = APIRouter(prefix="/api/brain", tags=["brain"])


def _authorized_id(actor: dict[str, Any], learner_id: str) -> str:
    """Sanitize the path id and prove the caller may read it.

    Every route in this router takes `learner_id` from the URL, so without this
    check any authenticated caller could read any learner's brain.
    """
    safe_id = normalize_learner_id(learner_id)
    assert_can_read_learner(actor, safe_id)
    return safe_id


@router.get("/me")
async def read_own_brain(actor: dict = Depends(current_user)):
    """Own brain, so the client never needs to put an id in a URL."""
    return JSONResponse(content=await get_brain(actor["sub"]))


@router.get("/{learner_id}")
async def read_brain(learner_id: str, actor: dict = Depends(current_user)):
    """Return the brain document for UI rendering (dashboards, results, teacher)."""
    brain = await get_brain(_authorized_id(actor, learner_id))
    return JSONResponse(content=brain)


@router.post("/{learner_id}/activeness-goal")
async def create_activeness_goal(learner_id: str, data: dict, actor: dict = Depends(current_user)):
    """Create a learner self-goal derived from an activeness domain (F5 mirror).

    Writes a `visible_to_learner` goal into `brain.goals` so it appears in the
    dashboard "My goals" card, tagged with its source activeness `domain`.
    """
    safe_id = _authorized_id(actor, learner_id)
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
    return JSONResponse(content=goal)


@router.get("/{learner_id}/dashboard")
async def read_dashboard(learner_id: str, lang: str = "he", actor: dict = Depends(current_user)):
    """Return the F4 dashboard DTO projected from the brain (real numbers).

    If mapping scores exist but the profile hasn't been derived yet (e.g. a
    learner migrated from legacy state), seed it via the Onboarding agent so
    competencies/strengths render (same behavior as POST /generate-dashboard).
    """
    safe_id = _authorized_id(actor, learner_id)
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
    dashboard = project_dashboard(
        brain,
        brain.get("identity", {}).get("display_name") or "",
        lang,
    )
    hero = dashboard["hero"]
    events = await get_learner_events(safe_id)
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
    bundle = await build_coach_bundle(_authorized_id(actor, learner_id))
    return JSONResponse(content=bundle)


@router.get("/{learner_id}/view/{agent}")
async def read_agent_view(learner_id: str, agent: str, actor: dict = Depends(current_user)):
    """Return an agent's scoped read view — demonstrates least-context (§5.8)."""
    try:
        view = await view_for(agent, _authorized_id(actor, learner_id))
    except AgentScopeError as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=404)
    return JSONResponse(content=view)
