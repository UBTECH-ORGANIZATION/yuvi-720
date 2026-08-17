"""Spoken English practice — token minting, pronunciation scoring, voice calls.

Two audio paths:

  * Scored practice (a speaking item in a lomda) uses the Azure Speech SDK in the
    page with a ~10-minute token from here, so that audio goes from the browser
    straight to Azure; the score sheet comes back and is turned into words by
    `services/pronunciation.py`.
  * Free conversation with Yuvi runs on Voice Live, which is a WebSocket API with
    no ephemeral secret to give a browser, so `voice_stream` relays it. That audio
    passes through this process in memory and is never written down.

Both feed the same L1→English ladder, which is derived from evidence in
`services/english_ladder.py` and never chosen by a model.
"""

from __future__ import annotations

import asyncio
from contextlib import suppress
import json
import os
from typing import Any, Optional
from uuid import uuid4

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
import websockets
from websockets.exceptions import ConnectionClosed

from app.agents import safety
from app.auth.dependencies import require_learner, require_learner_session
from app.brain.repository import apply_brain_updates, get_brain
from app.core.localization import normalize_language
from app.services import english_correction, english_ladder, pronunciation, realtime_voice, transcription
from app.services.ai_usage import UsageContext, UsageTimer, provider_request_id, record_usage
from app.services.lrs import reporter as lrs_reporter
from app.services.speech import SpeechUnavailable, issue_token

router = APIRouter(prefix="/api", tags=["speech"])

_UNAVAILABLE = {
    "he": "התרגול הקולי לא זמין כרגע. אפשר להמשיך בכתב, וזה עובד בדיוק אותו דבר.",
    "ar": "التدريب الصوتي غير متاح حالياً. يمكنكم المتابعة كتابةً، وهذا فعّال تماماً.",
    "en": "Voice practice is not available right now. You can carry on in writing — it works just as well.",
}

_FEATURE = "feature_3_learning_companion"


# ── shared ladder bookkeeping ────────────────────────────────────────────────
async def _fold_into_ladder(
    learner_id: str,
    *,
    accuracy: Optional[float],
    fluency: Optional[float],
    spoke_english: bool,
    scored: bool,
) -> dict[str, Any]:
    """Move the learner along the L1→English ladder and persist the new rung."""
    brain = await get_brain(learner_id)
    profile = brain.get("profile") or {}
    state = profile.get("english_speaking") or english_ladder.empty_state()
    ratio = english_ladder.mastery_ratio(brain.get("mastery"))
    updated = english_ladder.apply_attempt(
        state,
        accuracy=accuracy,
        fluency=fluency,
        spoke_english=spoke_english,
        scored=scored,
        mastery_ratio=ratio,
        now=pronunciation.now_iso(),
    )
    await apply_brain_updates(learner_id, {"profile.english_speaking": updated})
    return updated


async def current_stage(learner_id: str) -> str:
    brain = await get_brain(learner_id)
    state = (brain.get("profile") or {}).get("english_speaking") or {}
    return state.get("stage") or english_ladder.STAGE_L1


# ── Speech token ─────────────────────────────────────────────────────────────
@router.post("/speech/token")
async def speech_token(learner_id: str = Depends(require_learner)):
    """A short-lived Azure Speech token for the learner's browser."""
    try:
        token = await issue_token()
    except SpeechUnavailable as exc:
        print(f"⚠️ Speech token unavailable: {exc}")
        raise HTTPException(status_code=503, detail="speech_unavailable") from exc
    return JSONResponse(content=token, headers={"Cache-Control": "no-store"})


