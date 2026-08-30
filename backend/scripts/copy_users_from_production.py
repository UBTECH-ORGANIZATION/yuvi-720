"""Copy the *accounts* from production into dev — and nothing else.

Dev needs the same people to be able to sign in; it does not need their
learning. This copies the `users` collection only: no events, no brains, no
mastery, no conversations, no wellbeing. Nothing a child ever produced.

Production is read through a URI passed in explicitly, so the connection lives
for the length of this one command and never lands in a `.env` file:

    cd backend
    SPARK_PRODUCTION_MONGODB_URI='mongodb+srv://…yuvi720…' \
        ./.venv/bin/python scripts/copy_users_from_production.py --dry-run
    SPARK_PRODUCTION_MONGODB_URI='mongodb+srv://…yuvi720…' \
        ./.venv/bin/python scripts/copy_users_from_production.py

The destination is whatever `MONGODB_CONNECTION_STRING` resolves to, and the
script refuses to run if that is the production cluster — the one direction this
must never go.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.env import ensure_env_loaded  # noqa: E402  (loads .env for scripts)

ensure_env_loaded()

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from app.core import database as db_config  # noqa: E402

SOURCE_ENV = "SPARK_PRODUCTION_MONGODB_URI"
SOURCE_DATABASE = "yuvi720"
COLLECTION = "users"


def _source_uri() -> str:
    uri = (os.environ.get(SOURCE_ENV) or "").strip()
    if not uri:
        sys.exit(
            f"Set {SOURCE_ENV} to the production connection string for this one "
            "command. It is deliberately not read from .env."
        )
    if not db_config.is_production_host(db_config.connection_host(uri)):
        sys.exit(
            f"{SOURCE_ENV} does not point at the production cluster "
            f"({db_config.connection_host(uri) or 'unparseable'}). Nothing to copy."
        )
    return uri


def _destination() -> tuple[str, str, str]:
    db_config.verify_configuration()
    uri = db_config.connection_string()
    host = db_config.connection_host(uri)
    if db_config.is_production_host(host):
        sys.exit("Refusing to write into production. Point this laptop at the dev cluster.")
    return uri, host, db_config.database_name()


async def copy(dry_run: bool, source_database: str) -> int:
    source_uri = _source_uri()
    dest_uri, dest_host, dest_db = _destination()

    source = AsyncIOMotorClient(source_uri, serverSelectionTimeoutMS=20000)
    destination = AsyncIOMotorClient(dest_uri, serverSelectionTimeoutMS=20000)
    try:
        accounts = await source[source_database][COLLECTION].find({}).to_list(length=None)
        print(f"production {COLLECTION}: {len(accounts)}")
        print(f"destination      : {dest_host} / {dest_db}")

        for account in accounts:
            name = account.get("username") or account.get("_id")
            roles = ", ".join(account.get("roles") or []) or "—"
            if dry_run:
                print(f"  would copy {name} ({roles})")
                continue
            await destination[dest_db][COLLECTION].replace_one(
                {"_id": account["_id"]}, account, upsert=True
            )
            print(f"  ✅ {name} ({roles})")

        if dry_run:
            print("dry run — nothing written")
        else:
            print(f"✅ {len(accounts)} accounts copied; no learning data was read")
    finally:
        source.close()
        destination.close()
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="List the accounts, write nothing")
    parser.add_argument("--source-database", default=SOURCE_DATABASE)
    args = parser.parse_args()
    raise SystemExit(asyncio.run(copy(args.dry_run, args.source_database)))


if __name__ == "__main__":
    main()
