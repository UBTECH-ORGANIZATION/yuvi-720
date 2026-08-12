"""Measure what the task generator actually produces.

    python scripts/task_quality_report.py --existing
    python scripts/task_quality_report.py --generate 6 --subject math
    python scripts/task_quality_report.py --generate 6 --keep

The question this answers is the one that matters about the whole feature and
that nothing was asking: **does a generated task follow the teacher's brief and
the curriculum lesson it was built on?** `quality.review` answers it for one
task; this runs it across many and prints the distribution, so "the generator is
good" stops being an impression.

## Two modes, and they measure different things

`--existing` reviews the tasks that are already in the database. Cheap, and it
tells you about the material teachers actually made.

`--generate N` builds N fresh tasks from REAL catalogue lessons, picking a
different lesson each time, generates them end to end, reviews them, and
**deletes them again** unless `--keep`. This is the one that measures the
generator rather than the history: it controls the brief, so a low
`follows_brief` is the generator's, not a teacher's vague notes.

Generated tasks are created against a throwaway group id that no teacher owns,
so nothing this writes can appear on a real class's screen even if the cleanup
is interrupted. The cleanup runs in a `finally`.
"""

from __future__ import annotations

import argparse
import asyncio
import statistics
import sys
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: F401  — loads .env before anything reads a setting

from app.services.tasks import generate, quality, store

#: Not a real group. Anything created by this script is scoped to it, so a run
#: that dies before cleanup leaves rows nobody's class can reach.
BENCH_GROUP = "__quality_bench__"
BENCH_TEACHER = "__quality_bench__"

#: What the synthetic teacher asks for. Small on purpose: the measurement is
#: about fidelity to the brief, and forty questions costs eight times as much to
#: find that out.
BENCH_SPEC = {
    "components": ["presentation", "practice"],
    "presentation": {"slide_count": 5},
    "practice": {"question_count": 6},
    "difficulty": "medium",
    "language": "he",
}


def _bar(value: Optional[float]) -> str:
    if value is None:
        return "        —"
    filled = int(round(value))
    return f"{value:4.1f} " + "█" * filled + "·" * (10 - filled)


def _check_line(checks: dict[str, Any]) -> str:
    """Failing checks as a compact string. Passing ones are not news."""
    failed = [name for name, check in checks.items()
              if isinstance(check, dict) and check.get("ok") is False]
    return ", ".join(failed) if failed else "—"


async def _review_many(task_ids: list[str]) -> list[dict[str, Any]]:
    reports = []
    for task_id in task_ids:
        task = await store.get_task(task_id)
        title = ((task or {}).get("spec") or {}).get("title") or task_id
        print(f"  … {title}", flush=True)
        try:
            report = await quality.review(task_id)
        except Exception as exc:
            print(f"    ✗ {type(exc).__name__}: {exc}")
            continue
        reports.append({"task_id": task_id, "title": title, "report": report})
    return reports


def _print_table(rows: list[dict[str, Any]]) -> None:
    if not rows:
        print("\nNothing to report.")
        return

    print(f"\n{'task':<34} {'overall':>9}  {'brief':>5} {'lesson':>6} {'sound':>6}  failing checks")
    print("─" * 108)
    for row in rows:
        report = row["report"]
        scores = report.get("scores") or {}

        def score(name: str) -> str:
            entry = scores.get(name)
            return f"{entry['score']:5.1f}" if entry else "    —"

        print(f"{row['title'][:33]:<34} {_bar(report.get('overall'))}"
              f"  {score('follows_brief')} {score('matches_lesson')} {score('sound')}"
              f"  {_check_line(report.get('checks') or {})}")

    judged = [row["report"]["overall"] for row in rows
              if row["report"].get("overall") is not None]
    print("─" * 108)
    if judged:
        print(f"n={len(judged)}  mean={statistics.mean(judged):.2f}  "
              f"median={statistics.median(judged):.2f}  "
              f"min={min(judged):.1f}  max={max(judged):.1f}")
    else:
        print("No task was judged — the model was unavailable, so only the "
              "deterministic checks below ran.")

    # Per-check pass rate: the honest summary of the half that never guesses.
    print("\ncheck                       pass   fail   n/a")
    names: list[str] = []
    for row in rows:
        for name in (row["report"].get("checks") or {}):
            if name not in names:
                names.append(name)
    for name in names:
        outcomes = [(row["report"].get("checks") or {}).get(name, {}).get("ok")
                    for row in rows]
        print(f"{name:<26} {outcomes.count(True):>4}   "
              f"{outcomes.count(False):>4}   {outcomes.count(None):>4}")

    findings = [finding for row in rows for finding in (row["report"].get("findings") or [])]
    if findings:
        print(f"\n{len(findings)} findings:")
        for finding in findings[:20]:
            where = finding.get("component") or "?"
            item = finding.get("item")
            print(f"  · [{where}{f' {item}' if item is not None else ''}] {finding['problem']}")


