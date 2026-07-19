"""Agent API routes (P3+). Thin SSE transport for the floating Learning Coach.

The Coach streams over the non-identifying Context bundle; the AI-use disclosure
is sent as the first SSE event so the UI always shows it (§11).
"""

import json
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from app.auth.dependencies import require_learner
from app.agents import safety
from app.agents import sessions
from app.agents.coach import run_coach_stream
from app.agents.manim_visual import plan_manim_visual, render_manim_visual, split_visual_response
from app.agents.pedagogical import select_next, route_after_fail
from app.agents import reflection
from app.core.localization import normalize_language
from app.services.ai_usage import UsageContext
from app.services.speech import SpeechUnavailable, synthesize_speech
from app.services import triggers


router = APIRouter(prefix="/api/agent", tags=["agent"])


class CoachSpeechRequest(BaseModel):
    """Text-only speech request; visual/image payloads are intentionally absent."""

    text: str = Field(min_length=1, max_length=6000)
    language: str = Field(default="he", max_length=8)
    avatar_variant: Literal["classic", "girl"] = "classic"
    conversation_id: str = Field(default="default", min_length=1, max_length=120)
    exchange_id: str | None = Field(default=None, max_length=120)


class CoachConversationRequest(BaseModel):
    """Create a pseudonymous learner-owned Coach conversation."""

    unit_id: str | None = Field(default=None, min_length=1, max_length=180)
    component_id: str | None = Field(default=None, min_length=1, max_length=180)


class CoachSurfaceContext(BaseModel):
    """Bounded semantic context; arbitrary DOM text and URLs are not accepted."""

    model_config = ConfigDict(extra="forbid")
    screen: Literal[
        "results", "student_dashboard", "mentoring", "learning_portal",
        "learning_lesson", "learning_create", "unknown",
    ] = "unknown"
    unit_id: str | None = Field(default=None, min_length=1, max_length=180)
    component_id: str | None = Field(default=None, min_length=1, max_length=180)


class CoachStreamRequest(BaseModel):
    conversation_id: str = Field(default="default", min_length=1, max_length=120)
    message: str = Field(min_length=1, max_length=4000)
    language: str = Field(default="he", max_length=8)
    surface: CoachSurfaceContext = Field(default_factory=CoachSurfaceContext)


class CoachProactiveRequest(BaseModel):
    conversation_id: str = Field(default="default", min_length=1, max_length=120)
    trigger: Literal["idle", "misconception", "slow_progress", "success"] = "idle"
    language: str = Field(default="he", max_length=8)
    surface: CoachSurfaceContext = Field(default_factory=CoachSurfaceContext)


class CoachSupportRequest(BaseModel):
    conversation_id: str = Field(default="default", min_length=1, max_length=120)
    support: Literal["hint", "explanation"]
    language: str = Field(default="he", max_length=8)
    surface: CoachSurfaceContext = Field(default_factory=CoachSurfaceContext)


_SPEECH_UNAVAILABLE = {
    "he": "שירות ההקראה אינו זמין כרגע.",
    "ar": "خدمة القراءة غير متاحة حاليًا.",
    "en": "Read-aloud is currently unavailable.",
}


@router.post("/route/next")
async def route_next(data: dict, learner_id: str = Depends(require_learner)):
    """Decide the next objective + component (F1, Pedagogical agent)."""
    language = normalize_language(data.get("language"))
    decision = await select_next(learner_id, locale=language)
    return JSONResponse(content=decision)


@router.post("/route/after-fail")
async def route_after_fail_endpoint(data: dict, learner_id: str = Depends(require_learner)):
    """Route to the alternative representation after a fail/misconception (F1)."""
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
async def reflect_answer(data: dict, learner_id: str = Depends(require_learner)):
    """Store a learner's reflection answer (+ self vs system estimate)."""
    entry = await reflection.store_reflection(
        learner_id,
        prompt_id=data.get("prompt_id") or "hard_task",
        answer=data.get("answer") or "",
        self_rating=data.get("self_rating"),
        system_estimate=data.get("system_estimate"),
    )
    return JSONResponse(content=entry)


