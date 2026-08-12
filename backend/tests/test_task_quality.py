"""The quality report: does it actually catch a task that missed the brief?

    python -m pytest tests/test_task_quality.py -q

These are all about the DETERMINISTIC half. The judge is one model call with
anchors and clamps — its plumbing is tested (a clamp, a refusal, a missing
provider) but its opinions are not, because a test that asserts what a model
thinks tests the model.

The point of the checks below is that they must fire on the failures the whole
feature exists to prevent, and must NOT fire on ordinary content. A checklist
that flags every task is a checklist a teacher stops reading, which is worse
than not having one.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.tasks import quality


def _text(value: str) -> list[dict]:
    return [{"type": "text", "text": value}]


def _mcq(qid: str, prompt: str, *, answer: int = 0) -> dict:
    return {
        "id": qid, "type": "mcq", "prompt": _text(prompt),
        "options": [_text("6"), _text("12")], "answer": {"index": answer},
    }


SPEC = {
    "title": "שברים", "topic": "מכנה משותף", "notes": "",
    "language": "he", "components": ["practice"],
    "practice": {"question_count": 2},
}

GOOD = {"practice": {"questions": [
    _mcq("q1", "מהו המכנה המשותף של השברים הבאים?"),
    _mcq("q2", "איזה מכנה משותף מתאים לשליש ולרבע?"),
]}}


class TestVocabulary:
    def test_the_definite_article_is_not_a_miss(self):
        """A teacher writes "מכנה" and the content says "המכנה".

        Exact matching scored that as a word the task never mentioned, which is
        the single thing most likely to make this check useless in Hebrew.
        """
        checks = quality.deterministic_checks(SPEC, GOOD)
        assert checks["brief_vocabulary"]["ok"] is True
        assert "מכנה" in checks["brief_vocabulary"]["matched"]

    def test_a_word_is_never_in_both_lists(self):
        checks = quality.deterministic_checks(SPEC, GOOD)
        matched = set(checks["brief_vocabulary"]["matched"])
        missed = set(checks["brief_vocabulary"]["missed"])
        assert not (matched & missed)

    def test_content_about_something_else_fails(self):
        off_topic = {"practice": {"questions": [
            _mcq("q1", "מהי בירת צרפת?"),
            _mcq("q2", "באיזו יבשת נמצאת מצרים?"),
        ]}}
        checks = quality.deterministic_checks(SPEC, off_topic)
        assert checks["brief_vocabulary"]["ok"] is False

    def test_a_prefix_letter_that_is_a_real_first_letter_still_matches_itself(self):
        """"משותף" starts with a prefix letter and is not a prefixed word.

        Stripping it in place produced "שותף" — a different word — so both forms
        are kept rather than one replacing the other.
        """
        assert quality.covered({"משותף"}, {"משותף"}) == {"משותף"}
        assert quality.covered({"משותף"}, {"שותף"}) == {"משותף"}


class TestCounts:
    def test_short_delivery_is_reported(self):
        thin = {"practice": {"questions": [_mcq("q1", "מהו המכנה המשותף?")]}}
        checks = quality.deterministic_checks(SPEC, thin)
        assert checks["counts"]["ok"] is False
        assert checks["counts"]["components"][0] == {
            "component": "practice", "asked": 2, "got": 1, "ok": False,
        }

    def test_more_than_asked_is_fine(self):
        generous = {"practice": {"questions": [
            _mcq("q1", "א"), _mcq("q2", "ב"), _mcq("q3", "ג"),
        ]}}
        assert quality.deterministic_checks(SPEC, generous)["counts"]["ok"] is True

    def test_a_missing_component_is_named(self):
        spec = {**SPEC, "components": ["practice", "presentation"]}
        checks = quality.deterministic_checks(spec, GOOD)
        assert checks["components_present"]["ok"] is False
        assert checks["components_present"]["missing"] == ["presentation"]


class TestDuplicates:
    def test_the_same_question_twice_is_caught(self):
        same = {"practice": {"questions": [
            _mcq("q1", "מהו המכנה המשותף?"), _mcq("q2", "מהו המכנה המשותף?"),
        ]}}
        checks = quality.deterministic_checks(SPEC, same)
        assert checks["no_duplicate_questions"]["ok"] is False

    def test_two_different_questions_are_not(self):
        assert quality.deterministic_checks(SPEC, GOOD)["no_duplicate_questions"]["ok"] is True


class TestSegments:
    def test_a_formula_glued_into_prose_is_caught(self):
        """The rule the generator prompt states three times, and nothing checked.

        A formula inside a text segment renders backwards in Hebrew and looks
        entirely correct in the JSON, which is why it needs a check rather than
        a reviewer's eye.
        """
        glued = {"practice": {"questions": [{
            "id": "q1", "type": "mcq",
            "prompt": _text("כמה זה 2 + 3 בשברים?"),
            "options": [_text("5")], "answer": {"index": 0},
        }]}}
        assert quality.deterministic_checks(SPEC, glued)["math_segments_clean"]["ok"] is False

    def test_latex_is_caught(self):
        latex = {"practice": {"questions": [{
            "id": "q1", "type": "mcq",
            "prompt": _text("מהו \\frac{1}{2}?"),
            "options": [_text("חצי")], "answer": {"index": 0},
        }]}}
        assert quality.deterministic_checks(SPEC, latex)["math_segments_clean"]["ok"] is False

    def test_properly_split_segments_pass(self):
        split = {"practice": {"questions": [{
            "id": "q1", "type": "mcq",
            "prompt": [{"type": "text", "text": "כמה זה "},
                       {"type": "math", "value": "2 + 3", "punctuation": "?"}],
            "options": [_text("5")], "answer": {"index": 0},
        }]}}
        assert quality.deterministic_checks(SPEC, split)["math_segments_clean"]["ok"] is True


class TestDeckGrounding:
    """The promise `generate_task` makes by writing the deck first and feeding
    its outline into the question prompts. Nothing checked that it was kept."""

    DECK = {"presentation": {"slides": [
        {"id": "s1", "layout": "text", "title": _text("מכנה משותף"),
         "body": _text("איך מוצאים מכנה משותף לשני שברים"),
         "key_points": ["המכנה המשותף הוא כפולה משותפת של שני המכנים"]},
    ]}}

    def test_questions_about_the_deck_pass(self):
        content = {
            **self.DECK,
            "practice": {"questions": [
                _mcq("q1", "מהי כפולה משותפת של המכנים 2 ו-3?"),
                _mcq("q2", "מהו המכנה המשותף של השברים?"),
            ]},
        }
        checks = quality.deterministic_checks(
            {**SPEC, "components": ["presentation", "practice"]}, content)
        assert checks["questions_follow_deck"]["ok"] is True

    def test_questions_about_nothing_the_deck_taught_fail(self):
        content = {
            **self.DECK,
            "practice": {"questions": [
                _mcq("q1", "מהי בירת צרפת?"),
                _mcq("q2", "כמה יבשות יש בעולם?"),
            ]},
        }
        checks = quality.deterministic_checks(
            {**SPEC, "components": ["presentation", "practice"]}, content)
        assert checks["questions_follow_deck"]["ok"] is False
        assert checks["questions_follow_deck"]["grounded"] == 0

    def test_no_deck_is_not_a_failure(self):
        """"There was nothing to check" and "we checked and it was wrong" are
        different answers, and a checklist that conflates them cries wolf."""
        checks = quality.deterministic_checks(SPEC, GOOD)
        assert checks["questions_follow_deck"]["ok"] is None
        assert checks["lesson_vocabulary"]["ok"] is None


class TestLessonVocabulary:
    def test_a_lesson_the_content_ignores_is_reported(self):
        lesson = ("Learning objective: שטח מלבן\n"
                  "What that lesson covers: סופרים ריבועים בתוך המלבן כדי למצוא "
                  "את השטח, בלי נוסחה")
        checks = quality.deterministic_checks(SPEC, GOOD, lesson_text=lesson)
        assert checks["lesson_vocabulary"]["ok"] is False

    def test_content_in_the_lessons_own_words_passes(self):
        lesson = "Learning objective: מכנה משותף\nWhat that lesson covers: מכנה משותף לשברים"
        checks = quality.deterministic_checks(SPEC, GOOD, lesson_text=lesson)
        assert checks["lesson_vocabulary"]["ok"] is True


class TestReportShape:
    def test_concerns_name_the_failing_checks_and_ignore_the_unevaluated(self):
        report = {
            "checks": {
                "counts": {"ok": False},
                "lesson_vocabulary": {"ok": None},
                "no_duplicate_questions": {"ok": True},
            },
            "scores": {"follows_brief": {"score": 4.0, "why": ""},
                       "sound": {"score": 9.0, "why": ""}},
        }
        named = quality.concerns(report)
        assert "counts" in named
        assert "follows_brief" in named
        assert "lesson_vocabulary" not in named
        assert "no_duplicate_questions" not in named
        # Worst first, so the teacher reads the checks before the soft scores.
        assert named[0] == "counts"

    def test_overall_is_the_mean_and_is_none_without_a_judge(self):
        assert quality.overall({"scores": {}}) is None
        assert quality.overall({"scores": {
            "a": {"score": 6.0}, "b": {"score": 9.0}, "c": {"score": 6.0},
        }}) == 7.0


def _judged(reply):
    """Run the judge against a canned model reply.

    `judge` imports `call_llm` inside the function, so patching the module
    attribute is what reaches it — the same lazy-import seam `teacher_alerts`
    documents keeping open for exactly this reason.
    """
    async def fake(*args, **kwargs):
        return reply

    with patch("app.services.llm.call_llm", fake):
        return asyncio.run(quality.judge("tsk-1", SPEC, GOOD))


class TestJudgePlumbing:
    """Not what the model thinks — what happens to what it says."""

    def test_no_provider_means_no_score_rather_than_a_neutral_one(self):
        # A 7 that means "nobody looked" is worse than a blank, because a
        # teacher cannot tell the two apart.
        assert _judged(None) is None

    def test_a_score_outside_the_scale_is_clamped(self):
        verdict = _judged('{"follows_brief": {"score": 44, "why": "x"},'
                          ' "matches_lesson": {"score": -3, "why": "y"},'
                          ' "sound": {"score": 7, "why": "z"}, "findings": []}')
        assert verdict["scores"]["follows_brief"]["score"] == 10.0
        assert verdict["scores"]["matches_lesson"]["score"] == 1.0

    def test_a_finding_with_no_text_is_dropped(self):
        verdict = _judged(
            '{"follows_brief": {"score": 7}, "matches_lesson": {"score": 7},'
            ' "sound": {"score": 7},'
            ' "findings": [{"component": "practice", "item": 1, "problem": "  "},'
            '              {"component": "practice", "item": 2, "problem": "ok"}]}')
        assert len(verdict["findings"]) == 1
        assert verdict["findings"][0]["item"] == 2

    def test_unparseable_output_is_no_verdict_rather_than_a_crash(self):
        assert _judged("I think it is quite good actually") is None
