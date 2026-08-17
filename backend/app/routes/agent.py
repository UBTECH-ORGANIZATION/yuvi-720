"""Agent API routes (P3+). Thin SSE transport for the floating Learning Coach.

The Coach streams over the non-identifying Context bundle; the AI-use disclosure
is sent as the first SSE event so the UI always shows it (§11).
"""

import base64
import json
import re
from typing import Literal, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from app.auth.dependencies import require_learner, require_learner_session
from app.agents import safety
from app.agents import sessions
from app.agents.coach import SUPPORT_PROMPTS, run_coach_stream
from app.agents.manim_visual import (
    plan_manim_visual,
    render_visual,
    should_offer_visual,
    split_visual_response,
    visuals_enabled,
)
from app.agents.pedagogical import select_next, route_after_fail
from app.agents import reflection
from app.core.localization import normalize_language
from app.services.ai_usage import UsageContext
from app.services.lrs import reporter as lrs_reporter
from app.services.speech import SpeechUnavailable, synthesize_speech
from app.services.speech_segments import split_by_script
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


async def _stream_visual_tail(
    *,
    learner_id: str,
    conversation_id: str,
    exchange_id: str,
    endpoint: str,
    user_message: str,
    response_text: str,
    language: str,
):
    """SSE tail shared by chat + hint/explanation replies: the optional visual.

    Auto-plans a bounded Manim scene when the reply is math-shaped (no generated
    Python is ever executed), else classifies whether to offer the on-demand
    image/video buttons. Failure never blocks the conversation."""
    # Text generation is finished. Yuvi returns to a thinking pose while
    # the optional visual planner runs; no response text is replayed.
    yield f"data: {json.dumps({'phase': 'thinking'}, ensure_ascii=False)}\n\n"

    screened_message = user_message
    scene = None
    will_plan = False
    try:
        screened_message = safety.screen_input(user_message, language).text or user_message
        will_plan = visuals_enabled() and not (
            safety.is_safety_redirect(response_text)
            or not _worth_visual_planning(screened_message, response_text)
        )
        if will_plan:
            # Early signal, BEFORE the planner model runs: the client can
            # show "preparing a visual" on the message immediately instead
            # of the message looking finished and then suddenly growing.
            yield f"data: {json.dumps({'visual_status': 'planning'}, ensure_ascii=False)}\n\n"
        scene = None if not will_plan else await plan_manim_visual(  # noqa: F841 (read after try)
            screened_message,
            response_text,
            language,
            usage_context=UsageContext(
                actor_id=learner_id,
                actor_type="learner",
                endpoint=endpoint,
                feature="feature_3_learning_companion",
                operation="coach.visual_plan",
                source="coach_visual_tool",
                session_id=conversation_id,
                exchange_id=exchange_id,
            ),
            text_filter=lambda text: safety.screen_output(text, language).text,
        )
        if will_plan and not scene:
            # Planner declined — clear the loader so the message closes.
            yield f"data: {json.dumps({'visual_status': 'none'}, ensure_ascii=False)}\n\n"
        if scene:
            text_before, text_after = split_visual_response(response_text)
            status = {
                'visual_status': 'rendering',
                'text_before': text_before,
                'text_after': text_after,
            }
            yield f"data: {json.dumps(status, ensure_ascii=False)}\n\n"
            visual = await render_visual(scene)
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
        # Never leave the client stuck on a "preparing a visual" loader.
        yield f"data: {json.dumps({'visual_status': 'none'}, ensure_ascii=False)}\n\n"

    # Whether to offer the on-demand "show me a video / image" buttons — an
    # LLM decides if this reply is an explanation a visual would help. Skipped
    # when a visual was already produced, on redirects, or when the math
    # planner already ran and declined (it is the same judgment).
    can_visualize = False
    try:
        if (
            scene is None
            and not will_plan
            and len(response_text.strip()) >= 30
            and not safety.is_safety_redirect(response_text)
        ):
            can_visualize = await should_offer_visual(
                screened_message, response_text, language,
                usage_context=UsageContext(
                    actor_id=learner_id,
                    actor_type="learner",
                    endpoint=endpoint,
                    feature="feature_3_learning_companion",
                    operation="coach.visual_offer",
                    source="coach_visual_tool",
                    session_id=conversation_id,
                    exchange_id=exchange_id,
                ),
            )
    except Exception as exc:  # pragma: no cover
        print(f"⚠️ visual-offer classify failed: {exc}")
    yield f"data: {json.dumps({'can_visualize': can_visualize}, ensure_ascii=False)}\n\n"


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
    "mistake": "misconception",
    "slow_progress": "idle-time",
    "success": "success-effort",
    "rapid_guessing": "idle-time",
    "wheel_spinning": "misconception",
    "question_intro": "idle-time",
    "lesson_step_intro": "idle-time",
    "lesson_welcome": "idle-time",
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
        "idle", "misconception", "mistake", "slow_progress", "success",
        "rapid_guessing", "wheel_spinning", "question_intro", "lesson_step_intro",
        "lesson_welcome",
    ] = "idle"
    language: str = Field(default="he", max_length=8)
    surface: CoachSurfaceContext = Field(default_factory=CoachSurfaceContext)
    # The question this nudge is ABOUT (`component|item|question`). Kata advances
    # the screen the moment an answer lands, so by the time we compose, the live
    # pointer is often already on the next question — and the nudge would be
    # written about content the learner has not seen. Sent by the client from the
    # trigger it is playing; absent, we fall back to the live pointer.
    question_key: Optional[str] = Field(default=None, max_length=400)


