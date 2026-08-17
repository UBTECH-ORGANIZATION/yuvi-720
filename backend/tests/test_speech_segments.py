"""Language runs for the mixed-language read-aloud path."""

from __future__ import annotations

import unittest

from app.services.speech_segments import split_by_script


class SplitByScriptTests(unittest.TestCase):
    def test_hebrew_wrapping_english_gives_three_runs(self) -> None:
        runs = split_by_script("בוא ננסה משפט קצר: I have a dog. נסה לחזור אחריי.")
        self.assertEqual([language for language, _ in runs], ["he", "en", "he"])

    def test_no_character_is_lost(self) -> None:
        for text in (
            "Yes! I like to sing. נהדר, בוא נמשיך.",
            'בוא נתרגם: "אני אוהב" באנגלית זה I like. נסה!',
            "היי! אני מצוין, תודה ששאלת.",
        ):
            self.assertEqual("".join(part for _, part in split_by_script(text)), text)

    def test_a_stray_short_word_does_not_change_voice(self) -> None:
        runs = split_by_script("אני אוהב לשחק כדורגל, זה OK בסדר גמור.")
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0][0], "he")

    def test_single_language_text_is_one_run(self) -> None:
        self.assertEqual(len(split_by_script("Hello, how are you today?")), 1)
        self.assertEqual(split_by_script("Hello, how are you today?")[0][0], "en")

    def test_scriptless_text_falls_back_to_the_reply_language(self) -> None:
        self.assertEqual(split_by_script("123 — 456", default_language="he"), [("he", "123 — 456")])

    def test_empty_text_has_no_runs(self) -> None:
        self.assertEqual(split_by_script(""), [])


if __name__ == "__main__":
    unittest.main()
