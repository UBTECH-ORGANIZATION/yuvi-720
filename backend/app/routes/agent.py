"""Agent API routes (P3+). Thin SSE transport for the floating Learning Coach.

The Coach streams over the non-identifying Context bundle; the AI-use disclosure
is sent as the first SSE event so the UI always shows it (§11).
"""

import json
import re
from typing import Literal, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from app.auth.dependencies import require_admin, require_learner, require_learner_session
from app.agents import safety
from app.agents import sessions
from app.agents.coach import DIAGRAM_FENCE, SUPPORT_PROMPTS, run_coach_stream
from app.agents.coach_tools import registry as coach_tool_registry
from app.brain.memory import classify_query_intent
from app.agents.manim_visual import (
    is_explicit_visual_request,
    plan_manim_visual,
    render_visual,
    should_offer_visual,
    split_visual_response,
)
from app.agents.pedagogical import select_next, route_after_fail
from app.agents import reflection
from app.core.localization import normalize_language
from app.services.ai_usage import UsageContext
from app.services.lrs import reporter as lrs_reporter
from app.services.speech import SpeechUnavailable, synthesize_speech
from app.services import triggers
from app.services import coach_debug_trace
from app.services.coach_support import SupportQuestionChangedError, reserve_support


def _safe_tool_trace(steps: list[dict[str, str]]) -> list[dict[str, str]]:
    """Return only executed, fixed-shape steps from the active Coach turn."""
    safe_steps = []
    for step in steps:
        if not isinstance(step, dict):
            continue
        name = step.get("name")
        status = step.get("status")
        if not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9_:.]{0,79}", name):
            continue
        if status not in {"ok", "blocked", "error"}:
            continue
        safe_steps.append({
            "name": name,
            "status": status,
            "source": "agent" if step.get("source") == "agent" else "system",
        })
    return safe_steps


# The gate used to be a list of MATHS words — triangle, angle, fraction, graph,
# area, perimeter — so a question about the water cycle, a cell, a circuit or a
# series of weighings never reached the planner at all. Whether a picture helps
# is not a property of the subject's vocabulary, so the gate no longer tries to
# recognise topics. It is a cheap NEGATIVE filter: reject the turns that can
# never want a drawing, and let the planner (which can actually judge) see the
# rest. Being wrong here is asymmetric — a needless planner call costs tokens,
# a wrongly blocked turn costs the learner the picture.
_SOCIAL_TURN = {
    "he": re.compile(r"^\W*(?:תודה|תודה רבה|היי|הי|שלום|אהלן|בוקר טוב|ערב טוב|ביי|להתראות|"
                     r"מה נשמע|מה שלומ|סבבה|אוקיי|אוקי|כן|לא|מגניב|יאללה)\b"),
    "ar": re.compile(r"^\W*(?:شكرا|شكرًا|مرحبا|أهلا|اهلا|السلام|صباح الخير|مساء الخير|"
                     r"مع السلامة|كيف حالك|تمام|حسنا|نعم|لا)\b"),
    "en": re.compile(r"^\W*(?:thanks|thank you|thx|hi|hey|hello|good morning|good evening|"
                     r"bye|goodbye|how are you|ok|okay|yes|no|cool|nice)\b", re.IGNORECASE),
}
# A reply that never wants a diagram whatever it is about.
_NON_EXPLANATORY_REPLY = re.compile(
    r"^\W*(?:בשמחה|כיף|נעים|אין בעיה|הכל טוב|בכיף|"
    r"على الرحب|بكل سرور|لا مشكلة|"
    r"you're welcome|no problem|glad to)\b",
    re.IGNORECASE,
)
# Enough substance to be worth a planning call. Below this the reply is an
# acknowledgement, not an explanation.
_MIN_EXPLANATION_CHARS = 80
_MIN_QUESTION_CHARS = 8


