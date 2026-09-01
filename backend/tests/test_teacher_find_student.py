"""`find_student` — the name→id bridge, and the PII contract it must keep.

The property under test: the teacher's typed name goes in, learner ids come
out, and a roster name NEVER appears in a result. Scope is structural — the
candidate pool IS the server-resolved allowed set — so a name that exists only
on another teacher's roster matches nothing, indistinguishable from a name
that does not exist.

`test_teacher_assistant_scope.py` needs no companion change: names come from
`teacher_roster.names_for`, not from `AGENT_VIEWS`, and never leave the handler.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents import teacher_tools
from app.agents.teacher_tools import registry
from app.agents.teacher_tools.data_tools import (
    _edit_distance_at_most_one, _match_tier, _normalize_name,
)
from app.agents.teacher_tools.registry import TeacherToolContext
from app.services.ai_usage import UsageContext

USAGE = UsageContext(
    actor_id="teacher-a", actor_type="teacher",
    endpoint="/api/teacher/assistant", feature="feature_6_teacher_view",
    operation="teacher_assistant.round_0", source="teacher_assistant",
)

NOA_A, NOA_B, TAL, JOHN = "kid-noa-a", "kid-noa-b", "kid-tal", "kid-john"
OUTSIDER = "kid-theirs"
MY_GROUPS = {"group-1": [NOA_A, TAL, JOHN], "group-2": [NOA_B]}
NAMES = {
    NOA_A: "נועה לוי",
    NOA_B: "נועה כהן",
    TAL: "טַל בן־דוד",          # stored with niqqud, on purpose
    JOHN: "ג'ון סמית",          # stored with a geresh, on purpose
    OUTSIDER: "נועה לוי",       # same name, someone else's roster
}


def context(**overrides) -> TeacherToolContext:
    base = dict(
        teacher_id="teacher-a", language="he",
        allowed_group_ids=frozenset(MY_GROUPS),
        allowed_learner_ids=frozenset({NOA_A, NOA_B, TAL, JOHN}),
        is_admin=False, usage_context=USAGE,
    )
    base.update(overrides)
    return TeacherToolContext(**base)


class NormalizationTests(unittest.TestCase):
    def test_niqqud_is_stripped(self):
        self.assertEqual(_normalize_name("טַל"), _normalize_name("טל"))

    def test_geresh_and_quotes_are_stripped(self):
        self.assertEqual(_normalize_name("ג'ון"), _normalize_name("גון"))
        self.assertEqual(_normalize_name('צ"רלי'), _normalize_name("צרלי"))

    def test_final_letters_fold(self):
        self.assertEqual(_normalize_name("כהן"), _normalize_name("כהנ"))

    def test_case_and_whitespace_fold(self):
        self.assertEqual(_normalize_name("  Dana   Levi "), "dana levi")

    def test_edit_distance_one(self):
        self.assertTrue(_edit_distance_at_most_one("נעה", "נועה"))    # missing letter
        self.assertTrue(_edit_distance_at_most_one("נומה", "נועה"))   # one wrong letter
        self.assertFalse(_edit_distance_at_most_one("נה", "נועה"))    # two edits away

    def test_tier_priority(self):
        self.assertEqual(_match_tier("נועה", "נועה לוי"), "exact")
        self.assertEqual(_match_tier("נו", "נועה לוי"), "prefix")
        self.assertEqual(_match_tier("ועה ל", "נועה לוי"), "contains")
        self.assertEqual(_match_tier("נעה", "נועה לוי"), "typo")
        self.assertIsNone(_match_tier("משה", "נועה לוי"))


class FindStudentTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        teacher_tools.install()
        self._patches = [
            patch("app.brain.repository._get_collection_named", return_value=None),
            patch("app.services.teacher_roster.names_for",
                  AsyncMock(side_effect=lambda ids: {i: NAMES.get(i) for i in ids})),
            patch("app.brain.org.learners_in_group",
                  AsyncMock(side_effect=lambda gid: MY_GROUPS.get(gid, []))),
            patch("app.brain.org.teacher_can_access_group", AsyncMock(
                side_effect=lambda teacher_id, gid: gid in MY_GROUPS)),
        ]
        for item in self._patches:
            item.start()

    def tearDown(self):
        for item in self._patches:
            item.stop()

    async def find(self, name, ctx=None, **extra):
        return await registry.dispatch(
            "find_student", {"name": name, **extra}, ctx or context())

    # ── matching ─────────────────────────────────────────────────────────────

    async def test_an_exact_name_resolves_to_its_id(self):
        result = await self.find("טל")
        self.assertEqual(result["data"]["count"], 1)
        self.assertEqual(result["data"]["matches"][0]["learner_id"], TAL)
        self.assertEqual(result["data"]["match_quality"], "exact")

    async def test_a_full_name_resolves_too(self):
        result = await self.find("נועה לוי")
        self.assertEqual([m["learner_id"] for m in result["data"]["matches"]], [NOA_A])

    async def test_a_prefix_finds_the_child(self):
        result = await self.find("סמ")
        self.assertEqual(result["data"]["matches"][0]["learner_id"], JOHN)
        self.assertEqual(result["data"]["match_quality"], "prefix")

    async def test_a_one_letter_typo_still_lands(self):
        result = await self.find("סמיט")
        self.assertEqual(result["data"]["matches"][0]["learner_id"], JOHN)
        self.assertEqual(result["data"]["match_quality"], "typo")

    async def test_niqqud_in_the_roster_does_not_hide_a_child(self):
        """The teacher types plain letters; the stored name carries niqqud."""
        result = await self.find("טל בן־דוד")
        self.assertEqual(result["data"]["matches"][0]["learner_id"], TAL)
        self.assertEqual(result["data"]["match_quality"], "exact")

    async def test_geresh_spelling_differences_do_not_matter(self):
        result = await self.find("גון")
        self.assertEqual(result["data"]["matches"][0]["learner_id"], JOHN)

    async def test_exact_beats_typo_when_both_exist(self):
        """Only the strongest tier's matches come back — a typo-distance
        sibling must not ride along with an exact hit."""
        result = await self.find("נועה")
        self.assertEqual(result["data"]["match_quality"], "exact")
        self.assertEqual({m["learner_id"] for m in result["data"]["matches"]},
                         {NOA_A, NOA_B})

    # ── ambiguity ────────────────────────────────────────────────────────────

    async def test_two_children_by_that_name_come_back_with_their_groups(self):
        result = await self.find("נועה")
        self.assertEqual(result["data"]["count"], 2)
        by_id = {m["learner_id"]: m for m in result["data"]["matches"]}
        self.assertEqual(by_id[NOA_A]["group_ids"], ["group-1"])
        self.assertEqual(by_id[NOA_B]["group_ids"], ["group-2"])

    async def test_a_single_match_carries_no_group_noise(self):
        result = await self.find("טל")
        self.assertNotIn("group_ids", result["data"]["matches"][0])

    async def test_a_group_id_narrows_the_pool(self):
        result = await self.find("נועה", group_id="group-2")
        self.assertEqual([m["learner_id"] for m in result["data"]["matches"]], [NOA_B])

    # ── honesty ──────────────────────────────────────────────────────────────

    async def test_no_such_name_is_a_reason_not_a_guess(self):
        result = await self.find("יוסי כהן")
        self.assertIsNone(result["data"])
        self.assertEqual(result["reason"], "no_student_by_that_name")

    async def test_an_empty_name_is_refused_not_matched(self):
        result = await self.find("   ")
        self.assertIsNone(result["data"])

    # ── scope ────────────────────────────────────────────────────────────────

    async def test_a_name_on_someone_elses_roster_matches_nothing(self):
        """OUTSIDER is literally named נועה לוי — but is not in the allowed
        set, so the answer is indistinguishable from 'no such child'."""
        result = await self.find(
            "נועה", context(allowed_learner_ids=frozenset({TAL, JOHN})))
        self.assertIsNone(result["data"])
        self.assertEqual(result["reason"], "no_student_by_that_name")

    async def test_an_out_of_scope_group_is_refused_by_the_gate(self):
        result = await self.find("נועה", group_id="group-theirs")
        self.assertEqual(result.get("error"), "not_authorized")

    # ── PII ──────────────────────────────────────────────────────────────────

    async def test_no_roster_name_reaches_the_model(self):
        for query in ("נועה", "טל", "יוסי כהן"):
            result = await self.find(query)
            serialized = repr(result)
            self.assertNotIn("display_name", serialized)
            for name in ("לוי", "כהן", "בן־דוד", "סמית"):
                self.assertNotIn(name, serialized.replace(query, ""),
                                 f"a roster name leaked for query {query!r}")

    # ── wiring ───────────────────────────────────────────────────────────────

    def test_the_tool_is_in_the_manifest(self):
        self.assertIn("find_student", [row["name"] for row in registry.manifest()])


if __name__ == "__main__":
    unittest.main()
