"""Personalized post-lesson reflection (F4) — evidence-grounded, LRS-reported.

Triggered when a Kata component completes. The questions come from what really
happened: the session's wrong answers and misconception tags, the item's
`informationToBot` (documented common mistakes), and the brain
(`student_description`, activeness) — phrased per the 720 content-development
guidelines (metacognitive plan/monitor/evaluate scaffolds, effort-based
forward-feeding feedback, no numeric scores shown).

B-5: `system_estimate` is computed HERE, server-side, from the session's real
success rate — the client never supplies it. Each step emits its 720 statement
(reflection initialized / answered / skipped / completed).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from app.brain.repository import _get_collection_named, get_brain
from app.services.ai_usage import UsageContext
from app.services.events import get_session_events
from app.services.llm import call_llm
from app.services.lrs import reporter as lrs_reporter

_MEMORY_FLOWS: dict[str, dict[str, Any]] = {}   # fallback when Mongo is absent
_MAX_MEMORY_FLOWS = 200

_RATING_QUESTION = {
    "he": "איך הרגשת עם המשימה הזאת? דרג/י מ-1 (היה קשה מאוד) עד 5 (הלך מצוין)",
    "ar": "كيف شعرت مع هذه المهمة؟ قيّم من 1 (كانت صعبة جدًا) إلى 5 (سارت ممتازة)",
    "en": "How did this task feel? Rate from 1 (very hard) to 5 (went great)",
}
_FORWARD_QUESTION = {
    "he": "מה תעשה/י אותו דבר בפעם הבאה, ומה תנסה/י אחרת?",
    "ar": "ما الذي ستفعله بالطريقة نفسها في المرة القادمة، وما الذي ستجرّبه بشكل مختلف؟",
    "en": "What would you do the same next time, and what would you try differently?",
}
_OPEN_FALLBACK = {
    "he": "מה היה החלק שהכי אתגר אותך במשימה, ומה עזר לך להתקדם?",
    "ar": "ما الجزء الذي تحدّاك أكثر في المهمة، وما الذي ساعدك على التقدّم؟",
    "en": "Which part challenged you most, and what helped you move forward?",
}
_OPEN_MISCONCEPTION_FALLBACK = {
    "he": "היו כמה שאלות שבהן התשובה הראשונה לא הצליחה — מה לדעתך בלבל שם, ואיך הבנת בסוף?",
    "ar": "كانت هناك أسئلة لم تنجح فيها الإجابة الأولى — ما الذي كان مربكًا برأيك، وكيف فهمت في النهاية؟",
    "en": "On a few questions the first answer didn't work — what do you think was confusing, and how did you figure it out?",
}

_QUESTION_PROMPT = (
    "You write ONE short reflection question for a middle-school learner who just "
    "finished a learning component. Follow the 720 guidelines: metacognitive "
    "(plan/monitor/evaluate), effort-based, warm, never mention scores or grades, "
    "never shame, address the SPECIFIC difficulty in the evidence, invite the "
    "learner to explain their thinking. Write in the requested language, max 25 "
    "words, second person. Return JSON only: {\"question\": \"...\"}."
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _flows_collection():
    return _get_collection_named("reflection_flows")


async def _save_flow(flow: dict[str, Any]) -> None:
    collection = await _flows_collection()
    if collection is not None:
        try:
            await collection.replace_one({"_id": flow["_id"]}, flow, upsert=True)
            return
        except Exception as exc:
            print(f"⚠️ reflection flow write failed, memory fallback: {exc}")
    _MEMORY_FLOWS[flow["_id"]] = flow
    while len(_MEMORY_FLOWS) > _MAX_MEMORY_FLOWS:
        _MEMORY_FLOWS.pop(next(iter(_MEMORY_FLOWS)))


async def _load_flow(reflection_id: str, learner_id: str) -> Optional[dict[str, Any]]:
    collection = await _flows_collection()
    if collection is not None:
        try:
            flow = await collection.find_one({"_id": reflection_id})
            if flow and flow.get("learner_id") == learner_id:
                return flow
            if flow:
                return None
        except Exception as exc:
            print(f"⚠️ reflection flow read failed, memory fallback: {exc}")
    flow = _MEMORY_FLOWS.get(reflection_id)
    return flow if flow and flow.get("learner_id") == learner_id else None


def _session_evidence(events: list[dict[str, Any]]) -> dict[str, Any]:
    """Honest aggregates from one launch's events (rapid guesses excluded)."""
    scored = [
        e for e in events
        if e.get("verb") in {"answered", "attempted", "completed"}
        and (e.get("result") or {}).get("success") is not None
        and e.get("effortful") is not False
    ]
    successes = sum(1 for e in scored if (e.get("result") or {}).get("success"))
    wrong = [e for e in scored if not (e.get("result") or {}).get("success")]
    misconceptions = sorted({
        str(e.get("misconception")) for e in wrong if e.get("misconception")
    })
    retried_questions = sorted({
        str(e.get("question_id")) for e in wrong if e.get("question_id")
    })
    return {
        "scored_count": len(scored),
        "success_count": successes,
        "system_estimate": round(successes / len(scored), 3) if scored else None,
        "wrong_count": len(wrong),
        "misconceptions": misconceptions[:4],
        "retried_questions": retried_questions[:4],
    }