class CoachSupportRequest(BaseModel):
    conversation_id: str = Field(default="default", min_length=1, max_length=120)
    support: Literal["hint", "explanation"]
    language: str = Field(default="he", max_length=8)
    surface: CoachSurfaceContext = Field(default_factory=CoachSurfaceContext)


class CompetencyChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    text: str = Field(min_length=1, max_length=1500)


class VisualizeRequest(BaseModel):
    """On-demand visual: the learner tapped 'show me a video / image' under a
    text-only reply. `assistant_text` is our own prior model output; both texts
    are safety-screened before the planner sees them. Never sent to the LRS."""

    model_config = ConfigDict(extra="forbid")
    user_message: str = Field(min_length=1, max_length=4000)
    assistant_text: str = Field(min_length=1, max_length=6000)
    mode: Literal["image", "video"] = "image"
    language: str = Field(default="he", max_length=8)
    conversation_id: str = Field(default="default", min_length=1, max_length=120)


class CompetencyChatRequest(BaseModel):
    """Ephemeral learning-map topic chat: the client holds the transcript,
    the server persists nothing to conversation history."""

    competency: Literal[
        "motivation_relevance", "growth_mindset", "initiative_responsibility",
        "self_regulation", "self_awareness", "support_emotional",
    ]
    language: str = Field(default="he", max_length=8)
    conversation_id: str = Field(default="default", min_length=1, max_length=120)
    messages: list[CompetencyChatMessage] = Field(min_length=1, max_length=16)


class ActivenessChangeRequest(BaseModel):
    """Ask why one activeness domain moved since the learner last opened the map.
    Returns a short verbal, non-numeric explanation (no scores leaked)."""

    competency: Literal[
        "motivation_relevance", "growth_mindset", "initiative_responsibility",
        "self_regulation", "self_awareness", "support_emotional",
    ]
    direction: Literal["up", "down"]
    language: str = Field(default="he", max_length=8)


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


class CoachExplainerRequest(BaseModel):
    component_id: str | None = Field(default=None, max_length=180)
    language: str = Field(default="he", max_length=8)
    # True only on the learner's first open; the client sends False on the
    # subsequent poll requests so "different way" usage is logged once, not per poll.
    first: bool = False


class CoachRateRequest(BaseModel):
    conversation_id: str = Field(default="default", min_length=1, max_length=120)
    rating: Literal["like", "dislike"]


@router.post("/coach/rate")
async def coach_rate(request: CoachRateRequest, session=Depends(require_learner_session)):
    """Learner rates the coach conversation (MoE 720 `conversation/rated`).

    The like/dislike button on a coach reply is the product trigger; the report
    rides the durable outbox and never blocks the response.
    """
    learner_id = session["sub"]
    conversation_id = sessions.normalize_session_id(request.conversation_id)
    if session.get("sid"):
        await lrs_reporter.report_conversation_rated(
            learner_id, session["sid"], conversation_id, request.rating
        )
    return JSONResponse(content={"ok": True})


