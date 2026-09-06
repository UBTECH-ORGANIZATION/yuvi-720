"""Catalogue material has a name in every language the product speaks.

Two independent failures put "Writing coordinates of a point" on a Hebrew
teacher's screen as the name of a lesson called "כתיבת שיעורי נקודה - 1א", and
only one of them was missing data:

1. **A mapping bug.** Kata keys `titleTranslations` by LOCALE CODE
   (`{"he": …}`) while `languages` uses a language LABEL ("Hebrew"). The unit
   normalizer looked the translation keys up in the label map, every key
   missed, the map came back `{}`, and the unit fell through to its flat
   `title` — which on the CET rows is an English machine label. The Hebrew was
   in the payload the whole time.

2. **Genuinely absent translations.** Components ship `titleTranslations: null`
   on every row; most units and every sub-topic ship Hebrew only. No amount of
   reading fixes that, so those names are translated once, deliberately, by a
   script, and stored.
"""

from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import catalog_i18n, kata_catalog, kata_client
from app.services.learning_sessions import _lesson_header_title


def run(coro):
    return asyncio.run(coro)


class TitleTranslationsTest(unittest.TestCase):
    """The parse. Both key spellings, because the provider uses both."""

    def test_locale_codes_are_read(self):
        """The live shape, verbatim from `GET /catalog/content-units/{id}`."""
        titles = kata_client.title_translations({"titleTranslations": {
            "he": "כתיבת שיעורי נקודה - 1א",
            "ar": "كتابة إحداثيات نقطة- 1א",
            "en": "Writing coordinates of a point",
        }})
        self.assertEqual(titles["he"], "כתיבת שיעורי נקודה - 1א")
        self.assertEqual(titles["en"], "Writing coordinates of a point")
        self.assertEqual(len(titles), 3)

    def test_language_labels_are_still_read(self):
        """The shape the old code was written for. Dropping it would trade one
        silent empty map for another."""
        titles = kata_client.title_translations({"titleTranslations": {
            "Hebrew": "עברית", "Arabic": "عربي", "English": "English",
        }})
        self.assertEqual(titles, {"he": "עברית", "ar": "عربي", "en": "English"})

    def test_an_unknown_language_is_dropped_not_guessed(self):
        titles = kata_client.title_translations({"titleTranslations": {
            "he": "עברית", "Russian": "русский", "fr": "français",
        }})
        self.assertEqual(titles, {"he": "עברית"})

    def test_blank_and_missing_are_the_same_as_absent(self):
        self.assertEqual(kata_client.title_translations({}), {})
        self.assertEqual(kata_client.title_translations({"titleTranslations": None}), {})
        self.assertEqual(
            kata_client.title_translations({"titleTranslations": {"he": "  "}}), {})

    def test_the_unit_normalizer_keeps_them(self):
        """The end of the bug: a normalized unit carries its translations."""
        unit = kata_client.normalize_unit({
            "id": "CET.MATH.G7", "title": "Writing coordinates of a point",
            "titleTranslations": {"he": "כתיבת שיעורי נקודה", "en": "Writing coordinates"},
            "components": [],
        })
        self.assertEqual(unit["titles"]["he"], "כתיבת שיעורי נקודה")

    def test_units_and_objectives_agree_about_the_field(self):
        """They read the same provider field and used to disagree about how it
        is keyed — which is how one shipped a broken map while the other
        worked."""
        payload = {"titleTranslations": {"he": "כותרת", "en": "Title"}}
        unit = kata_client.normalize_unit({"id": "u", "title": "t", **payload,
                                           "components": []})
        objective = kata_client.normalize_objective({
            "id": "o", "title": "d", "subtopic": {"id": "s", "title": "t", **payload},
        })
        self.assertEqual(unit["titles"], objective["sub_topic"]["titles"])


class LessonHeaderTitleTest(unittest.TestCase):
    def test_hebrew_header_uses_the_provider_translation(self):
        title = _lesson_header_title({
            "title": "Writing coordinates of a point",
            "titles": {"he": "כתיבת שיעורי נקודה - 1א"},
            "objective_id": "objective",
        }, "he")
        self.assertEqual(title, "כתיבת שיעורי נקודה - 1א")

    @patch("app.services.learning_sessions.kata_catalog.objective_title")
    def test_hebrew_header_rejects_an_english_provider_fallback(self, objective_title):
        objective_title.return_value = "מערכת הצירים"
        title = _lesson_header_title({
            "title": "Writing coordinates of a point",
            "titles": {},
            "objective_id": "objective",
        }, "he")
        self.assertEqual(title, "מערכת הצירים")
        objective_title.assert_called_once_with("objective", "he")


