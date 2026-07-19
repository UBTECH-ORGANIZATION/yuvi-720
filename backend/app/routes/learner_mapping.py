"""Learner mapping questionnaire API routes."""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.agents.onboarding import run_onboarding
from app.auth.dependencies import require_learner
from app.brain.repository import apply_brain_updates
from app.core.localization import normalize_language
from app.services.ai_usage import UsageContext
from learner_state import update_learner_state
from mock_data import DIMENSIONS, calculate_scores, generate_insights, generate_recommendations
from questionnaire_locales import get_questionnaire_for_language


router = APIRouter(prefix="/api", tags=["learner-mapping"])


@router.get("/questionnaire")
async def get_questionnaire(request: Request):
    """Return the full localized questionnaire structure."""
    language = request.query_params.get("lang") or request.query_params.get("language") or "he"
    return JSONResponse(content=get_questionnaire_for_language(language))


@router.get("/dimensions")
async def get_dimensions():
    """Return dimension descriptions."""
    return JSONResponse(content=DIMENSIONS)


@router.post("/submit")
async def submit_questionnaire(data: dict, learner_id: str = Depends(require_learner)):
    """Submit questionnaire answers, score them, and persist mapping results."""
    answers = data.get("answers", {})
    student_name = data.get("student_name", "תלמיד/ה")

    int_answers = {}
    for key, value in answers.items():
        try:
            int_answers[int(key)] = value
        except (ValueError, TypeError):
            int_answers[key] = value

    scores = calculate_scores(int_answers)
    insights = generate_insights(scores)
    recommendations = generate_recommendations(scores)

    result = {
        "student_name": student_name,
        "scores": scores,
        "dimensions": DIMENSIONS,
        "insights": insights,
        "recommendations": recommendations,
    }

    language = normalize_language(data.get("language"))

    # Legacy state kept during migration (dashboard still reads mapping_results).
    await update_learner_state(learner_id, {
        "mapping_results": result,
        # A new questionnaire creates a new profile-verification journey. Never
        # inherit a completed checkpoint from an older mapping submission.
        "profile_summary_progress": None,
    })

    # Seed the brain (F2): mapping_scores via the system lane; the Onboarding
    # agent derives profile/strengths/challenges/activeness (numbers deterministic).
    # display_name is UI-only (§4.1) — stored for the dashboard, never sent to AI.
    await apply_brain_updates(learner_id, {
        "profile.mapping_scores": scores,
        "identity.display_name": student_name,
    })
    try:
        await run_onboarding(
            learner_id,
            scores,
            language,
            free_text=data.get("free_text"),
            usage_context=UsageContext(
                actor_id=learner_id,
                actor_type="learner",
                endpoint="/api/submit",
                feature="feature_2_mapping",
                operation="onboarding.interest_extraction",
                source="learner_mapping_route",
            ),
        )
    except Exception as exc:  # never block the questionnaire on agent failure
        print(f"⚠️ onboarding agent failed (mapping still saved): {exc}")

    return JSONResponse(content=result)