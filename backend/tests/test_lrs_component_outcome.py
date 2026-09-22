"""The ministry's component completion carries the CONTENT PROVIDER's verdict.

Kata's own `completed` on a component has carried `result.success` and
`score.scaled` since 09/2026 (seen 22/09/2026: 10/11 → success=false). The
outbound statement must say what the lomda said — the same verdict the roadmap
judged from the stored event — and only count the answers itself when the
provider was silent.
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("SPARK_STORAGE", "json")
os.environ.setdefault("SPARK_ENVIRONMENT", "test")

from app.services import events  # noqa: E402

LAUNCH = "methodica-science-mass-measure-01-01"


def _answers(*verdicts: bool) -> list[dict]:
    return [
        {"launch": LAUNCH, "verb": "answered", "sub_item_id": f"item-{i}", "question_id": "q1",
         "result": {"success": verdict}}
        for i, verdict in enumerate(verdicts)
    ]


def _completion(result: dict | None) -> dict:
    return {"learner_id": "lrs-student", "session_id": "sess", "launch": LAUNCH,
            "verb": "completed", "result": result or {}}


def test_the_providers_verdict_wins_over_our_count(monkeypatch):
    # Every answer we saw was right — counting would say success=true — but the
    # lomda itself judged the component failed (a question we never saw graded).
    async def all_right(_learner, _session):
        return _answers(True, True, True)
    monkeypatch.setattr(events, "get_session_events", all_right)

    outcome = asyncio.run(events._component_outcome(_completion({"success": False, "score_scaled": 0.9090909})))
    assert outcome == {"success": False, "score": {"scaled": 0.9091}}


def test_a_provider_verdict_without_a_score_keeps_our_counted_score(monkeypatch):
    async def two_of_three(_learner, _session):
        return _answers(True, False, True)
    monkeypatch.setattr(events, "get_session_events", two_of_three)

    outcome = asyncio.run(events._component_outcome(_completion({"success": True})))
    assert outcome == {"success": True, "score": {"scaled": 0.6667}}


def test_a_silent_provider_falls_back_to_the_count(monkeypatch):
    async def last_attempt_decides(_learner, _session):
        rows = _answers(False, True)
        rows.append({"launch": LAUNCH, "verb": "answered", "sub_item_id": "item-0", "question_id": "q1",
                     "result": {"success": True}})   # item-0 retried and corrected
        return rows
    monkeypatch.setattr(events, "get_session_events", last_attempt_decides)

    outcome = asyncio.run(events._component_outcome(_completion(None)))
    assert outcome == {"success": True, "score": {"scaled": 1.0}}


def test_no_verdict_and_no_graded_answer_reports_nothing(monkeypatch):
    async def nothing(_learner, _session):
        return []
    monkeypatch.setattr(events, "get_session_events", nothing)

    assert asyncio.run(events._component_outcome(_completion({"success": None}))) == {}