@router.post("/speech/transcribe")
async def speech_transcribe(
    audio: UploadFile = File(...),
    vocabulary: str = Form(default=""),
    learner_id: str = Depends(require_learner),
):
    """Transcribe one spoken turn, preserving each language in its own script."""
    payload = await audio.read()
    terms = [term for term in (vocabulary or "").split(",") if term.strip()]
    context = UsageContext(
        actor_id=learner_id,
        actor_type="learner",
        endpoint="/api/speech/transcribe",
        feature="learning_coach",
        operation="speech_to_text",
        source="companion_dictation",
    )
    timer = UsageTimer.start()
    deployment = os.getenv("AZURE_TRANSCRIBE_DEPLOYMENT", transcription.DEFAULT_DEPLOYMENT)
    seconds = transcription.wav_duration_seconds(payload)

    try:
        text, response = await transcription.transcribe(
            payload,
            filename=audio.filename or "speech.wav",
            content_type=audio.content_type or "audio/wav",
            vocabulary=terms,
        )
    except transcription.TranscriptionUnavailable as exc:
        await record_usage(
            context=context,
            timer=timer,
            provider="azure_openai",
            gateway="azure_openai_rest",
            deployment=deployment,
            api_version=transcription.API_VERSION,
            streaming=False,
            meter="seconds",
            status="failed",
            usage_status="unavailable",
            quantity=round(seconds) if seconds else None,
            quantity_unit="seconds",
            error=exc,
        )
        raise HTTPException(status_code=503, detail="transcription_unavailable") from exc

    await record_usage(
        context=context,
        timer=timer,
        provider="azure_openai",
        gateway="azure_openai_rest",
        deployment=deployment,
        api_version=transcription.API_VERSION,
        streaming=False,
        meter="seconds",
        status="completed",
        usage_status="exact" if seconds is not None else "unavailable",
        quantity=round(seconds) if seconds else None,
        quantity_unit="seconds",
        provider_request=provider_request_id(response.headers),
    )

    return JSONResponse(
        content={"text": text, "language": transcription.dominant_language(text)},
        headers={"Cache-Control": "no-store"},
    )


# ── Pronunciation ────────────────────────────────────────────────────────────
class PronunciationRequest(BaseModel):
    assessment: dict[str, Any]
    language: str = "he"
    referenceText: str = Field(default="", max_length=400)
    componentId: Optional[str] = Field(default=None, max_length=180)
    itemId: Optional[str] = Field(default=None, max_length=180)
    questionId: Optional[str] = Field(default=None, max_length=80)


async def assess_and_record(
    learner_id: str,
    request: PronunciationRequest,
    *,
    endpoint: str,
    session_id: Optional[str] = None,
) -> dict[str, Any]:
    """Score sheet in → verbal feedback out, with usage, ladder and xAPI.

    Shared by the companion (cookie auth) and the lomda player (launch-token
    auth), because it must behave identically wherever the learner spoke.
    """
    language = normalize_language(request.language)
    timer = UsageTimer.start()
    try:
        result = pronunciation.normalize_result(request.assessment)
    except pronunciation.PronunciationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    await pronunciation.record_assessment_usage(
        result,
        context=UsageContext(
            actor_id=learner_id,
            actor_type="learner",
            endpoint=endpoint,
            feature=_FEATURE,
            operation="speech.pronunciation",
            source="pronunciation_route",
            session_id=session_id,
        ),
        timer=timer,
    )

    feedback = pronunciation.verbal_feedback(result, language)
    scores = result["scores"]
    ladder = await _fold_into_ladder(
        learner_id,
        accuracy=scores.get("accuracy") or scores.get("pronunciation"),
        fluency=scores.get("fluency"),
        spoke_english=pronunciation.spoke_english(result),
        scored=True,
    )

    if session_id and request.itemId:
        # Report-and-forget: a reporting failure must never cost the learner
        # their feedback.
        try:
            accuracy = scores.get("accuracy") or scores.get("pronunciation")
            await lrs_reporter.report_spoken_attempt(
                learner_id,
                session_id,
                object_id=f"{request.itemId}/{request.questionId or 'speaking'}",
                question_id=request.questionId or "speaking",
                reference_text=request.referenceText,
                success=feedback["band"] != "developing",
                score_scaled=round(accuracy / 100, 3) if accuracy is not None else None,
                duration_seconds=result.get("duration_seconds"),
                accuracy=accuracy,
                fluency=scores.get("fluency"),
                completeness=scores.get("completeness"),
                prosody=scores.get("prosody"),
                spoken_language="en",
            )
        except Exception as exc:
            print(f"⚠️ spoken attempt not reported ({type(exc).__name__})")

    return {"feedback": feedback, "stage": ladder.get("stage")}


@router.post("/speech/pronunciation")
async def speech_pronunciation(
    request: PronunciationRequest,
    session=Depends(require_learner_session),
):
    return JSONResponse(content=await assess_and_record(
        session["sub"], request,
        endpoint="/api/speech/pronunciation",
        session_id=session.get("sid"),
    ))


# ── Realtime voice session ───────────────────────────────────────────────────
class VoiceSessionRequest(BaseModel):
    language: str = "he"
    surface: Optional[str] = Field(default=None, max_length=60)
    referenceText: Optional[str] = Field(default=None, max_length=400)


