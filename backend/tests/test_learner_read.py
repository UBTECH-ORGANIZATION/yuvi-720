"""The read of a child: cached for a day, and free of plumbing.

    python -m pytest tests/test_learner_read.py -q

Two things are worth a test here, and neither is what the model says.

**The cache**, because it is a product decision with a cost: one strong-tier
call per child per day, and a stale read served rather than an error when a
refresh fails.

**The evidence**, because the first version handed the model the internal
documents and the model quoted them back. A teacher read "יש שלושה יעדים
פתוחים במצב working" and "0 ימי חוסר פעילות עם last_event_at" — a field name
in a sentence about a child. That is the same defect the evidence disclosures
were rewritten to remove, arriving by a different door.
"""

from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import learner_read


def run(coro):
    return asyncio.run(coro)


class TestFreshness:
    def test_a_read_from_an_hour_ago_is_fresh(self):
        at = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        assert learner_read.is_fresh({"generated_at": at}) is True

    def test_a_read_from_yesterday_is_not(self):
        at = (datetime.now(timezone.utc)
              - timedelta(hours=learner_read.TTL_HOURS + 1)).isoformat()
        assert learner_read.is_fresh({"generated_at": at}) is False

    def test_no_row_and_no_timestamp_are_both_stale(self):
        assert learner_read.is_fresh(None) is False
        assert learner_read.is_fresh({}) is False
        assert learner_read.is_fresh({"generated_at": "not a date"}) is False

    def test_the_cache_key_separates_languages(self):
        # The read is prose. A Hebrew one is not an English one.
        assert learner_read.read_id("kid", "he") != learner_read.read_id("kid", "en")


class TestFlattening:
    """No structure reaches the prompt as its own `repr`."""

    def test_challenges_become_their_labels(self):
        assert learner_read._labels([
            {"label": "לשמור על מוטיבציה", "status": "working"},
            {"label": "לחבר את הלמידה לחיים", "status": "working"},
        ]) == ["לשמור על מוטיבציה", "לחבר את הלמידה לחיים"]

    def test_a_status_never_survives(self):
        flattened = " ".join(learner_read._labels([{"label": "x", "status": "working"}]))
        assert "working" not in flattened

    def test_plain_strings_pass_through(self):
        assert learner_read._labels(["a", "b"]) == ["a", "b"]

    def test_empty_and_unlabelled_entries_are_dropped(self):
        assert learner_read._labels([{"status": "working"}, {"label": "  "}, None]) == []

    def test_the_description_document_becomes_its_sentences(self):
        lines = learner_read._description({
            "blocks": {
                "learning_preferences": [
                    {"text": "נוח לו/ה עם דוגמה קודם.",
                     "evidence": ["stated_by_learner"],
                     "valid_at": "2026-07-28T14:08:41.5"},
                ],
                "motivation": [{"text": "מתחבר/ת למשימות קצרות."}],
            },
        })
        assert lines == ["נוח לו/ה עם דוגמה קודם.", "מתחבר/ת למשימות קצרות."]
        joined = " ".join(lines)
        assert "valid_at" not in joined and "stated_by_learner" not in joined

    def test_a_plain_string_description_is_kept(self):
        assert learner_read._description("כותב/ת לאט") == ["כותב/ת לאט"]
        assert learner_read._description("") == []
        assert learner_read._description(None) == []


class TestClean:
    def test_a_model_that_said_nothing_is_not_cached_as_a_finding(self):
        # "No difficulties" and "the model returned an empty object" are
        # different claims, and a teacher cannot tell them apart on screen.
        assert learner_read._clean({}) is None
        assert learner_read._clean({"difficulties": [], "improvements": [],
                                    "involvement": "", "suggestion": ""}) is None

    def test_an_empty_improvements_list_beside_real_content_is_kept(self):
        read = learner_read._clean({
            "difficulties": ["5 שגיאות ברצף"], "improvements": [],
            "involvement": "פעיל/ה", "suggestion": "לחזור על השברים",
        })
        assert read is not None
        assert read["improvements"] == []

    def test_lists_are_bounded(self):
        read = learner_read._clean({
            "difficulties": [f"point {index}" for index in range(20)],
            "involvement": "x" * 900,
        })
        assert len(read["difficulties"]) == learner_read.MAX_POINTS
        assert len(read["involvement"]) <= learner_read.MAX_POINT_CHARS

    def test_a_non_dict_is_refused(self):
        assert learner_read._clean(["difficulties"]) is None
        assert learner_read._clean(None) is None


class TestServingStale:
    """A failed refresh must not take away the reading from this morning."""

    def _row(self, hours_old: int):
        at = (datetime.now(timezone.utc) - timedelta(hours=hours_old)).isoformat()
        return {"_id": "kid:he", "read": {"difficulties": ["ישן אבל אמיתי"],
                                          "improvements": [], "involvement": "",
                                          "suggestion": ""},
                "generated_at": at}

    def _with_cache(self, row, generate):
        class _Handle:
            async def find_one(self, _query):
                return row

            async def update_one(self, *args, **kwargs):
                return None

        return patch.object(learner_read, "_collection", lambda: _Handle()), \
            patch.object(learner_read, "generate", generate)

    def test_a_fresh_row_costs_no_call(self):
        async def boom(*args, **kwargs):
            raise AssertionError("a fresh read must not call the model")

        cache, generate = self._with_cache(self._row(1), boom)
        with cache, generate:
            read = run(learner_read.get("kid", "teacher", language="he"))
        assert read["cached"] is True
        assert read["difficulties"] == ["ישן אבל אמיתי"]

    def test_refresh_forces_a_call_even_when_fresh(self):
        async def fresh(*args, **kwargs):
            return {"difficulties": ["חדש"], "improvements": [],
                    "involvement": "", "suggestion": ""}

        cache, generate = self._with_cache(self._row(1), fresh)
        with cache, generate:
            read = run(learner_read.get("kid", "teacher", language="he", refresh=True))
        assert read["cached"] is False
        assert read["difficulties"] == ["חדש"]

    def test_a_failed_refresh_serves_the_old_one_and_says_so(self):
        async def broken(*args, **kwargs):
            raise learner_read.LearnerReadError("no_read")

        cache, generate = self._with_cache(self._row(48), broken)
        with cache, generate:
            read = run(learner_read.get("kid", "teacher", language="he"))
        assert read["stale"] is True
        assert read["difficulties"] == ["ישן אבל אמיתי"]

    def test_a_failure_with_nothing_cached_raises(self):
        async def broken(*args, **kwargs):
            raise learner_read.LearnerReadError("no_read")

        cache, generate = self._with_cache(None, broken)
        with cache, generate, pytest.raises(learner_read.LearnerReadError):
            run(learner_read.get("kid", "teacher", language="he"))
