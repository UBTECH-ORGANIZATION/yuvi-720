"""Where "discuss an option" ends and "reveal the answer" begins.

The coach used to refuse outright when asked about a specific option ("explain
answer C"), replying with an evasion — *"let's check whether it fits or not"* —
that says nothing. The learner can see the options; naming one back is not a
reveal. The prompt now requires engagement: what the option claims, which idea
it rests on, and a test the learner can apply — with only the VERDICT withheld.

These tests pin the resulting boundary, including a deliberate limitation:
discussing the CORRECT option still trips the deterministic guard. Restating it
in full is close enough to a reveal that the guard cannot safely tell the two
apart, and the asymmetry decides it — a redirect is merely unhelpful, while a
reveal permanently spends the question and corrupts the mastery signal built
from it. If that is ever loosened, it must be here, with these cases as the
evidence.
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents import answer_guard  # noqa: E402

QUESTION = {
    "options": [
        "הגומי של הבלון המנופח נמתח ונהיה כבד יותר",
        "האוויר שבתוך הבלון המנופח מעלה את המסה שלו",
        "המאזניים לא תקינים — שניהם אמורים לשקול אותו דבר",
        "הבלון המנופח כבד יותר כי הוא לוחץ חזק יותר על הכף",
    ],
    "correct": ["האוויר שבתוך הבלון המנופח מעלה את המסה שלו"],
}


class DiscussingASpecificOption(unittest.TestCase):
    def setUp(self):
        self.guard = answer_guard.build(QUESTION)

    def test_a_distractor_can_be_explained_in_full(self):
        """The reported case: the learner asked about ג and got a refusal."""
        reply = (
            "תשובה ג׳ טוענת שהמאזניים לא תקינים, כלומר שההפרש נובע מתקלה במכשיר "
            "ולא מהבלונים. אם הם היו מקולקלים, מה היית מצפה לראות עם משקולת ידועה?"
        )
        self.assertFalse(self.guard.reveals(reply))

    def test_naming_the_idea_behind_a_distractor_is_fine(self):
        reply = "תשובה ד׳ מדברת על לחץ על הכף — האם לחץ ומסה הם אותו דבר?"
        self.assertFalse(self.guard.reveals(reply))

    def test_weighing_two_options_stays_allowed(self):
        reply = "אפשר להשוות: תשובה א׳ מדברת על הגומי, תשובה ב׳ על האוויר. מה מוסיף חומר?"
        self.assertFalse(self.guard.reveals(reply))

    def test_an_outright_reveal_is_still_blocked(self):
        reply = "התשובה היא שהאוויר שבתוך הבלון המנופח מעלה את המסה שלו."
        self.assertTrue(self.guard.reveals(reply))

    def test_restating_the_correct_option_is_blocked_even_without_a_verdict(self):
        """KNOWN LIMITATION, asserted so it is a decision and not a surprise.

        This reply is pedagogically fine — it gives no verdict — but the guard
        cannot distinguish it from a reveal, so the learner gets the redirect
        instead. Loosening this needs a way to know the learner named the option
        first; the guard sees only the outgoing text.
        """
        reply = (
            "תשובה ב׳ טוענת שהאוויר שבתוך הבלון המנופח מעלה את המסה שלו. "
            "היא נשענת על הרעיון שגם גז הוא חומר. איך אפשר לבדוק את זה?"
        )
        self.assertTrue(self.guard.reveals(reply))

    def test_the_principle_behind_the_correct_option_can_still_be_taught(self):
        """The escape hatch that keeps the limitation liveable: teach the idea
        without quoting the option, and the coach is free to be substantive."""
        reply = "שאלה שכדאי לשאול: האם גז הוא חומר? ואם כן, מה זה אומר על מה שנמצא בפנים?"
        self.assertFalse(self.guard.reveals(reply))


if __name__ == "__main__":
    unittest.main()
