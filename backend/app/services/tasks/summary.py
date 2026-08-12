"""Prose over a finished task — and the action items, which are not prose.

The same split the daily brief runs on, for the same reasons:

* the **model** writes the headline, the paragraph and the bullets, because
  "which of these twelve signals matters" is judgement;
* **code** owns every number, every learner id and every action, because a
  lookup and a filter are not judgement, and a model that picks the children is
  a model that can pick the wrong ones.

Grounding is by opaque ref. Each fact the model may stand on gets an id it
could only have got from the table it was handed, so an invented claim cannot
pass the gate by naming a plausible-sounding signal — which is exactly how the
brief's first version let ungrounded lines through.

Action items are generated entirely in code and carry real learner ids, so
"assign a follow-up to these four" arrives in the chat with the four already
chosen. That is the Phase 1 hand-off: the model drafts, the teacher's click
writes.
"""

from __future__ import annotations

import json
import re
from typing import Any, Optional

MAX_BULLETS = 4
#: A question this many of the class got wrong is worth a teacher's attention.
STRUGGLE_SHARE = 0.4
MIN_FOR_ACTION = 2

_FRAMING = {
    "he": "אתה כותב למורה סיכום קצר על משימה שהכיתה סיימה.",
    "ar": "أنت تكتب للمعلّم ملخصًا قصيرًا عن مهمة أنهاها الصف.",
    "en": "You write a teacher a short summary of a task their class has finished.",
}


def _facts(tracking: dict[str, Any]) -> dict[str, Any]:
    """Everything the model may reason from — counts only, never a name."""
    learners = tracking.get("learners") or []
    questions = tracking.get("questions") or []
    done = [row for row in learners if row.get("status") in ("submitted", "graded")]
    scores = [row["score"] for row in done if isinstance(row.get("score"), (int, float))]

    hard = []
    for question in questions:
        attempted = sum(len(question.get(bucket) or [])
                        for bucket in ("correct", "partial", "wrong", "skipped"))
        missed = len(question.get("wrong") or []) + len(question.get("partial") or [])
        if attempted and missed / attempted >= STRUGGLE_SHARE:
            hard.append({
                "question": question.get("prompt_text"),
                "wrong": len(question.get("wrong") or []),
                "partial": len(question.get("partial") or []),
                "attempted": attempted,
                "type": question.get("type"),
            })
    hard.sort(key=lambda row: -(row["wrong"] + row["partial"]))

    return {
        "assigned": len(learners),
        "completed": len(done),
        "not_started": len([row for row in learners if row.get("status") == "not_started"]),
        "in_progress": len([row for row in learners if row.get("status") == "in_progress"]),
        "average_score": round(sum(scores) / len(scores)) if scores else None,
        "questions_total": len(questions),
        "hard_questions": hard[:5],
        "needing_review": len([row for row in done if row.get("needs_review")]),
        # A per-question breakdown across two different papers is a breakdown of
        # nothing, so the model is told when that has happened.
        "stale_snapshots": tracking.get("stale_snapshots") or 0,
    }


def _refs(facts: dict[str, Any]) -> dict[str, dict[str, Any]]:
    table: dict[str, dict[str, Any]] = {}

    def add(signal: str, value: Any, **extra: Any) -> None:
        if value in (None, ""):
            return
        table[f"f{len(table) + 1}"] = {"signal": signal, "value": value, **extra}

    add("completed", facts.get("completed"), of=facts.get("assigned"))
    add("not_started", facts.get("not_started") or None)
    add("in_progress", facts.get("in_progress") or None)
    add("average_score", facts.get("average_score"))
    add("needing_review", facts.get("needing_review") or None)
    add("stale_snapshots", facts.get("stale_snapshots") or None)
    for question in facts.get("hard_questions") or []:
        add("hard_question", question["wrong"] + question["partial"],
            question=question["question"], attempted=question["attempted"])
    return table


def _numbers(text: str) -> set[str]:
    return set(re.findall(r"\d+", text or ""))


def _allowed_numbers(facts: dict[str, Any]) -> set[str]:
    return _numbers(json.dumps(facts, ensure_ascii=False, default=str))


def _instruction(language: str, facts: dict[str, Any],
                 refs: dict[str, dict[str, Any]]) -> str:
    catalogue = "\n".join(
        f"  {ref}: {json.dumps(value, ensure_ascii=False, default=str)}"
        for ref, value in refs.items()
    )
    return f"""{_FRAMING.get(language, _FRAMING['he'])}

The task's results, as JSON:
{json.dumps(facts, ensure_ascii=False, default=str)}

Each bullet must cite one of these ids in a "ref" field:
{catalogue}

Return JSON only:
{{"headline": "one sentence", "summary": "two or three sentences",
  "bullets": [{{"text": "...", "why": "...", "ref": "f2"}}]}}

Write in {language}, addressing the teacher directly. At most {MAX_BULLETS} bullets.
Do not write any number that is not in the results above. Do not name a student —
you have not been given any names, and inventing one would be worse than useless.
Do not suggest what to do next; the buttons under your text are already handled."""


