"""The coach must never hand over the correct answer — deterministically.

Anchored on a real production leak: a learner typed "תן לי את התשובה" and the
coach replied "התשובה היא שהבלון המנופח כבד יותר, כי יש בו אוויר...".
"""

from __future__ import annotations

import unittest

from app.agents import answer_guard


# The question from the observed leak: which balloon weighs more?
BALLOON = {
    "text": "איזה בלון כבד יותר — המנופח או הריק?",
    "options": ["הבלון המנופח כבד יותר", "הבלון הריק כבד יותר", "שניהם שוקלים אותו דבר"],
    "correct": ["הבלון המנופח כבד יותר"],
}

NUMERIC = {
    "text": "כמה גרם שוקלת הקוביה?",
    "options": ["12 גרם", "18 גרם", "24 גרם"],
    "correct": ["12 גרם"],
}

ENGLISH = {
    "text": "Which state of matter has a fixed volume but no fixed shape?",
    "options": ["Solid", "Liquid", "Gas"],
    "correct": ["Liquid"],
}


class AnswerGuardTest(unittest.TestCase):
    def test_blocks_the_observed_production_leak(self):
        guard = answer_guard.build(BALLOON)
        self.assertIsNotNone(guard)
        self.assertTrue(guard.reveals(
            "התשובה היא שהבלון המנופח כבד יותר, כי יש בו אוויר, ולחמצן יש מסה."
        ))

    def test_blocks_naming_the_correct_option_without_the_word_answer(self):
        guard = answer_guard.build(BALLOON)
        self.assertTrue(guard.reveals("הבלון המנופח כבד יותר."))
        self.assertTrue(guard.reveals("אז זה המנופח."))

    def test_allows_comparing_the_options_without_settling_it(self):
        """Weighing both sides is coaching, not revealing."""
        guard = answer_guard.build(BALLOON)
        self.assertFalse(guard.reveals(
            "מה דעתך — המנופח או הריק? מה בעצם נכנס לבלון כשמנפחים אותו?"
        ))

    def test_allows_ordinary_guiding_turns(self):
        guard = answer_guard.build(BALLOON)
        for sentence in (
            "בוא נתחיל מהשאלה מה יש בתוך הבלון אחרי שמנפחים אותו.",
            "לאוויר יש מסה — איך זה משפיע על מה שנמצא על המאזניים?",
            "מה הצעד הראשון שהיית בודק כאן?",
            "אני רואה שהתלבטת קודם על שאלה דומה, בוא ננסה ייצוג אחר.",
        ):
            self.assertFalse(guard.reveals(sentence), sentence)

    def test_blocks_the_answer_assertion_in_every_language(self):
        guard = answer_guard.build(ENGLISH)
        self.assertTrue(guard.reveals("The answer is that a liquid keeps its volume."))
        self.assertTrue(guard.reveals("So the correct answer is the second one."))
        ar = answer_guard.build({"options": ["صلب", "سائل"], "correct": ["سائل"]})
        self.assertTrue(ar.reveals("الإجابة هي الخيار الثاني."))

    def test_answer_assertion_does_not_catch_praise_or_a_question(self):
        guard = answer_guard.build(BALLOON)
        self.assertFalse(guard.reveals("התשובה שלך נכונה, יפה מאוד!"))
        self.assertFalse(guard.reveals("מה התשובה שאתה שוקל לסמן?"))

    def test_blocks_a_numeric_answer_but_not_a_distractor_value(self):
        guard = answer_guard.build(NUMERIC)
        self.assertTrue(guard.reveals("יוצא 12 גרם."))
        self.assertFalse(guard.reveals("אם היינו מקבלים 18 גרם, מה זה היה אומר?"))

    def test_diacritics_and_punctuation_do_not_defeat_the_guard(self):
        guard = answer_guard.build(ENGLISH)
        self.assertTrue(guard.reveals("**Liquid** — that's the one."))
        he = answer_guard.build({"options": ["מוצק", "נוזל"], "correct": ["נוזל"]})
        self.assertTrue(he.reveals("נוֹזֵל!"))

    def test_assertion_is_blocked_even_when_the_question_is_unknown(self):
        """Kata's events are sparse; the guard must not switch off in the gap."""
        for question in (None, {}, {"text": "?", "options": ["א", "ב"], "correct": []}):
            guard = answer_guard.build(question)
            self.assertFalse(guard.active)
            self.assertTrue(guard.reveals("התשובה היא שהבלון המנופח כבד יותר."))
            self.assertTrue(guard.reveals("The answer is the second option."))

    def test_unknown_question_still_lets_normal_coaching_through(self):
        guard = answer_guard.build(None)
        for sentence in (
            "מה אתה רואה על המסך כרגע?",
            "בוא ננסה לפרק את זה לצעדים קטנים.",
            "התשובה שלך נכונה, כל הכבוד!",
        ):
            self.assertFalse(guard.reveals(sentence), sentence)

    def test_two_character_answers_are_left_to_the_prompt_layer(self):
        """Documented limitation: "לא" is too common to token-match safely."""
        guard = answer_guard.build({"options": ["כן", "לא"], "correct": ["לא"]})
        if guard is not None:
            self.assertFalse(guard.reveals("זה לא תמיד עובד ככה, בוא נבדוק."))

    def test_multiple_correct_answers_are_all_guarded(self):
        guard = answer_guard.build({
            "options": ["חמצן", "חנקן", "ברזל", "זהב"],
            "correct": ["חמצן", "חנקן"],
        })
        self.assertTrue(guard.reveals("מדובר בחנקן."))
        self.assertFalse(guard.reveals("האם מדובr במתכת כמו ברזל או זהב?"))


if __name__ == "__main__":
    unittest.main()
