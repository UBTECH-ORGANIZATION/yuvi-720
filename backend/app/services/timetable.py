"""Read-only expansion of recurring class timetable rules from ADO #242.

Slots are school-local wall-clock rules, never materialised occurrences.
Expansion order is explicit: build the base occurrence, apply its exception,
then suppress the resulting date against the editable school calendar. A moved
lesson that lands on a holiday therefore vanishes. Cancelled occurrences stay
visible so the learner can see that the lesson is not happening.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.brain import org
from app.brain.repository import _get_collection_named
from app.services import org_repository


SLOTS = "timetable_slots"
EXCEPTIONS = "timetable_exceptions"
SCHOOL_DAYS = "school_calendar_days"
MAX_RANGE_DAYS = 62
MAX_READ = 2000
DEFAULT_TIMEZONE = "Asia/Jerusalem"


async def _read_collection(name: str) -> list[dict[str, Any]]:
    handle = _get_collection_named(name)
    if handle is None:
        return []
    try:
        return await handle.find({"active": {"$ne": False}}).to_list(length=MAX_READ)
    except Exception as exc:  # pragma: no cover - infrastructure failure
        print(f"⚠️ timetable read failed on {name}: {type(exc).__name__}")
        return []


def _parse_date(value: object) -> date | None:
    try:
        return date.fromisoformat(str(value or ""))
    except ValueError:
        return None


def _parse_time(value: object) -> time | None:
    try:
        return time.fromisoformat(str(value or ""))
    except ValueError:
        return None


def _timezone(name: object) -> ZoneInfo:
    try:
        return ZoneInfo(str(name or DEFAULT_TIMEZONE))
    except ZoneInfoNotFoundError:
        return ZoneInfo(DEFAULT_TIMEZONE)


def _utc_iso(day: date, wall_time: time, zone: ZoneInfo) -> str:
    return datetime.combine(day, wall_time, zone).astimezone(timezone.utc).isoformat()


def _slot_applies(slot: dict[str, Any], day: date) -> bool:
    # Contract: 0=Sunday ... 6=Saturday, matching the Israeli school week.
    weekday = (day.weekday() + 1) % 7
    valid_from = _parse_date(slot.get("valid_from"))
    valid_to = _parse_date(slot.get("valid_to"))
    return (
        int(slot.get("weekday", -1)) == weekday
        and (valid_from is None or day >= valid_from)
        and (valid_to is None or day <= valid_to)
    )


def _suppressed(day_rule: dict[str, Any] | None, start_time: time) -> bool:
    if day_rule is None:
        return False
    if day_rule.get("kind") in {"holiday", "vacation", "closed"}:
        return True
    if day_rule.get("kind") == "half_day":
        closed_from = _parse_time(day_rule.get("closed_from"))
        return closed_from is not None and start_time >= closed_from
    return False


def expand_slots(
    slots: list[dict[str, Any]],
    exceptions: list[dict[str, Any]],
    school_days: list[dict[str, Any]],
    start: date,
    end: date,
    *,
    zone_name_by_school: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Pure range expansion used by both production reads and isolated tests."""
    if end < start or (end - start).days > MAX_RANGE_DAYS:
        raise ValueError("calendar_range_too_large")
    zones = zone_name_by_school or {}
    by_occurrence = {
        str(row.get("occurrence_id")): row
        for row in exceptions if row.get("occurrence_id")
    }
    day_rules = {
        (str(row.get("school_id") or ""), str(row.get("date") or "")): row
        for row in school_days if row.get("date")
    }
    occurrences: list[dict[str, Any]] = []
    current = start
    while current <= end:
        for slot in slots:
            if not _slot_applies(slot, current):
                continue
            slot_id = str(slot.get("_id") or slot.get("id") or "")
            occurrence_id = f"{slot_id}:{current.isoformat()}"
            exception = by_occurrence.get(occurrence_id) or {}
            status = "cancelled" if exception.get("kind") == "cancelled" else "upcoming"
            final_day = _parse_date(exception.get("date")) or current
            start_time = _parse_time(exception.get("start_time")) or _parse_time(slot.get("start_time"))
            end_time = _parse_time(exception.get("end_time")) or _parse_time(slot.get("end_time"))
            if start_time is None or end_time is None:
                continue
            school_id = str(slot.get("school_id") or "")
            if status != "cancelled" and _suppressed(
                day_rules.get((school_id, final_day.isoformat())), start_time,
            ):
                continue
            zone = _timezone(zones.get(school_id) or DEFAULT_TIMEZONE)
            occurrences.append({
                "id": occurrence_id,
                "kind": "lesson",
                "title": str(exception.get("title") or exception.get("subject") or slot.get("subject") or ""),
                "subject": exception.get("subject") or slot.get("subject"),
                "teacher_name": exception.get("teacher_name") or slot.get("teacher_name"),
                "start_at": _utc_iso(final_day, start_time, zone),
                "end_at": _utc_iso(final_day, end_time, zone),
                "all_day": False,
                "status": status,
                "local_date": final_day.isoformat(),
            })
        current += timedelta(days=1)
    occurrences.sort(key=lambda row: (str(row.get("start_at")), str(row.get("id"))))
    return occurrences


