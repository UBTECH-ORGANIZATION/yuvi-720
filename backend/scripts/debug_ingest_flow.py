"""Debug: simulate the Kata relay and prove the current-question pipeline.

Reproduces "the hint didn't update when we moved questions" WITHOUT a tunnel by
posting a question sequence straight into the ingest (in-process, same code the
relay would hit), then rebuilding the coach bundle after each item to show that
`current_state` advances and `current.informationToBot` tracks the exact sub-item.

    python -m scripts.debug_ingest_flow

If the two items below print DIFFERENT informationToBot, the per-question context
works and the only thing missing in the real app is reachability (PUBLIC_APP_URL
+ a public tunnel) so Kata's relay can actually deliver these statements.
"""
from __future__ import annotations

import asyncio
import uuid
import warnings

warnings.filterwarnings("ignore")

RUN = uuid.uuid4().hex[:8]  # unique per run so idempotent ingest re-advances state

from app.brain.context_engine import build_coach_bundle
from app.brain.repository import get_brain
from app.services import events

LEARNER = "debug_ingest_flow_learner"
UNIT = "methodica-science-mass-measure-01"
COMPONENT = "methodica-science-mass-measure-01-04"  # multi-item practice component
OBJECTIVE = "MOE.SCI.G7.CHEM.BODY-MAT-PROP.MASS-VOL.MASS-PRACTICE"


def _stmt(object_id: str, verb: str, index: int, success: bool | None = None) -> dict:
    body = {
        "id": f"debug-ingest-{RUN}-{index}",
        "actor": {"account": {"name": events.normalize_learner_id(LEARNER)}},
        "verb": {"id": f"http://adlnet.gov/expapi/verbs/{verb}"},
        "object": {"id": object_id},
    }
    if success is not None:
        body["result"] = {"success": success}
    return body


async def _bundle_snapshot(label: str) -> None:
    brain = await get_brain(LEARNER)
    state = brain.get("current_state") or {}
    bundle = await build_coach_bundle(
        LEARNER,
        surface_context={"screen": "learning_lesson", "unit_id": UNIT, "component_id": COMPONENT},
    )
    current = bundle.get("current") or {}
    info = current.get("informationToBot") or ""
    q = current.get("question") or {}
    print(f"\n── {label} ──")
    print("  current_state.item_id     :", state.get("item_id"))
    print("  current_state.question_id :", state.get("question_id"))
    print("  bundle question.text      :", (q.get("text") or "(none)")[:110])
    print("  bundle question.correct   :", q.get("correct") or "(none)")
    print("  bundle informationToBot   :", (info[:110] + "…") if len(info) > 110 else info or "(none)")


async def main() -> None:
    launch = events.mint_launch(
        LEARNER, objective_id=OBJECTIVE, component_id=COMPONENT,
        unit_id=UNIT, subject="science", source="kata",
    )
    payload = events.verify_launch(launch["launch"])
    assert payload is not None

    steps = [
        (f"{COMPONENT}", "initialized", None),
        (f"{COMPONENT}-001/q1", "answered", False),   # screen 1 (indirect mass)
        (f"{COMPONENT}-003/q1", "answered", False),   # screen 3 (air-has-mass conclusion)
    ]
    for i, (obj, verb, success) in enumerate(steps):
        res = await events.ingest_statement(_stmt(obj, verb, i, success), payload)
        print(f"ingest {verb:11} {obj[-26:]:26} -> {res}")
        await _bundle_snapshot(f"after {verb} on {obj[-8:]}")

    print("\nIf the two informationToBot values differ, the per-question coach "
          "context is correct — the app only needs the relay to reach the backend.")


if __name__ == "__main__":
    asyncio.run(main())
