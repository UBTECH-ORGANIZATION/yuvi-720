"""The daily feelings check-in (#452) — once per Israeli school day, optional
throughout, and honest about what it is: a conversation opener, not a survey.

On the first visit of a new school day the learner gets an optional
evidence-grounded callback about what was hard last session, a real-feelings
pick (five valence families → word chips), and an empowering closing line.
Real feelings, never a 1–5 scale; zero learning material; skips are data.

Day boundaries are the SCHOOL's (`school_calendar.today_school_date`), never
UTC and never rolling-24h. "Asked today" is the existence of the day's doc —
created by `start`, so abandoning the dialog is an implicit skip and there is
no re-nag. Server-side state only; no localStorage.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any, Optional

from app.brain.context_engine import apply_writes
from app.brain.repository import _get_collection_named
from app.services.ai_usage import UsageContext
from app.services.events import get_learner_events, get_session_events
from app.services.llm import call_llm
# Deliberate private import: the reflection flow's evidence reader is the ONE
# definition of "what really happened in a session" (rapid guesses excluded),
# and a second copy here would drift from it.
from app.services.reflection_flow import _session_evidence
from app.services.school_calendar import today_school_date

COLLECTION = "daily_checkins"

_MEMORY_CHECKINS: dict[str, dict[str, Any]] = {}
_MAX_MEMORY = 200


class CheckinError(Exception):
    """A refusal the route may surface. The message is a stable code."""


# ── the feelings vocabulary ──────────────────────────────────────────────────
# Canonical ids, server-validated; the frontend mirrors this table. Five
# valence families, five real feelings each — never a number.

VALENCE_FEELINGS: dict[str, tuple[str, ...]] = {
    "great":  ("proud", "excited", "valued", "joyful", "confident"),
    "good":   ("calm", "curious", "hopeful", "satisfied", "grateful"),
    "okay":   ("fine", "tired", "bored", "indifferent", "distracted"),
    "uneasy": ("worried", "anxious", "confused", "overwhelmed", "embarrassed"),
    "upset":  ("frustrated", "angry", "sad", "lonely", "discouraged"),
}

VALENCES = tuple(VALENCE_FEELINGS)

# Which families read as distress when the description engine folds history.
NEGATIVE_VALENCES = ("uneasy", "upset")
POSITIVE_VALENCES = ("great", "good")

_ANSWER_MAX_CHARS = 800

# ── closing lines: hand-written per valence, the always-there fallback ───────

_CLOSING_LINES: dict[str, dict[str, str]] = {
    "great": {
        "he": "איזה כיף לשמוע! ניקח את האנרגיה הזאת ליום למידה מעולה.",
        "ar": "ما أجمل هذا! سنأخذ هذه الطاقة إلى يوم تعلّم رائع.",
        "en": "Love to hear it! Let's take that energy into a great learning day.",
    },
    "good": {
        "he": "טוב לשמוע. יום טוב הוא נקודת פתיחה מצוינת ללמידה.",
        "ar": "جميل أن نسمع ذلك. اليوم الجيد بداية ممتازة للتعلّم.",
        "en": "Good to hear. A good day is a great starting point for learning.",
    },
    "okay": {
        "he": "תודה ששיתפת. גם יום ככה-ככה יכול להפתיע לטובה — צעד אחד בכל פעם.",
        "ar": "شكرًا على المشاركة. حتى اليوم العادي قد يفاجئنا للأفضل — خطوة خطوة.",
        "en": "Thanks for sharing. Even an okay day can surprise you — one step at a time.",
    },
    "uneasy": {
        "he": "תודה על הכנות. זה בסדר להרגיש ככה — נתקדם לאט, ויובי כאן לכל שאלה.",
        "ar": "شكرًا على صراحتك. لا بأس بهذا الشعور — سنتقدّم بهدوء، ويوبي هنا لأي سؤال.",
        "en": "Thanks for being honest. It's okay to feel this way — we'll go gently, and Yuvi is here.",
    },
    "upset": {
        "he": "תודה שסיפרת. ההרגשה הזאת חשובה, והיא לא חייבת ללוות את כל היום — נתחיל בקטן.",
        "ar": "شكرًا لأنك أخبرتنا. هذا الشعور مهم، ولا يجب أن يرافق اليوم كله — سنبدأ بخطوة صغيرة.",
        "en": "Thanks for telling me. That feeling matters, and it doesn't have to own the day — we'll start small.",
    },
}

_STEP0_FALLBACK = {
    "he": "בפעם הקודמת היו רגעים מאתגרים. איך זה מרגיש היום, במבט לאחור?",
    "ar": "في المرة الماضية كانت هناك لحظات صعبة. كيف يبدو ذلك اليوم عند النظر إلى الوراء؟",
    "en": "Last time had some challenging moments. Looking back, how does that feel today?",
}

_STEP0_PROMPT = (
    "You write ONE short, warm check-in question for a middle-school learner "
    "arriving at the start of a new day. It looks BACK at yesterday's session "
    "using the evidence given (wrong answers, misconception tags) — never "
    "mentioning scores, counts or grades — and asks how they feel about it "
    "now. Requested language, max 22 words, second person, no shame. "
    'Return JSON only: {"question": "..."}.'
)

_CLOSING_PROMPT = (
    "You write ONE short empowering closing line for a middle-school learner "
    "who just shared how they feel today. Acknowledge the feeling by its "
    "valence, never dismiss it, never mention learning material, scores or "
    "tasks. Requested language, max 20 words, second person. "
    'Return JSON only: {"line": "..."}.'
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _doc_id(learner_id: str, date_key: str) -> str:
    return f"checkin:{learner_id}:{date_key}"


async def _collection():
    return _get_collection_named(COLLECTION)


async def _save(doc: dict[str, Any]) -> None:
    collection = await _collection()
    if collection is not None:
        try:
            await collection.replace_one({"_id": doc["_id"]}, doc, upsert=True)
            return
        except Exception as exc:
            print(f"⚠️ checkin write failed, memory fallback: {exc}")
    _MEMORY_CHECKINS[doc["_id"]] = doc
    while len(_MEMORY_CHECKINS) > _MAX_MEMORY:
        _MEMORY_CHECKINS.pop(next(iter(_MEMORY_CHECKINS)))


async def _load(checkin_id: str, learner_id: str) -> Optional[dict[str, Any]]:
    """Ownership-checked load — a doc that is not yours does not exist."""
    collection = await _collection()
    if collection is not None:
        try:
            doc = await collection.find_one({"_id": checkin_id})
            if doc and doc.get("learner_id") == learner_id:
                return doc
            if doc:
                return None
        except Exception as exc:
            print(f"⚠️ checkin read failed, memory fallback: {exc}")
    doc = _MEMORY_CHECKINS.get(checkin_id)
    return doc if doc and doc.get("learner_id") == learner_id else None


async def _today_doc(learner_id: str) -> Optional[dict[str, Any]]:
    return await _load(_doc_id(learner_id, today_school_date()), learner_id)


async def is_due(learner_id: str) -> bool:
    """Whether today's check-in should open.

    The rule is the DOC's, not the login's: show until today's check-in is
    answered or skipped. No doc → due. A doc still `open` with no valence and
    no recorded skip (a crashed tab) → due again, resuming where it stood.
    A felt or skipped doc → quiet until the next Israeli day. Every dismissal
    path records a skip, so "asked and waved off" always leaves a mark —
    which is exactly what makes the once-per-day promise hold.

    `DAILY_CHECKIN_DISABLED=1` is the environment kill-switch (ops and
    harness bypass): the gate simply never opens.
    """
    import os

    if os.getenv("DAILY_CHECKIN_DISABLED", "").lower() in {"1", "true", "yes"}:
        return False
    doc = await _today_doc(learner_id)
    if doc is None:
        return True
    skipped = set(doc.get("skipped_steps") or [])
    return (
        doc.get("status") == "open"
        and doc.get("valence") is None
        and not ({"feeling", "all"} & skipped)
    )


# ── step-0 questions: the look-back, only when there is something to see ─────

async def _last_session_evidence(learner_id: str) -> dict[str, Any]:
    """The most recent launch's honest aggregates, or an empty dict."""
    try:
        events = await get_learner_events(learner_id, limit=120)
        session_id = next(
            (str(e.get("session_id")) for e in events if e.get("session_id")), None)
        if not session_id:
            return {}
        session_events = await get_session_events(learner_id, session_id)
        evidence = _session_evidence(session_events)
        return evidence if evidence.get("scored_count") else {}
    except Exception as exc:
        print(f"⚠️ checkin evidence read failed: {type(exc).__name__}")
        return {}


