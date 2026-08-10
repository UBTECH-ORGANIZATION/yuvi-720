"""Characterization of the trigger pub/sub, written BEFORE the bus was extracted.

`triggers.py` carries several hard-won fixes — the fired-watchdog bug that once
produced 46 identical nudges in one abandoned tab, the per-question dedupe, the
priority/cooldown ladder. Pulling the queue plumbing out into `realtime.py` must
not disturb any of it.

So this file pins the *observable* behaviour of publish/subscribe as it was
before the extraction: fanout to every subscriber, isolation between learners,
heartbeats on silence, and cleanup on disconnect. It is deliberately written
against `triggers`' own API — if the delegation to `realtime` ever changes what
a learner's SSE connection sees, this fails, regardless of how the inside is
arranged.
"""

from __future__ import annotations

import asyncio
import unittest

from app.services import triggers


class _Stream:
    """One open SSE connection, consumed in the background.

    An async generator does not execute its body — and so does not register its
    queue — until the first `__anext__` is awaited. The route consumes it with
    `async for`, so the test does too; anything else tests a shape that never
    runs in production.
    """

    def __init__(self, learner_id: str, heartbeat: float = 20.0) -> None:
        self._agen = triggers.subscribe(learner_id, heartbeat=heartbeat)
        self.frames: list[dict] = []
        self._task = asyncio.create_task(self._run())

    async def _run(self) -> None:
        async for frame in self._agen:
            self.frames.append(frame)

    async def opened(self) -> "_Stream":
        await asyncio.sleep(0.05)      # let the queue register
        return self

    async def next(self, timeout: float = 1.0) -> dict:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while not self.frames:
            if loop.time() >= deadline:
                raise asyncio.TimeoutError("no frame arrived")
            await asyncio.sleep(0.01)
        return self.frames.pop(0)

    async def expect_silence(self, window: float = 0.2) -> None:
        await asyncio.sleep(window)
        assert not self.frames, f"expected silence, got {self.frames}"

    async def close(self) -> None:
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        await asyncio.sleep(0)          # let the generator's finally run


class TriggerBusContractTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # Only the dedupe/cooldown maps are reset here. Subscriber bookkeeping is
        # asserted through `subscriber_count`, never by reaching into the queue
        # map — that map is exactly what the extraction moves, and a test that
        # names it would only be pinning today's implementation.
        triggers._last_published.clear()
        triggers._last_screen_key.clear()

    async def test_a_subscriber_receives_what_is_published_to_its_learner(self):
        stream = await _Stream("kid-a").opened()

        triggers._publish("kid-a", {"type": "mistake", "objective_id": "OBJ.1"})
        frame = await stream.next()

        self.assertEqual(frame["type"], "mistake")
        self.assertEqual(frame["objective_id"], "OBJ.1")
        await stream.close()

    async def test_every_open_connection_for_one_learner_gets_the_frame(self):
        """A learner with two tabs open must see the nudge in both."""
        first = await _Stream("kid-a").opened()
        second = await _Stream("kid-a").opened()

        triggers._publish("kid-a", {"type": "idle"})

        self.assertEqual((await first.next())["type"], "idle")
        self.assertEqual((await second.next())["type"], "idle")
        await first.close()
        await second.close()

    async def test_learners_are_isolated(self):
        """The single most important property here: one child's nudge must never
        reach another child's stream."""
        mine = await _Stream("kid-a").opened()
        theirs = await _Stream("kid-b").opened()

        triggers._publish("kid-a", {"type": "success"})

        self.assertEqual((await mine.next())["type"], "success")
        await theirs.expect_silence()
        await mine.close()
        await theirs.close()

    async def test_silence_produces_a_heartbeat_not_a_closed_stream(self):
        stream = await _Stream("kid-a", heartbeat=0.05).opened()
        self.assertEqual(await stream.next(), {"type": "_heartbeat"})
        await stream.close()

    async def test_disconnecting_removes_the_queue(self):
        """A leaked queue is a slow memory leak and, worse, a dead subscriber that
        every future publish still walks."""
        stream = await _Stream("kid-cleanup").opened()
        self.assertEqual(triggers.subscriber_count("kid-cleanup"), 1)
        triggers._publish("kid-cleanup", {"type": "mistake"})
        await stream.next()

        await stream.close()
        self.assertEqual(triggers.subscriber_count("kid-cleanup"), 0)

    async def test_publishing_with_no_subscribers_is_silent(self):
        """Most publishes happen with nobody listening (the learner is offline).
        That must not raise — the ingest path would fail with it."""
        triggers._publish("nobody", {"type": "idle"})

    async def test_publish_still_stamps_the_cooldown_clock(self):
        """The cooldown ladder is keyed off publish time. If the extraction moved
        the fanout out without keeping this, every per-type cooldown silently
        stops working and the nudge spam returns."""
        self.assertFalse(triggers._on_cooldown("kid-a", "misconception"))
        triggers._publish("kid-a", {"type": "misconception"})
        self.assertTrue(triggers._on_cooldown("kid-a", "misconception"))

    async def test_screen_change_dedupes_and_clears_reaction_cooldowns(self):
        """Pins the two side effects `publish_screen_change` is relied on for."""
        stream = await _Stream("kid-a").opened()

        triggers._publish("kid-a", {"type": "mistake"})
        await stream.next()
        self.assertTrue(triggers._on_cooldown("kid-a", "mistake"))

        triggers.publish_screen_change("kid-a", "q-1", component_id="cmp-1")
        frame = await stream.next()
        self.assertEqual(frame["type"], "screen_change")
        self.assertEqual(frame["question_key"], "q-1")
        # A new question is a fresh reaction context.
        self.assertFalse(triggers._on_cooldown("kid-a", "mistake"))

        # The same screen again must not re-publish.
        triggers.publish_screen_change("kid-a", "q-1")
        await stream.expect_silence()

        await stream.close()


if __name__ == "__main__":
    unittest.main()
