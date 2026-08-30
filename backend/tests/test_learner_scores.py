"""Independence & Concentration scoring (PBI 451).

    python -m pytest tests/test_learner_scores.py -q

What is worth pinning here is the honesty of the arithmetic, not the numbers:
asking WELL raises independence while asking for answers lowers it; a child
who never asks and never succeeds does not score as independent; abandoning a
spun-out question is not "giving up"; a missing sub-score renormalizes and is
REPORTED, never silently absorbed; and thin evidence withholds the number
instead of shipping a confident guess.
"""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import learner_scores

NOW = datetime.now(timezone.utc)


def _at(days_ago: float) -> str:
    return (NOW - timedelta(days=days_ago)).isoformat()


def _attempt(days_ago=1.0, *, success=True, effortful=True, comp="c1", item="i1",
             question="q1", objective="MATH-1", session="s1", elapsed=30.0):
    return {
        "verb": "answered",
        "launch": comp, "sub_item_id": item, "question_id": question,
        "objective_id": objective, "session_id": session,
        "result": {"success": success},
        "effortful": effortful,
        "timing": {"elapsed_since_previous_seconds": elapsed, "quality": "measured"},
        "occurred_at": _at(days_ago),
    }


def _support(days_ago=1.0, *, kind="hint", comp="c1", item="i1", question="q1"):
    return {"kind": kind, "component_id": comp, "item_id": item,
            "question_id": question, "at": _at(days_ago)}


def _label(days_ago=1.0, *, label="conceptual"):
    return {"kind": "question_quality", "at": _at(days_ago), "meta": {"label": label}}


class TriedBeforeAsking(unittest.TestCase):
    def test_a_request_after_an_own_attempt_qualifies(self) -> None:
        sub = learner_scores._tried_before_asking(
            [_attempt(days_ago=2.0, success=False)], [_support(days_ago=1.0)])
        self.assertEqual(sub["value"], 1.0)

    def test_a_request_before_any_attempt_does_not(self) -> None:
        sub = learner_scores._tried_before_asking(
            [_attempt(days_ago=1.0, success=False)], [_support(days_ago=2.0)])
        self.assertEqual(sub["value"], 0.0)
        self.assertEqual(sub["evidence"],
                         {"support_requests": 1, "after_own_attempt": 0})

    def test_a_rapid_guess_is_not_a_real_try(self) -> None:
        sub = learner_scores._tried_before_asking(
            [_attempt(days_ago=2.0, success=False, effortful=False)],
            [_support(days_ago=1.0)])
        self.assertEqual(sub["value"], 0.0)


class QuestionQuality(unittest.TestCase):
    def test_asking_well_scores_above_asking_for_answers(self) -> None:
        good = learner_scores._question_quality([_label(label="self_diagnostic")])
        bad = learner_scores._question_quality([_label(label="answer_seeking")])
        self.assertGreater(good["value"], bad["value"])

    def test_off_topic_feeds_concentration_not_independence(self) -> None:
        sub = learner_scores._question_quality([_label(label="off_topic")])
        self.assertIsNone(sub["value"])
        self.assertEqual(sub["n"], 0)


class Persistence(unittest.TestCase):
    def test_two_attempts_then_walking_away_is_a_give_up(self) -> None:
        events = [
            _attempt(days_ago=1.2, success=False),
            _attempt(days_ago=1.1, success=False),
            {"verb": "skipped", "session_id": "s1", "occurred_at": _at(1.0)},
        ]
        sub = learner_scores._persistence(events)
        self.assertEqual(sub["value"], 0.0)
        self.assertEqual(sub["evidence"], {"struggled_questions": 1, "gave_up": 1})

    def test_wheel_spinning_is_not_giving_up(self) -> None:
        # Many effortful attempts without progress, then leaving: productive
        # disengagement — excluded from both sides, never a give-up.
        events = [
            _attempt(days_ago=1.4, success=False),
            _attempt(days_ago=1.3, success=False),
            _attempt(days_ago=1.2, success=False),
            _attempt(days_ago=1.1, success=False),
            {"verb": "exit", "session_id": "s1", "occurred_at": _at(1.0)},
        ]
        sub = learner_scores._persistence(events)
        self.assertIsNone(sub["value"])
        self.assertEqual(sub["n"], 0)

    def test_struggling_and_staying_scores_full(self) -> None:
        events = [
            _attempt(days_ago=1.2, success=False),
            _attempt(days_ago=1.1, success=False),
        ]
        sub = learner_scores._persistence(events)
        self.assertEqual(sub["value"], 1.0)


class Recovery(unittest.TestCase):
    def test_no_struggle_is_no_evidence_not_a_zero(self) -> None:
        sub = learner_scores._recovery([_attempt(success=True)], [])
        self.assertIsNone(sub["value"])
        self.assertEqual(sub["n"], 0)

    def test_recovered_share_of_struggle_runs(self) -> None:
        events = [
            _attempt(days_ago=1.4, success=False),
            _attempt(days_ago=1.3, success=False),
            _attempt(days_ago=1.2, success=True),
        ]
        signals = [{"kind": "recovery", "at": _at(1.2)}]
        sub = learner_scores._recovery(events, signals)
        self.assertEqual(sub["value"], 1.0)
        self.assertEqual(sub["evidence"], {"struggle_runs": 1, "recovered": 1})


