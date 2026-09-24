"""Integration report 10 (24/09): the contract index cites only statements that
pass their own test row.

The report graded the ids the index named, and the index named the newest
`questionnaire`/`question` statement of the run — the reflection the content-IRI
rewrite had mislabelled on 23/09 at 13:19 UTC (fixed in PR #134). Those shapes
are pinned here as never citable.
"""
import importlib.util
import os
import unittest

HERE = os.path.dirname(__file__)
SPEC = importlib.util.spec_from_file_location(
    "lrs_test_script_report", os.path.join(HERE, "..", "scripts", "lrs_test_script_report.py"))
report = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(report)

DOMAIN = "https://spark.yuvilab.ai"
ACT = "https://lxp.education.gov.il/xapi/moe/activities"
EXT = "https://lxp.education.gov.il/xapi/moe/extensions"
SCREEN = "methodica-science-mass-measure-01-01-010"
COMPONENT = {"id": f"{DOMAIN}/component/methodica-science-mass-measure-01-01", "definition": {"type": f"{ACT}/component"}}
QUESTIONNAIRE = {"id": f"{DOMAIN}/item/questionnaire/{SCREEN}", "definition": {"type": f"{ACT}/questionnaire"}}


def entry(obj, *, parent, grouping, extensions=None):
    return {"id": "x", "statement": {
        "object": obj,
        "context": {"contextActivities": {"parent": parent, "grouping": grouping},
                    "extensions": {f"{EXT}/{k}": v for k, v in (extensions or {}).items()}},
    }}


class ContractValidTests(unittest.TestCase):
    def test_a_questionnaire_under_a_questionnaire_is_not_cited(self):
        # a4d1d873 / 61cae064 — report 10: "parent שגוי: questionnaire נדרש: component".
        broken = entry(QUESTIONNAIRE, parent=[QUESTIONNAIRE], grouping=[COMPONENT, QUESTIONNAIRE])
        self.assertFalse(report.contract_valid("questionnaire", "initialized", broken))
        good = entry(QUESTIONNAIRE, parent=[COMPONENT], grouping=[COMPONENT, QUESTIONNAIRE])
        self.assertTrue(report.contract_valid("questionnaire", "initialized", good))

    def test_an_answer_without_its_question_in_grouping_or_its_extensions_is_not_cited(self):
        # 7dab0a76 — report 10: "חסר תיוג של question ב-grouping" + missing questionId/questionType/attemptNumber.
        question = {"id": f"{DOMAIN}/item/question/{SCREEN}/2", "definition": {"type": f"{ACT}/question"}}
        broken = entry(question, parent=[QUESTIONNAIRE], grouping=[COMPONENT, QUESTIONNAIRE])
        self.assertFalse(report.contract_valid("question", "answered", broken))
        no_extensions = entry(question, parent=[COMPONENT], grouping=[COMPONENT, question])
        self.assertFalse(report.contract_valid("question", "answered", no_extensions))
        good = entry(question, parent=[COMPONENT], grouping=[COMPONENT, question],
                     extensions={"questionId": "q2", "questionType": "open", "attemptNumber": 1})
        self.assertTrue(report.contract_valid("question", "answered", good))

    def test_a_vendor_iri_is_not_cited(self):
        vendor = {"id": "https://learning.cet.ac.il/metadata/X-00001", "definition": {"type": f"{ACT}/component"}}
        self.assertFalse(report.contract_valid("component / item", "initialized", entry(vendor, parent=[], grouping=[vendor])))


if __name__ == "__main__":
    unittest.main()
