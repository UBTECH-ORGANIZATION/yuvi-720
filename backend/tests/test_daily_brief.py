"""The daily brief: windowed, capped, grounded, and honest with no model.

Four properties, all of which a teacher would notice being wrong:

1. **The window is since the last brief.** If it drifts, the brief either repeats
   what the teacher already read or silently skips days they were away for.
2. **It regenerates at most once a day.** Without the gate this is an LLM call
   per page refresh, and a subtly different story every time.
3. **A line with no cited signal never ships.** Same `because` gate as the digest
   this replaces — unfalsifiable narration is the failure mode of any summary.
4. **The model does not choose the children.** Every action's `learner_ids`
   comes from mastery evidence, not from generated text. This is the one that
   would be a real incident, so it is asserted directly.
"""

from __future__ import annotations

import json
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import daily_brief

NOW = datetime(2026, 8, 9, 8, 0, tzinfo=timezone.utc)

FACTS_SNAPSHOT = {
    "trends": {"students_total": 12, "active_last_7d": 10,
               "needing_attention": 3, "not_started": 2,
               "objectives_mastered_total": 5},
    "attention": [
        {"learner_id": "kid-a", "display_name": "רותם", "kind": "inactive",
         "reason": "לא נכנס תשעה ימים"},
        {"learner_id": "kid-b", "display_name": "עידו", "kind": "wellbeing",
         "reason": "שיתף מצוקה"},
    ],
    # Rolled up per subject by the brief. Carries names and ids precisely so the
    # leak test has something real to catch.
    "students": [
        {"learner_id": "kid-a", "display_name": "רותם", "status": "attention",
         "progress": {"math": {"objectives_total": 10, "objectives_mastered": 4,
                               "objectives_in_progress": 2}}},
        {"learner_id": "kid-b", "display_name": "עידו", "status": "active",
         "progress": {"math": {"objectives_total": 10, "objectives_mastered": 1,
                               "objectives_in_progress": 3}}},
        # Enrolled, never seen — the people a `not_started` bullet is about.
        {"learner_id": "kid-z", "display_name": "יעל", "status": "not_started",
         "progress": {}},
    ],
}
LEARNINGS = {"learnings": [
    {"title": "מערכת צירים", "subject": "math", "attempts": 104, "correct": 51,
     "success_rate": 0.49, "learners_engaged": 2, "struggling_count": 1},
    {"title": "מספרים שליליים", "subject": "math", "attempts": 0,
     "success_rate": None, "learners_engaged": 0, "struggling_count": 0},
]}
CONVERSATIONS = [{"id": "c1", "goals": [
    {"id": "g1", "progress_stage": "summarized", "approved_by": None},
    {"id": "g2", "progress_stage": "active", "needs_help": True},
]}]
GAPS = [{
    "objective_id": "obj-1", "subject": "math", "label": "מערכת צירים",
    "struggling_count": 4, "mastered_count": 1, "with_evidence": 9,
    "kind": "gap", "learner_ids": ["kid-c", "kid-d", "kid-e", "kid-f"],
}]


class _Sources:
    """Every read the brief makes, as one context manager.

    A tuple unpacked at each call site meant that adding a source to the brief
    silently left the new read unstubbed — the suite still passed, against the
    real database, at network speed. One object means a new source is stubbed
    everywhere the moment it is added here.
    """

    def __init__(self, patchers):
        self._patchers = patchers
        self._stack = None

    def __enter__(self):
        from contextlib import ExitStack

        self._stack = ExitStack()
        for patcher in self._patchers:
            self._stack.enter_context(patcher)
        return self

    def __exit__(self, *exc):
        return self._stack.__exit__(*exc)


