"""Agent API routes (P3+). Thin SSE transport for the floating Learning Coach.

The Coach streams over the non-identifying Context bundle; the AI-use disclosure
is sent as the first SSE event so the UI always shows it (§11).
"""

import json
import re
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from app.auth.dependencies import require_learner, require_learner_session
from app.agents import safety
from app.agents import sessions
from app.agents.coach import run_coach_stream
from app.agents.manim_visual import plan_manim_visual, render_manim_visual, split_visual_response
from app.agents.pedagogical import select_next, route_after_fail
from app.agents import reflection
from app.core.localization import normalize_language
from app.services.ai_usage import UsageContext
from app.services.lrs import reporter as lrs_reporter
from app.services.speech import SpeechUnavailable, synthesize_speech
from app.services import triggers


_VISUAL_HINT = re.compile(
    r"[\d=+×÷/%°]|משולש|זווית|שבר|גרף|צורה|מרובע|מעגל|ציר|נוסח|שטח|היקף|"
    r"مثلث|زاوية|كسر|رسم|شكل|دائرة|مساحة|triangle|angle|fraction|graph|shape|equation"
)


def _worth_visual_planning(message: str, response_text: str) -> bool:
    """Cheap gate before the visual-planner LLM call — a 'thanks!' turn or a
    short non-mathematical reply never justifies a full planning request."""
    if len(response_text.strip()) < 80:
        return False
    if len(message.strip()) < 8 and not _VISUAL_HINT.search(message):
        return False
    return bool(_VISUAL_HINT.search(message) or _VISUAL_HINT.search(response_text))


def _surface_component_iri(surface: "CoachSurfaceContext") -> str | None:
    """Full component IRI for MoE conversation extensions, when known."""
    if surface.component_id:
        from app.services.lrs import config as lrs_config
        return f"{lrs_config.supplier_domain()}/component/{surface.component_id}"
    return None


# MoE conversationTrigger enum ← our internal trigger names.
_MOE_TRIGGER = {
    "idle": "idle-time",
    "misconception": "misconception",
    "slow_progress": "idle-time",
    "success": "success-effort",
    "rapid_guessing": "idle-time",
    "wheel_spinning": "misconception",
}


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
    trigger: Literal[
        "idle", "misconception", "slow_progress", "success",
        "rapid_guessing", "wheel_spinning",
    ] = "idle"
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
    """Store a learner's reflection answer. `system_estimate` is computed
    server-side by the personalized reflection flow (B-5) and is NEVER accepted
    from the client here — a learner could otherwise poison the self-vs-system
    calibration signal. `self_rating` is coerced to a bounded int."""
    raw_rating = data.get("self_rating")
    self_rating = raw_rating if isinstance(raw_rating, int) and 1 <= raw_rating <= 5 else None
    entry = await reflection.store_reflection(
        learner_id,
        prompt_id=data.get("prompt_id") or "hard_task",
        answer=data.get("answer") or "",
        self_rating=self_rating,
        system_estimate=None,
    )
    return JSONResponse(content=entry)


class ReflectionStartRequest(BaseModel):
    component_id: str | None = Field(default=None, max_length=180)
    session_id: str | None = Field(default=None, max_length=120)   # launch sid
    language: str = Field(default="he", max_length=8)


class ReflectionAnswerRequest(BaseModel):
    question_number: int = Field(ge=1, le=10)
    answer: str | None = Field(default=None, max_length=800)
    rating: int | None = Field(default=None, ge=1, le=5)


class ReflectionSkipRequest(BaseModel):
    question_number: int = Field(ge=1, le=10)


@router.post("/reflection/start")
async def reflection_start(
    request: ReflectionStartRequest, session=Depends(require_learner_session)
):
    """Personalized post-lesson reflection (F4): questions built from the
    session's real evidence; emits the 720 `initialized` statement."""
    from app.services import reflection_flow
    result = await reflection_flow.start_reflection(
        session["sub"],
        component_id=request.component_id,
        launch_session_id=request.session_id,
        moe_session_id=session.get("sid"),
        language=normalize_language(request.language),
    )
    return JSONResponse(content=result)


