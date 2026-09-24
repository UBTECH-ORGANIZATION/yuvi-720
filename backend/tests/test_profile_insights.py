"""Deterministic onboarding insight catalog and selection engine."""

from __future__ import annotations

import random
import unittest

from app.services import profile_insights as pi


def _values(**averages: float) -> dict:
    base = {number: 3.5 for number in range(1, 8)}
    base.update({int(key[1:]): value for key, value in averages.items()})
    return pi.measure_values([{"measure": k, "average": v} for k, v in base.items()])


class CatalogTests(unittest.TestCase):
    def test_every_group_has_exactly_one_common_for_any_value(self) -> None:
        samples = [1.0, 2.99, 3.0, 3.01, 4.49, 4.5, 5.0]
        for group in pi.GROUPS:
            commons = [i for i in pi.CATALOG if i.group == group and not i.special]
            for value in samples:
                values = {number: value for number in range(1, 8)}
                values[pi.CHALLENGE_MEASURE] = value
                self.assertEqual(sum(pi.matches(i, values) for i in commons), 1, (group, value))

    def test_all_texts_exist_for_every_language_and_gender(self) -> None:
        for insight in pi.CATALOG:
            for language in ("he", "ar", "en"):
                for gender in ("male", "female"):
                    for opening in range(len(pi.OPENINGS[language])):
                        claim = pi.render_claim(insight, opening, language, gender)
                        self.assertTrue(claim["title"].strip())
                        self.assertTrue(claim["description"].strip())

    def test_ids_are_unique_and_openings_are_balanced(self) -> None:
        self.assertEqual(len(pi.CATALOG_BY_ID), len(pi.CATALOG))
        self.assertEqual({len(o) for o in pi.OPENINGS.values()}, {len(pi.OPENINGS["he"])})


class SelectionTests(unittest.TestCase):
    def test_always_five_distinct_groups_and_openings(self) -> None:
        rng = random.Random(7)
        for index in range(2000):
            values = _values(**{f"m{n}": round(rng.uniform(1, 5), 2) for n in range(1, 8)})
            chosen = pi.select_insights(values, f"learner-{index}")
            self.assertEqual(len(chosen), pi.CARD_COUNT)
            self.assertEqual(len({i.group for i, _ in chosen}), pi.CARD_COUNT)
            self.assertEqual(len({o for _, o in chosen}), pi.CARD_COUNT)
            self.assertTrue(all(pi.matches(i, values) for i, _ in chosen))

    def test_selection_is_stable_per_learner(self) -> None:
        values = _values(m1=4.2, m4=2.1)
        first = pi.select_insights(values, "learner-x")
        self.assertEqual(first, pi.select_insights(values, "learner-x"))

    def test_matching_specials_come_before_commons(self) -> None:
        values = _values(m1=4.2, m4=2.1)
        ids = {i.id for i, _ in pi.select_insights(values, "learner-y")}
        self.assertIn("a3", ids)
        self.assertNotIn("a1", ids)

    def test_boundaries_do_not_overlap(self) -> None:
        a1, a2 = pi.CATALOG_BY_ID["a1"], pi.CATALOG_BY_ID["a2"]
        self.assertTrue(pi.matches(a2, _values(m1=2.99)))
        self.assertTrue(pi.matches(a1, _values(m1=3.0)))
        self.assertFalse(pi.matches(a2, _values(m1=3.0)))

    def test_challenge_group_uses_mean_of_measures_two_and_four(self) -> None:
        values = _values(m2=2.5, m4=3.5)
        self.assertEqual(values[pi.CHALLENGE_MEASURE], 3.0)
        self.assertTrue(pi.matches(pi.CATALOG_BY_ID["b1"], values))

    def test_gender_and_language_resolution(self) -> None:
        b1 = pi.CATALOG_BY_ID["b1"]
        self.assertEqual(pi.render_claim(b1, 0, "he", "female")["title"], "לא מוותרת")
        self.assertEqual(pi.render_claim(b1, 0, "he", "male")["title"], "לא מוותר")
        self.assertTrue(pi.render_claim(b1, 0, "en", "female")["description"].startswith("It seems that you"))

    def test_missing_measures_yield_no_cards(self) -> None:
        self.assertEqual(pi.select_insights(pi.measure_values(None), "learner-z"), [])


if __name__ == "__main__":
    unittest.main()
