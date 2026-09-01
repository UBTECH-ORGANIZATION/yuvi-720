"""Pre-flight check for the teacher lane — run this before trusting a deployment.

Mirrors `lrs_smoke_check.py`: no server required, talks to the configured
database directly, prints what it found, and exits non-zero if anything that
would silently degrade the product is wrong.

It checks the four things that have actually broken here, rather than a generic
health ping:

1. **Indexes exist.** Every one of them backs a query on a hot path — the
   authorization lookups, the alert replay cursor, the Notes tab. A missing
   index never raises; it just makes the product slower every time the roster
   grows, which is the failure nobody notices until it is bad.
2. **The assistant's brain scope is registered.** `AGENT_VIEWS["teacher_assistant"]`
   was missing once and every read raised `AgentScopeError` into a broad
   `except`, so the AI ran ungrounded for a whole phase without a single error
   surfacing. This asserts it exists, and that it still excludes `identity`,
   `memory` and `mapping_scores` — the three things that must never reach an LLM.
3. **The org graph is coherent.** A group with active enrollments and no teacher
   means children nobody can see; a learner in no group is invisible to every
   teacher in the deployment. Both are legitimate mid-setup states, so they are
   reported as warnings, not failures — but they are never silent.
4. **A system admin exists.** Roster changes go through `org_admins`. With no
   row there, nobody can connect a teacher to a group, and the console renders
   for a token that says admin while the DB refuses every write.

Run:  cd backend && python scripts/teacher_smoke_check.py
      (add --strict to fail on warnings too)
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.brain.repository import _get_collection_named  # noqa: E402

# collection -> the index key-tuples that must exist beyond the implicit `_id`.
REQUIRED_INDEXES: dict[str, list[tuple[str, ...]]] = {
    "org_groups": [("school_id",), ("active",)],
    "org_teacher_links": [("teacher_id",), ("group_id",), ("active",)],
    "org_enrollments": [("learner_id",), ("group_id",), ("active",)],
    "org_audit": [("at",)],
    "teacher_alerts": [("teacher_id", "seq"), ("learner_id",), ("status",)],
    "notifications": [("recipient_id", "created_at")],
    "teacher_kudos": [("learner_id", "delivered_at")],
    # The message thread. Read by (conversation, created_at) on every open and
    # by (conversation, sender, read_at) on every mark-read.
    "dm_messages": [("conversation_id", "created_at"), ("conversation_id", "sender", "read_at")],
    "dm_conversations": [("teacher_id", "last_message_at")],
    "teacher_insights": [("learner_id", "deleted")],
    "group_digests": [("week",)],
    "teacher_tool_calls": [("teacher_id", "at")],
    # A child's disclosure and what was done about it. Read by (learner, at)
    # every time a teacher opens the wellbeing tab.
    "wellbeing_flags": [("learner_id", "at"), ("status",)],
    # Cached goal suggestions, read by _id and cleared per learner.
    "goal_suggestions": [("learner_id",)],
    # Free calendar events. Read by (group, start_at) on every calendar open.
    "calendar_events": [("group_id", "start_at")],
    # Durable signal episodes (idle/recovery/sustained/question-quality).
    # Read by (learner, at) on every open of a student's score dialogs.
    "learner_signals": [("learner_id", "at"), ("dedupe_key",)],
    # Support-usage rows. Read unbounded by learner on every profile open.
    "learner_activity": [("learner_id", "at")],
    # The weekly spine (#242). Slots by group on every calendar open (both
    # lanes), exceptions by their natural occurrence key, days off by school.
    "timetable_slots": [("group_id", "active")],
    "timetable_exceptions": [("occurrence_id",)],
    "school_calendar_days": [("school_id", "date")],
    # Weekly studio surprise state, one row per (learner, week).
    "weekly_studio_surprises": [("learner_id", "week")],
}

# Brain paths the teacher assistant must never be able to read.
FORBIDDEN_SCOPE = ("identity", "memory", "profile.mapping_scores")

failures: list[str] = []
warnings: list[str] = []


def ok(message: str) -> None:
    print(f"  ✅ {message}")


def fail(message: str) -> None:
    print(f"  ❌ {message}")
    failures.append(message)


def warn(message: str) -> None:
    print(f"  ⚠️  {message}")
    warnings.append(message)


async def check_indexes() -> None:
    print("── indexes ──")
    for collection, required in REQUIRED_INDEXES.items():
        handle = _get_collection_named(collection)
        if handle is None:
            fail(f"{collection}: no handle (database not configured?)")
            continue
        try:
            present = {
                tuple(index["key"].keys())
                for index in await handle.list_indexes().to_list(length=100)
            }
        except Exception as exc:
            fail(f"{collection}: could not list indexes ({type(exc).__name__})")
            continue
        missing = [keys for keys in required if keys not in present]
        if missing:
            fail(f"{collection}: missing {['+'.join(k) for k in missing]}")
        else:
            ok(f"{collection}: {len(required)} index(es) present")


def check_assistant_scope() -> None:
    print("── assistant brain scope ──")
    from app.brain.context_engine import AGENT_VIEWS

    view = AGENT_VIEWS.get("teacher_assistant")
    if not view:
        fail("AGENT_VIEWS['teacher_assistant'] is missing — every assistant "
             "brain read will raise AgentScopeError")
        return

    readable = view.get("read") or []
    ok(f"registered with {len(readable)} readable path(s)")

    leaked = [
        path for path in readable
        if any(path == bad or path.startswith(f"{bad}.") for bad in FORBIDDEN_SCOPE)
    ]
    if leaked:
        fail(f"assistant can read {leaked} — PII/private paths must never reach an LLM")
    else:
        ok("identity, memory and mapping_scores all excluded")

    if view.get("write"):
        fail(f"assistant has write scope {view['write']} — v1 is read-only by design")
    else:
        ok("read-only: no AI write into a child's brain")


async def check_org_graph() -> None:
    print("── org graph ──")
    groups = _get_collection_named("org_groups")
    links = _get_collection_named("org_teacher_links")
    enrollments = _get_collection_named("org_enrollments")
    if groups is None or links is None or enrollments is None:
        fail("org collections unavailable")
        return

    active_groups = [g async for g in groups.find({"active": True})]
    ok(f"{len(active_groups)} active group(s)")

    linked = {row["group_id"] async for row in links.find({"active": True})}
    enrolled: dict[str, int] = {}
    async for row in enrollments.find({"active": True}):
        enrolled[row["group_id"]] = enrolled.get(row["group_id"], 0) + 1

    teacherless = [
        g["_id"] for g in active_groups
        if g["_id"] not in linked and enrolled.get(g["_id"], 0) > 0
    ]
    if teacherless:
        warn(f"{len(teacherless)} group(s) have students but no teacher: {teacherless[:5]}"
             " — those children are invisible to every teacher")
    else:
        ok("every group with students has at least one teacher")

    users = _get_collection_named("users")
    if users is not None:
        learner_ids = {
            u["_id"] async for u in users.find({"roles": "learner"})
        }
        enrolled_ids = {row["learner_id"] async for row in enrollments.find({"active": True})}
        unassigned = sorted(learner_ids - enrolled_ids)
        if unassigned:
            warn(f"{len(unassigned)} learner(s) are in no group: {unassigned[:5]}"
                 " — no teacher can see them")
        else:
            ok("every learner is enrolled somewhere")


async def check_admins() -> None:
    print("── admin grants ──")
    admins = _get_collection_named("org_admins")
    if admins is None:
        fail("org_admins unavailable")
        return
    rows = [a async for a in admins.find({})]
    if not rows:
        fail("no org_admins row — nobody can change roster membership, and the "
             "console will render for a token the database then refuses")
        return
    system = [a["_id"] for a in rows if a.get("scope") == "system"]
    ok(f"{len(rows)} admin grant(s), {len(system)} system-scoped: {system[:3]}")
    if not system:
        warn("no system-scoped admin — school-scoped admins cannot see everything")


def check_workers() -> None:
    print("── deployment ──")
    import os

    workers = os.environ.get("WEB_CONCURRENCY")
    if workers and workers.isdigit() and int(workers) > 1:
        fail(f"WEB_CONCURRENCY={workers}: the realtime bus is in-process, so "
             "presence and alerts fragment across workers")
    else:
        ok(f"WEB_CONCURRENCY={workers or 'unset'} — single worker, bus is coherent")


async def main(strict: bool) -> int:
    await check_indexes()
    check_assistant_scope()
    await check_org_graph()
    await check_admins()
    check_workers()

    print()
    if failures:
        print(f"❌ {len(failures)} failure(s), {len(warnings)} warning(s)")
        return 1
    if warnings and strict:
        print(f"❌ {len(warnings)} warning(s) (--strict)")
        return 1
    print(f"✅ teacher lane looks healthy ({len(warnings)} warning(s))")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--strict", action="store_true",
                        help="treat warnings as failures")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(main(args.strict)))