@router.post("/reflection/{reflection_id}/answer")
async def reflection_answer(
    reflection_id: str,
    request: ReflectionAnswerRequest,
    session=Depends(require_learner_session),
):
    from app.services import reflection_flow
    result = await reflection_flow.answer_question(
        session["sub"], reflection_id, request.question_number,
        answer=request.answer, rating=request.rating,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Reflection not found")
    return JSONResponse(content=result)


@router.post("/reflection/{reflection_id}/skip")
async def reflection_skip(
    reflection_id: str,
    request: ReflectionSkipRequest,
    session=Depends(require_learner_session),
):
    from app.services import reflection_flow
    result = await reflection_flow.skip_question(
        session["sub"], reflection_id, request.question_number
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Reflection not found")
    return JSONResponse(content=result)


@router.post("/reflection/{reflection_id}/complete")
async def reflection_complete(
    reflection_id: str, session=Depends(require_learner_session)
):
    from app.services import reflection_flow
    result = await reflection_flow.complete_reflection(session["sub"], reflection_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Reflection not found")
    return JSONResponse(content=result)


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
async def coach_stream(request: CoachStreamRequest, session=Depends(require_learner_session)):
    """Stream a Coach chat reply via SSE (F3)."""
    learner_id = session["sub"]
    message = request.message.strip()
    language = normalize_language(request.language)
    conversation_id = sessions.normalize_session_id(request.conversation_id)
    exchange_id = uuid4().hex

    # MoE 720: one `interacted` per chat turn — the student's message now, the
    # bot's reply when the stream completes. Chat text is never sent.
    moe_sid = session.get("sid")
    component_iri = _surface_component_iri(request.surface)
    if moe_sid:
        await lrs_reporter.report_conversation_interacted(
            learner_id, moe_sid, conversation_id,
            speaker="student", conversation_trigger="student-request",
            component_id=component_iri,
        )

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
            scene = None if (
                safety.is_safety_redirect(response_text)
                or not _worth_visual_planning(screened_message, response_text)
            ) else await plan_manim_visual(
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
        if moe_sid:  # the bot's turn of this exchange
            await lrs_reporter.report_conversation_interacted(
                learner_id, moe_sid, conversation_id,
                speaker="bot", conversation_trigger="student-request",
                component_id=component_iri,
            )
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
async def coach_proactive(request: CoachProactiveRequest, session=Depends(require_learner_session)):
    """Stream a proactive nudge (idle / misconception / success). Fired by the
    trigger engine in P4; exposed now so the companion can subscribe."""
    learner_id = session["sub"]
    language = normalize_language(request.language)
    trigger = request.trigger
    conversation_id = sessions.normalize_session_id(request.conversation_id)
    exchange_id = uuid4().hex

    # MoE 720: a bot-initiated turn — helpType=bot-help-offer, trigger mapped
    # to the closed conversationTrigger enum.
    if session.get("sid"):
        await lrs_reporter.report_conversation_interacted(
            learner_id, session["sid"], conversation_id,
            speaker="bot",
            conversation_trigger=_MOE_TRIGGER.get(trigger, "idle-time"),
            help_type="bot-help-offer",
            component_id=_surface_component_iri(request.surface),
        )

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
async def coach_support(request: CoachSupportRequest, session=Depends(require_learner_session)):
    """Stream learner-requested, current-item-grounded support into the task thread."""
    learner_id = session["sub"]
    language = normalize_language(request.language)
    conversation_id = sessions.normalize_session_id(request.conversation_id)
    exchange_id = uuid4().hex

    # MoE 720: the hint/explanation button IS the help-request event. Object =
    # the component when known, else the conversation itself.
    if session.get("sid"):
        component_iri = _surface_component_iri(request.surface)
        from app.services.lrs import config as lrs_config
        await lrs_reporter.report_help_requested(
            learner_id,
            session["sid"],
            object_id=component_iri
            or f"{lrs_config.supplier_domain()}/conversation/{conversation_id}",
            object_type="component" if component_iri else "conversation",
            help_source="platform",
            help_type=request.support,
        )

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
