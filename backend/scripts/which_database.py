"""Report the database this process actually reaches.

Work item 248 asks for the environment to be verified "by checking what the
connected host actually is, not by reading config". So this script does not
print the connection string back at you: it opens the connection, asks the
server who it is, and prints that.

    python -m scripts.which_database

Exit codes: 0 when the connection succeeded, 1 when it did not. It also fails
when a non-production process turns out to be talking to production, which is
the case the guard in ``app.core.database`` exists to prevent.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core import database as db_config  # noqa: E402


async def _report() -> int:
    db_config.verify_configuration()

    if db_config.storage_mode() == db_config.JSON:
        print(db_config.announce())
        print("No database is in use; learner state lives in backend/.runtime/*.json")
        return 0

    from motor.motor_asyncio import AsyncIOMotorClient  # noqa: PLC0415

    client = AsyncIOMotorClient(
        db_config.connection_string(),
        serverSelectionTimeoutMS=10_000,
    )
    try:
        await client.admin.command("ping")
        # `hello` names the node that answered, which is the fact we are after:
        # the host the driver resolved to, not the host someone typed in .env.
        hello = await client.admin.command("hello")
        try:
            address = client.address
        except Exception:  # noqa: BLE001 - a sharded topology has no single address
            address = None
        database = client[db_config.database_name()]
        collections = sorted(await database.list_collection_names())
    except Exception as exc:  # noqa: BLE001 - the reason is the whole output
        print(f"❌ could not reach {db_config.connection_host()}: {type(exc).__name__}: {exc}")
        return 1
    finally:
        client.close()

    configured_host = db_config.connection_host()
    connected_node = (
        f"{address[0]}:{address[1]}" if address
        else str(hello.get("me") or hello.get("primary") or "unknown")
    )
    shown = collections[:10]
    listing = ", ".join(shown) + (f", … (+{len(collections) - len(shown)})" if len(collections) > len(shown) else "")
    print(f"environment      : {db_config.environment_name()}")
    print(f"configured host  : {configured_host}")
    print(f"connected node   : {connected_node}")
    print(f"database         : {db_config.database_name()}")
    print(f"collections ({len(collections)}) : {listing or '(empty)'}")

    if db_config.is_production_host(configured_host):
        print("🚨 this is the PRODUCTION cluster")
        return 0 if db_config.is_production() else 1
    print("✅ not the production cluster")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_report()))
