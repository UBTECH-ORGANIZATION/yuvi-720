"""Every builder's output passes the offline v1.1 validator; the validator
catches the defects the reviews raised."""

from __future__ import annotations

import os
import unittest
from unittest import mock

from app.services.lrs import hierarchy, statements
from app.services.lrs.validate import validate_statement

IDENTITY = {"exidentifier": "1012345678", "school": "123456", "nmm": "90635956"}
SESSION = "8b0f0c4c-6f77-4a2b-9c05-2b0e3e5f1a11"
DEVICE = {
    "deviceType": "Desktop", "platform": "Web", "operatingSystem": "macOS", "osVersion": "14.5",
    "browser": "Chrome", "browserVersion": "128", "applicationVersion": "d78621d",
}
UNIT = {"id": "methodica-science-mass-measure-01", "title": "מסה", "sub_topic": "MOE.SCI", "objective_id": "MOE.SCI.X", "subject": "science"}
COMPONENT = {"id": "methodica-science-mass-measure-01-01", "title": "פתיחה", "purpose": "both", "relative_difficulty": 3}
ITEM = {"id": "methodica-science-mass-measure-01-01-003", "title": "וידאו", "content_type": "instruction", "media_format": "video"}
VENDOR = "https://lxp.education.gov.il/xapi/moe/ecat/content-vendor/310"


def _h(level: str):
    return hierarchy.build(unit=UNIT, component=COMPONENT, item=ITEM if level == "item" else None, level=level)


class EveryBuilderValidates(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {"LRS_SUPPLIER_DOMAIN": "https://spark.yuvilab.co.il"})
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def assertValid(self, statement):
        self.assertEqual(validate_statement(statement), [], statement.get("verb"))

    def test_session_family(self):
        self.assertValid(statements.session_enter(IDENTITY, SESSION, device=DEVICE))
        self.assertValid(statements.session_suspend(IDENTITY, SESSION))
        self.assertValid(statements.session_resume(IDENTITY, SESSION))
        self.assertValid(statements.session_exit(IDENTITY, SESSION, 754, timestamp="2026-09-17T10:12:34Z"))

    def test_dashboards(self):
        self.assertValid(statements.dashboard_viewed(IDENTITY, SESSION, "student-personal", duration_seconds=12))
        self.assertValid(statements.dashboard_viewed(IDENTITY, SESSION, "learning-group", "90635956", duration_seconds=40))

    def test_agency(self):
        self.assertValid(statements.agency_initialized(IDENTITY, SESSION, "pre"))
        self.assertValid(statements.agency_answered(IDENTITY, SESSION, 3, "4", score_raw=4))
        official = statements.agency_answered(
            IDENTITY, SESSION, 3, "מסכים", score_raw=4,
            question_id="https://moe.gov.il/720-agency-mapping/questions/3",
            answer_id="https://moe.gov.il/720-agency-mapping/answers/agree_4",
        )
        self.assertValid(official)
        # The object stays the platform's own agency question (spec example);
        # the catalog ids are extensions, never the object id.
        self.assertTrue(official["object"]["id"].endswith("/agency/question/3"))
        ext = {k.rsplit("/", 1)[-1]: v for k, v in official["context"]["extensions"].items()}
        self.assertEqual(ext["questionId"], "https://moe.gov.il/720-agency-mapping/questions/3")
        self.assertEqual(ext["answerId"], "https://moe.gov.il/720-agency-mapping/answers/agree_4")
        self.assertEqual(official["result"]["response"], "מסכים")
        self.assertValid(statements.agency_completed(IDENTITY, SESSION, 300, "pre"))

    def test_conversation(self):
        self.assertValid(statements.conversation_interacted(
            IDENTITY, SESSION, "lesson--item", speaker="student", conversation_trigger="student-request",
            help_type="hint", component_id="https://spark.yuvilab.co.il/component/c", item_id="https://spark.yuvilab.co.il/item/i",
        ))
        self.assertValid(statements.conversation_rated(IDENTITY, SESSION, "lesson--item", "like"))

    def test_reflection(self):
        self.assertValid(statements.reflection_initialized(IDENTITY, SESSION, "r1", "difficult-task"))
        self.assertValid(statements.reflection_answered(IDENTITY, SESSION, "r1", 1, score_raw=4))
        self.assertValid(statements.reflection_answered(IDENTITY, SESSION, "r1", 2, response="כן"))
        self.assertValid(statements.reflection_skipped(IDENTITY, SESSION, "r1", 3))
        self.assertValid(statements.reflection_completed(IDENTITY, SESSION, "r1", 80))
        self.assertValid(statements.reflection_completed(IDENTITY, SESSION, "r1", 80, completion=False))

    def test_mentoring_and_goals(self):
        self.assertValid(statements.mentor_meeting_completed(
            IDENTITY, SESSION, "m1", mentor_exid="1020000002", student_exid="1020000001",
            meeting_date="2026-09-17", mentoring_phase="phase3",
        ))
        for build in (statements.student_goal_initialized, statements.student_goal_updated, statements.student_goal_completed):
            self.assertValid(build(IDENTITY, SESSION, "g1", "behavioral", instructor_exid="1020000002"))

    def test_content(self):
        self.assertValid(statements.help_requested(
            IDENTITY, SESSION, object_id="https://spark.yuvilab.co.il/item/i", object_type="item",
            help_source="platform", help_type="hint", hierarchy=_h("item"), ecat_item_id=VENDOR,
        ))
        self.assertValid(statements.selected(
            IDENTITY, SESSION, object_id="https://spark.yuvilab.co.il/component/c", object_type="component",
            selection_type="practice-decision", response="true", hierarchy=_h("component"), ecat_item_id=VENDOR,
        ))
        self.assertValid(statements.content_skipped(
            IDENTITY, SESSION, object_id=f"https://spark.yuvilab.co.il/component/{COMPONENT['id']}",
            hierarchy=_h("component"), ecat_item_id=VENDOR,
        ))
        self.assertValid(statements.media_event(
            IDENTITY, SESSION, "paused", object_id="https://lomdot.example/v", media_format="video",
            media_position_seconds=30, duration_seconds=30, hierarchy=_h("item"), ecat_item_id=VENDOR,
        ))
        self.assertValid(statements.question_answered(
            IDENTITY, SESSION, object_id="https://lomdot.example/i/q1", question_id="q1", response="b",
            question_type="choice", success=True, score_scaled=1.0, hierarchy=_h("item"), ecat_item_id=VENDOR,
        ))
        self.assertValid(statements.component_completed(
            IDENTITY, SESSION, COMPONENT["id"], success=True, score_scaled=0.9, duration_seconds=600,
            hierarchy=_h("component"), ecat_item_id=VENDOR,
        ))


