"""Learner-mapping reflection routes (deterministic — no LLM).

After each questionnaire phase the client asks for a short opener + zero or 2-3
tap-to-answer clarification questions (`/api/section-reflect`) and reports the
learner's picks (`/api/section-reflect/capture`). The question bank and ranking
are fully deterministic (see `app/services/reflection_engine.py`); all learner
text lives in the locale files under `reflect.*`. No learner text ever reaches an
AI model — instant, offline-capable, privacy-safe, and every question traces to a
real answer.
"""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.auth.dependencies import require_learner
from app.brain.consolidator import capture_reflection_choices
from app.core.localization import normalize_language
from app.services.reflection_engine import build_reflection


router = APIRouter(prefix="/api", tags=["mapping-reflect"])


@router.post("/section-reflect")
async def section_reflect(data: dict):
    """Deterministic opener + zero or 2-3 tap-to-answer questions for a phase (F2).

    A ranking engine picks the learner's most *extreme* answers and maps them to
    prebuilt questions whose text lives in the locales (``reflect.*``). When
    repeated signals collapse to one theme, a related action question supplies
    a meaningful second turn. Returns locale keys + stable signal codes.
    """
    part_id = data.get("part_id") or ""
    qa_pairs = data.get("questions_and_answers", [])
    language = normalize_language(data.get("language"))
    return JSONResponse(content=build_reflection(part_id, qa_pairs, language))


@router.post("/section-reflect/capture")
async def section_reflect_capture(data: dict, learner_id: str = Depends(require_learner)):
    """Persist the learner's option picks as soft brain signals (deterministic).

    The client sends the localized label it showed + a stable signal code; we
    store the label as a characteristic and keep the codes for traceability. No
    LLM, no learner free text. Non-blocking — a failure never affects the flow.
    """
    phase_title = data.get("phase_title", "")
    language = normalize_language(data.get("language"))
    choices = data.get("choices") or []
    try:
        await capture_reflection_choices(learner_id, phase_title, choices, language)
    except Exception as exc:  # never block the flow on a capture failure
        print(f"⚠️ section-reflect capture failed: {exc}")
    return JSONResponse(content={"ok": True})
