"""Ministry review of the live check, 23/09 ("השוואת בדיקות יובילאב מול לוגים").

Each test names the row the ministry marked "פער" and pins the fix:
- TC-CMP-01/02, TC-ITM-02: component / item / question IRIs follow the
  supplier template, not the vendor's URL, and are identical wherever they appear.
- TC-ITM-05/06: every media event carries `mediaFormat`.
- TC-ITM-08: a hint asked inside a question names the ITEM, not the question.
- TC-ITM-01: a non-questionnaire screen sends no item-level initialized.
- TC-CNV-02 rated: a repeated identical rating is sent once.
- TC-MNT-01 (mentor == student) is a test-procedure finding — one account held
  both roles; on staging every unmapped account shares the stub id — so it is
  fixed in how the check is run, not by withholding the statement.
"""
import asyncio
import os
import sys
import unittest
from unittest import mock
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.lrs import config, hierarchy, reporter, statements  # noqa: E402
from app.services.lrs.context import ACTIVITY, EXT  # noqa: E402

IDENTITY = {"exidentifier": "1020000001", "school": "123456", "nmm": "90635956"}
SESSION = "9eee3a65-f323-4ede-8ce8-6ec0b1edcffe"
DOMAIN = "https://spark.yuvilab.ai"
UNIT = {"id": "CET.MATH.G7.NUM.COORD-SYS-A.POS-NUM.PLOT", "title": "יחידה", "subject": "math"}
COMPONENT = {"id": "CET.MATH.G7.NUM.COORD-SYS-A.POS-NUM.PLOT-00001", "title": "מגלים ולומדים"}
VENDOR_COMPONENT = "https://learning.cet.ac.il/metadata/CET.MATH.G7.NUM.COORD-SYS-A.POS-NUM.PLOT-00001"
SCREEN = {"id": "mrk612f91gcsamaaz", "title": "סרטון", "content_type": "instruction"}  # the math catalog knows no media kind


def ids(activities):
    return [a["id"] for a in activities or []]


