"""Idempotently publish the approved AI pricing catalog to MongoDB."""

from __future__ import annotations

import argparse
import asyncio
import os

import certifi
from motor.motor_asyncio import AsyncIOMotorClient

from backend.pricing_catalog import pricing_documents


async def sync_pricing(*, dry_run: bool) -> int:
    connection_string = os.getenv("MONGODB_CONNECTION_STRING", "").strip()
    database_name = os.getenv("MONGODB_DATABASE", "yuvi720").strip() or "yuvi720"
    documents = pricing_documents()
    if dry_run:
        for document in documents:
            print(
                f"✅ {document['deployment']}: "
                f"input=${document['input_usd_per_unit']}/1M, "
                f"cached=${document['cached_input_usd_per_unit']}/1M, "
                f"output=${document['output_usd_per_unit']}/1M"
            )
        return len(documents)
    if not connection_string:
        raise RuntimeError("MONGODB_CONNECTION_STRING is required")

    client = AsyncIOMotorClient(
        connection_string,
        tlsCAFile=certifi.where(),
        serverSelectionTimeoutMS=5000,
        connectTimeoutMS=5000,
        socketTimeoutMS=10000,
    )
    try:
        collection = client[database_name]["ai_usage_pricing"]
        for document in documents:
            await collection.update_one(
                {"pricing_id": document["pricing_id"]},
                {"$set": document},
                upsert=True,
            )
        await collection.create_index("pricing_id", unique=True, name="pricing_id_unique")
        await collection.create_index(
            [("provider", 1), ("deployment", 1), ("meter", 1), ("effective_from", -1)],
            name="pricing_lookup",
        )
        print(f"✅ Synchronized {len(documents)} effective-dated AI pricing records")
        return len(documents)
    finally:
        client.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    arguments = parser.parse_args()
    asyncio.run(sync_pricing(dry_run=arguments.dry_run))


if __name__ == "__main__":
    main()