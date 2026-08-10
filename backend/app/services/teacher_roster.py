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

**This serves the browser, never the tool layer.** The PII boundary is unchanged:
`teacher_tools.data_tools` still scrubs `display_name` from everything the model
sees, and the model still writes `{{student:<id>}}`. The substitution happens in
the teacher's browser, from this.
"""

from __future__ import annotations

from typing import Any, Optional

from app.brain import org
from app.brain.repository import _get_collection_named, _read_fallback


async def _names_for(learner_ids: list[str]) -> dict[str, Optional[str]]:
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

    names = await _names_for(order)
    return {
        "students": [
            {"learner_id": learner_id,
             "display_name": names.get(learner_id),
             "group_id": group_of[learner_id]}
            for learner_id in order
        ],
        "groups": [
            {"id": str(group.get("_id")), "name": group.get("name")} for group in groups
        ],
    }