class CoachHelpedRequest(BaseModel):
    component_id: str | None = Field(default=None, max_length=180)
    item_id: str | None = Field(default=None, max_length=180)
    question_id: str | None = Field(default=None, max_length=180)
    methods: list[str] = Field(default_factory=list, max_length=8)


@router.post("/coach/helped")
async def coach_helped(request: CoachHelpedRequest, learner_id: str = Depends(require_learner)):
    """Learner's self-attribution on a solved question ("what helped you understand
    this?"). Persisted per question for the teacher view; latest answer wins."""
    from app.services import learner_activity

    triggers.note_chat_activity(learner_id)   # answering the chips is a chat turn
    stored = await learner_activity.record_helped_attribution(
        learner_id,
        request.methods,
        component_id=request.component_id,
        item_id=request.item_id,
        question_id=request.question_id,
    )
    return JSONResponse(content={"methods": stored})


@router.post("/coach/explainer")
async def coach_explainer(
    request: CoachExplainerRequest, session=Depends(require_learner_session)
):
    """Per-question generated explainer ("learn it another way").

    Returns ``{status: 'ready', deck}`` when cached, else ``{status: 'generating'}``
    and kicks off generation — the client polls until ready. The deck is cached by
    question (component|item|question) across ALL learners, so only the first
    student on a question ever waits.
    """
    from app.brain.repository import get_brain
    from app.services import question_explainer

    learner_id = session["sub"]
    locale = normalize_language(request.language)
    brain = await get_brain(learner_id)
    current = brain.get("current_state") or {}
    component_id = request.component_id or current.get("component_id")
    result = await question_explainer.get_or_start(
        component_id, current.get("item_id"), current.get("question_id"), locale
    )
    # Log the "different way" usage once — only on the learner's first open, not
    # on the poll requests that follow.
    if request.first:
        try:
            from app.services import learner_activity
            await learner_activity.record(
                learner_id, "different_way",
                component_id=component_id,
                item_id=current.get("item_id"),
                question_id=current.get("question_id"),
            )
        except Exception:
            pass
        # MoE 720 `item/selected`: choosing the alternative-representation
        # explainer is a real non-assessed learning-type choice.
        if session.get("sid") and component_id:
            from app.services.lrs import config as lrs_config
            await lrs_reporter.report_selected(
                learner_id,
                session["sid"],
                object_id=f"{lrs_config.supplier_domain()}/component/{component_id}",
                object_type="item",
                selection_type="learningType",
                response="alternative-explainer",
            )
    return result


@router.get("/coach/activity/summary")
async def coach_activity_summary(
    component_id: str | None = Query(default=None, max_length=180),
    subject: str | None = Query(default=None, max_length=80),
    learner_id: str = Depends(require_learner),
):
    """Per-question analytics for the learner — performance, time, and each kind
    of help used (hint / explanation / different way) — filterable by task
    (``component_id``) or ``subject``. The data backbone for a future teacher view;
    the cross-learner teacher report will call the same aggregation per learner.
    """
    from app.services import learner_activity

    rows = await learner_activity.question_summary(
        learner_id, component_id=component_id, subject=subject
    )
    return {"questions": rows}


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


@router.post("/coach/handoff")
async def coach_handoff(data: dict, learner_id: str = Depends(require_learner)):
    """Escalate from Yuvi to a human, carrying what Yuvi already tried.

    Learner-authenticated on purpose: this is the child (or the coach acting for
    them) asking for a person. The recipients are resolved server-side from the
    roster, so the request cannot address a teacher of its own choosing.
    """
    from app.services import coach_handoff as handoff

    alerts = await handoff.hand_off(
        learner_id,
        reason=str(data.get("reason") or "stuck")[:40],
        objective_id=data.get("objective_id"),
        component_id=data.get("component_id"),
    )
    # `notified: 0` is the orphan case — a learner in no staffed group. Reported
    # honestly so the UI can say "we could not reach a teacher" rather than
    # promising help that is not coming.
    return JSONResponse(content={"notified": len(alerts)})