def _worth_visual_planning(message: str, response_text: str) -> bool:
    """Cheap gate before the visual-planner LLM call — a social turn or a short
    acknowledgement never justifies a full planning request. Everything that
    reads as an explanation is passed on for the planner to judge."""
    question = message.strip()
    reply = response_text.strip()
    if len(reply) < _MIN_EXPLANATION_CHARS:
        return False
    # "בשמחה — הנה איור…" is how Yuvi now complies with a request for a picture,
    # so the acknowledgement opener only disqualifies a reply nobody asked to see.
    asked_to_see = any(
        is_explicit_visual_request(question, lang) for lang in ("he", "ar", "en")
    )
    if not asked_to_see and _NON_EXPLANATORY_REPLY.match(reply):
        return False
    if any(pattern.match(question) for pattern in _SOCIAL_TURN.values()):
        return False
    return len(question) >= _MIN_QUESTION_CHARS


def _auto_visual_for_coach(message: str, language: str, screen: str) -> bool:
    return (
        screen != "learning_lesson"
        and classify_query_intent(message, language) != "calendar_query"
    )


async def _current_question_context(learner_id: str) -> str:
    """The question the learner is on, as text the visual planner can draw from.

    The planner used to see only the learner's message and the coach's reply.
    That is enough for "draw me a triangle" and useless for a hint, which is
    written to withhold every value and option — so the planner had no data and
    declined, exactly when a picture would have helped most. The question is
    where the numbers live.

    Text only. The options and the correct answer stay out: widening what the
    planner can SEE must never widen what it could draw.
    """
    from app.brain.repository import get_brain
    from app.services import kata_catalog

    try:
        brain = await get_brain(learner_id)
        state = brain.get("current_state") or {}
        component_id, item_id = state.get("component_id"), state.get("item_id")
        if not component_id or not item_id:
            return ""
        await kata_catalog.ensure_loaded()
        rows = kata_catalog.questions_for_item(component_id, item_id) or []
    except Exception as exc:  # never block a reply on catalogue availability
        print(f"ℹ️ visual question context unavailable: {exc}")
        return ""

    question_id = state.get("question_id")
    row = next(
        (r for r in rows if question_id and r.get("questionId") == question_id),
        rows[0] if rows else None,
    )
    return str((row or {}).get("questionText") or "")[:600]


async def _stream_visual_tail(
    *,
    learner_id: str,
    conversation_id: str,
    exchange_id: str,
    endpoint: str,
    user_message: str,
    response_text: str,
    language: str,
    on_lesson_screen: bool,
    auto_visual: bool = True,
    debug_trace: list[dict[str, str]] | None = None,
):
    """SSE tail shared by chat + hint/explanation replies: the optional visual.

    Auto-plans a bounded Manim scene when the reply is math-shaped (no generated
    Python is ever executed), else classifies whether to offer the on-demand
    image/video buttons. Failure never blocks the conversation.

    ``auto_visual`` is off for lesson chat: mid-question, a picture the learner
    did not ask for interrupts the work in front of them, so "what does this
    word mean?" gets an answer and the on-demand button — not a diagram. Hints
    and explanations still draw on their own, and an explicit request always does.
    """
    # Text generation is finished. Yuvi returns to a thinking pose while
    # the optional visual planner runs; no response text is replayed.
    yield f"data: {json.dumps({'phase': 'thinking'}, ensure_ascii=False)}\n\n"

    screened_message = user_message
    scene = None
    will_plan = False
    visual_stage = "plan"
    try:
        screened_message = safety.screen_input(user_message, language).text or user_message
        # Yuvi has just promised the picture (VISUAL_REQUEST_ACK), so the planner
        # is told to produce one rather than left free to decline.
        asked_to_see = is_explicit_visual_request(screened_message, language)
        will_plan = (asked_to_see or auto_visual) and not (
            # The reply already carries a diagram. A second picture is one
            # visual too many, and the placement step below would delete the
            # first fenced block to make room for it — that diagram.
            DIAGRAM_FENCE in response_text
            or safety.is_safety_redirect(response_text)
            or not _worth_visual_planning(screened_message, response_text)
        )
        # The pointer outlives the lesson screen, and the planner is told the
        # question is what the learner is looking at — so off the lesson it would
        # drag an unrelated request back to the last question's numbers.
        question_context = (
            await _current_question_context(learner_id)
            if will_plan and on_lesson_screen else ""
        )
        if will_plan:
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
            force_visual=asked_to_see,
            text_filter=lambda text: safety.screen_output(text, language).text,
            question_context=question_context,
        )
        if will_plan:
            coach_debug_trace.append(
                debug_trace, "visual_plan", "ok" if scene else "blocked"
            )
        if will_plan and not scene:
            yield f"data: {json.dumps({'visual_status': 'none'}, ensure_ascii=False)}\n\n"
        if scene:
            text_before, text_after = split_visual_response(response_text)
            status = {
                'visual_status': 'rendering',
                'text_before': text_before,
                'text_after': text_after,
            }
            yield f"data: {json.dumps(status, ensure_ascii=False)}\n\n"
            visual_stage = "render"
            visual = await render_visual(scene)
            coach_debug_trace.append(debug_trace, "visual_render")
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
        coach_debug_trace.append(debug_trace, f"visual_{visual_stage}", "error")
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
    launch_session_id: str | None = Field(default=None, min_length=1, max_length=80)


