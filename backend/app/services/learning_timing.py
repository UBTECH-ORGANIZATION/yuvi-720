"""Evidence-based learning-time summaries from provider xAPI timestamps.

The provider does not currently report active-focus durations. We therefore keep
wall-clock intervals explicitly labelled ``elapsed_between_events`` instead of
presenting them as exact active time. This distinction is required for honest
teacher evidence and proactive support.
"""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any, Optional


MAX_REASONABLE_INTERVAL_SECONDS = 60 * 60 * 4
PROLONGED_INTERACTION_SECONDS = int(os.environ.get("PROLONGED_INTERACTION_SECONDS", "180"))


def parse_timestamp(value: object) -> Optional[datetime]:
    if not isinstance(value, str) or not value:
        return None
    candidate = value.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(candidate)
    except ValueError:
        return None


def elapsed_seconds(start: Optional[datetime], end: Optional[datetime]) -> Optional[float]:
    if start is None or end is None:
        return None
    seconds = (end - start).total_seconds()
    if seconds < 0 or seconds > MAX_REASONABLE_INTERVAL_SECONDS:
        return None
    return round(seconds, 3)


def _question_id(event: dict[str, Any]) -> Optional[str]:
    if event.get("question_id"):
        return str(event["question_id"])
    object_id = event.get("object_id")
    if not isinstance(object_id, str) or "#" not in object_id:
        return None
    return object_id.rsplit("#", 1)[-1] or None


def summarize_session(events: list[dict[str, Any]], session_id: str) -> dict[str, Any]:
    """Summarize component and per-question elapsed evidence for one launch."""
    ordered = sorted(
        events,
        key=lambda event: event.get("occurred_at") or event.get("stored_at") or "",
    )
    started_event = next((event for event in ordered if event.get("verb") == "enter"), None)
    component_id = next(
        (event.get("launch") for event in ordered if event.get("launch")),
        None,
    )
    completed_event = next(
        (
            event for event in reversed(ordered)
            if event.get("verb") == "completed"
            and (not component_id or event.get("object_id") == component_id)
        ),
        None,
    )
    start_time = parse_timestamp(
        (started_event or {}).get("occurred_at") or (started_event or {}).get("stored_at")
    )
    end_time = parse_timestamp(
        (completed_event or {}).get("occurred_at") or (completed_event or {}).get("stored_at")
    )

    attempts: list[dict[str, Any]] = []
    previous_time = start_time
    for event in ordered:
        occurred_at = parse_timestamp(event.get("occurred_at") or event.get("stored_at"))
        if event.get("verb") == "answered":
            result = event.get("result") or {}
            attempts.append({
                "question_id": _question_id(event),
                "object_id": event.get("object_id"),
                "elapsed_seconds": elapsed_seconds(previous_time, occurred_at),
                "timing_quality": "elapsed_between_events" if previous_time else "unavailable",
                "success": result.get("success"),
                "occurred_at": event.get("occurred_at"),
            })
        if occurred_at is not None:
            previous_time = occurred_at

    question_groups: dict[str, dict[str, Any]] = {}
    for attempt in attempts:
        key = attempt.get("question_id") or attempt.get("object_id") or "unknown"
        summary = question_groups.setdefault(str(key), {
            "question_id": attempt.get("question_id"),
            "object_id": attempt.get("object_id"),
            "attempts": 0,
            "elapsed_seconds": 0.0,
            "measured_attempts": 0,
            "timing_quality": "elapsed_between_events",
            "last_success": None,
        })
        summary["attempts"] += 1
        if attempt["elapsed_seconds"] is not None:
            summary["elapsed_seconds"] = round(
                summary["elapsed_seconds"] + attempt["elapsed_seconds"], 3
            )
            summary["measured_attempts"] += 1
        summary["last_success"] = attempt["success"]
    for summary in question_groups.values():
        if not summary["measured_attempts"]:
            summary["elapsed_seconds"] = None
            summary["timing_quality"] = "unavailable"

    total_seconds = elapsed_seconds(start_time, end_time)
    return {
        "session_id": session_id,
        "unit_id": next((event.get("unit_id") for event in ordered if event.get("unit_id")), None),
        "component_id": component_id,
        "objective_id": next(
            (event.get("objective_id") for event in ordered if event.get("objective_id")),
            None,
        ),
        "status": "completed" if completed_event else ("started" if started_event else "no_evidence"),
        "started_at": (started_event or {}).get("occurred_at"),
        "completed_at": (completed_event or {}).get("occurred_at"),
        "total_elapsed_seconds": total_seconds,
        "total_timing_quality": "elapsed_between_events" if total_seconds is not None else "unavailable",
        "questions": list(question_groups.values()),
        "attempts": attempts,
        "evidence_count": len(ordered),
        "active_time_available": False,
    }
