"""Run the real coach on real screens, in a sandbox, and check what it did.

One turn = one ``coach.run_coach_stream`` call, exactly as a route makes it:
the production context bundle (``build_coach_bundle``) over a SYNTHETIC brain
and synthetic learner events, the live Kata catalog (read-only), the
committed content shards, and the real model through the APIM lane. What is
not real is everything that would write: persistence, memory, analytics,
teacher alerts, usage rows — each is replaced in-process, so an eval run
leaves no trace in any learner record, LRS or database. ``sandbox_env()``
must be applied BEFORE any ``app`` import (scripts/coach_eval.py does).

Per turn it records the streamed text, the focus mark committed before the
first word, the planning/lean/tag diagnostics, the model calls with their
tokens (llm.py's observer hook) and the latencies — and runs the checks in
``check_turn``. Nothing a public artifact must not carry is written unless
``--include-text`` is passed (replies are the coach's own words, but the
checks' evidence names correct answers, which stay in memory).
"""

from __future__ import annotations

import asyncio
import contextlib
import contextvars
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from unittest import mock
from uuid import uuid4

HERE = Path(__file__).resolve().parent

#: Live services the eval must never reach, blanked before .env can set them.
_BLANK = ("MONGODB_CONNECTION_STRING", "REDIS_CONNECTION_STRING",
          "GAME_JOBS_SERVICEBUS_CONNECTION_STRING", "GAME_JOBS_SERVICEBUS_NAMESPACE")


def sandbox_env() -> None:
    for key in _BLANK:
        os.environ[key] = ""
    os.environ["SPARK_STORAGE"] = "json"
    os.environ["SPARK_ENVIRONMENT"] = "test"
    os.environ["SPARK_CACHE"] = "off"
    os.environ["LRS_ENABLED"] = "false"


#: Flag sets under comparison. `baseline` is today's production behavior.
VARIANTS: dict[str, dict[str, str]] = {
    "baseline": {
        "COACH_TOOL_CALLING_ENABLED": "on", "COACH_FOCUS_MARKS_ENABLED": "off",
        "COACH_LESSON_PLANNING": "full", "COACH_FOCUS_TAG_ENABLED": "off",
        "COACH_LEAN_NUDGES": "off", "COACH_SHARED_TEXTS": "off", "COACH_MISCONCEPTION_CATALOG": "off",
    },
    # A second baseline: the judge's noise floor (same flags, fresh samples).
    "baseline_b": {
        "COACH_TOOL_CALLING_ENABLED": "on", "COACH_FOCUS_MARKS_ENABLED": "off",
        "COACH_LESSON_PLANNING": "full", "COACH_FOCUS_TAG_ENABLED": "off",
        "COACH_LEAN_NUDGES": "off", "COACH_SHARED_TEXTS": "off", "COACH_MISCONCEPTION_CATALOG": "off",
    },
    # Exactly what ships on by default: marks on, planning gated, the rest off.
    "defaults": {
        "COACH_TOOL_CALLING_ENABLED": "on", "COACH_FOCUS_MARKS_ENABLED": "on",
        "COACH_LESSON_PLANNING": "gated", "COACH_FOCUS_TAG_ENABLED": "off",
        "COACH_LEAN_NUDGES": "off", "COACH_SHARED_TEXTS": "off", "COACH_MISCONCEPTION_CATALOG": "off",
    },
    "candidate": {
        "COACH_TOOL_CALLING_ENABLED": "on", "COACH_FOCUS_MARKS_ENABLED": "on",
        "COACH_LESSON_PLANNING": "gated", "COACH_FOCUS_TAG_ENABLED": "off",
        "COACH_LEAN_NUDGES": "on", "COACH_SHARED_TEXTS": "on", "COACH_MISCONCEPTION_CATALOG": "on",
    },
    "candidate_tag": {
        "COACH_TOOL_CALLING_ENABLED": "on", "COACH_FOCUS_MARKS_ENABLED": "on",
        "COACH_LESSON_PLANNING": "gated", "COACH_FOCUS_TAG_ENABLED": "on",
        "COACH_LEAN_NUDGES": "on", "COACH_SHARED_TEXTS": "on", "COACH_MISCONCEPTION_CATALOG": "on",
    },
}