async def _step0_questions(
    learner_id: str, evidence: dict[str, Any], language: str,
) -> list[dict[str, Any]]:
    """0–2 look-back questions. Empty evidence ⇒ ZERO questions by design."""
    if not evidence or not evidence.get("wrong_count"):
        return []
    fallback = _STEP0_FALLBACK.get(language) or _STEP0_FALLBACK["he"]
    question = fallback
    try:
        # The dialog is standing between the child and their morning — a slow
        # model must not hold the door. Past the cap, the literal asks.
        raw = await asyncio.wait_for(call_llm(
            [
                {"role": "system", "content": _STEP0_PROMPT},
                {"role": "user", "content": json.dumps({
                    "language": language,
                    "evidence": {
                        "wrong_answers": evidence.get("wrong_count"),
                        "misconception_tags": evidence.get("misconceptions"),
                    },
                }, ensure_ascii=False)},
            ],
            usage_context=UsageContext(
                actor_id=learner_id,
                actor_type="learner",
                endpoint="/api/me/checkin/start",
                feature="feature_4_self_awareness",
                operation="checkin.step0_question",
                source="checkin_flow",
            ),
            max_tokens=120,
            json_mode=True,
            model_tier="mini",
        ), timeout=2.5)
        candidate = str((json.loads(raw or "{}") or {}).get("question") or "").strip()
        if 8 <= len(candidate) <= 200:
            from app.agents.safety import screen_output
            question = screen_output(candidate, language).text or fallback
    except Exception as exc:
        print(f"⚠️ checkin step0 generation failed: {type(exc).__name__}")
    return [{"id": "q0", "text": question}]


