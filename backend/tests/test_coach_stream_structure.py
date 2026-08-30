"""Structure survives the sentence-by-sentence stream.

The Coach does not forward the model's text as it arrives — it splits it into
sentences (for the answer guard and the brevity cap) and rejoins them. Rejoining
with a flat space is what silently broke every table Yuvi ever wrote: a header
row glued onto the end of the preceding sentence is no longer at the start of a
line, so the client read `…השוואה. | מונח | הסבר |` as a paragraph with pipes in
it. Nobody saw a table, and the prompt had been telling the model to write one
for months.

These tests drive the real `run_coach_stream` with a stubbed model and assert on
the shape of what the learner receives, not on its wording.
"""

from __future__ import annotations

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.test_coach_answer_block import _drive  # noqa: E402


TABLE = (
    "הנה ההשוואה בין השניים.\n\n"
    "| מצב | דוגמה |\n"
    "| --- | --- |\n"
    "| מוצק | קרח |\n"
    "| נוזל | מים |\n\n"
    "מה מזה מוכר לך?"
)

DIAGRAM = (
    "מחזור המים חוזר על עצמו.\n\n"
    "```yuvi-diagram\n"
    + json.dumps(
        {
            "kind": "cycle",
            "nodes": [{"label": "אידוי"}, {"label": "עיבוי"}, {"label": "משקעים"}],
        },
        ensure_ascii=False,
    )
    + "\n```\n\n"
    "איזה שלב הכי מפתיע אותך?"
)


def _chunked(text: str, size: int = 7) -> list[str]:
    """The model does not emit whole lines; it emits fragments."""
    return [text[index:index + size] for index in range(0, len(text), size)]


