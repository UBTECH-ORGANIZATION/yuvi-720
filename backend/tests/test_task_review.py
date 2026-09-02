"""The human in the loop: grounding a task in real material, and changing it
before it goes out.

Three things are pinned here, each of which the reference implementation this
mechanic was borrowed from gets wrong:

* **A teacher's edit goes through the same vocabulary as the model's output.**
  The reference stores whatever the client PUTs. That is how a hand-edited
  answer key lands in a shape the grader does not read — scoring every child
  wrong, and looking entirely correct in the JSON.
* **An instruction to one regeneration is not a change to the task.** "Make
  question 3 easier" must not be written back into the stored spec, or every
  later pass inherits every earlier correction.
* **Editing stops at launch.** The reference has an `allow_edit_while_active`
  flag; we have frozen per-learner activations and a refusal.

Plus the grounding itself: what the catalogue says about a lesson reaches the
generator, and where the catalogue is silent the prompt is exactly what it was
before anyone picked a lesson.
"""

from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import kata_catalog
from app.services.tasks import assist, generate, revise, spec, store


def run(coro):
    return asyncio.run(coro)


TEACHER = "teacher-1"
GROUP = "group-1"
KID = "kid-a"

GOOD_PRACTICE = {"questions": [
    {"id": "q1", "type": "mcq",
     "prompt": [{"type": "text", "text": "כמה זה שתיים ועוד שתיים"}],
     "options": [[{"type": "math", "value": "3"}], [{"type": "math", "value": "4"}]],
     "answer": {"index": 1}, "explanation": [], "hint": [],
     "difficulty": "easy", "weight": 1.0},
]}


class _Isolated:
    """The JSON fallback store against a throwaway file — the same harness
    `test_task_store` uses, and for the same reason: a test that reaches the
    real database writes to it."""

    def __enter__(self):
        self._dir = tempfile.TemporaryDirectory()
        self._patches = [
            patch.object(store, "_FALLBACK_FILE", Path(self._dir.name) / "tasks.json"),
            patch.object(store, "_get_collection_named", lambda name: None),
            patch("app.brain.repository._get_collection_named", lambda name: None),
        ]
        for entry in self._patches:
            entry.start()
        return self

    def __exit__(self, *exc):
        for entry in reversed(self._patches):
            entry.stop()
        self._dir.cleanup()
        return False


class _Catalogue:
    """One lesson, as Kata would return it."""

    def __init__(self, screens=3, information="מזהים נקודה לפי שיעוריה"):
        self.screens = screens
        self.information = information

    def __enter__(self):
        profiles = [{"id": f"item-{index}", "title": f"מסך {index}"}
                    for index in range(self.screens)]
        self._patches = [
            patch.object(kata_catalog, "component_title",
                         lambda component_id, locale="he": "תרגול בסיסי + סטנדרטי ב"),
            patch.object(kata_catalog, "objective_title",
                         lambda objective_id, locale="he": "מערכת צירים - מספרים חיוביים"),
            patch.object(kata_catalog, "item_profiles", lambda component_id: profiles),
            patch.object(kata_catalog, "information_for_item",
                         lambda component_id, item_id: self.information),
        ]
        for entry in self._patches:
            entry.start()
        return self

    def __exit__(self, *exc):
        for entry in reversed(self._patches):
            entry.stop()
        return False


SOURCED = {"title": "מערכת צירים", "language": "he", "components": ["practice"],
           "practice": {"question_count": 5},
           "source": {"component_id": "CET.MATH.G7.WRITE-00001",
                      "objective_id": "obj-1"}}


# ── the spec carries ids, and only ids ───────────────────────────────────────