async def _personalized_open_question(
    learner_id: str,
    evidence: dict[str, Any],
    info_to_bot: str,
    description_text: str,
    language: str,
) -> str:
    """One mini-LLM call for the grounded middle question; template fallback."""
    fallback = (
        _OPEN_MISCONCEPTION_FALLBACK if evidence.get("wrong_count") else _OPEN_FALLBACK
    ).get(language) or _OPEN_FALLBACK["he"]
    payload = {
        "language": language,
        "evidence": {
            "wrong_answers": evidence.get("wrong_count"),
            "misconception_tags": evidence.get("misconceptions"),
            "retried_questions": evidence.get("retried_questions"),
        },
        "item_common_mistakes": (info_to_bot or "")[:500],
        "how_to_reach_this_learner": (description_text or "")[:400],
    }
    try:
        raw = await call_llm(
            [
                {"role": "system", "content": _QUESTION_PROMPT},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ],
            usage_context=UsageContext(
                actor_id=learner_id,
                actor_type="learner",
                endpoint="/api/agent/reflection/start",
                feature="feature_4_self_awareness",
                operation="reflection.personalized_question",
                source="reflection_agent",
            ),
            max_tokens=120,
            json_mode=True,
            model_tier="mini",
        )
        question = str((json.loads(raw or "{}") or {}).get("question") or "").strip()
        if 8 <= len(question) <= 220:
            from app.agents.safety import screen_output
            return screen_output(question, language).text or fallback
    except Exception as exc:
        print(f"⚠️ reflection question generation failed: {type(exc).__name__}")
    return fallback


async def start_reflection(
    learner_id: str,
    *,
    component_id: Optional[str],
    launch_session_id: Optional[str],
    moe_session_id: Optional[str],
    language: str,
) -> dict[str, Any]:
    """Build the personalized 3-question reflection; emits `initialized`."""
    lang = language if language in _RATING_QUESTION else "he"
    events = (
        await get_session_events(learner_id, launch_session_id)
        if launch_session_id else []
    )
    evidence = _session_evidence(events)

    info_to_bot = ""
    if component_id:
        try:
            from app.services.content_catalog import information_to_bot
            info_to_bot = information_to_bot(component_id) or ""
        except Exception:
            info_to_bot = ""
        if not info_to_bot:
            try:
                from app.services import content_provider
                _unit, component = await content_provider.resolve_component(component_id, None)
                info_to_bot = (component or {}).get("information_to_bot") or ""
            except Exception:
                info_to_bot = ""

    brain = await get_brain(learner_id)
    description_text = str(
        (brain.get("student_description") or {}).get("text") or ""
    )

    open_question = await _personalized_open_question(
        learner_id, evidence, info_to_bot, description_text, lang
    )
    questions = [
        {"number": 1, "kind": "rating", "text": _RATING_QUESTION[lang], "min": 1, "max": 5},
        {"number": 2, "kind": "open", "text": open_question},
        {"number": 3, "kind": "open", "text": _FORWARD_QUESTION[lang]},
    ]

    reflection_id = uuid4().hex
    flow = {
        "_id": reflection_id,
        "learner_id": learner_id,
        "component_id": component_id,
        "launch_session_id": launch_session_id,
        "moe_session_id": moe_session_id,
        "language": lang,
        "questions": questions,
        "answers": {},
        "skipped": [],
        "system_estimate": evidence.get("system_estimate"),
        "evidence": evidence,
        "status": "open",
        "started_at": _now().isoformat(),
    }
    await _save_flow(flow)

    if moe_session_id:
        await lrs_reporter.report_reflection_initialized(
            learner_id, moe_session_id, reflection_id, "end-of-learning-component"
        )
    return {
        "reflection_id": reflection_id,
        "questions": questions,
    }


