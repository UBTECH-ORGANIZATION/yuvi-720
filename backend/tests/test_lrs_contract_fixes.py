"""Every finding of the MoE integration review (28/07), pinned.

The ministry reviewed our staging statements and returned a list. Each test here
is one line of that list, so a regression names itself:

  · grouping→lms was `https://720.example.co.il`, grouping→content-vendor was
    `ECAT-720-contract`, session grouping was the literal string
    `lrs-contract-report-session` — placeholders that validate and mean nothing
  · content statements carried the object alone: no parent, no ancestry in
    grouping, none of the levels' metadata
  · question answered: no `result.response`; `question_id` instead of
    `questionId`; no `questionType`, no `attemptNumber`
  · media: no `mediaFormat` / `mediaPosition` / `mediaDuration`; no
    `result.duration` on paused and completed
  · conversation interacted: no `helpType`
  · reflection answered + skipped: no `object.definition.name`
  · selected: `practiceDecision` where the dictionary is kebab-case
"""

from __future__ import annotations

import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.lrs import config, hierarchy, statements  # noqa: E402
from app.services.lrs.context import ACTIVITY, EXT  # noqa: E402


IDENTITY = {"exidentifier": "1012345678", "school": "123456", "nmm": "90635956"}
SESSION = "8b0f0c4c-6f77-4a2b-9c05-2b0e3e5f1a11"
UNIT = {
    "id": "methodica-science-mass-measure-01",
    "title": "מדידה מעשית של מסה בשלושה מצבי צבירה",
    "sub_topic": "MOE.SCI.G7.CHEM.BODY-MAT-PROP.MASS-VOL",
    "objective_id": "MOE.SCI.G7.CHEM.BODY-MAT-PROP.MASS-VOL.MASS-PRACTICE",
    "subject": "science",
}
COMPONENT = {
    "id": "methodica-science-mass-measure-01-01",
    "title": "פתיחה, הקנייה ותרגול סטנדרטי א",
    "purpose": "both",
    "is_assessment": False,
    "relative_difficulty": 3,
    "estimated_minutes": 22,
    "media_format": "interactive-content",
}
ITEM = {
    "id": "methodica-science-mass-measure-01-01-003",
    "title": "הקנייה: איך מודדים נכון",
    "content_type": "instruction",
    "media_format": "video",
}


def _short(extensions: dict) -> dict:
    """Extension map keyed by its short name, for readable assertions."""
    return {k.rsplit("/", 1)[-1]: v for k, v in (extensions or {}).items()}


def _types(activities: list[dict]) -> list[str]:
    return [(a.get("definition") or {}).get("type", "") for a in activities or []]


class IdentityHygieneTests(unittest.TestCase):
    def test_an_example_domain_is_refused_as_the_lms_id(self):
        with mock.patch.dict(os.environ, {
            "LRS_SUPPLIER_DOMAIN": "https://720.example.co.il",
            "LRS_KATA_ECAT_ID": "ECAT-720-contract",
            "LRS_TEST_EXIDENTIFIER": "1012345678",
        }):
            problems = " ".join(config.identity_problems())
        self.assertIn("LRS_SUPPLIER_DOMAIN", problems)
        self.assertIn("LRS_KATA_ECAT_ID", problems)

    def test_real_ids_pass(self):
        with mock.patch.dict(os.environ, {
            "LRS_SUPPLIER_DOMAIN": "https://app.yuvilab.co.il",
            "LRS_KATA_ECAT_ID": "1234567",
            "LRS_TEST_EXIDENTIFIER": "1012345678",
        }):
            self.assertEqual(config.identity_problems(), [])


