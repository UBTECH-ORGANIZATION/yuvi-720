"""The Yuvilab lomda player — our own content, served as a standalone document.

This is the runtime for everything we author ourselves (English). It is
deliberately the ONLY surface in the product that authenticates from a launch
token instead of the session cookie, because that is what makes it embeddable:
a 720 platform can drop ``/content/player/{component}?slxapi=…`` into an iframe
with no Yuvilab session at all, and the page renders content and nothing else —
no dashboard, no navigation, no app chrome (נספח 1 §5).

Three endpoints:
  * ``GET  /content/player/{component_id}``          — the shell (carries no content)
  * ``GET  /content/player/{component_id}/payload``  — what to render, keys stripped
  * ``POST /content/player/{component_id}/answer``   — grade one answer server-side

Answer keys never reach the browser. Progress reporting is xAPI, exactly as for
an external provider: the page posts to the ``slxapi`` endpoint it was launched
with, which is our own ingest.
"""

from __future__ import annotations

import os
import re
import unicodedata
from typing import Any, Optional

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from app.core.paths import ENGLISH_PLAYER_DIR
from app.services import kata_client, native_content
from app.services.events import verify_launch

router = APIRouter(prefix="/content/player", tags=["content"])

_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,159}$")
_DEFAULT_FRAME_ANCESTORS = "'self'"


def _frame_ancestors() -> str:
    """Who may frame the player. Only this route relaxes framing."""
    configured = (os.environ.get("CONTENT_FRAME_ANCESTORS") or "").strip()
    return f"{_DEFAULT_FRAME_ANCESTORS} {configured}".strip() if configured else _DEFAULT_FRAME_ANCESTORS


def _embeddable(response):
    response.headers["Content-Security-Policy"] = f"frame-ancestors {_frame_ancestors()}"
    # A legacy deny header would out-rank the CSP in older browsers.
    if "x-frame-options" in response.headers:
        del response.headers["x-frame-options"]
    return response


def _launch_for(request: Request, component_id: str) -> Optional[dict[str, Any]]:
    """The launch this request is authorized by, or None.

    Scope is checked as well as signature: a valid token for ANOTHER component
    must not open this one.
    """
    header = request.headers.get("authorization") or ""
    if not header.startswith("Basic "):
        return None
    payload = verify_launch(header[len("Basic "):].strip())
    if payload is None or payload.get("cmp") != component_id:
        return None
    return payload


def _unauthorized() -> JSONResponse:
    return JSONResponse(content={"error": "invalid_or_expired_launch"}, status_code=401)


def _public_media(media: Any) -> Optional[dict[str, Any]]:
    """One image, as the browser may see it.

    Everything here is needed to paint the picture without shifting the layout
    under a finger — except ``prompt``, the text the image was generated from,
    which is an authoring note and is dropped.
    """
    if not isinstance(media, dict) or not media.get("src"):
        return None
    public = {
        "src": str(media["src"]),
        "alt": media.get("alt") or {},
        "width": media.get("width"),
        "height": media.get("height"),
    }
    for optional in ("srcset", "sizes"):
        if media.get(optional):
            public[optional] = str(media[optional])
    return public


def _public_prompt(prompt: Any) -> Optional[dict[str, Any]]:
    """One left-hand side of a matching question. Carries no pairing."""
    if not isinstance(prompt, dict) or not prompt.get("id"):
        return None
    public: dict[str, Any] = {"id": str(prompt["id"])}
    if prompt.get("text"):
        public["text"] = str(prompt["text"])
    media = _public_media(prompt.get("media"))
    if media:
        public["media"] = media
    return public


def _public_question(question: dict[str, Any]) -> dict[str, Any]:
    """A question as the learner may see it — no key, no per-answer feedback.

    This is a whitelist and must stay one: ``correctAnswers`` sits beside these
    fields in the authored document, and the only thing keeping it out of the
    browser is that nothing here copies it.
    """
    public = {
        "questionId": str(question.get("questionId") or ""),
        "questionType": str(question.get("questionType") or ""),
        "questionText": question.get("questionText") or "",
        "answers": list(question.get("answers") or []),
    }
    image = _public_media(question.get("image"))
    if image:
        public["image"] = image
    # Picture options, keyed by the answer they illustrate — so shuffling the
    # options can never separate a word from its picture.
    answer_media = {
        str(answer): media
        for answer, raw in (question.get("answerMedia") or {}).items()
        if (media := _public_media(raw))
    }
    if answer_media:
        public["answerMedia"] = answer_media
    prompts = [p for raw in question.get("prompts") or [] if (p := _public_prompt(raw))]
    if prompts:
        public["prompts"] = prompts
    return public


