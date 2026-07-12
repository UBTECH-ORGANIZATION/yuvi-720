"""Voice selection checks for the avatar-aware Learning Coach speech path."""

from __future__ import annotations

import unittest

from app.services.speech import voice_for


class AvatarVoiceTests(unittest.TestCase):
    def test_classic_avatar_uses_male_voice_in_each_language(self) -> None:
        self.assertEqual(voice_for("he", "classic"), ("he-IL", "he-IL-AvriNeural"))
        self.assertEqual(voice_for("ar", "classic"), ("ar-SA", "ar-SA-HamedNeural"))
        self.assertEqual(voice_for("en", "classic"), ("en-US", "en-US-GuyNeural"))

    def test_girl_avatar_uses_female_voice_in_each_language(self) -> None:
        self.assertEqual(voice_for("he", "girl"), ("he-IL", "he-IL-HilaNeural"))
        self.assertEqual(voice_for("ar", "girl"), ("ar-SA", "ar-SA-ZariyahNeural"))
        self.assertEqual(voice_for("en", "girl"), ("en-US", "en-US-JennyNeural"))

    def test_unknown_values_fall_back_to_classic_hebrew(self) -> None:
        self.assertEqual(voice_for("unknown", "unknown"), ("he-IL", "he-IL-AvriNeural"))


if __name__ == "__main__":
    unittest.main()