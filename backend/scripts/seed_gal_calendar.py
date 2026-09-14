"""Seed or remove Gal's current- and next-week calendar demo events.

The rows use deterministic ids and a seed tag, so rerunning updates the same
events instead of duplicating them. ``--remove`` deletes only these rows.

Run:
  py scripts/seed_gal_calendar.py
  py scripts/seed_gal_calendar.py --remove
    py scripts/seed_gal_calendar.py --local
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.brain.repository import _get_collection_named  # noqa: E402
from app.core.env import ensure_env_loaded  # noqa: E402
from app.services import org_repository, timetable  # noqa: E402


ensure_env_loaded()

COLLECTION = "calendar_events"
LEARNER_ID = "gal"
CREATOR_ID = "gal"
SEED_TAG = "demo-gal-calendar-week"
GROUP_ID = "gal-class"
SCHOOL_ID = "school-rabin"
ISRAEL_TIMEZONE = ZoneInfo("Asia/Jerusalem")


def _week_start(today: date) -> date:
    return today - timedelta(days=(today.weekday() + 1) % 7)


def _utc_at(day: date, hour: int, minute: int = 0) -> str:
    return datetime.combine(day, time(hour, minute), ISRAEL_TIMEZONE).astimezone(
        timezone.utc
    ).isoformat()


def _events() -> list[dict]:
    today = datetime.now(ISRAEL_TIMEZONE).date()
    sunday = _week_start(today)
    today_offset = (today - sunday).days
    schedule = [
        (2, 10, 0, "תרגול מתמטיקה", "מתרגלים יחד לקראת המשימה הבאה"),
        (3, 12, 30, "מפגש מדעים", "חוזרים על מסה ונפח"),
        (4, 9, 15, "זמן ליעד האישי", "כמה דקות להתקדמות רגועה ביעד"),
        (5, 11, 0, "סיכום שבועי", "עוצרים לרגע ומסכמים את השבוע"),
        (2, 17, 0, "שיעור פרטני במדעים", "מפגש אישי לחיזוק והעמקה במדעים"),
        (3, 11, 0, "שיעור ספורט", "שיעור ספורט שבועי"),
        (4, 12, 0, "שיעור היסטוריה", "שיעור היסטוריה שבועי"),
        (9, 17, 0, "שיעור פרטני במדעים", "מפגש אישי לחיזוק והעמקה במדעים"),
        (10, 11, 0, "שיעור ספורט", "שיעור ספורט שבועי"),
        (11, 12, 0, "שיעור היסטוריה", "שיעור היסטוריה שבועי"),
        (today_offset, 17, 30, "תרגול אנגלית", "תרגול קצר של אוצר מילים"),
        (today_offset, 18, 15, "הכנה למשימת מתמטיקה", "עוברים על השלבים לפני המשימה"),
        (today_offset, 19, 0, "קריאה מודרכת", "זמן קריאה וסיכום קצר"),
        (today_offset, 19, 45, "התקדמות ביעד האישי", "צעד נוסף לקראת היעד השבועי"),
        (today_offset, 20, 30, "עבודה על פרויקט קבוצתי", "מתאמים את המשך העבודה עם הקבוצה"),
    ]
    rows = []
    for index, (day_offset, hour, minute, title, description) in enumerate(schedule, 1):
        day = sunday + timedelta(days=day_offset)
        start_at = _utc_at(day, hour, minute)
        end_at = _utc_at(day, hour, minute + 45) if minute <= 14 else _utc_at(
            day, hour + 1, minute - 15
        )
        rows.append({
            "_id": f"seed-gal-calendar-{index}",
            "title": title,
            "description": description,
            "kind": "event",
            "start_at": start_at,
            "end_at": end_at,
            "all_day": False,
            "targets": [{"kind": "learner", "id": LEARNER_ID}],
            "creator_id": CREATOR_ID,
            "creator_name": "גל",
            "active": True,
            "status": "active",
            "seed_tag": SEED_TAG,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    return rows


def _lesson_slots() -> list[dict]:
    now = datetime.now(ISRAEL_TIMEZONE).replace(second=0, microsecond=0)
    today = now.date()
    day_end = datetime.combine(today, time(23, 59), ISRAEL_TIMEZONE)
    active_end = min(now + timedelta(minutes=35), day_end)
    active_start = now - timedelta(minutes=10)
    weekday = (today.weekday() + 1) % 7
    later_days = [today + timedelta(days=offset) for offset in (1, 2, 3)]
    rows = [{
        "_id": "seed-gal-calendar-active-lesson",
        "group_id": GROUP_ID,
        "school_id": SCHOOL_ID,
        "subgroup_id": None,
        "subject": "שיעור מדעים פעיל עכשיו",
        "subject_key": "science",
        "teacher_name": "גל",
        "room": "כיתה 7",
        "weekday": weekday,
        "start_time": active_start.time().isoformat(timespec="minutes"),
        "end_time": active_end.time().isoformat(timespec="minutes"),
        "valid_from": today.isoformat(),
        "valid_to": today.isoformat(),
        "created_by": CREATOR_ID,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "active": True,
        "seed_tag": SEED_TAG,
    }]
    for index, (day, subject) in enumerate(zip(
        later_days,
        ("מתמטיקה", "היסטוריה", "אנגלית"),
    ), 1):
        rows.append({
            "_id": f"seed-gal-calendar-lesson-{index}",
            "group_id": GROUP_ID,
            "school_id": SCHOOL_ID,
            "subgroup_id": None,
            "subject": subject,
            "subject_key": subject.lower(),
            "teacher_name": "גל",
            "room": "כיתה 7",
            "weekday": (day.weekday() + 1) % 7,
            "start_time": "10:00",
            "end_time": "10:45",
            "valid_from": day.isoformat(),
            "valid_to": day.isoformat(),
            "created_by": CREATOR_ID,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "active": True,
            "seed_tag": SEED_TAG,
        })
    return rows


def _collection():
    collection = _get_collection_named(COLLECTION)
    if collection is None:
        print("No Mongo/Cosmos connection configured; skipping free calendar events.")
    return collection


async def _ensure_gal_class() -> None:
    await org_repository.upsert_school(
        SCHOOL_ID, name="בית ספר רבין, נתניה", moe_code=None, city="נתניה",
    )
    await org_repository.upsert_group(
        GROUP_ID, school_id=SCHOOL_ID, name="הכיתה של גל",
        subject="math", grade="ז", year=None,
    )
    await org_repository.enroll_learner(LEARNER_ID, GROUP_ID, school_id=SCHOOL_ID)


async def seed() -> None:
    collection = _collection()
    events = _events()
    lessons = _lesson_slots()
    await _ensure_gal_class()
    if collection is not None:
        for event in events:
            await collection.replace_one({"_id": event["_id"]}, event, upsert=True)
    for lesson in lessons:
        await timetable.save_slot(lesson)
    event_count = len(events) if collection is not None else 0
    print(f"Seeded {event_count} calendar events and {len(lessons)} lessons for {LEARNER_ID}.")
    for event in events:
        print(f"  {event['start_at'][:10]}  {event['title']}")
    print("Remove later with: py scripts/seed_gal_calendar.py --remove")


async def remove() -> None:
    collection = _collection()
    event_count = 0
    if collection is not None:
        result = await collection.delete_many({"seed_tag": SEED_TAG})
        event_count = result.deleted_count
    lesson_count = 0
    for lesson in _lesson_slots():
        if await timetable.deactivate_slot(lesson["_id"]):
            lesson_count += 1
    print(f"Removed {event_count} seeded calendar events and {lesson_count} lessons.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--remove", action="store_true")
    parser.add_argument("--local", action="store_true")
    args = parser.parse_args()
    if args.local:
        os.environ.pop("MONGODB_CONNECTION_STRING", None)
        os.environ["SPARK_STORAGE"] = "json"
    asyncio.run(remove() if args.remove else seed())