"""Agent API routes (P3+). Thin SSE transport for the floating Learning Coach.

The Coach streams over the non-identifying Context bundle; the AI-use disclosure
is sent as the first SSE event so the UI always shows it (§11).
"""

import json

from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse

from app.agents import safety
from app.agents.coach import run_coach_stream
from app.agents.pedagogical import select_next, route_after_fail
from app.agents import reflection
from app.core.localization import normalize_language
from app.services import triggers
from learner_state import normalize_learner_id  # type: ignore


router = APIRouter(prefix="/api/agent", tags=["agent"])


@router.post("/route/next")
async def route_next(data: dict):
    """Decide the next objective + component (F1, Pedagogical agent)."""
    learner_id = normalize_learner_id(data.get("learner_id"))
    language = normalize_language(data.get("language"))
    decision = await select_next(learner_id, locale=language)
    return JSONResponse(content=decision)


@router.post("/route/after-fail")
async def route_after_fail_endpoint(data: dict):
    """Route to the alternative representation after a fail/misconception (F1)."""
    learner_id = normalize_learner_id(data.get("learner_id"))
    language = normalize_language(data.get("language"))
    alt = await route_after_fail(learner_id, locale=language)
    return JSONResponse(content={"component": alt})


@router.post("/reflect")
async def reflect_prompt(data: dict):
    """Return a localized reflection prompt (Reflection agent)."""
    language = normalize_language(data.get("language"))
    kind = data.get("kind") or "hard_task"
    return JSONResponse(content=reflection.get_prompt(language, kind))


@router.post("/reflect/answer")
async def reflect_answer(data: dict):
    """Store a learner's reflection answer (+ self vs system estimate)."""
    learner_id = normalize_learner_id(data.get("learner_id"))
    entry = await reflection.store_reflection(
        learner_id,
        prompt_id=data.get("prompt_id") or "hard_task",
        answer=data.get("answer") or "",
        self_rating=data.get("self_rating"),
        system_estimate=data.get("system_estimate"),
    )
    return JSONResponse(content=entry)


@router.get("/triggers/subscribe")
async def triggers_subscribe(learner_id: str):
    """SSE stream of proactive triggers for a learner (idle/misconception/success)."""
    lid = normalize_learner_id(learner_id)

    async def event_generator():
        async for trig in triggers.subscribe(lid):
            yield f"data: {json.dumps(trig, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/triggers/idle")
async def triggers_idle(data: dict):
    """Client reports idle (absence isn't an event, R5) → fire an idle nudge."""
    lid = normalize_learner_id(data.get("learner_id"))
    triggers.publish_idle(lid, data.get("objective_id"))
    return JSONResponse(content={"ok": True})


@router.post("/coach/stream")
async def coach_stream(data: dict):
    """Stream a Coach chat reply via SSE (F3)."""
    learner_id = normalize_learner_id(data.get("learner_id"))
    message = (data.get("message") or "").strip()
    language = normalize_language(data.get("language"))

    async def event_generator():
        # First event carries the mandatory AI-use disclosure.
        yield f"data: {json.dumps({'disclosure': safety.disclosure(language)}, ensure_ascii=False)}\n\n"
        async for chunk in run_coach_stream(learner_id, user_message=message, language=language):
            yield f"data: {json.dumps({'text': chunk}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/coach/proactive")
async def coach_proactive(data: dict):
    """Stream a proactive nudge (idle / misconception / success). Fired by the
    trigger engine in P4; exposed now so the companion can subscribe."""
    learner_id = normalize_learner_id(data.get("learner_id"))
    language = normalize_language(data.get("language"))
    trigger = data.get("trigger") or "idle"

    async def event_generator():
        yield f"data: {json.dumps({'disclosure': safety.disclosure(language), 'proactive': trigger}, ensure_ascii=False)}\n\n"
        async for chunk in run_coach_stream(learner_id, trigger=trigger, language=language):
            yield f"data: {json.dumps({'text': chunk}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
