"""MoE-LRS staging connectivity check — run this FIRST, before any wiring.

1. Fetches an OAuth2 client-credentials token from LRS_TOKEN_URL.
2. Builds a minimal `session enter` statement (stub staging identity).
3. POSTs it to LRS_STATEMENTS_URL and prints the HTTP status + response
   (expected: 200 with an array containing the statement id, or 204).

Run:  cd backend && ./.venv/bin/python scripts/lrs_smoke_check.py
      (add --dry-run to only build + print the statement, no network)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.lrs import auth, client, config, statements  # noqa: E402


async def main(dry_run: bool) -> int:
    if not config.is_enabled():
        print("❌ LRS not enabled/configured — check LRS_* vars in backend/.env")
        return 1

    identity = {
        "exidentifier": config.test_exidentifier(),
        "school": config.default_school() or None,
        "nmm": config.default_nmm() or None,
    }
    session_id = str(uuid.uuid4())
    statement = statements.session_enter(
        identity,  # type: ignore[arg-type]
        session_id,
        device={"deviceType": "Desktop", "platform": "Web"},
    )
    print("── statement ──")
    print(json.dumps(statement, ensure_ascii=False, indent=2))
    if dry_run:
        print("── dry run: skipping network ──")
        return 0

    print(f"── token: POST {config.token_url()} ──")
    try:
        token = await auth.get_access_token()
        print(f"✅ access_token acquired ({len(token)} chars)")
    except auth.LrsAuthError as exc:
        print(f"❌ token fetch failed: {exc}")
        return 2

    print(f"── statement: POST {config.statements_url()} ──")
    try:
        response = await client.post_statement(statement)
        print(f"✅ HTTP {response['status']}")
        print(f"   body: {json.dumps(response['body'], ensure_ascii=False)}")
        return 0
    except client.LrsError as exc:
        print(f"❌ send failed: {exc.code} (HTTP {exc.status_code})")
        return 3


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    raise SystemExit(asyncio.run(main(parser.parse_args().dry_run)))
