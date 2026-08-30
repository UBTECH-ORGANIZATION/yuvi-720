"""The recurring class timetable from ADO #242 — rules in, occurrences out.

Slots are school-local wall-clock rules, never materialised occurrences.
Expansion order is explicit: build the base occurrence, apply its exception,
then suppress the resulting date against the editable school calendar. A moved
lesson that lands on a holiday therefore vanishes. Cancelled occurrences stay
visible so the learner can see that the lesson is not happening.

Both lanes read through the same expansion: `list_for_learner` narrows to the
child's own class and sub-groups, `list_for_group` gives the teacher the whole
class. The write side lives here too — slot rules, per-occurrence exceptions
keyed by their natural id (`slot:date`), and the school's editable days-off
list — validated `build_*`-style like `school_calendar.build_event`, with the
same storage fallback so no environment silently loses writes.
"""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
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

#: 0=Sunday … 6=Saturday — the Israeli school week, and the same contract
#: `_slot_applies` expands with.
WEEKDAY_MIN, WEEKDAY_MAX = 0, 6
EXCEPTION_KINDS = ("cancelled", "moved")
SCHOOL_DAY_KINDS = ("holiday", "vacation", "closed", "half_day")

_FALLBACK_DIR = Path(__file__).resolve().parents[2] / ".runtime"

#: The Ministry of Education's published vacation calendar for תשפ"ז
#: (2026-27), per the official luach. NATIONAL rows: they carry an empty
#: `school_id` and apply to every school — existing and future — while any
#: school-specific row for the same date wins over them. Seeded as DATA at
#: boot (insert-if-absent), so a school can still retire or adjust a day
#: without next boot resurrecting it; next year's luach is a new list here.
#: (start, end, kind, label, closed_from)
NATIONAL_DAYS_2026_27: tuple[tuple[str, str, str, str, Optional[str]], ...] = (
    ("2026-09-11", "2026-09-13", "holiday", "ראש השנה", None),
    ("2026-09-20", "2026-09-21", "holiday", "יום כיפור", None),
    ("2026-09-25", "2026-10-03", "vacation", "סוכות", None),
    ("2026-12-06", "2026-12-12", "vacation", "חנוכה", None),
    ("2027-03-23", "2027-03-24", "holiday", "פורים", None),
    ("2027-04-13", "2027-04-28", "vacation", "פסח", None),
    ("2027-05-11", "2027-05-11", "half_day", "יום הזיכרון (יום מקוצר)", "12:00"),
    ("2027-05-12", "2027-05-12", "holiday", "יום העצמאות", None),
    ("2027-06-10", "2027-06-11", "holiday", "שבועות", None),
    ("2027-06-21", "2027-08-31", "vacation", "החופש הגדול", None),
)


class TimetableError(ValueError):
    """Validation failure with a stable, client-facing code."""


async def _read_collection(name: str) -> list[dict[str, Any]]:
    handle = _get_collection_named(name)
    if handle is None:
        # No database: the JSON fallback the write side keeps is the store.
        return [row for row in _read_fallback(name)
                if row.get("active") is not False]
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


