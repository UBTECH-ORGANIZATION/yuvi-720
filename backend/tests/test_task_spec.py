"""The question vocabulary, and the layer that forces model output into it.

The reference implementation this borrows from grew two vocabularies for the
same eight types and then a client-side repair layer documenting fifteen field
names the model produced anyway. Each of those is a silent wrong-answer: the
scorer looks for `correct_index`, the generator wrote `correct_answer`, and
every child gets the question wrong.

So the normalizer is tested against the variants themselves, not against the
shape we hope for.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.tasks import spec


class SanitizerTests(unittest.TestCase):
    """Defence in depth: the prompt forbids LaTeX, and this runs anyway."""

    def test_fractions_roots_and_powers_become_plain_text(self):
        self.assertEqual(spec.sanitize_math(r"$\frac{3}{4}$"), "3/4")
        self.assertEqual(spec.sanitize_math(r"\sqrt{16}"), "√16")
        self.assertEqual(spec.sanitize_math(r"\sqrt[3]{27}"), "3√27")
        self.assertEqual(spec.sanitize_math(r"x^{2}"), "x²")
        self.assertEqual(spec.sanitize_math(r"x^2"), "x²")

    def test_a_mixed_number_is_not_a_multiplication(self):
        # "2\frac{1}{4}" is two and a quarter. Read as 2 × (1/4) it is an
        # eighth of that, and the question quietly becomes unanswerable.
        self.assertEqual(spec.sanitize_math(r"2\frac{1}{4}"), "2 1/4")

    def test_a_double_escaped_backslash_survives_a_json_round_trip(self):
        # What actually arrives after the payload has been serialized once.
        self.assertEqual(spec.sanitize_math(r"\\frac{1}{2}"), "1/2")
        self.assertEqual(spec.sanitize_math(r"\\sqrt{9}"), "√9")

    def test_operators_become_unicode(self):
        self.assertEqual(spec.sanitize_math(r"5 \times 3"), "5 × 3")
        self.assertEqual(spec.sanitize_math(r"12 \div 4"), "12 ÷ 4")
        self.assertEqual(spec.sanitize_math(r"\pi"), "π")

    def test_hebrew_around_the_math_is_untouched(self):
        self.assertEqual(
            spec.sanitize_math(r"כמה זה $\frac{1}{2}$ מהעוגה?"),
            "כמה זה 1/2 מהעוגה?",
        )

    def test_no_dollar_or_backslash_survives(self):
        for raw in (r"$x = 5$", r"$$y = 2$$", r"\text{שלום}", r"\left(3\right)"):
            cleaned = spec.sanitize_math(raw)
            self.assertNotIn("$", cleaned)
            self.assertNotIn("\\", cleaned)


class SegmentTests(unittest.TestCase):
    def test_a_plain_string_is_wrapped_rather_than_rejected(self):
        """A dropped question is worse than an imperfectly-split one."""
        segments = spec._segments("כמה זה 2+2?")
        self.assertEqual(segments, [{"type": "text", "text": "כמה זה 2+2?"}])

    def test_math_segments_keep_their_punctuation_field(self):
        segments = spec._segments([
            {"type": "text", "text": "האות "},
            {"type": "math", "value": "b = -4", "punctuation": "."},
        ])
        self.assertEqual(segments[1],
                         {"type": "math", "value": "b = -4", "punctuation": "."})

    def test_segments_render_back_to_searchable_text(self):
        self.assertEqual(
            spec.segments_to_text([
                {"type": "text", "text": "פתרו"},
                {"type": "math", "value": "x = 3", "punctuation": "."},
            ]),
            "פתרו x = 3.",
        )


class NormalizerTests(unittest.TestCase):
    """Every alias here was produced by a real generator."""

    def test_the_known_type_aliases_all_resolve(self):
        aliases = {
            "multiple_choice": "mcq", "single_choice": "mcq", "choice": "mcq",
            "match_pairs": "matching", "match": "matching",
            "order": "ordering", "sequence": "ordering",
            "multi_select": "multiple_correct", "checkbox": "multiple_correct",
            "boolean": "true_false", "yes_no": "true_false",
            "cloze": "fill_blank", "fill_in_the_blank": "fill_blank",
            "essay": "open_ended", "free_text": "open_ended",
            "image_choice": "image_mcq",
        }
        for alias, expected in aliases.items():
            question = spec.normalize_question(_payload_for(alias), 0)
            self.assertIsNotNone(question, f"{alias} produced nothing")
            self.assertEqual(question["type"], expected, alias)

    def test_the_prompt_is_read_from_any_of_its_names(self):
        for key in ("prompt", "question", "question_text", "text", "stem"):
            raw = {"type": "mcq", key: "שאלה", "options": ["א", "ב"], "correct_index": 0}
            question = spec.normalize_question(raw, 0)
            self.assertIsNotNone(question, key)
            self.assertEqual(spec.segments_to_text(question["prompt"]), "שאלה")

    def test_options_are_read_from_any_of_their_names(self):
        for key in ("options", "choices", "answers"):
            raw = {"type": "mcq", "question": "שאלה", key: ["א", "ב"], "correct_index": 1}
            question = spec.normalize_question(raw, 0)
            self.assertIsNotNone(question, key)
            self.assertEqual(len(question["options"]), 2)

    def test_an_option_named_instead_of_indexed_is_resolved(self):
        raw = {"type": "mcq", "question": "שאלה", "options": ["א", "ב"],
               "correct_answer": "ב"}
        question = spec.normalize_question(raw, 0)
        self.assertEqual(question["answer"], {"index": 1})

    def test_true_false_accepts_a_string_or_a_boolean(self):
        for given in (True, "true", "נכון"):
            raw = {"type": "true_false", "question": "ש", "correct_answer": given}
            self.assertEqual(spec.normalize_question(raw, 0)["answer"], {"value": True})
        for given in (False, "false", "לא נכון"):
            raw = {"type": "true_false", "question": "ש", "correct_answer": given}
            self.assertEqual(spec.normalize_question(raw, 0)["answer"], {"value": False})

    def test_fill_blank_folds_correct_answers_and_accept_together(self):
        raw = {"type": "fill_blank", "question": "ש",
               "correct_answer": "12", "accept": ["12.0", "שתים עשרה"]}
        question = spec.normalize_question(raw, 0)
        self.assertEqual(question["answer"]["blanks"][0]["accept"],
                         ["12", "12.0", "שתים עשרה"])

    def test_matching_accepts_pairs_as_lists_or_objects(self):
        for pairs in ([[0, 1], [1, 0]], [{"left": 0, "right": 1}, {"left": 1, "right": 0}]):
            raw = {"type": "matching", "question": "ש", "left_items": ["א", "ב"],
                   "right_items": ["1", "2"], "correct_pairs": pairs}
            question = spec.normalize_question(raw, 0)
            self.assertEqual(question["answer"]["pairs"], [[0, 1], [1, 0]])

    def test_latex_inside_a_question_is_sanitized_on_the_way_in(self):
        raw = {"type": "mcq", "question": r"כמה זה $\frac{1}{2}$?",
               "options": [r"$\frac{1}{4}$", "0.5"], "correct_index": 1}
        question = spec.normalize_question(raw, 0)
        self.assertEqual(spec.segments_to_text(question["prompt"]), "כמה זה 1/2?")
        self.assertEqual(spec.segments_to_text(question["options"][0]), "1/4")


class AnswerabilityTests(unittest.TestCase):
    """A question nobody can get right is worse than no question at all."""

    def test_an_mcq_with_no_correct_index_is_dropped(self):
        raw = {"type": "mcq", "question": "ש", "options": ["א", "ב"]}
        self.assertIsNone(spec.normalize_question(raw, 0))

    def test_an_mcq_whose_index_is_out_of_range_is_dropped(self):
        raw = {"type": "mcq", "question": "ש", "options": ["א", "ב"], "correct_index": 7}
        self.assertIsNone(spec.normalize_question(raw, 0))

    def test_an_ordering_whose_order_is_not_a_permutation_is_dropped(self):
        raw = {"type": "ordering", "question": "ש", "options": ["א", "ב", "ג"],
               "correct_order": [0, 0, 1]}
        self.assertIsNone(spec.normalize_question(raw, 0))

    def test_an_open_question_with_no_rubric_is_dropped(self):
        # Nothing could grade it, so it would sit unscored forever.
        raw = {"type": "open_ended", "question": "הסבירו"}
        self.assertIsNone(spec.normalize_question(raw, 0))

    def test_a_good_batch_survives_a_bad_neighbour(self):
        """Partial output is the common failure; eight good beat a rejected ten."""
        questions = spec.normalize_questions({"questions": [
            {"type": "mcq", "question": "טובה", "options": ["א", "ב"], "correct_index": 0},
            {"type": "mcq", "question": "רעה", "options": ["א", "ב"]},
            {"type": "true_false", "question": "טובה", "correct_answer": True},
        ]})
        self.assertEqual(len(questions), 2)
        self.assertEqual([spec.segments_to_text(q["prompt"]) for q in questions],
                         ["טובה", "טובה"])

    def test_colliding_ids_are_made_unique(self):
        # The player keys answers by id; a duplicate silently overwrites one.
        questions = spec.normalize_questions([
            {"id": "q1", "type": "true_false", "question": "א", "correct_answer": True},
            {"id": "q1", "type": "true_false", "question": "ב", "correct_answer": False},
        ])
        self.assertEqual(len({question["id"] for question in questions}), 2)


def _payload_for(alias: str) -> dict:
    """A minimal, answerable payload for whichever type this alias means."""
    base = {"type": alias, "question": "שאלה"}
    resolved = spec._TYPE_ALIASES.get(alias, alias)
    if resolved in ("mcq", "image_mcq"):
        return {**base, "options": ["א", "ב"], "correct_index": 0}
    if resolved == "multiple_correct":
        return {**base, "options": ["א", "ב", "ג"], "correct_indices": [0, 2]}
    if resolved == "true_false":
        return {**base, "correct_answer": True}
    if resolved == "ordering":
        return {**base, "options": ["א", "ב"], "correct_order": [1, 0]}
    if resolved == "matching":
        return {**base, "left_items": ["א"], "right_items": ["1"], "correct_pairs": [[0, 0]]}
    if resolved == "fill_blank":
        return {**base, "correct_answer": "12"}
    return {**base, "rubric": ["הסביר את השלב"]}


if __name__ == "__main__":
    unittest.main()


class TestBlockIdNamespace(unittest.TestCase):
    """An interactive block's id must not be able to collide with a question's.

    An attempt's answers are ONE flat map keyed by question id across every
    component of the task, so two items sharing an id share an answer and share
    a verdict. The model names the first item of every list `q1`, so a practice
    question and a block were called the same thing by default — and the merge
    that put them on one screen is what finally made it visible.
    """

    def _block(self, raw):
        return spec.normalize_block(raw, 0)

    def test_a_scored_widget_is_renamed_out_of_the_question_namespace(self):
        block = self._block({
            "id": "q1", "widget": "match_pairs",
            "prompt": [{"type": "text", "text": "התאימו"}],
            "options": [[{"type": "text", "text": "א"}], [{"type": "text", "text": "ב"}]],
            "right_items": [[{"type": "text", "text": "1"}], [{"type": "text", "text": "2"}]],
            "answer": {"pairs": [[0, 0], [1, 1]]},
        })
        self.assertIsNotNone(block)
        self.assertEqual(block["id"], "b1")
        self.assertTrue(block["scored"])

    def test_a_study_block_is_too(self):
        block = self._block({
            "id": "q1", "widget": "flashcards",
            "cards": [{"front": "מסה", "back": "כמה חומר יש בגוף"}],
        })
        self.assertEqual(block["id"], "b1")
        self.assertFalse(block["scored"])

    def test_an_id_already_in_the_block_namespace_is_kept(self):
        block = self._block({
            "id": "b7", "widget": "flashcards",
            "cards": [{"front": "נפח", "back": "כמה מקום גוף תופס"}],
        })
        self.assertEqual(block["id"], "b7")

    def test_blocks_and_questions_from_one_payload_never_share_an_id(self):
        questions = spec.normalize_questions({"questions": [
            {"id": "q1", "type": "true_false",
             "prompt": [{"type": "text", "text": "נכון?"}], "answer": {"value": True}},
            {"id": "q2", "type": "true_false",
             "prompt": [{"type": "text", "text": "ולא?"}], "answer": {"value": False}},
        ]})
        blocks = spec.normalize_blocks({"blocks": [
            {"widget": "flashcards", "cards": [{"front": "א", "back": "ב"}]},
            {"widget": "click_reveal", "cards": [{"front": "ג", "back": "ד"}]},
        ]})
        self.assertTrue(questions and blocks)
        self.assertFalse(
            {q["id"] for q in questions} & {b["id"] for b in blocks},
            "a block and a question share an id, so they would share an answer",
        )
