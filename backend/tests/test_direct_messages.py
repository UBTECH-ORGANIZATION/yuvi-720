"""The screened teacher↔learner channel.

The properties worth testing are the ones the reference implementation got
wrong, so each class here names the failure it is standing in front of:

  * a moderation result that was computed and then discarded, so flagged
    messages were stored and delivered anyway;
  * a send path with no membership check at all;
  * moderation running before authorization, which tells a stranger which of
    their words were unacceptable on a conversation they cannot see.

Plus the one this product adds: a child writing that they want to die must be
refused delivery AND reach an adult.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import direct_messages as dm     # noqa: E402


class FakeCollection:
    """Enough Mongo to exercise the writes, and no more."""

    def __init__(self):
        self.rows: list[dict] = []
        self.updates: list[tuple[dict, dict, bool]] = []

    async def insert_one(self, document):
        self.rows.append(document)
        return MagicMock(inserted_id=document.get("_id"))

    async def update_one(self, query, update, upsert=False):
        self.updates.append((query, update, upsert))
        return MagicMock(modified_count=1)

    async def update_many(self, query, update):
        changed = 0
        for row in self.rows:
            if all(row.get(k) == v for k, v in query.items() if not isinstance(v, dict)):
                row.update(update["$set"])
                changed += 1
        return MagicMock(modified_count=changed)


class Harness(unittest.IsolatedAsyncioTestCase):
    """One pair, linked, with every collection captured."""

    def setUp(self):
        self.messages = FakeCollection()
        self.conversations = FakeCollection()
        self.moderation = FakeCollection()
        self.stores = {
            dm.MESSAGES: self.messages,
            dm.CONVERSATIONS: self.conversations,
            dm.MODERATION_EVENTS: self.moderation,
        }
        # The screen is two halves now, and the second one is a model. `None` is
        # what an unconfigured provider returns and the screen fails open on it,
        # so every test below is about the deterministic half — exactly what it
        # was before. `test_content_review.py` owns the other half.
        from app.services import content_review

        content_review.reset_cache()
        self.llm = patch("app.services.llm.call_llm", AsyncMock(return_value=None))
        self.llm.start()
        self.addCleanup(self.llm.stop)

    def _patches(self, *, linked=True):
        return [
            patch.object(dm, "_collection", side_effect=self.stores.get),
            patch("app.brain.org.teacher_can_access_learner",
                  AsyncMock(return_value=linked)),
            patch("app.brain.org.teachers_for_learner",
                  AsyncMock(return_value=["t-1"] if linked else [])),
            patch("app.services.notifications.notify", AsyncMock()),
            patch("app.services.realtime.publish", MagicMock()),
        ]

    async def send(self, text, *, sender=dm.SENDER_TEACHER, linked=True, extra=()):
        stack = self._patches(linked=linked) + list(extra)
        for item in stack:
            item.start()
        try:
            return await dm.send_message(
                sender=sender, teacher_id="t-1", learner_id="kid-1", text=text)
        finally:
            for item in reversed(stack):
                item.stop()


class ACleanMessage(Harness):
    async def test_is_stored_once_and_notified_once(self):
        with patch("app.services.notifications.notify", AsyncMock()) as notify, \
             patch.object(dm, "_collection", side_effect=self.stores.get), \
             patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=True)), \
             patch("app.services.realtime.publish", MagicMock()) as publish:
            record = await dm.send_message(
                sender=dm.SENDER_TEACHER, teacher_id="t-1", learner_id="kid-1",
                text="עבודה יפה בשאלה 3")

        self.assertEqual(len(self.messages.rows), 1)
        self.assertEqual(self.messages.rows[0]["text"], "עבודה יפה בשאלה 3")
        self.assertEqual(record["sender"], "teacher")
        notify.assert_awaited_once()
        publish.assert_called_once()

    async def test_the_notification_carries_no_words(self):
        # The whole notification lane stores keys and renders client-side. A
        # message body in a bell row would be readable from an inbox that never
        # re-checks the thread's membership.
        with patch("app.services.notifications.notify", AsyncMock()) as notify, \
             patch.object(dm, "_collection", side_effect=self.stores.get), \
             patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=True)), \
             patch("app.services.realtime.publish", MagicMock()):
            await dm.send_message(sender=dm.SENDER_TEACHER, teacher_id="t-1",
                                  learner_id="kid-1", text="סוד גדול מאוד")
        params = notify.await_args.kwargs.get("params") or {}
        self.assertNotIn("סוד גדול מאוד", str(params))
        self.assertEqual(params, {})

    async def test_the_conversation_row_tracks_the_unread_side(self):
        await self.send("שלום")
        query, update, upsert = self.conversations.updates[-1]
        self.assertTrue(upsert)
        self.assertEqual(query["_id"], "t-1:kid-1")
        # A teacher's message is unread by the LEARNER, never by the sender.
        self.assertEqual(update["$inc"], {"unread_learner": 1})
        self.assertEqual(update["$set"]["last_sender"], "teacher")

    async def test_pii_is_redacted_rather_than_the_message_refused(self):
        record = await self.send("תתקשר אלי 054-1234567 בבקשה")
        self.assertNotIn("1234567", record["text"])
        self.assertEqual(len(self.messages.rows), 1)


class AFlaggedMessage(Harness):
    async def test_is_refused_with_a_locale_key_and_never_stored(self):
        with self.assertRaises(dm.DirectMessageError) as caught:
            await self.send("יא בן זונה")
        self.assertEqual(caught.exception.status_code, 422)
        # A key, not a sentence: the reader has a language preference.
        self.assertEqual(caught.exception.code, dm.MODERATION_KEY)
        self.assertTrue(caught.exception.code.startswith("moderation."))
        # The property the reference lost: nothing is written and nothing
        # delivers.
        self.assertEqual(self.messages.rows, [])
        self.assertEqual(self.conversations.updates, [])

    async def test_leaves_exactly_one_audit_row(self):
        with self.assertRaises(dm.DirectMessageError):
            await self.send("you are a fucking idiot")
        self.assertEqual(len(self.moderation.rows), 1)
        row = self.moderation.rows[0]
        self.assertEqual(row["action_taken"], "blocked")
        self.assertEqual(row["context"], "direct_message")
        self.assertEqual(row["category"], "profanity")
        # The author, so a reviewer knows who to talk to.
        self.assertEqual(row["user_id"], "t-1")
        self.assertIn("fucking", row["content"])

    async def test_the_audit_row_is_capped(self):
        # Long enough to exceed the audit cap, short enough that the length
        # guard does not fire first — the row must be evidence, not a transcript.
        long_message = "fuck " * 150
        self.assertLess(len(long_message), dm.MAX_MESSAGE)
        with self.assertRaises(dm.DirectMessageError):
            await self.send(long_message)
        self.assertLessEqual(len(self.moderation.rows[0]["content"]), 500)

    async def test_an_empty_message_is_refused_before_anything_else(self):
        for text in ["", "   "]:
            with self.assertRaises(dm.DirectMessageError) as caught:
                await self.send(text)
            self.assertEqual(caught.exception.code, "message_required")
        self.assertEqual(self.messages.rows, [])

    async def test_an_overlong_message_is_refused(self):
        with self.assertRaises(dm.DirectMessageError) as caught:
            await self.send("א" * (dm.MAX_MESSAGE + 1))
        self.assertEqual(caught.exception.code, "message_too_long")


class ACryForHelp(Harness):
    async def test_is_denied_delivery_and_still_reaches_a_teacher(self):
        flag = AsyncMock()
        with patch("app.agents.safety.record_wellbeing_flag", flag):
            with self.assertRaises(dm.DirectMessageError) as caught:
                await self.send("אני רוצה למות", sender=dm.SENDER_LEARNER)

        # The message does not travel.
        self.assertEqual(self.messages.rows, [])
        self.assertEqual(caught.exception.status_code, 422)
        # The distress does — through the urgent alert lane this app already has.
        flag.assert_awaited_once()
        self.assertEqual(flag.await_args.args[0], "kid-1")
        self.assertEqual(flag.await_args.kwargs["category"], "distress")
        self.assertEqual(flag.await_args.kwargs["source"], "direct_message")
        # And the child is answered gently, not with the generic telling-off.
        self.assertEqual(caught.exception.code, dm.MODERATION_KEY_DISTRESS)

    async def test_a_teacher_writing_the_same_words_does_not_raise_a_flag(self):
        # The alert means "a child needs an adult". Raising it on a teacher's
        # message would file the alert against the wrong person entirely.
        flag = AsyncMock()
        with patch("app.agents.safety.record_wellbeing_flag", flag):
            with self.assertRaises(dm.DirectMessageError):
                await self.send("i want to die", sender=dm.SENDER_TEACHER)
        flag.assert_not_awaited()
        self.assertEqual(self.messages.rows, [])


class Membership(Harness):
    async def test_an_unlinked_teacher_is_refused_before_moderation_runs(self):
        # 403 for not being their teacher — not 422 with a critique of their
        # words on a conversation they may not see.
        check = MagicMock(wraps=dm.content_filter.check_content)
        with patch.object(dm.content_filter, "check_content", check):
            with self.assertRaises(dm.DirectMessageError) as caught:
                await self.send("fuck you", linked=False)
        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(caught.exception.code, "not_authorized")
        check.assert_not_called()
        self.assertEqual(self.messages.rows, [])
        self.assertEqual(self.moderation.rows, [])

    async def test_a_learner_may_only_write_to_their_own_teachers(self):
        with self.assertRaises(dm.DirectMessageError) as caught:
            await self.send("שלום", sender=dm.SENDER_LEARNER, linked=False)
        self.assertEqual(caught.exception.status_code, 403)

    async def test_the_learner_lane_reads_the_link_the_other_way(self):
        # A learner's permission is "is this one of my teachers", not the
        # teacher-side call — which would answer a different question and
        # happens to be the one the reference never asked at all.
        teacher_side = AsyncMock(return_value=False)
        learner_side = AsyncMock(return_value=["t-1"])
        with patch("app.brain.org.teacher_can_access_learner", teacher_side), \
             patch("app.brain.org.teachers_for_learner", learner_side):
            await dm.assert_pair("t-1", "kid-1", sender=dm.SENDER_LEARNER)
        learner_side.assert_awaited_once()
        teacher_side.assert_not_awaited()

    async def test_an_unknown_sender_role_cannot_write(self):
        with self.assertRaises(dm.DirectMessageError) as caught:
            await self.send("שלום", sender="parent")
        self.assertEqual(caught.exception.code, "unknown_sender")
        self.assertEqual(self.messages.rows, [])


class TheThread(Harness):
    async def test_the_conversation_id_is_deterministic_and_role_typed(self):
        self.assertEqual(dm.conversation_id("t-1", "kid-1"), "t-1:kid-1")
        # Not symmetric: the pair is typed, so arguments in the wrong order
        # produce a different thread rather than silently the same one.
        self.assertNotEqual(dm.conversation_id("t-1", "kid-1"),
                            dm.conversation_id("kid-1", "t-1"))

    async def test_messages_come_back_oldest_first(self):
        rows = [
            {"_id": "c", "created_at": "2026-08-03"},
            {"_id": "b", "created_at": "2026-08-02"},
            {"_id": "a", "created_at": "2026-08-01"},
        ]

        class Cursor:
            def sort(self, *a, **k): return self
            def limit(self, *a, **k): return self
            async def to_list(self, length=None): return rows

        collection = MagicMock()
        collection.find = MagicMock(return_value=Cursor())
        with patch.object(dm, "_collection", return_value=collection):
            thread = await dm.list_thread("t-1", "kid-1")
        self.assertEqual([row["_id"] for row in thread], ["a", "b", "c"])

    async def test_marking_read_only_touches_the_other_side(self):
        self.messages.rows = [
            {"_id": "m1", "conversation_id": "t-1:kid-1", "sender": "learner", "read_at": None},
            {"_id": "m2", "conversation_id": "t-1:kid-1", "sender": "teacher", "read_at": None},
        ]
        with patch.object(dm, "_collection", side_effect=self.stores.get):
            changed = await dm.mark_read("t-1", "kid-1", reader=dm.SENDER_TEACHER)
        self.assertEqual(changed, 1)
        self.assertIsNotNone(self.messages.rows[0]["read_at"])
        # Reading your own outbox does not mark it read.
        self.assertIsNone(self.messages.rows[1]["read_at"])

    async def test_marking_read_rejects_an_unknown_reader(self):
        with self.assertRaises(dm.DirectMessageError):
            await dm.mark_read("t-1", "kid-1", reader="parent")


class Routes(unittest.IsolatedAsyncioTestCase):
    async def test_the_teacher_send_route_maps_the_status_the_service_chose(self):
        from app.routes import teacher_students as routes

        for code, status in ((dm.MODERATION_KEY, 422), ("not_authorized", 403)):
            with patch("app.services.direct_messages.send_message",
                       AsyncMock(side_effect=dm.DirectMessageError(code, status))):
                response = await routes.send_message(
                    "kid-1", {"text": "x"}, session={"sub": "t-1"})
            self.assertEqual(response.status_code, status)
            import json
            body = json.loads(response.body)
            # A STRING detail is how the client tells a moderation refusal from
            # FastAPI's own 422, whose detail is an array of field errors.
            self.assertIsInstance(body["detail"], str)
            self.assertEqual(body["detail"], code)

    async def test_reading_a_thread_is_guarded(self):
        from app.routes import teacher_students as routes

        with patch.object(routes, "_guard_learner", AsyncMock(return_value=None)), \
             patch("app.services.direct_messages.list_thread", AsyncMock()) as read:
            response = await routes.list_messages("kid-1", session={"sub": "t-1"})
        self.assertEqual(response.status_code, 403)
        read.assert_not_awaited()

    async def test_the_learner_lane_never_takes_a_learner_id(self):
        # The only id in those paths is the teacher being written to; the child
        # is the session. A learner_id parameter is how one child reads another.
        import inspect
        from app.routes import me

        for handler in (me.my_messages, me.send_my_message, me.mark_my_messages_read):
            names = set(inspect.signature(handler).parameters)
            self.assertNotIn("learner_id", names, handler.__name__)
            self.assertIn("teacher_id", names, handler.__name__)


if __name__ == "__main__":
    unittest.main()
