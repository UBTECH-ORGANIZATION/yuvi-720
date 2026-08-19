"""The teacher's guided write-up, and the goals that follow from it.

Both are new voices over an existing shape. What has to hold: the teacher's
helper never writes in the child's first person, the scripted fallback stops
instead of looping, and neither function invents a conversation it was not
told about.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import mentoring_assist as assist

NOTES = (
    "דיברנו על הקושי בזוויות. התלמידה סיפרה שהיא מוותרת מהר כשלא מצליחה, "
    "וסיכמנו שתבקש רמז במקום לנחש."
)


class TeacherGuideFallbackTest(unittest.TestCase):
    """No model: the scripted walk. This is the path a demo and an outage take."""

    def test_it_opens_with_what_was_discussed_not_how_anyone_felt(self):
        """The learner script asks about feelings; a teacher documenting a talk
        has no feeling of their own to file."""
        step = assist._fallback_teacher_guide("he", [])
        self.assertEqual(step["question"], "על מה דיברתם בשיחה?")
        self.assertEqual(step["phase"], "asking")

    def test_it_walks_all_four_and_then_stops(self):
        qa = []
        for expected in range(4):
            step = assist._fallback_teacher_guide("he", qa)
            self.assertEqual(step["phase"], "asking", f"step {expected} should still ask")
            qa.append({"q": step["question"], "a": "משהו"})
        done = assist._fallback_teacher_guide("he", qa)
        self.assertEqual(done["phase"], "ready")
        self.assertEqual(done["question"], "")
        self.assertEqual(done["options"], [])

    def test_asking_for_another_reopens_it_once(self):
        qa = [{"q": "q", "a": "a"} for _ in range(4)]
        step = assist._fallback_teacher_guide("he", qa, more=True)
        self.assertEqual(step["phase"], "asking")
        self.assertTrue(step["question"])

    def test_the_draft_is_only_what_the_teacher_answered(self):
        qa = [{"q": "על מה דיברתם?", "a": "על זוויות"}, {"q": "מה סיכמתם?", "a": "לבקש רמז"}]
        step = assist._fallback_teacher_guide("he", qa)
        self.assertIn("על זוויות", step["draft"])
        self.assertIn("לבקש רמז", step["draft"])

    def test_every_language_has_the_whole_script(self):
        for language in ("he", "ar", "en"):
            self.assertEqual(len(assist._TEACHER_GUIDE[language]), 4, language)
            self.assertIn(language, assist._TEACHER_MORE_Q)

    def test_the_script_never_speaks_as_the_student(self):
        """A first-person marker in the Hebrew script would put the child's
        voice into the teacher's record."""
        for item in assist._TEACHER_GUIDE["he"]:
            self.assertNotIn("הרגשתי", item["q"])
            for option in item["options"]:
                self.assertNotIn("הרגשתי", option)


class TeacherGuidePromptTest(unittest.IsolatedAsyncioTestCase):
    async def test_the_prompt_forbids_the_students_first_person(self):
        captured = {}

        async def _fake(messages, **_kwargs):
            captured["system"] = messages[0]["content"]
            return json.dumps({"draft": "דיברנו על זוויות", "question": "",
                               "options": [], "phase": "ready"})

        with patch.object(assist, "call_llm", AsyncMock(side_effect=_fake)):
            result = await assist.guide_teacher_documentation("teacher-1", language="he")
        self.assertTrue(result["ai"])
        self.assertIn("THIRD person", captured["system"])
        self.assertIn("NEVER write in the student's first person", captured["system"])

    async def test_the_student_name_is_never_sent(self):
        captured = {}

        async def _fake(messages, **_kwargs):
            captured["all"] = json.dumps(messages, ensure_ascii=False)
            return json.dumps({"draft": "x", "question": "", "options": [], "phase": "ready"})

        with patch.object(assist, "call_llm", AsyncMock(side_effect=_fake)):
            await assist.guide_teacher_documentation(
                "teacher-1", language="he", notes=NOTES, qa=[{"q": "q", "a": "a"}])
        self.assertNotIn("learner", captured["all"].lower().replace("teacher", ""))
        self.assertIn("התלמיד/ה", captured["all"])

    async def test_a_model_failure_falls_back_instead_of_breaking_the_composer(self):
        with patch.object(assist, "call_llm", AsyncMock(side_effect=RuntimeError("down"))):
            result = await assist.guide_teacher_documentation("teacher-1", language="he")
        self.assertFalse(result["ai"])
        self.assertTrue(result["question"])

    async def test_it_reports_as_the_teacher_not_the_child(self):
        captured = {}

        async def _fake(_messages, *, usage_context, **_kwargs):
            captured["ctx"] = usage_context
            return json.dumps({"draft": "x", "question": "", "options": [], "phase": "ready"})

        with patch.object(assist, "call_llm", AsyncMock(side_effect=_fake)):
            await assist.guide_teacher_documentation("teacher-1", language="he")
        self.assertEqual(captured["ctx"].actor_type, "teacher")
        self.assertEqual(captured["ctx"].actor_id, "teacher-1")


