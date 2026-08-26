"""The language filter: what it must catch, and what it must not.

Two halves, and the second is the one that decides whether a school keeps this
turned on. A filter that blocks `הזן את התשובה` or `התשובה היא אפס` is a filter
a teacher routes around within a week, and then nothing is screened at all — so
the false-positive suite here is not politeness, it is the feature working.

The evasion cases come from the reference implementation's own tuning
(`vibe-coding-kids/src/backend/content_filter.py`); the false-positive cases
come from this product's actual vocabulary, which is maths and science.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import content_filter as cf     # noqa: E402


def flagged(text: str) -> bool:
    return cf.check_content(text).flagged


def category(text: str) -> str | None:
    return cf.check_content(text).category


class CatchesTheObvious(unittest.TestCase):
    def test_plain_profanity_in_three_languages(self):
        for text in ["you are a fucking idiot", "יא בן זונה", "شرموط"]:
            self.assertTrue(flagged(text), text)

    def test_a_threat(self):
        for text in ["i'll kill you", "לך תמות", "hope you die"]:
            self.assertTrue(flagged(text), text)
            self.assertEqual(category(text), cf.THREAT, text)

    def test_sexual_solicitation(self):
        for text in ["send me nude pics", "תמונות עירום", "show me your body"]:
            self.assertTrue(flagged(text), text)
            self.assertEqual(category(text), cf.SEXUAL, text)

    def test_a_slur_is_hate_not_profanity(self):
        # The distinction is not cosmetic: a reviewer triaging a week of blocked
        # messages needs the slurs separated from the swearing.
        self.assertEqual(category("you nigger"), cf.HATE)
        self.assertEqual(category("יא מפגר"), cf.HATE)

    def test_hebrew_slur_spellings_are_hate(self):
        for text in ["מתחנגל", "ימתחנגל"]:
            with self.subTest(text=text):
                self.assertEqual(category(text), cf.HATE)


class Evasion(unittest.TestCase):
    def test_leet(self):
        for text in ["sh1t", "f4ck you", "you are a b1tch"]:
            self.assertTrue(flagged(text), text)

    def test_separators(self):
        for text in ["s-h-i-t", "f.u.c.k", "b_i_t_c_h"]:
            self.assertTrue(flagged(text), text)

    def test_spaced_out_letters(self):
        self.assertTrue(flagged("f u c k this"))

    def test_repeated_characters(self):
        for text in ["fuuuuck", "shiiiiit"]:
            self.assertTrue(flagged(text), text)

    def test_niqqud(self):
        # Hebrew vowel marks are invisible to a naive substring match.
        self.assertTrue(flagged("חֲרָא"))

    def test_a_hebrew_prefix_letter(self):
        self.assertTrue(flagged("הזונה הזאת"))

    def test_case(self):
        self.assertTrue(flagged("FUCK OFF"))


class NeverBlocksALesson(unittest.TestCase):
    """Every string here is something this product legitimately says.

    Each one was a hit under the reference's word list, which is why the list
    was re-cut rather than ported.
    """

    LESSON_TEXT = [
        # `אפס` — zero — is in the reference's insult list.
        "התשובה היא אפס, כל הכבוד",
        # `הזין`/`מזין` reduce to a three-letter profanity under prefix
        # stripping. "הזן את התשובה" is a sentence this app shows children.
        "הזן את התשובה בתיבה",
        "התלמיד הזין את הנתונים",
        "מזון מזין חשוב לגוף",
        # `שמן` — oil — and `תחת` — beneath — are both in the reference's list.
        "השמן צף מעל המים",
        "הכוח הפועל תחת המשטח",
        # `חמור` is both "donkey" and "severe".
        "זו טעות חמורה, בוא נתקן",
        # `תיזהר` — "be careful" — is a lab-safety instruction there.
        "תיזהר, הכוס חמה",
        # `כוס` is a cup. `כוסות` is cups.
        "מזגו שלוש כוסות מים",
        # `מוות` and `die`/`kill` appear in real science and history material.
        "התא מת בתהליך הזה",
        "the cell will die without oxygen",
        "this kills the bacteria",
        # English substrings that contain bad words: class, gradient, assess.
        "the whole class assessed the gradient",
        "Cassandra passed the assessment",
        # `hate`, `dumb`, `stupid` in the reference's list; ordinary here.
        "I hate waiting for the bus",
        # Sums that leet-decode into letters.
        "5 + 4 = 9, 3 + 0 = 3",
        # An empty or whitespace message is not harmful, it is empty.
        "", "   ",
    ]

    def test_none_of_it_is_flagged(self):
        for text in self.LESSON_TEXT:
            with self.subTest(text=text):
                self.assertFalse(flagged(text), f"blocked a lesson: {text!r}")

    def test_ordinary_praise_and_correction(self):
        for text in [
            "עבודה יפה מאוד! ראיתי שהתאמצת בשאלה 3",
            "נסה שוב את סעיף ב', אתה קרוב",
            "Great work today — see me about question 4",
        ]:
            with self.subTest(text=text):
                self.assertFalse(flagged(text), text)


class DistressIsItsOwnThing(unittest.TestCase):
    def test_self_harm_is_categorised_separately(self):
        for text in [
            "אני רוצה למות",
            "לא רוצה לחיות יותר",
            "i want to die",
            "kill myself",
            "אני חושב להתאבד",
        ]:
            with self.subTest(text=text):
                self.assertEqual(category(text), cf.SELF_HARM, text)

    def test_distress_outranks_profanity_in_the_same_message(self):
        # Resolution order is most-urgent-first, so a message that is both is
        # reported as the one that needs a person.
        self.assertEqual(category("i fucking want to die"), cf.SELF_HARM)

    def test_is_distress_only_says_yes_for_self_harm(self):
        self.assertTrue(cf.is_distress(cf.SELF_HARM))
        for other in (cf.SEXUAL, cf.HATE, cf.THREAT, cf.PROFANITY, None):
            self.assertFalse(cf.is_distress(other), other)

    def test_talking_about_a_dead_relative_is_not_self_harm(self):
        # The line the phrase patterns exist to draw: grief is not intent.
        for text in ["סבא שלי מת בשנה שעברה", "my grandfather died last year"]:
            with self.subTest(text=text):
                self.assertFalse(flagged(text), text)


class TheVerdictShape(unittest.TestCase):
    def test_a_clean_message_has_no_category(self):
        verdict = cf.check_content("שלום, איך הולך?")
        self.assertFalse(verdict.flagged)
        self.assertIsNone(verdict.category)

    def test_every_category_returned_is_a_declared_one(self):
        # A typo'd category string would route a self-harm message into the
        # ordinary deny path, silently.
        samples = ["fuck", "i want to die", "send me nude pics", "kill you", "nigger"]
        for text in samples:
            with self.subTest(text=text):
                self.assertIn(cf.check_content(text).category, cf.CATEGORIES)


if __name__ == "__main__":
    unittest.main()