@router.post("/agent/voice/session")
async def voice_session(
    request: VoiceSessionRequest,
    session=Depends(require_learner_session),
):
    """Availability and the AI-use disclosure. Carries no credential."""
    language = normalize_language(request.language)
    if not realtime_voice.is_configured():
        raise HTTPException(status_code=503, detail=_UNAVAILABLE[language])
    return JSONResponse(
        content={"disclosure": safety.disclosure(language), "language": language},
        headers={"Cache-Control": "no-store"},
    )


async def _voice_brief(
    learner_id: str,
    *,
    language: str,
    surface: Optional[str],
    reference_text: Optional[str],
) -> tuple[str, str]:
    """The instructions for one call, plus the ladder rung that shaped them."""
    try:
        from app.brain.context_engine import build_coach_bundle

        bundle = await build_coach_bundle(
            learner_id,
            surface_context={"screen": surface} if surface else None,
        )
    except Exception as exc:  # a context failure must not block practice
        print(f"⚠️ voice context unavailable ({type(exc).__name__}); using a generic brief")
        bundle = {}

    stage = await current_stage(learner_id)
    return realtime_voice.build_instructions(
        bundle,
        language=language,
        stage=stage,
        reference_text=reference_text,
    ), stage


@router.websocket("/agent/voice/stream")
async def voice_stream(websocket: WebSocket):
    """Relay one spoken call between the learner's browser and Voice Live.

    The relay exists because Voice Live is a WebSocket API with no ephemeral
    secret to hand a browser, and it earns its keep by owning the one decision
    the client must not make: which voice Yuvi answers in. Audio is forwarded
    frame by frame in memory and never written anywhere.
    """
    from app.auth.dependencies import COOKIE_NAME, ROLE_LEARNER
    from app.auth.tokens import decode_session_token

    session = decode_session_token(websocket.cookies.get(COOKIE_NAME) or "")
    if not session or ROLE_LEARNER not in (session.get("roles") or []):
        await websocket.close(code=4401)
        return
    if not realtime_voice.is_configured():
        await websocket.close(code=4503)
        return

    await websocket.accept()
    learner_id = session["sub"]

    try:
        opening = await websocket.receive_json()
    except (WebSocketDisconnect, ValueError):
        return

    language = normalize_language(opening.get("language") or "he")
    instructions, stage = await _voice_brief(
        learner_id,
        language=language,
        surface=(opening.get("surface") or None),
        reference_text=(opening.get("referenceText") or None),
    )
    spoken = realtime_voice.call_language(stage, language)
    locale, voice = realtime_voice.voice_for_call(spoken)

    try:
        upstream = await websockets.connect(
            realtime_voice.socket_url(),
            additional_headers=realtime_voice.socket_headers(),
            max_size=None,
        )
    except Exception as exc:
        print(f"⚠️ voice live refused the connection ({type(exc).__name__})")
        await websocket.close(code=4503)
        return

    async with upstream:
        await upstream.send(json.dumps({
            "type": "session.update",
            "session": realtime_voice.session_payload(instructions, locale, voice),
        }))
        await websocket.send_json({"type": "yuvi.ready", "stage": stage, "locale": locale})

        async def to_azure() -> None:
            while True:
                await upstream.send(await websocket.receive_text())

        async def to_browser() -> None:
            while True:
                raw = await upstream.recv()
                if isinstance(raw, str):
                    await websocket.send_text(raw)

        pump = [asyncio.create_task(to_azure()), asyncio.create_task(to_browser())]
        try:
            done, pending = await asyncio.wait(pump, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            for task in done:
                exc = task.exception()
                if exc and not isinstance(exc, (WebSocketDisconnect, ConnectionClosed)):
                    print(f"⚠️ voice relay ended ({type(exc).__name__})")
        finally:
            for task in pump:
                task.cancel()
            with suppress(RuntimeError):
                await websocket.close()


class VoiceUsageRequest(BaseModel):
    usage: dict[str, Any]
    latencyMs: Optional[int] = Field(default=None, ge=0, le=600_000)
    sessionId: Optional[str] = Field(default=None, max_length=120)
    status: str = Field(default="completed", max_length=20)


@router.post("/agent/voice/usage")
async def voice_usage(
    request: VoiceUsageRequest,
    session=Depends(require_learner_session),
):
    """Record the provider's own token counts for one realtime response.

    The audio never passes through us, so the client is the only place that sees
    `response.done`. It relays the usage block verbatim; anything the provider
    did not report stays null rather than being inferred here.
    """
    usage = realtime_voice.usage_from_response(request.usage)
    timer = UsageTimer.start()
    await record_usage(
        context=UsageContext(
            actor_id=session["sub"],
            actor_type="learner",
            endpoint="/api/agent/voice/usage",
            feature=_FEATURE,
            operation="coach.voice",
            source="realtime_client",
            session_id=request.sessionId,
            exchange_id=uuid4().hex,
        ),
        timer=timer,
        provider=realtime_voice.PROVIDER,
        gateway=realtime_voice.GATEWAY,
        deployment=realtime_voice._deployment() or "gpt-realtime",
        api_version=realtime_voice._api_version(),
        streaming=True,
        meter="tokens",
        status="completed" if request.status == "completed" else "failed",
        usage_status="exact" if usage else "unavailable",
        usage=usage,
    )
    return JSONResponse(content={"ok": True})


class VoiceTurnRequest(BaseModel):
    learnerText: str = Field(default="", max_length=2000)
    coachText: str = Field(default="", max_length=2000)
    language: str = "he"
    conversationId: Optional[str] = Field(default=None, max_length=120)


@router.post("/agent/voice/turn")
async def voice_turn(
    request: VoiceTurnRequest,
    session=Depends(require_learner_session),
):
    """Persist one spoken turn as text, screened, and advance the ladder.

    Only transcripts are kept — never audio. Both sides pass the same safety
    gate the typed coach uses, so a spoken channel cannot become a way around it.
    """
    learner_id = session["sub"]
    language = normalize_language(request.language)

    verdict = safety.screen_input(request.learnerText, language) if request.learnerText else None
    learner_text = verdict.text if verdict else ""
    coach_text = safety.screen_output(request.coachText, language).text if request.coachText else ""

    # Tier 2 runs only when tier 1 flagged, exactly as on the typed path — a
    # spoken channel must not be a way around the safety screen, and must not
    # cost an extra model call on every ordinary turn either.
    if verdict is not None and verdict.flagged:
        try:
            category = await safety.classify_disclosure(
                learner_text, language,
                usage_context=UsageContext(
                    actor_id=learner_id,
                    actor_type="learner",
                    endpoint="/api/agent/voice/turn",
                    feature=_FEATURE,
                    operation="safety.disclosure",
                    source="voice_turn_route",
                ),
            )
            if category in ("distress", "review"):
                await safety.record_wellbeing_flag(
                    learner_id, learner_text, language, source="voice_practice",
                )
        except Exception as exc:
            print(f"⚠️ voice safety screen degraded ({type(exc).__name__})")

    if learner_text and coach_text:
        # Half a turn is not a transcript. Dictation reports the learner's side
        # alone so the ladder still sees it, while the coach stream stores the
        # exchange itself — persisting here too would duplicate every line.
        try:
            from app.agents import sessions as agent_sessions

            await agent_sessions.append_turn(
                learner_id,
                "coach",
                learner_text,
                coach_text,
                session_id=agent_sessions.normalize_session_id(request.conversationId),
            )
        except Exception as exc:  # the transcript is a record, not the feature
            print(f"⚠️ voice transcript not stored ({type(exc).__name__})")

    ladder = await _fold_into_ladder(
        learner_id,
        accuracy=None,
        fluency=None,
        # A spoken turn counts towards how much English they are choosing to use;
        # only a SCORED attempt may move the accuracy average.
        spoke_english=_looks_english(learner_text),
        scored=False,
    )

    # Yuvi recasts out loud, but audio is gone the moment it is spoken. Showing
    # the same recast in writing is what lets a child actually see the shape of
    # the sentence they were reaching for. It never blocks the reply: if this is
    # slow or unavailable the conversation simply carries on without it.
    correction = None
    if learner_text:
        correction = await english_correction.suggest(
            learner_text,
            language,
            usage_context=UsageContext(
                actor_id=learner_id,
                actor_type="learner",
                endpoint="/api/agent/voice/turn",
                feature=_FEATURE,
                operation="english.correction",
                source="voice_turn_route",
            ),
        )

    return JSONResponse(content={"stage": ladder.get("stage"), "correction": correction})


def _looks_english(text: str) -> bool:
    """Did the learner answer in English rather than in their own language?

    Script, not vocabulary: Hebrew and Arabic have their own alphabets, so the
    presence of Latin letters and the absence of those scripts is a reliable and
    completely deterministic signal.
    """
    if not text:
        return False
    latin = sum(1 for ch in text if "a" <= ch.lower() <= "z")
    native = sum(1 for ch in text if "\u0590" <= ch <= "\u05ff" or "\u0600" <= ch <= "\u06ff")
    return latin >= 3 and latin > native
