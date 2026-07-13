"""Deterministic learner-mapping reflection quality checks."""

from __future__ import annotations

import json
from pathlib import Path
import unittest

from app.services.reflection_engine import build_reflection
from questionnaire_locales import get_questionnaire_for_language


_ACTION_CODES = {
    "part_academic": "acad_action",
    "part_growth": "growth_action",
    "part_responsibility": "resp_action",
    "part_regulation": "reg_action",
    "part_self_awareness": "aware_action",
    "part_environment": "env_action",
}


class ReflectionEngineTests(unittest.TestCase):
    def test_every_non_empty_reflection_has_at_least_two_coherent_questions(self) -> None:
        """A single grounded signal gets a related action follow-up in every phase."""
        parts = get_questionnaire_for_language("he")["parts"]

        for part in parts:
            with self.subTest(part=part["id"]):
                source = part["questions"][0]
                qa_pairs = [{
                    "question": source["text"],
                    "answer": source["options"][-1],
                }]
                reflection = build_reflection(part["id"], qa_pairs, "he")
                codes = [question["code"] for question in reflection["questions"]]

                self.assertGreaterEqual(len(codes), 2)
                self.assertLessEqual(len(codes), 3)
                self.assertEqual(len(codes), len(set(codes)))
                self.assertIn(_ACTION_CODES[part["id"]], codes)

    def test_neutral_phase_does_not_add_unnecessary_questions(self) -> None:
        """The two-question minimum applies only when an answer needs clarification."""
        part = get_questionnaire_for_language("he")["parts"][1]
        source = part["questions"][0]
        middle = len(source["options"]) // 2
        reflection = build_reflection(
            part["id"],
            [{"question": source["text"], "answer": source["options"][middle]}],
            "he",
        )

        self.assertEqual(reflection["profile"], "neutral")
        self.assertEqual(reflection["questions"], [])

    def test_action_followups_are_complete_in_every_supported_locale(self) -> None:
        locale_root = Path(__file__).resolve().parents[2] / "locales"
        for language in ("he", "en", "ar"):
            messages = json.loads((locale_root / f"{language}.json").read_text(encoding="utf-8"))
            for code in _ACTION_CODES.values():
                with self.subTest(language=language, code=code):
                    self.assertTrue(messages[f"reflect.q.{code}.prompt"])
                    for option_index in range(4):
                        self.assertTrue(messages[f"reflect.q.{code}.opt.{option_index}"])


if __name__ == "__main__":
    unittest.main()
