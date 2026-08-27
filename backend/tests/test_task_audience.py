"""The children a task is built for, as context the generator can act on.

Two things are pinned here, and the first one is not negotiable.

**No child reaches the model.** The brief is built from learner ids and must
never carry a name or an id into the prompt. A generated task is read by every
child it launches to, so a leak here is not an internal one.

**It says what they SHARE.** The point is a task aimed at the actual mistake,
so the brief is ranked by how many of the selected children hit the same wall
and hard-capped. A list of everything anyone struggled with is not a focus, and
a prompt naming nine things produces a task that addresses none of them.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import asyncio

from app.services.tasks import audience


def run(coro):
    # `asyncio.run`, not `get_event_loop().run_until_complete` — the latter
    # passes alone and fails in the full suite, because by then another module
    # has closed the loop it reaches for. Same helper the other async suites
    # use, for the same reason.
    return asyncio.run(coro)


def _brain(learner_id, score, tags, objective="OBJ.1"):
    from app.brain.mastery import mastery_key
    return {
        "learner_id": learner_id,
        "mastery": {
            mastery_key(objective): {
                "attempts": 5,
                "score_ewma": score,
                "misconceptions": [
                    {"tag": tag, "resolved": False} for tag in tags
                ],
            }
        },
    }


class TheBriefNamesNobody(unittest.TestCase):

    def test_no_learner_id_or_name_survives_into_the_prompt(self):
        """The whole reason this module builds a summary instead of a list."""
        brains = {
            "learner-noa": _brain("learner-noa", 0.3, ["unit-confusion"]),
            "learner-ori": _brain("learner-ori", 0.4, ["unit-confusion"]),
        }
        with patch("app.brain.repository.get_brain",
                   new=AsyncMock(side_effect=lambda lid: brains[lid])):
            brief = run(audience.audience_brief(
                ["learner-noa", "learner-ori"], objective_id="OBJ.1"))
        text = audience.render(brief, "מסה ונפח")

        self.assertIn("unit-confusion", text)
        for learner_id in brains:
            self.assertNotIn(learner_id, text)
        # And the rendered block is what actually reaches the prompt, so the
        # assertion is on the string, not on the dict behind it.
        self.assertNotIn("noa", text.lower())
        self.assertNotIn("ori", text.lower())

    def test_the_count_is_carried_but_not_the_roster(self):
        brains = {f"l{i}": _brain(f"l{i}", 0.3, ["place-value"]) for i in range(4)}
        with patch("app.brain.repository.get_brain",
                   new=AsyncMock(side_effect=lambda lid: brains[lid])):
            brief = run(audience.audience_brief(list(brains), objective_id="OBJ.1"))
        self.assertEqual(brief["learner_count"], 4)
        self.assertIn("4 learner(s)", audience.render(brief))


class TheBriefIsTheCommonDenominator(unittest.TestCase):

    def test_a_misconception_only_one_child_has_is_dropped(self):
        """One child's afternoon is not the group's difficulty.

        This is the rule that keeps the brief pointed at something worth
        building a task around, rather than at the union of everyone's bad day.
        """
        brains = {
            "a": _brain("a", 0.3, ["unit-confusion", "a-one-off"]),
            "b": _brain("b", 0.3, ["unit-confusion"]),
            "c": _brain("c", 0.4, ["unit-confusion"]),
        }
        with patch("app.brain.repository.get_brain",
                   new=AsyncMock(side_effect=lambda lid: brains[lid])):
            brief = run(audience.audience_brief(list(brains), objective_id="OBJ.1"))
        tags = [row["tag"] for row in brief["misconceptions"]]
        self.assertEqual(tags, ["unit-confusion"])
        self.assertNotIn("a-one-off", tags)

    def test_ranked_by_how_many_share_it_and_capped(self):
        """Ordering is the whole value: the top of the list is what to teach."""
        def brain_for(lid):
            # Everyone has 'shared'; three have 'common'; two have 'rare'.
            tags = ["shared"]
            if lid in ("a", "b", "c"):
                tags.append("common")
            if lid in ("a", "b"):
                tags.append("rare")
            if lid == "a":
                tags.extend(["x", "y"])
            return _brain(lid, 0.3, tags)

        ids = list("abcde")
        with patch("app.brain.repository.get_brain",
                   new=AsyncMock(side_effect=lambda lid: brain_for(lid))):
            brief = run(audience.audience_brief(ids, objective_id="OBJ.1"))
        tags = [row["tag"] for row in brief["misconceptions"]]
        self.assertEqual(tags, ["shared", "common", "rare"])
        self.assertLessEqual(len(tags), audience.MAX_MISCONCEPTIONS)

    def test_a_single_child_keeps_their_own_difficulties(self):
        """The shared-by-two floor cannot apply to an audience of one.

        A task built for one child from their profile is a real case (the
        student page), and requiring two children to agree would empty the
        brief exactly where it is most specific.
        """
        brains = {"solo": _brain("solo", 0.25, ["sign-error"])}
        with patch("app.brain.repository.get_brain",
                   new=AsyncMock(side_effect=lambda lid: brains[lid])):
            brief = run(audience.audience_brief(["solo"], objective_id="OBJ.1"))
        self.assertEqual([row["tag"] for row in brief["misconceptions"]], ["sign-error"])

    def test_mastery_is_a_range_not_an_average(self):
        """0.2 and 0.8 average to the same 0.5 as 0.5 and 0.5, and only one of
        those is a group that needs two different questions."""
        brains = {"a": _brain("a", 0.2, []), "b": _brain("b", 0.8, [])}
        with patch("app.brain.repository.get_brain",
                   new=AsyncMock(side_effect=lambda lid: brains[lid])):
            brief = run(audience.audience_brief(["a", "b"], objective_id="OBJ.1"))
        self.assertEqual(brief["mastery"], "0.2–0.8")


class TheBriefIsNeverABlocker(unittest.TestCase):

    def test_no_learners_renders_nothing(self):
        brief = run(audience.audience_brief([]))
        self.assertEqual(brief["learner_count"], 0)
        self.assertEqual(audience.render(brief), "")

    def test_learners_the_system_knows_nothing_about_render_nothing(self):
        """A head-count alone is true and not worth a prompt section — an empty
        heading reads to the model as an instruction it has failed to meet."""
        with patch("app.brain.repository.get_brain",
                   new=AsyncMock(return_value={"mastery": {}})):
            brief = run(audience.audience_brief(["a", "b"], objective_id="OBJ.1"))
        self.assertEqual(audience.render(brief), "")

    def test_an_unreadable_brain_does_not_sink_the_brief(self):
        async def flaky(learner_id):
            if learner_id == "broken":
                raise RuntimeError("mongo said no")
            return _brain(learner_id, 0.3, ["unit-confusion"])

        with patch("app.brain.repository.get_brain", new=AsyncMock(side_effect=flaky)):
            brief = run(audience.audience_brief(
                ["a", "broken", "b"], objective_id="OBJ.1"))
        # Still counted — they ARE in the audience; only their evidence is lost.
        self.assertEqual(brief["learner_count"], 3)
        self.assertEqual([row["tag"] for row in brief["misconceptions"]],
                         ["unit-confusion"])


class TheSpecKeepsTheAudience(unittest.TestCase):

    def test_learner_ids_are_stored_deduped_and_capped(self):
        from app.services.tasks import spec as spec_module
        built = spec_module.normalize_spec({
            "title": "משימה",
            "audience": {"learner_ids": ["a", "b", "a"] + [f"x{i}" for i in range(80)]},
        })
        ids = built["audience"]["learner_ids"]
        self.assertEqual(ids[:2], ["a", "b"])
        self.assertEqual(len(ids), len(set(ids)))
        self.assertLessEqual(len(ids), 60)

    def test_an_empty_audience_is_not_stored_at_all(self):
        """So "built for nobody in particular" stays distinguishable from
        "built for these children", which is what decides whether the builder
        shows its brief step."""
        from app.services.tasks import spec as spec_module
        built = spec_module.normalize_spec({"title": "משימה", "audience": {"learner_ids": []}})
        self.assertNotIn("audience", built)


if __name__ == "__main__":
    unittest.main()
