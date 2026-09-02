"""Generation: forcing model output into the vocabulary, and grading what it made.

Two failures from the reference implementation are pinned here, because both
were silent and both cost a real grade:

* its `open_ended` branch read a pre-computed `answer["score"]` that nothing
  ever wrote, so every open question scored zero;
* its generated games dropped their own score into an empty `if` block while
  carrying a quarter of the composite grade.

And one that is ours to avoid: PII screening that eats a seven-digit answer key,
because `strip_pii` cannot tell a phone number from a quantity.
"""

from __future__ import annotations

import asyncio
import json
import sys
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.tasks import generate, grader, spec


def run(coro):
    return asyncio.run(coro)


def _mcq(index=0, qid="q1"):
    return {"id": qid, "type": "mcq", "question": "כמה זה 2 + 2",
            "choices": ["3", "4"], "correct_index": index}


class ParsingWhatTheModelActuallySends(unittest.TestCase):
    """`json_mode=True` asks for JSON. It does not guarantee it."""

    def test_a_fenced_block_is_unwrapped(self):
        self.assertEqual(spec.loads_model_json('```json\n{"a": 1}\n```'), {"a": 1})

    def test_a_preamble_is_skipped(self):
        parsed = spec.loads_model_json('Here is the JSON you asked for:\n{"a": 1}\nHope that helps!')
        self.assertEqual(parsed, {"a": 1})

    def test_trailing_commas_are_dropped(self):
        self.assertEqual(spec.loads_model_json('{"a": [1, 2,],}'), {"a": [1, 2]})

    def test_a_raw_newline_inside_a_string_is_escaped(self):
        # A long Hebrew explanation is where this actually happens.
        parsed = spec.loads_model_json('{"why": "שורה ראשונה\nשורה שנייה"}')
        self.assertEqual(parsed["why"], "שורה ראשונה\nשורה שנייה")

    def test_escaping_newlines_does_not_flatten_the_structure(self):
        """A blanket replace would parse too — and destroy the indentation."""
        parsed = spec.loads_model_json('{\n  "a": "one\ntwo",\n  "b": 2,\n}')
        self.assertEqual(parsed, {"a": "one\ntwo", "b": 2})

    def test_a_backslash_before_a_quote_is_not_miscounted(self):
        parsed = spec.loads_model_json(r'{"a": "he said \"hi\"", "b": 1}')
        self.assertEqual(parsed["b"], 1)

    def test_nothing_salvageable_returns_none_rather_than_raising(self):
        self.assertIsNone(spec.loads_model_json("I'd rather not."))
        self.assertIsNone(spec.loads_model_json(""))

    def test_a_batch_survives_the_field_names_the_model_really_uses(self):
        payload = spec.loads_model_json(
            '```json\n{"questions": [{"id":"q1","question_type":"single_choice",'
            '"stem":"כמה","answers":["3","4"],"correct_answer":"4"},]}\n```')
        questions = spec.normalize_questions(payload)
        self.assertEqual(len(questions), 1)
        self.assertEqual(questions[0]["type"], "mcq")
        # `correct_answer` held the option's TEXT, not its position.
        self.assertEqual(questions[0]["answer"]["index"], 1)