async def _learner_slots(learner_id: str) -> tuple[list[dict[str, Any]], dict[str, str]]:
    group_ids = set(await org.groups_for_learner(learner_id))
    if not group_ids:
        return [], {}
    slots = [row for row in await _read_collection(SLOTS) if row.get("group_id") in group_ids]
    visible: list[dict[str, Any]] = []
    for slot in slots:
        subgroup_id = slot.get("subgroup_id")
        if subgroup_id:
            subgroup = await org_repository.get_subgroup(str(subgroup_id))
            if (
                subgroup is None
                or subgroup.get("active") is False
                or subgroup.get("group_id") != slot.get("group_id")
                or learner_id not in (subgroup.get("learner_ids") or [])
            ):
                continue
        visible.append(slot)
    zones: dict[str, str] = {}
    schools = {str(row.get("_id")): row for row in await org.list_schools()}
    for slot in visible:
        school_id = str(slot.get("school_id") or "")
        if school_id:
            zones[school_id] = str((schools.get(school_id) or {}).get("timezone") or DEFAULT_TIMEZONE)
    return visible, zones


async def list_for_learner(
    learner_id: str, start: date, end: date,
) -> list[dict[str, Any]]:
    """Expand only the caller's current class/subgroup timetable for a range."""
    slots, zones = await _learner_slots(learner_id)
    if not slots:
        return []
    slot_ids = {str(row.get("_id") or row.get("id") or "") for row in slots}
    exceptions = [
        row for row in await _read_collection(EXCEPTIONS)
        if str(row.get("occurrence_id") or "").rsplit(":", 1)[0] in slot_ids
    ]
    school_ids = {str(row.get("school_id") or "") for row in slots}
    school_days = [
        row for row in await _read_collection(SCHOOL_DAYS)
        if str(row.get("school_id") or "") in school_ids
    ]
    expanded = expand_slots(
        slots, exceptions, school_days, start, end,
        zone_name_by_school=zones,
    )
    # A moved occurrence can enter the requested range from any source week.
    # Expand those source dates explicitly instead of choosing an arbitrary
    # look-behind window that fails for a month-long move.
    for exception in exceptions:
        if exception.get("kind") != "moved":
            continue
        final_day = _parse_date(exception.get("date"))
        occurrence_id = str(exception.get("occurrence_id") or "")
        source_day = _parse_date(occurrence_id.rsplit(":", 1)[-1])
        if (
            final_day is None or source_day is None
            or not start <= final_day <= end
            or start <= source_day <= end
        ):
            continue
        moved = expand_slots(
            slots, [exception], school_days, source_day, source_day,
            zone_name_by_school=zones,
        )
        expanded.extend(row for row in moved if row.get("id") == occurrence_id)
    return [
        row for row in expanded
        if (local_day := _parse_date(row.get("local_date"))) is not None
        and start <= local_day <= end
    ]