async def _closing_line(
    learner_id: str, valence: str, feeling: str, language: str,
) -> str:
    fallback = (_CLOSING_LINES.get(valence) or _CLOSING_LINES["okay"])
    line = fallback.get(language) or fallback["he"]
    try:
        raw = await asyncio.wait_for(call_llm(
            [
                {"role": "system", "content": _CLOSING_PROMPT},
                {"role": "user", "content": json.dumps({
                    "language": language, "valence": valence, "feeling": feeling,
                }, ensure_ascii=False)},
            ],
            usage_context=UsageContext(
                actor_id=learner_id,
                actor_type="learner",
                endpoint="/api/me/checkin/feeling",
                feature="feature_4_self_awareness",
                operation="checkin.closing_line",
                source="checkin_flow",
            ),
            max_tokens=90,
            json_mode=True,
            model_tier="mini",
        ), timeout=4.0)
        candidate = str((json.loads(raw or "{}") or {}).get("line") or "").strip()
        if 6 <= len(candidate) <= 180:
            from app.agents.safety import screen_output
            return screen_output(candidate, language).text or line
    except Exception as exc:
        print(f"⚠️ checkin closing generation failed: {type(exc).__name__}")
    return line


# ── the flow ─────────────────────────────────────────────────────────────────

async def start(learner_id: str, language: str) -> dict[str, Any]:
    """Create (or return) today's check-in. Idempotent on (learner, day).

    Creation IS the "asked today" flag: once the doc exists the dialog never
    re-opens, so bailing out mid-way is an implicit skip, not a re-nag.
    """
    date_key = today_school_date()
    existing = await _today_doc(learner_id)
    if existing is not None:
        return existing
    evidence = await _last_session_evidence(learner_id)
    doc = {
        "_id": _doc_id(learner_id, date_key),
        "learner_id": learner_id,
        "date_key": date_key,
        "status": "open",
        "questions": await _step0_questions(learner_id, evidence, language),
        "step0_answers": [],
        "valence": None,
        "feeling": None,
        "skipped_steps": [],
        "closing_line": None,
        "reflection_stored": False,
        "created_at": _now_iso(),
        "completed_at": None,
    }
    # Atomic insert-if-absent: two tabs racing on the same morning must end
    # with one doc. The deterministic _id is the lock.
    collection = await _collection()
    if collection is not None:
        try:
            await collection.insert_one(doc)
            return doc
        except Exception:
            held = await _today_doc(learner_id)
            if held is not None:
                return held
    await _save(doc)
    return doc


async def record_answer(
    checkin_id: str, learner_id: str, question_id: str, answer: str,
) -> dict[str, Any]:
    doc = await _load(checkin_id, learner_id)
    if doc is None:
        raise CheckinError("checkin_not_found")
    if not any(question.get("id") == question_id for question in doc.get("questions") or []):
        raise CheckinError("unknown_question")
    from app.agents.safety import strip_pii
    text, _ = strip_pii(str(answer or ""))
    text = text.strip()[:_ANSWER_MAX_CHARS]
    answers = [a for a in doc.get("step0_answers") or [] if a.get("id") != question_id]
    answers.append({"id": question_id, "text": text, "at": _now_iso()})
    doc["step0_answers"] = answers
    await _save(doc)
    return doc


async def _store_checkin_reflection(doc: dict[str, Any]) -> None:
    """One reflection entry per day, whatever way the dialog ended."""
    if doc.get("reflection_stored"):
        return
    from app.agents.reflection import store_reflection
    skipped = doc.get("valence") is None
    answer = doc.get("feeling") or ("skipped" if skipped else "")
    try:
        await store_reflection(
            doc["learner_id"],
            f"daily_checkin:{doc['date_key']}",
            answer,
            meta={
                "valence": doc.get("valence"),
                "feeling": doc.get("feeling"),
                "skipped": skipped,
                "step0_answered": bool(doc.get("step0_answers")),
            },
        )
        doc["reflection_stored"] = True
    except Exception as exc:
        print(f"⚠️ checkin reflection store failed: {exc}")