class TheDeck(unittest.TestCase):
    def test_a_deck_always_ends_on_a_summary(self):
        """Their prompt mandates it, their server re-synthesises it, and the
        model forgets often enough that both halves are needed."""
        slides = spec.normalize_slides({"slides": [
            {"layout": "title", "title": "שברים", "body": "נתחיל",
             "key_points": ["שבר הוא חלק משלם"]},
            {"layout": "text", "title": "מונה ומכנה", "body": "המכנה למטה",
             "key_points": ["המכנה אומר לכמה חלקים חילקנו"]},
            {"layout": "text", "title": "עוד", "body": "עוד טקסט"},
        ]})
        self.assertEqual(slides[-1]["layout"], "summary")
        self.assertTrue(slides[-1]["synthesized"])
        # Assembled from the deck's own points — never new content.
        self.assertEqual(len(slides[-1]["bullets"]), 2)

    def test_a_summary_the_model_wrote_is_left_alone(self):
        slides = spec.normalize_slides({"slides": [
            {"layout": "text", "title": "א", "body": "טקסט"},
            {"layout": "recap", "title": "סיכום", "bullets": ["נקודה"]},
        ]})
        self.assertEqual(len(slides), 2)
        self.assertNotIn("synthesized", slides[-1])

    def test_a_slide_with_a_heading_and_nothing_else_is_dropped(self):
        slides = spec.normalize_slides({"slides": [
            {"layout": "text", "title": "כותרת בלבד"},
            {"layout": "text", "title": "אמיתית", "body": "יש כאן תוכן"},
        ]})
        self.assertEqual(len([s for s in slides if not s.get("synthesized")]), 1)

    def test_a_big_number_slide_without_its_number_is_dropped(self):
        slides = spec.normalize_slides({"slides": [
            {"layout": "big_number", "title": "כמה", "body": "טקסט"},
            {"layout": "text", "title": "א", "body": "ב"},
        ]})
        self.assertNotIn("big_number", [slide["layout"] for slide in slides])

    def test_an_unknown_layout_falls_back_rather_than_losing_the_content(self):
        slides = spec.normalize_slides({"slides": [
            {"layout": "parallax_hero_carousel", "title": "א", "body": "תוכן אמיתי"}]})
        self.assertEqual(slides[0]["layout"], "text")

    def test_the_outline_is_what_grounds_the_questions(self):
        content = {"slides": [{"key_points": ["המכנה אומר לכמה חילקנו"]},
                              {"key_points": ["המונה אומר כמה לקחנו"]}]}
        self.assertEqual(len(generate.outline_of(content)), 2)


class InteractiveBlocksAreQuestions(unittest.TestCase):
    """The decision that makes them scoreable: a block with a right answer IS a
    question in the one vocabulary, wearing a widget."""

    def test_sort_items_is_an_ordering_question(self):
        blocks = spec.normalize_blocks({"blocks": [{
            "widget": "sort_items", "prompt": "סדרו",
            "options": ["שלוש", "אחת", "שתיים"], "answer": {"order": [1, 2, 0]},
        }]})
        self.assertEqual(blocks[0]["type"], "ordering")
        self.assertEqual(blocks[0]["widget"], "sort_items")
        self.assertTrue(blocks[0]["scored"])

    def test_a_scored_block_scores_through_the_ordinary_path(self):
        from app.services.tasks.evaluate import score_question

        block = spec.normalize_blocks({"blocks": [{
            "widget": "sort_items", "prompt": "סדרו",
            "options": ["ג", "א", "ב"], "answer": {"order": [1, 2, 0]},
        }]})[0]
        self.assertEqual(score_question(block, [1, 2, 0])["correctness"], 1.0)
        # Partial credit, not zero, for two of three in place.
        self.assertGreater(score_question(block, [1, 0, 2])["correctness"], 0)

    def test_flashcards_declare_themselves_unscored(self):
        """So a "0%" never appears beside a block nobody could get wrong."""
        blocks = spec.normalize_blocks({"blocks": [{
            "widget": "flashcards",
            "cards": [{"front": "מכנה", "back": "החלק התחתון"}],
        }]})
        self.assertFalse(blocks[0]["scored"])

    def test_a_block_whose_answer_points_nowhere_is_dropped(self):
        blocks = spec.normalize_blocks({"blocks": [{
            "widget": "match_pairs", "options": ["א"], "answer": {"pairs": [[0, 9]]},
        }]})
        self.assertEqual(blocks, [])


class TheSpec(unittest.TestCase):
    def test_a_pass_mark_is_not_clamped_like_a_question_count(self):
        """One shared range silently turns a 60% standard into a 30% one."""
        parsed = spec.normalize_spec({
            "title": "מבחן", "components": ["test"],
            "test": {"passing_grade": 60, "question_count": 12, "time_limit_minutes": 45},
        })
        self.assertEqual(parsed["test"]["passing_grade"], 60)
        self.assertEqual(parsed["test"]["time_limit_minutes"], 45)

    def test_an_absurd_question_count_is_bounded(self):
        parsed = spec.normalize_spec({"title": "x", "components": ["practice"],
                                      "practice": {"question_count": 900}})
        self.assertEqual(parsed["practice"]["question_count"], spec.MAX_QUESTIONS)

    def test_a_task_with_no_components_still_generates_something(self):
        parsed = spec.normalize_spec({"title": "x"})
        self.assertEqual(parsed["components"], ["practice"])

    def test_a_task_with_no_title_is_refused(self):
        with self.assertRaises(spec.SpecError):
            spec.normalize_spec({"components": ["practice"]})