def _analytics(llm_response=None):
    """Stub every source the brief reads, plus the provider."""
    return _Sources([
        patch("app.services.insights.group_insights",
              AsyncMock(return_value=FACTS_SNAPSHOT)),
        patch("app.services.group_analytics.engagement",
              AsyncMock(return_value={"active_students": 10, "active_pct": 83,
                                      "avg_active_minutes": 12.0, "timing_available": True})),
        patch("app.services.group_analytics.learning_gaps", AsyncMock(return_value=GAPS)),
        patch("app.services.moments.moments_for_group", AsyncMock(return_value=[])),
        patch("app.services.learning_analytics.group_learnings",
              AsyncMock(return_value=LEARNINGS)),
        patch("app.services.mentoring.list_conversations",
              AsyncMock(return_value=CONVERSATIONS)),
    ]), patch("app.services.llm.call_llm", AsyncMock(return_value=llm_response))


class WindowTests(unittest.TestCase):
    def test_no_prior_brief_looks_back_a_week(self):
        self.assertEqual(daily_brief.window_days(None), daily_brief.DEFAULT_WINDOW_DAYS)

    def test_a_partial_day_still_counts_as_a_day(self):
        """A teacher back after eight hours must not get a zero-day window."""
        self.assertEqual(daily_brief.window_days(NOW - timedelta(hours=8), NOW), 1)

    def test_the_window_rounds_up_to_cover_the_whole_gap(self):
        self.assertEqual(daily_brief.window_days(NOW - timedelta(days=2, hours=12), NOW), 3)

    def test_a_long_absence_is_clamped_to_what_analytics_can_answer(self):
        """A month away gets an honest fortnight, not a number that pretends."""
        self.assertEqual(
            daily_brief.window_days(NOW - timedelta(days=90), NOW), daily_brief.MAX_WINDOW_DAYS
        )


def _cached(**overrides):
    """A cache document shaped the way this module writes them today."""
    return {"generated_at": (NOW - timedelta(hours=3)).isoformat(),
            "scene": "waiting", "worked_on": None, **overrides}


class FreshnessTests(unittest.TestCase):
    def test_a_brief_from_this_morning_is_still_fresh(self):
        self.assertTrue(daily_brief.is_fresh(_cached(), NOW))

    def test_a_brief_from_yesterday_is_stale(self):
        cached = _cached(generated_at=(NOW - timedelta(hours=25)).isoformat())
        self.assertFalse(daily_brief.is_fresh(cached, NOW))

    def test_a_brief_written_by_an_older_build_is_stale_however_young(self):
        """Age is not the only question.

        A document cached minutes ago by the previous version of this module
        has no scene and no people under its bullets — young, and wrong. For a
        whole day after a deploy every teacher would read the old feature. The
        document's own shape says which writer produced it, so no version field
        has to be remembered and bumped.
        """
        for missing in daily_brief._REQUIRED_KEYS:
            with self.subTest(missing=missing):
                cached = _cached()
                cached.pop(missing)
                self.assertFalse(daily_brief.is_fresh(cached, NOW))

    def test_a_complete_document_is_fresh_on_every_required_key(self):
        # Guards the reverse: a _REQUIRED_KEYS entry naming a key the writer
        # never emits would make every brief permanently stale.
        self.assertTrue(daily_brief.is_fresh(_cached(), NOW))

    def test_no_cache_is_never_fresh(self):
        self.assertFalse(daily_brief.is_fresh(None, NOW))
        self.assertFalse(daily_brief.is_fresh({}, NOW))


class GenerationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        daily_brief._tasks.clear()
        self._store = patch.object(daily_brief, "_store", AsyncMock())
        self._store.start()

    def tearDown(self):
        self._store.stop()
        daily_brief._tasks.clear()

    async def _brief(self, *, cached=None, llm=None, force=False):
        sources, provider = _analytics(llm)
        with sources, provider, \
             patch.object(daily_brief, "_load", AsyncMock(return_value=cached)), \
             patch.object(daily_brief, "_previous_login", AsyncMock(return_value=None)):
            return await daily_brief.get_brief("teacher-a", "group-1", language="he")

    async def test_a_fresh_cache_is_served_without_calling_the_model(self):
        cached = {"_id": "x", "generated_at": (daily_brief._now()).isoformat(),
                  "headline": {"text": "cached"}, "bullets": [], "stats": [],
                  "actions": [], "scene": "waiting", "worked_on": None}
        sources, llm = _analytics("{}")
        with sources, llm, \
             patch.object(daily_brief, "_load", AsyncMock(return_value=cached)):
            result = await daily_brief.get_brief("teacher-a", "group-1", language="he")

        self.assertTrue(result["cached"])
        self.assertEqual(result["headline"]["text"], "cached")
        llm.new.assert_not_awaited()
        # The cache document key never leaks into the response body.
        self.assertNotIn("_id", result)

    async def test_a_stale_cache_regenerates_and_the_window_starts_there(self):
        stamp = (daily_brief._now() - timedelta(days=2)).isoformat()
        result = await self._brief(
            cached={"generated_at": stamp, "bullets": []},
            llm=json.dumps({"headline": {"text": "כותרת", "because": {"signal": "active_in_window", "value": 10}},
                            "bullets": []}),
        )
        self.assertFalse(result["cached"])
        # The property under test: the window starts where the last brief ended,
        # so nothing is repeated and nothing is skipped. The window rounds UP —
        # over-covering by a few hours beats missing them — and the exact
        # arithmetic is pinned against a fixed clock in `WindowTests`.
        self.assertEqual(result["since"], stamp)
        self.assertGreaterEqual(result["window_days"], 2)

    async def test_a_bullet_citing_no_ref_is_dropped(self):
        """Unfalsifiable narration is exactly what this panel must not print."""
        result = await self._brief(llm=json.dumps({
            "headline": "הכיתה בתנופה יפה",
            "bullets": [
                {"text": "יש מומנטום טוב"},                      # no ref at all
                {"text": "3 דורשים תשומת לב", "why": "כך", "ref": "f3"},
            ],
        }))
        self.assertEqual(len(result["bullets"]), 1)
        self.assertEqual(result["bullets"][0]["text"], "3 דורשים תשומת לב")

    async def test_a_bullet_citing_an_invented_ref_is_dropped(self):
        """The failure the old contract could not catch.

        It asked the model to name the signal it used and then believed the
        answer — so an invented key passed the gate exactly as easily as a real
        one. An opaque id it can only have read from the table cannot be
        guessed into existence.
        """
        result = await self._brief(llm=json.dumps({
            "headline": "כותרת",
            "bullets": [{"text": "משהו", "why": "כי", "ref": "f999"}],
        }))
        self.assertEqual(result["bullets"], [])

    async def test_a_bullet_carries_the_models_own_why_sentence(self):
        """The fix for `active in window: 10` — prose, not a template lookup."""
        result = await self._brief(llm=json.dumps({
            "headline": "כותרת",
            "bullets": [{"text": "ארבעה לא התחילו",
                         "why": "מתוך שנים־עשר תלמידים בקבוצה, ארבעה לא פתחו אף פעילות.",
                         "ref": "f1"}],
        }))
        self.assertTrue(result["bullets"][0]["why"].startswith("מתוך"))

    async def test_an_invented_number_is_refused(self):
        """The model may choose what matters. It may never produce a quantity."""
        result = await self._brief(llm=json.dumps({
            "headline": "כבר 47 תלמידים בלי פעילות",          # 47 appears nowhere
            "summary": "השבוע 10 תלמידים היו פעילים.",         # 10 is real
            "bullets": [],
        }))
        self.assertIsNone(result["headline"])
        self.assertIn("10", result["summary"])

    async def test_the_model_is_never_asked_for_stats_actions_or_a_greeting(self):
        """Only what needs inference goes to the LLM.

        A greeting is an hour-of-day branch and a name lookup; a stat row is a
        fixed frame a teacher compares day to day; an action label is a
        template over ids code already chose. Sending any of them costs tokens
        and buys three more ways to be subtly wrong in three languages.
        """
        captured: list[str] = []

        async def capture(messages, **kwargs):
            captured.append(messages[0]["content"])
            return None

        sources, provider = _analytics()
        with sources, provider, patch("app.services.llm.call_llm", capture), \
             patch.object(daily_brief, "_load", AsyncMock(return_value=None)), \
             patch.object(daily_brief, "_previous_login", AsyncMock(return_value=None)):
            await daily_brief.get_brief("teacher-a", "group-1", language="he")

        # The contract it is handed back asks for exactly three prose fields.
        contract = captured[0].split("Return JSON:")[1]
        self.assertIn('"headline"', contract)
        self.assertIn('"summary"', contract)
        self.assertIn('"bullets"', contract)
        for forbidden in ('"stats"', '"actions"', '"greeting"', '"label"', '"value"'):
            self.assertNotIn(forbidden, contract)

    async def test_model_supplied_stats_are_ignored_entirely(self):
        """Values come from the aggregates, so the card and the roster agree."""
        result = await self._brief(llm=json.dumps({
            "headline": "כותרת",
            "bullets": [],
            "stats": [{"key": "active_in_window", "value": 999}],
        }))
        by_key = {stat["key"]: stat for stat in result["stats"]}
        self.assertEqual(by_key["active_in_window"]["value"], 10)

    async def test_no_model_still_produces_a_real_brief(self):
        result = await self._brief(llm=None)
        self.assertEqual(result["source"], "fallback")
        self.assertIsNotNone(result["headline"])
        self.assertTrue(result["bullets"])
        # Fallback lines are locale keys, never pre-rendered Hebrew from Python.
        self.assertTrue(all(line.get("text_key") for line in result["bullets"]))
        self.assertTrue(all(line["because"]["signal"] for line in result["bullets"]))

    async def test_the_model_never_chooses_which_children_an_action_is_about(self):
        """The incident this guards: a hallucinated id landing in an assignment."""
        result = await self._brief(llm=json.dumps({
            "headline": {"text": "כותרת", "because": {"signal": "needing_attention", "value": 3}},
            "bullets": [],
            # The model tries to hand back its own action list. It is ignored.
            "actions": [{"kind": "assign_subgroup", "learner_ids": ["kid-invented"]}],
        }))
        assigned = [a for a in result["actions"] if a["kind"] == "assign_subgroup"]
        self.assertTrue(assigned)
        self.assertEqual(assigned[0]["learner_ids"], GAPS[0]["learner_ids"])
        every_id = {i for action in result["actions"] for i in action["learner_ids"]}
        self.assertNotIn("kid-invented", every_id)

    async def test_actions_carry_the_evidence_they_were_built_from(self):
        result = await self._brief(llm=None)
        for action in result["actions"]:
            self.assertTrue(action["because"]["signal"])

    async def test_the_model_is_never_given_a_learner_id(self):
        """The prompt is built from counts; ids stay on this side of the wall."""
        captured: list[str] = []

        async def capture(messages, **kwargs):
            captured.append(messages[0]["content"])
            return None

        sources, provider = _analytics()
        with sources, provider, patch("app.services.llm.call_llm", capture), \
             patch.object(daily_brief, "_load", AsyncMock(return_value=None)), \
             patch.object(daily_brief, "_previous_login", AsyncMock(return_value=None)):
            await daily_brief.get_brief("teacher-a", "group-1", language="he")

        prompt = captured[0]
        for learner_id in GAPS[0]["learner_ids"] + ["kid-a", "kid-b"]:
            self.assertNotIn(learner_id, prompt)
        # Names travel with the ids. The attention rows and the per-subject
        # progress roll-up are both built from documents that carry one.
        for name in ("רותם", "עידו"):
            self.assertNotIn(name, prompt)

    async def test_the_prompt_carries_what_the_class_actually_worked_on(self):
        """The brief used to describe learners only, never the material.

        Without this the model can say "ten were active" and nothing about what
        they were active *on* — which is the half of the story a teacher can
        plan a lesson from.
        """
        captured: list[str] = []

        async def capture(messages, **kwargs):
            captured.append(messages[0]["content"])
            return None

        sources, provider = _analytics()
        with sources, provider, patch("app.services.llm.call_llm", capture), \
             patch.object(daily_brief, "_load", AsyncMock(return_value=None)), \
             patch.object(daily_brief, "_previous_login", AsyncMock(return_value=None)):
            await daily_brief.get_brief("teacher-a", "group-1", language="he")

        prompt = captured[0]
        self.assertIn("worked_on", prompt)
        self.assertIn("104", prompt)                    # attempts on the live unit
        # An untouched catalogue row is not "what they worked on".
        self.assertNotIn("מספרים שליליים", prompt)
        # A reason crosses over even though the person it belongs to does not.
        self.assertIn("שיתף מצוקה", prompt)
        # Rolled up, not per learner: 5 mastered of 20 possible across two rows.
        self.assertIn("subject_progress", prompt)
        self.assertIn("goals_awaiting_approval", prompt)

    async def test_a_bullet_may_cite_one_of_the_new_facts(self):
        """The new facts are only worth gathering if a bullet can stand on them."""
        sources, provider = _analytics()
        with sources, provider, \
             patch.object(daily_brief, "_load", AsyncMock(return_value=None)), \
             patch.object(daily_brief, "_previous_login", AsyncMock(return_value=None)):
            facts, _, _ = await daily_brief._gather_facts("group-1", "he", 7)

        refs = daily_brief._refs(facts)
        signals = {row["signal"] for row in refs.values()}
        for signal in ("worked_on", "subject_progress", "goals_awaiting_approval",
                       "goals_needing_help"):
            self.assertIn(signal, signals)

    async def test_an_empty_group_says_so_rather_than_inventing_a_brief(self):
        # Asserted on the mock, not raised from it: `_worked_on` swallows every
        # exception by design, so a side_effect here would prove nothing.
        material = AsyncMock(return_value={"learnings": []})
        with patch("app.services.insights.group_insights",
                   AsyncMock(return_value={"trends": {"students_total": 0}, "attention": []})), \
             patch("app.services.group_analytics.engagement", AsyncMock(return_value={})), \
             patch("app.services.group_analytics.learning_gaps", AsyncMock(return_value=[])), \
             patch("app.services.moments.moments_for_group", AsyncMock(return_value=[])), \
             patch("app.services.learning_analytics.group_learnings", material), \
             patch.object(daily_brief, "_load", AsyncMock(return_value=None)), \
             patch.object(daily_brief, "_previous_login", AsyncMock(return_value=None)):
            result = await daily_brief.get_brief("teacher-a", "group-1", language="he")

        self.assertEqual(result["source"], "empty")
        self.assertEqual(result["reason"], "group_has_no_students")
        self.assertEqual(result["bullets"], [])
        # An empty class must not pay for the two fan-outs it has nothing to
        # gain from — the brief is about to say "no students" either way.
        material.assert_not_awaited()

    async def test_two_tabs_share_one_generation(self):
        """A teacher's second tab must not double the bill."""
        import asyncio

        calls = 0

        async def counted(messages, **kwargs):
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.02)
            return None

        sources, provider = _analytics()
        with sources, provider, patch("app.services.llm.call_llm", counted), \
             patch.object(daily_brief, "_load", AsyncMock(return_value=None)), \
             patch.object(daily_brief, "_previous_login", AsyncMock(return_value=None)):
            await asyncio.gather(*(
                daily_brief.get_brief("teacher-a", "group-1", language="he")
                for _ in range(3)
            ))

        self.assertEqual(calls, 1)


