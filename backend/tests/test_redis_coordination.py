"""What lets a slot run more than one instance: the bus bridge, a shared
fold lock, an atomic alert counter, and a shared rate window.

All driven through the in-memory backend, which has the same shape as the
Redis one; the bridge is exercised by handing it frames the way the Redis
listener would.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core import cache as cache_config  # noqa: E402
from app.services import cache_store, realtime, teacher_alerts  # noqa: E402


def _env(**values):
    return mock.patch.dict(os.environ, {"SPARK_ENVIRONMENT": "test", "SPARK_CACHE": "memory", **values})


class Coordination(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        cache_config.reset_verification_cache()
        self._env = _env()
        self._env.start()
        for key in ("REDIS_CONNECTION_STRING",):
            os.environ.pop(key, None)
        await cache_store.reset()
        realtime.reset_for_tests()

    async def asyncTearDown(self):
        await cache_store.reset()
        realtime.reset_for_tests()
        self._env.stop()

    async def test_the_lock_serialises_the_same_name_and_not_others(self):
        order: list[str] = []

        async def work(name: str, label: str, hold: float):
            async with cache_store.lock(name, wait_s=2):
                order.append(f"{label}:in")
                await asyncio.sleep(hold)
                order.append(f"{label}:out")

        await asyncio.gather(work("fold:moti", "a", 0.05), work("fold:moti", "b", 0.0), work("fold:gal", "c", 0.0))
        # a and b never overlap; c ran freely alongside a
        self.assertLess(order.index("a:out"), order.index("b:in"))
        self.assertLess(order.index("c:in"), order.index("a:out"))

    async def test_the_lock_runs_the_body_when_there_is_no_store(self):
        with _env(SPARK_CACHE="off"):
            await cache_store.reset()
            ran = False
            async with cache_store.lock("anything"):
                ran = True
            self.assertTrue(ran)

    async def test_the_counter_is_seeded_once_and_then_monotonic(self):
        self.assertEqual(await cache_store.counter_next("alerts:t1", seed=41), 42)
        self.assertEqual(await cache_store.counter_next("alerts:t1", seed=5), 43)
        self.assertEqual(await cache_store.counter_get("alerts:t1"), 43)
        self.assertIsNone(await cache_store.counter_get("alerts:nobody"))

    async def test_alert_sequences_come_from_the_shared_counter(self):
        teacher_alerts._seq.clear()
        teacher_alerts._memory.clear()
        with mock.patch.object(teacher_alerts, "_collection", return_value=None):
            first = await teacher_alerts._next_seq("t1")
            second = await teacher_alerts._next_seq("t1")
            self.assertEqual((first, second), (1, 2))
            # another instance that never saw t1 seeds from storage (0) and
            # still gets the next number, not a duplicate
            teacher_alerts._seq.clear()
            self.assertEqual(await teacher_alerts._next_seq("t1"), 3)
            self.assertEqual(await teacher_alerts.latest_seq("t1"), 3)

    async def test_the_rate_window_counts_across_callers(self):
        counts = [await cache_store.rate_hit("support:1.2.3.4", 600) for _ in range(6)]
        self.assertEqual(counts, [1, 2, 3, 4, 5, 6])
        with _env(SPARK_CACHE="off"):
            await cache_store.reset()
            self.assertIsNone(await cache_store.rate_hit("support:1.2.3.4", 600))


class TheBusBridge(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        realtime.reset_for_tests()

    async def asyncTearDown(self):
        realtime.reset_for_tests()
        realtime._bridge.active = False

    async def _first_frame(self, gen):
        return await asyncio.wait_for(gen.__anext__(), timeout=1)

    async def test_a_frame_from_another_instance_reaches_local_subscribers(self):
        stream = realtime.subscribe("teacher:t1", heartbeat=5)
        await asyncio.sleep(0)  # let the generator attach
        task = asyncio.create_task(self._first_frame(stream))
        await asyncio.sleep(0)
        delivered = realtime._bridge.on_message(json.dumps({"o": "other-instance", "t": "teacher:t1", "e": {"type": "alert", "seq": 7}}))
        self.assertEqual(delivered, 1)
        self.assertEqual(await task, {"type": "alert", "seq": 7})
        await stream.aclose()

    async def test_an_instance_never_redelivers_its_own_frames(self):
        stream = realtime.subscribe("learner:moti", heartbeat=5)
        await asyncio.sleep(0)
        delivered = realtime._bridge.on_message(json.dumps({"o": realtime._ORIGIN, "t": "learner:moti", "e": {"type": "idle"}}))
        self.assertEqual(delivered, 0)
        self.assertEqual(realtime._bridge.on_message("not json"), 0)
        await stream.aclose()

    async def test_publish_relays_only_when_the_bridge_is_up(self):
        with mock.patch.object(realtime._bridge, "relay") as relay:
            realtime._bridge.active = False
            realtime.publish("group:g1", {"type": "x"})
            relay.assert_not_called()
            realtime._bridge.active = True
            realtime.publish("group:g1", {"type": "x"})
            relay.assert_called_once_with("group:g1", {"type": "x"})

    async def test_without_redis_the_bridge_does_not_start(self):
        with _env(SPARK_CACHE="memory"):
            cache_config.reset_verification_cache()
            await cache_store.reset()
            self.assertFalse(await realtime.start_bridge())
            self.assertFalse(realtime.bridge_active())


if __name__ == "__main__":
    unittest.main()