class ScreeningDoesNotEatTheMaths(unittest.TestCase):
    def test_pii_in_prose_is_redacted(self):
        screened = generate._screen_deep(
            [{"type": "text", "text": "כתבו לי ל dana@example.com בבקשה"}], "he")
        self.assertNotIn("dana@example.com", screened[0]["text"])

    def test_a_seven_digit_answer_key_survives(self):
        """`strip_pii` redacts any run of seven digits. In a place-value lesson
        that is the answer, and in a `big_number` slide it is the whole slide."""
        content = {"questions": [{
            "id": "q1", "type": "fill_blank",
            "prompt": [{"type": "text", "text": "כמה זה"}],
            "answer": {"blanks": [{"accept": ["1234567"]}]},
        }]}
        screened = generate._screen_deep(content, "he")
        self.assertEqual(screened["questions"][0]["answer"]["blanks"][0]["accept"], ["1234567"])

    def test_a_big_number_slide_keeps_its_number(self):
        screened = generate._screen_deep(
            [{"layout": "big_number", "value": "8000000",
              "title": [{"type": "text", "text": "אוכלוסייה"}]}], "he")
        self.assertEqual(screened[0]["value"], "8000000")

    def test_a_link_hiding_in_a_math_segment_is_dropped(self):
        screened = generate._screen_deep(
            [{"type": "math", "value": "https://evil.example"},
             {"type": "math", "value": "3 + 4"}], "he")
        self.assertEqual(len(screened), 1)
        self.assertEqual(screened[0]["value"], "3 + 4")