if __name__ == "__main__":
    unittest.main()


class SceneTests(unittest.IsolatedAsyncioTestCase):
    """The hero's illustration: the model picks a mood, code draws it.

    Nothing here lets a model author markup. It chooses one word from a closed
    set and that word selects a hand-drawn scene — so a bad choice is a scene
    that does not quite match the week, never broken geometry or an off-palette
    robot on the most-looked-at card in the portal.
    """

    def setUp(self):
        daily_brief._tasks.clear()
        self._store = patch.object(daily_brief, "_store", AsyncMock())
        self._store.start()

    def tearDown(self):
        self._store.stop()
        daily_brief._tasks.clear()

    async def _brief(self, llm):
        sources, provider = _analytics(llm)
        with sources, provider, \
             patch.object(daily_brief, "_load", AsyncMock(return_value=None)), \
             patch.object(daily_brief, "_previous_login", AsyncMock(return_value=None)):
            return await daily_brief.get_brief("teacher-a", "group-1", language="he")

    def _reply(self, **overrides):
        payload = {"headline": "שני תלמידים חזרו.", "summary": "שבוע סביר.",
                   "bullets": [], "scene": "celebrating"}
        payload.update(overrides)
        return json.dumps(payload, ensure_ascii=False)

    async def test_a_scene_from_the_closed_set_survives(self):
        result = await self._brief(self._reply(scene="pointing"))
        self.assertEqual(result["scene"], "pointing")

    async def test_an_invented_scene_falls_back_rather_than_reaching_the_component(self):
        """`YuviScene` has art for five moods. A sixth would render nothing."""
        result = await self._brief(self._reply(scene="hopeful"))
        self.assertIn(result["scene"], daily_brief.SCENES)
        self.assertNotEqual(result["scene"], "hopeful")

    async def test_a_missing_scene_still_yields_one(self):
        result = await self._brief(self._reply(scene=None))
        self.assertIn(result["scene"], daily_brief.SCENES)

    async def test_a_brief_with_no_model_still_has_a_scene(self):
        """`source: 'fallback'` gets a hero that looks like it is about this
        class, not a hole where the illustration goes."""
        result = await self._brief(None)
        self.assertEqual(result["source"], "fallback")
        self.assertIn(result["scene"], daily_brief.SCENES)

    async def test_the_material_the_class_worked_on_reaches_the_payload(self):
        result = await self._brief(self._reply())
        self.assertEqual(result["worked_on"]["title"], "מערכת צירים")
        # A 0-1 fraction, as `learning_analytics._rate` produces and every
        # screen renders through `ratePercent`.
        self.assertEqual(result["worked_on"]["success_rate"], 0.49)


