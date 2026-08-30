"""Unlock rules: what badges and streaks are worth, and that locks actually hold."""

import unittest
from datetime import date

from app.services import unlocks
from app.services.streaks import active_days, current_day_streak, longest_day_streak


def badge(subject, earned=True):
    return {"subject": subject, "earned": earned}


class StreakTests(unittest.TestCase):
    def test_current_streak_counts_back_from_today(self) -> None:
        days = {"2026-08-07", "2026-08-08", "2026-08-09"}
        self.assertEqual(current_day_streak(days, date(2026, 8, 9)), 3)

    def test_yesterday_still_counts_as_alive(self) -> None:
        # A learner who has not opened the app yet today has not lost the streak.
        days = {"2026-08-07", "2026-08-08"}
        self.assertEqual(current_day_streak(days, date(2026, 8, 9)), 2)

    def test_two_day_gap_breaks_the_current_streak(self) -> None:
        days = {"2026-08-01", "2026-08-02", "2026-08-03"}
        self.assertEqual(current_day_streak(days, date(2026, 8, 9)), 0)
        # ...but the record of it stands, which is what badges read.
        self.assertEqual(longest_day_streak(days), 3)

    def test_no_events_is_no_streak(self) -> None:
        self.assertEqual(current_day_streak(active_days([]), date(2026, 8, 9)), 0)

    def test_active_days_reads_the_event_date(self) -> None:
        events = [{"occurred_at": "2026-08-09T07:15:00Z"}, {"occurred_at": "2026-08-09T20:00:00Z"}]
        self.assertEqual(active_days(events), {"2026-08-09"})


class UnlockRuleTests(unittest.TestCase):
    def test_nothing_is_unlocked_without_progress(self) -> None:
        self.assertEqual(unlocks.satisfied_ids([], 0), set())

    def test_milestone_coin_is_matched_by_its_colour(self) -> None:
        # `project_badges` labels milestones by coin colour, not by rule key.
        got = unlocks.satisfied_ids([badge("spark")], 0)
        self.assertIn("trophyShelf", got)
        self.assertNotIn("podium", got)

    def test_subject_coin_unlocks_its_own_prop(self) -> None:
        got = unlocks.satisfied_ids([badge("science")], 0)
        self.assertIn("rocketModel", got)
        self.assertNotIn("mathBoard", got)

    def test_free_catalog_props_are_never_gated(self) -> None:
        # Gating an id that already ships free would retroactively lock a prop a
        # learner has placed, and the room screen would then strip it.
        for free_id in ("desk", "telescope", "plant", "banner", "frames", "bookshelf"):
            self.assertNotIn(free_id, unlocks.PROP_IDS, free_id)

    def test_unearned_badge_grants_nothing(self) -> None:
        self.assertEqual(unlocks.satisfied_ids([badge("world", earned=False)], 0), set())

    def test_streak_tiers_are_cumulative(self) -> None:
        at_three = unlocks.satisfied_ids([], 3)
        at_seven = unlocks.satisfied_ids([], 7)
        self.assertEqual(at_three, {"streakScarf", "streakCalendar"})
        self.assertTrue(at_three < at_seven)
        self.assertIn("cometTrail", at_seven)

    def test_streak_below_the_tier_grants_nothing(self) -> None:
        self.assertEqual(unlocks.satisfied_ids([], 2), set())

    def test_mapping_sections_unlock_only_their_matching_cosmetics(self) -> None:
        at_four = unlocks.satisfied_ids([], 0, {4})
        at_six = unlocks.satisfied_ids([], 0, {4, 5, 6})
        self.assertEqual(at_four, {"crown"})
        self.assertTrue(at_four < at_six)
        self.assertEqual({"crown", "jetpack", "ironman"}, at_six)

    def test_every_rule_has_localizable_copy(self) -> None:
        for item_id, entry in unlocks.UNLOCKS.items():
            self.assertTrue(entry["requirementKey"].startswith("YuviStudio.unlock."), item_id)
            self.assertIn(entry["kind"], ("avatar", "prop"), item_id)

    def test_gated_props_are_exactly_the_prop_rules(self) -> None:
        self.assertTrue(unlocks.is_gated_prop("trophyShelf"))
        # An ordinary catalog prop stays free for everyone.
        self.assertFalse(unlocks.is_gated_prop("desk"))
        self.assertFalse(unlocks.is_gated_prop("laurel"))  # a cosmetic, not a prop

    def test_every_earned_cosmetic_is_gated(self) -> None:
        """All three promises — sparks, badges and mapping sections — or the
        padlock the learner sees is the only thing enforcing any of them."""
        for asset_id in ("laurel", "explorerGoggles", "streakScarf", "cometTrail"):
            self.assertTrue(unlocks.is_gated_cosmetic(asset_id), asset_id)
        for asset_id in ("crown", "jetpack", "ironman", "propeller"):
            self.assertTrue(unlocks.is_gated_cosmetic(asset_id), asset_id)

    def test_the_shop_cannot_drift_away_from_the_gate(self) -> None:
        """Read from the catalog, never copied — a new priced item is gated the
        moment it has a price, without anyone remembering a second list."""
        from app.services.rewards.catalog import CATALOG

        for asset_id in CATALOG:
            self.assertTrue(unlocks.is_gated_cosmetic(asset_id), asset_id)

    def test_free_cosmetics_stay_free(self) -> None:
        for asset_id in ("snapback", "jacket", "shades", "backpack", "guitar"):
            self.assertFalse(unlocks.is_gated_cosmetic(asset_id), asset_id)

    def test_mapping_section_rewards_have_their_own_server_rules(self) -> None:
        for asset_id, section in (("crown", 4), ("jetpack", 5), ("ironman", 6)):
            self.assertEqual(unlocks.UNLOCKS[asset_id]["rule"], {"type": "section", "number": section})
        self.assertNotIn("propeller", unlocks.UNLOCKS)

    def test_badge_reports_what_it_unlocks(self) -> None:
        self.assertEqual(unlocks.ids_for_badge("aim"), [{"id": "podium", "kind": "prop"}])
        self.assertEqual(unlocks.ids_for_badge("cosmos"), [{"id": "observatory", "kind": "prop"}])
        # Streak-gated items belong to no badge.
        self.assertEqual(unlocks.ids_for_badge("flame"), [{"id": "laurel", "kind": "avatar"}])
        self.assertEqual(unlocks.ids_for_badge("nonesuch"), [])

    def test_client_catalog_marks_what_is_held(self) -> None:
        rows = {r["id"]: r for r in unlocks.catalog_for_client(["laurel"], ["podium"])}
        self.assertTrue(rows["laurel"]["owned"])
        self.assertTrue(rows["podium"]["owned"])
        self.assertFalse(rows["observatory"]["owned"])
        self.assertEqual(rows["laurel"]["kind"], "avatar")
        self.assertEqual(rows["podium"]["kind"], "prop")

    def test_avatar_and_prop_holdings_do_not_leak_into_each_other(self) -> None:
        # Holding the prop must not mark a cosmetic owned, or the studio would
        # offer a locked item as if it were earned.
        rows = {r["id"]: r for r in unlocks.catalog_for_client([], ["trophyShelf"])}
        self.assertTrue(rows["trophyShelf"]["owned"])
        self.assertFalse(rows["laurel"]["owned"])


if __name__ == "__main__":
    unittest.main()