class GeneratingAWholeTask(unittest.TestCase):
    def _store(self):
        """An in-memory stand-in for the four collections."""
        content: dict[str, Any] = {}
        task = {"_id": "tsk-1", "status": "draft", "generation": [],
                "spec": {"title": "שברים", "language": "he",
                         "components": ["presentation", "practice"],
                         "presentation": {"slide_count": 4},
                         "practice": {"question_count": 2}}}

        async def put_content(task_id, component, payload, source="llm"):
            content[component] = payload
            return payload

        async def update_task(task_id, **fields):
            task.update(fields)
            return task

        return task, content, [
            patch("app.services.tasks.store.get_task", AsyncMock(return_value=task)),
            patch("app.services.tasks.store.put_content", AsyncMock(side_effect=put_content)),
            patch("app.services.tasks.store.update_task", AsyncMock(side_effect=update_task)),
            patch("app.services.tasks.store.record_generation", AsyncMock()),
        ]

    def test_the_deck_is_generated_first_and_grounds_the_questions(self):
        task, content, patches = self._store()
        prompts: list[str] = []

        async def fake_llm(messages, **kwargs):
            prompts.append(messages[0]["content"])
            if "slides" in messages[0]["content"]:
                return json.dumps({"slides": [
                    {"layout": "text", "title": "מכנה", "body": "המכנה למטה",
                     "key_points": ["המכנה אומר לכמה חלקים חילקנו"]},
                    {"layout": "text", "title": "מונה", "body": "המונה למעלה",
                     "key_points": ["המונה אומר כמה חלקים לקחנו"]},
                    {"layout": "summary", "bullets": ["שבר הוא חלק משלם"]},
                ]})
            return json.dumps({"questions": [_mcq(1)]})

        for entry in patches:
            entry.start()
        try:
            with patch("app.services.llm.call_llm", AsyncMock(side_effect=fake_llm)):
                run(generate.generate_task("tsk-1"))
        finally:
            for entry in reversed(patches):
                entry.stop()

        self.assertEqual(task["status"], "ready")
        self.assertIn("presentation", content)
        self.assertIn("practice", content)
        # The questions prompt carried the deck's own points.
        self.assertIn("המכנה אומר לכמה חלקים חילקנו", prompts[1])

    def test_one_failed_component_does_not_lose_the_others(self):
        """A task with working practice and no deck is still a task to send."""
        task, content, patches = self._store()

        async def fake_llm(messages, **kwargs):
            if "slides" in messages[0]["content"]:
                return "the model declined"
            return json.dumps({"questions": [_mcq(1)]})

        for entry in patches:
            entry.start()
        try:
            with patch("app.services.llm.call_llm", AsyncMock(side_effect=fake_llm)):
                run(generate.generate_task("tsk-1"))
        finally:
            for entry in reversed(patches):
                entry.stop()

        self.assertEqual(task["status"], "ready")
        self.assertNotIn("presentation", content)
        self.assertIn("practice", content)

    def test_a_task_where_everything_failed_goes_back_to_draft(self):
        task, content, patches = self._store()
        for entry in patches:
            entry.start()
        try:
            with patch("app.services.llm.call_llm", AsyncMock(return_value="nope")):
                run(generate.generate_task("tsk-1"))
        finally:
            for entry in reversed(patches):
                entry.stop()
        self.assertEqual(task["status"], "draft")
        self.assertEqual(content, {})

    def test_a_second_poll_joins_the_run_already_going(self):
        """A reloaded builder page must not start a second generation."""
        task = {"_id": "tsk-2", "status": "draft", "spec": {}}
        started = 0

        async def slow_generate(task_id):
            nonlocal started
            started += 1
            await asyncio.sleep(0.05)
            return task

        async def scenario():
            with patch("app.services.tasks.store.get_task", AsyncMock(return_value=task)):
                with patch.object(generate, "generate_task", AsyncMock(side_effect=slow_generate)):
                    first = await generate.get_or_start("tsk-2")
                    second = await generate.get_or_start("tsk-2")
                    await asyncio.sleep(0.1)
                    return first, second

        first, second = run(scenario())
        self.assertEqual(first["status"], "generating")
        self.assertEqual(second["status"], "generating")
        self.assertEqual(started, 1)

    def test_a_run_in_flight_is_visible_to_a_plain_read(self):
        """The review screen's first GET can beat the run's own
        `status="generating"` write (#490 follow-up): the registry, not the
        document, says whether a task is being written right now."""
        task = {"_id": "tsk-3", "status": "draft", "spec": {}}

        async def slow_generate(task_id):
            await asyncio.sleep(0.05)
            return task

        async def scenario():
            with patch("app.services.tasks.store.get_task", AsyncMock(return_value=task)):
                with patch.object(generate, "generate_task", AsyncMock(side_effect=slow_generate)):
                    before = generate.is_running("tsk-3")
                    await generate.get_or_start("tsk-3")
                    during = generate.is_running("tsk-3")
                    await asyncio.sleep(0.1)
                    return before, during, generate.is_running("tsk-3")

        before, during, after = run(scenario())
        self.assertFalse(before)
        self.assertTrue(during)
        self.assertFalse(after)


