"""Seed / unseed a wellbeing history for one learner, so the tab can be seen.

    cd backend && ./.venv/bin/python scripts/seed_wellbeing_flags.py
    cd backend && ./.venv/bin/python scripts/seed_wellbeing_flags.py --remove

Four flags, one per state the card can be in, because each renders differently
and the differences are the point:

  1. today · open · a chat with Yuvi          → the live one, and the ONLY one
                                                 that rings the bell
  2. 2 days ago · claimed · a blocked message → the "never reached anyone" badge,
                                                 a claim, one logged action
  3. 9 days ago · closed, handled             → the full handover: claim, two
                                                 actions, a close reason and note
  4. 24 days ago · closed, not relevant       → the false positive, kept

Everything it writes carries ``seed_tag`` — the flag rows, the brain entries —
so ``--remove`` deletes exactly what it made and nothing that a child actually
said. It refuses to touch an untagged flag, which is the whole reason the tag
exists rather than a date range.

Only flag 1 goes through `safety.record_wellbeing_flag`, the real path, so the
bell → tab → scroll → ring journey is genuinely exercised. The historical three
are written directly: a notification from three weeks ago arriving in the bell
today would be a lie about when it happened.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.env import ensure_env_loaded  # noqa: E402  (loads .env for scripts)

ensure_env_loaded()

from app.agents import safety  # noqa: E402
from app.brain import org  # noqa: E402
from app.brain.repository import (  # noqa: E402
    _get_collection_named, apply_brain_updates, get_brain,
)
from app.services import wellbeing  # noqa: E402

SEED_TAG = "wellbeing_demo"


def _at(days_ago: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()


# The words are ordinary rather than dramatic on purpose: a seeded screen that
# only ever shows the extreme case teaches the wrong thing about what this tab
# is for. Three of the four are the kind of sentence a teacher actually meets.
HISTORY: list[dict[str, Any]] = [
    {
        "days_ago": 2,
        "source": "direct_message",     # blocked — it reached nobody
        "category": "distress",
        "evidence": "אני לא רוצה לבוא לבית ספר יותר, כולם צוחקים עליי בהפסקות.",
        "claim": True,
        "actions": [
            {"kind": "spoke", "days_ago": 2,
             "text": "דיברתי איתו בסוף היום. סיפר על שני ילדים מהמקבילה. ביקש שלא נעשה מזה עניין גדול."},
        ],
    },
    {
        "days_ago": 9,
        "source": "coach_chat",
        "category": "distress",
        "evidence": "כבר כמה לילות אני לא מצליח להירדם ואני חושב על זה כל הזמן.",
        "claim": True,
        "actions": [
            {"kind": "called_home", "days_ago": 9,
             "text": "שיחה עם האמא. מודעת, אמרה שזה התחיל אחרי המעבר לדירה החדשה."},
            {"kind": "referred", "days_ago": 8,
             "text": "הועבר ליועצת בית הספר, נקבעה פגישה ליום ראשון."},
        ],
        "close": {"reason": "referred", "days_ago": 7,
                  "note": "היועצת לקחה את זה. מעקב שלי בעוד שבועיים."},
    },
    {
        "days_ago": 24,
        "source": "competency_chat",
        "category": "distress",
        "evidence": "נמאס לי מהכול, אני הכי גרוע בכיתה בחשבון.",
        "claim": True,
        "actions": [
            {"kind": "spoke", "days_ago": 24,
             "text": "שאלתי אותו. אמר שזה נאמר ברגע של תסכול אחרי מבחן ושהוא בסדר."},
        ],
        "close": {"reason": "not_relevant", "days_ago": 24,
                  "note": "תסכול מהמבחן, לא מצוקה. משאיר עין."},
    },
]

LIVE = {
    "source": "coach_chat",
    "category": "distress",
    "evidence": "לא בא לי לספר לאף אחד בבית מה קורה, זה רק יעשה יותר בלגן.",
}


async def _brain_flags(learner_id: str) -> list[dict[str, Any]]:
    brain = await get_brain(learner_id)
    return list(brain.get("wellbeing_flags") or [])


async def _append_to_brain(learner_id: str, flag: dict[str, Any]) -> None:
    """The coach's copy. Tagged, so removal never guesses."""
    flags = await _brain_flags(learner_id)
    flags.append(flag)
    await apply_brain_updates(learner_id, {"wellbeing_flags": flags[-12:]})


