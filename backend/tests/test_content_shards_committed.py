"""The shards actually committed in content/context/ keep every promise.

The nightly's PR runs CI like any other, so this is the last gate before an
auto-merge: whatever the pipeline wrote must validate, carry no answer-bearing
key, use only capture formats the runtime reads, count its captures honestly,
state no answer, and stay small enough to load per process. Same checks as
scripts/content_guard.py's invariants — over the real files, not fixtures.
"""

from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import content_intelligence as ci  # noqa: E402
from scripts import content_guard as guard  # noqa: E402

CONTEXT = Path(__file__).resolve().parents[2] / "content" / "context"


class TheCommittedShards(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shards = guard.load_dir(CONTEXT) if CONTEXT.is_dir() else {}

    def setUp(self):
        if not self.shards:
            self.skipTest("no committed shards in this checkout")

    def test_every_invariant_holds(self):
        self.assertEqual(guard.invariants(self.shards), [])

    def test_the_serializer_would_write_them_unchanged(self):
        for path in ci.shard_paths(CONTEXT):
            with self.subTest(path=path.name):
                raw = path.read_text(encoding="utf-8")
                self.assertEqual(ci.dump_shard(json.loads(raw)), raw)

    def test_the_index_lists_every_shard(self):
        index = json.loads((CONTEXT / "index.json").read_text(encoding="utf-8"))
        listed = {entry["path"] for entry in index.get("shards") or []}
        self.assertEqual(listed, set(self.shards))

    def test_browse_state_is_day_granular(self):
        index = json.loads((CONTEXT / "index.json").read_text(encoding="utf-8"))
        for cid, entry in (index.get("browse_state") or {}).items():
            for key in ("last_attempt", "next_after"):
                if key in entry:
                    self.assertRegex(entry[key], r"^\d{4}-\d{2}-\d{2}$", cid)


if __name__ == "__main__":
    unittest.main()
