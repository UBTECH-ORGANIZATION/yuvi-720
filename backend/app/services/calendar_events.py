"""Read-only learner projection of free calendar events from ADO #241.

Free events use the assignment target vocabulary. Targets are resolved live
through ``tasks.assign.resolve_one`` on every read; stored learner lists are
never trusted and dated work remains owned by its original service.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.brain import org
from app.brain.repository import _get_collection_named
from app.services.tasks import assign


COLLECTION = "calendar_events"
MAX_READ = 1000
DEFAULT_TIMEZONE = "Asia/Jerusalem"


def _event_date(value: object, timezone_name: object = DEFAULT_TIMEZONE) -> date | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        if len(raw) == 10:
            return date.fromisoformat(raw)
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        try:
            zone = ZoneInfo(str(timezone_name or DEFAULT_TIMEZONE))
        except ZoneInfoNotFoundError:
            zone = ZoneInfo(DEFAULT_TIMEZONE)
        return parsed.astimezone(zone).date()
    except ValueError:
        return None


async def _read_events() -> list[dict[str, Any]]:
    """Read the event collection. No fallback writes and no index mutation."""
    handle = _get_collection_named(COLLECTION)
    if handle is None:
        return []
    try:
        return await handle.find({"active": {"$ne": False}}).to_list(length=MAX_READ)
    except Exception as exc:  # pragma: no cover - infrastructure failure
        print(f"⚠️ calendar event read failed: {type(exc).__name__}")
        return []


async def list_for_learner(
    learner_id: str, start: date, end: date,
) -> list[dict[str, Any]]:
    """Return free events that currently target this learner in ``[start,end]``."""
    visible: list[dict[str, Any]] = []
    schools = {str(row.get("_id")): row for row in await org.list_schools()}
    group_timezones: dict[str, str] = {}
    for event in await _read_events():
        group_id = str(event.get("group_id") or "")
        if group_id and group_id not in group_timezones:
            group = await org.get_group(group_id)
            school_id = str((group or {}).get("school_id") or "")
            group_timezones[group_id] = str(
                (schools.get(school_id) or {}).get("timezone") or DEFAULT_TIMEZONE
            )
        timezone_name = event.get("timezone") or group_timezones.get(group_id)

        # Pre-#241 personal events have owner/date/time and no targets. They are
        # visible only to that exact owner; treating owner as a teacher-created
        # audience would leak all four legacy rows to somebody else.
        targets = event.get("targets") or []
        legacy = not targets and event.get("owner_id") is not None
        if legacy and str(event.get("owner_id")) != learner_id:
            continue
        if legacy:
            event_day = _event_date(event.get("date"), timezone_name)
            event_time = str(event.get("time") or "").strip()
            all_day = not event_time
            if event_day is None or not start <= event_day <= end:
                continue
            if all_day:
                start_at = event_day.isoformat()
            else:
                try:
                    wall_time = datetime.strptime(event_time, "%H:%M").time()
                except ValueError:
                    continue
                try:
                    zone = ZoneInfo(str(timezone_name or DEFAULT_TIMEZONE))
                except ZoneInfoNotFoundError:
                    zone = ZoneInfo(DEFAULT_TIMEZONE)
                start_at = datetime.combine(event_day, wall_time, zone).astimezone(
                    timezone.utc
                ).isoformat()
            visible.append({
                "id": str(event.get("event_id") or event.get("_id") or ""),
                "kind": "event",
                "title": str(event.get("title") or ""),
                "subject": None,
                "teacher_name": None,
                "start_at": start_at,
                "end_at": None,
                "all_day": all_day,
                "status": "upcoming",
            })
            continue

        event_date = _event_date(
            event.get("date") if event.get("all_day") else event.get("start_at"),
            timezone_name,
        )
        if event_date is None or not start <= event_date <= end:
            continue
        creator_id = str(event.get("creator_id") or "")
        if not creator_id or not isinstance(targets, list):
            continue
        recipients: list[str] = []
        try:
            for target in targets:
                if isinstance(target, dict):
                    recipients.extend(await assign.resolve_one(creator_id, target))
        except assign.AssignError:
            # A revoked or malformed target makes the event unreachable rather
            # than leaking the stored audience it used to resolve to.
            continue
        if learner_id not in recipients:
            continue
        all_day = bool(event.get("all_day"))
        visible.append({
            "id": str(event.get("_id") or event.get("id") or ""),
            "kind": "event",
            "title": str(event.get("title") or ""),
            "subject": event.get("subject"),
            "teacher_name": event.get("creator_name"),
            "start_at": str(event.get("date") if all_day else event.get("start_at")),
            "end_at": None if all_day else event.get("end_at"),
            "all_day": all_day,
            "status": "cancelled" if event.get("status") == "cancelled" else "upcoming",
        })
    return visible