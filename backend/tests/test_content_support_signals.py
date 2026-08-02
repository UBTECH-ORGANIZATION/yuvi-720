"""Help and self-reports that happen INSIDE the content must still count.

720 §3.3 names hint usage from the content as evidence the platform routes on
("מספר הפעמים שהתלמיד השתמש ברמזים מן התוכן"), and §Selected defines four
self-report choices beyond `learningType`. Both reached `learning_events` and
stopped there: a learner who leaned entirely on the Kata iframe's own "אפשר רמז?"
button looked, to the teacher view, like a learner who never asked for help.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import events  # noqa: E402


COMP = "methodica-science-mass-measure-01-01"


def _event(verb, *, category=None, response=None, item=f"{COMP}-004"):
    return {
        "learner_id": "L", "verb": verb, "launch": COMP, "unit_id": "u",
        "sub_item_id": item, "question_id": "q1", "objective_id": "OBJ",
        "subject": "science", "selection_category": category,
        "result": {"response": response} if response is not None else {},
    }


class ContentSupportTests(unittest.IsolatedAsyncioTestCase):
    async def _record(self, event, position=None):
        calls: list[tuple] = []

        async def fake_record(learner_id, kind, **kwargs):
            calls.append((learner_id, kind, kwargs))

        with patch("app.services.learner_activity.record", new=fake_record):
            await events._record_content_support(event, position)
        return calls

    async def test_katas_hint_verb_iri_is_accepted(self):
        """Captured live 29/07 — `acrossx`, not the `tincanapi` IRI we knew.

        The whole statement was dropped before storage, so the hint never
        existed as far as the platform was concerned.
        """
        statement = {
            "id": "s1", "actor": {"account": {"name": "L"}},
            "verb": {"id": "https://w3id.org/xapi/acrossx/verbs/requested"},
            "object": {"id": f"https://lomdot.education.gov.il/x/{COMP}"},
        }
        slug, compat = events._provider_verb_slug(statement, {"src": "kata", "cmp": COMP})
        self.assertEqual((slug, compat), ("requested", True))

    async def test_the_contents_own_hint_button_is_counted(self):
        calls = await self._record(_event("requested"))
        self.assertEqual(len(calls), 1)
        learner, kind, kwargs = calls[0]
        self.assertEqual((learner, kind), ("L", "content_hint"))
        self.assertEqual(kwargs["component_id"], COMP)
        self.assertEqual(kwargs["item_id"], f"{COMP}-004")
        self.assertEqual(kwargs["question_id"], "q1")

    async def test_it_is_kept_apart_from_yuvis_own_hint(self):
        """A teacher must be able to tell who the learner asked."""
        from app.services import learner_activity

        self.assertIn("content_hint", learner_activity.KINDS)
        self.assertIn("hint", learner_activity.KINDS)

    async def test_a_self_report_choice_is_recorded_with_its_kind_and_value(self):
        calls = await self._record(
            _event("selected", category="is-understood", response="false")
        )
        self.assertEqual(len(calls), 1)
        _, kind, kwargs = calls[0]
        self.assertEqual(kind, "content_choice")
        self.assertEqual(kwargs["meta"], {"category": "is-understood", "response": "false"})

    async def test_the_learning_type_choice_is_not_double_counted(self):
        """It is already consumed as position + chosen representation."""
        calls = await self._record(
            _event("selected", category="learning-type", response="listening")
        )
        self.assertEqual(calls, [])

    async def test_ordinary_answers_are_left_alone(self):
        self.assertEqual(await self._record(_event("answered")), [])
        self.assertEqual(await self._record(_event("completed")), [])

    async def test_a_component_scoped_request_lands_on_the_screen_they_are_on(self):
        """Kata reports the hint against the component with no screen id.

        Filing it under a nameless bucket would tell a teacher that help was
        used somewhere in the lesson — useless. The position the same event just
        folded is the question the learner was stuck on.
        """
        bare = _event("requested", item=None)
        bare["question_id"] = None
        calls = await self._record(bare, {
            "component_id": COMP, "item_id": f"{COMP}-004", "question_id": "q1",
        })
        _, _, kwargs = calls[0]
        self.assertEqual(kwargs["item_id"], f"{COMP}-004")
        self.assertEqual(kwargs["question_id"], "q1")

    async def test_the_events_own_screen_still_wins(self):
        calls = await self._record(_event("requested"), {
            "component_id": COMP, "item_id": f"{COMP}-009", "question_id": "q2",
        })
        _, _, kwargs = calls[0]
        self.assertEqual(kwargs["item_id"], f"{COMP}-004")


class MetadataPassThroughTests(unittest.TestCase):
    """Spec fields that were parsed away."""

    def test_a_component_keeps_its_skills_provider_and_timestamps(self):
        from app.services.kata_client import normalize_component

        row = normalize_component({
            "id": COMP, "learningUnitId": "u", "title": "t",
            "skills": ["SKILL.CRITICAL", "SKILL.CRITICAL", " SKILL.SELF "],
            "manufacture": "Methodica",
            "createdAt": "2025-11-04T07:32:48.609Z",
            "updatedAt": "2025-12-04T07:32:48.609Z",
        })
        self.assertEqual(row["skills"], ["SKILL.CRITICAL", "SKILL.SELF"])
        self.assertEqual(row["manufacture"], "Methodica")
        self.assertEqual(row["created_at"], "2025-11-04T07:32:48.609Z")
        self.assertEqual(row["updated_at"], "2025-12-04T07:32:48.609Z")

    def test_a_unit_keeps_who_it_was_written_for(self):
        from app.services.kata_client import normalize_unit

        row = normalize_unit({
            "id": "u", "title": "t", "subTopic": "MOE.SCI.SUB",
            "targetSector": ["State-General", "Arab Sector"],
            "targetAudience": "General",
        })
        self.assertEqual(row["target_sector"], ["Arab Sector", "State-General"])
        self.assertEqual(row["target_audience"], ["General"])

    def test_an_absent_closed_list_stays_absent(self):
        """Never invent a Ministry index value the provider did not send."""
        from app.services.kata_client import normalize_unit

        row = normalize_unit({"id": "u", "title": "t"})
        self.assertEqual(row["target_sector"], [])
        self.assertEqual(row["target_audience"], [])


if __name__ == "__main__":
    unittest.main()