class BulletPeopleTests(unittest.IsolatedAsyncioTestCase):
    """Who each claim is about — attached in code, after the fact.

    The model still never receives a learner id. It writes "four students have
    not started"; this puts the four faces under the sentence, from the same
    evidence the actions are built from. `_people_for` is a pure function of
    (fact, gaps, snapshot), so it is exercised directly rather than through a
    generation whose opaque ref ids are positional.
    """

    def _people(self, **fact):
        return daily_brief._people_for(fact, GAPS, FACTS_SNAPSHOT)

    def test_a_gap_claim_carries_the_children_in_that_gap(self):
        self.assertEqual(
            self._people(signal="learning_gap", objective_id="obj-1"),
            GAPS[0]["learner_ids"])

    def test_a_gap_claim_is_matched_on_the_objective_not_the_label(self):
        """Two gaps can share a label across subjects; an id cannot collide."""
        self.assertEqual(
            self._people(signal="learning_gap", label="מערכת צירים"), [])
        self.assertEqual(
            self._people(signal="learning_gap", objective_id="obj-elsewhere"), [])

    def test_a_not_started_claim_carries_the_children_who_have_not(self):
        self.assertEqual(self._people(signal="not_started"), ["kid-z"])

    def test_an_attention_claim_carries_the_flagged_children(self):
        self.assertEqual(self._people(signal="needing_attention"), ["kid-a", "kid-b"])
        self.assertEqual(self._people(signal="attention_wellbeing"), ["kid-a", "kid-b"])

    def test_a_claim_about_material_carries_nobody(self):
        """`worked_on` and `subject_progress` are properties of the content.
        Faces under them would be faces under a sentence they are not in."""
        for signal in ("worked_on", "subject_progress", "avg_active_minutes",
                       "objectives_mastered_total", "goals_awaiting_approval"):
            with self.subTest(signal=signal):
                self.assertEqual(self._people(signal=signal), [])

    def test_the_row_is_not_capped(self):
        """The client shows four faces and "+N", computed from this list.

        A server-side cap of eight therefore rendered "+4" under a sentence
        that said twelve — the teacher reading a smaller class than they have.
        Where to stop DRAWING is the client's call; it needs the true set to
        make it, and `_build_actions` beside this sends its list uncapped too.
        """
        many = [{"learner_id": f"kid-{i}", "status": "not_started"} for i in range(40)]
        people = daily_brief._people_for(
            {"signal": "not_started"}, [], {"students": many})
        self.assertEqual(len(people), 40)


