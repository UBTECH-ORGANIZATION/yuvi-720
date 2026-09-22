from __future__ import annotations

import unittest

from app.services.progression.curve import (
    LEVEL_START_XP,
    MAX_LEVEL,
    RULES_VERSION,
    XP_TO_NEXT,
    level_table,
    status_for_total_xp,
)


class ProgressionCurveTests(unittest.TestCase):
    def test_curve_has_one_transition_for_each_level_before_cap(self) -> None:
        self.assertEqual(len(XP_TO_NEXT), MAX_LEVEL - 1)
        self.assertEqual(len(LEVEL_START_XP), MAX_LEVEL + 1)
        self.assertEqual(RULES_VERSION, 1)

    def test_approved_cumulative_thresholds(self) -> None:
        self.assertEqual(LEVEL_START_XP[28], 24_600)
        self.assertEqual(LEVEL_START_XP[29], 25_700)
        self.assertEqual(LEVEL_START_XP[30], 26_800)
        self.assertEqual(LEVEL_START_XP[50], 48_800)
        self.assertTrue(all(XP_TO_NEXT[level - 1] == 1_100 for level in range(28, 50)))

    def test_level_boundaries_are_exact(self) -> None:
        self.assertEqual(status_for_total_xp(-5)["level"], 1)
        self.assertEqual(status_for_total_xp(99)["level"], 1)
        self.assertEqual(status_for_total_xp(100)["level"], 2)
        self.assertEqual(status_for_total_xp(25_699)["level"], 28)
        self.assertEqual(status_for_total_xp(25_700)["level"], 29)

    def test_status_reports_current_level_progress(self) -> None:
        status = status_for_total_xp(4_970)
        self.assertEqual(status["level"], 16)
        self.assertEqual(status["currentLevelXp"], 320)
        self.assertEqual(status["xpToNext"], 650)
        self.assertEqual(status["nextLevelTotalXp"], 5_300)
        self.assertAlmostEqual(status["progress"], 320 / 650)

    def test_level_fifty_is_a_display_cap(self) -> None:
        status = status_for_total_xp(99_999)
        self.assertEqual(status["level"], 50)
        self.assertIsNone(status["xpToNext"])
        self.assertIsNone(status["nextLevel"])
        self.assertEqual(status["progress"], 1.0)


if __name__ == "__main__":
    unittest.main()

    def test_level_table_is_the_curve_row_by_row(self) -> None:
        table = level_table()
        self.assertEqual([row["level"] for row in table], list(range(1, MAX_LEVEL + 1)))
        self.assertEqual(table[0], {"level": 1, "startXp": 0, "xpToNext": 100})
        self.assertEqual(table[1]["startXp"], 100)
        self.assertEqual(table[9], {"level": 10, "startXp": LEVEL_START_XP[10], "xpToNext": 350})
        # The cap has no bar to fill, exactly as `status_for_total_xp` reports it.
        self.assertEqual(table[-1], {"level": MAX_LEVEL, "startXp": LEVEL_START_XP[MAX_LEVEL], "xpToNext": None})
        for row in table[:-1]:
            self.assertEqual(row["startXp"] + row["xpToNext"], LEVEL_START_XP[row["level"] + 1])
