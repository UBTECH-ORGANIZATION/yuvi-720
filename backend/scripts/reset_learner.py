"""Reset a learner to a fresh start without deleting their account.

Wipes the brain, UI state, events, agent threads, reflections and mentoring for
the given learner ids, so the next sign-in begins onboarding from scratch. The
`users` document is deliberately left alone — credentials, roles and preferences
survive, so the learner can still log in.

Dry-run by default; pass --yes to actually delete.

Run:  cd backend && ./.venv/bin/python scripts/reset_learner.py gal moti
      cd backend && ./.venv/bin/python scripts/reset_learner.py gal moti --yes
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.env import ensure_env_loaded  # noqa: E402  (loads .env for scripts)

ensure_env_loaded()

from app.brain.repository import _get_collection_named  # noqa: E402

# (collection, key field). "_id" collections are also swept by learner_id.
# `users` is intentionally absent: this resets progress, not the account.
COLLECTIONS = [
    ("learners", "_id"),
    ("learner_state", "_id"),
    ("learning_events", "learner_id"),
    ("agent_sessions", "learner_id"),
    ("agent_conversations", "learner_id"),
    ("agent_messages", "learner_id"),
    ("reflections", "learner_id"),
    ("mentoring_conversations", "learner_id"),
    ("feedback_reports", "learner_id"),
]

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = BACKEND_DIR.parent

# Local JSON fallbacks keyed by learner id. `users.json` is excluded for the
# same reason the `users` collection is.
FALLBACK_MAPS = [
    BACKEND_DIR / ".runtime" / "learners_brain.json",
    REPO_DIR / ".runtime" / "learner_state.json",   # note: repo root, not backend/
]
FALLBACK_LISTS = [
    BACKEND_DIR / ".runtime" / "learning_events.json",
    BACKEND_DIR / ".runtime" / "agent_chat_history.json",
    BACKEND_DIR / ".runtime" / "feedback.json",
]


async def purge_mongo(ids: list[str], apply: bool) -> int:
    total = 0
    for name, field in COLLECTIONS:
        collection = _get_collection_named(name)
        if collection is None:
            continue
        for lid in ids:
            query: dict[str, Any] = (
                {"$or": [{"_id": lid}, {"learner_id": lid}]}
                if field == "_id"
                else {field: lid}
            )
            try:
                count = await collection.count_documents(query)
                if not count:
                    continue
                total += count
                print(f"  {'delete' if apply else 'would delete'} {count:>5} × {name} ({lid})")
                if apply:
                    await collection.delete_many(query)
            except Exception as exc:
                print(f"  ⚠️ {name} ({lid}) failed: {exc}")
    return total


def purge_fallbacks(ids: list[str], apply: bool) -> int:
    total = 0
    for path in FALLBACK_MAPS:
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"  ⚠️ {path} unreadable: {exc}")
            continue
        hits = [lid for lid in ids if lid in data]
        if not hits:
            continue
        total += len(hits)
        print(f"  {'delete' if apply else 'would delete'} {len(hits):>5} × {path.name} {hits}")
        if apply:
            for lid in hits:
                data.pop(lid, None)
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    for path in FALLBACK_LISTS:
        if not path.exists():
            continue
        try:
            rows = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"  ⚠️ {path} unreadable: {exc}")
            continue
        if not isinstance(rows, list):
            continue
        kept = [r for r in rows if not (isinstance(r, dict) and r.get("learner_id") in ids)]
        removed = len(rows) - len(kept)
        if not removed:
            continue
        total += removed
        print(f"  {'delete' if apply else 'would delete'} {removed:>5} × {path.name} rows")
        if apply:
            path.write_text(json.dumps(kept, ensure_ascii=False, indent=2), encoding="utf-8")
    return total


async def main_async(ids: list[str], apply: bool) -> None:
    print(f"Resetting: {', '.join(ids)}  (accounts in `users` are preserved)")
    print("Mongo:")
    mongo_total = await purge_mongo(ids, apply)
    if mongo_total == 0:
        print("  (nothing found — Mongo unset or already clean)")
    print("Local JSON fallbacks:")
    fallback_total = purge_fallbacks(ids, apply)
    if fallback_total == 0:
        print("  (nothing found)")

    total = mongo_total + fallback_total
    if apply:
        print(f"\n🧹 Deleted {total} document(s). Sign-in still works; onboarding starts over.")
    else:
        print(f"\nDry run — {total} document(s) would be deleted. Re-run with --yes to apply.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Reset learners to a fresh start (keeps accounts)")
    parser.add_argument("learner_ids", nargs="+", help="Learner ids to reset, e.g. gal moti")
    parser.add_argument("--yes", action="store_true", help="Actually delete (default is a dry run)")
    args = parser.parse_args()
    asyncio.run(main_async(args.learner_ids, args.yes))


if __name__ == "__main__":
    main()