class TheRubricGrader(unittest.TestCase):
    QUESTION = {
        "id": "q1", "type": "open_ended",
        "prompt": [{"type": "text", "text": "הסבירו למה"}],
        "answer": {"rubric": [{"criterion": "מזכיר את המכנה המשותף", "weight": 1},
                              {"criterion": "מסביר את הצעד", "weight": 1}]},
        "weight": 1.0,
    }

    def _reply(self, scores, feedback="כתבת יפה, חסר צעד אחד."):
        return json.dumps({
            "scores": [{"criterion": "c", "score": score, "note": "n"} for score in scores],
            "feedback": feedback,
        })

    def test_an_open_question_is_actually_graded(self):
        """The reference read a score nothing wrote, so every open question
        silently scored zero and the composite was wrong by its whole weight."""
        answer = "צריך למצוא מכנה משותף ואז לחבר את המונים בזהירות רבה"
        with patch("app.services.llm.call_llm", AsyncMock(return_value=self._reply([10, 10]))):
            result = run(grader.grade_open_ended(self.QUESTION, answer))
        self.assertEqual(result["correctness"], 1.0)
        self.assertEqual(result["source"], "llm")

    def test_the_bottom_of_the_scale_is_zero_not_a_tenth(self):
        answer = "לא יודע בכלל מה לכתוב כאן בכלל אני מצטער"
        with patch("app.services.llm.call_llm", AsyncMock(return_value=self._reply([1, 1]))):
            result = run(grader.grade_open_ended(self.QUESTION, answer))
        self.assertEqual(result["correctness"], 0.0)

    def test_a_two_word_answer_cannot_talk_its_way_to_full_marks(self):
        with patch("app.services.llm.call_llm", AsyncMock(return_value=self._reply([10, 10]))):
            result = run(grader.grade_open_ended(self.QUESTION, "מכנה משותף"))
        self.assertEqual(result["correctness"], grader.THIN_ANSWER_CAP)
        self.assertTrue(result["capped"])
        self.assertTrue(result["needs_review"])

    def test_a_score_outside_the_scale_is_clamped(self):
        answer = "מוצאים מכנה משותף ואז מחברים את המונים לפי הכלל"
        with patch("app.services.llm.call_llm", AsyncMock(return_value=self._reply([99, 99]))):
            result = run(grader.grade_open_ended(self.QUESTION, answer))
        self.assertEqual(result["correctness"], 1.0)

    def test_the_criteria_reported_back_are_the_teachers_not_the_models(self):
        answer = "מוצאים מכנה משותף ואז מחברים את המונים לפי הכלל"
        reply = json.dumps({"scores": [{"criterion": "משהו שהמצאתי", "score": 7}],
                            "feedback": "טוב"})
        with patch("app.services.llm.call_llm", AsyncMock(return_value=reply)):
            result = run(grader.grade_open_ended(self.QUESTION, answer))
        self.assertEqual(result["criteria"][0]["criterion"], "מזכיר את המכנה המשותף")

    def test_with_no_provider_it_says_so_instead_of_inventing_a_grade(self):
        answer = "צריך מכנה משותף כדי לחבר שברים"
        with patch("app.services.llm.call_llm", AsyncMock(side_effect=RuntimeError("no key"))):
            result = run(grader.grade_open_ended(self.QUESTION, answer))
        self.assertEqual(result["source"], "heuristic")
        self.assertTrue(result["needs_review"])
        # Never full marks: a keyword count rendered as 100% reads to a teacher
        # exactly like a real grade.
        self.assertLessEqual(result["correctness"], 0.5)

    def test_an_empty_answer_is_zero_and_needs_nobody(self):
        result = run(grader.grade_open_ended(self.QUESTION, "   "))
        self.assertEqual(result["correctness"], 0.0)
        self.assertFalse(result["needs_review"])
        self.assertTrue(result["feedback"])

    def test_a_question_with_no_rubric_is_flagged_rather_than_guessed(self):
        question = {**self.QUESTION, "answer": {"rubric": []}}
        result = run(grader.grade_open_ended(question, "תשובה כלשהי"))
        self.assertIsNone(result["correctness"])
        self.assertTrue(result["needs_review"])

    def test_the_open_question_is_folded_back_into_the_total(self):
        """`score_questions` excludes it while it waits; the total must not stay
        excluding it, or a teacher reads a mark of the objective half only."""
        questions = [
            {"id": "closed", "type": "mcq", "options": [1, 2],
             "answer": {"index": 0}, "weight": 1},
            {**self.QUESTION, "id": "open"},
        ]
        answers = {"closed": 1,  # wrong
                   "open": "מוצאים מכנה משותף ואז מחברים את המונים לפי הכלל"}

        from app.services.tasks.evaluate import score_questions
        before = score_questions(questions, answers)
        self.assertEqual(before["score"], 0)        # the open half is not counted yet
        self.assertEqual(before["awaiting_grading"], 1)

        with patch("app.services.llm.call_llm", AsyncMock(return_value=self._reply([10, 10]))):
            after = run(grader.grade_attempt(questions, answers))

        self.assertEqual(after["awaiting_grading"], 0)
        # One of two right: half marks, not the zero the reference produced.
        self.assertEqual(after["score"], 50)

    def test_the_exact_sentence_the_child_saw_is_kept_for_the_teacher(self):
        questions = [{**self.QUESTION, "id": "open1"}]
        answer = "צריך למצוא מכנה משותף ואז לחבר את המונים בזהירות"
        with patch("app.services.llm.call_llm",
                   AsyncMock(return_value=self._reply([7, 7], "כמעט! חסר הצעד האחרון."))):
            result = run(grader.grade_attempt(questions, {"open1": answer}))
        self.assertEqual(result["open_feedback"]["open1"], "כמעט! חסר הצעד האחרון.")