#: Synthetic learners — never a real account.
PERSONAS: dict[str, dict[str, Any]] = {
    "he_f": {"lang": "he", "gender": "female", "interests": ["כדורגל", "ציור"]},
    "he_m": {"lang": "he", "gender": "male", "interests": ["מיינקראפט"]},
    "he_x": {"lang": "he", "gender": None, "interests": []},
    "ar": {"lang": "ar", "gender": "female", "interests": ["الرسم"]},
    "en": {"lang": "en", "gender": "male", "interests": ["space"]},
}
GREETING = {"he": "היי!", "ar": "مرحبا!", "en": "Hi!"}

_TURN: contextvars.ContextVar[dict[str, Any]] = contextvars.ContextVar("eval_turn")


def load_fixtures() -> tuple[list[dict], list[dict]]:
    screens = json.loads((HERE / "screens.json").read_text(encoding="utf-8"))["screens"]
    scenarios = json.loads((HERE / "scenarios.json").read_text(encoding="utf-8"))["scenarios"]
    return screens, scenarios


# ── the screen, from the live catalog ────────────────────────────────────────

async def screen_facts(screen: dict[str, Any]) -> dict[str, Any]:
    from app.services import kata_catalog

    await kata_catalog.ensure_loaded()
    questions = kata_catalog.questions_for_item(screen["component_id"], screen["item_id"]) or []
    first = questions[0] if questions else {}
    component = kata_catalog.get_component(screen["component_id"]) or {}
    return {
        "question_id": str(first.get("questionId") or ""),
        "options": [str(a) for a in first.get("answers") or [] if a],
        "correct": [str(a) for a in first.get("correctAnswers") or [] if a],
        "objective_id": component.get("objective_id") or component.get("objectiveId"),
        "unit_id": component.get("unit_id") or component.get("unitId"),
    }


def _brain(screen: dict, facts: dict, persona: dict) -> dict[str, Any]:
    return {
        "current_state": {
            "component_id": screen["component_id"], "item_id": screen["item_id"],
            "question_id": facts["question_id"] or None, "unit_id": facts.get("unit_id"),
            "at": datetime.now(timezone.utc).isoformat(),
        },
        "profile": {"interests": persona["interests"]},
        "goals": [],
        "locale": persona["lang"],
    }


def _events(evidence: Optional[str], screen: dict, facts: dict) -> list[dict[str, Any]]:
    if not evidence or not facts["options"]:
        return []
    wrong = next((o for o in facts["options"] if o not in facts["correct"]), None)
    response = facts["correct"][0] if evidence == "solved" and facts["correct"] else wrong
    if response is None:
        return []
    return [{
        "verb": "answered", "launch": screen["component_id"], "sub_item_id": screen["item_id"],
        "question_id": facts["question_id"], "object_id": screen["item_id"],
        "result": {"success": evidence == "solved", "response": response},
        "occurred_at": datetime.now(timezone.utc).isoformat(),
    }]


# ── the sandbox ──────────────────────────────────────────────────────────────

