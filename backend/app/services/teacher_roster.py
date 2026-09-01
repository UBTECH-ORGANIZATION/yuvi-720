"""Every learner a teacher teaches, with their name — in one cheap read.

This exists because a name must not depend on which class is selected. The
teaching assistant is scoped to the *union* of a teacher's groups, so it can
legitimately mention a child from any of them; resolving names per-group meant a
message that said "Tal" turned into "demo-tal" the moment the teacher switched
class, and a fresh answer about another class rendered as a raw id immediately.

Deliberately NOT `insights.group_insights`. That computes a full insight per
learner behind a semaphore of 8 — the right thing for a dashboard, absurd for a
name lookup that every teacher screen wants on mount. This is one org walk plus
one projected query.

**This serves the browser — and one server-side matcher.** The PII boundary is
unchanged: `teacher_tools.data_tools` still scrubs `display_name` from everything
the model sees, and the model still writes `{{student:<id>}}`. The substitution
happens in the teacher's browser, from this. The one other consumer is
`find_student`, which *matches* a name the teacher typed against `names_for` on
the server and returns ids only — a tool may consume names to match, never to
return them.
"""

from __future__ import annotations

from typing import Any, Optional

from app.brain import org
from app.brain.repository import _get_collection_named, _read_fallback


async def names_for(learner_ids: list[str]) -> dict[str, Optional[str]]:
    """Map learner id → display name, in one projected query.

    A learner who never finished the mapping flow has no `identity.display_name`
    (it defaults to None in the brain schema), so a missing entry here is a real
    state, not an error — the client renders the inert id rather than guessing.
    """
    if not learner_ids:
        return {}

    collection = _get_collection_named("learners")
    if collection is not None:
        try:
            cursor = collection.find(
                {"_id": {"$in": learner_ids}}, {"identity.display_name": 1}
            )
            documents = await cursor.to_list(length=len(learner_ids))
            return {
                str(document.get("_id")): ((document.get("identity") or {}).get("display_name"))
                for document in documents
            }
        except Exception as exc:      # pragma: no cover — fall through to the file
            print(f"⚠️ roster name read failed, using fallback: {type(exc).__name__}")

    data = _read_fallback()
    return {
        learner_id: ((data.get(learner_id) or {}).get("identity") or {}).get("display_name")
        for learner_id in learner_ids
        if learner_id in data
    }


async def _avatars_for(learner_ids: list[str]) -> tuple[dict[str, Any], set[str]]:
    """Chosen avatars, and everyone who has chosen at all, in one projected query.

    Two return values because they answer different questions. The first is what
    to draw. The second is who has *decided* — including the learners who chose
    `{"kind": "initial"}`, their own letter, which this roster draws as a letter
    rather than a coin. Deriving a coin for that would overrule a choice, so the
    caller needs to know a choice exists even when it produces nothing to render
    here.

    `ProfileAvatar` resolves this per learner, which is right for one profile and
    absurd for a thirty-row roster — thirty round trips to render thirty coins.
    Fetched with the names instead, so a badge avatar is available on every
    teacher screen for the cost of one extra read.

    A learner who has chosen nothing is simply absent, and `_earned_avatars_for`
    then offers their best earned coin. The empty branch has to stay real: a
    child who has earned no badge yet must show a letter, never an empty coin.
    """
    if not learner_ids:
        return {}, set()

    try:
        from learner_state import _get_collection      # type: ignore

        collection = _get_collection()
    except Exception:      # pragma: no cover — no driver configured
        collection = None

    if collection is not None:
        try:
            cursor = collection.find({"_id": {"$in": learner_ids}}, {"avatar": 1})
            documents = await cursor.to_list(length=len(learner_ids))
            chosen: dict[str, Any] = {}
            decided: set[str] = set()
            for document in documents:
                learner_id = str(document.get("_id"))
                avatar = document.get("avatar")
                if isinstance(avatar, dict) and avatar.get("kind"):
                    decided.add(learner_id)
                choice = _badge_choice(avatar)
                if choice:
                    chosen[learner_id] = choice
            return chosen, decided
        except Exception as exc:      # pragma: no cover — an initial is a fine avatar
            print(f"⚠️ roster avatar read failed: {type(exc).__name__}")

    return {}, set()