class GoalsFromConversationTest(unittest.IsolatedAsyncioTestCase):
    MODEL_REPLY = json.dumps({"goals": [{
        "title": "בקשי רמז כשנתקעת",
        "next_steps": "במקום לנחש, לחצי על רמז",
        "rationale": "היא מוותרת מהר כשלא מצליחה",
        "quote": "מוותרת מהר כשלא מצליחה",
        "action": {"kind": "use_hint", "target": 3},
    }]}, ensure_ascii=False)

    async def _suggest(self, reply=None, **kwargs):
        with patch.object(assist, "call_llm",
                          AsyncMock(return_value=reply or self.MODEL_REPLY)) as llm:
            drafts = await assist.suggest_goals_from_conversation(
                "kid-a", "teacher-1", notes=kwargs.pop("notes", NOTES), **kwargs)
        return drafts, llm

    async def test_a_goal_is_grounded_in_a_line_the_teacher_wrote(self):
        """The whole point: the teacher can check the suggestion against their
        own sentence without leaving the screen."""
        drafts, _llm = await self._suggest()
        self.assertEqual(len(drafts), 1)
        self.assertEqual(drafts[0]["because"]["signal"], "conversation")
        self.assertEqual(drafts[0]["because"]["raw"]["observation"], "מוותרת מהר כשלא מצליחה")

    async def test_the_action_is_normalized_against_the_closed_vocabulary(self):
        drafts, _llm = await self._suggest()
        self.assertEqual(drafts[0]["action"], {"kind": "use_hint", "target": 3})

    async def test_an_invented_action_degrades_to_untracked(self):
        reply = json.dumps({"goals": [{"title": "t", "action": {"kind": "levitate", "target": 3}}]})
        drafts, _llm = await self._suggest(reply=reply)
        self.assertIsNone(drafts[0]["action"])

    async def test_the_deadline_is_set_by_us_not_the_model(self):
        """A week is the window this product promises; a model-chosen date is
        not a window."""
        drafts, _llm = await self._suggest()
        self.assertTrue(drafts[0]["deadline"])

    async def test_no_notes_means_no_model_call_and_no_goals(self):
        drafts, llm = await self._suggest(notes="")
        self.assertEqual(drafts, [])
        llm.assert_not_awaited()

    async def test_a_model_failure_returns_nothing_rather_than_inventing(self):
        with patch.object(assist, "call_llm", AsyncMock(side_effect=RuntimeError("down"))):
            drafts = await assist.suggest_goals_from_conversation(
                "kid-a", "teacher-1", notes=NOTES)
        self.assertEqual(drafts, [])

    async def test_the_conversation_is_what_the_model_is_given(self):
        _drafts, llm = await self._suggest()
        sent = json.dumps(llm.await_args.args[0], ensure_ascii=False)
        self.assertIn("מוותרת מהר", sent)

    async def test_it_does_not_touch_the_shared_suggestion_cache(self):
        """`goal_suggestions`' cache id has no notes component, so caching these
        would return the wrong goals or poison the evidence-flavoured row."""
        with patch.object(assist, "call_llm", AsyncMock(return_value=self.MODEL_REPLY)), \
             patch.object(assist, "goal_suggestions", AsyncMock()) as cache:
            await assist.suggest_goals_from_conversation("kid-a", "teacher-1", notes=NOTES)
        cache.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()


def test_prep_behaviour_never_carries_a_distress_disclosure():
    """A wellbeing flag reaches the sheet as presence, never as words.

    `attention_all` mixes learning behaviour with `kind: "wellbeing"`, whose
    `evidence` is the child's own sentence from a distress disclosure. Handing
    that to the prep model put a paraphrase of it on a card the teacher reads
    with the child walking toward them.
    """
    from app.services.mentoring_assist import _BEHAVIOUR_KINDS

    assert "wellbeing" not in _BEHAVIOUR_KINDS
    # An allow-list, so a new sensitive kind is excluded by default rather than
    # included until someone remembers to block it.
    assert _BEHAVIOUR_KINDS >= {"wheel_spinning", "rapid_guessing", "overdue_goal"}