@router.get("/triggers/subscribe")
async def triggers_subscribe(learner_id: str = Depends(require_learner)):
    """SSE stream of proactive triggers for a learner (idle/misconception/success)."""
    lid = learner_id

    async def event_generator():
        async for trig in triggers.subscribe(lid):
            yield f"data: {json.dumps(trig, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/coach/stream")
async def coach_stream(request: CoachStreamRequest, session=Depends(require_learner_session)):
    """Stream a Coach chat reply via SSE (F3)."""
    learner_id = session["sub"]
    message = request.message.strip()
    language = normalize_language(request.language)
    conversation_id = sessions.normalize_session_id(request.conversation_id)
    exchange_id = uuid4().hex

    # Talking to Yuvi is working: hold off the idle watchdog, which otherwise
    # only watches the content iframe and would nudge mid-conversation.
    triggers.note_chat_activity(learner_id)

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

    # Durable teacher-analytics: count each QUESTION-SCOPED chat turn (the learner
    # talking to Yuvi while on a question). Gated on current_state.item_id so
    # general companion chat outside a lesson is not counted. Repeatable, unlike
    # the one-shot hint/explanation/different_way rows.
    try:
        from app.brain.repository import get_brain
        from app.services import learner_activity

        current_state = (await get_brain(learner_id)).get("current_state") or {}
        if current_state.get("item_id"):
            await learner_activity.record(
                learner_id, "yuvi_chat",
                component_id=current_state.get("component_id") or request.surface.component_id,
                item_id=current_state.get("item_id"),
                question_id=current_state.get("question_id"),
            )
    except Exception:
        pass

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

        response_text = "".join(response_parts)
        async for event in _stream_visual_tail(
            learner_id=learner_id,
            conversation_id=conversation_id,
            exchange_id=exchange_id,
            endpoint="/api/agent/coach/stream",
            user_message=message,
            response_text=response_text,
            language=language,
        ):
            yield event

        if moe_sid:  # the bot's turn of this exchange
            await lrs_reporter.report_conversation_interacted(
                learner_id, moe_sid, conversation_id,
                speaker="bot", conversation_trigger="student-request",
                component_id=component_iri,
            )
        # Re-stamp on completion: the silence worth nudging starts when Yuvi
        # stops talking, not when the learner pressed send.
        triggers.note_chat_activity(learner_id)
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


@router.post("/coach/tts/stream")
async def coach_tts_stream(
    request: CoachSpeechRequest,
    learner_id: str = Depends(require_learner),
):
    """Speak a reply that mixes languages, one native voice per language run.

    Yuvi teaches English in Hebrew, so a single reply routinely carries both.
    One voice cannot be native to both, so the text is cut on script and each
    run is synthesized separately. Runs stream out as they finish, which means
    the learner hears the first one while the rest are still being made.
    """
    language = normalize_language(request.language)
    conversation_id = sessions.normalize_session_id(request.conversation_id)
    screened_text = safety.screen_output(request.text, language).text
    segments = split_by_script(screened_text, default_language=language)

    async def event_generator():
        for index, (segment_language, segment_text) in enumerate(segments):
            if not segment_text.strip():
                continue
            try:
                audio = await synthesize_speech(
                    segment_text,
                    segment_language,
                    avatar_variant=request.avatar_variant,
                    output_format="raw-24khz-16bit-mono-pcm",
                    usage_context=UsageContext(
                        actor_id=learner_id,
                        actor_type="learner",
                        endpoint="/api/agent/coach/tts/stream",
                        feature="feature_3_learning_companion",
                        operation="coach.speech",
                        source="coach_speech_route",
                        session_id=conversation_id,
                        exchange_id=request.exchange_id,
                    ),
                )
            except (ValueError, SpeechUnavailable) as exc:
                # One unspeakable run must not silence the rest of the reply.
                print(f"⚠️ speech segment {index} skipped ({type(exc).__name__})")
                continue
            yield "data: " + json.dumps({
                "index": index,
                "language": segment_language,
                "audio": base64.b64encode(audio).decode("ascii"),
            }) + "\n\n"
        yield "data: " + json.dumps({"done": True}) + "\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/coach/proactive")