def _public_presentation(presentation: Any) -> dict[str, Any]:
    """The screen body, with any authoring-only image note removed."""
    if not isinstance(presentation, dict):
        return {}
    public = dict(presentation)
    if "image" in public:
        image = _public_media(public["image"])
        if image:
            public["image"] = image
        else:
            public.pop("image")
    return public


def _public_item(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id"),
        "title": item.get("title"),
        "contentType": item.get("contentType"),
        "mediaFormat": item.get("mediaFormat"),
        "presentation": _public_presentation(item.get("presentation")),
        "questions": [_public_question(q) for q in item.get("questions") or []],
    }


async def _previous_answers(
    learner_id: str, unit_id: Optional[str], component_id: str, component: dict[str, Any]
) -> list[dict[str, Any]]:
    """This learner's graded answers for the CURRENT run of this component.

    The player keeps its answered state in memory, so a reload used to forget
    every verdict: revisited questions rendered blank, "continue" locked again,
    and the finish verdict was computed from a nearly-empty map. The stored
    `answered` statements are the durable record, so the payload rebuilds the
    state from them — the same way the Kata player resumes on its own platform.

    A run ends at `completed`: everything after the last completion belongs to
    the current sitting, so a mid-lesson reload restores in full while a redo
    of a finished component starts clean. Each response is re-graded with the
    same `_grade` the live path uses — nothing is stored or sent that the
    learner has not already been shown.
    """
    if not unit_id:
        return []
    try:
        from app.services.events import get_unit_events

        events = [
            event for event in await get_unit_events(learner_id, unit_id)
            if event.get("launch") == component_id
        ]
    except Exception as exc:  # a restore failure must never block the lesson
        print(f"⚠️ answer restore skipped: {type(exc).__name__}")
        return []
    last_done = max(
        (n for n, event in enumerate(events) if event.get("verb") == "completed"),
        default=-1,
    )
    questions = {
        (item.get("id"), question.get("questionId")): question
        for item in component.get("subContent") or []
        for question in item.get("questions") or []
    }
    entries: dict[tuple[str, str], dict[str, Any]] = {}
    for event in events[last_done + 1:]:
        if event.get("verb") != "answered":
            continue
        item_id, question_id = event.get("sub_item_id"), event.get("question_id")
        question = questions.get((item_id, question_id))
        response = (event.get("result") or {}).get("response")
        if not question or response is None:
            continue  # e.g. a speaking self-recording — nothing to rebuild
        correct, detail = _grade(question, str(response))
        if correct is None:
            continue
        entry = entries.setdefault((item_id, question_id), {
            "itemId": item_id,
            "questionId": question_id,
            "attempts": 0,
            # What they knew unaided — the first attempt, kept across retries.
            "firstCorrect": bool(correct),
        })
        entry["attempts"] += 1
        entry["correct"] = bool(correct)
        entry["response"] = str(response)
        entry["detail"] = detail or None
        entry["feedback"] = (question.get("feedback") or {}).get(
            "correct" if correct else "incorrect"
        ) or {}
    return list(entries.values())


async def _resume_item(learner_id: str, component_id: str) -> Optional[str]:
    """Where this learner stopped inside THIS component (720 §1.7).

    Position is written by the player's own xAPI, so a mid-task close and a
    reopen land on the same screen without any extra bookkeeping.
    """
    try:
        from app.brain.repository import get_brain

        state = (await get_brain(learner_id)).get("current_state") or {}
    except Exception as exc:  # a resume failure must never block the lesson
        print(f"⚠️ resume lookup skipped: {type(exc).__name__}")
        return None
    if state.get("component_id") != component_id:
        return None
    item_id = state.get("item_id")
    return str(item_id) if item_id else None


@router.get("/{component_id}")
async def player_shell(component_id: str):
    """The player document. Holds no content — the payload call does."""
    index = ENGLISH_PLAYER_DIR / "index.html"
    if not _ID_PATTERN.fullmatch(component_id or ""):
        return JSONResponse(content={"error": "invalid_component_id"}, status_code=422)
    if not index.exists():
        return JSONResponse(content={"error": "player_not_built"}, status_code=503)
    return _embeddable(FileResponse(index, media_type="text/html"))


