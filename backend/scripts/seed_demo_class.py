"""Disposable demo class — seed, exercise, tear down.

The teacher mechanics are invisible on the two-account seed roster: a single
learner cannot produce a "30% of the group struggles" gap, an engagement
percentage, or a meaningful attention inbox. This builds a class with
*deliberately shaped* histories so every F6 surface has something real to show.

Two rules make it safe to run against a live database:

1. **Every document is tagged** ``demo_fixture: "<tag>"`` and ``--teardown``
   deletes strictly by that tag. Nothing else is ever touched.
2. **Events go through the real ingest pipeline** (`events.ingest_statement`),
   not direct inserts — so mastery, detectors, timing evidence and brain
   rollups are genuinely derived. A fixture that bypasses the pipeline would
   prove nothing about the pipeline.

Usage:
    cd backend && ./.venv/bin/python scripts/seed_demo_class.py --seed
    cd backend && ./.venv/bin/python scripts/seed_demo_class.py --report
    cd backend && ./.venv/bin/python scripts/seed_demo_class.py --teardown --verify-clean
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

TAG = "demo-720-a"
SCHOOL = "demo-school"
GROUP = "demo-group-a"
TEACHERS = ("demo-teacher-1", "demo-teacher-2")   # co-taught on purpose
PASSWORD = "Aa12345"

# Collections the fixture writes into. Teardown sweeps exactly these.
TAGGED_COLLECTIONS = (
    "users", "learners", "learner_state", "learning_events", "learner_activity",
    "mentoring_conversations", "learner_wallet", "reward_ledger", "notifications",
    "teacher_alerts", "learner_presence", "teacher_insights",
    "org_schools", "org_groups", "org_teacher_links", "org_enrollments", "org_audit",
)

# Deterministic clock — no Date.now() drift between runs, so two seedings of the
# same fixture produce the same evidence and diffs stay readable.
NOW = datetime(2026, 8, 3, 9, 0, tzinfo=timezone.utc)

# ── the cast ─────────────────────────────────────────────────────────────────
# Each learner exists to light up exactly one teacher-facing signal.
LEARNERS = [
    {"id": "demo-ari",   "name": "Ari",   "shape": "high"},
    {"id": "demo-bat",   "name": "Bat",   "shape": "high"},
    {"id": "demo-gil",   "name": "Gil",   "shape": "high"},
    {"id": "demo-dana",  "name": "Dana",  "shape": "inactive"},
    {"id": "demo-eyal",  "name": "Eyal",  "shape": "inactive"},
    {"id": "demo-hila",  "name": "Hila",  "shape": "fail_streak"},
    {"id": "demo-omer",  "name": "Omer",  "shape": "fail_streak"},
    {"id": "demo-roni",  "name": "Roni",  "shape": "wheel_spinning"},
    {"id": "demo-shir",  "name": "Shir",  "shape": "rapid_guess"},
    {"id": "demo-tal",   "name": "Tal",   "shape": "wellbeing"},
    {"id": "demo-yael",  "name": "Yael",  "shape": "miscalibrated"},
    {"id": "demo-zohar", "name": "Zohar", "shape": "goal_pending"},
]

# A single objective most of the class struggles with, so `learning_gaps` fires
# on real evidence rather than on a hand-written row.
#
# These are REAL catalog ids, deliberately: `learning_gaps` walks
# `kata_catalog.objectives_for(subject)`, so an invented objective is invisible
# to the group analytics no matter how much evidence sits behind it.
SHARED_OBJECTIVE = "MOE.MATH.G7.NUM.COORD-SYS-A.POS-NUM.WRITE"
SHARED_SUBJECT = "math"
SHARED_COMPONENT = "CET.MATH.G7.NUM.COORD-SYS-A.POS-NUM.WRITE-00001"
SHARED_UNIT = "demo-unit-numbers"

# Realistic spacing. Gaps beyond PROLONGED_INTERACTION_SECONDS trip the
# slow-progress flag, so a fixture with 10-minute gaps flags the whole class and
# tells you nothing.
STEP_SECONDS = 1.0                 # minutes between events within a sitting


def _launch(learner_id: str, *, objective_id: str = SHARED_OBJECTIVE,
            component_id: str = SHARED_COMPONENT) -> dict:
    """The decoded launch payload `ingest_statement` expects.

    `src="spark"` keeps us out of `PROVIDER_SOURCES`, so the provider-scope
    check short-circuits and the fixture doesn't have to fake Kata ids.
    """
    return {
        "lid": learner_id, "obj": objective_id, "cmp": component_id,
        "unit": SHARED_UNIT, "subj": SHARED_SUBJECT, "assessment": False,
        "src": "spark", "sid": f"demo-session-{learner_id}",
    }


def _statement(learner_id: str, verb: str, *, success: bool | None = None,
               minutes_ago: float = 0, question: str = "q1",
               component_id: str = SHARED_COMPONENT, duration: str = "PT45S") -> dict:
    at = NOW - timedelta(minutes=minutes_ago)
    statement: dict = {
        "id": f"demo-{uuid.uuid4().hex}",
        "actor": {"account": {"name": learner_id, "homePage": "https://yuvilab.spark"}},
        # MoE-native verb IRI. The ADL vocabulary is only translated for
        # `PROVIDER_SOURCES`, and this fixture reports as `spark`.
        "verb": {"id": f"{events_service.VERB_IRI_BASE}{verb}", "display": {"en-US": verb}},
        "object": {"id": f"{component_id}/{question}"},
        "timestamp": at.isoformat(),
    }
    if success is not None:
        statement["result"] = {
            "success": success,
            "duration": duration,
            "score": {"scaled": 1.0 if success else 0.0},
        }
    return statement


async def _ingest(learner_id: str, verb: str, **kwargs) -> None:
    await events_service.ingest_statement(
        _statement(learner_id, verb, **kwargs),
        _launch(learner_id, component_id=kwargs.get("component_id", SHARED_COMPONENT)),
    )


async def _backdate_events(learner_ids: list[str]) -> None:
    """Align `stored_at` with `occurred_at` for the fixture's events.

    `stored_at` is stamped server-side at ingest, and `insights._days_since`
    measures inactivity from it — correctly, since a client clock must not be
    able to fake recency. That means a backdated fixture would otherwise look
    like it all happened this second, and the inactivity criterion could never
    be demonstrated. Rewriting it afterwards is fixture surgery on the timestamp
    only; every derived value (mastery, detectors, timing) still came out of the
    real pipeline.
    """
    handle = _get_collection_named("learning_events")
    if handle is None:
        return
    moved = 0
    async for event in handle.find({"learner_id": {"$in": learner_ids}}):
        occurred = event.get("occurred_at")
        if occurred and event.get("stored_at") != occurred:
            await handle.update_one({"_id": event["_id"]}, {"$set": {"stored_at": occurred}})
            moved += 1
    print(f"🕒 backdated stored_at on {moved} events")


async def _tag(collection: str, query: dict) -> None:
    handle = _get_collection_named(collection)
    if handle is None:
        return
    await handle.update_many(query, {"$set": {"demo_fixture": TAG}})


# ── shapes ───────────────────────────────────────────────────────────────────

async def _shape_high(learner_id: str) -> None:
    # `minutes_ago` DESCENDS so events are ingested in chronological order —
    # otherwise the timing evidence is computed against a "previous" event that
    # actually happened later, and every gap comes out negative.
    for index in range(4):
        await _ingest(learner_id, "answered", success=True,
                      minutes_ago=60 * 24 - index * STEP_SECONDS, question=f"q{index + 1}")
    await _ingest(learner_id, "completed", success=True, minutes_ago=60 * 20)


async def _shape_inactive(learner_id: str) -> None:
    """Activity, then nothing for well past INACTIVITY_DAYS (6)."""
    for index in range(2):
        await _ingest(learner_id, "answered", success=True,
                      minutes_ago=60 * 24 * 9 - index * STEP_SECONDS, question=f"q{index + 1}")


async def _shape_fail_streak(learner_id: str) -> None:
    """Trailing consecutive failures — the LOW_SUCCESS_STREAK criterion."""
    await _ingest(learner_id, "answered", success=True, minutes_ago=400, question="q1")
    for index in range(3):
        await _ingest(learner_id, "answered", success=False,
                      minutes_ago=120 - index * STEP_SECONDS, question=f"q{index + 2}")


async def _shape_wheel_spinning(learner_id: str) -> None:
    """Many effortful opportunities on one objective, never mastered.

    12 attempts: `wheel_spinning_state` needs >=10 opportunities without a
    3-success streak before it calls it spinning.
    """
    for index in range(12):
        await _ingest(learner_id, "answered", success=False,
                      minutes_ago=300 - index * STEP_SECONDS, question=f"q{index + 1}")


async def _shape_rapid_guess(learner_id: str) -> None:
    """Sub-threshold response times → `effortful: False` via the detector."""
    for index in range(5):
        await _ingest(learner_id, "answered", success=False, duration="PT1S",
                      minutes_ago=60 - index * STEP_SECONDS, question=f"q{index + 1}")


async def _shape_wellbeing(learner_id: str) -> None:
    await _ingest(learner_id, "answered", success=False, minutes_ago=90)
    brain = await get_brain(learner_id)
    await apply_brain_updates(learner_id, {
        "wellbeing_flags": [{
            "evidence": "אמר/ה שהוא/היא מרגיש/ה שלא שייך/ת לכיתה",
            "at": (NOW - timedelta(hours=2)).isoformat(),
            "source": "coach", "category": "distress", "resolved": False,
        }],
        "goals": list(brain.get("goals") or []) + [
            {"id": "demo-goal-help", "text": "לבקש עזרה כשנתקעים",
             "source": "self", "status": "started", "needs_help": True,
             "visible_to_learner": True},
        ],
    })


async def _shape_miscalibrated(learner_id: str) -> None:
    """Self-rating far above the evidence → the self-vs-system card."""
    await _ingest(learner_id, "answered", success=False, minutes_ago=200, question="q1")
    await _ingest(learner_id, "answered", success=False,
                  minutes_ago=200 - STEP_SECONDS, question="q2")
    await apply_brain_updates(learner_id, {
        "reflections_recent": [{
            "self_rating": 5, "system_estimate": 0.2,
            "at": (NOW - timedelta(hours=3)).isoformat(),
        }],
    })


async def _shape_goal_pending(learner_id: str) -> None:
    """A goal past its deadline — the overdue-goal attention criterion."""
    await _ingest(learner_id, "answered", success=True, minutes_ago=300)
    await apply_brain_updates(learner_id, {
        "goals": [{
            "id": "demo-goal-overdue", "text": "לסיים את תרגול השברים",
            "source": "self", "status": "started",
            "deadline": (NOW - timedelta(days=4)).date().isoformat(),
            "visible_to_learner": True,
        }],
    })


SHAPES = {
    "high": _shape_high, "inactive": _shape_inactive, "fail_streak": _shape_fail_streak,
    "wheel_spinning": _shape_wheel_spinning, "rapid_guess": _shape_rapid_guess,
    "wellbeing": _shape_wellbeing, "miscalibrated": _shape_miscalibrated,
    "goal_pending": _shape_goal_pending,
}


# ── seed / teardown ──────────────────────────────────────────────────────────

async def seed() -> None:
    await org_repository.ensure_indexes()

    await org_repository.upsert_school(SCHOOL, name="בית ספר הדגמה", city="הדגמה")
    await org_repository.upsert_group(
        GROUP, school_id=SCHOOL, name="כיתה ז׳ · הדגמה", subject=SHARED_SUBJECT, grade="ז"
    )

    for teacher_id in TEACHERS:
        await upsert_user({
            "_id": teacher_id, "username": teacher_id,
            "display_name": teacher_id.replace("demo-teacher-", "מורה "),
            "roles": ["teacher"], "password": hash_password(PASSWORD),
            "preferences": {**DEFAULT_PREFERENCES, "language": "he"},
        })
        await org_repository.link_teacher(teacher_id, GROUP, school_id=SCHOOL)
        print(f"🔗 {teacher_id} co-teaches {GROUP}")

    for learner in LEARNERS:
        await upsert_user({
            "_id": learner["id"], "username": learner["id"],
            "display_name": learner["name"], "roles": ["learner"],
            "password": hash_password(PASSWORD),
            "preferences": {**DEFAULT_PREFERENCES, "language": "he"},
        })
        await get_brain(learner["id"])
        await apply_brain_updates(learner["id"], {
            "identity.display_name": learner["name"], "identity.locale": "he",
        })
        await org_repository.enroll_learner(learner["id"], GROUP, school_id=SCHOOL)
        await SHAPES[learner["shape"]](learner["id"])
        print(f"👤 {learner['id']:14s} {learner['shape']}")

    await _backdate_events([learner["id"] for learner in LEARNERS])

    # Tag everything the fixture created so teardown is surgical.
    ids = [learner["id"] for learner in LEARNERS] + list(TEACHERS)
    await _tag("users", {"_id": {"$in": ids}})
    await _tag("learners", {"_id": {"$in": ids}})
    await _tag("learner_state", {"_id": {"$in": ids}})
    await _tag("learning_events", {"learner_id": {"$in": ids}})
    await _tag("learner_activity", {"learner_id": {"$in": ids}})
    await _tag("org_schools", {"_id": SCHOOL})
    await _tag("org_groups", {"_id": GROUP})
    await _tag("org_teacher_links", {"group_id": GROUP})
    await _tag("org_enrollments", {"group_id": GROUP})
    print(f"\n✅ seeded fixture {TAG!r}: {len(LEARNERS)} learners, "
          f"{len(TEACHERS)} co-teachers, group {GROUP}")


async def teardown(verify: bool = False) -> None:
    total = 0
    for collection in TAGGED_COLLECTIONS:
        handle = _get_collection_named(collection)
        if handle is None:
            continue
        result = await handle.delete_many({"demo_fixture": TAG})
        if result.deleted_count:
            print(f"🧹 {collection:24s} {result.deleted_count}")
        total += result.deleted_count
    print(f"\n🧹 removed {total} tagged documents")

    if verify:
        leftovers = {}
        for collection in TAGGED_COLLECTIONS:
            handle = _get_collection_named(collection)
            if handle is None:
                continue
            count = await handle.count_documents({"demo_fixture": TAG})
            if count:
                leftovers[collection] = count
        # Also prove nothing real was swept: the two production accounts must
        # still be here. A teardown that took a real learner with it is the
        # failure mode worth failing loudly on.
        users = _get_collection_named("users")
        survivors = [uid for uid in ("gal", "moti")
                     if users is not None and await users.find_one({"_id": uid})]
        if leftovers:
            print(f"❌ leftovers: {leftovers}")
            sys.exit(1)
        if users is not None and len(survivors) < 2:
            print(f"❌ real accounts missing after teardown: {survivors}")
            sys.exit(1)
        print(f"✅ verify-clean: 0 tagged docs remain; real accounts intact {survivors}")


async def report() -> None:
    """What the teacher surfaces actually produce for this fixture."""
    from app.services import group_analytics, insights

    engagement = await group_analytics.engagement(GROUP)
    print(f"\n── engagement ({engagement['window_days']}d) ──")
    print(f"  active {engagement['active_students']}/{engagement['students_total']} "
          f"({engagement['active_pct']}%)  avg_minutes={engagement['avg_active_minutes']} "
          f"timing_available={engagement['timing_available']}")

    gaps = await group_analytics.learning_gaps(GROUP)
    print(f"\n── learning gaps ({len(gaps)}) ──")
    for gap in gaps[:5]:
        print(f"  {gap['kind']:8s} {gap['label'][:40]:40s} "
              f"struggling={gap['struggling_count']}/{gap['with_evidence']} "
              f"share={gap['struggle_share']}")
    for recommendation in group_analytics.group_recommendations(gaps):
        print(f"  → {recommendation['action']}: {recommendation['text']}")

    view = await insights.group_insights(GROUP, "he")
    flagged = view["attention"]
    print(f"\n── attention inbox ({len(flagged)}/{view['trends']['students_total']}) ──")
    for row in flagged:
        print(f"  {row['display_name']:8s} {row.get('kind','?'):16s} {row.get('evidence','')[:50]}")

    print("\n── per-student flags ──")
    for learner in LEARNERS:
        student = await insights.student_insights(learner["id"], "he")
        kinds = [flag["kind"] for flag in student["attention_all"]]
        categories = [r["category"] for r in student["recommendations"]]
        print(f"  {learner['name']:6s} ({learner['shape']:14s}) flags={kinds or '—'} recs={categories}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed / tear down the demo class")
    parser.add_argument("--seed", action="store_true")
    parser.add_argument("--report", action="store_true")
    parser.add_argument("--teardown", action="store_true")
    parser.add_argument("--verify-clean", action="store_true")
    args = parser.parse_args()

    if not (args.seed or args.report or args.teardown):
        parser.error("pass --seed, --report or --teardown")

    async def run() -> None:
        if args.seed:
            await seed()
        if args.report:
            await report()
        if args.teardown:
            await teardown(verify=args.verify_clean)

    asyncio.run(run())


if __name__ == "__main__":
    main()
