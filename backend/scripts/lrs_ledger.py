"""Read-only inspector for the outbound MoE-LRS audit ledger (`lrs_outbox`).

Used to *evidence* a manual UI test run — it never sends or builds a statement.

    cd backend && ./.venv/bin/python scripts/lrs_ledger.py --since 2026-09-07T12:59:36Z
    cd backend && ./.venv/bin/python scripts/lrs_ledger.py --since ... --json out.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.env import ensure_env_loaded  # noqa: E402

ensure_env_loaded()

from app.brain.repository import _get_collection_named  # noqa: E402

TEST_EXIDS = ["1020000001", "1020000002"]


def _object_type(statement: dict) -> str:
    definition = ((statement.get("object") or {}).get("definition") or {})
    return (definition.get("type") or "").rsplit("/", 1)[-1]


def _verb(statement: dict) -> str:
    return ((statement.get("verb") or {}).get("id") or "").rsplit("/", 1)[-1]


def _application_version(statement: dict) -> str:
    extensions = ((statement.get("context") or {}).get("extensions") or {})
    for key, value in extensions.items():
        if str(key).endswith("/applicationVersion"):
            return str(value)
    return ""


async def run(
    since: str,
    exids: list[str],
    as_json: str | None,
    limit: int,
    *,
    status: str | None = None,
    app_version: str | None = None,
    validate: bool = False,
) -> int:
    collection = _get_collection_named("lrs_outbox")
    query: dict = {"created_at": {"$gte": since}}
    if exids:
        query["exidentifier"] = {"$in": exids}
    if status:
        query["status"] = status
    rows = [row async for row in collection.find(query).sort("created_at", 1).limit(limit)]
    if app_version:
        # The build that filed the statement (`applicationVersion` on `enter`):
        # the same ledger serves localhost and the dev slot, and this is what
        # tells their rows apart. Rows without the extension (anything but
        # `enter`) are kept by their session — a session opened by that build.
        sessions = {
            row.get("session_id") for row in rows
            if _application_version(row.get("statement") or {}).startswith(app_version)
        }
        rows = [row for row in rows if row.get("session_id") in sessions]

    print(f"{len(rows)} statements since {since} for {exids or 'all actors'}\n")
    print(f"{'created_at':<22} {'status':<8} {'exid':<12} {'object':<22} {'verb':<12} timestamp")
    problems_total = 0
    for row in rows:
        statement = row.get("statement") or {}
        print(
            f"{str(row.get('created_at')):<22} {str(row.get('status')):<8} "
            f"{str(row.get('exidentifier')):<12} {_object_type(statement):<22} {_verb(statement):<12} "
            f"{statement.get('timestamp')}"
        )
        if validate:
            from app.services.lrs.validate import validate_statement

            for problem in validate_statement(statement):
                problems_total += 1
                print(f"{'':>22} ✗ {problem}")
    if validate:
        print(f"\n{'✅ every statement validates' if not problems_total else f'❌ {problems_total} problem(s)'} against spec v1.1")

    if as_json:
        Path(as_json).parent.mkdir(parents=True, exist_ok=True)
        Path(as_json).write_text(
            json.dumps(
                [
                    {
                        "id": row.get("_id"),
                        "status": row.get("status"),
                        "created_at": row.get("created_at"),
                        "exidentifier": row.get("exidentifier"),
                        "learner_id": row.get("learner_id"),
                        "attempts": row.get("attempts"),
                        "last_error": row.get("last_error"),
                        "statement": row.get("statement"),
                    }
                    for row in rows
                ],
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"\n📄 {as_json}")
    return 1 if problems_total else 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect the lrs_outbox ledger")
    parser.add_argument("--since", required=True, help="ISO-8601 UTC lower bound")
    parser.add_argument("--exid", action="append", default=None)
    parser.add_argument("--all-actors", action="store_true")
    parser.add_argument("--json", dest="as_json", default=None)
    parser.add_argument("--limit", type=int, default=5000)
    parser.add_argument("--status", default=None, help="pending | sent | rejected | failed")
    parser.add_argument("--app-version", default=None, help="keep the sessions opened by this build (sha prefix)")
    parser.add_argument("--validate", action="store_true", help="check every statement against spec v1.1")
    args = parser.parse_args()
    exids = [] if args.all_actors else (args.exid or TEST_EXIDS)
    raise SystemExit(asyncio.run(run(
        args.since, exids, args.as_json, args.limit,
        status=args.status, app_version=args.app_version, validate=args.validate,
    )))


if __name__ == "__main__":
    main()