class TheLevelIsAnInstruction(unittest.TestCase):
    """"Difficulty: hard" as a line of facts changed the output very little.

    A teacher sets this dial expecting harder questions. What makes a question
    harder is nameable — steps, numbers, scaffolding, distractors, transfer —
    so the prompt names those, and this pins that the three levels really do
    ask for three different things rather than three adjectives.
    """

    def _prompt(self, component, level, **settings):
        return generate._instruction(
            component,
            {"title": "שברים", "topic": "מכנה משותף", "language": "he",
             "difficulty": level, component: settings},
            [],
        )

    def test_each_level_asks_for_something_different(self):
        prompts = {level: self._prompt("practice", level, question_count=8)
                   for level in ("easy", "medium", "hard")}
        self.assertEqual(len({*prompts.values()}), 3)
        self.assertIn("One step per question", prompts["easy"])
        self.assertIn("two steps", prompts["medium"])
        self.assertIn("three or more steps", prompts["hard"])

    def test_the_level_names_what_makes_a_question_hard(self):
        # The five axes the tooltip promises a teacher, in the hardest level.
        hard = self._prompt("test", "hard", question_count=10)
        for phrase in ("steps", "numbers", "No scaffolding", "misconception", "transfer"):
            self.assertIn(phrase, hard, phrase)

    def test_a_test_is_not_told_to_write_hints_it_must_not_have(self):
        # `_COMPONENT_RULES["test"]` says "No hints — this is a test", and a
        # level block that asks for one would contradict it two lines later.
        self.assertNotIn("Hints", self._prompt("test", "hard", question_count=10))
        self.assertIn("Hints", self._prompt("practice", "hard", question_count=8))

    def test_the_return_shape_is_still_the_last_thing_it_reads(self):
        prompt = self._prompt("practice", "hard", question_count=8)
        self.assertGreater(prompt.index('Return {"questions"'), prompt.index("LEVEL: hard"))

    def test_a_deck_gets_a_pace_rather_than_question_rules(self):
        slides = self._prompt("presentation", "hard", slide_count=7)
        self.assertIn("LEVEL: hard", slides)
        self.assertNotIn("misconception", slides)

    def test_an_unknown_level_is_medium_rather_than_nothing(self):
        odd = generate._instruction(
            "practice", {"title": "x", "language": "he", "difficulty": "brutal",
                         "practice": {"question_count": 8}}, [])
        self.assertIn("LEVEL: medium", odd)
        # And a spec with no level at all still gets one.
        self.assertIn("LEVEL: medium", generate._instruction(
            "practice", {"title": "x", "language": "he",
                         "practice": {"question_count": 8}}, []))


if __name__ == "__main__":
    unittest.main()


class ADiagramHasToShowSomething(unittest.TestCase):
    """#487: a comparison slide's diagram was one vertical line and a word —
    a large white card with nothing on it. The words stay; the picture goes."""

    def test_a_lone_line_with_a_caption_is_not_a_diagram(self):
        scene = {"elements": [{"type": "line", "points": [[0, 0], [0, 2]]},
                              {"type": "text", "text": "נפח"}]}
        self.assertFalse(generate.scene_is_substantive(scene))

    def test_one_shape_is_a_diagram(self):
        scene = {"elements": [{"type": "rectangle", "center": [0, 0], "width": 2, "height": 1},
                              {"type": "text", "text": "נפח"}]}
        self.assertTrue(generate.scene_is_substantive(scene))

    def test_two_strokes_are_a_diagram(self):
        scene = {"elements": [{"type": "line", "points": [[0, 0], [0, 2]]},
                              {"type": "arrow", "points": [[0, 0], [2, 0]]}]}
        self.assertTrue(generate.scene_is_substantive(scene))

    def test_a_thin_scene_leaves_the_slide_without_a_visual(self):
        slides = [{"layout": "compare", "title": "מסה או נפח?", "visual_hint": "a beaker",
                   "sides": [{"label": "מסה", "items": ["a"]}, {"label": "נפח", "items": ["b"]}]}]
        thin = {"use_visual": True, "elements": [{"type": "line", "points": [[0, 0], [0, 2]]}]}
        with patch("app.agents.manim_visual.plan_manim_visual", AsyncMock(return_value=thin)), \
             patch("app.agents.manim_visual.render_visual", AsyncMock(return_value={"type": "scene"})) as render:
            asyncio.run(generate._add_visuals(slides, "he", generate._usage("tsk-1", "presentation")))
        self.assertNotIn("visual", slides[0])
        self.assertNotIn("visual_hint", slides[0])
        render.assert_not_called()


