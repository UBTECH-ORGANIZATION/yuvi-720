"""Two months of feelings and activity for יובי 720 · Gal (group-gal).

The dashboard's period control reads over a day, three days, a week or a month,
and compares each window to the one before it. That needs sixty days of history
to be worth looking at — with the seeded class as it stands, the monthly view's
comparison window is empty and the mood KPI has too few answers to say anything.

What it writes, and only this:

  * ``daily_checkins`` — one row per learner per school day, at a realistic
    response rate, with a mood arc across the two months so the class visibly
    has a harder fortnight and comes out of it. Weekends (Fri/Sat in Israel)
    are left alone, because a check-in is asked on a school day.
  * ``learning_events`` — answered questions with real inter-event timing, in
    per-learner rhythms, so engagement share, average active minutes, the
    per-day series and the week-over-week trend all have something true to sum.

  * ``mastery`` entries in the Learner Brain — but ONLY with ``--with-brain``,
    and only for a learner who has no entry on that objective yet. This is what
    the gaps card reads, and without it that card is empty in every window.

**About the brain.** Events are written directly rather than pushed through
`events.ingest_statement`, so no detector, misconception or band input is
invented as a side effect. Mastery is the one brain field this will write, it
is off by default, it never overwrites an existing entry, and every pair it
creates is recorded so ``--teardown`` removes exactly those and nothing else.
A real child's own record is therefore never edited or deleted by this script.

**Why the gaps card looked broken.** The Kata catalogue currently holds FIVE
objectives in total (one maths, one AI, three science). A group gap needs two
learners with evidence on the same objective inside the window, so an empty
card was mostly a content problem, not an analytics one. Each seeded objective
therefore spreads its learners across every recency band, so the same five
objectives have evidence inside the day, three-day, week and month windows —
and inside each of those windows' comparison halves too.

Same safety rules as the other seeders:
  1. Every document is tagged ``demo_fixture: "gal-history"`` and ``--teardown``
     deletes strictly by that tag.
  2. Writes are keyed deterministically, so re-running replaces rather than
     duplicates.
  3. Scope is the roster of ``group-gal``, resolved at run time. It cannot
     reach a learner who is not in that class.

Usage:
    cd backend && ./.venv/bin/python scripts/seed_gal_history.py --plan
    cd backend && ./.venv/bin/python scripts/seed_gal_history.py --seed
    cd backend && ./.venv/bin/python scripts/seed_gal_history.py --teardown
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.env import ensure_env_loaded  # noqa: E402

ensure_env_loaded()

from app.brain.repository import _get_collection_named  # noqa: E402
from app.brain.org import learners_in_group  # noqa: E402

TAG = "gal-history"
GROUP = "group-gal"
DAYS = 60

# The five valence families, best to hardest (`checkin_flow.VALENCE_FEELINGS`).
FEELINGS = {
    "great":  ("proud", "excited", "valued", "joyful", "confident"),
    "good":   ("calm", "curious", "hopeful", "satisfied", "grateful"),
    "okay":   ("fine", "tired", "bored", "indifferent", "distracted"),
    "uneasy": ("worried", "anxious", "confused", "overwhelmed", "embarrassed"),
    "upset":  ("frustrated", "angry", "sad", "lonely", "discouraged"),
}
VALENCES = list(FEELINGS)

# A handful of real objectives from the maths catalogue, so the events carry
# plausible ids rather than invented keys.
OBJECTIVES = [
    ("MOE.MATH.G7.NUM.COORD-SYS-A.POS-NUM.WRITE", "math"),
    ("MOE.MATH.G7.NUM.FRACTIONS.COMPARE", "math"),
    ("MOE.MATH.G7.ALG.LINEAR-EQ.SOLVE", "math"),
    ("MOE.HEB.G7.READ.COMPREHENSION.INFER", "hebrew"),
]


def _rng(*parts: str) -> random.Random:
    """A generator seeded from the inputs, so a re-run writes the same history.

    Not `random.seed()` globally: two learners must not share a stream, and the
    script has to be reproducible for the same reason it is upserted — running
    it twice is a correction, not a second class.
    """
    digest = hashlib.sha256("|".join(parts).encode()).hexdigest()
    return random.Random(int(digest[:16], 16))


def _school_days(days: int) -> list[datetime]:
    """Every school day in the window, oldest first.

    Friday and Saturday are the Israeli weekend; a check-in is not asked then
    and almost nobody studies, so seeding them would flatten exactly the weekly
    rhythm the per-day series is supposed to show.
    """
    today = datetime.now(timezone.utc).replace(hour=12, minute=0, second=0, microsecond=0)
    out = []
    for back in range(days - 1, -1, -1):
        day = today - timedelta(days=back)
        if day.weekday() in (4, 5):        # Fri, Sat
            continue
        out.append(day)
    return out


def _mood_bias(day_index: int, total: int) -> float:
    """The class's arc across the two months, as a shift toward the hard end.

    Deliberately not flat and not random: a mood KPI is only worth building if
    a teacher can see a change in it, so the middle of the window is a harder
    fortnight the class then comes out of. 0.0 is an ordinary week; 1.0 is the
    bottom of the dip.
    """
    position = day_index / max(1, total - 1)
    # A single trough around the 55% mark, tapering either side.
    return max(0.0, 1.0 - abs(position - 0.55) / 0.22)


def _valence_for(rng: random.Random, personality: float, bias: float) -> str:
    """One child's answer on one day.

    `personality` is that child's own baseline (some children mostly answer
    "good", some mostly "okay"); `bias` is the class-wide arc. Both move the
    same draw, so an individual stays recognisably themselves while the room
    moves together.
    """
    weights = [
        0.16 * (1 - bias) * personality,        # great
        0.34 * (1 - 0.5 * bias) * personality,  # good
        0.30,                                   # okay
        0.14 + 0.30 * bias,                     # uneasy
        0.06 + 0.24 * bias,                     # upset
    ]
    return rng.choices(VALENCES, weights=weights)[0]


async def _plan() -> tuple[list[str], list[dict], list[dict]]:
    """Everything that would be written, computed without writing any of it."""
    learner_ids = await learners_in_group(GROUP)
    days = _school_days(DAYS)
    checkins: list[dict] = []
    events: list[dict] = []

    for learner_id in learner_ids:
        who = _rng(learner_id, "who")
        # Three dials per child, stable across runs: how often they answer the
        # check-in, how sunny their baseline is, and how much they study.
        answer_rate = who.uniform(0.35, 0.9)
        personality = who.uniform(0.6, 1.4)
        study_rate = who.uniform(0.25, 0.85)
        skill = who.uniform(0.45, 0.9)

        for index, day in enumerate(days):
            date_key = day.date().isoformat()
            bias = _mood_bias(index, len(days))

            # ── the check-in ────────────────────────────────────────────────
            draw = _rng(learner_id, "checkin", date_key)
            if draw.random() < answer_rate:
                valence = _valence_for(draw, personality, bias)
                checkins.append({
                    "_id": f"checkin:{learner_id}:{date_key}",
                    "learner_id": learner_id,
                    "date_key": date_key,
                    "valence": valence,
                    "feeling": draw.choice(FEELINGS[valence]),
                    "status": "felt",
                    "demo_fixture": TAG,
                })
            elif draw.random() < 0.35:
                # Asked and waved off. A skip is a real answer shape — it is
                # what makes the response rate honest rather than implied.
                checkins.append({
                    "_id": f"checkin:{learner_id}:{date_key}",
                    "learner_id": learner_id,
                    "date_key": date_key,
                    "valence": None,
                    "feeling": None,
                    "status": "skipped",
                    "demo_fixture": TAG,
                })

            # ── the day's work ──────────────────────────────────────────────
            work = _rng(learner_id, "work", date_key)
            # A hard fortnight shows up as less work, not only as worse moods.
            if work.random() > study_rate * (1 - 0.35 * bias):
                continue
            objective, subject = work.choice(OBJECTIVES)
            answers = work.randint(3, 14)
            # The session starts somewhere in the school day and runs on.
            cursor = day.replace(hour=work.randint(8, 17), minute=work.randint(0, 55))
            for step in range(answers):
                gap = work.randint(25, 210)
                cursor = cursor + timedelta(seconds=gap)
                success = work.random() < skill * (1 - 0.15 * bias)
                stamp = cursor.isoformat()
                events.append({
                    "_id": f"seed:{TAG}:{learner_id}:{date_key}:{step}",
                    "learner_id": learner_id,
                    "verb": "answered",
                    "objective_id": objective,
                    "subject": subject,
                    "occurred_at": stamp,
                    "stored_at": stamp,
                    "result": {
                        "success": success,
                        "score": {"scaled": round(work.uniform(0.7, 1.0), 2) if success
                                  else round(work.uniform(0.0, 0.4), 2)},
                    },
                    # The first answer of a session has no predecessor, so it
                    # contributes no elapsed time — the same rule the real
                    # pipeline applies.
                    "timing": {} if step == 0 else {
                        "elapsed_since_previous_seconds": gap,
                        "quality": "reliable",
                    },
                    "demo_fixture": TAG,
                })

    return learner_ids, checkins, events


# ── mastery, for the gaps card ────────────────────────────────────────────────
#
# How long ago a learner's evidence on an objective sits. Chosen so that every
# window the dashboard offers — and the equal window before it, which is what
# the comparison is measured against — contains some of it:
#
#   0.3d  inside every current window (day, 3-day, week, month)
#   1.4d  the day's PREVIOUS window; still current for 3-day and up
#   4.0d  the 3-day's previous window; still current for week and month
#   10.0d the week's previous window; still current for the month
#   45.0d the month's previous window
RECENCY_BANDS = (0.3, 1.4, 4.0, 10.0, 45.0)

# Whether an objective reads as something the class is stuck on or something it
# has got. A gap needs ≥30% of the learners with evidence struggling; a strength
# needs ≥30% mastered AND fewer than 30% struggling (`_gaps_from_brains`), so
# the two shapes are deliberately well clear of the threshold rather than on it.
ROLE_MIX = {
    #                 struggling, mastered   (the rest are neither)
    "gap":            (0.60, 0.15),
    "strength":       (0.10, 0.70),
}

MISCONCEPTIONS = ("unit-confusion", "place-value", "sign-error", "off-by-one")


async def _plan_mastery() -> tuple[list[dict], list[str]]:
    """Mastery entries to create, and the objectives they cover.

    Returns entries as {learner_id, objective_id, key, value} — nothing is
    written here, and an objective a learner already has an entry for is left
    strictly alone.
    """
    from app.brain.mastery import mastery_key
    from app.brain.repository import get_brain
    from app.services import kata_catalog

    await kata_catalog.ensure_loaded()
    objectives: list[tuple[str, str]] = []
    for subject_id in kata_catalog.subjects():
        for objective in kata_catalog.objectives_for(subject_id):
            objectives.append((objective["id"], subject_id))
    if not objectives:
        return [], []

    learner_ids = await learners_in_group(GROUP)
    now = datetime.now(timezone.utc)
    entries: list[dict] = []

    # Objectives that share a display title, grouped. The catalogue has two
    # science objectives both called "מסה ונפח של גופים", and a learner given a
    # gap on one and a strength on the other appears on both sides of the card
    # under the same heading — which reads as a contradiction, because from the
    # teacher's seat it IS one. A learner is therefore assigned to at most one
    # objective per title, so no child is ever shown as both.
    from app.services import kata_catalog as catalog
    title_of = {oid: (catalog.objective_title(oid, "he") or oid)
                for oid, _ in objectives}

    for index, (objective_id, subject_id) in enumerate(objectives):
        # Alternating, so the card always has both halves to show. With an odd
        # number of objectives this leaves one more gap than strength, which is
        # the right way round: the card leads with what to act on.
        role = "gap" if index % 2 == 0 else "strength"
        struggle_rate, mastery_rate = ROLE_MIX[role]
        siblings = [oid for oid, _ in objectives if title_of[oid] == title_of[objective_id]]

        for position, learner_id in enumerate(learner_ids):
            brain = await get_brain(learner_id)
            key = mastery_key(objective_id)
            if (brain.get("mastery") or {}).get(key):
                continue  # a real record — never overwritten

            # One objective per shared title, picked deterministically per
            # learner so the choice is stable across runs.
            if len(siblings) > 1:
                pick = _rng(learner_id, "title", title_of[objective_id])
                if siblings[pick.randrange(len(siblings))] != objective_id:
                    continue

            # Not every child works on every objective. A roster where all 41
            # have evidence on all five is not a class, it is a matrix — and it
            # made "25 of 41 tried it" impossible, so the untried band of the
            # split bar never had anything in it.
            if _rng(learner_id, "covers", objective_id).random() > 0.72:
                continue

            # Every band gets learners from this objective, so the objective
            # itself appears in every window rather than only the newest one.
            band = RECENCY_BANDS[position % len(RECENCY_BANDS)]
            rng = _rng(learner_id, "mastery", objective_id)
            roll = rng.random()
            struggling = roll < struggle_rate
            mastered = not struggling and roll < struggle_rate + mastery_rate

            last_at = now - timedelta(days=band, hours=rng.randint(0, 8))
            attempts = rng.randint(3, 12)
            score = (round(rng.uniform(0.15, 0.5), 2) if struggling
                     else round(rng.uniform(0.82, 0.98), 2) if mastered
                     else round(rng.uniform(0.6, 0.78), 2))
            entry = {
                "objective_id": objective_id,
                "subject": subject_id,
                "attempts": attempts,
                "correct": int(attempts * score),
                "score_ewma": score,
                "achieved": mastered,
                "needs_review": struggling,
                "last_evidence_at": last_at.isoformat(),
                "demo_fixture": TAG,
            }
            if struggling and rng.random() < 0.7:
                # Misconceptions carry their OWN `last_seen`, and the windowed
                # read filters on it separately — so it has to sit in the same
                # band as the evidence or the row loses its "why".
                entry["misconceptions"] = [{
                    "tag": rng.choice(MISCONCEPTIONS),
                    "last_seen": last_at.isoformat(),
                    "resolved": False,
                }]
            entries.append({
                "learner_id": learner_id,
                "objective_id": objective_id,
                "key": key,
                "value": entry,
            })

    return entries, [objective_id for objective_id, _ in objectives]


async def _write_mastery(entries: list[dict]) -> int:
    """Create the entries, and record exactly which pairs were created.

    The index is what makes this reversible: teardown removes the pairs written
    here rather than every entry on the objectives it touched, so a learner who
    later earns real mastery on one of them keeps it.
    """
    from app.brain.repository import apply_brain_updates

    index = _get_collection_named("demo_fixture_index")
    written = 0
    created: list[dict] = []
    for entry in entries:
        await apply_brain_updates(
            entry["learner_id"], {f"mastery.{entry['key']}": entry["value"]})
        created.append({"learner_id": entry["learner_id"], "key": entry["key"]})
        written += 1
        if written % 25 == 0:
            print(f"    …{written}/{len(entries)}")
    if index is not None and created:
        await index.update_one(
            {"_id": f"fixture:{TAG}:mastery"},
            {"$set": {"demo_fixture": TAG, "pairs": created}},
            upsert=True,
        )
    return written


async def _teardown_mastery() -> int:
    """Unset exactly the pairs `_write_mastery` recorded."""
    from app.brain.repository import _get_collection

    index = _get_collection_named("demo_fixture_index")
    brains = _get_collection()
    if index is None or brains is None:
        return 0
    doc = await index.find_one({"_id": f"fixture:{TAG}:mastery"})
    if not doc:
        return 0
    removed = 0
    for pair in doc.get("pairs", []):
        await brains.update_one(
            {"_id": pair["learner_id"]},
            {"$unset": {f"mastery.{pair['key']}": ""}},
        )
        removed += 1
    await index.delete_one({"_id": f"fixture:{TAG}:mastery"})
    return removed


async def _write(collection_name: str, docs: list[dict]) -> int:
    handle = _get_collection_named(collection_name)
    if handle is None:
        print(f"  ⚠️ {collection_name}: no collection handle (no Mongo?) — skipped")
        return 0
    written = 0
    for doc in docs:
        body = {key: value for key, value in doc.items() if key != "_id"}
        await handle.update_one({"_id": doc["_id"]}, {"$set": body}, upsert=True)
        written += 1
        if written % 500 == 0:
            print(f"    …{written}/{len(docs)}")
    return written


async def seed(with_brain: bool, only_brain: bool = False) -> None:
    if not only_brain:
        learner_ids, checkins, events = await _plan()
        print(f"→ {len(learner_ids)} learners in {GROUP}, {DAYS} days")
        print(f"  daily_checkins : {len(checkins)}")
        print(f"  learning_events: {len(events)}")
        print("  writing check-ins…")
        await _write("daily_checkins", checkins)
        print("  writing events…")
        await _write("learning_events", events)
    if with_brain or only_brain:
        entries, objectives = await _plan_mastery()
        print(f"  writing mastery… {len(entries)} entries over "
              f"{len(objectives)} objectives")
        await _write_mastery(entries)
        print("✅ seeded, mastery included (existing entries left untouched).")
    else:
        print("✅ seeded. The Learner Brain was not touched "
              "(pass --with-brain for the gaps card).")


async def plan(with_brain: bool) -> None:
    learner_ids, checkins, events = await _plan()
    answered = [row for row in checkins if row["valence"]]
    print(f"→ would write, for {len(learner_ids)} learners over {DAYS} days:")
    print(f"  daily_checkins : {len(checkins)}  ({len(answered)} felt, "
          f"{len(checkins) - len(answered)} skipped)")
    print(f"  learning_events: {len(events)}")
    shape: dict[str, int] = {}
    for row in answered:
        shape[row["valence"]] = shape.get(row["valence"], 0) + 1
    print(f"  mood shape     : {shape}")
    if with_brain:
        entries, objectives = await _plan_mastery()
        print(f"  mastery        : {len(entries)} new entries over "
              f"{len(objectives)} objectives")
        for objective_id in objectives:
            mine = [row for row in entries if row["objective_id"] == objective_id]
            struggling = sum(1 for row in mine if row["value"]["needs_review"])
            mastered = sum(1 for row in mine if row["value"]["achieved"])
            print(f"     {objective_id}: {len(mine)} learners "
                  f"({struggling} struggling, {mastered} mastered)")
    else:
        print("  brain writes   : none")


async def teardown(only_brain: bool = False) -> None:
    if not only_brain:
        for name in ("daily_checkins", "learning_events"):
            handle = _get_collection_named(name)
            if handle is None:
                continue
            result = await handle.delete_many({"demo_fixture": TAG})
            print(f"  {name}: removed {result.deleted_count}")
    print(f"  mastery: removed {await _teardown_mastery()} entries")
    print("✅ torn down")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--plan", action="store_true",
                        help="count what would be written, and write nothing")
    action.add_argument("--seed", action="store_true")
    action.add_argument("--teardown", action="store_true")
    parser.add_argument(
        "--with-brain", action="store_true",
        help="also create mastery entries, so the gaps card has something to "
             "read. Never overwrites an entry a learner already has, and every "
             "pair it creates is recorded for --teardown.")
    parser.add_argument(
        "--only-brain", action="store_true",
        help="with --seed or --teardown: touch ONLY the mastery entries. The check-ins and "
             "events are idempotent upserts, so re-running them is safe but "
             "costs several thousand round trips for nothing.")
    args = parser.parse_args()

    if args.plan:
        asyncio.run(plan(args.with_brain or args.only_brain))
    elif args.seed:
        asyncio.run(seed(args.with_brain, args.only_brain))
    else:
        asyncio.run(teardown(args.only_brain))


if __name__ == "__main__":
    main()
