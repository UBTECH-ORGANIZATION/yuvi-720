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
from app.brain.repository import get_brain
from app.services.dashboard import project_dashboard
from learner_state import normalize_learner_id  # type: ignore


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
    return JSONResponse(content=project_dashboard(brain, brain.get("identity", {}).get("display_name") or "", lang))


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