@router.get("/{component_id}/payload")
async def player_payload(component_id: str, request: Request, lang: str = "he"):
    launch = _launch_for(request, component_id)
    if launch is None:
        return _unauthorized()
    resolved = await native_content.get_raw_component(component_id, launch.get("unit"))
    if not resolved:
        return JSONResponse(content={"error": "content_not_found"}, status_code=404)
    unit, component = resolved

    from app.core.localization import normalize_language

    return _embeddable(JSONResponse(content={
        "language": normalize_language(lang),
        "unit": {
            "id": unit.get("id"),
            "title": unit.get("title"),
            # The authored doc keys translations by Kata's language LABELS
            # ("Hebrew"), while the player asks by locale code ("he") — map
            # them here or a Hebrew learner reads the English working title.
            "titles": kata_client.title_translations(unit),
            "objectiveId": unit.get("learningObjective"),
        },
        "component": {
            "id": component.get("id"),
            "title": component.get("title"),
            "purpose": component.get("componentPurpose"),
            "isAssessment": bool(component.get("isAssessment")),
            "estimatedMinutes": component.get("estimatedTimeInMinutes"),
        },
        "items": [_public_item(item) for item in component.get("subContent") or []],
        "resume": {"itemId": await _resume_item(launch["lid"], component_id)},
        "previous": await _previous_answers(
            launch["lid"], launch.get("unit"), component_id, component
        ),
    }))


@router.post("/{component_id}/speech-token")
async def player_speech_token(component_id: str, request: Request):
    """A short-lived Speech token for a speaking item inside the lomda.

    The player has no session cookie by design, so it authenticates with the
    same launch token it renders from. The microphone stays in the page: audio
    goes to Azure directly and only the score sheet returns.
    """
    if _launch_for(request, component_id) is None:
        return _unauthorized()
    from app.services.speech import SpeechUnavailable, issue_token

    try:
        token = await issue_token()
    except SpeechUnavailable as exc:
        print(f"⚠️ player speech token unavailable: {exc}")
        return JSONResponse(content={"error": "speech_unavailable"}, status_code=503)
    return _embeddable(JSONResponse(content=token, headers={"Cache-Control": "no-store"}))


@router.post("/{component_id}/pronunciation")
async def player_pronunciation(component_id: str, request: Request):
    launch = _launch_for(request, component_id)
    if launch is None:
        return _unauthorized()
    from app.routes.speech import PronunciationRequest, assess_and_record

    try:
        payload = PronunciationRequest(**(await request.json()))
    except Exception:
        return JSONResponse(content={"error": "invalid_request"}, status_code=422)
    payload.componentId = component_id
    result = await assess_and_record(
        launch["lid"], payload,
        endpoint="/content/player/pronunciation",
        session_id=launch.get("sid"),
    )
    return _embeddable(JSONResponse(content=result))


class AnswerRequest(BaseModel):
    itemId: str = Field(max_length=180)
    questionId: str = Field(max_length=80)
    response: str = Field(default="", max_length=2000)


class WritingFeedbackRequest(BaseModel):
    itemId: str = Field(max_length=180)
    text: str = Field(default="", max_length=2000)
    lang: str = Field(default="he", max_length=5)


@router.post("/{component_id}/writing-feedback")
async def player_writing_feedback(
    component_id: str, data: WritingFeedbackRequest, request: Request,
):
    """Formative feedback on a free-written text — words only, never a score.

    Writing is the one productive skill the player could previously only ask the
    learner to self-check. What the text verifiably contains is decided here;
    the model only phrases it (see ``services.writing_feedback``).
    """
    launch = _launch_for(request, component_id)
    if launch is None:
        return _unauthorized()
    resolved = await native_content.get_raw_component(component_id, launch.get("unit"))
    if not resolved:
        return JSONResponse(content={"error": "content_not_found"}, status_code=404)
    _unit, component = resolved

    item = next(
        (i for i in component.get("subContent") or [] if str(i.get("id")) == data.itemId),
        None,
    )
    presentation = (item or {}).get("presentation") or {}
    if presentation.get("kind") != "writing":
        return JSONResponse(content={"error": "item_not_writable"}, status_code=404)

    lang = data.lang if data.lang in ("he", "ar", "en") else "he"
    prompt = presentation.get("prompt") or {}
    from app.services.writing_feedback import review

    result = await review(
        text=data.text,
        task=str(prompt.get("en") or prompt.get(lang) or ""),
        checklist=presentation.get("checklist") or [],
        language=lang,
        cefr_level=str(component.get("cefrLevel") or "A1"),
        learner_id=launch["lid"],
        component_id=component_id,
        session_id=launch.get("sid"),
    )
    return _embeddable(JSONResponse(content=result))


