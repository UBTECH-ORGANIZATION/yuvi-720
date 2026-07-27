#!/usr/bin/env python
"""Drop every cached/persisted Coach visual so it regenerates.

Visuals are stored, not recomputed on read:

  * `question_explainers`  — a whole generated deck per question, cached forever
    and shared across learners. Its slides embed rendered visuals.
  * `agent_messages`       — each assistant message keeps the visual attached to
    it, so replaying a conversation replays the original render.

Both therefore keep serving pictures produced by whatever pipeline was current
when they were written. After a renderer or layout change the old ones simply
persist, which looks exactly like the change not working.

This clears both, in Mongo/Cosmos AND in the local JSON fallbacks. Explainer
decks regenerate on next request; conversation history keeps its text and loses
only the attached image.

    python scripts/clear_visual_cache.py            # show what would be removed
    python scripts/clear_visual_cache.py --apply    # actually remove it
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.brain.repository import _get_collection_named      # noqa: E402


FALLBACKS = {
    "question_explainers": Path("data/question_explainers.json"),
    "agent_history": Path("data/agent_history.json"),
}


async def clear_explainer_decks(apply: bool) -> tuple[int, int]:
    """Whole decks — a deck's visuals cannot be replaced without regenerating it."""
    removed_db = 0
    collection = _get_collection_named("question_explainers")
    if collection is not None:
        try:
            if apply:
                result = await collection.delete_many({})
                removed_db = result.deleted_count
            else:
                removed_db = await collection.count_documents({})
        except Exception as exc:
            print(f"  ! question_explainers (db): {exc}")

    removed_file = 0
    path = FALLBACKS["question_explainers"]
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            removed_file = len(data)
            if apply:
                path.write_text("{}", encoding="utf-8")
        except Exception as exc:
            print(f"  ! question_explainers (file): {exc}")
    return removed_db, removed_file


async def clear_message_visuals(apply: bool) -> tuple[int, int]:
    """Strip attached visuals but KEEP the messages — the conversation is the
    learner's history and must survive; only the picture is stale."""
    stripped_db = 0
    collection = _get_collection_named("agent_messages")
    if collection is not None:
        try:
            query = {"visual": {"$exists": True, "$ne": None}}
            if apply:
                result = await collection.update_many(query, {"$unset": {"visual": ""}})
                stripped_db = result.modified_count
            else:
                stripped_db = await collection.count_documents(query)
        except Exception as exc:
            print(f"  ! agent_messages (db): {exc}")

    stripped_file = 0
    path = FALLBACKS["agent_history"]
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))

            def strip(node):
                nonlocal stripped_file
                if isinstance(node, dict):
                    if node.pop("visual", None) is not None:
                        stripped_file += 1
                    for value in node.values():
                        strip(value)
                elif isinstance(node, list):
                    for item in node:
                        strip(item)

            strip(data)
            if apply and stripped_file:
                path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as exc:
            print(f"  ! agent_history (file): {exc}")
    return stripped_db, stripped_file


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="actually delete (default: dry run)")
    args = parser.parse_args()

    mode = "REMOVING" if args.apply else "would remove (dry run)"
    print(f"{mode}:\n")

    decks_db, decks_file = await clear_explainer_decks(args.apply)
    print(f"  question_explainers   db={decks_db:<6} file={decks_file}")
    msgs_db, msgs_file = await clear_message_visuals(args.apply)
    print(f"  agent_messages.visual db={msgs_db:<6} file={msgs_file}")

    total = decks_db + decks_file + msgs_db + msgs_file
    if not args.apply:
        print(f"\n{total} cached item(s). Re-run with --apply to clear them.")
    else:
        print(f"\nCleared {total} item(s). Explainer decks regenerate on next request;"
              "\nconversation text is intact, only stale visuals were detached.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