async def coach_proactive(request: CoachProactiveRequest, session=Depends(require_learner_session)):
    """Stream a proactive nudge (idle / misconception / success). Fired by the
    trigger engine in P4; exposed now so the companion can subscribe."""
    learner_id = session["sub"]
    language = normalize_language(request.language)
    trigger = request.trigger
    conversation_id = sessions.normalize_session_id(request.conversation_id)
    exchange_id = uuid4().hex

    # Yuvi speaking is a chat turn too — but HIS turn, so it only stamps the
    # clock. Letting a nudge restart the watchdog makes the nudge reschedule
    # itself, which is how one idle stretch became a message every 2.5 minutes.
    triggers.note_chat_activity(learner_id, by_learner=False)

    async def event_generator():
        # Emit the first byte BEFORE any DB/LRS work so the client is already
        # streaming (and its stall-watchdog is armed). A transient DB blip in the
        # reporter below would otherwise block before a single byte and freeze the
        # panel with no way for the client to recover.
        yield f"data: {json.dumps({'disclosure': safety.disclosure(language), 'proactive': trigger}, ensure_ascii=False)}\n\n"
        # MoE 720: a bot-initiated turn — helpType=bot-help-offer, trigger mapped
        # to the closed conversationTrigger enum. Report-and-forget: never break
        # the nudge if reporting fails.
        if session.get("sid"):
            try:
                await lrs_reporter.report_conversation_interacted(
                    learner_id, session["sid"], conversation_id,
                    speaker="bot",
                    conversation_trigger=_MOE_TRIGGER.get(trigger, "idle-time"),
                    help_type="bot-help-offer",
                    component_id=_surface_component_iri(request.surface),
                )
            except Exception:
                pass
        async for chunk in run_coach_stream(
            learner_id,
            trigger=trigger,
            language=language,
            session_id=conversation_id,
            exchange_id=exchange_id,
            endpoint="/api/agent/coach/proactive",
            surface_context=request.surface.model_dump(),
            pinned_question_key=request.question_key,
        ):
            yield f"data: {json.dumps({'text': chunk}, ensure_ascii=False)}\n\n"
        triggers.note_chat_activity(learner_id, by_learner=False)
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/activeness/change-explain")
async def activeness_change_explain(
    request: ActivenessChangeRequest, learner_id: str = Depends(require_learner)
):
    """Why did one activeness domain move since last visit? A short verbal blurb.

    Learner id comes from the session (never the client). The reply is verbal
    only — activeness scores never enter the prompt or the response."""
    from app.agents.competency_coach import run_change_explanation

    text = await run_change_explanation(
        learner_id,
        request.competency,
        request.direction,
        normalize_language(request.language),
    )
    return JSONResponse(content={"text": text})