def _day_rule(
    day_rules: dict[tuple[str, str], dict[str, Any]], school_id: str, day: str,
) -> dict[str, Any] | None:
    """The school's own rule for a date wins; the national one backs it up."""
    return day_rules.get((school_id, day)) or day_rules.get(("", day))


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
                _day_rule(day_rules, school_id, final_day.isoformat()), start_time,
            ):
                continue
            zone = _timezone(zones.get(school_id) or DEFAULT_TIMEZONE)
            occurrences.append({
                "id": occurrence_id,
                "kind": "lesson",
                "title": str(exception.get("title") or exception.get("subject") or slot.get("subject") or ""),
                "subject": exception.get("subject") or slot.get("subject"),
                "teacher_name": exception.get("teacher_name") or slot.get("teacher_name"),
                "room": exception.get("room") or slot.get("room"),
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


def _expand_range(
    slots: list[dict[str, Any]],
    exceptions: list[dict[str, Any]],
    school_days: list[dict[str, Any]],
    zones: dict[str, str],
    start: date,
    end: date,
) -> list[dict[str, Any]]:
    """Expand a range, including moves that land in it from other weeks."""
    slot_ids = {str(row.get("_id") or row.get("id") or "") for row in slots}
    exceptions = [
        row for row in exceptions
        if str(row.get("occurrence_id") or "").rsplit(":", 1)[0] in slot_ids
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


async def _school_days_for(school_ids: set[str]) -> list[dict[str, Any]]:
    # The national rows (empty school_id) apply everywhere, always.
    wanted = school_ids | {""}
    return [
        row for row in await _read_collection(SCHOOL_DAYS)
        if str(row.get("school_id") or "") in wanted
    ]


async def list_for_learner(
    learner_id: str, start: date, end: date,
) -> list[dict[str, Any]]:
    """Expand only the caller's current class/subgroup timetable for a range."""
    slots, zones = await _learner_slots(learner_id)
    if not slots:
        return []
    exceptions = await _read_collection(EXCEPTIONS)
    school_days = await _school_days_for(
        {str(row.get("school_id") or "") for row in slots})
    return _expand_range(slots, exceptions, school_days, zones, start, end)


async def list_for_group(
    group_id: str, start: date, end: date,
) -> list[dict[str, Any]]:
    """The teacher's expansion: every slot of the class, sub-group ones too.

    Each occurrence is annotated with its slot's `slot_id` and `subgroup_id`
    so the calendar can scope sub-group lessons and offer per-occurrence
    actions — the occurrence id's `slot:date` shape is a contract, but a
    reader should not need to parse it to know whose lesson this is.
    """
    slots = [
        row for row in await _read_collection(SLOTS)
        if row.get("group_id") == group_id
    ]
    if not slots:
        return []
    zones: dict[str, str] = {}
    schools = {str(row.get("_id")): row for row in await org.list_schools()}
    for slot in slots:
        school_id = str(slot.get("school_id") or "")
        if school_id:
            zones[school_id] = str(
                (schools.get(school_id) or {}).get("timezone") or DEFAULT_TIMEZONE)
    exceptions = await _read_collection(EXCEPTIONS)
    school_days = await _school_days_for(
        {str(row.get("school_id") or "") for row in slots})
    by_slot = {str(slot.get("_id") or ""): slot for slot in slots}
    occurrences = _expand_range(slots, exceptions, school_days, zones, start, end)
    for occurrence in occurrences:
        slot_id = str(occurrence.get("id") or "").rsplit(":", 1)[0]
        slot = by_slot.get(slot_id) or {}
        occurrence["slot_id"] = slot_id
        occurrence["subgroup_id"] = slot.get("subgroup_id")
        occurrence["subject_key"] = slot.get("subject_key")
    return occurrences


# ── the write side ───────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_time(value: object, code: str) -> str:
    parsed = _parse_time(value)
    if parsed is None:
        raise TimetableError(code)
    return parsed.isoformat(timespec="minutes")


def _clean_date(value: object, code: str, *, required: bool = True) -> Optional[str]:
    raw = str(value or "").strip()
    if not raw:
        if required:
            raise TimetableError(code)
        return None
    if _parse_date(raw) is None:
        raise TimetableError(code)
    return raw


def build_slot(
    data: dict[str, Any], *, group_id: str, school_id: str, teacher_id: str,
) -> dict[str, Any]:
    """Validate one weekly rule. Raises `TimetableError` with a stable code."""
    subject = str(data.get("subject") or "").strip()
    if not subject:
        raise TimetableError("subject_required")
    try:
        weekday = int(data.get("weekday"))
    except (TypeError, ValueError):
        raise TimetableError("bad_weekday")
    if not WEEKDAY_MIN <= weekday <= WEEKDAY_MAX:
        raise TimetableError("bad_weekday")
    start_time = _clean_time(data.get("start_time"), "bad_start")
    end_time = _clean_time(data.get("end_time"), "bad_end")
    if end_time <= start_time:
        raise TimetableError("end_before_start")
    valid_from = _clean_date(data.get("valid_from"), "bad_valid_from")
    valid_to = _clean_date(data.get("valid_to"), "bad_valid_to", required=False)
    if valid_to is not None and valid_to < valid_from:
        raise TimetableError("valid_to_before_from")

    return {
        "_id": f"tts-{uuid.uuid4().hex[:12]}",
        "group_id": group_id,
        "school_id": school_id,
        "subgroup_id": str(data.get("subgroup_id") or "").strip() or None,
        "subject": subject[:120],
        "subject_key": str(data.get("subject_key") or "").strip() or None,
        "teacher_name": str(data.get("teacher_name") or "").strip()[:120] or None,
        "room": str(data.get("room") or "").strip()[:120] or None,
        "weekday": weekday,
        "start_time": start_time,
        "end_time": end_time,
        "valid_from": valid_from,
        "valid_to": valid_to,
        "created_by": teacher_id,
        "created_at": _now(),
        "updated_at": _now(),
        "active": True,
    }


def build_exception(
    slot: dict[str, Any], occurrence_date: str, data: dict[str, Any],
    *, teacher_id: str,
) -> dict[str, Any]:
    """One override on one occurrence; the rule underneath stays intact.

    Keyed by the natural `slot:date` id, so a second edit of the same
    occurrence replaces the first instead of stacking.
    """
    day = _clean_date(occurrence_date, "bad_date")
    kind = str(data.get("kind") or "").strip()
    if kind not in EXCEPTION_KINDS:
        raise TimetableError("bad_kind")

    exception: dict[str, Any] = {
        "_id": f"{slot['_id']}:{day}",
        "occurrence_id": f"{slot['_id']}:{day}",
        "kind": kind,
        "note": str(data.get("note") or "").strip()[:500] or None,
        "created_by": teacher_id,
        "created_at": _now(),
        "active": True,
    }
    if kind == "moved":
        moved_date = _clean_date(data.get("date"), "bad_date", required=False)
        has_time = bool(str(data.get("start_time") or "").strip()
                        or str(data.get("end_time") or "").strip())
        if moved_date is None and not has_time:
            raise TimetableError("move_needs_target")
        if moved_date is not None:
            exception["date"] = moved_date
        if has_time:
            start_time = _clean_time(data.get("start_time"), "bad_start")
            end_time = _clean_time(data.get("end_time"), "bad_end")
            if end_time <= start_time:
                raise TimetableError("end_before_start")
            exception["start_time"] = start_time
            exception["end_time"] = end_time
    return exception


def build_school_day(
    data: dict[str, Any], *, school_id: str, teacher_id: str,
) -> dict[str, Any]:
    """One editable no-school (or short-school) day — never compiled in."""
    day = _clean_date(data.get("date"), "bad_date")
    kind = str(data.get("kind") or "").strip()
    if kind not in SCHOOL_DAY_KINDS:
        raise TimetableError("bad_kind")
    label = str(data.get("label") or "").strip()
    if not label:
        raise TimetableError("label_required")
    row: dict[str, Any] = {
        "_id": f"{school_id}:{day}",
        "school_id": school_id,
        "date": day,
        "kind": kind,
        "label": label[:120],
        "created_by": teacher_id,
        "created_at": _now(),
        "active": True,
    }
    if kind == "half_day":
        row["closed_from"] = _clean_time(data.get("closed_from"), "bad_closed_from")
    return row


# ── storage (collection first, JSON fallback second — school_calendar's rule) ─

def _fallback_path(name: str) -> Path:
    return _FALLBACK_DIR / f"{name}.json"


def _read_fallback(name: str) -> list[dict[str, Any]]:
    try:
        path = _fallback_path(name)
        if path.exists():
            rows = json.loads(path.read_text(encoding="utf-8"))
            return list(rows) if isinstance(rows, list) else []
    except (OSError, json.JSONDecodeError) as exc:
        print(f"⚠️ timetable fallback read failed for {name}: {exc}")
    return []


def _write_fallback(name: str, rows: list[dict[str, Any]]) -> None:
    try:
        path = _fallback_path(name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(rows, ensure_ascii=False, indent=2),
                        encoding="utf-8")
    except OSError as exc:
        print(f"⚠️ timetable fallback write failed for {name}: {exc}")


async def _save(name: str, row: dict[str, Any]) -> dict[str, Any]:
    collection = _get_collection_named(name)
    if collection is not None:
        try:
            await collection.update_one({"_id": row["_id"]}, {"$set": row}, upsert=True)
            return row
        except Exception as exc:
            print(f"⚠️ timetable write failed on {name}, using fallback: {type(exc).__name__}")
    rows = [held for held in _read_fallback(name) if held.get("_id") != row["_id"]]
    rows.append(row)
    _write_fallback(name, rows)
    return row


async def _get(name: str, row_id: str) -> Optional[dict[str, Any]]:
    collection = _get_collection_named(name)
    if collection is not None:
        try:
            row = await collection.find_one({"_id": row_id})
            return row if row and row.get("active") is not False else None
        except Exception as exc:
            print(f"⚠️ timetable read failed on {name}, using fallback: {type(exc).__name__}")
    return next((row for row in _read_fallback(name)
                 if row.get("_id") == row_id and row.get("active") is not False), None)


async def save_slot(slot: dict[str, Any]) -> dict[str, Any]:
    return await _save(SLOTS, slot)


async def get_slot(slot_id: str) -> Optional[dict[str, Any]]:
    return await _get(SLOTS, slot_id)


async def list_slots(group_id: str) -> list[dict[str, Any]]:
    rows = [row for row in await _read_collection(SLOTS)
            if row.get("group_id") == group_id]
    rows.sort(key=lambda row: (int(row.get("weekday") or 0),
                               str(row.get("start_time") or "")))
    return rows


async def deactivate_slot(slot_id: str) -> bool:
    """Retire a rule. Soft — the weeks it already shaped are history, and a
    rule with a `valid_to` is the polite way to end one going forward."""
    slot = await get_slot(slot_id)
    if slot is None:
        return False
    slot["active"] = False
    slot["updated_at"] = _now()
    await _save(SLOTS, slot)
    return True


async def save_exception(exception: dict[str, Any]) -> dict[str, Any]:
    return await _save(EXCEPTIONS, exception)


async def clear_exception(occurrence_id: str) -> bool:
    """Restore an occurrence to its rule."""
    row = await _get(EXCEPTIONS, occurrence_id)
    if row is None:
        return False
    row["active"] = False
    await _save(EXCEPTIONS, row)
    return True


async def list_school_days(school_id: str) -> list[dict[str, Any]]:
    """The school's own days off AND the national layer beneath them — the
    manager shows both, because both switch this school's lessons off."""
    rows = [row for row in await _read_collection(SCHOOL_DAYS)
            if str(row.get("school_id") or "") in {school_id, ""}]
    rows.sort(key=lambda row: str(row.get("date") or ""))
    return rows


async def holidays_for(
    school_ids: set[str], start: date, end: date,
) -> list[dict[str, Any]]:
    """The days off that touch a range, one row per date, school rule first.

    This is the DISPLAY read — the calendars say "ראש השנה" on the day rather
    than leaving an unexplained hole where the lessons were suppressed.
    """
    rows = await _school_days_for(school_ids)
    by_date: dict[str, dict[str, Any]] = {}
    for row in rows:
        day = str(row.get("date") or "")
        parsed = _parse_date(day)
        if parsed is None or not start <= parsed <= end:
            continue
        held = by_date.get(day)
        # A school's own rule for a date wins over the national one.
        if held is None or (str(held.get("school_id") or "") == ""
                            and str(row.get("school_id") or "") != ""):
            by_date[day] = row
    return sorted(by_date.values(), key=lambda row: str(row.get("date") or ""))


async def holidays_for_learner(
    learner_id: str, start: date, end: date,
) -> list[dict[str, Any]]:
    """The learner's days off in a range — their schools' rows plus the
    national layer, which needs no school at all."""
    school_ids: set[str] = set()
    for group_id in await org.groups_for_learner(learner_id):
        group = await org_repository.get_group(str(group_id))
        school_id = str((group or {}).get("school_id") or "")
        if school_id:
            school_ids.add(school_id)
    return await holidays_for(school_ids, start, end)


def national_rows() -> list[dict[str, Any]]:
    """The published national calendar as per-date rows, ready to store."""
    rows: list[dict[str, Any]] = []
    for start, end, kind, label, closed_from in NATIONAL_DAYS_2026_27:
        current = date.fromisoformat(start)
        last = date.fromisoformat(end)
        while current <= last:
            day = current.isoformat()
            row: dict[str, Any] = {
                "_id": f":{day}",
                "school_id": "",
                "date": day,
                "kind": kind,
                "label": label,
                "national": True,
                "created_by": "system",
                "created_at": _now(),
                "active": True,
            }
            if closed_from:
                row["closed_from"] = closed_from
            rows.append(row)
            current += timedelta(days=1)
    return rows


async def ensure_national_days() -> int:
    """Seed the national calendar, insert-if-absent — at every boot, so every
    school and every student that ever joins has it without anyone entering
    a date by hand. Absence is checked on the raw row, active or not: a day
    someone deliberately retired stays retired across boots.
    """
    collection = _get_collection_named(SCHOOL_DAYS)
    existing: set[str]
    if collection is not None:
        try:
            held = await collection.find(
                {"school_id": ""}, {"_id": 1}).to_list(length=MAX_READ)
            existing = {str(row["_id"]) for row in held}
        except Exception as exc:  # pragma: no cover - infrastructure failure
            print(f"⚠️ national days read failed: {type(exc).__name__}")
            return 0
    else:
        existing = {str(row.get("_id")) for row in _read_fallback(SCHOOL_DAYS)}
    added = 0
    for row in national_rows():
        if row["_id"] in existing:
            continue
        await _save(SCHOOL_DAYS, row)
        added += 1
    return added


async def save_school_day(row: dict[str, Any]) -> dict[str, Any]:
    return await _save(SCHOOL_DAYS, row)


async def delete_school_day(school_id: str, day: str) -> bool:
    row = await _get(SCHOOL_DAYS, f"{school_id}:{day}")
    if row is None:
        return False
    row["active"] = False
    await _save(SCHOOL_DAYS, row)
    return True


async def ensure_indexes() -> None:
    for name, keys in ((SLOTS, [("group_id", 1), ("active", 1)]),
                       (EXCEPTIONS, [("occurrence_id", 1)]),
                       (SCHOOL_DAYS, [("school_id", 1), ("date", 1)])):
        collection = _get_collection_named(name)
        if collection is None:
            continue
        try:
            await collection.create_index(keys)
        except Exception as exc:  # pragma: no cover - best effort
            print(f"⚠️ timetable index on {name}: {type(exc).__name__}")