class Base(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.object(config, "supplier_domain", return_value=DOMAIN)
        patcher.start()
        self.addCleanup(patcher.stop)


class ContentIriTests(Base):
    def test_a_component_is_reported_under_the_supplier_iri(self):
        h = hierarchy.build(unit=UNIT, component=COMPONENT, level="component")
        raw = {"verb": {"id": "http://adlnet.gov/expapi/verbs/initialized"},
               "object": {"id": VENDOR_COMPONENT, "definition": {"type": f"{ACTIVITY}/component"}}}
        stmt = statements.enriched_content_statement(IDENTITY, SESSION, raw, hierarchy=h)
        canonical = f"{DOMAIN}/component/{COMPONENT['id']}"
        self.assertEqual(stmt["object"]["id"], canonical)
        grouping = stmt["context"]["contextActivities"]["grouping"]
        self.assertEqual(grouping[-1], stmt["object"])
        self.assertNotIn(VENDOR_COMPONENT, ids(grouping))
        self.assertEqual(ids(grouping).count(canonical), 1)

    def test_a_question_is_reported_as_item_question_under_its_item(self):
        h = hierarchy.build(unit=UNIT, component=COMPONENT, item={"id": "scr-6", "title": "שאלה"}, level="item")
        raw = {"verb": {"id": "http://adlnet.gov/expapi/verbs/answered"},
               "object": {"id": f"https://lomdot.education.gov.il/x/{COMPONENT['id']}/scr-6/q1"},
               "context": {"contextActivities": {"parent": [{"id": VENDOR_COMPONENT, "definition": {"type": f"{ACTIVITY}/component"}}]}}}
        stmt = statements.enriched_content_statement(IDENTITY, SESSION, raw, hierarchy=h, object_below_self=True)
        self.assertEqual(stmt["object"]["id"], f"{DOMAIN}/item/question/scr-6/q1")
        activities = stmt["context"]["contextActivities"]
        self.assertEqual(ids(activities["parent"]), [f"{DOMAIN}/component/{COMPONENT['id']}"])
        self.assertEqual(activities["grouping"][-1], stmt["object"])
        self.assertFalse([i for i in ids(activities["grouping"]) + ids(activities["parent"]) if "cet.ac.il" in i or "lomdot" in i])


class MediaFormatTests(Base):
    def test_a_clip_the_catalog_does_not_know_still_names_its_format(self):
        h = hierarchy.build(unit=UNIT, component=COMPONENT, item=SCREEN, level="item")
        for verb in ("played", "paused"):
            raw = {"verb": {"id": f"https://w3id.org/xapi/video/verbs/{verb}"},
                   "object": {"id": f"https://learning.cet.ac.il/metadata/6a58/{SCREEN['id']}"}}
            stmt = statements.enriched_content_statement(IDENTITY, SESSION, raw, hierarchy=h,
                                                         context_extensions={"mediaPosition": 0})
            self.assertEqual(stmt["context"]["extensions"].get(f"{EXT}/mediaFormat"), "video", verb)
            self.assertEqual(stmt["object"]["id"], f"{DOMAIN}/item/video/{SCREEN['id']}")


class HelpRequestTests(Base):
    def test_a_hint_inside_a_question_names_the_item(self):
        h = hierarchy.build(unit=UNIT, component=COMPONENT, item={"id": "scr-4", "title": "תרגול"}, level="item")
        raw = {"verb": {"id": "https://lxp.education.gov.il/xapi/moe/verbs/requested"},
               "object": {"id": f"https://lomdot.education.gov.il/x/{COMPONENT['id']}/scr-4/q1"}}
        stmt = statements.enriched_content_statement(IDENTITY, SESSION, raw, hierarchy=h, object_below_self=True,
                                                     context_extensions={"questionId": "q1", "helpSource": "content", "helpType": "hint"})
        obj_type = stmt["object"]["definition"]["type"].rsplit("/", 1)[-1]
        self.assertIn(obj_type, {"item", "questionnaire"})
        self.assertTrue(stmt["object"]["id"].startswith(f"{DOMAIN}/item/"))
        self.assertEqual(ids(stmt["context"]["contextActivities"]["parent"]), [f"{DOMAIN}/component/{COMPONENT['id']}"])
        self.assertEqual(stmt["context"]["extensions"].get(f"{EXT}/questionId"), "q1")


class ScreenInitializedTests(unittest.TestCase):
    def test_only_a_questionnaire_screen_is_a_screen_worth_reporting(self):
        from app.services import events, kata_catalog
        with patch.object(kata_catalog, "get_component", return_value={"id": "c"}), \
             patch.object(kata_catalog, "questions_for_item", side_effect=lambda c, i: [{"questionId": "q1"}] if i == "quiz" else []):
            self.assertTrue(events._is_questionnaire_screen("c", "quiz"))
            self.assertFalse(events._is_questionnaire_screen("c", "clip"))
            self.assertTrue(events._is_questionnaire_screen(
                "c", "clip", {"object": {"definition": {"type": f"{ACTIVITY}/questionnaire"}}}))
        with patch.object(kata_catalog, "get_component", return_value=None):
            self.assertTrue(events._is_questionnaire_screen("unknown", "x"), "never drop what the catalog cannot judge")


class RatingAndMentorTests(unittest.IsolatedAsyncioTestCase):
    async def test_a_repeated_like_is_sent_once_and_a_changed_rating_again(self):
        reporter._recent_ratings.clear()
        sent = AsyncMock()
        with patch.object(reporter, "_report", sent), \
             patch.object(reporter, "_position", AsyncMock(return_value=("c", "i"))), \
             patch.object(reporter, "_content_context", AsyncMock(return_value={})):
            for rating in ("like", "like", "like", "dislike"):
                await reporter.report_conversation_rated("gal", SESSION, "chat-1", rating)
        self.assertEqual([call.args[4] for call in sent.await_args_list], ["like", "dislike"])


if __name__ == "__main__":
    unittest.main()


class OwnActivitiesKeepTheirIrisTests(Base):
    """Live rerun 23/09: the reflection opened after the last screen was sent as
    `/item/questionnaire/<screen>` and its questions as `/item/question/<screen>/1`
    — the content IRI rewrite took them for the screen. Report 9 approved them
    under `/reflection/…`, which is where they stay."""

    def setUp(self):
        super().setUp()
        self.h = hierarchy.build(unit=UNIT, component=COMPONENT,
                                 item={"id": "scr-10", "title": "תרגול", "questions": [{"id": "q1"}]}, level="item")

    def test_the_reflection_questionnaire_keeps_its_own_iri(self):
        for stmt in (statements.reflection_initialized(IDENTITY, SESSION, "rf-1", "end-of-learning-component", hierarchy=self.h),
                     statements.reflection_completed(IDENTITY, SESSION, "rf-1", 30, hierarchy=self.h)):
            self.assertEqual(stmt["object"]["id"], f"{DOMAIN}/reflection/rf-1")
            self.assertEqual(stmt["object"]["definition"]["type"], f"{ACTIVITY}/questionnaire")

    def test_reflection_questions_keep_their_iris_and_their_parent(self):
        for stmt in (statements.reflection_answered(IDENTITY, SESSION, "rf-1", 1, score_raw=4, hierarchy=self.h),
                     statements.reflection_skipped(IDENTITY, SESSION, "rf-1", 3, hierarchy=self.h)):
            self.assertTrue(stmt["object"]["id"].startswith(f"{DOMAIN}/reflection/question/"), stmt["object"]["id"])
            self.assertEqual(ids(stmt["context"]["contextActivities"]["parent"]), [f"{DOMAIN}/reflection/rf-1"])
            # The screen the reflection followed is still in grouping, under its content IRI.
            grouping = ids(stmt["context"]["contextActivities"]["grouping"])
            self.assertTrue(any(i.startswith(f"{DOMAIN}/item/") and i.endswith("/scr-10") for i in grouping), grouping)
            self.assertNotIn(stmt["object"]["id"].replace("/reflection/question/", "/item/question/scr-10/"), grouping)