async def _earned_avatars_for(learner_ids: list[str]) -> dict[str, Any]:
    """Best earned coin per learner, for everyone who has not chosen one.

    An avatar nobody sets is an avatar nobody has: every learner in the class was
    a grey letter on every teacher screen, one of them having mastered a whole
    subject. The badge system already knew that; the roster had no way to ask.

    One projected read of `mastery` for the whole roster, then a pure projection
    per learner — `badges.best_badge` touches no database and no events. A
    learner with nothing earned is absent from the result and keeps their letter.
    """
    if not learner_ids:
        return {}

    from app.services import kata_catalog
    from app.services.badges import best_badge

    try:
        # The coins are cut from the catalogue's objectives. Without it primed,
        # every learner would score zero mastered out of zero and lose a badge
        # they have — so a failure here means no derived avatars at all, not
        # wrong ones.
        await kata_catalog.ensure_loaded()
    except Exception as exc:      # pragma: no cover — letters are a fine fallback
        print(f"⚠️ roster badge avatars skipped, catalogue unavailable: {type(exc).__name__}")
        return {}

    collection = _get_collection_named("learners")
    documents: list[dict[str, Any]] = []
    if collection is not None:
        try:
            cursor = collection.find({"_id": {"$in": learner_ids}}, {"mastery": 1})
            documents = await cursor.to_list(length=len(learner_ids))
        except Exception as exc:      # pragma: no cover — fall through to the file
            print(f"⚠️ roster mastery read failed: {type(exc).__name__}")
            documents = []
    if not documents:
        data = _read_fallback()
        documents = [
            {"_id": learner_id, "mastery": (data.get(learner_id) or {}).get("mastery") or {}}
            for learner_id in learner_ids if learner_id in data
        ]

    earned: dict[str, Any] = {}
    for document in documents:
        choice = best_badge({"mastery": document.get("mastery") or {}})
        if choice:
            earned[str(document.get("_id"))] = choice
    return earned


def _badge_choice(avatar: Any) -> Optional[dict[str, Any]]:
    """Just the badge coin, or nothing.

    Only the three fields `<Badge mini>` needs cross over, and a learner on
    their own letter produces nothing at all. Legacy documents may still hold a
    whole Yuvi studio design here, from before the two were separate fields;
    those have no `kind` and fall out on the first test.
    """
    if not isinstance(avatar, dict) or avatar.get("kind") != "badge":
        return None
    badge = avatar.get("badge")
    if not isinstance(badge, dict) or not badge.get("glyph"):
        return None
    return {"kind": "badge", "badge": {
        "subject": badge.get("subject"),
        "glyph": badge.get("glyph"),
        "tier": badge.get("tier"),
    }}


async def roster_for_teacher(teacher_id: str) -> dict[str, Any]:
    """Every learner across every group this teacher teaches.

    Scope comes from `groups_for_teacher`, which already resolves the admin
    cases — a system admin gets every group, a school admin only their schools.
    Nothing here widens that.
    """
    groups = await org.groups_for_teacher(teacher_id)

    # A learner co-enrolled in two of this teacher's groups appears once, tagged
    # with the first group that claimed them: the caller wants a name, and a
    # duplicate row would make `students.length` a lie about the class size.
    group_of: dict[str, str] = {}
    order: list[str] = []
    for group in groups:
        group_id = str(group.get("_id"))
        for learner_id in await org.learners_in_group(group_id):
            if learner_id in group_of:
                continue
            group_of[learner_id] = group_id
            order.append(learner_id)

    names = await names_for(order)
    chosen, decided = await _avatars_for(order)
    # Only for the learners who have not chosen: the derivation is a default,
    # and a default that overrode a choice would be a bug wearing a feature's
    # clothes.
    derived = await _earned_avatars_for([lid for lid in order if lid not in decided])
    return {
        "students": [
            {"learner_id": learner_id,
             "display_name": names.get(learner_id),
             "avatar": chosen.get(learner_id) or derived.get(learner_id),
             "group_id": group_of[learner_id]}
            for learner_id in order
        ],
        "groups": [
            {"id": str(group.get("_id")), "name": group.get("name")} for group in groups
        ],
    }
