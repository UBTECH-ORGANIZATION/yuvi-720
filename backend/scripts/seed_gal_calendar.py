"""Seed or remove Gal's current- and next-week calendar demo events.

The rows use deterministic ids and a seed tag, so rerunning updates the same
events instead of duplicating them. ``--remove`` deletes only these rows.

Run:
  py scripts/seed_gal_calendar.py
  py scripts/seed_gal_calendar.py --remove
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.brain.repository import _get_collection_named  # noqa: E402
from app.core.env import ensure_env_loaded  # noqa: E402


ensure_env_loaded()

COLLECTION = "calendar_events"
LEARNER_ID = "gal"
CREATOR_ID = "gal"
SEED_TAG = "demo-gal-calendar-week"
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


def _collection():
    collection = _get_collection_named(COLLECTION)
    if collection is None:
        print("No Mongo/Cosmos connection configured; nothing was written.")
        sys.exit(1)
    return collection


async def seed() -> None:
    collection = _collection()
    events = _events()
    for event in events:
        await collection.replace_one({"_id": event["_id"]}, event, upsert=True)
    print(f"Seeded {len(events)} calendar events for {LEARNER_ID}.")
    for event in events:
        print(f"  {event['start_at'][:10]}  {event['title']}")
    print("Remove later with: py scripts/seed_gal_calendar.py --remove")


async def remove() -> None:
    result = await _collection().delete_many({"seed_tag": SEED_TAG})
    print(f"Removed {result.deleted_count} seeded calendar events.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--remove", action="store_true")
    args = parser.parse_args()
    asyncio.run(remove() if args.remove else seed())