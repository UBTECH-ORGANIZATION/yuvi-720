"""Mint real player launches for named components, for the browser harnesses.

    .venv/bin/python scripts/mint_launches.py ENG.G7.FAMILY.VOCAB-02 …

Writes ``/tmp/player_launches.json`` as ``{componentId: url}``. Each run uses a
fresh learner id, so a harness always starts on screen one — resume is a feature
for a learner and a source of flakiness for a test that reruns.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import kata_catalog, native_content  # noqa: E402
from app.services.events import mint_launch  # noqa: E402

OUT = Path("/tmp/player_launches.json")
BASE = os.environ.get("PLAYER_BASE_URL", "http://localhost:8720")


async def main(component_ids: list[str]) -> int:
    await kata_catalog.ensure_loaded(force=True)
    run = f"harness-{int(time.time())}"
    urls: dict[str, str] = {}

    for component_id in component_ids:
        unit = next(
            (u for u in kata_catalog.all_units()
             if any(c["id"] == component_id for c in u["components"])),
            None,
        )
        if not unit:
            print(f"✗ no such component: {component_id}")
            return 2
        component = next(c for c in unit["components"] if c["id"] == component_id)
        launch = mint_launch(
            f"{run}-{component_id}",
            objective_id=unit.get("objective_id"),
            component_id=component_id,
            unit_id=unit["id"],
            subject=unit.get("subject"),
            is_assessment=component.get("is_assessment"),
            source=native_content.SOURCE,
        )
        context = await native_content.create_launch_context(
            component_id=component_id,
            student_id=launch["slxapi"]["actor"]["account"]["name"],
            platform_url="",
            lrs_endpoint=launch["slxapi"]["endpoint"],
            lrs_auth=launch["slxapi"]["auth"],
            slxapi=launch["slxapi"],
        )
        urls[component_id] = f"{BASE}{context['launch_url']}"

    OUT.write_text(json.dumps(urls, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✓ {len(urls)} launch(es) → {OUT}  (learner {run})")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(sys.argv[1:] or ["ENG.G7.FAMILY.VOCAB-02"])))