def _normalize(text: str) -> str:
    return " ".join(str(text or "").strip().casefold().split())


#: Curly quotes a phone keyboard substitutes silently. A learner who types the
#: right word must not be marked wrong because iOS chose U+2019 for them.
_STRAIGHTEN = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"'})

#: Sentence-final punctuation. Whether a learner closed a one-word answer with a
#: full stop says nothing about whether they know the word.
_TERMINAL = ".,!?;:…"


def _normalize_typed(text: str) -> str:
    """What a TYPED answer means, once spelling noise is taken out.

    Free text is graded only where the authored key lists every acceptable
    spelling, so this deliberately forgives presentation and nothing else: case,
    spacing, quote shape, stray accents and a trailing full stop. It does not
    forgive a different word, a missing word or a misspelling — those are the
    thing being assessed, and the feedback for them is already written.
    """
    value = unicodedata.normalize("NFKD", str(text or "")).translate(_STRAIGHTEN)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    return _normalize(value).strip(_TERMINAL).strip()


def _pairs(value: str) -> dict[str, str]:
    """``p1=mother|p2=father`` → ``{"p1": "mother", …}``.

    Matching is graded as a set of pairs, never as a string, so the order the
    learner happened to build them in cannot make a right answer wrong.
    """
    pairs: dict[str, str] = {}
    for chunk in str(value or "").split("|"):
        prompt_id, separator, answer = chunk.partition("=")
        prompt_id = prompt_id.strip()
        if separator and prompt_id:
            pairs[prompt_id] = _normalize(answer)
    return pairs


def _grade(question: dict[str, Any], response: str) -> tuple[Optional[bool], dict[str, bool]]:
    """Grade one response against the authored key.

    Returns the verdict and, for matching, which individual pairs were right —
    enough for the player to mark the two rows that need another look instead of
    resetting the whole board, and never enough to derive the key.
    """
    keys = [str(k) for k in question.get("correctAnswers") or []]
    if not keys:
        return None, {}

    question_type = str(question.get("questionType") or "")
    if question_type == "match":
        expected = _pairs("|".join(keys))
        given = _pairs(response)
        detail = {pid: given.get(pid) == answer for pid, answer in expected.items()}
        return bool(detail) and all(detail.values()) and set(given) == set(expected), detail
    if question_type == "text-entry":
        return _normalize_typed(response) in {_normalize_typed(k) for k in keys}, {}
    return _normalize(response) in {_normalize(k) for k in keys}, {}


@router.post("/{component_id}/answer")
async def player_answer(component_id: str, data: AnswerRequest, request: Request):
    """Grade one answer. The key stays on the server; the learner gets words."""
    launch = _launch_for(request, component_id)
    if launch is None:
        return _unauthorized()
    resolved = await native_content.get_raw_component(component_id, launch.get("unit"))
    if not resolved:
        return JSONResponse(content={"error": "content_not_found"}, status_code=404)
    _unit, component = resolved

    question = next(
        (
            q
            for item in component.get("subContent") or []
            if str(item.get("id")) == data.itemId
            for q in item.get("questions") or []
            if str(q.get("questionId")) == data.questionId
        ),
        None,
    )
    if question is None:
        return JSONResponse(content={"error": "question_not_found"}, status_code=404)

    correct, detail = _grade(question, data.response)
    feedback = question.get("feedback") or {}
    body: dict[str, Any] = {
        "correct": correct,
        # 720 §feedback: effort-based, action-specific, and it explains the
        # error — never a score, and never the answer itself.
        "feedback": feedback.get("correct" if correct else "incorrect") or {},
    }
    if detail:
        # Which pairs held up, so a learner who got three of four right is asked
        # to revisit one row rather than start the board again. Says nothing
        # about what the right pairing would have been.
        body["detail"] = detail
    return _embeddable(JSONResponse(content=body))