class EcatItemTests(unittest.TestCase):
    """`grouping→content-vendor` is "מזהה הפריט בקטלוג החינוכי" — the id of the
    CONTENT ITEM, so it belongs to the content and not to the deployment. It was
    one constant for everything Kata serves, which is only right for a provider
    with a single catalog registration."""

    MAP = json.dumps({
        "methodica-science-mass-measure-01": "111111",           # unit
        "methodica-science-mass-measure-01-01": "222222",        # component
        "methodica-science-mass-measure-01-01-003": "333333",    # item
    })

    def test_the_most_specific_registration_wins(self):
        with mock.patch.dict(os.environ, {"LRS_ECAT_ITEMS": self.MAP}, clear=False):
            self.assertEqual(config.ecat_item_id(
                item_id=ITEM["id"], component_id=COMPONENT["id"], unit_id=UNIT["id"],
            ), "333333")
            self.assertEqual(config.ecat_item_id(
                component_id=COMPONENT["id"], unit_id=UNIT["id"],
            ), "222222")
            self.assertEqual(config.ecat_item_id(unit_id=UNIT["id"]), "111111")

    def test_unmapped_content_falls_back_to_the_single_registration(self):
        with mock.patch.dict(os.environ, {
            "LRS_ECAT_ITEMS": self.MAP, "LRS_KATA_ECAT_ID": "999999",
        }, clear=False):
            self.assertEqual(config.ecat_item_id(unit_id="some-other-unit"), "999999")

    def test_a_broken_map_is_ignored_not_raised(self):
        """Reporting is report-and-forget; a typo in an env var must not take the
        ingest path down with it."""
        with mock.patch.dict(os.environ, {
            "LRS_ECAT_ITEMS": "{not json", "LRS_KATA_ECAT_ID": "999999",
        }, clear=False):
            self.assertEqual(config.ecat_item_id(unit_id=UNIT["id"]), "999999")

    def test_a_map_alone_satisfies_the_identity_gate(self):
        with mock.patch.dict(os.environ, {
            "LRS_SUPPLIER_DOMAIN": "https://spark.yuvilab.ai",
            "LRS_ECAT_ITEMS": self.MAP,
            "LRS_KATA_ECAT_ID": "",
            "LRS_TEST_EXIDENTIFIER": "1012345678",
        }):
            self.assertEqual(config.identity_problems(), [])

    def test_the_supplier_map_alone_satisfies_content_vendor(self):
        """Clarified by the MoE on 03/08: `grouping→content-vendor` is the content
        SUPPLIER's id ("methodica" / "10"), resolved per content from the
        catalog's `manufacture`. So an empty per-ITEM map is no longer a blocking
        problem — the supplier map answers, and reporting stays on."""
        with mock.patch.dict(os.environ, {
            "LRS_SUPPLIER_DOMAIN": "https://spark.yuvilab.ai",
            "LRS_ECAT_ITEMS": "",
            "LRS_KATA_ECAT_ID": "",
            "LRS_TEST_EXIDENTIFIER": "1012345678",
        }):
            self.assertEqual(config.identity_problems(), [])

    def test_nothing_configured_at_all_is_still_a_blocking_problem(self):
        with mock.patch.dict(os.environ, {
            "LRS_SUPPLIER_DOMAIN": "https://spark.yuvilab.ai",
            "LRS_ECAT_ITEMS": "",
            "LRS_KATA_ECAT_ID": "",
            "LRS_CONTENT_VENDORS": "{}",
            "LRS_TEST_EXIDENTIFIER": "1012345678",
        }):
            problems = " ".join(config.identity_problems())
            self.assertIn("content-vendor", problems)

    def test_a_placeholder_inside_the_map_is_caught_too(self):
        with mock.patch.dict(os.environ, {
            "LRS_SUPPLIER_DOMAIN": "https://spark.yuvilab.ai",
            "LRS_ECAT_ITEMS": json.dumps({UNIT["id"]: "ECAT-720-contract"}),
            "LRS_KATA_ECAT_ID": "",
            "LRS_TEST_EXIDENTIFIER": "1012345678",
        }):
            self.assertIn("LRS_ECAT_ITEMS", " ".join(config.identity_problems()))


class HierarchyTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.object(
            config, "supplier_domain", return_value="https://app.yuvilab.co.il"
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_an_item_carries_all_three_levels(self):
        built = hierarchy.build(unit=UNIT, component=COMPONENT, item=ITEM, level="item")
        # The strict ancestors sit in `grouping`; the item's own level is `self`
        # (report 3: a content statement's deepest grouping entry is its OBJECT,
        # so the catalog's item entry is kept apart for the statements whose
        # object lives outside the content tree). The item is a VIDEO, and the
        # spec types a media item by its media — not `activities/item`.
        self.assertEqual(_types(built["grouping"]), [
            f"{ACTIVITY}/learning-unit", f"{ACTIVITY}/component",
        ])
        self.assertEqual(_types([built["self"]]), [f"{ACTIVITY}/video"])
        self.assertEqual(_types(built["parent"]), [f"{ACTIVITY}/component"])
        keys = built["extensions"]
        self.assertIn("learningUnitId", keys)      # unit level
        self.assertIn("componentTitle", keys)      # component level
        self.assertIn("itemId", keys)              # item level

    def test_a_non_media_item_stays_a_plain_item(self):
        """Only the published media dictionary gets its own activity type —
        inventing an IRI the ministry does not publish is the worse failure."""
        built = hierarchy.build(
            unit=UNIT, component=COMPONENT,
            item={**ITEM, "media_format": "text"}, level="item",
        )
        self.assertEqual(_types([built["self"]]), [f"{ACTIVITY}/item"])

    def test_every_row_of_the_spec_s_metadata_tables_is_sent(self):
        """The tables list them; the catalog already normalizes them; they were
        simply never mapped into the statement."""
        built = hierarchy.build(
            unit={**UNIT, "target_sector": ["general"], "target_audience": ["grade-7"]},
            component={**COMPONENT, "skills": ["problem-solving"], "manufacture": "Kata",
                       "information_by_item": {ITEM["id"]: "מה חשוב שהתלמיד יבין…"},
                       "questions_by_item": {ITEM["id"]: [{
                           "questionId": "q1", "questionType": "multiple-choice",
                           "questionText": "לפי מה נדע אם צריך לאפס?",
                           "correctAnswers": ["מאזני כפות"],
                       }]}},
            item=ITEM, level="item",
        )
        keys = _short(built["extensions"])
        self.assertEqual(keys["targetSector"], ["general"])
        self.assertEqual(keys["targetAudience"], ["grade-7"])
        self.assertEqual(keys["skills"], ["problem-solving"])
        self.assertEqual(keys["manufacture"], "Kata")
        self.assertEqual(keys["componentId"], COMPONENT["id"])
        self.assertIn("informationToBot", keys)
        self.assertEqual(keys["questions"][0]["questionId"], "q1")

    def test_the_answer_key_never_leaves_with_the_questions_array(self):
        """`questions` describes what is asked. The catalog rows also carry the
        correct answers so the coach can guide without revealing them — shipping
        those to the LRS would publish the answer key of every screen."""
        built = hierarchy.build(
            unit=UNIT,
            component={**COMPONENT, "questions_by_item": {ITEM["id"]: [{
                "questionId": "q1", "questionType": "multiple-choice",
                "answers": ["א", "ב"], "correctAnswers": ["ב"],
            }]}},
            item=ITEM, level="item",
        )
        serialized = json.dumps(built["extensions"], ensure_ascii=False)
        self.assertNotIn("correctAnswers", serialized)
        self.assertNotIn("answers", serialized)

    def test_a_component_carries_the_unit_above_it(self):
        built = hierarchy.build(unit=UNIT, component=COMPONENT, level="component")
        self.assertEqual(_types(built["grouping"]), [f"{ACTIVITY}/learning-unit"])
        self.assertEqual(_types([built["self"]]), [f"{ACTIVITY}/component"])
        self.assertEqual(_types(built["parent"]), [f"{ACTIVITY}/learning-unit"])
        self.assertNotIn("itemId", built["extensions"])

    def test_a_unit_has_nothing_above_it(self):
        built = hierarchy.build(unit=UNIT, level="unit")
        self.assertEqual(built["grouping"], [])
        self.assertEqual(_types([built["self"]]), [f"{ACTIVITY}/learning-unit"])
        self.assertEqual(built["parent"], [])

    def test_the_media_format_of_the_ITEM_is_the_one_that_survives(self):
        """Both levels used to emit `mediaFormat`; the item's is the specific one."""
        built = hierarchy.build(unit=UNIT, component=COMPONENT, item=ITEM, level="item")
        self.assertEqual(built["extensions"]["mediaFormat"], "video")


class ContentStatementTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.object(
            config, "supplier_domain", return_value="https://app.yuvilab.co.il"
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.hierarchy = hierarchy.build(
            unit=UNIT, component=COMPONENT, item=ITEM, level="item"
        )

    def test_question_answered_reports_what_the_learner_chose(self):
        stmt = statements.question_answered(
            IDENTITY, SESSION,
            object_id="https://lomdot.education.gov.il/act/item/q1",
            question_id="q1", question_type="matching", attempt_number=2,
            response="מאזני כפות | מאזניים דיגיטליים", success=True,
            hierarchy=self.hierarchy,
        )
        self.assertEqual(stmt["result"]["response"], "מאזני כפות | מאזניים דיגיטליים")
        ext = _short(stmt["context"]["extensions"])
        self.assertEqual(ext["questionId"], "q1")
        self.assertEqual(ext["questionType"], "matching")
        self.assertEqual(ext["attemptNumber"], 2)
        self.assertNotIn("question_id", ext)          # the misnamed one is gone
        # A question nests under its questionnaire screen (the hierarchy's
        # deepest level), not directly under the component — the ministry's
        # answered example: parent = [questionnaire].
        self.assertEqual(stmt["context"]["contextActivities"]["parent"],
                         [self.hierarchy["self"]])

    def test_media_events_carry_format_position_and_duration(self):
        paused = statements.media_event(
            IDENTITY, SESSION, "paused",
            object_id="https://lomdot.education.gov.il/act/item",
            media_format="video", media_position_seconds=38,
            media_duration_seconds=73, duration_seconds=38,
            hierarchy=self.hierarchy,
        )
        ext = _short(paused["context"]["extensions"])
        self.assertEqual(ext["mediaFormat"], "video")
        # SECONDS, not ISO-8601 — the spec says "המיקום במדיה, בשניות" and its
        # examples are bare numbers (`"mediaPosition": 105`). Only
        # `result.duration` is a duration string.
        self.assertEqual(ext["mediaPosition"], 38)
        self.assertEqual(ext["mediaDuration"], 73)
        self.assertIsInstance(ext["mediaPosition"], int)
        self.assertEqual(paused["result"]["duration"], "PT38S")

    def test_a_media_object_is_typed_by_its_media_kind(self):
        """"סוג ה-Activity יהיה בהתאם לסוג המדיה" — a video item is
        `activities/video`, not the generic `activities/item`."""
        for media_format, expected in (
            ("video", "video"), ("audio", "audio"), ("animation", "animation"),
        ):
            with self.subTest(media_format=media_format):
                stmt = statements.media_event(
                    IDENTITY, SESSION, "played",
                    object_id="https://lomdot.education.gov.il/act/item",
                    media_format=media_format,
                )
                self.assertEqual(
                    stmt["object"]["definition"]["type"], f"{ACTIVITY}/{expected}"
                )

    def test_an_unrecognised_media_kind_stays_a_plain_item(self):
        """Inventing an activity IRI the ministry does not publish is worse than
        a generic one that is certainly valid."""
        stmt = statements.media_event(
            IDENTITY, SESSION, "played",
            object_id="https://lomdot.education.gov.il/act/item",
            media_format="hologram",
        )
        self.assertEqual(stmt["object"]["definition"]["type"], f"{ACTIVITY}/item")

    def test_an_unknown_media_position_is_omitted_not_guessed(self):
        played = statements.media_event(
            IDENTITY, SESSION, "played",
            object_id="https://lomdot.education.gov.il/act/item",
            media_format="video",
        )
        ext = _short(played["context"]["extensions"])
        self.assertEqual(ext["mediaFormat"], "video")
        self.assertNotIn("mediaPosition", ext)

    def test_a_zero_media_position_is_reported_not_dropped(self):
        """`played` at the start of a clip is position 0 — a real value that a
        falsy-check would silently discard."""
        played = statements.media_event(
            IDENTITY, SESSION, "played",
            object_id="https://lomdot.education.gov.il/act/item",
            media_format="video", media_position_seconds=0, media_duration_seconds=120,
        )
        ext = _short(played["context"]["extensions"])
        self.assertEqual(ext["mediaPosition"], 0)
        self.assertEqual(ext["mediaDuration"], 120)

    def test_selection_type_is_kebab_case(self):
        stmt = statements.selected(
            IDENTITY, SESSION, object_id="https://lomdot.education.gov.il/act/item",
            object_type="item", selection_type="practiceDecision", response="true",
        )
        self.assertEqual(_short(stmt["context"]["extensions"])["selectionType"],
                         "practice-decision")

    def test_every_dictionary_value_survives_the_conversion(self):
        for camel, kebab in (
            ("learningType", "learning-type"),
            ("practiceDecision", "practice-decision"),
            ("isUnderstood", "is-understood"),
            ("isRepeat", "is-repeat"),
            ("externalLearning", "external-learning"),
        ):
            self.assertEqual(statements.kebab(camel), kebab)
            self.assertIn(kebab, statements.SELECTION_TYPES)
            self.assertEqual(statements.kebab(kebab), kebab)   # idempotent

    def test_a_relayed_statement_gains_the_ancestry_it_never_had(self):
        raw = {
            "verb": {"id": "http://adlnet.gov/expapi/verbs/answered"},
            "object": {"id": "https://lomdot.education.gov.il/act/item/q1"},
            "result": {"success": True},
        }
        stmt = statements.enriched_content_statement(
            IDENTITY, SESSION, raw, hierarchy=self.hierarchy,
            context_extensions={"questionId": "q1", "attemptNumber": 1},
            result_extra={"response": "מאזני כפות"},
        )
        grouping = stmt["context"]["contextActivities"]["grouping"]
        grouping_types = _types(grouping)
        for level in ("learning-unit", "component"):
            self.assertIn(f"{ACTIVITY}/{level}", grouping_types)
        # Report 3: the deepest grouping entry is the statement's OWN object,
        # verbatim — not the catalog's item entry with a different id.
        self.assertEqual(grouping[-1], stmt["object"])
        self.assertEqual(_types(stmt["context"]["contextActivities"]["parent"]),
                         [f"{ACTIVITY}/component"])
        self.assertEqual(stmt["result"]["response"], "מאזני כפות")
        self.assertEqual(stmt["result"]["success"], True)      # the content's own survives
        self.assertEqual(_short(stmt["context"]["extensions"])["questionId"], "q1")

    def test_the_questionnaires_grouping_entry_keeps_the_objects_type(self):
        """Report 3, שאלון: the questionnaire's grouping tag was sent with type
        `item` — "יש לשלוח type כמו ב-object, לדוג questionnaire"."""
        raw = {
            "verb": {"id": "http://adlnet.gov/expapi/verbs/initialized"},
            "object": {
                "id": "https://lomdot.education.gov.il/act/quiz-1",
                "definition": {"type": f"{ACTIVITY}/questionnaire",
                               "name": {"he": "תרגול: מדידת מסה"}},
            },
        }
        stmt = statements.enriched_content_statement(
            IDENTITY, SESSION, raw, hierarchy=self.hierarchy,
        )
        grouping = stmt["context"]["contextActivities"]["grouping"]
        self.assertEqual(grouping[-1], stmt["object"])
        self.assertEqual(grouping[-1]["definition"]["type"], f"{ACTIVITY}/questionnaire")
        # The catalog's own differently-typed entry for that level must be gone.
        self.assertNotIn(f"{ACTIVITY}/video", _types(grouping))

    def test_answered_groups_the_exact_question_object(self):
        """Report 3, מענה על שאלה: the grouping carried an item "שלא ברור מה
        תוכנו" — different from the object. It must BE the object, nested under
        its screen: grouping = […, component, screen, question(object)]."""
        stmt = statements.question_answered(
            IDENTITY, SESSION,
            object_id="https://lomdot.education.gov.il/act/item/q1",
            question_id="q1", response="מאזני כפות", hierarchy=self.hierarchy,
        )
        grouping = stmt["context"]["contextActivities"]["grouping"]
        self.assertEqual(grouping[-1], stmt["object"])
        self.assertEqual(grouping[-2], self.hierarchy["self"])   # the screen above it

    def test_a_relayed_answer_nests_under_its_screen_too(self):
        raw = {
            "verb": {"id": "http://adlnet.gov/expapi/verbs/answered"},
            "object": {"id": "https://lomdot.education.gov.il/act/item/q1"},
        }
        stmt = statements.enriched_content_statement(
            IDENTITY, SESSION, raw, hierarchy=self.hierarchy,
            object_below_self=True,
        )
        grouping = stmt["context"]["contextActivities"]["grouping"]
        self.assertEqual(grouping[-1], stmt["object"])
        self.assertEqual(grouping[-2], self.hierarchy["self"])
        self.assertEqual(stmt["context"]["contextActivities"]["parent"],
                         [self.hierarchy["self"]])

    def test_selected_groups_the_exact_object_type_included(self):
        """Report 3, בחירה שאינה לימודית: "הפריט עצמו ב-grouping יהיה אותו
        אובייקט בדיוק כמו ב-object, נשלח type שונה"."""
        stmt = statements.selected(
            IDENTITY, SESSION,
            object_id="https://lomdot.education.gov.il/act/item",
            object_type="item", selection_type="learning-type", response="listening",
            hierarchy=self.hierarchy,
        )
        grouping = stmt["context"]["contextActivities"]["grouping"]
        self.assertEqual(grouping[-1], stmt["object"])
        # The hierarchy's item entry is a VIDEO — exactly the mismatch the
        # ministry flagged; the object's own `item` type must be what is sent.
        self.assertEqual(grouping[-1]["definition"]["type"], f"{ACTIVITY}/item")
        self.assertNotIn(f"{ACTIVITY}/video", _types(grouping))

    def test_a_conversation_still_carries_the_catalog_item_in_grouping(self):
        """A conversation's object lives OUTSIDE the content tree, so its
        grouping keeps the catalog's own entry for the item it is about."""
        stmt = statements.conversation_interacted(
            IDENTITY, SESSION, "conv-1", speaker="bot",
            conversation_trigger="student-request", help_type="hint",
            hierarchy=self.hierarchy,
        )
        grouping = stmt["context"]["contextActivities"]["grouping"]
        self.assertIn(f"{ACTIVITY}/video", _types(grouping))   # the catalog item
        self.assertNotIn(stmt["object"]["id"], [g.get("id") for g in grouping])

    def test_the_content_keeps_its_own_result_when_it_reported_one(self):
        raw = {
            "verb": {"id": "http://adlnet.gov/expapi/verbs/answered"},
            "object": {"id": "https://lomdot.education.gov.il/act/item/q1"},
            "result": {"response": "what the learner really chose"},
        }
        stmt = statements.enriched_content_statement(
            IDENTITY, SESSION, raw, result_extra={"response": "our guess"},
        )
        self.assertEqual(stmt["result"]["response"], "what the learner really chose")

    def test_every_extension_key_is_an_iri(self):
        """A bare key is a live 400 from the MoE LRS."""
        stmt = statements.question_answered(
            IDENTITY, SESSION, object_id="https://x/q1", question_id="q1",
            response="a", hierarchy=self.hierarchy,
        )
        for key in stmt["context"]["extensions"]:
            self.assertTrue(key.startswith(f"{EXT}/"), key)


class SmallerFindingsTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.object(
            config, "supplier_domain", return_value="https://app.yuvilab.co.il"
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_conversation_interacted_always_names_a_help_type(self):
        stmt = statements.conversation_interacted(
            IDENTITY, SESSION, "conv-1", speaker="student",
            conversation_trigger="student-request",
        )
        self.assertEqual(_short(stmt["context"]["extensions"])["helpType"], "other")

    def test_a_real_help_type_is_kept(self):
        stmt = statements.conversation_interacted(
            IDENTITY, SESSION, "conv-1", speaker="bot",
            conversation_trigger="misconception", help_type="explanation",
        )
        self.assertEqual(_short(stmt["context"]["extensions"])["helpType"], "explanation")

    def test_reflection_answer_and_skip_both_name_the_question(self):
        answered = statements.reflection_answered(
            IDENTITY, SESSION, "r-1", 1, score_raw=4, question_he="עד כמה הצלחת?"
        )
        skipped = statements.reflection_skipped(IDENTITY, SESSION, "r-1", 2)
        self.assertEqual(answered["object"]["definition"]["name"]["he"], "עד כמה הצלחת?")
        self.assertTrue(skipped["object"]["definition"]["name"]["he"])   # never absent

    def test_agency_answer_carries_its_score(self):
        stmt = statements.agency_answered(IDENTITY, SESSION, 1, "4", score_raw=4)
        self.assertEqual(stmt["result"]["score"], {"min": 1, "max": 5, "raw": 4})

    def test_dashboard_view_can_report_how_long_it_was_read(self):
        stmt = statements.dashboard_viewed(
            IDENTITY, SESSION, "student-personal", duration_seconds=95
        )
        self.assertEqual(stmt["result"]["duration"], "PT1M35S")


if __name__ == "__main__":
    unittest.main()
