"""Where invalidation lives: three verbs the write seams call.

Almost every cached read is a projection of one learner's brain and events,
or of a class's worth of them. Both change in a handful of places, and each
of those places calls one of these:

* ``touch_learner`` — the learner's own version moves, and so does every
  class they are in (the class snapshot is a fold over its members).
* ``touch_group``   — a class-level write (a goal assigned, a pin, a roster
  edit) without a particular learner.
* ``touch_chat``    — a transcript changed; the chat tails and lists re-read.

All of them fail open and cost one or two round trips. The learner→groups
lookup is itself cached (15 min, TTL only) so a burst of answers does not
turn into a burst of roster reads.
"""

from __future__ import annotations

from app.services import cache_store


async def _groups_of(learner_id: str) -> list[str]:
    async def lookup() -> list[str]:
        from app.brain import org
        return list(await org.groups_for_learner(learner_id))

    return await cache_store.remember(
        "learner", learner_id, "groups", "", 900, lookup, versioned=False,
    )


async def touch_learner(learner_id: str) -> None:
    if not learner_id or not cache_store.enabled():
        return
    try:
        await cache_store.bump("learner", learner_id)
        for group_id in await _groups_of(learner_id):
            await cache_store.bump("grp", group_id)
    except Exception as exc:  # pragma: no cover - the store already fails open
        print(f"⚠️ cache bump skipped for {learner_id}: {type(exc).__name__}")


async def touch_group(group_id: str) -> None:
    if not group_id or not cache_store.enabled():
        return
    await cache_store.bump("grp", group_id)


async def touch_chat(learner_id: str) -> None:
    if not learner_id or not cache_store.enabled():
        return
    await cache_store.bump("chat", learner_id)


async def forget_learner_groups(learner_id: str) -> None:
    """A roster edit: the cached learner→groups lookup must not outlive it."""
    await cache_store.drop(("learner", learner_id, 0, "groups", ""))


async def touch_teacher(teacher_id: str) -> None:
    """A staffing change: the teacher's resolved scope (which classes and
    learners the assistant may see) re-reads."""
    if not teacher_id or not cache_store.enabled():
        return
    await cache_store.bump("teacher", teacher_id)


async def touch_enrollment(learner_id: str, group_id: str) -> None:
    """A roster edit. The learner's cached group list must not outlive it,
    the class they joined or left re-folds, and their own projections move
    too — in that order, so the learner bump lands on the NEW groups."""
    if not learner_id or not cache_store.enabled():
        return
    await forget_learner_groups(learner_id)
    await touch_group(group_id)
    await touch_learner(learner_id)
