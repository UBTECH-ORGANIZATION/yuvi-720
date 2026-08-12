"""Build a few real tasks against the live catalogue, for looking at.

    python scripts/seed_demo_tasks.py --list          # what the catalogue has
    python scripts/seed_demo_tasks.py --dry-run       # what it would build
    python scripts/seed_demo_tasks.py                 # build them

Not a fixture and not a test: this makes **real model calls at the strong
tier** and writes real rows, because the thing being debugged is what the
generator produces from real curriculum material. A hand-written fixture would
be a picture of the bug rather than the bug.

The tasks are left at `ready` — generated, nobody sent them. That is the state
the review screen exists for, and launching them would put homework in six
children's dashboards to demonstrate a preview.

Every task is grounded on a lesson from the live catalogue: the ids are
resolved by *looking them up*, never pasted in, so a re-imported unit produces
a clear "no lesson matched" rather than a task quietly grounded on nothing.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: F401  — loads .env before anything reads a setting

from app.brain import org
from app.services import kata_catalog
from app.services.tasks import generate, spec, store

TEACHER = "gal"
GROUP = "gal-class"

#: One recipe per task. `subject` + `pick` choose the lesson from whatever the
#: catalogue actually holds today; nothing here hard-codes a component id.
RECIPES = [
    {
        "key": "math-coords",
        "subject": "math",
        "pick": "first",
        "title": "מערכת צירים — לזהות ולסמן נקודות",
        "topic": "קריאה וכתיבה של שיעורי נקודה במערכת צירים, ברביע הראשון",
        "difficulty": "easy",
        "components": ["presentation", "practice"],
        "counts": {"presentation": {"slide_count": 6}, "practice": {"question_count": 6}},
        "notes": (
            "הכיתה מתבלבלת בין הציר האופקי לאנכי וכותבת את השיעורים בסדר הפוך. "
            "כדאי להדגיש שוב ושוב שהערך הראשון הוא תמיד x. "
            "להישאר ברביע הראשון ובמספרים שלמים, בלי מספרים שליליים."
        ),
    },
    {
        "key": "science-mass",
        "subject": "science",
        "pick": "first",
        "title": "מסה ונפח — מה נמדד במה",
        "topic": "הבחנה בין מסה לנפח, ויחידות המדידה של כל אחד",
        "difficulty": "medium",
        "components": ["presentation", "interactive", "practice"],
        "counts": {"presentation": {"slide_count": 7},
                   "interactive": {"block_count": 3},
                   "practice": {"question_count": 6}},
        "notes": (
            "רוב הכיתה מחליפה בין מסה למשקל ובין נפח לשטח. "
            "כדאי להתחיל מדוגמאות מוחשיות מהמטבח ומהחצר, ורק אחר כך להגיע ליחידות. "
            "בפעילות הגרירה כדאי להתמקד בהתאמה בין גודל ליחידת המדידה שלו."
        ),
    },
    {
        "key": "math-coords-test",
        "subject": "math",
        "pick": "last",
        "title": "מבחן קצר — מערכת צירים",
        "topic": "כתיבת שיעורי נקודה וסימון נקודה לפי שיעוריה",
        "difficulty": "medium",
        "components": ["test"],
        "counts": {"test": {"question_count": 8, "time_limit_minutes": 20,
                            "passing_grade": 60, "show_answers_after": True,
                            "retries": 1}},
        "notes": (
            "מבחן סיכום קצר על מה שנלמד בשיעורי מערכת הצירים. "
            "שאלות קצרות וברורות, בלי טקסט מיותר, ובלי נושאים שלא נלמדו."
        ),
    },
]


def _lessons(subject: str) -> list[dict]:
    """Every lesson in this subject, in curriculum order."""
    rows = [row for row in kata_catalog.all_components()
            if row.get("subject") == subject and row.get("id")]
    rows.sort(key=lambda row: (str(row.get("unit_id") or ""),
                               row.get("order") if row.get("order") is not None else 999))
    return rows


def _describe(recipe: dict, lesson: dict | None) -> str:
    if lesson is None:
        return f"  {recipe['key']}: no {recipe['subject']} lesson in the catalogue"
    title = kata_catalog.component_title(lesson["id"], "he") or lesson["id"]
    objective = kata_catalog.objective_title(lesson.get("objective_id"), "he") or "—"
    return (f"  {recipe['key']}: {recipe['title']}\n"
            f"      lesson    {title}  [{lesson['id']}]\n"
            f"      objective {objective}\n"
            f"      parts     {', '.join(recipe['components'])}")


async def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", action="store_true",
                        help="print the catalogue's lessons and exit")
    parser.add_argument("--dry-run", action="store_true",
                        help="resolve the lessons and print the plan, build nothing")
    parser.add_argument("--teacher", default=TEACHER)
    parser.add_argument("--group", default=GROUP)
    args = parser.parse_args(argv)

    await kata_catalog.ensure_loaded()

    if args.list:
        for subject in sorted({row.get("subject") for row in kata_catalog.all_components()}):
            print(f"\n{subject}:")
            for lesson in _lessons(subject):
                title = kata_catalog.component_title(lesson["id"], "he") or "—"
                print(f"  {lesson['id']}\n      {title}")
        return 0

    learners = await org.learners_in_group(args.group)
    print(f"\nteacher {args.teacher} · group {args.group} · {len(learners)} learners")
    if not learners:
        # Not fatal — a task can exist for an empty class — but it is almost
        # always a mistyped group id, and finding out after three strong-tier
        # generations is the wrong order.
        print("⚠️  that group has no learners; check the id before spending on generation")

    plan = []
    for recipe in RECIPES:
        rows = _lessons(recipe["subject"])
        lesson = None
        if rows:
            lesson = rows[0] if recipe["pick"] == "first" else rows[-1]
        print(_describe(recipe, lesson))
        if lesson is not None:
            plan.append((recipe, lesson))

    if args.dry_run:
        print(f"\ndry run — would build {len(plan)} task(s)")
        return 0
    if not plan:
        print("\nnothing to build")
        return 1

    print(f"\nbuilding {len(plan)} task(s) — this makes real model calls\n")
    for recipe, lesson in plan:
        task_spec = spec.normalize_spec({
            "title": recipe["title"],
            "topic": recipe["topic"],
            "language": "he",
            "difficulty": recipe["difficulty"],
            "notes": recipe["notes"],
            "components": recipe["components"],
            "source": {"component_id": lesson["id"],
                       "objective_id": lesson.get("objective_id")},
            **recipe["counts"],
        })
        task = await store.create_task(
            teacher_id=args.teacher, group_id=args.group,
            target={"kind": "group", "id": args.group},
            spec=task_spec,
        )
        task_id = task["_id"]
        print(f"  {recipe['key']} → {task_id}")
        try:
            await generate.generate_task(task_id)
        except Exception as exc:
            print(f"    ✗ {type(exc).__name__}: {exc}")
            continue
        final = await store.get_task(task_id)
        content = await store.all_content(task_id)
        parts = ", ".join(
            f"{name}×{len(body.get('slides') or body.get('questions') or body.get('blocks') or [])}"
            for name, body in sorted(content.items()))
        print(f"    ✓ {final.get('status')} · {parts}")
        for entry in final.get("generation") or []:
            if not entry.get("ok"):
                print(f"    ⚠️ {entry['component']}: {entry.get('detail', '')[:120]}")

    print("\ndone — the tasks are at `ready`. Open /teacher/tasks to review them.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(sys.argv[1:])))
