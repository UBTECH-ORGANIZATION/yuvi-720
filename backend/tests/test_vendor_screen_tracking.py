"""Navigation must move the position pointer, not only answers.

Measured 2026-09-01 on `COMPL-00001`: CET narrates every page change (and
every resume) with an `initialized` whose object is
``…/metadata/{activity}/{pageId}`` — an opaque id that exists nowhere in the
DOM or the catalog. The ingest stored ``sub_item_id: null`` for all of them,
so a learner three pages in still had the coach grounded (confidently — the
position read as REPORTED) on the page of their last answer.

Two mechanisms fix it: the nightly walk overhears the player's own xAPI and
records each page's id on its slide (``vendor_page_id``, capture v7), which
`resolve_object_item` consults; and a page-enter we can NOT map still clears
the pointer — the learner has provably left the old screen, and unknown
(assumed + hedged) beats confidently wrong.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import content_intelligence, events, kata_catalog  # noqa: E402


COMPONENT = "CET.MATH.G7.NUM.COORD-SYS-A.POS-NUM.COMPL-00001"
PAGE_OBJECT = "https://learning.cet.ac.il/metadata/6a6078100dc15822c43655a2/msvi90dt1kxpui6fl"
COMPONENT_OBJECT = f"https://learning.cet.ac.il/metadata/{COMPONENT}"


class ResolveObjectItemUsesTheVendorMap(unittest.TestCase):
    def test_a_walked_page_id_names_its_catalog_item(self):
        component = {"id": COMPONENT, "items": [], "questions_by_item": {
            f"{COMPONENT}-item-00003": [{"questionId": "q-x"}]}}
        with mock.patch.object(kata_catalog, "get_component", return_value=component), \
             mock.patch.object(content_intelligence, "vendor_screen_item",
                               return_value=f"{COMPONENT}-item-00003"):
            item, question = kata_catalog.resolve_object_item(COMPONENT, PAGE_OBJECT)
        self.assertEqual(item, f"{COMPONENT}-item-00003")
        self.assertIsNone(question)

    def test_an_unlearned_page_id_stays_unmapped(self):
        component = {"id": COMPONENT, "items": [], "questions_by_item": {}}
        with mock.patch.object(kata_catalog, "get_component", return_value=component), \
             mock.patch.object(content_intelligence, "vendor_screen_item",
                               return_value=None):
            item, _ = kata_catalog.resolve_object_item(COMPONENT, PAGE_OBJECT)
        self.assertIsNone(item)


class UnmappedScreenEntries(unittest.TestCase):
    def _event(self, verb="enter", object_id=PAGE_OBJECT, sub_item=None):
        return {"verb": verb, "object_id": object_id, "sub_item_id": sub_item,
                "launch": COMPONENT}

    def test_a_page_enter_we_cannot_name_is_a_screen_move(self):
        self.assertTrue(events._is_unmapped_screen_entry(self._event()))
        self.assertTrue(events._is_unmapped_screen_entry(
            self._event(verb="initialized")))

    def test_a_component_open_is_not_a_page_move(self):
        self.assertFalse(events._is_unmapped_screen_entry(
            self._event(object_id=COMPONENT_OBJECT)))

    def test_a_mapped_screen_is_handled_by_the_pointer_branch(self):
        self.assertFalse(events._is_unmapped_screen_entry(
            self._event(sub_item=f"{COMPONENT}-item-00003")))

    def test_only_navigation_verbs_qualify(self):
        self.assertFalse(events._is_unmapped_screen_entry(
            self._event(verb="completed")))
        self.assertFalse(events._is_unmapped_screen_entry(
            self._event(verb="answered")))


class UnmappedEntriesInsideTheLoadBurst(unittest.IsolatedAsyncioTestCase):
    """CET fires several `initialized` within a second of opening a screen.

    Measured 2026-09-02 on COMPL-00001, both launches identical: the question
    page's entry at +0.00s (mapped → item-00001), then `msvi90dt1kxpui6fl`
    at +0.74s, which the catalog does not list. Clearing the pointer there put
    the learner's next chat message under the Introduction one second after
    the coach had introduced question 1. Inside the burst the unknown id is the
    same screen still loading; well after it, it is still a move away.
    """

    ITEM = f"{COMPONENT}-item-00001"

    async def _fold(self, event: dict, prior_state: dict) -> dict:
        captured: dict = {}

        async def fake_apply(_lid, set_updates, inc_updates=None):
            captured["set"] = set_updates

        with mock.patch.object(events, "get_brain",
                               new=mock.AsyncMock(return_value={"current_state": prior_state, "mastery": {}})), \
             mock.patch.object(events, "apply_brain_operators",
                               new=mock.AsyncMock(side_effect=fake_apply)), \
             mock.patch.object(events, "is_component_completion", return_value=False):
            await events._apply_event_to_brain(event)
        return captured.get("set", {})

    def _unmapped_entry(self, at: str) -> dict:
        return {"learner_id": "gal", "verb": "enter", "launch": COMPONENT,
                "unit_id": "unit-1", "object_id": PAGE_OBJECT, "sub_item_id": None,
                "question_id": None, "occurred_at": at}

    def _on_question_one(self, at: str) -> dict:
        return {"component_id": COMPONENT, "item_id": self.ITEM,
                "question_id": "q1", "at": at}

    async def test_an_unknown_page_in_the_load_burst_keeps_the_screen(self):
        """The measured case: +0.74s after question 1's own entry."""
        sets = await self._fold(
            self._unmapped_entry("2026-09-02T12:49:58.103Z"),
            self._on_question_one("2026-09-02T12:49:57.362Z"),
        )
        self.assertNotIn("current_state.item_id", sets)
        self.assertNotIn("current_state.question_id", sets)

    async def test_an_unknown_page_well_after_arrival_still_clears_the_screen(self):
        """Unknown beats wrong is unchanged for a real move to an unlearned page."""
        sets = await self._fold(
            self._unmapped_entry("2026-09-02T12:50:20.000Z"),
            self._on_question_one("2026-09-02T12:49:57.362Z"),
        )
        self.assertIsNone(sets.get("current_state.item_id", "untouched"))
        self.assertIsNone(sets.get("current_state.question_id", "untouched"))

    async def test_no_known_screen_means_nothing_to_hold(self):
        """A burst right after the lomda open (no item yet) is not protected."""
        sets = await self._fold(
            self._unmapped_entry("2026-09-02T12:49:40.627Z"),
            {"component_id": COMPONENT, "item_id": None, "question_id": None,
             "at": "2026-09-02T12:49:39.754Z"},
        )
        self.assertIsNone(sets.get("current_state.item_id", "untouched"))

    async def test_another_lesson_is_never_the_same_screen_loading(self):
        sets = await self._fold(
            self._unmapped_entry("2026-09-02T12:49:58.103Z"),
            {"component_id": "some-other-component", "item_id": "some-other-component-item-00002",
             "question_id": "q1", "at": "2026-09-02T12:49:57.362Z"},
        )
        self.assertIsNone(sets.get("current_state.item_id", "untouched"))


if __name__ == "__main__":
    unittest.main()