class TheSourceIsIdsOnly(unittest.TestCase):
    def test_both_ids_survive_normalization(self):
        normalized = spec.normalize_spec({
            "title": "משימה", "components": ["practice"],
            "source": {"component_id": "abc", "objective_id": "def"},
        })
        self.assertEqual(normalized["source"],
                         {"component_id": "abc", "objective_id": "def"})

    def test_an_objective_without_a_lesson_is_kept(self):
        """A teacher may ground on the objective alone."""
        normalized = spec.normalize_spec({
            "title": "משימה", "components": ["practice"],
            "source": {"objective_id": "def"},
        })
        self.assertEqual(normalized["source"],
                         {"component_id": None, "objective_id": "def"})

    def test_an_empty_source_is_dropped_rather_than_stored_hollow(self):
        normalized = spec.normalize_spec({
            "title": "משימה", "components": ["practice"],
            "source": {"component_id": "", "objective_id": "   "},
        })
        self.assertNotIn("source", normalized)

    def test_a_source_that_is_not_an_object_is_ignored(self):
        for junk in ("CET.MATH", ["a"], 7, None):
            normalized = spec.normalize_spec({
                "title": "משימה", "components": ["practice"], "source": junk,
            })
            self.assertNotIn("source", normalized, junk)

    def test_the_lesson_TEXT_is_never_stored(self):
        """The whole point of ids: a copied-in description goes stale the
        moment the unit is re-imported, and nothing would ever notice."""
        normalized = spec.normalize_spec({
            "title": "משימה", "components": ["practice"],
            "source": {"component_id": "abc", "objective_id": "def",
                       "title": "כתיבת שיעורי נקודה", "information": "..."},
        })
        self.assertEqual(set(normalized["source"]), {"component_id", "objective_id"})


# ── grounding ────────────────────────────────────────────────────────────────

class TheGeneratorIsToldWhatTheLessonTeaches(unittest.TestCase):
    def test_no_source_means_no_grounding_block(self):
        self.assertEqual(generate.source_grounding({"title": "משימה"}), "")

    def test_a_silent_catalogue_degrades_to_the_old_prompt(self):
        """Not a placeholder, not "unknown lesson" — nothing at all."""
        with patch.object(kata_catalog, "component_title", lambda *a, **k: None), \
             patch.object(kata_catalog, "objective_title", lambda *a, **k: None), \
             patch.object(kata_catalog, "item_profiles", lambda component_id: []):
            self.assertEqual(generate.source_grounding(SOURCED), "")

    def test_the_objective_the_lesson_and_the_screens_all_reach_the_prompt(self):
        with _Catalogue():
            block = generate.source_grounding(SOURCED)
        self.assertIn("מערכת צירים - מספרים חיוביים", block)
        self.assertIn("תרגול בסיסי + סטנדרטי ב", block)
        self.assertIn("מזהים נקודה לפי שיעוריה", block)
        # The instruction that makes the material binding rather than decorative.
        self.assertIn("Write for THIS lesson", block)

    def test_a_long_lesson_is_capped(self):
        with _Catalogue(screens=40):
            block = generate.source_grounding(SOURCED)
        self.assertEqual(block.count("מזהים נקודה"), generate.MAX_SOURCE_SCREENS)

    def test_a_screen_with_no_information_still_contributes_its_title(self):
        with _Catalogue(screens=2, information=""):
            block = generate.source_grounding(SOURCED)
        self.assertIn("מסך 0", block)
        self.assertIn("מסך 1", block)

    def test_the_block_is_actually_in_the_instruction_the_model_receives(self):
        """The unit above proves the text is built. This proves it is sent."""
        with _Catalogue():
            grounded = generate._instruction("practice", SOURCED, [])
            plain = generate._instruction(
                "practice", {k: v for k, v in SOURCED.items() if k != "source"}, [])
        self.assertIn("מזהים נקודה לפי שיעוריה", grounded)
        self.assertNotIn("מזהים נקודה לפי שיעוריה", plain)


# ── the assist button's disabled reason ──────────────────────────────────────