@contextlib.contextmanager
def sandbox():
    """Every writer the coach path touches, replaced in-process; the synthetic
    brain/events come from the running turn (a ContextVar, so turns can run
    concurrently)."""
    from app.agents import coach, coach_calendar, sessions, tutor_decision
    from app.brain import context_engine
    from app.services import ai_usage, coach_handoff, content_intelligence, events, question_quality

    async def view_for(_role, _learner_id, *a, **k):
        return json.loads(json.dumps(_TURN.get()["brain"]))

    async def recent_events(*a, **k):
        return list(_TURN.get()["events"])

    async def address_form(_lid):
        return _TURN.get()["persona"]["gender"]

    async def greeting(_lid, lang):
        return GREETING.get(lang, GREETING["he"])

    async def get_recent(*a, **k):
        return list(_TURN.get().get("history") or [])

    async def append_turn(*a, **k):
        _TURN.get()["persisted"] = {key: k.get(key) for key in (
            "question_key", "query_intent", "assistant_meta", "include_user_in_history")}

    async def none(*a, **k):
        return None

    async def empty(*a, **k):
        return {}

    async def false(*a, **k):
        return False

    async def wellbeing(*a, **k):
        _TURN.get()["flags"].append("wellbeing")

    def spawn(coro):
        coro.close()

    def unlock(*a, **k):
        _TURN.get()["flags"].append("teacher_unlock")
        return {"ok": True}

    patches = [
        mock.patch.object(context_engine, "view_for", view_for),
        mock.patch.object(events, "get_recent_events", recent_events),
        mock.patch.object(coach, "_address_form", address_form),
        mock.patch.object(coach, "welcome_greeting", greeting),
        mock.patch.object(sessions, "get_recent", get_recent),
        mock.patch.object(sessions, "append_turn", append_turn),
        mock.patch.object(sessions, "get_conversation_memory", empty),
        mock.patch.object(sessions, "conversation_needs_title", false),
        mock.patch.object(tutor_decision, "log_decision", none),
        mock.patch.object(tutor_decision, "record_hint_level", none),
        mock.patch("app.brain.consolidator.capture_and_consolidate", none),
        mock.patch.object(question_quality, "spawn", spawn),
        mock.patch.object(coach.safety, "record_wellbeing_flag", wellbeing),
        mock.patch.object(coach.safety, "record_classifier_outage", none),
        mock.patch.object(coach_handoff, "unlock_hand", unlock),
        mock.patch.object(coach_calendar, "load_calendar_context", empty),
        mock.patch.object(ai_usage, "record_usage", none),
        mock.patch.object(content_intelligence, "record_pregen_hit", none),
    ]
    with contextlib.ExitStack() as stack:
        for patch in patches:
            stack.enter_context(patch)
        yield


# ── one turn ─────────────────────────────────────────────────────────────────

async def run_turn(
    screen: dict, facts: dict, scenario: dict, persona_key: str, variant: str,
) -> dict[str, Any]:
    from app.agents import coach
    from app.services.llm import register_observer

    persona = PERSONAS[persona_key]
    lang = scenario.get("lang") or persona["lang"]
    exchange_id = f"eval-{uuid4().hex[:12]}"
    turn = {
        "brain": _brain(screen, facts, persona),
        "events": _events(scenario.get("evidence"), screen, facts),
        "persona": persona, "history": scenario.get("history") or [],
        "persisted": {}, "flags": [],
    }
    _TURN.set(turn)
    calls: list[dict[str, Any]] = []

    def observe(event: dict[str, Any]) -> None:
        if event.get("exchange_id") == exchange_id:
            usage = event.get("usage") or {}
            calls.append({
                "operation": event.get("operation"), "deployment": event.get("deployment"),
                "input_tokens": usage.get("input_tokens"),
                "cached_input_tokens": usage.get("cached_input_tokens"),
                "output_tokens": usage.get("output_tokens"),
                "reasoning_tokens": usage.get("reasoning_tokens"),
                "latency_ms": event.get("latency_ms"), "finish_reason": event.get("finish_reason"),
            })

    remove = register_observer(observe)
    pointer_requests: list[dict[str, Any]] = []
    teacher: list[dict[str, Any]] = []
    diagnostics: dict[str, Any] = {}
    trace: list[dict[str, str]] = []
    chunks: list[str] = []
    mark_at_first: Optional[list] = None
    first_ms: Optional[int] = None
    started = time.monotonic()
    error = None
    try:
        async for piece in coach.run_coach_stream(
            f"eval-{persona_key}",
            user_message=scenario.get("message") if scenario["kind"] == "typed" else None,
            trigger=scenario.get("trigger"),
            support_mode=scenario.get("support"),
            language=lang, session_id=f"eval-{exchange_id}", exchange_id=exchange_id,
            endpoint="/eval/coach",
            surface_context={"screen": "learning_lesson", "component_id": screen["component_id"]},
            pointer_requests=pointer_requests, teacher_suggestions=teacher,
            debug_trace=trace, diagnostics_out=diagnostics, pointer_version=2,
        ):
            if not chunks:
                first_ms = round((time.monotonic() - started) * 1000)
                mark_at_first = list(pointer_requests)
            chunks.append(piece)
    except Exception as exc:  # a crash is a finding, not an abort
        error = f"{type(exc).__name__}: {exc}"[:300]
    finally:
        remove()
    text = "".join(chunks)
    return {
        "screen": screen["id"], "scenario": scenario["id"], "persona": persona_key,
        "variant": variant, "lang": lang, "kind": scenario["kind"],
        "text": text, "mark": (mark_at_first or pointer_requests or [None])[0],
        "mark_before_text": mark_at_first is not None and (bool(mark_at_first) or not pointer_requests),
        "teacher": bool(teacher), "flags": turn["flags"],
        "diagnostics": {k: v for k, v in diagnostics.items() if isinstance(v, (str, int, bool))},
        "trace": [f"{s.get('name')}:{s.get('status')}" for s in trace],
        "calls": calls, "first_text_ms": first_ms,
        "total_ms": round((time.monotonic() - started) * 1000), "error": error,
    }


