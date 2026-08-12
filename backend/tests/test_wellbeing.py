"""A disclosure, its record, and what a teacher can do about it.

Two failures are pinned here because both were observed in the live database
rather than reasoned about:

* a bell notification from the 11th whose flag was gone from the brain array by
  the 12th, so clicking it could only ever land on an empty profile;
* `resolved` and `acknowledged_by`, written `False`/`None` at birth by the only
  writer, and set by nothing, ever — so a flag was either open forever or gone
  by accident, and a teacher could not tell which.

The store is exercised against a fake collection rather than the in-memory
fallback other services use, because there deliberately isn't one: losing the
record of a child's disclosure to a missing database is not a degradation this
module is willing to call success.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import wellbeing, wellbeing_assist


class FakeCollection:
    """Just enough Mongo for this module: one dict, four verbs."""

    def __init__(self) -> None:
        self.rows: dict[str, dict] = {}

    async def insert_one(self, document):
        self.rows[document["_id"]] = dict(document)

    async def find_one(self, query):
        row = self.rows.get(query.get("_id"))
        return dict(row) if row else None

    async def replace_one(self, query, document):
        self.rows[query["_id"]] = dict(document)

    async def update_one(self, query, changes):
        row = self.rows.get(query.get("_id"))
        if row is not None:
            row.update(changes.get("$set") or {})

    def find(self, query):
        learner = query.get("learner_id")
        rows = [dict(row) for row in self.rows.values()
                if learner is None or row.get("learner_id") == learner]
        return _Cursor(rows)

    async def create_index(self, *_args, **_kwargs):
        return None


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, key, direction=1):
        self.rows.sort(key=lambda row: str(row.get(key) or ""), reverse=direction < 0)
        return self

    def __aiter__(self):
        async def gen():
            for row in self.rows:
                yield row
        return gen()


class TheRecordOfADisclosure(unittest.IsolatedAsyncioTestCase):

    async def asyncSetUp(self):
        self.collection = FakeCollection()
        self._patch = patch("app.services.wellbeing._get_collection_named",
                            return_value=self.collection)
        self._patch.start()
        self._brain = patch("app.services.wellbeing._resolve_in_brain", new=AsyncMock())
        self._brain.start()

    async def asyncTearDown(self):
        self._patch.stop()
        self._brain.stop()

    async def _record(self, **kwargs):
        return await wellbeing.record("kid-1", evidence="אני עייף מהכול", **kwargs)

    async def test_the_words_and_the_reply_are_both_kept(self):
        # An adult walking into this conversation has to know what the child was
        # already told, or they will repeat it as if it were news.
        flag = await self._record(reply="דבר/י עם מבוגר שאת/ה סומך/ת עליו")
        self.assertEqual(flag["evidence"], "אני עייף מהכול")
        self.assertIn("מבוגר", flag["reply"])
        self.assertEqual(flag["status"], "open")

    async def test_a_blocked_message_says_it_never_arrived(self):
        # A teacher who assumes the message was sent asks the wrong question.
        flag = await self._record(source="direct_message", delivered=False)
        self.assertFalse(flag["delivered"])

    async def test_an_unknown_source_does_not_invent_a_place(self):
        flag = await self._record(source="somewhere_new")
        self.assertIn(flag["source"], wellbeing.SOURCES)

    async def test_it_survives_having_no_database_without_pretending_otherwise(self):
        with patch("app.services.wellbeing._get_collection_named", return_value=None):
            self.assertIsNone(await self._record())

    async def test_the_notified_list_is_who_was_actually_rung(self):
        flag = await self._record()
        await wellbeing.note_notified(flag["_id"], ["t-1", "t-2", "t-1"])
        stored = await wellbeing.get(flag["_id"])
        self.assertEqual(stored["notified"], ["t-1", "t-2"])


class WhatATeacherCanDoAboutIt(unittest.IsolatedAsyncioTestCase):

    async def asyncSetUp(self):
        self.collection = FakeCollection()
        self._patch = patch("app.services.wellbeing._get_collection_named",
                            return_value=self.collection)
        self._patch.start()
        self._brain = patch("app.services.wellbeing._resolve_in_brain", new=AsyncMock())
        self.brain = self._brain.start()
        self.flag = await wellbeing.record("kid-1", evidence="קשה לי", reply="דבר/י עם מבוגר")

    async def asyncTearDown(self):
        self._patch.stop()
        self._brain.stop()

    async def test_claiming_it_records_who_went(self):
        claimed = await wellbeing.acknowledge(self.flag["_id"], "teacher-a")
        self.assertEqual(claimed["acknowledged_by"], "teacher-a")
        self.assertEqual(claimed["status"], "acknowledged")

    async def test_a_second_teacher_does_not_overwrite_the_first(self):
        # The failure this prevents is two teachers each assuming the other
        # went. Knowing WHICH one went is the whole point.
        await wellbeing.acknowledge(self.flag["_id"], "teacher-a")
        again = await wellbeing.acknowledge(self.flag["_id"], "teacher-b")
        self.assertEqual(again["acknowledged_by"], "teacher-a")

    async def test_closing_needs_a_reason_it_recognises(self):
        with self.assertRaises(wellbeing.WellbeingError):
            await wellbeing.close(self.flag["_id"], "teacher-a", reason="because")

    async def test_closing_keeps_who_and_why(self):
        closed = await wellbeing.close(self.flag["_id"], "teacher-a",
                                       reason="referred", note="הועבר ליועצת")
        self.assertEqual(closed["status"], "closed")
        self.assertEqual(closed["closed_by"], "teacher-a")
        self.assertEqual(closed["close_reason"], "referred")
        self.assertEqual(closed["close_note"], "הועבר ליועצת")

    async def test_closing_also_quiets_the_strip_computed_from_the_brain(self):
        # `insights` builds "needs attention" from open flags in the brain array.
        # A flag a human has dealt with must stop shouting on every screen, not
        # only on the one where it was closed.
        await wellbeing.close(self.flag["_id"], "teacher-a", reason="handled")
        self.brain.assert_awaited()

    async def test_a_closed_flag_is_kept_and_still_readable(self):
        await wellbeing.close(self.flag["_id"], "teacher-a", reason="handled")
        rows = await wellbeing.list_for_learner("kid-1")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["evidence"], "קשה לי")

    async def test_reopening_is_not_a_delete(self):
        await wellbeing.close(self.flag["_id"], "teacher-a", reason="handled")
        reopened = await wellbeing.reopen(self.flag["_id"], "teacher-b")
        self.assertEqual(reopened["status"], "open")
        self.assertIsNone(reopened["close_reason"])

    async def test_claiming_a_closed_flag_is_refused(self):
        await wellbeing.close(self.flag["_id"], "teacher-a", reason="handled")
        with self.assertRaises(wellbeing.WellbeingError):
            await wellbeing.acknowledge(self.flag["_id"], "teacher-b")

    async def test_the_log_is_a_handover_record(self):
        after = await wellbeing.log_action(self.flag["_id"], "teacher-a",
                                           kind="called_home", text="שיחה עם ההורים")
        self.assertEqual(len(after["actions"]), 1)
        self.assertEqual(after["actions"][0]["by"], "teacher-a")
        self.assertEqual(after["actions"][0]["kind"], "called_home")

    async def test_an_invented_action_kind_is_refused(self):
        with self.assertRaises(wellbeing.WellbeingError):
            await wellbeing.log_action(self.flag["_id"], "teacher-a", kind="vibes")

    async def test_a_missing_flag_refuses_rather_than_creating_one(self):
        for call in (
            wellbeing.acknowledge("wb_nope", "teacher-a"),
            wellbeing.close("wb_nope", "teacher-a", reason="handled"),
        ):
            with self.assertRaises(wellbeing.WellbeingError):
                await call


class HistoryIsNotTruncatedOnTheDayTheStoreChanged(unittest.IsolatedAsyncioTestCase):
    """Flags written before this collection existed still have to be readable."""

    async def asyncSetUp(self):
        self.collection = FakeCollection()
        self._patch = patch("app.services.wellbeing._get_collection_named",
                            return_value=self.collection)
        self._patch.start()

    async def asyncTearDown(self):
        self._patch.stop()

    async def test_old_flags_are_projected_out_of_the_brain(self):
        brain = {"wellbeing_flags": [
            {"id": "wb_old", "evidence": "מילים ישנות", "at": "2026-01-01T00:00:00+00:00",
             "source": "coach_chat", "resolved": False},
        ]}
        with patch("app.brain.repository.get_brain", new=AsyncMock(return_value=brain)):
            rows = await wellbeing.list_for_learner("kid-1")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["evidence"], "מילים ישנות")
        # And they are marked, because nothing can act on a row with no record
        # behind it — a button that 404s is worse than a line of explanation.
        self.assertTrue(rows[0]["legacy"])

    async def test_a_row_that_exists_in_both_places_is_not_shown_twice(self):
        await wellbeing.record("kid-1", evidence="חדש", flag_id="wb_same")
        brain = {"wellbeing_flags": [{"id": "wb_same", "evidence": "חדש",
                                      "at": "2026-01-01T00:00:00+00:00"}]}
        with patch("app.brain.repository.get_brain", new=AsyncMock(return_value=brain)):
            rows = await wellbeing.list_for_learner("kid-1")
        self.assertEqual(len(rows), 1)
        self.assertFalse(rows[0].get("legacy"))

    async def test_the_classifier_outage_notice_is_not_a_child_signal(self):
        # `category: review` means the safety screen was down, not that a child
        # disclosed anything. It must never appear on this tab.
        await wellbeing.record("kid-1", evidence="screen unavailable", category="review")
        with patch("app.brain.repository.get_brain", new=AsyncMock(return_value={})):
            self.assertEqual(await wellbeing.list_for_learner("kid-1"), [])


class TheSuggestionsAreAdvice(unittest.IsolatedAsyncioTestCase):
    """Words to start from — never an action, and never silently absent."""

    FLAG = {"_id": "wb_1", "evidence": "קשה לי בבית", "source": "coach_chat",
            "reply": "דבר/י עם מבוגר", "language": "he"}

    async def test_it_asks_the_model_and_cleans_what_comes_back(self):
        reply = '{"options": ["1. לשוחח היום ביחידות", "  ", "לעדכן את היועצת"]}'
        with patch("app.services.llm.call_llm", new=AsyncMock(return_value=reply)):
            result = await wellbeing_assist.suggest(
                self.FLAG, intent="handle", language="he", teacher_id="t-1")
        self.assertTrue(result["generated"])
        self.assertEqual(result["options"], ["לשוחח היום ביחידות", "לעדכן את היועצת"])

    async def test_a_provider_outage_still_answers(self):
        # A safety surface whose helper button fails is a button a teacher
        # stops pressing. The fallbacks are written, not generated — and the
        # response says so, so nothing is presented as considered when it was
        # not.
        with patch("app.services.llm.call_llm", new=AsyncMock(side_effect=RuntimeError("down"))):
            result = await wellbeing_assist.suggest(
                self.FLAG, intent="message", language="he", teacher_id="t-1")
        self.assertFalse(result["generated"])
        self.assertTrue(result["options"])

    async def test_the_protocol_line_is_not_the_models_to_phrase(self):
        with patch("app.services.llm.call_llm", new=AsyncMock(return_value='{"options": ["x"]}')):
            result = await wellbeing_assist.suggest(
                self.FLAG, intent="close", language="he", teacher_id="t-1")
        self.assertEqual(result["protocol_key"], wellbeing_assist.PROTOCOL_KEY)

    async def test_an_unknown_intent_falls_back_rather_than_failing(self):
        with patch("app.services.llm.call_llm", new=AsyncMock(return_value='{"options": ["x"]}')):
            result = await wellbeing_assist.suggest(
                self.FLAG, intent="nonsense", language="he", teacher_id="t-1")
        self.assertIn(result["intent"], wellbeing_assist.INTENTS)

    async def test_the_prompt_forbids_the_four_ways_this_goes_wrong(self):
        seen = {}

        async def capture(messages, **kwargs):
            seen["prompt"] = messages[-1]["content"]
            seen["actor"] = kwargs["usage_context"].actor_id
            seen["actor_type"] = kwargs["usage_context"].actor_type
            return '{"options": ["x"]}'

        with patch("app.services.llm.call_llm", new=capture):
            await wellbeing_assist.suggest(self.FLAG, intent="message",
                                           language="he", teacher_id="teacher-a")
        for phrase in ("Never diagnose", "confidentiality", "clinical",
                       "Do not quote the student's words back"):
            self.assertIn(phrase, seen["prompt"], phrase)
        # Attributed to the teacher who pressed the button, not to "system".
        self.assertEqual(seen["actor"], "teacher-a")
        self.assertEqual(seen["actor_type"], "teacher")


if __name__ == "__main__":
    unittest.main()