def _fallback(facts: dict[str, Any], language: str) -> dict[str, Any]:
    """No provider, no prose — the numbers still render.

    Deliberately not a sentence assembled from templates pretending to be
    written: the screen shows the counts it has, and the prose section is
    simply absent.
    """
    return {"headline": None, "summary": None, "bullets": [], "source": "none"}


async def summarize(
    tracking: dict[str, Any], *, language: str = "he", usage: Any = None,
) -> dict[str, Any]:
    """A grounded paragraph over one task's results, plus code-chosen actions."""
    facts = _facts(tracking)
    refs = _refs(facts)
    actions = _actions(tracking, facts)

    if not facts["completed"]:
        # Nothing to summarise yet, and a model asked to summarise nothing
        # writes something anyway.
        return {**_fallback(facts, language), "facts": facts, "actions": actions}

    try:
        from app.services.llm import call_llm
        from app.services.ai_usage import UsageContext
        from app.services.tasks.spec import loads_model_json

        context = usage or UsageContext(
            actor_id="system", actor_type="system", endpoint="internal:task_summary",
            feature="feature_5_teacher_tasks", operation="task.summary",
            source="task_summary",
        )
        raw = await call_llm(
            [{"role": "user", "content": _instruction(language, facts, refs)}],
            usage_context=context, max_tokens=900, json_mode=True, model_tier="strong",
        )
        parsed = loads_model_json(raw) or {}
    except Exception as exc:
        print(f"⚠️ task summary failed: {type(exc).__name__}")
        return {**_fallback(facts, language), "facts": facts, "actions": actions}

    allowed = _allowed_numbers(facts)
    headline = _grounded_prose(parsed.get("headline"), allowed)
    summary = _grounded_prose(parsed.get("summary"), allowed)

    bullets = []
    for entry in (parsed.get("bullets") or [])[:MAX_BULLETS]:
        if not isinstance(entry, dict):
            continue
        # An unknown ref is a claim standing on nothing. Dropped, not repaired.
        if entry.get("ref") not in refs:
            continue
        text = _grounded_prose(entry.get("text"), allowed)
        if not text:
            continue
        bullets.append({"text": text, "why": _grounded_prose(entry.get("why"), allowed) or "",
                        "ref": entry["ref"], "evidence": refs[entry["ref"]]})

    return {"headline": headline, "summary": summary, "bullets": bullets,
            "facts": facts, "actions": actions, "source": "llm"}


def _grounded_prose(value: Any, allowed: set[str]) -> Optional[str]:
    """Prose needs no ref, but may not carry a number nobody computed.

    Cheap and effective: the failure this catches is a model rounding "6 of 12"
    into "half the class" and then writing 15 somewhere else.
    """
    text = str(value or "").strip()
    if not text:
        return None
    return text if _numbers(text) <= allowed else None


def _actions(tracking: dict[str, Any], facts: dict[str, Any]) -> list[dict[str, Any]]:
    """The next moves, with their learners already chosen — in code.

    Every action carries real ids so the teacher's click can act on them
    directly: a follow-up task to the children who struggled arrives with the
    children already in it. The label is a locale key, not a sentence, so it
    renders in whichever language the teacher is reading today.
    """
    actions: list[dict[str, Any]] = []
    learners = tracking.get("learners") or []

    not_started = [row["learner_id"] for row in learners if row.get("status") == "not_started"]
    if len(not_started) >= 1:
        actions.append({"kind": "nudge_not_started", "label_key": "tch.tasks.action.nudge",
                        "learner_ids": not_started, "count": len(not_started)})

    review = [row["learner_id"] for row in learners if row.get("needs_review")]
    if review:
        actions.append({"kind": "review_open_answers", "label_key": "tch.tasks.action.review",
                        "learner_ids": review, "count": len(review)})

    # The children who struggled on the questions the class as a whole found
    # hard — the group a follow-up task is actually for.
    struggling: dict[str, int] = {}
    hard_prompts = {row["question"] for row in facts.get("hard_questions") or []}
    for question in tracking.get("questions") or []:
        if question.get("prompt_text") not in hard_prompts:
            continue
        for learner_id in (question.get("wrong") or []) + (question.get("partial") or []):
            struggling[learner_id] = struggling.get(learner_id, 0) + 1

    repeat = sorted([learner for learner, hits in struggling.items() if hits >= MIN_FOR_ACTION])
    if repeat:
        actions.append({"kind": "followup_task", "label_key": "tch.tasks.action.followup",
                        "learner_ids": repeat, "count": len(repeat)})

    return actions