class SourceLocaleTest(unittest.TestCase):
    def test_a_hebrew_name_is_hebrew(self):
        self.assertEqual(catalog_i18n.source_locale_of("כתיבת שיעורי נקודה"), "he")

    def test_an_arabic_name_is_arabic(self):
        self.assertEqual(catalog_i18n.source_locale_of("كتابة إحداثيات نقطة"), "ar")

    def test_anything_else_is_english(self):
        self.assertEqual(catalog_i18n.source_locale_of("Writing coordinates"), "en")

    def test_numbers_and_punctuation_do_not_change_the_reading(self):
        self.assertEqual(catalog_i18n.source_locale_of("תרגול בסיסי 2 (א)"), "he")


class LadderTest(unittest.TestCase):
    """vendor → stored → source. In that order, always."""

    def setUp(self):
        catalog_i18n._STORED.clear()

    def tearDown(self):
        catalog_i18n._STORED.clear()

    def _store(self, **titles):
        catalog_i18n._STORED["component:c1"] = {
            "_id": "component:c1", "kind": "component", "catalog_id": "c1",
            "source_text": "תרגול בסיסי", "titles": titles,
        }

    def test_the_vendor_wins(self):
        """Their Arabic name is the published one. A generated name that
        disagrees with it is a second name for the same lesson."""
        self._store(ar="مولّد")
        self.assertEqual(
            catalog_i18n.title("component", "c1", "ar",
                               vendor={"ar": "المنشور"}, fallback="תרגול בסיסי"),
            "المنشور")

    def test_a_stored_translation_is_used_when_the_vendor_has_none(self):
        self._store(ar="تدريب أساسي")
        self.assertEqual(
            catalog_i18n.title("component", "c1", "ar", vendor={}, fallback="תרגול בסיסי"),
            "تدريب أساسي")

    def test_the_source_string_is_the_floor(self):
        """Never null and never an id: an untranslated Hebrew name beats a
        blank, because a teacher can read it."""
        self.assertEqual(
            catalog_i18n.title("component", "c1", "en", vendor={}, fallback="תרגול בסיסי"),
            "תרגול בסיסי")

    def test_a_renamed_lesson_drops_its_old_translation(self):
        """The stored row remembers what it translated FROM. A renamed lesson
        showing its OLD name in Arabic is worse than showing its new one in
        Hebrew — the second is visibly untranslated, the first is just wrong."""
        self._store(ar="تدريب أساسي")
        self.assertEqual(
            catalog_i18n.title("component", "c1", "ar", vendor={},
                               fallback="תרגול מתקדם"),      # the vendor renamed it
            "תרגול מתקדם")

    def test_whitespace_is_not_a_rename(self):
        self._store(ar="تدريب أساسي")
        self.assertEqual(
            catalog_i18n.title("component", "c1", "ar", vendor={},
                               fallback="  תרגול   בסיסי "),
            "تدريب أساسي")

    def test_nothing_at_all_is_none(self):
        self.assertIsNone(catalog_i18n.title("component", "c1", "he", vendor={}, fallback=""))
        self.assertIsNone(catalog_i18n.title("component", None, "he", vendor={}, fallback=None))


class GapsTest(unittest.TestCase):
    def setUp(self):
        catalog_i18n._STORED.clear()

    tearDown = setUp

    def _rows(self):
        return [
            {"kind": "component", "id": "c1", "source_text": "תרגול בסיסי", "vendor": {}},
            {"kind": "unit", "id": "u1", "source_text": "יחידה",
             "vendor": {"ar": "وحدة", "en": "Unit"}},
        ]

    def test_the_language_a_name_is_already_in_is_not_missing(self):
        """Otherwise every Hebrew row bills a model call to translate Hebrew
        into Hebrew, and stores the result as though it were a translation."""
        gaps = {row["id"]: row["missing"] for row in catalog_i18n.gaps(self._rows())}
        self.assertEqual(gaps["c1"], ["ar", "en"])
        self.assertNotIn("u1", gaps)          # vendor covers ar+en, source is he

    def test_a_stored_translation_closes_the_gap(self):
        catalog_i18n._STORED["component:c1"] = {
            "source_text": "תרגול בסיסי", "titles": {"ar": "تدريب أساسي"},
        }
        gaps = {row["id"]: row["missing"] for row in catalog_i18n.gaps(self._rows())}
        self.assertEqual(gaps["c1"], ["en"])

    def test_rows_with_no_name_are_skipped_not_crashed_on(self):
        self.assertEqual(catalog_i18n.gaps([{"kind": "unit", "id": "u", "source_text": ""}]), [])