async def _seed(learner_id: str) -> None:
    collection = _get_collection_named(wellbeing.COLLECTION)
    if collection is None:
        raise SystemExit("no database — nothing to seed into")

    teachers = await org.teachers_for_learner(learner_id)
    if not teachers:
        raise SystemExit(f"{learner_id} has no teachers; a flag would reach nobody")
    print(f"· teachers of {learner_id}: {', '.join(teachers)}")

    made: list[str] = []

    for spec in HISTORY:
        flag_id = wellbeing.new_flag_id()
        at = _at(spec["days_ago"])
        reply = safety._reply_shown_to_learner(spec["source"], spec["category"], "he")

        await wellbeing.record(
            learner_id,
            evidence=spec["evidence"],
            category=spec["category"],
            source=spec["source"],
            language="he",
            reply=reply,
            delivered=spec["source"] != "direct_message",
            flag_id=flag_id,
        )
        await wellbeing.note_notified(flag_id, teachers)

        # State through the real service calls, so a seeded card can never be a
        # shape the product cannot produce. Timestamps are corrected afterwards.
        if spec.get("claim"):
            await wellbeing.acknowledge(flag_id, teachers[0])
        for action in spec.get("actions", []):
            await wellbeing.log_action(flag_id, teachers[0],
                                       kind=action["kind"], text=action["text"])
        if spec.get("close"):
            await wellbeing.close(flag_id, teachers[0],
                                  reason=spec["close"]["reason"],
                                  note=spec["close"]["note"])

        row = await wellbeing.get(flag_id) or {}
        actions = row.get("actions") or []
        for entry, action in zip(actions, spec.get("actions", [])):
            entry["at"] = _at(action["days_ago"])
        changes: dict[str, Any] = {
            "at": at, "actions": actions, "seed_tag": SEED_TAG,
        }
        if spec.get("claim"):
            changes["acknowledged_at"] = at
        if spec.get("close"):
            changes["closed_at"] = _at(spec["close"]["days_ago"])
        await collection.update_one({"_id": flag_id}, {"$set": changes})

        await _append_to_brain(learner_id, {
            "id": flag_id,
            "category": spec["category"],
            "evidence": spec["evidence"][:400],
            "language": "he",
            "source": spec["source"],
            "at": at,
            # Closed here means closed there — the "needs attention" strip is
            # computed from this copy, and a handled flag must be quiet on it.
            "resolved": bool(spec.get("close")),
            "acknowledged_by": teachers[0] if spec.get("claim") else None,
            "seed_tag": SEED_TAG,
        })
        made.append(flag_id)
        state = "closed" if spec.get("close") else "claimed" if spec.get("claim") else "open"
        print(f"· {flag_id}  {spec['days_ago']}d ago  {spec['source']}  {state}")

    # The live one, through the path a real disclosure takes: brain copy, flag
    # row, teacher alert, bell notification, deep link with the flag id.
    flag = await safety.record_wellbeing_flag(
        learner_id, LIVE["evidence"], language="he",
        source=LIVE["source"], category=LIVE["category"])
    if not flag:
        raise SystemExit("the live flag did not record — check the connection")
    live_id = str(flag.get("id"))
    await collection.update_one({"_id": live_id}, {"$set": {"seed_tag": SEED_TAG}})

    flags = await _brain_flags(learner_id)
    for entry in flags:
        if str(entry.get("id")) == live_id:
            entry["seed_tag"] = SEED_TAG
    await apply_brain_updates(learner_id, {"wellbeing_flags": flags})
    made.append(live_id)
    print(f"· {live_id}  now  {LIVE['source']}  open  ← rang the bell")

    print(f"\n✅ {len(made)} flags for {learner_id}. "
          f"Open the bell, or /teacher/student/{learner_id}?tab=wellbeing")
    print(f"   undo: ./.venv/bin/python scripts/seed_wellbeing_flags.py "
          f"--learner {learner_id} --remove")


async def _remove(learner_id: str) -> None:
    collection = _get_collection_named(wellbeing.COLLECTION)
    if collection is None:
        raise SystemExit("no database")

    ids = [str(row["_id"]) async for row
           in collection.find({"learner_id": learner_id, "seed_tag": SEED_TAG})]
    if not ids:
        print("nothing seeded here")
        return

    removed = {wellbeing.COLLECTION: (await collection.delete_many(
        {"_id": {"$in": ids}})).deleted_count}

    alerts = _get_collection_named("teacher_alerts")
    if alerts is not None:
        removed["teacher_alerts"] = (await alerts.delete_many(
            {"_id": {"$regex": "|".join(ids)}})).deleted_count

    notifications = _get_collection_named("notifications")
    if notifications is not None:
        removed["notifications"] = (await notifications.delete_many(
            {"_id": {"$regex": "|".join(ids)}})).deleted_count

    flags = await _brain_flags(learner_id)
    # By tag, never by id alone: a flag a child actually raised must survive an
    # unseed even if it somehow shares an id shape with a seeded one.
    kept = [flag for flag in flags if flag.get("seed_tag") != SEED_TAG]
    await apply_brain_updates(learner_id, {"wellbeing_flags": kept})
    removed["brain_entries"] = len(flags) - len(kept)

    print(removed)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--learner", default="gal")
    parser.add_argument("--remove", action="store_true")
    args = parser.parse_args()
    asyncio.run(_remove(args.learner) if args.remove else _seed(args.learner))


if __name__ == "__main__":
    main()
