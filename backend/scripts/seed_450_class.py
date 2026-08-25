"""Fill יובי 720 · Gal (group-gal) with a realistic 40-student class for #450.

Forty Hebrew-named learners with deliberately shaped histories, so every block
of the refactored dashboard has something true to show: all three bands with
their reasons, "new" movement chips, sub-groups, the moments album (including
the three new kinds), gaps, and check-in feelings.

Same safety rules as `seed_demo_class.py`:
1. Every document is tagged ``demo_fixture: "demo-450"`` and ``--teardown``
   deletes strictly by that tag (the pre-existing group/school are enrolled
   into, never touched).
2. Events go through the REAL ingest pipeline — mastery, detectors, timing and
   band inputs are genuinely derived, not painted on.

Usage:
    cd backend && ./.venv/bin/python scripts/seed_450_class.py --seed
    cd backend && ./.venv/bin/python scripts/seed_450_class.py --teardown
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.env import ensure_env_loaded  # noqa: E402

ensure_env_loaded()

from app.auth.passwords import hash_password  # noqa: E402
from app.auth.repository import DEFAULT_PREFERENCES, upsert_user  # noqa: E402
from app.brain.repository import (  # noqa: E402
    _get_collection_named, apply_brain_updates, get_brain,
)
from app.services import events as events_service, org_repository  # noqa: E402
from app.services.school_calendar import today_school_date  # noqa: E402

TAG = "demo-450"
GROUP = "group-gal"
SCHOOL = "school-rabin"
TEACHER = "gal"
PASSWORD = "Aa12345"

TAGGED_COLLECTIONS = (
    "users", "learners", "learner_state", "learning_events", "learner_activity",
    "daily_checkins", "moderation_events", "band_states", "org_enrollments",
    "teacher_subgroups", "mentoring_conversations", "teacher_alerts",
)

NOW = datetime.now(timezone.utc)

OBJECTIVE = "MOE.MATH.G7.NUM.COORD-SYS-A.POS-NUM.WRITE"
SUBJECT = "math"
COMPONENT = "CET.MATH.G7.NUM.COORD-SYS-A.POS-NUM.WRITE-00001"
UNIT = "CET.MATH.G7.NUM.COORD-SYS-A.POS-NUM.WRITE"
# One question several children try and few crack — the album's hard-question
# detector reads exactly this shape from the events.
HARD_QUESTION = "q7"

# ── the class ────────────────────────────────────────────────────────────────
# (id suffix, display name, shape). Shapes map to band expectations:
#   green: high / streak / improving        red: the whole red rulebook
#   orange: steady / recovering / notstarted
CAST = [
    ("01", "נועה כהן", "high"), ("02", "איתי לוי", "high"),
    ("03", "מאיה מזרחי", "high"), ("04", "יונתן פרץ", "high"),
    ("05", "תמר ביטון", "high"),
    ("06", "אורי דהן", "streak"), ("07", "שירה אברהם", "streak"),
    ("08", "עומר פרידמן", "streak"),
    ("09", "רוני שפירא", "improving"), ("10", "עדי מלכה", "improving"),
    ("11", "ליאור אזולאי", "improving"),
    ("12", "דניאל גבאי", "fail_streak"), ("13", "הילה עמר", "fail_streak"),
    ("14", "יואב ניסים", "fail_streak"),
    ("15", "אלה ברק", "inactive"), ("16", "נדב חדד", "inactive"),
    ("17", "אביגיל טל", "inactive"),
    ("18", "איילת סבן", "wheel"), ("19", "עידו רוזן", "wheel"),
    ("20", "גאיה אוחיון", "rapid"), ("21", "אלון קדוש", "rapid"),
    ("22", "מיקה שלום", "wellbeing"),
    ("23", "נטע בן־דוד", "heavy_feeling"), ("24", "אריאל צור", "heavy_feeling"),
    ("25", "שקד ימיני", "overdue_goal"), ("26", "עומרי אשכנזי", "overdue_goal"),
    ("27", "ליה מור", "blocked_message"),
    ("28", "תום אלבז", "cycling"),
    ("29", "אגם סופר", "recovering"), ("30", "ניב אדרי", "recovering"),
    ("31", "יעל שטרן", "steady"), ("32", "רועי חזן", "steady"),
    ("33", "אביב אלמוג", "steady"), ("34", "טליה נחום", "steady"),
    ("35", "אסף ברוך", "steady"), ("36", "קרן דוידוב", "steady"),
    ("37", "אלמה יוסף", "notstarted"), ("38", "בן שרעבי", "notstarted"),
    ("39", "דור עטיה", "notstarted"), ("40", "זוהר קליין", "notstarted"),
]

SUBGROUPS = {
    "חיזוק מתמטיקה": ["12", "13", "14", "18", "19", "28"],
    "מצטייני השבוע": ["01", "02", "06", "07", "09"],
    "קבוצת בוקר": ["03", "22", "23", "29", "31", "32", "37"],
}

# Six students whose band recently CHANGED — pre-seeded movement memory with a
# real previous band and a fresh changed_at, so the card's "חדש" chips light up
# deterministically on the first load.
FRESH_MOVES = {
    "09": ("green", "orange"), "12": ("red", "orange"), "22": ("red", "green"),
    "06": ("green", "orange"), "15": ("red", "orange"), "29": ("orange", "red"),
}


def lid(suffix: str) -> str:
    return f"d450-{suffix}"


def _launch(learner_id: str, *, session: str = "a") -> dict:
    return {
        "lid": learner_id, "obj": OBJECTIVE, "cmp": COMPONENT,
        "unit": UNIT, "subj": SUBJECT, "assessment": False,
        "src": "spark", "sid": f"d450-session-{learner_id}-{session}",
    }


def _statement(learner_id: str, verb: str, *, success: bool | None = None,
               hours_ago: float = 0, question: str = "q1",
               duration: str = "PT45S") -> dict:
    at = NOW - timedelta(hours=hours_ago)
    statement: dict = {
        "id": f"d450-{uuid.uuid4().hex}",
        "actor": {"account": {"name": learner_id, "homePage": "https://yuvilab.spark"}},
        "verb": {"id": f"{events_service.VERB_IRI_BASE}{verb}", "display": {"en-US": verb}},
        "object": {"id": f"{COMPONENT}/{question}"},
        "timestamp": at.isoformat(),
    }
    if success is not None:
        statement["result"] = {
            "success": success, "duration": duration,
            "score": {"scaled": 1.0 if success else 0.0},
        }
    return statement


async def _ingest(learner_id: str, verb: str, *, session: str = "a", **kwargs) -> None:
    await events_service.ingest_statement(
        _statement(learner_id, verb, **kwargs), _launch(learner_id, session=session))


async def _answers(learner_id: str, pattern: list[bool], *, start_hours_ago: float,
                   step_minutes: float = 2.0, question: str = "q1",
                   session: str = "a") -> None:
    """A sitting of answers, oldest first, spaced like a real child."""
    for index, success in enumerate(pattern):
        await _ingest(
            learner_id, "answered", success=success, session=session,
            hours_ago=start_hours_ago - (index * step_minutes) / 60,
            question=question,
        )


async def _checkin(learner_id: str, date_key: str, valence: str | None,
                   feeling: str | None) -> None:
    handle = _get_collection_named("daily_checkins")
    if handle is None:
        return
    await handle.update_one(
        {"_id": f"checkin:{learner_id}:{date_key}"},
        {"$set": {
            "learner_id": learner_id, "date_key": date_key, "valence": valence,
            "feeling": feeling, "status": "felt" if valence else "skipped",
            "demo_fixture": TAG,
        }},
        upsert=True,
    )


# ── shapes ───────────────────────────────────────────────────────────────────

async def shape_high(learner_id: str) -> None:
    """Green by mastery: many correct answers → high EWMA + confidence."""
    await _answers(learner_id, [True] * 8, start_hours_ago=30)
    await _answers(learner_id, [True, True, False, True, True],
                   start_hours_ago=6, session="b")


async def shape_streak(learner_id: str) -> None:
    """Green by streak — and a personal-best photo: six active days in a row."""
    for day in range(6):
        await _answers(learner_id, [True, day % 2 == 0, True],
                       start_hours_ago=(5 - day) * 24 + 3, session=f"day{day}")


async def shape_improving(learner_id: str) -> None:
    """Green by week-over-week: a rough week, then a much better one."""
    await _answers(learner_id, [False, False, True, False, False],
                   start_hours_ago=11 * 24, session="w1")
    await _answers(learner_id, [True, True, False, True, True, True],
                   start_hours_ago=2 * 24, session="w2")


async def shape_fail_streak(learner_id: str) -> None:
    await _answers(learner_id, [True, False, False, False, False],
                   start_hours_ago=4)


async def shape_inactive(learner_id: str) -> None:
    """Red by absence: real work, eight days ago, nothing since."""
    await _answers(learner_id, [True, False, True, True],
                   start_hours_ago=8 * 24)


async def shape_wheel(learner_id: str) -> None:
    """Red by wheel-spinning: many effortful attempts, no mastery anywhere."""
    pattern = [False, True, False, False, True, False, False, False, True, False, False]
    await _answers(learner_id, pattern, start_hours_ago=20)


async def shape_rapid(learner_id: str) -> None:
    """Red by rapid guessing: sub-2s answers in the latest sitting."""
    await _answers(learner_id, [True, False], start_hours_ago=26)
    for index in range(4):
        await _ingest(learner_id, "answered", success=False, session="rush",
                      hours_ago=2 - index * 0.02, duration="PT1S")


async def shape_wellbeing(learner_id: str) -> None:
    """Red by an open distress flag, plus normal-looking work."""
    await _answers(learner_id, [True, False, True], start_hours_ago=8)
    await apply_brain_updates(learner_id, {"wellbeing_flags": [{
        "id": f"wb-{learner_id}", "category": "distress",
        "evidence": "אמרתי ליובי שקשה לי מאוד בבית",
        "source": "coach_chat", "at": (NOW - timedelta(hours=5)).isoformat(),
        "resolved": False,
    }]})


async def shape_heavy_feeling(learner_id: str) -> None:
    """Red by today's check-in; yesterday's heavy day had learning after it —
    which is exactly the feelings-journey photo."""
    await _answers(learner_id, [True, True, False, True], start_hours_ago=26)
    await _answers(learner_id, [True, False], start_hours_ago=3, session="today")
    today = today_school_date()
    yesterday = (datetime.fromisoformat(today) - timedelta(days=1)).date().isoformat()
    await _checkin(learner_id, yesterday, "uneasy", "worried")
    await _checkin(learner_id, today, "upset", "sad")
    await apply_brain_updates(learner_id, {"current_state.daily_feeling": {
        "valence": "upset", "feeling": "sad", "date": today, "at": NOW.isoformat(),
    }})


async def shape_overdue_goal(learner_id: str) -> None:
    await _answers(learner_id, [True, False, True], start_hours_ago=30)
    await apply_brain_updates(learner_id, {"goals": [{
        "id": f"goal-{learner_id}", "conversation_id": f"conv-{learner_id}",
        "text": "לסיים את יחידת מערכת הצירים", "next_steps": "",
        "deadline": (NOW - timedelta(days=3)).date().isoformat(),
        "source": "teacher", "status": "open", "progress_stage": "in_progress",
        "from_yuvi": False, "needs_help": False,
    }]})


async def shape_blocked_message(learner_id: str) -> None:
    await _answers(learner_id, [True, True, False], start_hours_ago=10)
    handle = _get_collection_named("moderation_events")
    if handle is not None:
        await handle.insert_one({
            "_id": f"mod_d450_{learner_id}", "user_id": learner_id,
            "content": "", "context": "direct_message", "category": "harassment",
            "source": "learner", "action_taken": "blocked",
            "created_at": (NOW - timedelta(days=1)).isoformat(),
            "demo_fixture": TAG,
        })


async def shape_cycling(learner_id: str) -> None:
    """Red by answer cycling: fast identical wrong answers, back to back."""
    for index in range(4):
        await _ingest(learner_id, "answered", success=False, session="loop",
                      hours_ago=5 - index * 0.02, duration="PT3S")


async def shape_recovering(learner_id: str) -> None:
    """Orange, with a recovery photo: two failures, then the win."""
    await _answers(learner_id, [False, False, True], start_hours_ago=7)


async def shape_steady(learner_id: str) -> None:
    await _answers(learner_id, [True, False, True, False],
                   start_hours_ago=2 * 24)


async def shape_notstarted(_learner_id: str) -> None:
    """Orange with 'אין מספיק נתונים' — enrolled, never seen."""


SHAPES = {
    "high": shape_high, "streak": shape_streak, "improving": shape_improving,
    "fail_streak": shape_fail_streak, "inactive": shape_inactive,
    "wheel": shape_wheel, "rapid": shape_rapid, "wellbeing": shape_wellbeing,
    "heavy_feeling": shape_heavy_feeling, "overdue_goal": shape_overdue_goal,
    "blocked_message": shape_blocked_message, "cycling": shape_cycling,
    "recovering": shape_recovering, "steady": shape_steady,
    "notstarted": shape_notstarted,
}


async def _hard_question_round() -> None:
    """Five children try the hard question; one green student cracks it."""
    for suffix in ("12", "13", "18", "31"):
        await _ingest(lid(suffix), "answered", success=False, session="hardq",
                      hours_ago=28, question=HARD_QUESTION)
    await _ingest(lid("01"), "answered", success=True, session="hardq",
                  hours_ago=25, question=HARD_QUESTION)


async def _goal_done() -> None:
    """One finished goal → an album photo in the goals chapter."""
    await apply_brain_updates(lid("02"), {"goals": [{
        "id": "goal-d450-02", "conversation_id": "conv-d450-02",
        "text": "לתרגל שיעורי נקודה שלושה ימים ברצף", "title": "תרגול שיעורי נקודה",
        "next_steps": "", "deadline": "", "source": "teacher", "status": "done",
        "progress_stage": "summarized",
        "summarized_at": (NOW - timedelta(days=2)).isoformat(),
        "from_yuvi": False, "needs_help": False, "approved_by": TEACHER,
    }]})


async def _checkin_spread() -> None:
    """A believable spread of feelings across the class this week."""
    today = today_school_date()
    base = datetime.fromisoformat(today)
    moods = [("01", "great", "proud"), ("02", "good", "curious"),
             ("03", "good", "calm"), ("06", "great", "excited"),
             ("09", "good", "hopeful"), ("12", "okay", "tired"),
             ("13", "uneasy", "confused"), ("29", "okay", "fine"),
             ("31", "good", "grateful"), ("32", "okay", "bored"),
             ("18", "uneasy", "overwhelmed")]
    for suffix, valence, feeling in moods:
        await _checkin(lid(suffix), today, valence, feeling)
        await apply_brain_updates(lid(suffix), {"current_state.daily_feeling": {
            "valence": valence, "feeling": feeling, "date": today,
            "at": NOW.isoformat(),
        }})
    # a little history for the profile strips
    for back in (1, 2, 3):
        day = (base - timedelta(days=back)).date().isoformat()
        for suffix in ("01", "06", "12", "31"):
            await _checkin(lid(suffix), day, "good" if back % 2 else "okay",
                           "calm" if back % 2 else "fine")


async def _fresh_moves() -> None:
    handle = _get_collection_named("band_states")
    if handle is None:
        return
    for suffix, (band, previous) in FRESH_MOVES.items():
        await handle.update_one(
            {"_id": lid(suffix)},
            {"$set": {"band": band, "previous": previous,
                      "changed_at": (NOW - timedelta(hours=3)).isoformat(),
                      "demo_fixture": TAG}},
            upsert=True,
        )


async def _subgroups() -> None:
    from app.services import subgroups

    existing = {row["name"] for row in await subgroups.list_for_group(TEACHER, GROUP)}
    for name, suffixes in SUBGROUPS.items():
        if name in existing:
            continue
        created = await subgroups.create(
            TEACHER, GROUP, name=name, learner_ids=[lid(s) for s in suffixes])
        handle = _get_collection_named("teacher_subgroups")
        if handle is not None:
            await handle.update_one(
                {"_id": created.get("id")}, {"$set": {"demo_fixture": TAG}})


async def _backdate() -> None:
    handle = _get_collection_named("learning_events")
    if handle is None:
        return
    moved = 0
    ids = [lid(s) for s, _n, _sh in CAST]
    async for event in handle.find({"learner_id": {"$in": ids}}):
        occurred = event.get("occurred_at")
        if occurred and event.get("stored_at") != occurred:
            await handle.update_one({"_id": event["_id"]},
                                    {"$set": {"stored_at": occurred}})
            moved += 1
    print(f"🕒 backdated stored_at on {moved} events")


async def _tag(collection: str, query: dict) -> None:
    handle = _get_collection_named(collection)
    if handle is None:
        return
    await handle.update_many(query, {"$set": {"demo_fixture": TAG}})


async def seed() -> None:
    await org_repository.ensure_indexes()
    for suffix, name, shape in CAST:
        learner_id = lid(suffix)
        await upsert_user({
            "_id": learner_id, "username": learner_id, "display_name": name,
            "roles": ["learner"], "password": hash_password(PASSWORD),
            "preferences": {**DEFAULT_PREFERENCES, "language": "he"},
        })
        await get_brain(learner_id)
        await apply_brain_updates(learner_id, {
            "identity.display_name": name, "identity.locale": "he",
        })
        await org_repository.enroll_learner(learner_id, GROUP, school_id=SCHOOL)
        await SHAPES[shape](learner_id)
        print(f"👤 {learner_id} {name:12s} {shape}")

    await _hard_question_round()
    await _goal_done()
    await _checkin_spread()
    await _fresh_moves()
    await _subgroups()
    await _backdate()

    ids = [lid(s) for s, _n, _sh in CAST]
    await _tag("users", {"_id": {"$in": ids}})
    await _tag("learners", {"_id": {"$in": ids}})
    await _tag("learner_state", {"_id": {"$in": ids}})
    await _tag("learning_events", {"learner_id": {"$in": ids}})
    await _tag("learner_activity", {"learner_id": {"$in": ids}})
    await _tag("org_enrollments", {"learner_id": {"$in": ids}})
    print(f"\n✅ seeded {len(CAST)} learners into {GROUP} (tag {TAG!r})")


async def teardown() -> None:
    total = 0
    for collection in TAGGED_COLLECTIONS:
        handle = _get_collection_named(collection)
        if handle is None:
            continue
        result = await handle.delete_many({"demo_fixture": TAG})
        if result.deleted_count:
            print(f"🧹 {collection}: {result.deleted_count}")
            total += result.deleted_count
    print(f"✅ removed {total} documents tagged {TAG!r}")


def main() -> None:
    parser = argparse.ArgumentParser()
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--seed", action="store_true")
    action.add_argument("--teardown", action="store_true")
    args = parser.parse_args()

    async def run() -> None:
        if args.seed:
            await seed()
        else:
            await teardown()

    asyncio.run(run())


if __name__ == "__main__":
    main()
