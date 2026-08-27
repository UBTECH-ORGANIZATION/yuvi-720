"""Durable signal episodes (PBI 451): recorded once, on the trigger path only.

    python -m pytest tests/test_learner_signals.py -q

The detectors fired and vanished; these tests pin the two properties that make
the persisted trail honest: a firing is written exactly once (replays and
restarts included), and only the ingest/trigger path writes — the read paths
that re-run detectors per page view must never record a "firing".
"""

from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import learner_signals, triggers

BACKEND = Path(__file__).resolve().parents[1]


class SignalStoreTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        # Deterministic JSON-fallback path: no database, a private file. The
        # Mongo path is the same logic behind the same guards.
        self._patches = [
            patch.object(learner_signals, "_FALLBACK",
                         BACKEND / ".runtime" / (self._testMethodName + ".signals.json")),
            patch.object(learner_signals, "_get_collection_named", lambda name: None),
        ]
        for item in self._patches:
            item.start()
        learner_signals._FALLBACK.unlink(missing_ok=True)

    def tearDown(self) -> None:
        learner_signals._FALLBACK.unlink(missing_ok=True)
        for item in self._patches:
            item.stop()

    async def test_record_and_recent_round_trip(self) -> None:
        await learner_signals.record("kid", "idle", meta={"idle_seconds": 150})
        await learner_signals.record("kid", "recovery", objective_id="MATH-1")
        await learner_signals.record("other", "idle")
        rows = await learner_signals.recent("kid", since="2000-01-01")
        self.assertEqual({r["kind"] for r in rows}, {"idle", "recovery"})
        only = await learner_signals.recent("kid", since="2000-01-01", kinds={"idle"})
        self.assertEqual([r["kind"] for r in only], ["idle"])

    async def test_an_unknown_kind_is_refused(self) -> None:
        await learner_signals.record("kid", "invented")
        self.assertEqual(await learner_signals.recent("kid", since="2000-01-01"), [])

    async def test_a_dedupe_key_makes_the_write_once_only(self) -> None:
        for _ in range(3):
            await learner_signals.record("kid", "recovery", dedupe_key="recovery:evt-1")
        rows = await learner_signals.recent("kid", since="2000-01-01")
        self.assertEqual(len(rows), 1)

    async def test_since_is_a_lower_bound(self) -> None:
        await learner_signals.record("kid", "idle")
        far_future = "2999-01-01"
        self.assertEqual(await learner_signals.recent("kid", since=far_future), [])


class IdlePersistenceTests(unittest.IsolatedAsyncioTestCase):
    """`publish_idle` writes one row per genuine firing — and none for the
    early returns (cooldown, chat re-arm), which are not idle episodes."""

    def setUp(self) -> None:
        triggers._last_published.clear()
        triggers._last_chat_activity.clear()
        for handle in list(triggers._idle_handles.values()):
            handle.cancel()
        triggers._idle_handles.clear()
        triggers._idle_objective.clear()

    tearDown = setUp

    async def _fired_records(self, prepare) -> list[tuple]:
        recorded: list[tuple] = []

        async def capture(learner_id, kind, **kwargs):
            recorded.append((learner_id, kind, kwargs))

        with patch("app.services.triggers._publish"), \
                patch("app.services.learner_signals.record", side_effect=capture), \
                patch("app.services.presence.note_struggle"):
            prepare()
            triggers.publish_idle("L", "obj-1")
            await asyncio.sleep(0)  # let the fire-and-forget task run
        return recorded

    async def test_a_genuine_firing_writes_one_idle_row(self) -> None:
        recorded = await self._fired_records(lambda: None)
        self.assertEqual(len(recorded), 1)
        learner, kind, kwargs = recorded[0]
        self.assertEqual((learner, kind), ("L", "idle"))
        self.assertEqual(kwargs["meta"]["idle_seconds"], triggers.IDLE_SECONDS)

    async def test_the_chat_rearm_return_writes_nothing(self) -> None:
        recorded = await self._fired_records(lambda: triggers.note_chat_activity("L"))
        self.assertEqual(recorded, [])

    async def test_the_cooldown_return_writes_nothing(self) -> None:
        def on_cooldown():
            import time
            triggers._last_published[("L", "idle")] = time.monotonic()

        recorded = await self._fired_records(on_cooldown)
        self.assertEqual(recorded, [])


class WritePathInvariant(unittest.TestCase):
    """Only the trigger path records firings. The read paths re-run detectors
    on every page view; a `record` there would count views, not behaviour."""

    def test_read_paths_never_record_signals(self) -> None:
        for reader in ("moments.py", "insights.py"):
            source = (BACKEND / "app" / "services" / reader).read_text(encoding="utf-8")
            self.assertNotIn("learner_signals", source,
                             f"{reader} must not write signal episodes")


if __name__ == "__main__":
    unittest.main()
