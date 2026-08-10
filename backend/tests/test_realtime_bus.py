"""The generic bus: topics, fanout, heartbeats, cleanup, presence hooks.

`triggers` has its own characterization suite (`test_trigger_bus_contract.py`)
that pins the learner channel from the outside. This one covers what the bus
adds on top: multi-topic subscriptions and the first/last-subscriber hooks that
presence is built on.
"""

from __future__ import annotations

import asyncio
import unittest

from app.services import realtime


class _Stream:
    def __init__(self, *topics: str, heartbeat: float = 20.0) -> None:
        self._agen = realtime.subscribe(*topics, heartbeat=heartbeat)
        self.frames: list[dict] = []
        self._task = asyncio.create_task(self._run())

    async def _run(self) -> None:
        async for frame in self._agen:
            self.frames.append(frame)

    async def opened(self) -> "_Stream":
        await asyncio.sleep(0.05)
        return self

    async def next(self, timeout: float = 1.0) -> dict:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while not self.frames:
            if loop.time() >= deadline:
                raise asyncio.TimeoutError("no frame arrived")
            await asyncio.sleep(0.01)
        return self.frames.pop(0)

    async def close(self) -> None:
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        await asyncio.sleep(0)


class RealtimeBusTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        realtime.reset_for_tests()

    async def test_one_connection_merges_several_topics(self):
        """The whole reason topics exist: the learner page carries coach nudges
        and personal notifications on ONE EventSource, not two of the six a
        browser will give it."""
        stream = await _Stream("learner:kid", "user:kid").opened()

        realtime.publish("learner:kid", {"type": "idle"})
        realtime.publish("user:kid", {"type": "notification"})

        kinds = {(await stream.next())["type"], (await stream.next())["type"]}
        self.assertEqual(kinds, {"idle", "notification"})
        await stream.close()

    async def test_publish_reports_how_many_it_reached(self):
        stream = await _Stream("teacher:t1").opened()
        self.assertEqual(realtime.publish("teacher:t1", {"type": "alert"}), 1)
        self.assertEqual(realtime.publish("teacher:nobody", {"type": "alert"}), 0)
        await stream.close()

    async def test_topics_do_not_leak_into_each_other(self):
        mine = await _Stream("teacher:t1").opened()
        theirs = await _Stream("teacher:t2").opened()

        realtime.publish("teacher:t1", {"type": "alert"})

        self.assertEqual((await mine.next())["type"], "alert")
        await asyncio.sleep(0.15)
        self.assertEqual(theirs.frames, [])
        await mine.close()
        await theirs.close()

    async def test_hooks_fire_on_the_first_and_last_subscriber_only(self):
        """Presence depends on this precisely: a learner with two tabs is online
        once, and closing one tab must not make them offline."""
        opened: list[str] = []
        closed: list[str] = []
        realtime.on_subscribe(opened.append)
        realtime.on_unsubscribe(closed.append)

        first = await _Stream("learner:kid").opened()
        self.assertEqual(opened, ["learner:kid"])

        second = await _Stream("learner:kid").opened()
        self.assertEqual(opened, ["learner:kid"], "second tab must not re-open presence")

        await first.close()
        self.assertEqual(closed, [], "one tab left is still online")

        await second.close()
        self.assertEqual(closed, ["learner:kid"])

    async def test_a_failing_hook_cannot_break_a_stream(self):
        """A hook is a side effect on someone else's behalf. If presence throws,
        the learner still gets their nudges."""
        def explode(_topic: str) -> None:
            raise RuntimeError("presence is having a bad day")

        realtime.on_subscribe(explode)
        stream = await _Stream("learner:kid").opened()
        realtime.publish("learner:kid", {"type": "idle"})
        self.assertEqual((await stream.next())["type"], "idle")
        await stream.close()

    async def test_silence_yields_a_heartbeat(self):
        stream = await _Stream("teacher:t1", heartbeat=0.05).opened()
        self.assertEqual(await stream.next(), {"type": "_heartbeat"})
        await stream.close()

    async def test_closing_removes_every_topic_the_connection_held(self):
        stream = await _Stream("teacher:t1", "group:g1").opened()
        self.assertEqual(realtime.subscriber_count("teacher:t1"), 1)
        self.assertEqual(realtime.subscriber_count("group:g1"), 1)

        await stream.close()

        self.assertEqual(realtime.subscriber_count("teacher:t1"), 0)
        self.assertEqual(realtime.subscriber_count("group:g1"), 0)


if __name__ == "__main__":
    unittest.main()
