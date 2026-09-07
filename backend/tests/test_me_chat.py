"""The child's side of the teacher chat: which teachers, which of their
sub-groups include me, and which group a line was said to."""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import Response  # noqa: E402

from app.routes import me as me_routes  # noqa: E402
from app.services import direct_messages, org_repository  # noqa: E402


class MyTeachers(unittest.IsolatedAsyncioTestCase):
    async def test_each_teacher_carries_the_subgroups_that_include_me(self):
        subgroups = [
            {"_id": "sg-adv", "name": "מתקדמים", "learner_ids": ["moti", "dana"]},
            {"_id": "sg-other", "name": "אחרים", "learner_ids": ["dana"]},
        ]
        with patch.object(me_routes.org, "groups_for_learner", AsyncMock(return_value=["g1"])), \
                patch.object(org_repository, "get_group", AsyncMock(return_value={"name": "ז2", "subject": "math"})), \
                patch.object(org_repository, "list_teacher_links", AsyncMock(return_value=[{"teacher_id": "t1"}])), \
                patch.object(org_repository, "list_subgroups", AsyncMock(return_value=subgroups)), \
                patch.object(me_routes, "get_user_by_id", AsyncMock(side_effect=lambda uid: {
                    "t1": {"display_name": "Gal"}, "moti": {"display_name": "מוטי"}, "dana": {"display_name": "דנה"},
                }.get(uid))):
            out = await me_routes.my_teachers(Response(), session={"sub": "moti"})
        [teacher] = out["teachers"]
        self.assertEqual(teacher["display_name"], "Gal")
        self.assertEqual([g["name"] for g in teacher["groups"]], ["ז2"])
        [subgroup] = teacher["subgroups"]
        self.assertEqual((subgroup["subgroup_id"], subgroup["name"], subgroup["group_id"]), ("sg-adv", "מתקדמים", "g1"))
        self.assertEqual([m["display_name"] for m in subgroup["members"]], ["מוטי", "דנה"])


class MyMessages(unittest.IsolatedAsyncioTestCase):
    async def test_a_subgroup_line_says_which_group_it_was_said_to(self):
        rows = [
            {"_id": "m1", "sender": "teacher", "text": "שלום לכולם", "created_at": "2026-09-07T08:00:00Z",
             "read_at": None, "subgroup_id": "sg-adv", "broadcast_id": "b1"},
            {"_id": "m2", "sender": "learner", "text": "היי", "created_at": "2026-09-07T08:01:00Z", "read_at": None},
        ]
        lookups = AsyncMock(return_value={"_id": "sg-adv", "name": "מתקדמים"})
        with patch.object(direct_messages, "assert_pair", AsyncMock(return_value=None)), \
                patch.object(direct_messages, "list_thread", AsyncMock(return_value=rows)), \
                patch.object(org_repository, "get_subgroup", lookups):
            out = await me_routes.my_messages(Response(), teacher_id="t1", session={"sub": "moti"})
        first, second = out["messages"]
        self.assertEqual((first["subgroup_id"], first["subgroup_name"]), ("sg-adv", "מתקדמים"))
        self.assertNotIn("subgroup_id", second)
        self.assertNotIn("broadcast_id", first)


class ReadReceipts(unittest.IsolatedAsyncioTestCase):
    """The child reads a group as its own chat, so a receipt is scoped."""

    class Messages:
        def __init__(self):
            self.queries = []

        async def update_many(self, query, update):
            self.queries.append(query)
            return type("R", (), {"modified_count": 1})()

        async def count_documents(self, query):
            return 2

    class Conversations:
        def __init__(self):
            self.sets = []

        async def update_one(self, query, update):
            self.sets.append(update["$set"])

    async def test_scopes_reach_the_query_and_the_counter_is_recounted(self):
        messages, conversations = self.Messages(), self.Conversations()
        with patch.object(direct_messages, "_collection",
                          lambda name: messages if name == direct_messages.MESSAGES else conversations):
            await direct_messages.mark_read("t1", "moti", reader=direct_messages.SENDER_LEARNER, subgroup_id="sg-adv")
            await direct_messages.mark_read("t1", "moti", reader=direct_messages.SENDER_LEARNER, subgroup_id=None)
            await direct_messages.mark_read("t1", "moti", reader=direct_messages.SENDER_LEARNER)
        self.assertEqual(messages.queries[0]["subgroup_id"], "sg-adv")
        self.assertEqual(messages.queries[1]["subgroup_id"], {"$exists": False})
        self.assertNotIn("subgroup_id", messages.queries[2])
        # a scoped receipt recounts what is left; the whole-thread one zeroes
        self.assertEqual([row["unread_learner"] for row in conversations.sets], [2, 2, 0])

    async def test_the_route_maps_query_to_scope(self):
        seen = []

        async def fake_mark_read(teacher_id, learner_id, *, reader, subgroup_id=direct_messages.ALL):
            seen.append(subgroup_id)
            return 1

        with patch.object(direct_messages, "assert_pair", AsyncMock(return_value=None)), \
                patch.object(direct_messages, "mark_read", fake_mark_read):
            await me_routes.mark_my_messages_read(Response(), teacher_id="t1", scope="all", subgroup=None, session={"sub": "moti"})
            await me_routes.mark_my_messages_read(Response(), teacher_id="t1", scope="private", subgroup=None, session={"sub": "moti"})
            await me_routes.mark_my_messages_read(Response(), teacher_id="t1", scope="all", subgroup="sg-adv", session={"sub": "moti"})
        self.assertIs(seen[0], direct_messages.ALL)
        self.assertIsNone(seen[1])
        self.assertEqual(seen[2], "sg-adv")


class UnreadBadges(unittest.IsolatedAsyncioTestCase):
    async def test_the_learner_badge_splits_out_the_groups(self):
        class Agg:
            async def to_list(self, length):
                return [{"_id": "sg-adv", "count": 2}, {"_id": None, "count": 9}]

        class Messages:
            def aggregate(self, pipeline):
                return Agg()

        with patch.object(direct_messages, "_collection", lambda name: Messages()):
            self.assertEqual(await direct_messages.unread_subgroups_for_learner("moti"), {"sg-adv": 2})
        with patch.object(direct_messages, "unread_for_learner", AsyncMock(return_value={"t1": 3})), \
                patch.object(direct_messages, "unread_subgroups_for_learner", AsyncMock(return_value={"sg-adv": 2})):
            out = await me_routes.my_messages_unread(Response(), session={"sub": "moti"})
        self.assertEqual(out, {"unread": {"t1": 3}, "total": 3, "subgroups": {"sg-adv": 2}})


if __name__ == "__main__":
    unittest.main()
