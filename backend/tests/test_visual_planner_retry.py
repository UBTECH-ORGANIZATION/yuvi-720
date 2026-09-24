"""The visual planner pays twice only when a second try can change the answer.

A considered decline is final unless the learner explicitly asked for a
picture; an unusable answer (empty or unparseable) earns one more try. The
"would a picture help" cue comes from the learner's own words — a support
button's prompt is our wording, and reading the cue from it retried every
declined hint on the strong tier.
"""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents import manim_visual  # noqa: E402
from app.services.ai_usage import UsageContext  # noqa: E402

USAGE = UsageContext(actor_id="t", actor_type="system", endpoint="t", feature="t",
                     operation="coach.visual_plan", source="t")
HINT_PROMPT = ("תן/י כיוון חשיבה רחב לשאלה הנוכחית — איזה סוג של צעד, השוואה או עיקרון "
               "כדאי לנסות, השוו בין הגרפים והטבלה")


def _plan(responses, message, learner_text=None, reply="נסו להשוות בין שני הצדדים."):
    llm = mock.AsyncMock(side_effect=list(responses))
    with mock.patch.object(manim_visual, "call_llm", llm):
        scene = asyncio.run(manim_visual.plan_manim_visual(
            message, reply, "he", USAGE, learner_text=learner_text))
    return scene, llm.await_count


class TheRetryPolicy(unittest.TestCase):
    def test_a_declined_support_hint_is_not_retried(self):
        _, calls = _plan(['{"visual": false}', '{"visual": false}'], HINT_PROMPT, learner_text="")
        self.assertEqual(calls, 1)

    def test_an_explicit_ask_gets_its_second_try(self):
        _, calls = _plan(['{"visual": false}', '{"visual": false}'], "תצייר לי את זה בבקשה")
        self.assertEqual(calls, 2)

    def test_an_unusable_answer_gets_its_second_try(self):
        for first in ("not json at all", None):
            _, calls = _plan([first, '{"visual": false}'], "מה ההבדל?", learner_text="")
            self.assertEqual(calls, 2, first)


if __name__ == "__main__":
    unittest.main()
