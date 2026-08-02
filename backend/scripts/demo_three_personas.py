"""Three learners, one unit, three journeys — the 13/8 review, reproducible.

Run against a live backend. Each persona is built from GENUINE evidence: real
xAPI statements posted to our ingest, never injected brain state, so what you see
is what the platform would do for a real child. Then it reads each learner's
catalog through the same endpoint the app uses and prints the paths side by side.

    ./.venv/bin/python scripts/demo_three_personas.py                 # local
    ./.venv/bin/python scripts/demo_three_personas.py --reset         # wipe first

What to look for: three different `steps_total`, three different station lists,
and a `recovery_after_fail` node in the struggling learner's path that the other
two never see. Note that no mastery level and no score appears anywhere in the
learner payload — that is the point, and `test_learning_path.py` asserts it.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from app.brain.repository import apply_brain_updates, get_brain  # noqa: E402
from app.services import kata_catalog, learning_path  # noqa: E402
from app.services.events import get_unit_events, ingest_statement  # noqa: E402

UNIT_ID = "methodica-science-mass-measure-01"
OBJECTIVE_ID = "MOE.SCI.G7.CHEM.BODY-MAT-PROP.MASS-VOL.MASS-PRACTICE"


def statement(learner: str, object_id: str, verb: str, *, success: bool, scaled: float,
              tag: str, at: datetime) -> dict:
    return {
        "id": f"demo-{learner}-{tag}",
        "actor": {"account": {"name": learner, "homePage": "https://spark.yuvilab.ai"}},
        "verb": {"id": f"http://adlnet.gov/expapi/verbs/{verb}"},
        "object": {"id": f"https://kata.co.il/content/{object_id}"},
        "result": {"success": success, "score": {"scaled": scaled}},
        # Timing is evidence, not decoration: answers fired milliseconds apart are
        # read as rapid guessing and advance nothing but the attempt count — which
        # is correct, and which a demo without timestamps runs straight into.
        "timestamp": at.isoformat(),
    }


# A persona is a SESSION, not a verdict: the questions they answered and how each
# component ended. Mastery is earned from that record the same way a real
# learner's is — one good component is not yet a track record, which is exactly
# why the profile has to be built from answers rather than declared.
PERSONAS: dict[str, list[tuple[str, list[tuple[bool, float]], bool | None, float]]] = {
    # learner: [(component, [(answer success, score)…], component success, score)]
    "demo-struggling": [
        ("01", [(False, 0.0), (True, 1.0), (False, 0.0), (False, 0.0)], True, 0.42),
        ("02", [(False, 0.0), (False, 0.0), (True, 1.0)], False, 0.64),
    ],
    # The middle learner has to END on a wobble, or three clean answers in a row
    # earn the confident band and they stop being the middle learner.
    "demo-middle": [
        ("01", [(True, 1.0), (True, 1.0), (False, 0.0), (True, 0.6)], True, 0.70),
    ],
    "demo-excellent": [
        ("01", [(True, 1.0)] * 6, True, 0.96),
    ],
}


async def seed(learner: str, rows, *, run: str) -> None:
    # Walk a plausible session backwards from an hour ago, ~40s per answer.
    clock = datetime.now(timezone.utc) - timedelta(hours=1)
    for suffix, answers, success, scaled in rows:
        component_id = f"{UNIT_ID}-{suffix}"
        # `src` matters: the ADL verb IRIs Kata sends are only mapped for a
        # provider launch, so without it the statement is dropped as
        # `verb_not_in_moe_list` — exactly as a forged one would be. `obj` is the
        # learning goal the evidence accrues to; without it mastery never moves.
        launch = {"cmp": component_id, "lid": learner, "unit": UNIT_ID,
                  "obj": OBJECTIVE_ID, "src": "kata", "sid": f"demo-{learner}-{suffix}"}
        for index, (ok, score) in enumerate(answers, start=1):
            clock += timedelta(seconds=42)
            await ingest_statement(
                statement(learner, f"{component_id}-00{index}", "answered",
                          success=ok, scaled=score, tag=f"{run}-{suffix}-q{index}", at=clock),
                launch,
            )
        clock += timedelta(seconds=25)
        await ingest_statement(
            statement(learner, component_id, "completed",
                      success=success, scaled=scaled, tag=f"{run}-{suffix}-done", at=clock),
            launch,
        )


async def show(learner: str) -> dict:
    await kata_catalog.ensure_loaded()
    unit = kata_catalog.get_unit(UNIT_ID) if hasattr(kata_catalog, "get_unit") else None
    if unit is None:
        unit = kata_catalog._SNAPSHOT["units"][UNIT_ID]
    events = await get_unit_events(learner, UNIT_ID)
    brain = await get_brain(learner)
    return learning_path.project(dict(unit), brain, events)


def render(learner: str, plan: dict) -> None:
    print(f"\n\033[1m{learner}\033[0m — {plan['steps_total']} steps "
          f"({plan['steps_completed']} walked), state={plan['unit_state']}, "
          f"band={plan.get('_band')}")
    for node in plan["components"]:
        if not node["on_path"]:
            print(f"      ·  (off-path) {node['component_id'][-2:]} "
                  f"{node['progress_state']:<10} {node['progress_reason']['code']}")
            continue
        mark = {"completed": "✓", "current": "★", "locked": "…"}.get(node["progress_state"], "·")
        print(f"   {node['path_index'] + 1}. {mark} {node['component_id'][-2:]} "
              f"visit={node['visit']} {node['progress_state']:<10} "
              f"{node['progress_reason']['code']}")
    print(f"   → next: {plan['next_path_node_id']}")


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true", help="clear the demo learners first")
    args = parser.parse_args()

    if args.reset:
        # Clearing mastery alone is not a reset: the events are append-only, so
        # yesterday's run still counts as evidence and the personas drift. This
        # deletes ONLY the `demo-*` learners this script created.
        from app.services.events import _events_collection
        for learner in PERSONAS:
            await apply_brain_updates(learner, {"mastery": {}, "current_state": {}})
        collection = await _events_collection()
        if collection is not None:
            result = await collection.delete_many({"learner_id": {"$in": list(PERSONAS)}})
            print(f"reset: cleared mastery + {result.deleted_count} demo events")
        else:
            print("reset: cleared mastery (no events collection available)")

    # A fresh run id keeps statements from being acked as replays, so the
    # demo can be re-run on the day without silently doing nothing.
    run = datetime.now(timezone.utc).strftime("%m%d%H%M%S")
    for learner, rows in PERSONAS.items():
        await seed(learner, rows, run=run)

    plans = {learner: await show(learner) for learner in PERSONAS}
    for learner, plan in plans.items():
        render(learner, plan)

    totals = {learner: plan["steps_total"] for learner, plan in plans.items()}
    routes = {learner: tuple(n["component_id"] for n in plan["components"] if n["on_path"])
              for learner, plan in plans.items()}
    print("\n\033[1mtotals:\033[0m", totals)
    print("\033[1mdistinct routes:\033[0m", len(set(routes.values())), "of", len(routes))
    if len(set(routes.values())) < len(routes):
        print("⚠️  two personas walked the same route — check the unit metadata "
              "(isRequired / recommendedAfterFail) before the review")


if __name__ == "__main__":
    asyncio.run(main())
