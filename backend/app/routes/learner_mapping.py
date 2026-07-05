"""Learner mapping questionnaire API routes."""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

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
async def submit_questionnaire(data: dict):
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

    await update_learner_state(data.get("learner_id"), {"mapping_results": result})
    return JSONResponse(content=result)