@router.post("/competency-chat")
async def competency_chat(
    request: CompetencyChatRequest, session=Depends(require_learner_session)
):
    """Focused, history-less chat about one learning-map competency (F4).

    The transcript never enters `sessions` (a deliberate privacy boundary for
    weakness talk); the memory consolidator still runs so durable facts land
    in the brain. MoE conversation `interacted` events are reported per turn —
    chat text is never sent."""
    from app.agents.competency_coach import run_competency_chat_stream

    learner_id = session["sub"]
    language = normalize_language(request.language)
    if request.messages[-1].role != "user":
        raise HTTPException(status_code=422, detail="last message must be from the learner")
    conversation_id = sessions.normalize_session_id(
        f"lmap-{request.competency}-{request.conversation_id}"
    )
    exchange_id = uuid4().hex

    moe_sid = session.get("sid")
    if moe_sid:
        await lrs_reporter.report_conversation_interacted(
            learner_id, moe_sid, conversation_id,
            speaker="student", conversation_trigger="student-request",
        )

    async def event_generator():
        yield f"data: {json.dumps({'disclosure': safety.disclosure(language)}, ensure_ascii=False)}\n\n"
        reply_parts = []
        async for chunk in run_competency_chat_stream(
            learner_id,
            request.competency,
            [m.model_dump() for m in request.messages],
            language,
            conversation_id=conversation_id,
            exchange_id=exchange_id,
        ):
            reply_parts.append(chunk)
            yield f"data: {json.dumps({'text': chunk}, ensure_ascii=False)}\n\n"

        # LLM-gated on-demand visual offer (same rule as the main coach).
        reply_text = "".join(reply_parts)
        can_visualize = False
        try:
            if len(reply_text.strip()) >= 30 and not safety.is_safety_redirect(reply_text):
                can_visualize = await should_offer_visual(
                    request.messages[-1].text, reply_text, language,
                    usage_context=UsageContext(
                        actor_id=learner_id,
                        actor_type="learner",
                        endpoint="/api/agent/competency-chat",
                        feature="feature_4_dashboard",
                        operation="coach.visual_offer",
                        source="competency_coach_agent",
                        session_id=conversation_id,
                        exchange_id=exchange_id,
                    ),
                )
        except Exception as exc:  # pragma: no cover
            print(f"⚠️ visual-offer classify failed: {exc}")
        yield f"data: {json.dumps({'can_visualize': can_visualize}, ensure_ascii=False)}\n\n"

        if moe_sid:
            await lrs_reporter.report_conversation_interacted(
                learner_id, moe_sid, conversation_id,
                speaker="bot", conversation_trigger="student-request",
            )
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@router.post("/visualize")
async def visualize(request: VisualizeRequest, session=Depends(require_learner_session)):
    """On-demand visual for a text-only reply (both chats). The learner asks to
    see the explanation as an image or a short animation; we plan a bounded
    scene and render it. Model-authored Python is never executed. Returns
    {"visual": ...} or {"visual": null} when no useful scene could be built."""
    learner_id = session["sub"]
    language = normalize_language(request.language)
    conversation_id = sessions.normalize_session_id(request.conversation_id)
    exchange_id = uuid4().hex

    screened_message = safety.screen_input(request.user_message, language).text or request.user_message
    prefer_animation = request.mode == "video"
    if not visuals_enabled():
        return {"visual": None}
    try:
        scene = await plan_manim_visual(
            screened_message,
            request.assistant_text,
            language,
            usage_context=UsageContext(
                actor_id=learner_id,
                actor_type="learner",
                endpoint="/api/agent/visualize",
                feature="feature_3_learning_companion",
                operation="coach.visual_ondemand",
                source="coach_visual_tool",
                session_id=conversation_id,
                exchange_id=exchange_id,
            ),
            text_filter=lambda text: safety.screen_output(text, language).text,
            prefer_animation=prefer_animation,
            force_visual=True,
        )
        if not scene:
            return JSONResponse(content={"visual": None})
        # Honour the button the learner pressed: a video request animates, an
        # image request renders the composed still even if the planner staged it.
        scene["animated"] = prefer_animation
        visual = await render_visual(scene)
    except Exception as exc:  # pragma: no cover - optional visual support
        print(f"⚠️ On-demand visual failed: {exc}")
        return JSONResponse(content={"visual": None})
    return JSONResponse(content={"visual": visual})