async def run_existing(limit: int) -> None:
    from app.brain.repository import _get_collection_named

    handle = _get_collection_named(store.TASKS)
    if handle is None:
        print("No database configured.")
        return
    cursor = handle.find({"status": {"$in": ["ready", "live", "closed"]}}).limit(limit)
    task_ids = [str(row["_id"]) async for row in cursor]
    if not task_ids:
        print("No generated tasks in the database yet.")
        return
    print(f"Reviewing {len(task_ids)} existing tasks…")
    _print_table(await _review_many(task_ids))


async def _bench_briefs(count: int, subject: Optional[str]) -> list[dict[str, Any]]:
    """One brief per real catalogue lesson, so the grounding is genuine.

    A synthetic topic string would measure the generator against a made-up
    lesson, which is the one thing this script exists not to do.
    """
    from app.services import kata_catalog

    await kata_catalog.ensure_loaded()
    briefs: list[dict[str, Any]] = []
    for component in kata_catalog.all_components():
        if len(briefs) >= count:
            break
        if subject and component.get("subject") != subject:
            continue
        objective_id = component.get("objective_id")
        if not objective_id:
            continue
        lesson = kata_catalog.component_title(component.get("id"), "he") or ""
        objective = kata_catalog.objective_title(objective_id, "he") or ""
        if not lesson:
            continue
        briefs.append({
            **BENCH_SPEC,
            "title": lesson,
            "topic": objective or lesson,
            "notes": f"תרגול קצר בעקבות השיעור «{lesson}». להישאר בשיטה ובמושגים של השיעור.",
            "subject": component.get("subject"),
            "source": {"component_id": component.get("id"), "objective_id": objective_id},
        })
    return briefs


async def run_generated(count: int, subject: Optional[str], keep: bool) -> None:
    briefs = await _bench_briefs(count, subject)
    if not briefs:
        print("The catalogue has no lessons matching that filter.")
        return

    made: list[str] = []
    try:
        for index, brief in enumerate(briefs, start=1):
            print(f"[{index}/{len(briefs)}] generating “{brief['title']}” …", flush=True)
            task = await store.create_task(
                teacher_id=BENCH_TEACHER, group_id=BENCH_GROUP, spec=brief)
            made.append(str(task["_id"]))
            try:
                # `generate_task` runs the quality review itself at the end, so
                # this is one pass rather than generate-then-measure.
                await generate.generate_task(str(task["_id"]))
            except Exception as exc:
                print(f"    ✗ generation failed: {type(exc).__name__}: {exc}")

        rows = []
        for task_id in made:
            task = await store.get_task(task_id)
            if not task or not task.get("quality"):
                continue
            rows.append({
                "task_id": task_id,
                "title": (task.get("spec") or {}).get("title") or task_id,
                "report": task["quality"],
            })
        _print_table(rows)
    finally:
        if keep:
            print(f"\nKeeping {len(made)} benchmark tasks (group {BENCH_GROUP}).")
            return
        print(f"\nCleaning up {len(made)} benchmark tasks…")
        await _purge(made)


async def _purge(task_ids: list[str]) -> None:
    """Delete the task rows and their content. Nothing else can exist for them:
    a benchmark task is never launched, so there is no opening, no activation and
    no attempt to clean up — and the group id is one no teacher owns."""
    from app.brain.repository import _get_collection_named

    for name, query in (
        (store.TASKS, {"_id": {"$in": task_ids}}),
        (store.CONTENT, {"task_id": {"$in": task_ids}}),
    ):
        handle = _get_collection_named(name)
        if handle is None:
            continue
        try:
            result = await handle.delete_many(query)
            print(f"  {name}: {getattr(result, 'deleted_count', 0)} removed")
        except Exception as exc:
            print(f"  ⚠️ {name}: {type(exc).__name__}: {exc}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--existing", action="store_true",
                        help="review the tasks already in the database")
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--generate", type=int, default=0,
                        help="build N fresh tasks from real catalogue lessons")
    parser.add_argument("--subject", default=None)
    parser.add_argument("--keep", action="store_true",
                        help="do not delete the generated benchmark tasks")
    args = parser.parse_args()

    if args.generate:
        asyncio.run(run_generated(args.generate, args.subject, args.keep))
    elif args.existing:
        asyncio.run(run_existing(args.limit))
    else:
        parser.error("pass --existing or --generate N")


if __name__ == "__main__":
    main()