class RapidGuessing(unittest.TestCase):
    def test_rapid_guesses_pull_concentration_down(self) -> None:
        events = [_attempt(effortful=True), _attempt(effortful=False),
                  _attempt(effortful=False), _attempt(effortful=True)]
        sub = learner_scores._rapid_guess_rate(events)
        self.assertEqual(sub["value"], 0.5)
        self.assertEqual(sub["evidence"], {"answers": 4, "rapid_guesses": 2})


class Composite(unittest.TestCase):
    def _sub(self, value, n=6):
        return {"value": value, "n": n, "evidence": {"n": n}}

    def test_a_missing_subscore_renormalizes_and_is_reported(self) -> None:
        block = learner_scores._composite({
            "on_task_share": self._sub(None, 0),
            "idle_share": self._sub(1.0),
            "rapid_guess_rate": self._sub(1.0),
            "sustained_effort": self._sub(1.0),
            "off_topic_chat": self._sub(1.0),
        }, learner_scores.CONCENTRATION_WEIGHTS)
        self.assertEqual(block["value"], 100)
        self.assertEqual(block["coverage"],
                         {"missing": ["on_task_share"], "renormalized": True})

    def test_the_weights_travel_with_the_subscores(self) -> None:
        block = learner_scores._composite({
            key: self._sub(0.5) for key in learner_scores.INDEPENDENCE_WEIGHTS
        }, learner_scores.INDEPENDENCE_WEIGHTS)
        weights = {s["key"]: s["weight"] for s in block["subscores"]}
        self.assertEqual(weights, learner_scores.INDEPENDENCE_WEIGHTS)

    def test_thin_evidence_withholds_the_number(self) -> None:
        block = learner_scores._composite({
            key: self._sub(0.9 if key == "tried_before_asking" else None,
                           n=1 if key == "tried_before_asking" else 0)
            for key in learner_scores.INDEPENDENCE_WEIGHTS
        }, learner_scores.INDEPENDENCE_WEIGHTS)
        self.assertIsNone(block["value"])
        self.assertFalse(block["evidenceOk"])
        # The raw numbers stay: withholding the score never hides the evidence.
        self.assertTrue(all("evidence" in s for s in block["subscores"]))

    def test_never_asking_and_never_succeeding_is_not_independence(self) -> None:
        # Zero support requests, zero labels, zero solved questions: nothing
        # weighs in, so there is no score at all — not a high one.
        block = learner_scores._composite({
            key: self._sub(None, 0) for key in learner_scores.INDEPENDENCE_WEIGHTS
        }, learner_scores.INDEPENDENCE_WEIGHTS)
        self.assertIsNone(block["value"])


class Trend(unittest.TestCase):
    def _block(self, raw, ok=True):
        return {"evidenceOk": ok, "_raw": raw}

    def test_a_small_shift_reads_flat(self) -> None:
        trend = learner_scores._trend(self._block(72.0), self._block(70.5))
        self.assertEqual(trend["direction"], "flat")

    def test_a_real_shift_has_a_direction_in_points(self) -> None:
        trend = learner_scores._trend(self._block(72.0), self._block(60.0))
        self.assertEqual(trend, {"direction": "up", "deltaPoints": 12.0})

    def test_no_honest_comparison_means_no_arrow(self) -> None:
        trend = learner_scores._trend(self._block(72.0), self._block(None, ok=False))
        self.assertEqual(trend, {"direction": None, "deltaPoints": None})


class EndToEnd(unittest.IsolatedAsyncioTestCase):
    async def test_the_payload_carries_the_contract(self) -> None:
        events = [_attempt(days_ago=d / 10, success=d % 3 != 0)
                  for d in range(1, 30)]
        with patch("app.services.events.get_learner_events",
                   new=AsyncMock(return_value=events)), \
                patch("app.services.learner_activity.rows",
                      new=AsyncMock(return_value=[_support(days_ago=0.5)])), \
                patch("app.agents.tutor_decision.recent_tutor_decisions",
                      new=AsyncMock(return_value=[])), \
                patch("app.services.learner_signals.recent",
                      new=AsyncMock(return_value=[_label(days_ago=0.5)])), \
                patch("app.auth.repository.get_user_by_id",
                      new=AsyncMock(return_value={"last_login_at": _at(0.1)})):
            payload = await learner_scores.student_scores("kid")
        self.assertEqual(set(payload), {"independence", "concentration",
                                        "windowDays", "windowTruncated"})
        concentration = payload["concentration"]
        self.assertIn("on_task_share", concentration["coverage"]["missing"])
        self.assertIn("sessionShape", concentration)
        self.assertNotIn("_raw", concentration)
        for block in (payload["independence"], concentration):
            self.assertEqual(
                [s["key"] for s in block["subscores"]],
                list((learner_scores.INDEPENDENCE_WEIGHTS
                      if block is payload["independence"]
                      else learner_scores.CONCENTRATION_WEIGHTS)))
            self.assertIn("trend", block)


if __name__ == "__main__":
    unittest.main()
