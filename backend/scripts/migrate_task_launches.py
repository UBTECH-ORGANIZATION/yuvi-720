"""Re-key papers written before a task could be opened more than once.

    python scripts/migrate_task_launches.py --dry-run
    python scripts/migrate_task_launches.py

Papers used to be keyed `{task_id}:{learner_id}`, which gave every child
exactly one copy of a task for all time. They are now keyed by the **opening**
they belong to, `{task_id}:{seq}:{learner_id}`, which is what makes a retake a
second paper rather than a write over the first.

Everything already sent belongs to an opening that was never recorded, so this
invents it: one launch per task that has activations, sequence 1, targets taken
from the task's own stored target, roster taken from whoever actually holds a
paper. Then every activation and attempt is rewritten under the new id.

## Why it is written to be re-runnable

A row that already carries `launch_id` is left alone, so a half-finished run
can simply be run again. And the old rows are **deleted only after** the new
ones are written, so an interruption leaves duplicates — which this script then
recognises — rather than a child's submitted answers in neither place.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: F401  — loads .env before anything reads a setting

from app.brain.repository import _get_collection_named
from app.services.tasks import store


async def _rows(name: str) -> list[dict[str, Any]]:
    handle = _get_collection_named(name)
    if handle is None:
        raise SystemExit(f"no database handle for {name}")
    return [row async for row in handle.find({})]


async def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    tasks = {str(row["_id"]): row for row in await _rows(store.TASKS)}
    activations = await _rows(store.ACTIVATIONS)
    attempts = await _rows(store.ATTEMPTS)
    launches = {str(row["_id"]) for row in await _rows(store.LAUNCHES)}

    stale_acts = [row for row in activations if not row.get("launch_id")]
    stale_atts = [row for row in attempts if not row.get("launch_id")]
    print(f"tasks {len(tasks)} · activations {len(activations)} "
          f"({len(stale_acts)} to move) · attempts {len(attempts)} "
          f"({len(stale_atts)} to move) · launches {len(launches)}")

    if not stale_acts and not stale_atts:
        print("nothing to migrate")
        return 0

    # One opening per task that has papers, holding whoever actually holds one.
    by_task: dict[str, list[dict[str, Any]]] = {}
    for row in stale_acts:
        by_task.setdefault(str(row.get("task_id")), []).append(row)

    plan = []
    for task_id, rows in sorted(by_task.items()):
        task = tasks.get(task_id)
        if task is None:
            print(f"  ⚠️  {task_id}: {len(rows)} paper(s) for a task that is gone — skipped")
            continue
        launch_id = store.launch_id(task_id, 1)
        learner_ids = [str(row.get("learner_id")) for row in rows]
        plan.append((task, launch_id, learner_ids, rows))
        print(f"  {task_id} → {launch_id} · {len(learner_ids)} learner(s)"
              f"{' · launch row exists' if launch_id in launches else ''}")

    if args.dry_run:
        print(f"\ndry run — would create {len(plan)} launch(es) and move "
              f"{len(stale_acts)} activation(s) + {len(stale_atts)} attempt(s)")
        return 0

    acts = _get_collection_named(store.ACTIVATIONS)
    atts = _get_collection_named(store.ATTEMPTS)
    moved_acts = moved_atts = 0

    for task, launch_id, learner_ids, rows in plan:
        task_id = str(task["_id"])
        if launch_id not in launches:
            target = task.get("target") or {}
            await _get_collection_named(store.LAUNCHES).update_one(
                {"_id": launch_id},
                {"$setOnInsert": {
                    "_id": launch_id,
                    "task_id": task_id,
                    "teacher_id": task.get("teacher_id"),
                    "group_id": task.get("group_id"),
                    "seq": 1,
                    "targets": [target] if target.get("id") else [],
                    "learner_ids": learner_ids,
                    # A task that was closed stays closed; anything else was
                    # accepting work and still is.
                    "status": "closed" if task.get("status") == "closed" else "active",
                    "due_at": task.get("deadline"),
                    # The oldest paper is when this opening actually happened.
                    "opened_at": min((str(row.get("assigned_at") or "") for row in rows),
                                     default=task.get("created_at")),
                    "closed_at": None,
                }},
                upsert=True,
            )

        for row in rows:
            learner_id = str(row.get("learner_id"))
            new_id = store.activation_id(launch_id, learner_id)
            await acts.update_one(
                {"_id": new_id},
                {"$set": {**row, "_id": new_id, "launch_id": launch_id}},
                upsert=True,
            )
            if row["_id"] != new_id:
                await acts.delete_one({"_id": row["_id"]})
            moved_acts += 1

            old_attempt = next(
                (entry for entry in stale_atts
                 if entry.get("task_id") == task_id
                 and str(entry.get("learner_id")) == learner_id), None)
            if old_attempt is not None:
                await atts.update_one(
                    {"_id": new_id},
                    {"$set": {**old_attempt, "_id": new_id, "launch_id": launch_id}},
                    upsert=True,
                )
                if old_attempt["_id"] != new_id:
                    await atts.delete_one({"_id": old_attempt["_id"]})
                moved_atts += 1

    orphans = [row for row in stale_atts
               if not any(row.get("task_id") == str(task["_id"])
                          and str(row.get("learner_id")) in learners
                          for task, _, learners, _ in plan)]
    if orphans:
        # An attempt with no activation should not exist — it means a child
        # wrote a paper they were never given. Reported, never deleted.
        print(f"\n⚠️  {len(orphans)} attempt(s) with no matching activation, left as they are:")
        for row in orphans[:10]:
            print(f"     {row['_id']}")

    print(f"\nmoved {moved_acts} activation(s) and {moved_atts} attempt(s) "
          f"into {len(plan)} launch(es)")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(sys.argv[1:])))