class TheRunActsOnTheJudgeSFindings(unittest.TestCase):
    """#488/#492: the judge's findings were a list for the teacher to work
    through by hand. The run now applies them once, then measures again."""

    LOW = {"judged": True, "overall": 4.3, "findings": [
        {"component": "presentation", "item": 1,
         "problem": "השקופית אינה מתייחסת לקשיים של הילד"},
        {"component": "practice", "item": 2, "problem": "התרגול נשאר כללי"},
        {"component": "practice", "item": 4, "problem": "יחידות באנגלית"},
    ]}
    HIGH = {"judged": True, "overall": 7.5, "findings": []}

    def test_below_the_concern_line_with_named_parts_means_a_revision(self):
        self.assertTrue(generate._needs_revision(self.LOW))
        self.assertFalse(generate._needs_revision(self.HIGH))
        self.assertFalse(generate._needs_revision({"judged": False, "overall": 2.0,
                                                   "findings": self.LOW["findings"]}))
        self.assertFalse(generate._needs_revision({"judged": True, "overall": 3.0,
                                                   "findings": [{"component": "", "problem": "x"}]}))

    def test_the_instruction_is_that_part_s_findings_and_nothing_else(self):
        text = generate.findings_instruction(self.LOW, "practice")
        self.assertIn("item 2: התרגול נשאר כללי", text)
        self.assertIn("item 4: יחידות באנגלית", text)
        self.assertNotIn("השקופית", text)
        self.assertEqual(generate.findings_instruction(self.HIGH, "practice"), "")

    def test_each_named_part_is_revised_once_and_the_task_measured_again(self):
        written: dict[str, Any] = {}

        async def update_task(task_id, **fields):
            written.update(fields)
            return {}

        with patch("app.services.tasks.revise.regenerate", AsyncMock(return_value={})) as regen, \
             patch("app.services.tasks.quality.review", AsyncMock(return_value=self.HIGH)) as review, \
             patch("app.services.tasks.store.update_task", AsyncMock(side_effect=update_task)):
            asyncio.run(generate._revise_from_findings("tsk-1", self.LOW))

        self.assertEqual(regen.await_count, 2)
        components = [call.args[1] for call in regen.await_args_list]
        self.assertEqual(components, ["presentation", "practice"])
        for call in regen.await_args_list:
            self.assertTrue(call.kwargs["keep_existing"])
            self.assertIn("Fix each one", call.kwargs["instructions"])
        review.assert_awaited_once()
        self.assertTrue(written["quality"]["auto_revised"])
        self.assertEqual(written["quality"]["overall_before_revision"], 4.3)
        self.assertEqual(written["quality"]["overall"], 7.5)

    def test_a_task_is_not_called_ready_until_the_revision_is_done(self):
        order: list[str] = []
        task = {"_id": "tsk-1", "status": "draft", "generation": [],
                "spec": {"title": "מסה ונפח", "language": "he", "components": ["practice"],
                         "practice": {"question_count": 2}}}

        async def update_task(task_id, **fields):
            if "status" in fields:
                order.append(f"status:{fields['status']}")
            task.update(fields)
            return task

        async def review(task_id):
            order.append("review")
            return self.LOW if order.count("review") == 1 else self.HIGH

        async def regenerate(task_id, component, **kwargs):
            order.append(f"revise:{component}")
            return {}

        with patch("app.services.tasks.store.get_task", AsyncMock(return_value=task)), \
             patch("app.services.tasks.store.update_task", AsyncMock(side_effect=update_task)), \
             patch("app.services.tasks.store.record_generation", AsyncMock()), \
             patch.object(generate, "audience_block_for", AsyncMock(return_value="")), \
             patch.object(generate, "generate_component", AsyncMock(return_value={"questions": []})), \
             patch("app.services.tasks.quality.review", AsyncMock(side_effect=review)), \
             patch("app.services.tasks.revise.regenerate", AsyncMock(side_effect=regenerate)):
            asyncio.run(generate.generate_task("tsk-1"))

        # The judge also named the presentation; this task has none, so only
        # the part that exists is rewritten.
        self.assertEqual(order, ["status:generating", "review", "revise:practice",
                                 "review", "status:ready"])
