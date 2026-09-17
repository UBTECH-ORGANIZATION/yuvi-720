"""Kata's 09/2026 catalog ids are URLs; Yuvi keeps the slug as THE id.

The launcher is the one place that needs Kata's own id. Everything Yuvi
records — the launch token, the brain pointer, the coach thread, the events —
carries the slug the catalog is keyed by, exactly as before the change, and
the read side reduces any URL it still meets to the same slug.
"""

from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from app.agents import sessions as agent_sessions
from app.services import events, learning_path, learning_sessions
from app.services.events import verify_launch


BASE = "https://lomdot.education.gov.il/metodica/720active/science/mass-measure/01"
SLUG = "methodica-science-mass-measure-01-01"
URL = f"{BASE}/{SLUG}"
UNIT = {
    "id": "methodica-science-mass-measure-01",
    "title": "מדידת מסה",
    "sub_topic": "MOE.SCI.G7.MASS",
    "objective_id": "MOE.SCI.G7.MASS.MEASURE",
    "subject": "science",
    "components": [],
}
COMPONENT = {
    "id": SLUG,
    "launch_id": URL,
    "title": "בואו נלמד משהו חדש",
    "languages": ["he"],
    "is_assessment": False,
    "information_by_item": {},
    "questions_by_item": {},
}


class LaunchCarriesTheSlugTests(unittest.IsolatedAsyncioTestCase):
    async def test_launcher_gets_kata_id_while_the_token_carries_the_slug(self) -> None:
        unit = {**UNIT, "components": [COMPONENT]}
        launcher = AsyncMock(return_value={"launch_url": "https://lomdot.example/x", "registration_id": "r1"})
        with (
            patch("app.services.learning_sessions.kata_client.resolve_component", new=AsyncMock(return_value=(unit, COMPONENT))),
            patch("app.services.learning_sessions.kata_client.create_launch_context", new=launcher),
            patch("app.services.learning_sessions._assert_objective_reachable", new=AsyncMock()),
            patch("app.services.learning_sessions._assert_component_reachable", new=AsyncMock()),
            patch("app.services.learning_sessions.get_brain", new=AsyncMock(return_value={})),
            patch("app.services.learning_sessions.apply_brain_updates", new=AsyncMock()) as brain_updates,
            patch("app.services.learning_sessions.project_unit_roadmap", new=AsyncMock(return_value={"components": []})),
            patch("app.services.learning_sessions._lesson_header_title", return_value="מדידת מסה"),
            patch.dict("os.environ", {"PUBLIC_APP_URL": "https://spark.example"}),
        ):
            session = await learning_sessions.create_provider_session(
                "learner-1", URL, unit_id=UNIT["id"], language="he", request_base_url="https://spark.example/",
            )
        self.assertEqual(launcher.await_args.kwargs["component_id"], URL)
        self.assertEqual(session["component"]["id"], SLUG)
        self.assertEqual(brain_updates.await_args.args[1]["current_state.component_id"], SLUG)
        self.assertEqual(verify_launch(session["launch"])["cmp"], SLUG)


class ReadSideReducesUrlsTests(unittest.TestCase):
    def test_component_completion_matches_a_url_launch(self) -> None:
        event = {"verb": "completed", "launch": URL, "object_id": URL}
        self.assertTrue(events.is_component_completion(event))
        per_screen = {"verb": "completed", "launch": SLUG, "object_id": f"{URL}/{SLUG}-003", "sub_item_id": f"{SLUG}-003"}
        self.assertFalse(events.is_component_completion(per_screen))

    def test_component_level_open_is_not_an_unmapped_screen(self) -> None:
        self.assertFalse(events._is_unmapped_screen_entry({"verb": "initialized", "launch": URL, "object_id": URL}))
        self.assertTrue(events._is_unmapped_screen_entry({"verb": "initialized", "launch": SLUG, "object_id": f"{URL}/page-x"}))

    def test_navigation_objects_resolve_under_a_url_component(self) -> None:
        self.assertEqual(events.resolve_item_question(f"{URL}/{SLUG}-003", URL), (f"{SLUG}-003", None))
        self.assertEqual(events.resolve_item_question(f"{URL}/{SLUG}-003/q2", URL), (f"{SLUG}-003", "q2"))

    def test_path_engine_counts_a_url_launch_as_the_slug_node(self) -> None:
        evidence = learning_path.unit_evidence([
            {"verb": "completed", "launch": URL, "object_id": URL, "_id": "e1", "result": {"success": True}},
        ])
        self.assertIn(SLUG, evidence["touched"])
        self.assertIn(SLUG, evidence["outcomes"])

    def test_activity_id_accepts_kata_url_as_the_slug(self) -> None:
        self.assertEqual(agent_sessions.normalize_activity_id(URL), SLUG)
        self.assertEqual(agent_sessions.normalize_activity_id(f"{URL}/"), SLUG)
        self.assertEqual(agent_sessions.normalize_activity_id(SLUG), SLUG)
        self.assertIsNone(agent_sessions.normalize_activity_id("https://x/y z"))


if __name__ == "__main__":
    unittest.main()
