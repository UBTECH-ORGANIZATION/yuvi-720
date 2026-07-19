"""Student dashboard API routes."""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.agents.onboarding import run_onboarding
from app.auth.dependencies import require_learner
from app.brain.repository import get_brain
from app.core.localization import normalize_language
from app.services.dashboard import project_dashboard


router = APIRouter(prefix="/api", tags=["dashboard"])


@router.post("/generate-dashboard")
async def generate_dashboard(data: dict, learner_id: str = Depends(require_learner)):
    """Project the learner brain into the dashboard DTO (F4).

    Numbers are **real** — progress from `mastery`/`progress`, competencies from
    `profile.activeness` — never invented by an LLM (§9). If mapping scores exist
    but the profile hasn't been derived yet, seed it via the Onboarding agent.
    """
    student_name = data.get("student_name", "תלמיד/ה")
    scores = data.get("scores", {})
    language = normalize_language(data.get("language"))

    brain = await get_brain(learner_id)
    if scores and not (brain.get("profile") or {}).get("activeness"):
        try:
            await run_onboarding(learner_id, scores, language)
            brain = await get_brain(learner_id)
        except Exception as exc:
            print(f"⚠️ dashboard onboarding seed failed: {exc}")

    return JSONResponse(content=project_dashboard(brain, student_name, language))
