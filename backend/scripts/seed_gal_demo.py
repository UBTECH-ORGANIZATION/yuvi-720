"""Seed / unseed a realistic activeness demo for the `gal` account.

Gives gal a real ~2-week trail of learning activity — scored answers, lesson
completions, a few help requests, and the matching mastery — so the activeness
map renders exactly as a live Yuvi student's would:

  • evidence-backed change arrows (not fabricated history),
  • grounded "why it went up/down" blurbs,
  • a coach that can explain what moved and how to improve.

The story is a believable middle-schooler with a MIX of movement:
  growth mindset ↑ (bounces back after mistakes)   motivation ↑ (shows up, finishes)
  initiative ↑ (finishes, tries before hints)       support ↑ (asks for help healthily)
  self-regulation ↓ (started fast-guessing lately)  self-awareness ↓ (never reflects)

Everything it writes is tagged (`seed_tag`) or backed up to a local file, so
`--remove` deletes the tagged docs and restores the exact pre-seed state.

Run:
  cd backend && ./.venv/bin/python scripts/seed_gal_demo.py           # seed
  cd backend && ./.venv/bin/python scripts/seed_gal_demo.py --remove  # undo
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.env import ensure_env_loaded  # noqa: E402  (loads .env for scripts)

ensure_env_loaded()

from app.brain.activeness import COMPETENCY_KEYS, effective_activeness  # noqa: E402
from app.brain.mastery import mastery_key  # noqa: E402
from app.brain.repository import _get_collection, _get_collection_named, get_brain  # noqa: E402
import learner_state as ls  # noqa: E402

LEARNER = "gal"
SEED_TAG = "demo-gal-activeness"
BACKUP = Path(__file__).resolve().parents[1] / ".runtime" / "seed_gal_demo_backup.json"
NOW = datetime.now(timezone.utc)


def _iso(days: float = 0, hours: float = 0) -> str:
    return (NOW - timedelta(days=days, hours=hours)).isoformat()


def _lerp(a: float, b: float, t: float) -> int:
    return int(round(a + (b - a) * t))


# ── The synthetic-but-coherent activity trail ────────────────────────────────
def _events() -> list[dict[str, Any]]:
    ev: list[dict[str, Any]] = []
    i = 0

    def add(days, verb, success, score, obj, subject, dur=None, hours=0):
        nonlocal i
        i += 1
        result: dict[str, Any] = {"success": success, "score_scaled": score}
        if dur is not None:
            result["duration"] = dur
        at = _iso(days, hours)
        ev.append({
            "_id": f"seedgal-{i:02d}",
            "learner_id": LEARNER,
            "verb": verb,
            "result": result,
            "objective_id": obj,
            "subject": subject,
            "occurred_at": at,
            "stored_at": at,
            "seed_tag": SEED_TAG,
        })

    # Growth mindset ↑ — four objectives failed, then recovered a day or two later.
    recover = [
        ("MOE.SCI.G7.CELLS", "MOE.SCI", 12, 10),
        ("MOE.SCI.G7.ENERGY", "MOE.SCI", 11, 9),
        ("MOE.MATH.G7.FRAC", "MOE.MATH", 8, 6),
        ("MOE.MATH.G7.RATIO", "MOE.MATH", 7, 5),
    ]
    for obj, subj, d_fail, d_ok in recover:
        add(d_fail, "answered", False, 0.2, obj, subj)
        add(d_ok, "answered", True, 0.9, obj, subj)

    # Motivation / initiative / self-awareness — finishes lessons across many days.
    completes = [
        ("MOE.SCI.G7.CELLS", "MOE.SCI", 10),
        ("MOE.SCI.G7.ENERGY", "MOE.SCI", 9),
        ("MOE.MATH.G7.FRAC", "MOE.MATH", 6),
        ("MOE.MATH.G7.RATIO", "MOE.MATH", 5),
        ("MOE.SCI.G7.MATTER", "MOE.SCI", 3),
        ("MOE.MATH.G7.GEOM", "MOE.MATH", 2),
    ]
    for obj, subj, d in completes:
        add(d, "completed", True, 0.85, obj, subj)

    # Self-regulation ↓ — a recent cluster of fast, sub-3.5s answers (guessing).
    add(2, "answered", True, 0.8, "MOE.MATH.G7.GEOM", "MOE.MATH", dur=2.1, hours=1)
    add(2, "answered", False, 0.1, "MOE.MATH.G7.GEOM", "MOE.MATH", dur=1.9, hours=2)
    add(1, "answered", False, 0.2, "MOE.SCI.G7.MATTER", "MOE.SCI", dur=2.4, hours=1)
    add(1, "answered", True, 0.7, "MOE.SCI.G7.MATTER", "MOE.SCI", dur=2.0, hours=2)
    add(1, "answered", False, 0.1, "MOE.MATH.G7.GEOM", "MOE.MATH", dur=1.7, hours=3)
    add(1, "answered", True, 0.6, "MOE.SCI.G7.MATTER", "MOE.SCI", dur=2.6, hours=4)
    return ev


def _decisions() -> list[dict[str, Any]]:
    # Support ↑ — asked for help while stuck, a healthy amount (not over-reliant).
    return [
        {"learner_id": LEARNER, "strategy": "hint", "intention": "diagnose",
         "hint_level": 1, "at": _iso(11), "seed_tag": SEED_TAG},
        {"learner_id": LEARNER, "strategy": "explain", "intention": "elaborate",
         "hint_level": 2, "at": _iso(8), "seed_tag": SEED_TAG},
        {"learner_id": LEARNER, "strategy": "hint", "intention": "diagnose",
         "hint_level": 1, "at": _iso(6), "seed_tag": SEED_TAG},
    ]


def _mastery_entries() -> dict[str, dict[str, Any]]:
    # Realistic durable stance for the objectives above — gives growth a genuine
    # success-streak signal (so recovery reads as growth, not just "low activity").
    spec = [
        ("MOE.SCI.G7.CELLS", "MOE.SCI", 3, 3, 1),
        ("MOE.SCI.G7.ENERGY", "MOE.SCI", 2, 2, 1),
        ("MOE.MATH.G7.FRAC", "MOE.MATH", 3, 3, 1),
        ("MOE.MATH.G7.RATIO", "MOE.MATH", 2, 2, 1),
        ("MOE.SCI.G7.MATTER", "MOE.SCI", 1, 2, 1),
        ("MOE.MATH.G7.GEOM", "MOE.MATH", 2, 2, 1),
    ]
    out: dict[str, dict[str, Any]] = {}
    for obj, subj, streak, succ, fail in spec:
        out[mastery_key(obj)] = {
            "objective_id": obj,
            "subject": subj,
            "consecutive_successes": streak,
            "successes": succ,
            "failures": fail,
            "score_ewma": 0.8,
            "confidence": 0.6,
            "level": "intermediate" if streak >= 3 else "basic",
            "achieved": streak >= 3,
            "needs_review": False,
            "last_evidence_at": _iso(2),
            "seed_tag": SEED_TAG,
        }
    return out


def _require_mongo() -> None:
    if _get_collection() is None or _get_collection_named("learning_events") is None:
        print("✋ No Mongo/Cosmos connection configured (this account lives there, "
              "not in the JSON fallback). Set the DB connection string in backend/.env "
              "and retry.")
        sys.exit(1)


async def seed() -> None:
    _require_mongo()
    if BACKUP.exists():
        print(f"✋ Already seeded (backup at {BACKUP}). Run with --remove first.")
        sys.exit(1)

    brain = await get_brain(LEARNER)
    base = (brain.get("profile") or {}).get("activeness") or {}
    if not base:
        print("✋ gal has no onboarding activeness base yet — sign in once to "
              "generate the profile, then seed.")
        sys.exit(1)

    events, decisions, mastery = _events(), _decisions(), _mastery_entries()

    # ── Back up exactly what we touch, so --remove is a clean inverse ──────────
    state = await ls.get_learner_state(LEARNER)
    prior_mastery = {k: (brain.get("mastery") or {}).get(k) for k in mastery}
    backup = {
        "activeness_map_prior": (state or {}).get("activeness_map"),
        "mastery_prior": prior_mastery,   # value or None (didn't exist) per key
    }
    BACKUP.parent.mkdir(parents=True, exist_ok=True)
    BACKUP.write_text(json.dumps(backup, ensure_ascii=False, indent=2), encoding="utf-8")

    # ── Writes ────────────────────────────────────────────────────────────────
    ev_col = _get_collection_named("learning_events")
    dec_col = _get_collection_named("tutor_decisions")
    brain_col = _get_collection()

    await ev_col.delete_many({"learner_id": LEARNER, "seed_tag": SEED_TAG})
    await ev_col.insert_many(events)
    await dec_col.delete_many({"learner_id": LEARNER, "seed_tag": SEED_TAG})
    await dec_col.insert_many(decisions)
    await brain_col.update_one(
        {"_id": LEARNER},
        {"$set": {f"mastery.{k}": entry for k, entry in mastery.items()}},
    )

    # Compute the resulting live map and lay a base→current history trail so the
    # week-over-week arrows have a real baseline to move from.
    brain["mastery"] = {**(brain.get("mastery") or {}), **mastery}
    eff = effective_activeness(brain, events, decisions)
    current = {k: eff[k]["value"] for k in COMPETENCY_KEYS}
    base_pos = {k: int(base.get(k, current[k])) for k in COMPETENCY_KEYS}

    trail = [12, 10, 8, 5, 3, 1]                      # days ago (oldest → newest)
    fracs = [0.0, 0.15, 0.35, 0.6, 0.8, 1.0]          # base → current
    history = [
        {"at": _iso(d), "positions": {k: _lerp(base_pos[k], current[k], f)
                                      for k in COMPETENCY_KEYS}}
        for d, f in zip(trail, fracs)
    ]
    await ls.update_learner_state(LEARNER, {
        "activeness_map": {"positions": current, "focus": None, "history": history},
    })

    _print_map("Seeded — gal's live activeness map:", base_pos, eff)
    print(f"\n✅ Done. {len(events)} events, {len(decisions)} help requests, "
          f"{len(mastery)} mastery entries. Backup: {BACKUP}")
    print("   Remove later with:  ./.venv/bin/python scripts/seed_gal_demo.py --remove")


async def unseed() -> None:
    _require_mongo()
    if not BACKUP.exists():
        print(f"Nothing to remove — no backup at {BACKUP}. (Already clean?)")
        return
    backup = json.loads(BACKUP.read_text(encoding="utf-8"))

    ev_col = _get_collection_named("learning_events")
    dec_col = _get_collection_named("tutor_decisions")
    brain_col = _get_collection()

    r1 = await ev_col.delete_many({"learner_id": LEARNER, "seed_tag": SEED_TAG})
    r2 = await dec_col.delete_many({"learner_id": LEARNER, "seed_tag": SEED_TAG})

    # Restore each touched mastery key to its prior value (or remove if new).
    prior_mastery: dict[str, Optional[dict]] = backup.get("mastery_prior") or {}
    set_ops = {f"mastery.{k}": v for k, v in prior_mastery.items() if v is not None}
    unset_ops = {f"mastery.{k}": "" for k, v in prior_mastery.items() if v is None}
    ops: dict[str, Any] = {}
    if set_ops:
        ops["$set"] = set_ops
    if unset_ops:
        ops["$unset"] = unset_ops
    if ops:
        await brain_col.update_one({"_id": LEARNER}, ops)

    # Restore the activeness_map (or clear it if gal had none before).
    prior_map = backup.get("activeness_map_prior")
    state_col = ls._get_collection()
    if prior_map is not None:
        await state_col.update_one({"_id": LEARNER}, {"$set": {"activeness_map": prior_map}})
    else:
        await state_col.update_one({"_id": LEARNER}, {"$unset": {"activeness_map": ""}})

    BACKUP.unlink()
    print(f"🧹 Removed {r1.deleted_count} events, {r2.deleted_count} help requests, "
          f"restored {len(prior_mastery)} mastery keys + activeness_map.")

    brain = await get_brain(LEARNER)
    base = (brain.get("profile") or {}).get("activeness") or {}
    eff = effective_activeness(brain, [], [])
    _print_map("After removal — back to the onboarding base:", base, eff)


def _print_map(title: str, base: dict, eff: dict) -> None:
    print(f"\n{title}")
    print(f"  {'domain':<26} {'base':>4} {'now':>4} {'Δ':>5}  {'backed':<6} causes")
    for k in COMPETENCY_KEYS:
        e = eff[k]
        backed = "yes" if e["confidence"] >= 0.3 else "no"
        arrow = "▲" if e["delta"] > 0 else ("▼" if e["delta"] < 0 else "·")
        print(f"  {k:<26} {int(base.get(k, 0)):>4} {e['value']:>4} "
              f"{arrow}{abs(e['delta']):>4.1f}  {backed:<6} {','.join(e['causes']) or '—'}")


async def main() -> None:
    parser = argparse.ArgumentParser(description="Seed/unseed gal's activeness demo.")
    parser.add_argument("--remove", action="store_true", help="undo the seed")
    args = parser.parse_args()
    await (unseed() if args.remove else seed())


if __name__ == "__main__":
    asyncio.run(main())