async def answer_question(
    learner_id: str,
    reflection_id: str,
    question_number: int,
    *,
    answer: Optional[str] = None,
    rating: Optional[int] = None,
) -> Optional[dict[str, Any]]:
    """Record one answer; emits `answered` (response XOR score, per the PDF)."""
    flow = await _load_flow(reflection_id, learner_id)
    if flow is None or flow.get("status") != "open":
        return None
    question = next(
        (q for q in flow.get("questions") or [] if q.get("number") == question_number), None
    )
    if question is None:
        return None

    entry: dict[str, Any]
    if question.get("kind") == "rating":
        if not isinstance(rating, int) or not 1 <= rating <= 5:
            return None
        entry = {"rating": rating, "at": _now().isoformat()}
    else:
        text = str(answer or "").strip()[:800]
        if not text:
            return None
        from app.agents.safety import strip_pii
        text, _ = strip_pii(text)
        entry = {"answer": text, "at": _now().isoformat()}

    flow["answers"][str(question_number)] = entry
    await _save_flow(flow)

    if flow.get("moe_session_id"):
        await lrs_reporter.report_reflection_answered(
            learner_id,
            flow["moe_session_id"],
            reflection_id,
            question_number,
            response=entry.get("answer"),
            score_raw=float(entry["rating"]) if "rating" in entry else None,
            question_he=str(question.get("text") or "")[:200],
        )
    return {"ok": True}


async def skip_question(
    learner_id: str, reflection_id: str, question_number: int
) -> Optional[dict[str, Any]]:
    flow = await _load_flow(reflection_id, learner_id)
    if flow is None or flow.get("status") != "open":
        return None
    known = {q.get("number") for q in flow.get("questions") or []}
    if question_number not in known:
        return None   # never emit a `skipped` statement for a nonexistent question
    if question_number not in flow.get("skipped", []):
        flow.setdefault("skipped", []).append(question_number)
        await _save_flow(flow)
    if flow.get("moe_session_id"):
        await lrs_reporter.report_reflection_skipped(
            learner_id, flow["moe_session_id"], reflection_id, question_number
        )
    return {"ok": True}


async def complete_reflection(
    learner_id: str, reflection_id: str
) -> Optional[dict[str, Any]]:
    """Close the flow: store the reflection (self vs system estimate, B-5) and
    emit `completed` with the real duration."""
    flow = await _load_flow(reflection_id, learner_id)
    if flow is None:
        return None
    if flow.get("status") == "completed":
        return {"ok": True, "already": True}

    answers = flow.get("answers") or {}
    self_rating = next(
        (entry.get("rating") for entry in answers.values() if "rating" in entry), None
    )
    open_answers = " | ".join(
        entry["answer"] for key, entry in sorted(answers.items()) if entry.get("answer")
    )

    from app.agents import reflection as reflection_agent
    await reflection_agent.store_reflection(
        learner_id,
        prompt_id=f"lesson:{flow.get('component_id') or 'component'}",
        answer=open_answers,
        self_rating=self_rating,
        system_estimate=flow.get("system_estimate"),
    )

    flow["status"] = "completed"
    flow["completed_at"] = _now().isoformat()
    await _save_flow(flow)

    if flow.get("moe_session_id"):
        started = flow.get("started_at")
        try:
            duration = max(
                0.0,
                (_now() - datetime.fromisoformat(str(started))).total_seconds(),
            )
        except (TypeError, ValueError):
            duration = 0.0
        await lrs_reporter.report_reflection_completed(
            learner_id, flow["moe_session_id"], reflection_id, duration
        )
    return {"ok": True, "self_rating": self_rating, "system_estimate": flow.get("system_estimate")}