class WhatTheFormStillNeeds(unittest.TestCase):
    def test_an_empty_form_names_all_three(self):
        self.assertEqual(assist.missing_fields({}),
                         ["title", "components", "subject_matter"])

    def test_a_topic_satisfies_the_subject_matter(self):
        self.assertEqual(
            assist.missing_fields({"title": "א", "components": ["practice"],
                                   "topic": "שברים"}), [])

    def test_a_picked_lesson_satisfies_it_too(self):
        """The two are alternatives: either is something to write *about*."""
        self.assertEqual(
            assist.missing_fields({"title": "א", "components": ["practice"],
                                   "source": {"component_id": "abc"}}), [])

    def test_whitespace_is_not_a_title(self):
        self.assertIn("title", assist.missing_fields(
            {"title": "   ", "components": ["practice"], "topic": "שברים"}))

    def test_a_list_of_empty_strings_is_not_a_choice_of_parts(self):
        self.assertIn("components", assist.missing_fields(
            {"title": "א", "components": ["", "  "], "topic": "שברים"}))

    def test_a_source_that_is_not_an_object_does_not_count(self):
        self.assertIn("subject_matter", assist.missing_fields(
            {"title": "א", "components": ["practice"], "source": "abc"}))

    def test_no_model_call_is_made_while_anything_is_missing(self):
        with patch("app.services.llm.call_llm") as call:
            result = run(assist.suggest_notes({"title": "א"}))
        call.assert_not_called()
        self.assertIsNone(result["notes"])
        self.assertEqual(result["missing"], ["components", "subject_matter"])


# ── revising ─────────────────────────────────────────────────────────────────

async def _ready_task(components=("practice",), content=None):
    task = await store.create_task(
        teacher_id=TEACHER, group_id=GROUP, target={"kind": "learner", "id": KID},
        spec={"title": "שברים", "language": "he", "components": list(components),
              "notes": "להתמקד במכנה משותף"},
    )
    await store.put_content(task["_id"], "practice", content or GOOD_PRACTICE)
    await store.update_task(task["_id"], status="ready")
    return task["_id"]


class ATeacherEditGoesThroughTheVocabulary(unittest.TestCase):
    def test_a_valid_edit_is_stored_normalized(self):
        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                edited = {"questions": [{**GOOD_PRACTICE["questions"][0],
                                         "prompt": "כמה זה שלוש ועוד אחת"}]}
                saved = await revise.save_edit(task_id, "practice", edited)
                stored = await store.get_content(task_id, "practice")
                return saved, stored

            saved, stored = run(scenario())
        # The string became segments — the Hebrew+math contract holds for a
        # teacher's text exactly as it does for the model's.
        self.assertIsInstance(saved["questions"][0]["prompt"], list)
        self.assertEqual(saved["questions"][0]["prompt"][0]["text"], "כמה זה שלוש ועוד אחת")
        self.assertEqual(stored["source"], "teacher")

    def test_an_edit_that_breaks_the_answer_key_is_refused_not_stored(self):
        """The exact reference bug: an mcq whose key points at no option."""
        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                broken = {"questions": [{**GOOD_PRACTICE["questions"][0],
                                         "answer": {"index": 99}}]}
                with self.assertRaises(revise.ReviseError):
                    await revise.save_edit(task_id, "practice", broken)
                return await store.get_content(task_id, "practice")

            stored = run(scenario())
        # Still the original: a refused edit leaves the old content standing.
        self.assertEqual(stored["content"]["questions"][0]["answer"]["index"], 1)

    def test_an_edit_that_empties_the_component_is_refused(self):
        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                with self.assertRaises(revise.ReviseError):
                    await revise.save_edit(task_id, "practice", {"questions": []})

            run(scenario())

    def test_content_that_is_not_an_object_is_refused(self):
        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                with self.assertRaises(revise.ReviseError):
                    await revise.save_edit(task_id, "practice", ["q1"])

            run(scenario())

    def test_an_unknown_component_is_refused_before_anything_is_read(self):
        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                with self.assertRaises(revise.ReviseError):
                    await revise.save_edit(task_id, "homework", GOOD_PRACTICE)

            run(scenario())


class EditingStopsAtLaunch(unittest.TestCase):
    def test_a_live_task_refuses_a_teacher_edit(self):
        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                await store.activate(task_id, [KID])
                await store.update_task(task_id, status="live")
                with self.assertRaises(revise.ReviseError) as caught:
                    await revise.save_edit(task_id, "practice", GOOD_PRACTICE)
                return str(caught.exception)

            self.assertEqual(run(scenario()), "already_sent")

    def test_a_live_task_refuses_a_regeneration_before_any_model_call(self):
        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                await store.update_task(task_id, status="live")
                with patch.object(generate, "generate_component") as called:
                    with self.assertRaises(revise.ReviseError):
                        await revise.regenerate(task_id, "practice")
                called.assert_not_called()

            run(scenario())

    def test_a_missing_task_is_not_found_rather_than_a_crash(self):
        with _Isolated():
            async def scenario():
                with self.assertRaises(revise.ReviseError) as caught:
                    await revise.save_edit("no-such-task", "practice", GOOD_PRACTICE)
                return str(caught.exception)

            self.assertEqual(run(scenario()), "not_found")


