"""Mint a launch for the lomda player and hand the URL to the browser driver.

Test-only: it also wipes the throwaway learner's events + position so the driver
can assert the FIRST-run behaviour (a resumed session is a different test).

    .venv/bin/python scripts/mint_player_launch.py [component_id] [--keep]
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.brain.repository import _get_collection_named, apply_brain_updates  # noqa: E402
from app.services import kata_catalog, native_content  # noqa: E402
from app.services.events import mint_launch  # noqa: E402

LEARNER = "en-demo-check"
OUT = Path("/tmp/player_url.txt")


async def reset() -> None:
    events = _get_collection_named("learning_events")
    if events is not None:
        result = await events.delete_many({"learner_id": LEARNER})
        print(f"cleared {result.deleted_count} events for {LEARNER}")
    await apply_brain_updates(LEARNER, {
        "current_state.component_id": None,
        "current_state.item_id": None,
        "current_state.question_id": None,
    })


async def main() -> None:
    component_id = next((a for a in sys.argv[1:] if not a.startswith("-")), "ENG.G7.FAMILY.LISTEN-02")
    if "--keep" not in sys.argv:
        await reset()

    await kata_catalog.ensure_loaded(force=True)
    unit, component = await native_content.resolve_component(component_id)
    launch = mint_launch(
        LEARNER,
        objective_id=unit["objective_id"], component_id=component["id"],
        unit_id=unit["id"], subject=unit["subject"],
        is_assessment=component["is_assessment"], source=native_content.SOURCE,
    )
    context = await native_content.create_launch_context(
        component_id=component["id"],
        student_id=launch["slxapi"]["actor"]["account"]["name"],
        platform_url="", lrs_endpoint=launch["slxapi"]["endpoint"],
        lrs_auth=launch["slxapi"]["auth"], slxapi=launch["slxapi"],
    )
    OUT.write_text(f"http://localhost:8722{context['launch_url']}&lang=he", encoding="utf-8")
    print(f"{component['id']} → {OUT}")


if __name__ == "__main__":
    asyncio.run(main())
