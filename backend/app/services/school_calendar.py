"""One timeline of everything in a class that has a date on it.

A teacher's dated work lives in three stores that each own their own dates:
task launches carry `due_at`, goals carry `deadline`, mentoring records carry a
meeting `date`. This module adds a fourth kind — a free calendar event (a
lesson, a reminder, a test) for the things that are not already something else
— and then **reads all four together**.

**Aggregate, never copy.** Nothing dated is duplicated into a calendar store.
The moment a due date moved, a copy would become a second truth that disagrees
with the first, and a teacher would have to edit two places to fix one date. So
the calendar owns only its own events; everything else it reads where it lives.

**Days, not instants.** A calendar is a grid of days, and which day something
falls on is a question with a wrong answer: a 22:30 UTC deadline is *tomorrow*
in Israel, and an all-day event must never slide across a timezone boundary at
all. Every item is therefore stamped with `day` — a `YYYY-MM-DD` computed in
the school's timezone for timestamps, and passed through untouched for dates
that were already day-shaped.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
from zoneinfo import ZoneInfo

from app.brain.repository import _get_collection_named

COLLECTION = "calendar_events"

_FALLBACK = Path(__file__).resolve().parents[2] / ".runtime" / "calendar_events.json"

#: The school's wall clock. Everything is stored in UTC; only the *bucketing*
#: into day columns and the rendering of a time happen here. Configurable
#: because a second school in another timezone must not need a code change.
SCHOOL_TIMEZONE = os.getenv("SCHOOL_TIMEZONE", "Asia/Jerusalem")

EVENT_KINDS = ("lesson", "reminder", "test", "event")
TARGET_KINDS = ("learner", "subgroup", "group")

#: What a calendar row can be. The first is ours; the other three are read from
#: the stores that own them.
SOURCES = ("event", "task", "goal", "meeting")


class CalendarError(Exception):
    """A refusal the caller may see. The message is a stable code."""


def _school_zone() -> ZoneInfo:
    try:
        return ZoneInfo(SCHOOL_TIMEZONE)
    except Exception:  # pragma: no cover - a bad env var must not break the page
        return ZoneInfo("UTC")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return f"cal_{uuid.uuid4().hex[:10]}"


# ── the day question ─────────────────────────────────────────────────────────

def is_day_shaped(value: Any) -> bool:
    """True for a bare ``YYYY-MM-DD``.

    These are already answers to "which day", so they are never converted:
    a mentoring meeting on the 12th is on the 12th in every timezone.
    """
    text = str(value or "").strip()
    if len(text) != 10:
        return False
    try:
        datetime.strptime(text, "%Y-%m-%d")
    except ValueError:
        return False
    return True


def day_of(value: Any) -> Optional[str]:
    """Which day column an item belongs in, in the school's timezone.

    A day-shaped value passes through untouched — converting it would be the
    all-day slide bug. A timestamp is moved into school time first, because
    23:00 UTC on Sunday is Monday in the room where the class happens.
    """
    text = str(value or "").strip()
    if not text:
        return None
    if is_day_shaped(text):
        return text
    try:
        stamp = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp.astimezone(_school_zone()).date().isoformat()


def _in_range(day: Optional[str], start: str, end: str) -> bool:
    """Inclusive on both ends — a range is a set of day columns, and the last
    column a teacher can see must be one they can also fill."""
    return bool(day) and start <= day <= end


def normalize_range(from_day: Any, to_day: Any) -> tuple[str, str]:
    """The window to read, defaulting to the month around today."""
    if is_day_shaped(from_day) and is_day_shaped(to_day):
        start, end = str(from_day), str(to_day)
        return (start, end) if start <= end else (end, start)
    today = datetime.now(_school_zone()).date()
    first = today.replace(day=1)
    nxt = (first + timedelta(days=32)).replace(day=1)
    return first.isoformat(), (nxt - timedelta(days=1)).isoformat()


# ── the event entity ─────────────────────────────────────────────────────────

def normalize_targets(value: Any) -> list[dict[str, str]]:
    """`[{kind, id}]`, deduped and shape-checked.

    The vocabulary is the one `tasks/assign.py` already speaks. Access is NOT
    decided here — `assign.resolve_targets` does that, server-side, and this
    only refuses shapes it could never resolve.
    """
    if not isinstance(value, list):
        raise CalendarError("bad_targets")
    seen: set[tuple[str, str]] = set()
    targets: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            raise CalendarError("bad_targets")
        kind = str(item.get("kind") or "").strip()
        target_id = str(item.get("id") or "").strip()
        if kind not in TARGET_KINDS or not target_id:
            raise CalendarError("bad_targets")
        key = (kind, target_id)
        if key in seen:
            continue
        seen.add(key)
        targets.append({"kind": kind, "id": target_id})
    if not targets:
        raise CalendarError("targets_required")
    return targets


def build_event(data: dict[str, Any], *, group_id: str, teacher_id: str) -> dict[str, Any]:
    """Validate one free event. Raises `CalendarError` with a stable code."""
    title = str(data.get("title") or "").strip()
    if not title:
        raise CalendarError("title_required")

    kind = str(data.get("kind") or "event").strip()
    if kind not in EVENT_KINDS:
        raise CalendarError("bad_kind")

    all_day = bool(data.get("all_day"))
    start_at = str(data.get("start_at") or "").strip()
    end_at = str(data.get("end_at") or "").strip() or None

    # An all-day event is stored day-shaped, deliberately: giving it a
    # timestamp is what makes it slide a day when read from another timezone.
    if all_day:
        if not is_day_shaped(start_at):
            raise CalendarError("bad_start")
        if end_at is not None and not is_day_shaped(end_at):
            raise CalendarError("bad_end")
    else:
        if day_of(start_at) is None or is_day_shaped(start_at):
            raise CalendarError("bad_start")
        if end_at is not None and (day_of(end_at) is None or is_day_shaped(end_at)):
            raise CalendarError("bad_end")
    if end_at is not None and end_at < start_at:
        raise CalendarError("end_before_start")

    return {
        "_id": _new_id(),
        "group_id": group_id,
        "teacher_id": teacher_id,
        "title": title[:200],
        "description": str(data.get("description") or "").strip()[:2000],
        "kind": kind,
        "all_day": all_day,
        "start_at": start_at,
        "end_at": end_at,
        "targets": normalize_targets(data.get("targets")),
        "created_at": _now(),
        "updated_at": _now(),
        "deleted": False,
    }


# ── storage ──────────────────────────────────────────────────────────────────

def _read_fallback() -> list[dict[str, Any]]:
    try:
        if _FALLBACK.exists():
            rows = json.loads(_FALLBACK.read_text(encoding="utf-8"))
            return list(rows) if isinstance(rows, list) else []
    except (OSError, json.JSONDecodeError) as exc:
        print(f"⚠️ calendar fallback read failed: {exc}")
    return []


def _write_fallback(rows: list[dict[str, Any]]) -> None:
    try:
        _FALLBACK.parent.mkdir(parents=True, exist_ok=True)
        _FALLBACK.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as exc:
        print(f"⚠️ calendar fallback write failed: {exc}")


async def save_event(event: dict[str, Any]) -> dict[str, Any]:
    collection = _get_collection_named(COLLECTION)
    if collection is not None:
        try:
            await collection.update_one({"_id": event["_id"]}, {"$set": event}, upsert=True)
            return event
        except Exception as exc:
            print(f"⚠️ calendar write failed, using fallback: {type(exc).__name__}")
    rows = [row for row in _read_fallback() if row.get("_id") != event["_id"]]
    rows.append(event)
    _write_fallback(rows)
    return event


async def get_event(event_id: str) -> Optional[dict[str, Any]]:
    collection = _get_collection_named(COLLECTION)
    if collection is not None:
        try:
            row = await collection.find_one({"_id": event_id})
            if row and not row.get("deleted"):
                return row
            return None
        except Exception as exc:
            print(f"⚠️ calendar read failed, using fallback: {type(exc).__name__}")
    return next((row for row in _read_fallback()
                 if row.get("_id") == event_id and not row.get("deleted")), None)


async def list_events(group_id: str) -> list[dict[str, Any]]:
    collection = _get_collection_named(COLLECTION)
    if collection is not None:
        try:
            cursor = collection.find({"group_id": group_id, "deleted": {"$ne": True}})
            return [row async for row in cursor]
        except Exception as exc:
            print(f"⚠️ calendar list failed, using fallback: {type(exc).__name__}")
    return [row for row in _read_fallback()
            if row.get("group_id") == group_id and not row.get("deleted")]


async def delete_event(event_id: str) -> bool:
    """Soft-delete. The row is kept — a deleted event is still a thing that
    was on the calendar when someone planned around it."""
    event = await get_event(event_id)
    if event is None:
        return False
    event["deleted"] = True
    event["deleted_at"] = _now()
    event["updated_at"] = _now()
    await save_event(event)
    return True


async def ensure_indexes() -> None:
    collection = _get_collection_named(COLLECTION)
    if collection is None:
        return
    try:
        await collection.create_index([("group_id", 1), ("start_at", 1)])
    except Exception as exc:  # pragma: no cover
        print(f"⚠️ calendar indexes: {type(exc).__name__}: {exc}")


# ── the fold: four sources, one list ─────────────────────────────────────────

def _item(source: str, **fields: Any) -> dict[str, Any]:
    base = {
        "source": source, "id": "", "kind": source, "title": "", "day": None,
        "at": None, "all_day": True, "learner_id": None, "learner_ids": [],
        "targets": [], "subject": None, "href": None, "meta": {},
    }
    base.update(fields)
    return base


def events_to_items(events: list[dict[str, Any]], start: str, end: str) -> list[dict[str, Any]]:
    items = []
    for event in events:
        day = day_of(event.get("start_at"))
        if not _in_range(day, start, end):
            continue
        items.append(_item(
            "event",
            id=str(event.get("_id") or ""),
            kind=str(event.get("kind") or "event"),
            title=str(event.get("title") or ""),
            day=day,
            at=None if event.get("all_day") else str(event.get("start_at") or ""),
            all_day=bool(event.get("all_day")),
            targets=list(event.get("targets") or []),
            meta={"description": event.get("description") or "",
                  "end_at": event.get("end_at"),
                  "teacher_id": event.get("teacher_id")},
        ))
    return items


def launches_to_items(launches: list[dict[str, Any]], titles: dict[str, str],
                      subjects: dict[str, str], start: str, end: str) -> list[dict[str, Any]]:
    """Task launches, on their due date.

    A launch is a historical fact — it froze its roster when it opened — so the
    learners shown are the ones it actually reached, not whoever is in the
    class today. `tasks/assign.py` draws that line and the calendar keeps it.
    """
    items = []
    for launch in launches:
        due = launch.get("due_at")
        day = day_of(due)
        if not _in_range(day, start, end):
            continue
        task_id = str(launch.get("task_id") or "")
        items.append(_item(
            "task",
            id=str(launch.get("_id") or ""),
            kind="task",
            title=titles.get(task_id) or task_id,
            day=day,
            at=None if is_day_shaped(due) else str(due),
            all_day=is_day_shaped(due),
            learner_ids=list(launch.get("learner_ids") or []),
            targets=list(launch.get("targets") or []),
            subject=subjects.get(task_id),
            href=f"/teacher/tasks?task={task_id}",
            meta={"task_id": task_id, "status": launch.get("status"),
                  "seq": launch.get("seq")},
        ))
    return items


def conversations_to_items(learner_id: str, conversations: list[dict[str, Any]],
                           start: str, end: str) -> list[dict[str, Any]]:
    """Two dated things per mentoring record: the meeting, and each goal's
    deadline. They are separate rows because they are separate commitments."""
    items = []
    for conversation in conversations:
        day = day_of(conversation.get("date"))
        if _in_range(day, start, end):
            items.append(_item(
                "meeting",
                id=str(conversation.get("id") or ""),
                kind="meeting",
                title=str(conversation.get("meeting_stage") or "").strip(),
                day=day,
                learner_id=learner_id,
                learner_ids=[learner_id],
                href=f"/teacher/student/{learner_id}",
                meta={"conversation_id": conversation.get("id"),
                      "author": conversation.get("author")},
            ))
        for goal in conversation.get("goals") or []:
            goal_day = day_of(goal.get("deadline"))
            if not _in_range(goal_day, start, end):
                continue
            items.append(_item(
                "goal",
                id=str(goal.get("id") or ""),
                kind="goal",
                title=str(goal.get("title") or ""),
                day=goal_day,
                learner_id=learner_id,
                learner_ids=[learner_id],
                href=f"/teacher/student/{learner_id}",
                meta={"conversation_id": conversation.get("id"),
                      "progress_stage": goal.get("progress_stage"),
                      "approved": bool(goal.get("approved_by")),
                      "progress": goal.get("progress")},
            ))
    return items


def sort_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """By day, then all-day first, then time. Within a day column an all-day
    item is a heading for the day rather than a moment inside it."""
    return sorted(items, key=lambda item: (str(item.get("day") or ""),
                                           0 if item.get("all_day") else 1,
                                           str(item.get("at") or ""),
                                           str(item.get("title") or "")))


def filter_for_learners(items: list[dict[str, Any]],
                        learner_ids: Optional[set[str]]) -> list[dict[str, Any]]:
    """Narrow to a sub-group or one student.

    A class-wide item stays visible when scoped to a sub-group: "the whole
    class has a test on Tuesday" is true for those six children too, and
    hiding it would make the narrowed calendar lie by omission.
    """
    if learner_ids is None:
        return items
    kept = []
    for item in items:
        reaches = set(item.get("learner_ids") or [])
        class_wide = not reaches and any(
            target.get("kind") == "group" for target in item.get("targets") or [])
        if class_wide or (reaches & learner_ids):
            kept.append(item)
    return kept