class AccessorTest(unittest.TestCase):
    """What the screens actually call."""

    COMPONENT = {"id": "c1", "title": "תרגול בסיסי", "unit_id": "u1"}
    UNIT = {"id": "u1", "title": "Writing coordinates", "titles": {"he": "כתיבת שיעורים"}}

    def setUp(self):
        catalog_i18n._STORED.clear()
        self._patches = [
            patch("app.services.kata_catalog.get_component",
                  side_effect=lambda cid: self.COMPONENT if cid == "c1" else None),
            patch("app.services.kata_catalog.get_unit",
                  side_effect=lambda uid: self.UNIT if uid == "u1" else None),
        ]
        for item in self._patches:
            item.start()

    def tearDown(self):
        for item in self._patches:
            item.stop()
        catalog_i18n._STORED.clear()

    def test_a_unit_prefers_its_own_translation_over_its_flat_title(self):
        """The exact screenshot: the flat title is the English machine label."""
        self.assertEqual(kata_catalog.unit_title("u1", "he"), "כתיבת שיעורים")
        self.assertEqual(kata_catalog.unit_title("u1", "en"), "Writing coordinates")

    def test_a_component_uses_the_stored_translation(self):
        catalog_i18n._STORED["component:c1"] = {
            "source_text": "תרגול בסיסי", "titles": {"en": "Basic practice"},
        }
        self.assertEqual(kata_catalog.component_title("c1", "en"), "Basic practice")
        self.assertEqual(kata_catalog.component_title("c1", "he"), "תרגול בסיסי")

    def test_a_title_that_is_its_own_id_is_not_a_name(self):
        """`_catalog_spine` used to write `title or component_id`, so an
        untitled component arrived carrying its id as a name. Translating an
        identifier produces an identifier nobody can search for."""
        with patch("app.services.kata_catalog.get_component",
                   return_value={"id": "c9", "title": "c9"}):
            self.assertIsNone(kata_catalog.component_title("c9", "he"))

    def test_missing_rows_are_none_never_an_id(self):
        self.assertIsNone(kata_catalog.component_title("nope", "he"))
        self.assertIsNone(kata_catalog.unit_title("nope", "he"))
        self.assertIsNone(kata_catalog.unit_title(None, "he"))


class StoreTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        catalog_i18n._STORED.clear()

    tearDown = setUp

    async def test_a_second_run_does_not_erase_the_first(self):
        """One run fills Arabic, the next fills English. The second must not
        drop the first — a partial model response is the normal case."""
        with patch("app.services.catalog_i18n._get_collection_named", return_value=None):
            await catalog_i18n.put("component", "c1", source_text="תרגול",
                                   titles={"ar": "تدريب"})
            row = await catalog_i18n.put("component", "c1", source_text="תרגול",
                                         titles={"en": "Practice"})
        self.assertEqual(row["titles"], {"ar": "تدريب", "en": "Practice"})

    async def test_a_rename_starts_the_row_over(self):
        with patch("app.services.catalog_i18n._get_collection_named", return_value=None):
            await catalog_i18n.put("component", "c1", source_text="תרגול", titles={"ar": "تدريب"})
            row = await catalog_i18n.put("component", "c1", source_text="מבחן",
                                         titles={"en": "Test"})
        self.assertEqual(row["titles"], {"en": "Test"})

    async def test_an_unknown_kind_is_refused(self):
        with self.assertRaises(ValueError):
            await catalog_i18n.put("lesson", "c1", source_text="x", titles={"en": "y"})

    async def test_locales_we_do_not_speak_are_dropped(self):
        with patch("app.services.catalog_i18n._get_collection_named", return_value=None):
            row = await catalog_i18n.put("unit", "u1", source_text="יחידה",
                                         titles={"en": "Unit", "ru": "Юнит", "fr": ""})
        self.assertEqual(row["titles"], {"en": "Unit"})

    async def test_a_dead_store_never_breaks_a_screen(self):
        """Reading a title is on every render. A translation store that cannot
        be reached must degrade to the vendor's own names, silently."""
        # A plain mock, not an AsyncMock: `find` is sync and returns a cursor,
        # and an AsyncMock leaves an un-awaited coroutine behind when it raises.
        collection = MagicMock()
        collection.find.side_effect = RuntimeError("boom")
        with patch("app.services.catalog_i18n._get_collection_named", return_value=collection):
            await catalog_i18n.load()
        self.assertEqual(catalog_i18n.loaded_count(), 0)


if __name__ == "__main__":
    unittest.main()