@router.get("/triggers/subscribe")
async def triggers_subscribe(learner_id: str = Depends(require_learner)):
    """SSE stream of proactive triggers for a learner (idle/misconception/success)."""
    lid = learner_id

    async def event_generator():
        async for trig in triggers.subscribe(lid):
            yield f"data: {json.dumps(trig, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/triggers/idle")
async def triggers_idle(data: dict, learner_id: str = Depends(require_learner)):
    """Client reports idle (absence isn't an event, R5) → fire an idle nudge."""
    lid = learner_id
    triggers.publish_idle(lid, data.get("objective_id"))
    return JSONResponse(content={"ok": True})


@router.post("/coach/stream")
async def coach_stream(request: CoachStreamRequest, learner_id: str = Depends(require_learner)):
    """Stream a Coach chat reply via SSE (F3)."""
    message = request.message.strip()
    language = normalize_language(request.language)
    conversation_id = sessions.normalize_session_id(request.conversation_id)
    exchange_id = uuid4().hex

    async def event_generator():
        # First event carries the mandatory AI-use disclosure.
        yield f"data: {json.dumps({'disclosure': safety.disclosure(language)}, ensure_ascii=False)}\n\n"
        response_parts = []
        async for chunk in run_coach_stream(
            learner_id,
            user_message=message,
            language=language,
            session_id=conversation_id,
            exchange_id=exchange_id,
            surface_context=request.surface.model_dump(),
        ):
            response_parts.append(chunk)
            # Forward every model chunk immediately. The frontend already
            # appends text events, so Yuvi visibly speaks while generating.
            yield f"data: {json.dumps({'text': chunk}, ensure_ascii=False)}\n\n"

        # Text generation is finished. Yuvi returns to a thinking pose while
        # the optional visual planner runs; no response text is replayed.
        yield f"data: {json.dumps({'phase': 'thinking'}, ensure_ascii=False)}\n\n"

        # The Coach may invoke the visual tool after its verbal explanation.
        # Only a bounded scene specification reaches the renderer; no generated
        # Python is ever executed. Tool failure never blocks the conversation.
        try:
            screened_message = safety.screen_input(message, language).text
            response_text = "".join(response_parts)
            scene = await plan_manim_visual(
                screened_message,
                response_text,
                language,
                usage_context=UsageContext(
                    actor_id=learner_id,
                    actor_type="learner",
                    endpoint="/api/agent/coach/stream",
                    feature="feature_3_learning_companion",
                    operation="coach.visual_plan",
                    source="coach_visual_tool",
                    session_id=conversation_id,
                    exchange_id=exchange_id,
                ),
                text_filter=lambda text: safety.screen_output(text, language).text,
            )
            if scene:
                text_before, text_after = split_visual_response(response_text)
                status = {
                    'visual_status': 'rendering',
                    'text_before': text_before,
                    'text_after': text_after,
                }
                yield f"data: {json.dumps(status, ensure_ascii=False)}\n\n"
                visual = await render_manim_visual(scene)
                attached = await sessions.attach_visual(
                    learner_id,
                    conversation_id,
                    f"{exchange_id}:1",
                    visual,
                    text_before,
                    text_after,
                )
                if not attached:
                    print(f"⚠️ Coach visual was rendered but not attached to {exchange_id}:1")
                yield f"data: {json.dumps({'visual': visual}, ensure_ascii=False)}\n\n"
        except Exception as exc:  # pragma: no cover - optional visual support
            print(f"⚠️ Coach visual tool failed: {exc}")
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/coach/conversations")
async def coach_conversations(
    limit: int = Query(default=12, ge=1, le=30),
    cursor: str | None = Query(default=None, max_length=400),
    learner_id: str = Depends(require_learner),
):
    """Page through learner-owned Coach threads, newest first."""
    safe_id = learner_id
    return JSONResponse(
        content=await sessions.list_conversations(
            safe_id, role="coach", limit=limit, cursor=cursor
        ),
        headers={"Cache-Control": "private, no-store"},
    )


