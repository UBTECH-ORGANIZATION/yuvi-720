"""Learner Brain API routes (P0).

Thin router: validate + delegate to the Context Engine. No prompt logic here.
`GET /api/brain/{learner_id}` returns the UI projection of the brain (this is a
UI surface, so `identity.display_name` is allowed here — it is *never* placed in
an AI prompt; that boundary is the Context bundle, §4.4).
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.brain.context_engine import build_coach_bundle, view_for, AgentScopeError
from app.brain.repository import get_brain
from app.services.dashboard import project_dashboard
from learner_state import normalize_learner_id  # type: ignore


router = APIRouter(prefix="/api/brain", tags=["brain"])


@router.get("/{learner_id}")
async def read_brain(learner_id: str):
    """Return the brain document for UI rendering (dashboards, results, teacher)."""
    brain = await get_brain(normalize_learner_id(learner_id))
    return JSONResponse(content=brain)


@router.get("/{learner_id}/dashboard")
async def read_dashboard(learner_id: str, lang: str = "he"):
    """Return the F4 dashboard DTO projected from the brain (real numbers).

    If mapping scores exist but the profile hasn't been derived yet (e.g. a
    learner migrated from legacy state), seed it via the Onboarding agent so
    competencies/strengths render (same behavior as POST /generate-dashboard).
    """
    safe_id = normalize_learner_id(learner_id)
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
async def read_coach_bundle(learner_id: str):
    """Return the non-identifying Coach Context bundle — proves the PII boundary.

    Useful for verification: this payload is exactly what the Coach agent will
    see, and it must contain no name/PII (§4.1, §11).
    """
    bundle = await build_coach_bundle(normalize_learner_id(learner_id))
    return JSONResponse(content=bundle)


@router.get("/{learner_id}/view/{agent}")
async def read_agent_view(learner_id: str, agent: str):
    """Return an agent's scoped read view — demonstrates least-context (§5.8)."""
    try:
        view = await view_for(agent, normalize_learner_id(learner_id))
    except AgentScopeError as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=404)
    return JSONResponse(content=view)
