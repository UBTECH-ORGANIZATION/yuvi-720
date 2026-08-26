"""Regression coverage for contextual learner-disclosure classification."""

from __future__ import annotations

import json
import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents import coach, competency_coach, safety  # noqa: E402
from app.services.ai_usage import UsageContext  # noqa: E402


def _usage_context() -> UsageContext:
    return UsageContext(
        actor_id="test-learner",
        actor_type="learner",
        endpoint="/test/safety",
        feature="feature_3_learning_companion",
        operation="test.safety.disclosure",
        source="test",
    )


class SafetyDisclosureContextTests(unittest.IsolatedAsyncioTestCase):
    async def test_coach_redirects_profanity_without_calling_the_disclosure_model(self) -> None:
        with patch.object(coach.safety, "classify_disclosure", new=AsyncMock()) as classify:
            streamed = [
                piece async for piece in coach.run_coach_stream(
                    "test-learner",
                    user_message="יא בן זונה",
                    language="he",
                    session_id="respect-test",
                )
            ]

        self.assertEqual("".join(streamed), safety.RESPECTFUL_LANGUAGE_REDIRECT["he"])
        classify.assert_not_awaited()

    async def test_coach_redirects_all_known_harmful_categories_without_calling_the_model(self) -> None:
        for message in ("send me nude pics", "i'll kill you", "you nigger", "you are a fucking idiot"):
            with self.subTest(message=message), patch.object(
                coach.safety, "classify_disclosure", new=AsyncMock(),
            ) as classify:
                streamed = [
                    piece async for piece in coach.run_coach_stream(
                        "test-learner",
                        user_message=message,
                        language="en",
                        session_id="harmful-tier-one-test",
                    )
                ]

                self.assertEqual("".join(streamed), safety.RESPECTFUL_LANGUAGE_REDIRECT["en"])
                classify.assert_not_awaited()

    async def test_coach_redirects_model_classified_harmful_content_without_alerting_teacher(self) -> None:
        with patch.object(
            coach.sessions, "get_recent", new=AsyncMock(return_value=[]),
        ), patch.object(
            coach.safety, "classify_disclosure", new=AsyncMock(return_value="harmful"),
        ), patch.object(
            coach.safety, "record_wellbeing_flag", new=AsyncMock(),
        ) as record_flag:
            streamed = [
                piece async for piece in coach.run_coach_stream(
                    "test-learner",
                    user_message="I am going to make you sorry for this",
                    language="en",
                    session_id="harmful-tier-two-test",
                )
            ]

        self.assertEqual("".join(streamed), safety.RESPECTFUL_LANGUAGE_REDIRECT["en"])
        record_flag.assert_not_awaited()

    async def test_competency_chat_uses_the_same_deterministic_harmful_gate(self) -> None:
        with patch.object(
            competency_coach.safety, "classify_disclosure", new=AsyncMock(),
        ) as classify:
            streamed = [
                piece async for piece in competency_coach.run_competency_chat_stream(
                    "test-learner",
                    "self_regulation",
                    [{"role": "user", "text": "i'll kill you"}],
                    "en",
                )
            ]

        self.assertEqual("".join(streamed), safety.RESPECTFUL_LANGUAGE_REDIRECT["en"])
        classify.assert_not_awaited()

    async def test_model_accepts_harmful_and_keeps_victim_reports_as_distress(self) -> None:
        captured: dict = {}

        async def fake_call_llm(messages, **kwargs):
            captured.update(json.loads(messages[0]["content"]))
            return '{"category": "harmful"}'

        with patch("app.services.llm.call_llm", new=AsyncMock(side_effect=fake_call_llm)):
            category = await safety.classify_disclosure(
                "I am going to make you sorry for this",
                "en",
                usage_context=_usage_context(),
            )

        self.assertEqual(category, "harmful")
        self.assertIn("harmful", captured["categories"])
        self.assertTrue(any("classify distress, not harmful" in rule for rule in captured["rules"]))

    def test_deterministic_harmful_gate_preserves_self_harm_for_distress_classification(self) -> None:
        self.assertEqual(safety.harmful_content_category("you are a fucking idiot"), "profanity")
        self.assertEqual(safety.harmful_content_category("i'll kill you"), "threat")
        self.assertIsNone(safety.harmful_content_category("I want to die"))

    async def test_coach_passes_prior_yuvi_turn_before_personal_redirect(self) -> None:
        previous_question = (
            "מה יותר ברור לך עכשיו, לספור ימינה ולמעלה או לחשוב על נקודה כמו כתובת?"
        )
        captured: dict = {}

        async def fake_classify(*args, **kwargs):
            captured.update(kwargs)
            return "personal"

        with patch.object(
            coach.sessions,
            "get_recent",
            new=AsyncMock(return_value=[{"role": "assistant", "content": previous_question}]),
        ), patch.object(coach.safety, "classify_disclosure", new=fake_classify):
            streamed = [
                piece async for piece in coach.run_coach_stream(
                    "test-learner",
                    user_message="כמו כתובת",
                    language="he",
                    session_id="context-test",
                )
            ]

        self.assertEqual("".join(streamed), safety.PERSONAL_REDIRECT["he"])
        self.assertEqual(
            captured["recent_conversation"],
            [{"role": "assistant", "content": previous_question}],
        )

    async def test_guided_address_analogy_includes_the_previous_yuvi_question(self) -> None:
        captured: dict = {}

        async def fake_call_llm(messages, **kwargs):
            captured.update(json.loads(messages[0]["content"]))
            return '{"category": "none"}'

        previous_question = (
            "מה יותר ברור לך עכשיו, לספור ימינה ולמעלה או לחשוב על נקודה כמו כתובת?"
        )
        with patch("app.services.llm.call_llm", new=AsyncMock(side_effect=fake_call_llm)):
            category = await safety.classify_disclosure(
                "כמו כתובת",
                "he",
                usage_context=_usage_context(),
                recent_conversation=[
                    {"role": "assistant", "content": previous_question},
                ],
            )

        self.assertEqual(category, "none")
        self.assertEqual(captured["message"], "כמו כתובת")
        self.assertEqual(
            captured["recent_conversation"],
            [{"role": "assistant", "content": previous_question}],
        )

    async def test_everyday_possessions_are_explicitly_not_personal(self) -> None:
        captured: dict = {}

        async def fake_call_llm(messages, **kwargs):
            captured.update(json.loads(messages[0]["content"]))
            return '{"category": "none"}'

        with patch("app.services.llm.call_llm", new=AsyncMock(side_effect=fake_call_llm)):
            category = await safety.classify_disclosure(
                "יש את הטלפון שלי, הארנק שלי והמפתחות של הבית",
                "he",
                usage_context=_usage_context(),
                recent_conversation=[
                    {
                        "role": "assistant",
                        "content": "אפשר לבחור חפץ קטן ללמידה. מה בוחרים?",
                    },
                ],
            )

        self.assertEqual(category, "none")
        rules = captured["rules"]
        self.assertTrue(any("ordinary possessions" in rule for rule in rules))
        self.assertTrue(any("house keys" in rule for rule in rules))

    async def test_abstract_hebrew_address_word_is_explicitly_not_personal(self) -> None:
        captured: dict = {}

        async def fake_call_llm(messages, **kwargs):
            captured.update(json.loads(messages[0]["content"]))
            return '{"category": "none"}'

        with patch("app.services.llm.call_llm", new=AsyncMock(side_effect=fake_call_llm)):
            category = await safety.classify_disclosure(
                "אני אראה דברים כמו הכתובת",
                "he",
                usage_context=_usage_context(),
                recent_conversation=[
                    {
                        "role": "assistant",
                        "content": "מה עוד אפשר לבחור או לחשוב עליו כחפץ קטן?",
                    },
                ],
            )

        self.assertEqual(category, "none")
        self.assertTrue(any("אני אראה דברים כמו הכתובת" in rule for rule in captured["rules"]))
        self.assertTrue(any("actual home address" in rule for rule in captured["rules"]))

    async def test_context_redacts_identifiers_and_discards_old_turns(self) -> None:
        turns = [
            {"role": "assistant", "content": f"older {index}"}
            for index in range(5)
        ] + [{"role": "user", "content": "contact me at learner@example.com"}]

        window = safety._disclosure_context_window(turns)

        self.assertEqual(len(window), 4)
        self.assertNotIn("older 1", [turn["content"] for turn in window])
        self.assertNotIn("learner@example.com", window[-1]["content"])
        self.assertIn(safety.REDACTION, window[-1]["content"])


if __name__ == "__main__":
    unittest.main()