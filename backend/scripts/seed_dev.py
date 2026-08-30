"""Fill an empty dev database with a realistic class, from scratch.

Work item 248: dev has its own cluster now, so it starts empty. Nobody should
answer that by copying production — those are real children. Instead this runs
the existing seed scripts, in the order their dependencies require, so a fresh
dev cluster ends up with a school, a roster, two months of history and enough
shaped variety for every teacher surface to have something true to show.

    cd backend && ./.venv/bin/python scripts/seed_dev.py --dry-run
    cd backend && ./.venv/bin/python scripts/seed_dev.py

Every step is idempotent, so re-running is safe. The script refuses to run
against the production cluster at all: there is no flag for it, because there
is no reason to seed synthetic learners into production.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core import database as db_config  # noqa: E402

#: (name, argv) in dependency order. The org roster has to exist before anyone
#: is enrolled into it; the classes before the histories that reference them.
STEPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("org roster", ("scripts/seed_org.py", "--demo")),
    ("local accounts", ("scripts/seed_users.py",)),
    ("Gal's class", ("scripts/seed_gal_class.py",)),
    ("40-student class", ("scripts/seed_450_class.py", "--seed")),
    ("two months of history", ("scripts/seed_gal_history.py", "--seed", "--with-brain")),
    ("timetable and calendar", ("scripts/seed_gal_calendar.py",)),
    ("habit-score signals", ("scripts/seed_score_signals.py",)),
    ("wellbeing history", ("scripts/seed_wellbeing_flags.py",)),
)


def _refuse_production() -> None:
    db_config.verify_configuration()
    if db_config.storage_mode() == db_config.JSON:
        raise SystemExit(
            "This seeds a database, but SPARK_STORAGE=json is in force. "
            "Point MONGODB_CONNECTION_STRING at the dev cluster first."
        )
    if db_config.is_production_host():
        raise SystemExit(
            f"Refusing to seed synthetic learners into production "
            f"({db_config.connection_host()}). This script is for dev only."
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="list the steps and stop")
    parser.add_argument(
        "--from",
        dest="start_at",
        default=None,
        help="resume from this step name, after a failure part-way through",
    )
    args = parser.parse_args()

    _refuse_production()
    print(f"🗄️ seeding {db_config.describe_line()}")

    steps = list(STEPS)
    if args.start_at:
        names = [name for name, _ in steps]
        if args.start_at not in names:
            raise SystemExit(f"Unknown step '{args.start_at}'. Known: {', '.join(names)}")
        steps = steps[names.index(args.start_at):]

    if args.dry_run:
        for index, (name, argv) in enumerate(steps, start=1):
            print(f"  {index}. {name:24} {' '.join(argv)}")
        return 0

    for index, (name, argv) in enumerate(steps, start=1):
        print(f"\n── {index}/{len(steps)} {name} ──")
        result = subprocess.run(
            [sys.executable, *argv],
            cwd=BACKEND_DIR,
            check=False,
        )
        if result.returncode != 0:
            print(
                f"\n❌ '{name}' failed (exit {result.returncode}). "
                f"Fix it, then resume with --from '{name}'."
            )
            return result.returncode

    print("\n✅ dev database seeded — no production data was involved")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
