"""Idle nudges must respect the CHAT, not only the content iframe.

Live symptom: a learner mid-conversation with Yuvi ("אני כאן איתך, ואם משהו
תקוע…") was nudged for being idle while they were plainly working — the
watchdog only ever watched xAPI, so typing, taking a hint or reading a reply
counted as silence.
"""

from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch

from app.services import triggers


class IdleChatActivityTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        triggers._last_published.clear()
        triggers._last_chat_activity.clear()
        for handle in list(triggers._idle_handles.values()):
            handle.cancel()
        triggers._idle_handles.clear()
        triggers._idle_objective.clear()

    def tearDown(self) -> None:
        self.setUp()

    async def test_recent_chat_suppresses_the_nudge(self) -> None:
        published: list[dict] = []
        with patch("app.services.triggers._publish",
                   side_effect=lambda lid, t: published.append(t)):
            triggers.note_chat_activity("L")
            triggers.publish_idle("L", "obj-1")
        self.assertEqual(published, [])

    async def test_suppressed_tick_re_arms_for_the_remaining_silence(self) -> None:
        """Swallowing the tick would mean no nudge at all for the rest of the
        lesson — the learner who goes quiet right after chatting is exactly the
        one worth checking on, just later."""
        with patch("app.services.triggers._publish"):
            triggers.note_chat_activity("L")
            triggers.publish_idle("L", "obj-1")
        self.assertIn("L", triggers._idle_handles)
        self.assertEqual(triggers._idle_objective["L"], "obj-1")

    async def test_silence_after_chat_still_nudges(self) -> None:
        published: list[dict] = []
        with patch("app.services.triggers._publish",
                   side_effect=lambda lid, t: published.append(t)):
            triggers.note_chat_activity("L")
            # As if the chat turn were a full idle stretch ago.
            triggers._last_chat_activity["L"] -= triggers.IDLE_SECONDS + 1
            triggers.publish_idle("L", "obj-1")
        self.assertEqual([t["type"] for t in published], ["idle"])

    async def test_chat_resets_a_running_watchdog(self) -> None:
        loop = asyncio.get_running_loop()
        triggers._arm_idle("L", "obj-1")
        first = triggers._idle_handles["L"]
        first_at = first.when()
        # A later chat turn must push the deadline out, not leave the old one.
        with patch.object(loop, "time", return_value=loop.time() + 5):
            triggers.note_chat_activity("L")
        self.assertGreater(triggers._idle_handles["L"].when(), first_at)
        self.assertTrue(first.cancelled())

    async def test_a_nudge_does_not_reschedule_itself(self) -> None:
        """The live regression: the idle nudge streams from /coach/proactive,
        which reports a chat turn — and that re-armed the very watchdog that had
        just fired. An abandoned tab collected 46 identical nudges, one every
        152s, for two and a half hours."""
        triggers._arm_idle("L", "obj-1")
        with patch("app.services.triggers._publish"):
            triggers.publish_idle("L", "obj-1")              # the timer fires
        triggers.note_chat_activity("L", by_learner=False)   # Yuvi speaks the nudge
        self.assertNotIn("L", triggers._idle_handles)

    async def test_a_spent_watchdog_is_not_revived_by_the_learner_either(self) -> None:
        """Only a real event re-arms. A learner turn resets a RUNNING watchdog;
        it does not resurrect one that already fired."""
        triggers._arm_idle("L", "obj-1")
        with patch("app.services.triggers._publish"):
            triggers.publish_idle("L", "obj-1")
        triggers.note_chat_activity("L")
        self.assertNotIn("L", triggers._idle_handles)

    async def test_chat_never_arms_a_watchdog_of_its_own(self) -> None:
        """Idle belongs to an open lesson. Arming from chat would nag learners
        talking to Yuvi on the dashboard, where there is no screen to be stuck
        on."""
        triggers.note_chat_activity("L")
        self.assertNotIn("L", triggers._idle_handles)


if __name__ == "__main__":
    unittest.main()
