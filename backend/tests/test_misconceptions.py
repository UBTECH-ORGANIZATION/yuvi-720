"""The vendor's common-mistakes catalog is parsed, not truncated at 900 chars."""

from __future__ import annotations

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import misconceptions  # noqa: E402

NOTE = """מסך על השלמת קודקודים.
מטרת השאלה: לזהות קטעים המקבילים לצירים.
טעויות נפוצות – יעד 2
השלמת שיעורי קודקודים של קטעים המקבילים לצירים ברביע הראשון
1. החלפת שיעור ה־x בשיעור ה־y
תיאור:
התלמיד מעתיק את השיעור הלא נכון מנקודה אחרת.
דוגמה:
במקום להעתיק את שיעור ה־x הוא מעתיק את שיעור ה־y.
________________________________________
2. בלבול בין שורה לטור במערכת הצירים
תיאור:
התלמיד מחליף בין שורה (קו אופקי) לבין טור (קו אנכי).
בפועל:
•	שורה → אותו שיעור y.
________________________________________
3. קביעה שגויה של סוג המרובע
תיאור: התלמיד מזהה מלבן רק לפי המראה של הסרטוט.
"""


class TheCatalog(unittest.TestCase):
    def test_the_note_and_the_catalog_come_apart(self):
        note, items = misconceptions.split_information(NOTE)
        self.assertTrue(note.endswith("לזהות קטעים המקבילים לצירים."))
        self.assertEqual([t for t, _ in items], [
            "החלפת שיעור ה־x בשיעור ה־y", "בלבול בין שורה לטור במערכת הצירים",
            "קביעה שגויה של סוג המרובע"])
        self.assertEqual(items[1][1], "התלמיד מחליף בין שורה (קו אופקי) לבין טור (קו אנכי).")
        self.assertEqual(items[2][1], "התלמיד מזהה מלבן רק לפי המראה של הסרטוט.")

    def test_every_mistake_is_named_and_the_likely_one_explained(self):
        note, line = misconceptions.for_bundle(NOTE, [{"misconception": "בלבול בין שורה לטור"}])
        self.assertIn("1) החלפת שיעור", line)
        self.assertIn("3) קביעה שגויה", line)
        self.assertIn("likely now #2: התלמיד מחליף בין שורה", line)
        self.assertNotIn("טעויות נפוצות", note)

    def test_a_note_without_a_catalog_is_untouched(self):
        self.assertEqual(misconceptions.for_bundle("סתם הערה", []), ("סתם הערה", ""))

    def test_off_by_default(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("COACH_MISCONCEPTION_CATALOG", None)
            self.assertFalse(misconceptions.enabled())


if __name__ == "__main__":
    unittest.main()