class AnInstructionIsNotTheSpec(unittest.TestCase):
    def test_it_is_appended_to_the_notes_for_one_pass(self):
        pass_spec = revise._revision_spec(
            {"notes": "להתמקד במכנה משותף"}, "שאלה 3 קשה מדי")
        self.assertIn("להתמקד במכנה משותף", pass_spec["notes"])
        self.assertIn("שאלה 3 קשה מדי", pass_spec["notes"])

    def test_the_original_spec_is_not_mutated(self):
        original = {"notes": "להתמקד במכנה משותף"}
        revise._revision_spec(original, "שאלה 3 קשה מדי")
        self.assertEqual(original["notes"], "להתמקד במכנה משותף")

    def test_an_empty_instruction_changes_nothing(self):
        original = {"notes": "כך וכך"}
        self.assertIs(revise._revision_spec(original, "   "), original)

    def test_a_task_with_no_notes_gets_just_the_instruction(self):
        self.assertEqual(revise._revision_spec({}, "בלי שברים")["notes"], "בלי שברים")

    def test_a_long_instruction_is_capped(self):
        pass_spec = revise._revision_spec({}, "א" * 5000)
        self.assertEqual(len(pass_spec["notes"]), revise.MAX_INSTRUCTIONS)

    def test_the_stored_spec_is_untouched_after_a_regeneration(self):
        """The consequence: two edits in a row do not compound."""
        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                seen = {}

                async def fake(task, component, task_spec, **kwargs):
                    seen["notes"] = task_spec.get("notes")
                    return GOOD_PRACTICE

                with patch.object(generate, "generate_component", fake):
                    await revise.regenerate(task_id, "practice",
                                            instructions="שאלה 3 קשה מדי")
                task = await store.get_task(task_id)
                return seen["notes"], task["spec"]["notes"]

            sent, stored = run(scenario())
        self.assertIn("שאלה 3 קשה מדי", sent)
        self.assertEqual(stored, "להתמקד במכנה משותף")


class RegeneratingOneComponent(unittest.TestCase):
    def test_a_component_the_task_does_not_have_is_refused(self):
        with _Isolated():
            async def scenario():
                task_id = await _ready_task(components=("practice",))
                with self.assertRaises(revise.ReviseError):
                    await revise.regenerate(task_id, "test")

            run(scenario())

    def test_an_ai_edit_puts_the_current_content_in_front_of_the_model(self):
        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                seen = {}

                async def fake(task, component, task_spec, **kwargs):
                    seen.update(kwargs)
                    return GOOD_PRACTICE

                with patch.object(generate, "generate_component", fake):
                    await revise.regenerate(task_id, "practice",
                                            instructions="החלף את שאלה 1",
                                            keep_existing=True, question_index=0)
                return seen

            seen = run(scenario())
        self.assertEqual(seen["existing"], GOOD_PRACTICE)
        self.assertEqual(seen["focus"]["question_index"], 0)

    def test_a_successful_redo_clears_the_failure_from_the_log(self):
        """A component that failed once and was then regenerated must stop
        reporting itself as missing — the chip reads the LATEST entry."""
        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                await store.record_generation(
                    task_id, component="practice", ok=False,
                    detail="SpecError: unparseable_response")

                async def fake(task, component, task_spec, **kwargs):
                    return GOOD_PRACTICE

                with patch.object(generate, "generate_component", fake):
                    await revise.regenerate(task_id, "practice")
                task = await store.get_task(task_id)
                return task.get("generation") or []

            log = run(scenario())
        latest = {e["component"]: e for e in log}
        self.assertTrue(latest["practice"]["ok"])

    def test_a_plain_regeneration_sends_no_existing_content(self):
        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                seen = {}

                async def fake(task, component, task_spec, **kwargs):
                    seen.update(kwargs)
                    return GOOD_PRACTICE

                with patch.object(generate, "generate_component", fake):
                    await revise.regenerate(task_id, "practice")
                return seen

            seen = run(scenario())
        self.assertIsNone(seen["existing"])
        self.assertIsNone(seen["focus"])

    def test_an_ai_edit_with_nothing_stored_falls_back_to_a_plain_pass(self):
        """Rather than handing the model an empty "here is the current
        content" block, which reads as "the content is empty"."""
        with _Isolated():
            async def scenario():
                task = await store.create_task(
                    teacher_id=TEACHER, group_id=GROUP,
                    target={"kind": "learner", "id": KID},
                    spec={"title": "שברים", "language": "he",
                          "components": ["practice"]},
                )
                seen = {}

                async def fake(task_id, component, task_spec, **kwargs):
                    seen.update(kwargs)
                    return GOOD_PRACTICE

                with patch.object(generate, "generate_component", fake):
                    await revise.regenerate(task["_id"], "practice",
                                            instructions="שנה", keep_existing=True)
                return seen

            seen = run(scenario())
        self.assertIsNone(seen["existing"])