class ValidatorCatchesRealDefects(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {"LRS_SUPPLIER_DOMAIN": "https://spark.yuvilab.co.il"})
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def test_missing_application_version(self):
        stmt = statements.session_enter(IDENTITY, SESSION, device={k: v for k, v in DEVICE.items() if k != "applicationVersion"})
        self.assertIn("enter is missing the applicationVersion extension", validate_statement(stmt))

    def test_a_reversed_selection_token(self):
        stmt = statements.selected(
            IDENTITY, SESSION, object_id="https://x/component/c", object_type="component",
            selection_type="practice-decision", response="true", hierarchy=_h("component"), ecat_item_id=VENDOR,
        )
        stmt["context"]["extensions"]["https://lxp.education.gov.il/xapi/moe/extensions/selectionType"] = "decision-practice"
        self.assertTrue(any("selectionType" in p for p in validate_statement(stmt)))

    def test_a_duration_less_dashboard_and_an_empty_dashboard_id(self):
        stmt = statements.dashboard_viewed(IDENTITY, SESSION, "student-personal")
        self.assertIn("viewed needs result.duration (filed when the viewing ends)", validate_statement(stmt))
        stmt = statements.dashboard_viewed({**IDENTITY, "nmm": None}, SESSION, "learning-group", duration_seconds=3)
        self.assertIn("viewed needs a non-empty dashboardId", validate_statement(stmt))

    def test_content_without_a_vendor_or_with_a_bare_extension_key(self):
        stmt = statements.help_requested(
            IDENTITY, SESSION, object_id="https://x/item/i", object_type="item",
            help_source="platform", help_type="hint", hierarchy=_h("item"),
        )
        self.assertIn("content statement without a content-vendor grouping", validate_statement(stmt))
        stmt["context"]["extensions"]["question_id"] = "q1"
        self.assertTrue(any("not a ministry IRI" in p for p in validate_statement(stmt)))

    def test_a_meeting_off_the_ladder_and_a_bad_date(self):
        stmt = statements.mentor_meeting_completed(
            IDENTITY, SESSION, "m1", mentor_exid="1", student_exid="2", meeting_date="17/09/2026", mentoring_phase="phase3",
        )
        self.assertIn("meetingDate must be YYYY-MM-DD", validate_statement(stmt))

    def test_an_off_list_verb(self):
        stmt = statements.session_suspend(IDENTITY, SESSION)
        stmt["verb"]["id"] = "http://adlnet.gov/expapi/verbs/suspended"
        self.assertTrue(any("not on the ministry's list" in p for p in validate_statement(stmt)))


if __name__ == "__main__":
    unittest.main()
