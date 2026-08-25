"""Durable per-learner activity log for teacher analytics.

``learning_events`` already captures the PERFORMANCE side per answered question —
success/failure, attempts, and honest time-per-question (timing evidence). This
module adds the SUPPORT side that was previously only transient (kept in
``current_state.support_used`` and overwritten each question): every **hint**,
**explanation**, and **different way** (generated explainer) a learner uses, with
full task context.

``question_summary`` joins the two into one per-question row — performance, time,
and each kind of help used — filterable by task (component) or subject, so a
future teacher view can be built directly on top of it.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from app.brain.repository import _get_collection_named
from app.services import learning_timing

# hint / explanation / different_way are one-shot per question; yuvi_chat is a
# repeatable turn (counts up each question-scoped message the learner sends).
# `content_hint` is the CONTENT's own hint button ("אפשר רמז?" inside the iframe,
# reported as xAPI `requested`) — 720 §3.3 names it explicitly as evidence
# ("מספר הפעמים שהתלמיד השתמש ברמזים מן התוכן"), and it stayed invisible
# while only Yuvi's own buttons were counted. Kept distinct from `hint` so a
# teacher can tell who the learner asked.
# `content_choice` is a 720 §Selected self-report (practiceDecision /
# isUnderstood / isRepeat / externalLearning); the chosen value lives in `meta`.
# `task` is a completed teacher-authored task. It is NOT a support signal like
# the rest — it is here because the task store is deliberately separate from
# `learning_events`, and this is the durable per-learner record that a task was
# done. It carries no component/item/question, so `question_summary` skips it;
# the identifier lives in `meta.task_id`.
KINDS = {"hint", "explanation", "different_way", "yuvi_chat", "content_hint",
         "content_choice", "task"}
#: Kinds that are not per-question and must never open a `question_summary` row.
NON_QUESTION_KINDS = {"task"}
# The learner's own answer to "what helped you understand this?" — a self-report,
# distinct from the objective usage counts above. Kept per question (latest wins).
HELP_METHODS = {"hint", "explanation", "yuvi_chat"}
_FALLBACK = Path(__file__).resolve().parents[2] / ".runtime" / "learner_activity.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_fallback() -> list[dict[str, Any]]:
    try:
        return json.loads(_FALLBACK.read_text(encoding="utf-8")) if _FALLBACK.exists() else []
    except Exception:
        return []


def _write_fallback(rows: list[dict[str, Any]]) -> None:
    try:
        _FALLBACK.parent.mkdir(parents=True, exist_ok=True)
        _FALLBACK.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


def _derive_task(component_id: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """Best-effort objective_id + subject for a component, so activity rows are
    filterable by task/subject on their own (not only via a join)."""
    if not component_id:
        return None, None
    try:
        from app.services import kata_catalog

        component = kata_catalog.get_component(component_id) or {}
        objective_id = component.get("objective_id")
        subject = component.get("subject")
        if not subject and objective_id:
            objective = kata_catalog.get_objective(objective_id) or {}
            subject = objective.get("subject")
        return objective_id, subject
    except Exception:
        return None, None


async def record(
    learner_id: str,
    kind: str,
    *,
    component_id: Optional[str] = None,
    item_id: Optional[str] = None,
    question_id: Optional[str] = None,
    objective_id: Optional[str] = None,
    subject: Optional[str] = None,
    meta: Optional[dict[str, Any]] = None,
) -> None:
    """Append one support-usage record. Best-effort; never blocks the request."""
    if kind not in KINDS:
        return
    if not (objective_id and subject):
        derived_objective, derived_subject = _derive_task(component_id)
        objective_id = objective_id or derived_objective
        subject = subject or derived_subject
    doc = {
        "learner_id": learner_id,
        "kind": kind,
        "component_id": component_id,
        "item_id": item_id,
        "question_id": question_id,
        "objective_id": objective_id,
        "subject": subject,
        "at": _now(),
    }
    if meta:
        doc["meta"] = meta
    collection = _get_collection_named("learner_activity")
    if collection is not None:
        try:
            await collection.insert_one(dict(doc))
            return
        except Exception as exc:
            print(f"⚠️ learner_activity write failed, using fallback: {exc}")
    rows = _read_fallback()
    rows.append(doc)
    _write_fallback(rows)


async def record_helped_attribution(
    learner_id: str,
    methods: list[str],
    *,
    component_id: Optional[str] = None,
    item_id: Optional[str] = None,
    question_id: Optional[str] = None,
    objective_id: Optional[str] = None,
    subject: Optional[str] = None,
) -> list[str]:
    """Store the learner's self-report of which help(s) actually helped them on a
    question ("what helped you understand this?"). ONE record per question — the
    latest answer wins, since the learner may toggle chips. Returns the cleaned,
    de-duplicated method list that was stored. Best-effort; never blocks."""
    clean = [m for m in dict.fromkeys(methods) if m in HELP_METHODS]
    if not (objective_id and subject):
        derived_objective, derived_subject = _derive_task(component_id)
        objective_id = objective_id or derived_objective
        subject = subject or derived_subject
    key = {
        "learner_id": learner_id,
        "kind": "helped_attribution",
        "component_id": component_id,
        "item_id": item_id,
        "question_id": question_id,
    }
    doc = {**key, "objective_id": objective_id, "subject": subject, "methods": clean, "at": _now()}
    collection = _get_collection_named("learner_activity")
    if collection is not None:
        try:
            await collection.update_one(key, {"$set": doc}, upsert=True)
            return clean
        except Exception as exc:
            print(f"⚠️ learner_activity attribution write failed, using fallback: {exc}")
    rows = [
        r for r in _read_fallback()
        if not all(r.get(k) == v for k, v in key.items())
    ]
    rows.append(doc)
    _write_fallback(rows)
    return clean


async def _activity_rows(learner_id: str) -> list[dict[str, Any]]:
    collection = _get_collection_named("learner_activity")
    if collection is not None:
        try:
            cursor = collection.find({"learner_id": learner_id})
            return [row async for row in cursor]
        except Exception:
            pass
    return [row for row in _read_fallback() if row.get("learner_id") == learner_id]


async def has_content_hint(
    learner_id: str,
    *,
    component_id: Optional[str],
    item_id: Optional[str],
    question_id: Optional[str],
) -> bool:
    """Whether the learner opened the embedded content hint for this question."""
    if not (component_id and item_id and question_id):
        return False
    query = {
        "learner_id": learner_id,
        "kind": "content_hint",
        "component_id": component_id,
        "item_id": item_id,
        "question_id": question_id,
    }
    collection = _get_collection_named("learner_activity")
    if collection is not None:
        try:
            return bool(await collection.find_one(query, {"_id": 1}))
        except Exception:
            pass
    return any(all(row.get(key) == value for key, value in query.items()) for row in _read_fallback())


def _question_key(component_id: Any, item_id: Any, question_id: Any) -> str:
    return "|".join(str(part or "") for part in (component_id, item_id, question_id))


async def question_summary(
    learner_id: str,
    *,
    component_id: Optional[str] = None,
    subject: Optional[str] = None,
) -> list[dict[str, Any]]:
    """One row per question the learner touched, merging performance + time
    (from learning_events) with help used (from learner_activity).

    Filterable by ``component_id`` (a task) or ``subject``. This is the data
    backbone for a teacher view — the fields a teacher would want per question.
    """
    from app.services.events import get_learner_events

    events = await get_learner_events(learner_id, limit=2000)
    rows: dict[str, dict[str, Any]] = {}

    def _slot(comp: Any, item: Any, question: Any) -> dict[str, Any]:
        key = _question_key(comp, item, question)
        if key not in rows:
            rows[key] = {
                "question_key": key,
                "component_id": comp,
                "item_id": item,
                "question_id": question,
                "objective_id": None,
                "subject": None,
                "attempts": 0,
                "correct": 0,
                "time_seconds": 0.0,
                "hints_used": 0,
                "content_hints_used": 0,   # the content's own hint button
                "explanations_used": 0,
                "different_way_used": 0,
                "chat_turns": 0,         # question-scoped messages sent to Yuvi
                "helped_reported": [],   # learner's self-attribution: what helped
                "first_at": None,
                "last_at": None,
            }
        return rows[key]

    for event in events:
        if event.get("verb") not in ("answered", "attempted"):
            continue
        slot = _slot(event.get("launch"), event.get("sub_item_id"), event.get("question_id"))
        slot["objective_id"] = slot["objective_id"] or event.get("objective_id")
        slot["subject"] = slot["subject"] or event.get("subject")
        slot["attempts"] += 1
        if (event.get("result") or {}).get("success") is True:
            slot["correct"] += 1
        seconds = learning_timing.capped_elapsed(event.get("timing"))
        if seconds is not None:
            slot["time_seconds"] += seconds
        stamp = event.get("occurred_at") or event.get("stored_at")
        if stamp:
            slot["first_at"] = min(slot["first_at"], stamp) if slot["first_at"] else stamp
            slot["last_at"] = max(slot["last_at"], stamp) if slot["last_at"] else stamp

    kind_field = {
        "hint": "hints_used",
        "content_hint": "content_hints_used",
        "explanation": "explanations_used",
        "different_way": "different_way_used",
        "yuvi_chat": "chat_turns",
    }
    for activity in await _activity_rows(learner_id):
        # A task row has no question to belong to. Without this it would open a
        # slot keyed `"||"` and put one empty row, with no title and no numbers,
        # at the top of every teacher's per-question view.
        if activity.get("kind") in NON_QUESTION_KINDS:
            continue
        slot = _slot(activity.get("component_id"), activity.get("item_id"), activity.get("question_id"))
        slot["objective_id"] = slot["objective_id"] or activity.get("objective_id")
        slot["subject"] = slot["subject"] or activity.get("subject")
        if activity.get("kind") == "helped_attribution":
            slot["helped_reported"] = [m for m in (activity.get("methods") or []) if isinstance(m, str)]
            continue
        field = kind_field.get(activity.get("kind"))
        if field:
            slot[field] += 1

    result = list(rows.values())
    if component_id:
        result = [r for r in result if r["component_id"] == component_id]
    if subject:
        result = [r for r in result if r["subject"] == subject]
    result.sort(key=lambda r: (str(r["component_id"] or ""), str(r["item_id"] or ""), str(r["question_id"] or "")))
    return result