# ── the checks ───────────────────────────────────────────────────────────────

_HEBREW = re.compile(r"[֐-׿]")
_ARABIC = re.compile(r"[؀-ۿ]")
_LATIN = re.compile(r"[A-Za-z]")
_TAG = re.compile(r"⟦|⟧|【|】|\[\[\s*(o\d|q\b|opts)")
_SENTENCE = re.compile(r"(?<=[.!?؟…])\s+|\n+")


def check_turn(turn: dict, scenario: dict, facts: dict, variant: str) -> dict[str, Any]:
    """Hard gates (must be 0 across a run) and soft signals for one turn."""
    from app.agents import answer_guard

    text = turn["text"] or ""
    lang = turn["lang"]
    hard: list[str] = []
    soft: dict[str, Any] = {}
    if turn["error"]:
        hard.append("crashed")
    if not text.strip():
        hard.append("empty_reply")
    if _TAG.search(text):
        hard.append("visible_tag")
    letters = {"he": _HEBREW, "ar": _ARABIC, "en": _LATIN}[lang]
    if text.strip() and not letters.search(text):
        hard.append("wrong_language")
    if lang == "en" and _HEBREW.search(text):
        hard.append("wrong_language")
    if facts["correct"] and scenario["kind"] != "support":
        guard = answer_guard.AnswerGuard(facts["correct"], facts["options"])
        if guard.active and any(guard.reveals(s) for s in _SENTENCE.split(text) if s.strip()):
            if not (scenario.get("evidence") == "solved"):
                hard.append("answer_leak")
    mark = turn["mark"]
    marks_on = VARIANTS[variant]["COACH_FOCUS_MARKS_ENABLED"] == "on"
    if mark and mark.get("kind") == "option":
        # Allowed only on a solved question, or on the learner's OWN wrong
        # choice (the option `_events` answered with).
        evidence = scenario.get("evidence")
        index = (mark.get("ordinal") or 0) - 1
        marked = facts["options"][index] if 0 <= index < len(facts["options"]) else None
        own_wrong = next((o for o in facts["options"] if o not in facts["correct"]), None)
        if not (evidence == "solved" or (evidence == "wrong_choice" and marked == own_wrong)):
            hard.append("mark_leak")
    if marks_on:
        expected = scenario.get("expect", {}).get("mark") or ["any"]
        kind = (mark or {}).get("kind") or "none"
        soft["mark_kind"] = kind
        soft["mark_ok"] = "any" in expected or kind in expected
        soft["mark_before_text"] = turn["mark_before_text"]
    soft["planning_calls"] = sum(1 for c in turn["calls"] if ".tool_plan." in str(c["operation"]))
    soft["model_calls"] = len(turn["calls"])
    return {"hard": sorted(set(hard)), "soft": soft}


def turn_cost(turn: dict) -> float:
    from app.services.ai_usage_rollup import event_cost

    return sum(event_cost(c)[0] for c in turn["calls"])
