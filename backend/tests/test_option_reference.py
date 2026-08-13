"""סעיף / תשובה / אופציה / אפשרות all name one answer choice.

Learners use the four words interchangeably for the radio options in front of
them, and the UI shows neither numbers nor letters — so "מה סעיף ב אומר" means
"what does option 2 say". Left to the model this was decided inconsistently:
some phrasings were answered about the option, and others were pulled back to
restating the question text, which on this screen literally starts with a
"סעיף א:" label of its own. Resolving it here removes the choice.

The fixture is the real screen from `…-02-001`, whose question text carries
that colliding label and whose options are the four the learner can pick.
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents.coach import _numbered_options, _referenced_option  # noqa: E402

OPTIONS = [
    "כן, התוצאה של שחר",
    "כן, התוצאה של עדן",
    "כן, התוצאה של פלג",
    "לא. כל התוצאות סבירות",
]


class TheFourWordsAreInterchangeable(unittest.TestCase):
    def test_each_word_with_a_letter_resolves_to_the_same_option(self) -> None:
        for message in (
            "מה סעיף ב אומר",
            "מה אומרת תשובה ב'?",
            "מה אומרת אופציה ב?",
            "אפשרות ב' מה היא אומרת?",
        ):
            with self.subTest(message=message):
                self.assertEqual(_referenced_option(message, OPTIONS), (2, OPTIONS[1]))

    def test_each_word_with_a_digit_resolves_to_the_same_option(self) -> None:
        for message in (
            "מה סעיף 2 אומר",
            "תסביר לי בבקשה את תשובה 2.",
            "מה אומרת אופציה 2?",
            "אתה יכול לפרט יותר על אפשרות 2?",
        ):
            with self.subTest(message=message):
                self.assertEqual(_referenced_option(message, OPTIONS), (2, OPTIONS[1]))

    def test_the_reported_phrasing(self) -> None:
        """The exact message that failed: 'מה סעיף ב אומר' = option 2."""
        self.assertEqual(_referenced_option("מה סעיף ב אומר", OPTIONS), (2, OPTIONS[1]))

    def test_word_order_and_wrapping_text_do_not_matter(self) -> None:
        for message in (
            "לא הבנתי מה כתוב בסעיף א, אתה יכול להסביר?",
            "אני מתלבט, מה בעצם אומרת אופציה א'?",
            "שאלה קטנה: תשובה א מה היא בעצם טוענת ולמה?",
            "אפשרות א — מה הכוונה שם?",
        ):
            with self.subTest(message=message):
                self.assertEqual(_referenced_option(message, OPTIONS), (1, OPTIONS[0]))

    def test_every_position_is_reachable(self) -> None:
        for index, letter in enumerate("אבגד", start=1):
            with self.subTest(letter=letter):
                self.assertEqual(
                    _referenced_option(f"מה אומר סעיף {letter}?", OPTIONS),
                    (index, OPTIONS[index - 1]),
                )

    def test_a_position_that_does_not_exist_is_not_invented(self) -> None:
        for message in ("מה אומרת תשובה 9?", "מה אומר סעיף ט?"):
            with self.subTest(message=message):
                self.assertIsNone(_referenced_option(message, OPTIONS))

    def test_a_message_naming_nothing_resolves_to_nothing(self) -> None:
        for message in (
            "אפשר רמז?",
            "לא הבנתי את השאלה",
            "מה התשובה הנכונה פה?",
            "תסביר לי את השאלה בבקשה",
        ):
            with self.subTest(message=message):
                self.assertIsNone(_referenced_option(message, OPTIONS))

    def test_no_options_means_no_reference(self) -> None:
        self.assertIsNone(_referenced_option("מה סעיף ב אומר", []))


class OptionsAreTaggedForTheModel(unittest.TestCase):
    """The rendered list is what lets the model agree with the resolver."""

    def test_every_option_carries_both_a_number_and_a_letter(self) -> None:
        rendered = _numbered_options(OPTIONS)
        for index, letter in enumerate("אבגד", start=1):
            self.assertIn(f"[{index}/{letter}]", rendered)

    def test_an_empty_list_renders_a_dash(self) -> None:
        self.assertEqual(_numbered_options([]), "—")


if __name__ == "__main__":
    unittest.main()
