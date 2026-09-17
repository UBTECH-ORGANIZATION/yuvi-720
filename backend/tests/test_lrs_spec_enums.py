"""Every closed list the reporter emits is a list the ministry's spec prints.

The v1.1 markdown (`docs/LRS/מסמך התממשקות LRS.md`) is the contract; an ENUM
value that does not appear in it verbatim is a value the LRS never asked for.
This is what caught the reversed `selectionType` tokens (`type-learning` for
`learning-type`): every earlier test pinned the code to itself.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

from app.services.lrs import statements

SPEC = Path(__file__).resolve().parents[2] / "docs" / "LRS" / "מסמך התממשקות LRS.md"
_KEBAB = re.compile(r"\b[a-z]+(?:-[a-z]+)+\b")
_WORD = re.compile(r"\b[a-z]+\b")


class SpecEnumTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        text = SPEC.read_text(encoding="utf-8")
        cls.kebab_tokens = set(_KEBAB.findall(text))
        cls.words = set(_WORD.findall(text))

    def assert_subset(self, values: set[str], label: str) -> None:
        missing = {
            value for value in values
            if value not in self.kebab_tokens and value not in self.words
        }
        self.assertEqual(missing, set(), f"{label}: not in the v1.1 spec text")

    def test_selection_types_are_the_pdf_tokens(self) -> None:
        self.assertEqual(
            set(statements.SELECTION_TYPES),
            {"learning-type", "practice-decision", "is-understood", "is-repeat", "external-learning"},
        )
        self.assert_subset(set(statements.SELECTION_TYPES), "selectionType")

    def test_conversation_lists(self) -> None:
        self.assert_subset(set(statements.CONVERSATION_TRIGGERS), "conversationTrigger")
        self.assert_subset(set(statements.HELP_TYPES), "helpType")

    def test_help_requested_lists(self) -> None:
        self.assert_subset(set(statements.REQUESTED_HELP_TYPES), "requested.helpType")
        self.assert_subset(set(statements.HELP_SOURCES), "helpSource")

    def test_reflection_dashboard_goal_lists(self) -> None:
        self.assert_subset(set(statements.REFLECTION_TRIGGERS), "reflectionTrigger")
        self.assert_subset(set(statements.DASHBOARD_TYPES), "dashboard type")
        self.assert_subset(set(statements.GOAL_TYPES), "goalType")

    def test_mentoring_phases_are_phase1_to_phase10(self) -> None:
        self.assertEqual(set(statements.MENTORING_PHASES), {f"phase{n}" for n in range(1, 11)})
        # The spec prints only the pattern's first member; the ladder file the
        # ministry references carries the rest.
        self.assertRegex(SPEC.read_text(encoding="utf-8"), r"phase1\b")

    def test_content_types_are_kata_vocabulary(self) -> None:
        self.assertEqual(
            set(statements.CONTENT_TYPES),
            {"instruction", "practice", "presentation", "motivational", "summary", "simulation", "video"},
        )


if __name__ == "__main__":
    unittest.main()