async def record_feeling(
    checkin_id: str, learner_id: str, valence: str, feeling: str, language: str,
) -> dict[str, Any]:
    """The heart of the flow: validate, write the brain, answer with warmth.

    Performs the durable writes HERE — a learner who closes the tab before the
    closing screen still counts, because the feeling is already saved.
    """
    doc = await _load(checkin_id, learner_id)
    if doc is None:
        raise CheckinError("checkin_not_found")
    allowed = VALENCE_FEELINGS.get(valence)
    if not allowed or feeling not in allowed:
        raise CheckinError("unknown_feeling")

    doc["valence"] = valence
    doc["feeling"] = feeling
    doc["status"] = "felt"
    # The brain carries today's feeling whole (an opaque leaf); readers drop
    # it once the school day turns — expiry is read-side, no cron.
    await apply_writes("checkin", learner_id, {
        "current_state": {"daily_feeling": {
            "valence": valence,
            "feeling": feeling,
            "date": doc["date_key"],
            "at": _now_iso(),
        }},
    })
    await _store_checkin_reflection(doc)
    doc["closing_line"] = await _closing_line(learner_id, valence, feeling, language)
    await _save(doc)
    return doc


async def record_skip(
    checkin_id: str, learner_id: str, steps: list[str],
) -> dict[str, Any]:
    """Steps waved off — data, not absence. A skip of the feeling step (or a
    dismissal) closes the day's check-in as skipped."""
    doc = await _load(checkin_id, learner_id)
    if doc is None:
        raise CheckinError("checkin_not_found")
    held = list(doc.get("skipped_steps") or [])
    for step in steps:
        step_name = str(step)[:40]
        if step_name and step_name not in held:
            held.append(step_name)
    doc["skipped_steps"] = held
    if doc.get("valence") is None and ("feeling" in held or "all" in held):
        doc["status"] = "skipped"
        doc["completed_at"] = _now_iso()
        await _store_checkin_reflection(doc)
    await _save(doc)
    return doc


async def complete(checkin_id: str, learner_id: str) -> dict[str, Any]:
    doc = await _load(checkin_id, learner_id)
    if doc is None:
        raise CheckinError("checkin_not_found")
    doc["status"] = "completed" if doc.get("valence") else doc.get("status") or "open"
    doc["completed_at"] = _now_iso()
    await _store_checkin_reflection(doc)
    await _save(doc)
    return doc


def _note_of(doc: dict[str, Any]) -> Optional[dict[str, Any]]:
    """The day's written words, if any, with the question they answered.

    First non-empty answer wins — the dialog asks one opening question, and a
    note without its question would read as a bare quote out of context.
    """
    for answer in doc.get("step0_answers") or []:
        text = str(answer.get("text") or "").strip()
        if not text:
            continue
        question = next(
            (str(q.get("text") or "") for q in doc.get("questions") or []
             if q.get("id") == answer.get("id")),
            None,
        )
        return {"question": question, "text": text}
    return None


async def history(
    learner_id: str, limit: int = 14, *, with_text: bool = False,
) -> list[dict[str, Any]]:
    """The last days' check-ins, newest first — the teacher-profile strip.

    Rows are day-shaped facts (date, valence, feeling, skipped). With
    `with_text` each row also carries `note` — the child's written words with
    the question they answered (#505), PII-stripped at write time. Off by
    default on purpose: only the class-mood click-through asks for the words,
    and every other reader keeps them in the learner's own lane.
    """
    rows: list[dict[str, Any]] = []
    collection = await _collection()
    if collection is not None:
        try:
            cursor = (collection.find({"learner_id": learner_id})
                      .sort("date_key", -1).limit(limit))
            rows = [doc async for doc in cursor]
        except Exception as exc:
            print(f"⚠️ checkin history read failed: {exc}")
    if not rows:
        rows = sorted(
            (doc for doc in _MEMORY_CHECKINS.values()
             if doc.get("learner_id") == learner_id),
            key=lambda doc: doc.get("date_key") or "", reverse=True,
        )[:limit]
    return [
        {
            "date": doc.get("date_key"),
            "valence": doc.get("valence"),
            "feeling": doc.get("feeling"),
            "skipped": doc.get("valence") is None,
            **({"note": _note_of(doc)} if with_text else {}),
        }
        for doc in rows
    ]


def public_view(doc: dict[str, Any]) -> dict[str, Any]:
    """What the client renders — the doc minus internals."""
    return {
        "checkin_id": doc["_id"],
        "date_key": doc["date_key"],
        "status": doc["status"],
        "questions": doc.get("questions") or [],
        "valence": doc.get("valence"),
        "feeling": doc.get("feeling"),
        "closing_line": doc.get("closing_line"),
    }


def reset_for_tests() -> None:
    _MEMORY_CHECKINS.clear()
