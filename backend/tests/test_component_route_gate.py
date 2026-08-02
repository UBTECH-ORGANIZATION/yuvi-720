"""A component the learner's route has not opened must not launch.

720 F1 puts the route between components in the PLATFORM's hands ("התהלוך בין
הרכיבים מתבצע על ידי המערכת"). The roadmap projected that route and the UI
honoured it — but the launch endpoint did not. Measured 29/07: pasting a
component id in the URL minted a session for any component in the unit, so a
learner could walk straight into `…-01-05`, whose `isAssessment` success
establishes כשירות ביעד הלמידה under §3.3, without doing any of the practice the
mastery is meant to evidence.

Re-entry to a finished component stays open — §6 explicitly allows reviewing or
redoing one — as do recovery components and equal-order alternatives; none of
those ever project as `locked`.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import kata_client, learning_sessions  # noqa: E402


UNIT = {"id": "u-1", "objective_id": "OBJ", "subject": "science"}


def _roadmap(states: dict[str, str]) -> dict:
    return {"components": [{"id": cid, "progress_state": state} for cid, state in states.items()]}


class RouteGateTests(unittest.IsolatedAsyncioTestCase):
    async def _check(self, component_id: str, states: dict[str, str]):
        with patch.object(
            learning_sessions, "project_unit_roadmap",
            new=AsyncMock(return_value=_roadmap(states)),
        ):
            await learning_sessions._assert_component_reachable(
                "L", UNIT, {"id": component_id},
            )

    async def test_the_next_component_opens(self):
        await self._check("c-2", {"c-1": "completed", "c-2": "available"})

    async def test_the_one_they_are_on_opens(self):
        await self._check("c-2", {"c-2": "current"})

    async def test_a_finished_one_reopens(self):
        """§6 re-entry: review or redo must keep working."""
        await self._check("c-1", {"c-1": "completed", "c-2": "available"})

    async def test_a_locked_one_is_refused(self):
        with self.assertRaises(kata_client.KataError) as caught:
            await self._check("c-5", {"c-1": "completed", "c-2": "available", "c-5": "locked"})
        self.assertEqual(caught.exception.status_code, 409)

    async def test_the_assessment_is_refused_like_any_other_locked_step(self):
        with self.assertRaises(kata_client.KataError):
            await self._check("c-5", {"c-5": "locked"})

    async def test_a_component_missing_from_the_roadmap_is_allowed(self):
        """An alternative served outside the projected list is not 'locked'."""
        await self._check("c-9", {"c-1": "completed"})

    async def test_a_skipped_optional_extra_still_opens(self):
        """The path engine drops an optional stage a learner has outgrown, but the
        content is real and approved: the details panel offers it as an extra, and
        a learner who wants more practice must be able to take it."""
        await self._check("c-2", {"c-1": "completed", "c-2": "skipped", "c-3": "current"})

    async def test_a_non_chosen_equal_order_equivalent_still_opens(self):
        """§3.1 — same-`order` components are pedagogically שקולים. We pick one;
        refusing the other would make deep-linking an alternative fail."""
        await self._check("c-2b", {"c-2a": "current", "c-2b": "available"})

    async def test_a_projection_failure_never_strands_the_learner(self):
        """The route is a pedagogical order, not a security boundary. Losing the
        catalog must not lock every learner out of their lesson."""
        with patch.object(
            learning_sessions, "project_unit_roadmap",
            new=AsyncMock(side_effect=RuntimeError("catalog down")),
        ):
            await learning_sessions._assert_component_reachable("L", UNIT, {"id": "c-5"})


if __name__ == "__main__":
    unittest.main()