class CoachStreamStructureTests(unittest.TestCase):
    def test_a_table_reaches_the_learner_with_its_rows_on_their_own_lines(self):
        streamed, _ = _drive(_chunked(TABLE), user_message="מה ההבדל בין מוצק לנוזל?")
        rows = [line for line in streamed.splitlines() if line.strip().startswith("|")]
        self.assertEqual(len(rows), 4, streamed)
        # The header must open a line, not continue the sentence before it.
        self.assertNotIn(". |", streamed)

    def test_a_table_is_not_cut_off_by_the_brevity_cap(self):
        # Four rows plus two sentences is well past three "sentences" if layout
        # is counted as prose. It is not — a half-drawn table is worse than none.
        streamed, _ = _drive(_chunked(TABLE), user_message="מה ההבדל בין מוצק לנוזל?")
        self.assertIn("| נוזל | מים |", streamed)

    def test_a_diagram_payload_arrives_whole_and_still_parses(self):
        streamed, _ = _drive(_chunked(DIAGRAM), user_message="איך עובד מחזור המים?")
        self.assertEqual(streamed.count("```"), 2, streamed)
        body = streamed.split("```yuvi-diagram", 1)[1].split("```", 1)[0]
        self.assertEqual(json.loads(body)["kind"], "cycle")

    def test_plain_prose_is_still_joined_by_a_space(self):
        streamed, _ = _drive(_chunked("משפט ראשון. משפט שני."), user_message="שלום")
        self.assertNotIn("\n", streamed.strip())

    def test_general_chat_reports_text_dropped_after_three_sentences(self):
        diagnostics = {}
        streamed, _ = _drive(
            _chunked("אחד. שניים. שלושה. ארבעה."),
            user_message="ספר לי ארבעה דברים",
            diagnostics_out=diagnostics,
            surface_screen="student_dashboard",
        )
        self.assertNotIn("ארבעה", streamed)
        self.assertTrue(diagnostics["sentence_cap_hit"])
        self.assertLess(diagnostics["delivered_chars"], diagnostics["generated_chars"])
        self.assertEqual(diagnostics["coach_mode"], "general_companion")

    def test_numbered_explanation_does_not_end_mid_list(self):
        response = (
            "הנה שלושה צעדים.\n"
            "1. מתחילים מהנתון הראשון. בודקים מה הוא אומר.\n"
            "2. משווים אותו לנתון הבא. מחפשים קשר ביניהם.\n"
            "3. מנסחים מסקנה. בודקים שהיא מתאימה לשאלה."
        )
        streamed, _ = _drive(
            _chunked(response),
            user_message="תסביר לי בשלושה צעדים",
            surface_screen="student_dashboard",
        )

        self.assertIn("1. מתחילים", streamed)
        self.assertIn("2. משווים", streamed)
        self.assertIn("3. מנסחים", streamed)
        self.assertTrue(streamed.endswith("מתאימה לשאלה."), streamed)

    def test_natural_question_keeps_parenthesized_steps_complete(self):
        response = (
            "אפשר להתחיל כך.\n\n"
            "1) בוחרים משימה קטנה. מגדירים מתי מתחילים.\n\n"
            "2) מרחיקים הסחות. מכינים את החומר מראש.\n\n"
            "3) מתחילים לכמה דקות. בודקים אחר כך מה עבד."
        )
        streamed, _ = _drive(
            _chunked(response),
            user_message="אני לא מצליח להתחיל ללמוד, מה כדאי לי לעשות?",
            surface_screen="student_dashboard",
        )

        self.assertIn("1) בוחרים", streamed)
        self.assertIn("2) מרחיקים", streamed)
        self.assertIn("3) מתחילים", streamed)
        self.assertTrue(streamed.endswith("מה עבד."), streamed)

    def test_natural_question_keeps_bullets_complete(self):
        response = (
            "יש כמה דברים שיכולים לעזור.\n"
            "• להתחיל ממשימה קצרה. לבחור יעד אחד בלבד.\n"
            "• להכין מקום שקט. להרחיק את הטלפון.\n"
            "• לעצור להפסקה. לחזור כשיש יותר ריכוז."
        )
        streamed, _ = _drive(
            _chunked(response),
            user_message="איך אפשר להתרכז יותר כשאני לומד?",
            surface_screen="student_dashboard",
        )

        self.assertIn("• להתחיל", streamed)
        self.assertIn("• להכין", streamed)
        self.assertIn("• לעצור", streamed)

    def test_three_intro_sentences_do_not_leave_an_empty_list_marker(self):
        response = (
            "בטח. אפשר לעשות את זה בהדרגה. הנה דרך פשוטה:\n\n"
            "1. קוראים את השאלה. מסמנים את המידע החשוב.\n"
            "2. בוחרים צעד ראשון. מנסים אותו בנפרד.\n"
            "3. בודקים את התוצאה. מתקנים אם צריך."
        )
        streamed, _ = _drive(
            _chunked(response),
            user_message="אני מסתבך בשאלות ארוכות, איך מתחילים?",
            surface_screen="student_dashboard",
        )

        self.assertIn("1. קוראים", streamed)
        self.assertIn("2. בוחרים", streamed)
        self.assertIn("3. בודקים", streamed)

    def test_prose_cap_resumes_after_numbered_list(self):
        response = (
            "פתיח ראשון. פתיח שני.\n"
            "1. צעד ראשון.\n"
            "2. צעד שני.\n"
            "3. צעד שלישי.\n\n"
            "סיום ראשון. סיום שני."
        )
        streamed, _ = _drive(
            _chunked(response),
            user_message="תסביר לי בשלושה צעדים",
            surface_screen="student_dashboard",
        )

        self.assertIn("3. צעד שלישי.", streamed)
        self.assertIn("סיום ראשון.", streamed)
        self.assertNotIn("סיום שני.", streamed)

    def test_general_chat_reports_a_remainder_cut_at_600_characters(self):
        diagnostics = {}
        streamed, _ = _drive(
            _chunked("א" * 650),
            user_message="כתוב משפט ארוך",
            diagnostics_out=diagnostics,
            surface_screen="student_dashboard",
        )
        self.assertLessEqual(len(streamed), 600)
        self.assertTrue(streamed.endswith("…"), streamed)
        self.assertFalse(streamed.endswith("א…"), streamed)
        self.assertTrue(diagnostics["remainder_char_cap_hit"])
        self.assertEqual(diagnostics["generated_chars"], 650)
        self.assertEqual(diagnostics["delivered_chars"], len(streamed))


if __name__ == "__main__":
    unittest.main()
