"""Learner mapping questionnaire API routes."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from app.agents.onboarding import run_onboarding
from app.auth.dependencies import optional_user, require_learner, require_learner_session
from app.auth.repository import get_user_by_id, set_agency_started_at
from app.brain.repository import apply_brain_updates
from app.core.localization import normalize_language
from app.services import agency_mapping
from app.services.ai_usage import UsageContext
from app.services.lrs import reporter as lrs_reporter
from learner_state import get_learner_state, update_learner_state
from mock_data import DIMENSIONS, generate_insights, generate_recommendations


router = APIRouter(prefix="/api", tags=["learner-mapping"])


def _normalize_gender(value) -> str:
    return value if value in agency_mapping.SUPPORTED_GENDERS else "male"


@router.get("/questionnaire")
async def get_questionnaire(request: Request, session=Depends(optional_user)):
    """Return the official localized + gender-adapted questionnaire structure."""
    language = normalize_language(
        request.query_params.get("lang") or request.query_params.get("language")
    )
    gender = request.query_params.get("gender")
    # Fall back to the learner's stored gender when the client does not pass one.
    if gender not in agency_mapping.SUPPORTED_GENDERS and session and session.get("sub"):
        try:
            state = await get_learner_state(session["sub"])
            gender = state.get("gender")
        except Exception:
            gender = None
    gender = _normalize_gender(gender)
    # Onboarding started (MoE agency questionnaire): first mapping load of a
    # journey → agency/PRE `initialized`. `agency_started_at` marks the span
    # start; the `completed` at results-approval reports the full duration.
    if session and session.get("sid"):
        try:
            user = await get_user_by_id(session["sub"])
            if user is not None and not user.get("agency_started_at"):
                await set_agency_started_at(
                    session["sub"], datetime.now(timezone.utc).isoformat()
                )
                await lrs_reporter.report_agency_initialized(
                    session["sub"], session["sid"]
                )
        except Exception as exc:  # reporting must never break the questionnaire
            print(f"⚠️ agency initialized report skipped: {type(exc).__name__}")
    return JSONResponse(
        content=agency_mapping.get_questionnaire(language, gender)
    )


@router.get("/dimensions")
async def get_dimensions():
    """Return dimension descriptions."""
    return JSONResponse(content=DIMENSIONS)


@router.post("/submit")
async def submit_questionnaire(data: dict, session=Depends(require_learner_session)):
    """Submit questionnaire answers, score them, and persist mapping results."""
    learner_id = session["sub"]
    answers = data.get("answers", {})
    student_name = data.get("student_name", "תלמיד/ה")
    gender = _normalize_gender(data.get("gender"))

    int_answers = {}
    for key, value in answers.items():
        try:
            int_answers[int(key)] = value
        except (ValueError, TypeError):
            int_answers[key] = value

    # Compliance gate: the MoE questionnaire may not be submitted until every
    # question is answered (§ "אין לאפשר ללומד להגיש את השאלון ללא מענה מלא").
    required = agency_mapping.required_question_numbers()
    missing = [
        q for q in required
        if int_answers.get(q) is None or not isinstance(int_answers.get(q), int)
    ]
    if missing:
        raise HTTPException(
            status_code=422,
            detail={"error": "incomplete_questionnaire", "missing": missing},
        )

    # Official value-based scoring + legacy adapter (7 measures → dashboard/brain).
    scored = agency_mapping.score_submission(int_answers)
    scores = scored["scores"]
    measure_results = scored["measure_results"]

    # MoE agency questionnaire: one `answered` per question, carrying the
    # official question + answer URL ids and the 1–5 value.
    if session.get("sid"):
        for entry in scored["official_answers"]:
            await lrs_reporter.report_agency_answered(
                learner_id,
                session["sid"],
                entry["question_number"],
                entry["answer_id"],
                score_raw=float(entry["value"]),
                question_id=entry["question_id"],
                answer_id=entry["answer_id"],
            )

    insights = generate_insights(scores)
    recommendations = generate_recommendations(scores)

    result = {
        "student_name": student_name,
        "gender": gender,
        "scores": scores,
        "measure_results": measure_results,
        "dimensions": DIMENSIONS,
        "insights": insights,
        "recommendations": recommendations,
    }

    language = normalize_language(data.get("language"))

    # Legacy state kept during migration (dashboard still reads mapping_results).
    await update_learner_state(learner_id, {
        "mapping_results": result,
        "gender": gender,
        # A new questionnaire creates a new profile-verification journey. Never
        # inherit a completed checkpoint from an older mapping submission.
        "profile_summary_progress": None,
    })

    # Seed the brain (F2): mapping_scores via the system lane; the Onboarding
    # agent derives profile/strengths/challenges/activeness (numbers deterministic).
    # display_name is UI-only (§4.1) — stored for the dashboard, never sent to AI.
    await apply_brain_updates(learner_id, {
        "profile.mapping_scores": scores,
        "profile.mapping_measures": measure_results,
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