class ABlankKnowsWhatItIs(unittest.TestCase):
    """The shape of the answer is not the answer.

    Two things were wrong at once. The player sized its list of boxes from the
    child's own saved answers, so a two-blank question showed ONE box until
    something was typed in it — the second value could never be entered, and
    was then marked wrong. And nothing named the boxes, so a coordinate pair
    was two identical gaps a child could fill in either order.
    """

    def _question(self, blanks):
        return {"id": "q1", "type": "fill_blank",
                "question": "השלימו את שיעורי הנקודה",
                "answer": {"blanks": blanks}}

    def test_a_label_survives_normalization(self):
        questions = spec.normalize_questions({"questions": [
            self._question([{"accept": ["5"], "label": "x"},
                            {"accept": ["7"], "label": "y"}])]})
        blanks = questions[0]["answer"]["blanks"]
        self.assertEqual([blank["label"] for blank in blanks], ["x", "y"])

    def test_a_blank_with_no_label_is_still_a_blank(self):
        questions = spec.normalize_questions({"questions": [
            self._question([{"accept": ["12"]}])]})
        self.assertIsNone(questions[0]["answer"]["blanks"][0]["label"])

    def test_a_label_long_enough_to_be_a_sentence_is_dropped(self):
        """A model given a free field returns "the x coordinate of the point",
        which then renders in front of the box and repeats the question."""
        questions = spec.normalize_questions({"questions": [
            self._question([{"accept": ["5"],
                             "label": "the x coordinate of the point on the grid"}])]})
        self.assertIsNone(questions[0]["answer"]["blanks"][0]["label"])

    def test_the_child_is_told_how_many_boxes_and_what_each_is(self):
        from app.services.tasks import attempts as attempts_module

        shown = attempts_module._without_answers({"practice": {"questions": [
            spec.normalize_questions({"questions": [
                self._question([{"accept": ["5"], "label": "x"},
                                {"accept": ["7"], "label": "y"}])]})[0]]}})
        question = shown["practice"]["questions"][0]
        self.assertEqual(question["blanks"], [{"label": "x"}, {"label": "y"}])

    def test_the_accepted_values_do_not_travel_with_the_shape(self):
        from app.services.tasks import attempts as attempts_module

        shown = attempts_module._without_answers({"practice": {"questions": [
            spec.normalize_questions({"questions": [
                self._question([{"accept": ["5", "5.0"], "label": "x"}])]})[0]]}})
        question = shown["practice"]["questions"][0]
        self.assertNotIn("answer", question)
        self.assertNotIn("5", json.dumps(question, ensure_ascii=False))

    def test_a_question_that_is_not_fill_blank_gets_no_shape(self):
        from app.services.tasks import attempts as attempts_module

        self.assertIsNone(attempts_module.blank_shape(
            {"type": "mcq", "answer": {"index": 1}}))


if __name__ == "__main__":
    unittest.main()
