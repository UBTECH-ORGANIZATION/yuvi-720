"""Privacy boundary tests for development-only Coach debug traces."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import coach_debug_trace  # noqa: E402


class CoachDebugTraceTests(unittest.TestCase):
    def setUp(self):
        self.previous_flag = os.environ.get("COACH_DEBUG_TRACE_ENABLED")

    def tearDown(self):
        if self.previous_flag is None:
            os.environ.pop("COACH_DEBUG_TRACE_ENABLED", None)
        else:
            os.environ["COACH_DEBUG_TRACE_ENABLED"] = self.previous_flag

    def test_trace_is_opt_in_and_contains_only_safe_step_metadata(self):
        steps: list[dict[str, str]] = []
        coach_debug_trace.append(steps, "get_calendar", "ok")
        coach_debug_trace.append(steps, "get_active_goals", "ok", "agent")
        coach_debug_trace.append(steps, "bad name / learner@example.com", "unexpected")
        self.assertEqual(steps, [
            {"name": "get_calendar", "status": "ok", "source": "system"},
            {"name": "get_active_goals", "status": "ok", "source": "agent"},
        ])

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "coach_debug_traces.json"
            with patch.object(coach_debug_trace, "_FALLBACK", path), patch.object(coach_debug_trace, "_get_collection_named", return_value=None):
                os.environ.pop("COACH_DEBUG_TRACE_ENABLED", None)
                asyncio.run(coach_debug_trace.record("exchange-1", steps))
                self.assertFalse(path.exists())

                os.environ["COACH_DEBUG_TRACE_ENABLED"] = "true"
                asyncio.run(coach_debug_trace.record("exchange-1", steps))
                stored = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(stored["exchange-1"]["steps"], steps)
                self.assertNotIn("learner_id", stored["exchange-1"])
                self.assertNotIn("arguments", stored["exchange-1"])

    def test_only_explicit_true_values_enable_trace_recording(self):
        for value in ("", "0", "false", "no", "off", "unexpected"):
            with self.subTest(value=value), patch.dict(
                os.environ, {"COACH_DEBUG_TRACE_ENABLED": value}
            ):
                self.assertFalse(coach_debug_trace.enabled())

        for value in ("1", "true", "yes", "on", "TRUE"):
            with self.subTest(value=value), patch.dict(
                os.environ, {"COACH_DEBUG_TRACE_ENABLED": value}
            ):
                self.assertTrue(coach_debug_trace.enabled())

    def test_read_marks_legacy_steps_as_system(self):
        document = coach_debug_trace._public_document({
            "steps": [{"name": "answer_guard", "status": "blocked"}],
            "created_at": "2026-08-23T00:00:00+00:00",
        })
        self.assertEqual(document["steps"], [{
            "name": "answer_guard", "status": "blocked", "source": "system",
        }])


if __name__ == "__main__":
    unittest.main()