class BulletWiringTests(unittest.IsolatedAsyncioTestCase):
    """The ids reach the payload, and the prompt still never sees one."""

    def setUp(self):
        daily_brief._tasks.clear()
        self._store = patch.object(daily_brief, "_store", AsyncMock())
        self._store.start()

    def tearDown(self):
        self._store.stop()
        daily_brief._tasks.clear()

    async def test_every_bullet_carries_a_people_list_even_when_empty(self):
        """The client reads `learner_ids` unconditionally; a missing key is a
        crash, and `None` is not the same as "about nobody"."""
        sources, provider = _analytics(None)
        with sources, provider, \
             patch.object(daily_brief, "_load", AsyncMock(return_value=None)), \
             patch.object(daily_brief, "_previous_login", AsyncMock(return_value=None)):
            result = await daily_brief.get_brief("teacher-a", "group-1", language="he")

        self.assertTrue(result["bullets"], "fallback produced no bullets to check")
        for bullet in result["bullets"]:
            self.assertIsInstance(bullet["learner_ids"], list)

    async def test_the_fallback_not_started_bullet_names_its_people(self):
        """The fallback path builds bullets from aggregates, so it is the one
        most likely to be left without the people wiring."""
        sources, provider = _analytics(None)
        with sources, provider, \
             patch.object(daily_brief, "_load", AsyncMock(return_value=None)), \
             patch.object(daily_brief, "_previous_login", AsyncMock(return_value=None)):
            result = await daily_brief.get_brief("teacher-a", "group-1", language="he")

        by_signal = {b["because"]["signal"]: b for b in result["bullets"]}
        self.assertEqual(by_signal["not_started"]["learner_ids"], ["kid-z"])
        self.assertEqual(by_signal["learning_gap"]["learner_ids"],
                         GAPS[0]["learner_ids"])

    async def test_the_model_is_still_never_given_a_learner_id(self):
        seen = {}

        async def capture(messages, **kwargs):
            seen["prompt"] = messages[0]["content"]
            return json.dumps({"headline": "", "summary": "x", "bullets": [],
                               "scene": "waiting"})

        sources, _ = _analytics(None)
        with sources, patch("app.services.llm.call_llm", AsyncMock(side_effect=capture)), \
             patch.object(daily_brief, "_load", AsyncMock(return_value=None)), \
             patch.object(daily_brief, "_previous_login", AsyncMock(return_value=None)):
            await daily_brief.get_brief("teacher-a", "group-1", language="he")

        for learner_id in ("kid-a", "kid-b", "kid-z", "kid-c", "kid-d"):
            self.assertNotIn(learner_id, seen["prompt"])
