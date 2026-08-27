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
        streamed, persisted = _drive(_chunked(DIAGRAM), user_message="איך עובד מחזור המים?")
        self.assertEqual(streamed.count("```"), 2, streamed)
        body = streamed.split("```yuvi-diagram", 1)[1].split("```", 1)[0]
        self.assertEqual(json.loads(body)["kind"], "cycle")
        self.assertIn(
            {"name": "embedded_diagram", "status": "ok", "source": "system"},
            persisted["debug_trace"],
        )

    def test_plain_prose_is_still_joined_by_a_space(self):
        streamed, _ = _drive(_chunked("משפט ראשון. משפט שני."), user_message="שלום")
        self.assertNotIn("\n", streamed.strip())


if __name__ == "__main__":
    unittest.main()