@router.get("/coach/support/state")
async def coach_support_state(
    component_id: str | None = Query(default=None, max_length=180),
    learner_id: str = Depends(require_learner),
):
    """Per-question one-shot state for the hint/explanation buttons.

    The key derives from the event-driven `current_state` (component + sub-item
    + question), so moving to the next question re-arms the buttons."""
    from app.agents import tutor_decision
    from app.brain.repository import get_brain
    from app.services import kata_catalog

    brain = await get_brain(learner_id)
    current = brain.get("current_state") or {}
    question_key = tutor_decision.support_question_key(current, component_id)
    used = tutor_decision.support_used(current, question_key)
    # The learner's own question numbering, so the chat can title a thread
    # "שאלה 3" because it IS the third question — not because it is the third
    # section on screen. Empty when the catalog has no snapshot for this
    # component; the client then falls back to the order it encountered them in.
    try:
        await kata_catalog.ensure_loaded()
        # The caption belongs to the lesson ON SCREEN, so the requested component
        # wins here. (`question_key` above still comes from `current_state` — that
        # is the learner's position, which only events may move.) Falling back to
        # the brain's component the other way round numbered a freshly-opened
        # lesson from whichever one the learner was in before.
        active_component = component_id or current.get("component_id")
        ordinals = kata_catalog.question_item_ordinals(active_component)
        question_parts = kata_catalog.question_part_indexes(active_component)
        teaching_only = kata_catalog.non_question_items(active_component)
        item_spine = [
            {
                "id": row.get("id"),
                "kind": kata_catalog.kind_for_row(row),
                "media_format": row.get("media_format") or "",
                "content_type": row.get("content_type") or "",
                "question_count": row.get("question_count") or 0,
            }
            for row in kata_catalog.item_profiles(active_component)
        ]
    except Exception:  # numbering must never break the support buttons
        ordinals, question_parts, teaching_only, item_spine = {}, {}, [], []
    return {
        "question_key": question_key,
        "hint_used": used["hint"],
        "explanation_used": used["explanation"],
        "question_ordinals": ordinals,
        # Which סעיף of a shared screen this is — present only where the screen
        # really does hold several, so the chat never invents a part.
        "question_parts": question_parts,
        # Screens that teach without asking — the chat captions these as a step,
        # never as "question N".
        "teaching_items": teaching_only,
        # The full screen spine with its kind (question / watch / read / step), so
        # the chat can caption a video thread "סרטון" and Yuvi can open the right
        # kind of turn on arrival instead of assuming every screen is a question.
        "items": item_spine,
        "question_total": len({v for v in ordinals.values()}),
    }


@router.post("/coach/support")
async def coach_support(request: CoachSupportRequest, session=Depends(require_learner_session)):
    """Stream learner-requested, current-item-grounded support into the task thread."""
    learner_id = session["sub"]
    language = normalize_language(request.language)
    conversation_id = sessions.normalize_session_id(request.conversation_id)
    exchange_id = uuid4().hex

    # Pressing "רמז" / "הסבר" is a chat turn — reading the answer is not idling.
    triggers.note_chat_activity(learner_id)

    # One-shot per question (server-enforced; the UI disables optimistically):
    # a second identical request on the same question is refused, not streamed.
    from app.agents import tutor_decision
    from app.brain.repository import get_brain

    brain = await get_brain(learner_id)
    current_state = brain.get("current_state") or {}
    question_key = tutor_decision.support_question_key(
        current_state, request.surface.component_id
    )
    if tutor_decision.support_used(current_state, question_key)[request.support]:
        return JSONResponse(
            content={"error": "support_already_used", "question_key": question_key},
            status_code=409,
        )
    await tutor_decision.record_support_used(learner_id, question_key, request.support)

    # Durable teacher-analytics trail: which help the learner used, per question.
    try:
        from app.services import learner_activity
        await learner_activity.record(
            learner_id, request.support,
            component_id=current_state.get("component_id") or request.surface.component_id,
            item_id=current_state.get("item_id"),
            question_id=current_state.get("question_id"),
        )
    except Exception:
        pass

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
        response_parts = []
        async for chunk in run_coach_stream(
            learner_id,
            language=language,
            session_id=conversation_id,
            exchange_id=exchange_id,
            endpoint="/api/agent/coach/support",
            surface_context=request.surface.model_dump(),
            support_mode=request.support,
        ):
            response_parts.append(chunk)
            yield f"data: {json.dumps({'text': chunk}, ensure_ascii=False)}\n\n"

        # Same visual layer as chat replies: a math-shaped hint/explanation can
        # auto-render a scene, and wordy ones offer the on-demand image/video
        # buttons. The support prompt stands in for the (absent) user message.
        support_prompt = SUPPORT_PROMPTS[request.support]
        async for event in _stream_visual_tail(
            learner_id=learner_id,
            conversation_id=conversation_id,
            exchange_id=exchange_id,
            endpoint="/api/agent/coach/support",
            user_message=support_prompt.get(language) or support_prompt["he"],
            response_text="".join(response_parts),
            language=language,
        ):
            yield event
        # Re-stamp on completion: a long answer can outlive the idle timer the
        # request reset, and the silence worth nudging starts when Yuvi stops
        # talking, not when he started.
        triggers.note_chat_activity(learner_id)
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
