"""Content-forward enrichment — extension keys must be IRIs (live MoE 400 fix)."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ.setdefault("LRS_SUPPLIER_DOMAIN", "https://720.example.co.il")

from app.services.lrs.statements import enriched_content_statement  # noqa: E402

IDENTITY = {"exidentifier": "1012345678", "school": "123456", "nmm": "90635956"}


def test_bare_extension_keys_are_mapped_to_iris():
    raw = {
        "verb": {"id": "https://lxp.education.gov.il/xapi/moe/verbs/answered"},
        "object": {"id": "https://content.example/q1"},
        "result": {"success": True, "extensions": {"attemptNumber": 2}},
        "context": {"extensions": {
            "question_id": "q1",
            "https://lxp.education.gov.il/xapi/moe/extensions/questionType": "mc",
            "misconception": None,
        }},
    }
    statement = enriched_content_statement(IDENTITY, "sess-1", raw)
    ctx_ext = statement["context"]["extensions"]
    assert all(key.startswith("http") for key in ctx_ext)
    assert ctx_ext["https://lxp.education.gov.il/xapi/moe/extensions/question_id"] == "q1"
    assert ctx_ext["https://lxp.education.gov.il/xapi/moe/extensions/questionType"] == "mc"
    assert not any("misconception" in key for key in ctx_ext)   # None values dropped
    result_ext = statement["result"]["extensions"]
    assert list(result_ext) == ["https://lxp.education.gov.il/xapi/moe/extensions/attemptNumber"]


def test_empty_extensions_are_removed_entirely():
    raw = {
        "verb": {"id": "https://lxp.education.gov.il/xapi/moe/verbs/answered"},
        "object": {"id": "https://content.example/q1"},
        "context": {"extensions": {"only_null": None}},
    }
    statement = enriched_content_statement(IDENTITY, "sess-1", raw)
    assert "extensions" not in statement["context"]
