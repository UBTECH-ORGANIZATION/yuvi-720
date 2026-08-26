"""Phase 9 — every collection the teacher lane added is indexed at boot.

A missing index never raises. It just makes a query slower every time the roster
grows, so the failure mode is a product that feels fine in a demo and unusable
in a school. The only way to catch it is to assert the wiring.

Two invariants, and the second is the one that actually decays:

1. Every module that exposes `ensure_indexes()` is called from the lifespan.
2. Every collection the smoke check *requires* an index on has a module wired to
   create it — so adding a collection to one list without the other fails here
   rather than in production six months later.
"""

from __future__ import annotations

import ast
import re
import sys
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


def _lifespan_index_steps() -> set[str]:
    """The labels in server.py's `index_steps` tuple, read from the source.

    Parsed rather than imported: importing `server` builds the whole app, and
    this test is about the wiring being present, not about it running.
    """
    source = (BACKEND / "server.py").read_text(encoding="utf-8")
    block = re.search(r"index_steps = \((.*?)\n    \)", source, re.S)
    assert block, "index_steps tuple not found in server.py"
    return set(re.findall(r'\("([a-z_]+)",', block.group(1)))


def _modules_exposing_ensure_indexes() -> set[str]:
    """Every module under app/ with a module-level `async def ensure_indexes`."""
    found = set()
    for path in (BACKEND / "app").rglob("*.py"):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:      # pragma: no cover
            continue
        for node in tree.body:   # module level only — `_ensure_indexes` helpers
            if isinstance(node, ast.AsyncFunctionDef) and node.name == "ensure_indexes":
                found.add(path.stem)
    return found


class IndexBootstrap(unittest.TestCase):
    def test_every_public_ensure_indexes_is_called_at_boot(self):
        """A module that creates indexes nobody calls is worse than no module."""
        modules = _modules_exposing_ensure_indexes()
        self.assertTrue(modules, "expected at least one ensure_indexes module")

        source = (BACKEND / "server.py").read_text(encoding="utf-8")
        for module in sorted(modules):
            self.assertIn(
                f"{module}.ensure_indexes", source,
                f"{module}.ensure_indexes() exists but the lifespan never calls it")

    def test_a_failing_step_does_not_skip_the_ones_after_it(self):
        """One shared `except` meant the first failure skipped all the rest.

        Behavioural, not a source-shape check: an earlier version of this test
        asserted on the text of the loop and passed happily when the loop was
        collapsed back into a single try block. Making a step actually raise is
        the only assertion that holds.
        """
        import asyncio

        from server import run_index_steps

        ran: list[str] = []

        async def boom():
            ran.append("first")
            raise RuntimeError("index creation exploded")

        async def fine():
            ran.append("second")

        failed = asyncio.run(run_index_steps([("first", boom), ("second", fine)]))
        self.assertEqual(ran, ["first", "second"],
                         "a failing step must not prevent the ones after it")
        self.assertEqual(failed, ["first"])

    def test_index_setup_never_breaks_a_boot(self):
        import asyncio

        from server import run_index_steps

        async def boom():
            raise RuntimeError("mongo is down")

        # No raise: a deployment with an unreachable database must still start
        # and serve the pages that do not need it.
        self.assertEqual(asyncio.run(run_index_steps([("a", boom)])), ["a"])

    def test_the_smoke_check_and_the_boot_step_agree(self):
        """Adding a collection to one list and not the other is the real risk."""
        import importlib.util

        spec = importlib.util.spec_from_file_location(
            "teacher_smoke_check", BACKEND / "scripts" / "teacher_smoke_check.py")
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        required = set(module.REQUIRED_INDEXES)
        steps = _lifespan_index_steps()

        # The labels are per-module, the requirements per-collection, so map the
        # collections a module owns onto its label.
        owned = {
            "org": {"org_groups", "org_teacher_links", "org_enrollments", "org_audit"},
            "teacher_alerts": {"teacher_alerts"},
            "notifications": {"notifications"},
            "kudos": {"teacher_kudos"},
            "direct_messages": {"dm_messages", "dm_conversations"},
            "teacher_insights": {"teacher_insights"},
            "group_digests": {"group_digests"},
            "teacher_briefs": {"teacher_briefs"},
            "teacher_tool_calls": {"teacher_tool_calls"},
            "wellbeing_flags": {"wellbeing_flags"},
            "goal_suggestions": {"goal_suggestions"},
            "calendar_events": {"calendar_events"},
            "oidc_transactions": {"oidc_transactions"},
        }
        self.assertEqual(
            steps, set(owned), "server.py index_steps changed — update `owned` here too")

        covered: set[str] = set()
        for label in steps:
            covered |= owned[label]
        missing = required - covered
        self.assertFalse(
            missing,
            f"{missing} need an index per the smoke check, but no boot step creates one")


class AssistantScopeInvariant(unittest.TestCase):
    """The gate whose absence once ran ungrounded for a whole phase."""

    def test_the_teacher_assistant_view_is_registered(self):
        from app.brain.context_engine import AGENT_VIEWS

        self.assertIn("teacher_assistant", AGENT_VIEWS)
        self.assertTrue(AGENT_VIEWS["teacher_assistant"].get("read"))

    def test_it_can_never_read_pii_or_the_private_soft_model(self):
        from app.brain.context_engine import AGENT_VIEWS

        readable = AGENT_VIEWS["teacher_assistant"]["read"]
        for forbidden in ("identity", "memory", "profile.mapping_scores"):
            for path in readable:
                self.assertFalse(
                    path == forbidden or path.startswith(f"{forbidden}."),
                    f"{path} exposes {forbidden} to an LLM prompt")

    def test_it_is_read_only(self):
        from app.brain.context_engine import AGENT_VIEWS

        self.assertEqual(AGENT_VIEWS["teacher_assistant"].get("write"), [])


if __name__ == "__main__":
    unittest.main()