CoachConversationMode = Literal["lesson_coach", "general_companion"]


class CoachSurfaceContext(BaseModel):
    """Bounded semantic context; arbitrary DOM text and URLs are not accepted."""

    model_config = ConfigDict(extra="forbid")
    screen: Literal[
        "results", "student_dashboard", "mentoring", "learning_portal",
        "learning_world", "learning_lesson", "learning_create", "teacher_app",
        "unknown",
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
    support: Literal["hint", "explanation", "video_summary", "video_visual"]
    language: str = Field(default="he", max_length=8)
    surface: CoachSurfaceContext = Field(default_factory=CoachSurfaceContext)
    question_key: Optional[str] = Field(default=None, max_length=400)


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
    assistant_message_id: str | None = Field(default=None, min_length=3, max_length=120)


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


_VIDEO_VISUAL_REQUEST = {
    "he": "צור/י המחשה לימודית מונפשת, ברורה ומעניינת שמסבירה את הרעיונות המרכזיים של הסרטון. השתמש/י אך ורק במידע המאושר שמופיע בתוכן המקור, בלי להוסיף עובדות או פתרון לשאלת הבנה.",
    "ar": "أنشئ/ي توضيحًا تعليميًا متحركًا وواضحًا وجذابًا يشرح الأفكار المركزية في الفيديو. استخدم/ي فقط المعلومات المعتمدة في محتوى المصدر، من دون إضافة حقائق أو حل سؤال فهم.",
    "en": "Create a clear, engaging animated educational visual that explains the video's central ideas. Use only the authorized source content, without adding facts or solving a comprehension question.",
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
        # MoE 720 `item/selected`: choosing the alternative-representation
        # explainer is a real non-assessed learning-type choice. The object is
        # the ITEM the explainer was opened for (not the component) — the
        # integration review found the id AND the declared type disagreeing
        # (a `/component/...` id typed as `item`); `current.get("item_id")` was
        # already resolved above for the activity log, just never reused here.
        item_id = current.get("item_id")
        if session.get("sid") and (component_id or item_id):
            from app.services.lrs import config as lrs_config
            if item_id:
                object_id = f"{lrs_config.supplier_domain()}/item/{item_id}"
                object_type = "item"
            else:
                object_id = f"{lrs_config.supplier_domain()}/component/{component_id}"
                object_type = "component"
            await lrs_reporter.report_selected(
                learner_id,
                session["sid"],
                object_id=object_id,
                object_type=object_type,
                selection_type="learningType",
                response="alternative-explainer",
                component_id=component_id,
                item_id=item_id,
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

    # An explicit Hebrew request for a hint belongs to the same bounded,
    # measurable support lane as the hint button, never unrestricted chat help.
    from app.agents import tutor_decision
    from app.brain.repository import get_brain

    routed_hint_level = None
    is_chat_hint = False
    if request.surface.screen == "learning_lesson" and tutor_decision.is_explicit_hint_request(message):
        current_state = (await get_brain(learner_id)).get("current_state") or {}
        is_chat_hint = bool(current_state.get("item_id") and current_state.get("question_id"))
        if is_chat_hint:
            reservation = await reserve_support(
                learner_id,
                "hint",
                surface_component_id=request.surface.component_id,
                session_id=session.get("sid"),
                conversation_id=conversation_id,
            )
            if reservation is None:
                return JSONResponse(
                    content={"error": "support_already_used"},
                    status_code=409,
                )
            routed_hint_level = reservation.hint_level

    # Talking to Yuvi is working: hold off the idle watchdog, which otherwise
    # only watches the content iframe and would nudge mid-conversation.
    triggers.note_chat_activity(learner_id)

    # MoE 720: one `interacted` per chat turn — the student's message now, the
    # bot's reply when the stream completes. Chat text is never sent.
    moe_sid = session.get("sid")
    component_iri = _surface_component_iri(request.surface)
    if moe_sid and not is_chat_hint:
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
        if current_state.get("item_id") and not is_chat_hint:
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
        action_offers: list[dict[str, object]] = []
        visual_requests: list[dict[str, str]] = []
        debug_trace: list[dict[str, str]] = []
        query_intent: list[str] = []
        async for chunk in run_coach_stream(
            learner_id,
            user_message=message,
            language=language,
            session_id=conversation_id,
            exchange_id=exchange_id,
            endpoint=("/api/agent/coach/support" if is_chat_hint else "/api/agent/coach/stream"),
            surface_context=request.surface.model_dump(),
            support_mode="hint" if is_chat_hint else None,
            hint_level=routed_hint_level,
            action_offers=action_offers,
            visual_requests=visual_requests,
            debug_trace=debug_trace,
            intent_out=query_intent,
        ):
            response_parts.append(chunk)
            # Forward every model chunk immediately. The frontend already
            # appends text events, so Yuvi visibly speaks while generating.
            yield f"data: {json.dumps({'text': chunk}, ensure_ascii=False)}\n\n"

        if query_intent:
            yield f"data: {json.dumps({'query_intent': query_intent[0]}, ensure_ascii=False)}\n\n"

        if action_offers:
            yield f"data: {json.dumps({'actions': action_offers}, ensure_ascii=False)}\n\n"

        response_text = "".join(response_parts)
        async for event in _stream_visual_tail(
            learner_id=learner_id,
            conversation_id=conversation_id,
            exchange_id=exchange_id,
            endpoint=("/api/agent/coach/support" if is_chat_hint else "/api/agent/coach/stream"),
            user_message=message,
            response_text=response_text,
            language=language,
            on_lesson_screen=request.surface.screen == "learning_lesson",
            auto_visual=(
                bool(visual_requests)
                or _auto_visual_for_coach(message, language, request.surface.screen)
            ),
            debug_trace=debug_trace,
        ):
            yield event

        await coach_debug_trace.record(exchange_id, debug_trace)
        yield f"data: {json.dumps({'tool_trace': _safe_tool_trace(debug_trace)}, ensure_ascii=False)}\n\n"

        if moe_sid and not is_chat_hint:  # the bot's turn of this exchange
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


@router.get("/coach/debug-traces/{exchange_id}")
async def get_coach_debug_trace(exchange_id: str, _: str = Depends(require_admin)):
    """Read one development-only, content-free Coach execution timeline."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", exchange_id):
        raise HTTPException(status_code=404, detail="Trace not found")
    trace = await coach_debug_trace.read(exchange_id)
    if trace is None:
        raise HTTPException(status_code=404, detail="Trace not found")
    return JSONResponse(content=trace, headers={"Cache-Control": "no-store"})


@router.get("/coach/conversations")
async def coach_conversations(
    limit: int = Query(default=12, ge=1, le=30),
    cursor: str | None = Query(default=None, max_length=400),
    mode: CoachConversationMode = Query(default="general_companion"),
    learner_id: str = Depends(require_learner),
):
    """Page through learner-owned Coach threads, newest first."""
    safe_id = learner_id
    return JSONResponse(
        content=await sessions.list_conversations(
            safe_id, role=mode, limit=limit, cursor=cursor
        ),
        headers={"Cache-Control": "private, no-store"},
    )


@router.post("/coach/conversations", status_code=201)
async def create_coach_conversation(request: CoachConversationRequest, learner_id: str = Depends(require_learner)):
    """Start a new empty Coach thread without storing state in the browser."""
    lesson_requested = bool(request.unit_id or request.component_id)
    if lesson_requested and not (request.unit_id and request.component_id and request.launch_session_id):
        raise HTTPException(status_code=422, detail="Lesson conversations require unit, component, and launch session")
    safe_id = learner_id
    return JSONResponse(
        status_code=201,
        content=await sessions.create_conversation(
            safe_id,
            role=(
                "lesson_coach"
                if request.unit_id and request.component_id
                else "general_companion"
            ),
            unit_id=request.unit_id,
            component_id=request.component_id,
            launch_session_id=request.launch_session_id,
        ),
    )


@router.get("/coach/conversations/{conversation_id}/messages")
async def coach_conversation_messages(
    conversation_id: str,
    limit: int = Query(default=20, ge=1, le=50),
    cursor: str | None = Query(default=None, max_length=400),
    mode: CoachConversationMode = Query(default="general_companion"),
    learner_id: str = Depends(require_learner),
):
    """Page backward through one conversation for scroll-up loading."""
    safe_id = learner_id
    return JSONResponse(
        content=await sessions.list_messages(
            safe_id,
            sessions.normalize_session_id(conversation_id),
            role=mode,
            limit=limit,
            cursor=cursor,
        ),
        headers={"Cache-Control": "private, no-store"},
    )


@router.delete("/coach/conversations/{conversation_id}")
async def delete_coach_conversation(
    conversation_id: str,
    mode: CoachConversationMode = Query(default="general_companion"),
    learner_id: str = Depends(require_learner),
):
    """Soft-delete a learner-owned thread while retaining its durable records."""
    safe_id = learner_id
    deleted = await sessions.soft_delete_conversation(
        safe_id,
        sessions.normalize_session_id(conversation_id),
        role=mode,
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return JSONResponse(content={"ok": True})


@router.post("/coach/lesson-conversations/{conversation_id}/end")
async def end_lesson_coach_conversation(
    conversation_id: str,
    learner_id: str = Depends(require_learner),
):
    """Erase the temporary lesson-scoped Coach thread when the learner leaves."""
    deleted = await sessions.end_lesson_conversation(
        learner_id,
        sessions.normalize_session_id(conversation_id),
    )
    return JSONResponse(content={"ok": True, "deleted": deleted})


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
        debug_trace: list[dict[str, str]] = []
        async for chunk in run_coach_stream(
            learner_id,
            trigger=trigger,
            language=language,
            session_id=conversation_id,
            exchange_id=exchange_id,
            endpoint="/api/agent/coach/proactive",
            surface_context=request.surface.model_dump(),
            pinned_question_key=request.question_key,
            debug_trace=debug_trace,
        ):
            yield f"data: {json.dumps({'text': chunk}, ensure_ascii=False)}\n\n"
        await coach_debug_trace.record(exchange_id, debug_trace)
        yield f"data: {json.dumps({'tool_trace': _safe_tool_trace(debug_trace)}, ensure_ascii=False)}\n\n"
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
    if request.assistant_message_id:
        attached = await sessions.attach_visual(
            learner_id,
            conversation_id,
            request.assistant_message_id,
            visual,
            request.assistant_text,
            "",
            role="general_companion",
        )
        if not attached:
            print(f"⚠️ On-demand visual was rendered but not attached to {request.assistant_message_id}")
    return JSONResponse(content={"visual": visual})


@router.get("/coach/support/state")
async def coach_support_state(
    component_id: str | None = Query(default=None, max_length=180),
    learner_id: str = Depends(require_learner),
):
    """Per-question support state and the lesson item spine for Coach actions.

    The key derives from the event-driven `current_state` (component + sub-item
    + question), so moving to the next question re-arms the buttons."""
    from app.agents import tutor_decision
    from app.brain.repository import get_brain
    from app.services import kata_catalog, learner_activity

    brain = await get_brain(learner_id)
    current = brain.get("current_state") or {}
    question_key = tutor_decision.support_question_key(current, component_id)
    used = tutor_decision.support_used(current, question_key)
    # The learner's own question numbering, so the chat can title a thread
    # "שאלה 3" because it IS the third question — not because it is the third
    # section on screen. Empty when the catalog has no snapshot for this
    # component; the client then falls back to the order it encountered them in.
    active_component = component_id or current.get("component_id")
    item_questions = []
    try:
        await kata_catalog.ensure_loaded()
        # The caption belongs to the lesson ON SCREEN, so the requested component
        # wins here. (`question_key` above still comes from `current_state` — that
        # is the learner's position, which only events may move.) Falling back to
        # the brain's component the other way round numbered a freshly-opened
        # lesson from whichever one the learner was in before.
        ordinals = kata_catalog.question_item_ordinals(active_component)
        question_parts = kata_catalog.question_part_indexes(active_component)
        teaching_only = kata_catalog.non_question_items(active_component)
        item_questions = kata_catalog.questions_for_item(
            active_component, current.get("item_id")
        )
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
    content_hint_used = await learner_activity.has_content_hint(
        learner_id,
        component_id=active_component,
        item_id=current.get("item_id"),
        question_id=current.get("question_id"),
    )
    return {
        "question_key": question_key,
        "hint_used": used["hint"],
        "content_hint_used": content_hint_used,
        "hint_level": used["hint_level"],
        "max_hint_level": tutor_decision.MAX_HINT_LEVEL,
        "explanation_used": used["explanation"],
        # Video support is scoped to the active client visit, not learner
        # history. The browser keeps these flags in its in-memory UI state.
        "video_summary_used": False,
        "video_visual_used": False,
        # Bumped when this SAME video item signals a clip boundary by either
        # re-`initialized` or `completed` (see events._apply_event_to_brain).
        # The client keys its per-video support flags by item + generation so
        # clip 2 re-arms the buttons clip 1 used.
        "item_generation": current.get("item_generation") or 0,
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

    hint_level = None
    video_context: dict[str, str | None] | None = None
    if request.support in {"video_summary", "video_visual"}:
        # Video help is allowed only for the video the learner is actually on.
        # `informationToBot` is the catalog-authorized source; no transcript or
        # plausible-looking content is fetched or invented at request time.
        from app.brain.repository import get_brain
        from app.services import kata_catalog

        current_state = (await get_brain(learner_id)).get("current_state") or {}
        component_id = current_state.get("component_id") or request.surface.component_id
        item_id = current_state.get("item_id")
        try:
            await kata_catalog.ensure_loaded()
            item = kata_catalog.item_profile(component_id, item_id)
            source_text = kata_catalog.information_for_item(component_id, item_id)
        except Exception:
            item, source_text = {}, None
        if (
            request.surface.screen != "learning_lesson"
            or str(item.get("media_format") or "") != "video"
            or not str(source_text or "").strip()
        ):
            return JSONResponse(content={"error": "video_summary_unavailable"}, status_code=409)
        video_context = {
            "component_id": component_id,
            "item_id": item_id,
            "question_id": current_state.get("question_id"),
            "source_text": str(source_text).strip(),
        }
    else:
        # The hint ladder and one-shot explanation are server-enforced. Button
        # and qualifying chat requests reserve the same allowance.
        try:
            reservation = await reserve_support(
                learner_id,
                request.support,
                surface_component_id=request.surface.component_id,
                session_id=session.get("sid"),
                conversation_id=conversation_id,
                expected_question_key=request.question_key,
            )
        except SupportQuestionChangedError as exc:
            return JSONResponse(
                content={"error": "question_changed", "question_key": exc.current_question_key},
                status_code=409,
            )
        if reservation is None:
            return JSONResponse(
                content={"error": "support_already_used"},
                status_code=409,
            )
        hint_level = reservation.hint_level

    async def event_generator():
        yield f"data: {json.dumps({'disclosure': safety.disclosure(language), 'support': request.support}, ensure_ascii=False)}\n\n"
        if request.support == "video_visual":
            try:
                yield f"data: {json.dumps({'phase': 'thinking', 'visual_status': 'planning'}, ensure_ascii=False)}\n\n"
                scene = await plan_manim_visual(
                    _VIDEO_VISUAL_REQUEST[language],
                    video_context["source_text"] if video_context else "",
                    language,
                    usage_context=UsageContext(
                        actor_id=learner_id,
                        actor_type="learner",
                        endpoint="/api/agent/coach/support",
                        feature="feature_3_learning_companion",
                        operation="coach.video_visual",
                        source="coach_video_visual_tool",
                        session_id=conversation_id,
                        exchange_id=exchange_id,
                    ),
                    text_filter=lambda text: safety.screen_output(text, language).text,
                    prefer_animation=True,
                    force_visual=True,
                )
                if scene:
                    scene["animated"] = True
                    yield f"data: {json.dumps({'visual_status': 'rendering'}, ensure_ascii=False)}\n\n"
                    visual = await render_visual(scene)
                    yield f"data: {json.dumps({'visual': visual}, ensure_ascii=False)}\n\n"
                else:
                    yield f"data: {json.dumps({'visual_status': 'none'}, ensure_ascii=False)}\n\n"
            except Exception as exc:  # pragma: no cover - optional visual support
                print(f"⚠️ Video visual tool failed: {exc}")
                yield f"data: {json.dumps({'visual_status': 'none'}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
            return

        response_parts = []
        debug_trace: list[dict[str, str]] = []
        async for chunk in run_coach_stream(
            learner_id,
            language=language,
            session_id=conversation_id,
            exchange_id=exchange_id,
            endpoint="/api/agent/coach/support",
            surface_context=request.surface.model_dump(),
            support_mode=request.support,
            hint_level=hint_level,
            debug_trace=debug_trace,
        ):
            response_parts.append(chunk)
            yield f"data: {json.dumps({'text': chunk}, ensure_ascii=False)}\n\n"

        response_text = "".join(response_parts).strip()
        # A video summary is deliberately text-only. Other support replies may
        # still offer or render a visual when that supports the current lesson.
        if request.support != "video_summary":
            support_prompt = SUPPORT_PROMPTS[request.support]
            async for event in _stream_visual_tail(
                learner_id=learner_id,
                conversation_id=conversation_id,
                exchange_id=exchange_id,
                endpoint="/api/agent/coach/support",
                user_message=support_prompt.get(language) or support_prompt["he"],
                response_text=response_text,
                language=language,
                on_lesson_screen=request.surface.screen == "learning_lesson",
                debug_trace=debug_trace,
            ):
                yield event
        await coach_debug_trace.record(exchange_id, debug_trace)
        yield f"data: {json.dumps({'tool_trace': _safe_tool_trace(debug_trace)}, ensure_ascii=False)}\n\n"
        # Re-stamp on completion: a long answer can outlive the idle timer the
        # request reset, and the silence worth nudging starts when Yuvi stops
        # talking, not when he started.
        triggers.note_chat_activity(learner_id)
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/presence/surface")
async def presence_surface(
    request: CoachSurfaceContext, learner_id: str = Depends(require_learner)
):
    """Where this learner's client is in the product, for the live classroom.

    The body is the same bounded `CoachSurfaceContext` every coach call already
    sends — a closed enum of screens, no free text or URLs — so there is no new
    wire shape to validate. Advisory on the other end too: presence maps it to
    a `surface` field and never to `status`, which stays xAPI-authoritative.
    """
    from app.services import presence

    # The lesson ids ride along so the live view can NAME the learning the
    # client is standing on; they resolve to a catalog title server-side.
    presence.note_surface(
        learner_id, request.screen,
        unit_id=request.unit_id, component_id=request.component_id,
    )
    return JSONResponse(content={"ok": True})