@router.post("/coach/conversations", status_code=201)
async def create_coach_conversation(request: CoachConversationRequest, learner_id: str = Depends(require_learner)):
    """Start a new empty Coach thread without storing state in the browser."""
    safe_id = learner_id
    return JSONResponse(
        status_code=201,
        content=await sessions.create_conversation(
            safe_id,
            role="coach",
            unit_id=request.unit_id,
            component_id=request.component_id,
        ),
    )


@router.get("/coach/conversations/{conversation_id}/messages")
async def coach_conversation_messages(
    conversation_id: str,
    limit: int = Query(default=20, ge=1, le=50),
    cursor: str | None = Query(default=None, max_length=400),
    learner_id: str = Depends(require_learner),
):
    """Page backward through one conversation for scroll-up loading."""
    safe_id = learner_id
    return JSONResponse(
        content=await sessions.list_messages(
            safe_id,
            sessions.normalize_session_id(conversation_id),
            role="coach",
            limit=limit,
            cursor=cursor,
        ),
        headers={"Cache-Control": "private, no-store"},
    )


@router.delete("/coach/conversations/{conversation_id}")
async def delete_coach_conversation(conversation_id: str, learner_id: str = Depends(require_learner)):
    """Soft-delete a learner-owned thread while retaining its durable records."""
    safe_id = learner_id
    deleted = await sessions.soft_delete_conversation(
        safe_id,
        sessions.normalize_session_id(conversation_id),
        role="coach",
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return JSONResponse(content={"ok": True})


@router.post("/coach/tts")
async def coach_tts(request: CoachSpeechRequest, learner_id: str = Depends(require_learner)):
    """Read a completed Coach message aloud without sending image content."""
    language = normalize_language(request.language)
    conversation_id = sessions.normalize_session_id(request.conversation_id)
    screened_text = safety.screen_output(request.text, language).text
    try:
        audio = await synthesize_speech(
            screened_text,
            language,
            avatar_variant=request.avatar_variant,
            usage_context=UsageContext(
                actor_id=learner_id,
                actor_type="learner",
                endpoint="/api/agent/coach/tts",
                feature="feature_3_learning_companion",
                operation="coach.speech",
                source="coach_speech_route",
                session_id=conversation_id,
                exchange_id=request.exchange_id,
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except SpeechUnavailable as exc:
        print(f"⚠️ Coach speech unavailable: {exc}")
        raise HTTPException(status_code=503, detail=_SPEECH_UNAVAILABLE[language]) from exc
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.post("/coach/proactive")
async def coach_proactive(request: CoachProactiveRequest, learner_id: str = Depends(require_learner)):
    """Stream a proactive nudge (idle / misconception / success). Fired by the
    trigger engine in P4; exposed now so the companion can subscribe."""
    language = normalize_language(request.language)
    trigger = request.trigger
    conversation_id = sessions.normalize_session_id(request.conversation_id)
    exchange_id = uuid4().hex

    async def event_generator():
        yield f"data: {json.dumps({'disclosure': safety.disclosure(language), 'proactive': trigger}, ensure_ascii=False)}\n\n"
        async for chunk in run_coach_stream(
            learner_id,
            trigger=trigger,
            language=language,
            session_id=conversation_id,
            exchange_id=exchange_id,
            endpoint="/api/agent/coach/proactive",
            surface_context=request.surface.model_dump(),
        ):
            yield f"data: {json.dumps({'text': chunk}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/coach/support")
async def coach_support(request: CoachSupportRequest, learner_id: str = Depends(require_learner)):
    """Stream learner-requested, current-item-grounded support into the task thread."""
    language = normalize_language(request.language)
    conversation_id = sessions.normalize_session_id(request.conversation_id)
    exchange_id = uuid4().hex

    async def event_generator():
        yield f"data: {json.dumps({'disclosure': safety.disclosure(language), 'support': request.support}, ensure_ascii=False)}\n\n"
        async for chunk in run_coach_stream(
            learner_id,
            language=language,
            session_id=conversation_id,
            exchange_id=exchange_id,
            endpoint="/api/agent/coach/support",
            surface_context=request.surface.model_dump(),
            support_mode=request.support,
        ):
            yield f"data: {json.dumps({'text': chunk}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
