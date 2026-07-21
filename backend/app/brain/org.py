"""Organization model + permission scoping (F8, §4.1/§5.8).

Schools · teachers · groups · enrollments. Access is enforced **server-side
before any brain read**: a teacher sees only learners in their groups; an admin
sees all. This is a SEED (demo placeholder) — replace with the real org import;
scoping logic stays the same.
"""

from __future__ import annotations

from typing import Any, Optional

# ── Seed org (demo). Replace with the real import; keep the scoping API. ──────
SCHOOLS = [
    {"id": "school-rabin", "name": "בית ספר רבין, נתניה"},
]
TEACHERS = [
    # Real accounts (see `scripts/seed_users.py`). They hold both roles.
    # Each owns a SEPARATE group and is enrolled only in their own: co-teaching
    # one shared group would make them mutual teachers and let each read the
    # other's brain, which is not what a personal account should allow.
    {"id": "gal", "name": "Gal", "school_id": "school-rabin",
     "role": "teacher", "group_ids": ["group-gal"]},
    {"id": "moti", "name": "Moti", "school_id": "school-rabin",
     "role": "teacher", "group_ids": ["group-moti"]},
]
GROUPS = [
    # `teacher_ids` (plural) lets a group have co-teachers; `teacher_id` stays
    # supported for the single-owner rows above.
    {"id": "group-gal", "name": "יובי 720 · Gal", "school_id": "school-rabin",
     "subject": "math", "teacher_ids": ["gal"]},
    {"id": "group-moti", "name": "יובי 720 · Moti", "school_id": "school-rabin",
     "subject": "math", "teacher_ids": ["moti"]},
]
# enrollments link a learner_id → group.
ENROLLMENTS = [
    {"learner_id": "gal", "group_id": "group-gal"},
    {"learner_id": "moti", "group_id": "group-moti"},
]

_TEACHER_BY_ID = {t["id"]: t for t in TEACHERS}
_GROUP_BY_ID = {g["id"]: g for g in GROUPS}


def get_teacher(teacher_id: str) -> Optional[dict[str, Any]]:
    return _TEACHER_BY_ID.get(teacher_id)


def is_admin(teacher_id: str) -> bool:
    t = get_teacher(teacher_id)
    return bool(t and t.get("role") == "admin")


def groups_for_teacher(teacher_id: str) -> list[dict[str, Any]]:
    """Groups the teacher may access (admin → all groups).

    A group is owned either by a single `teacher_id` or a list of co-teachers in
    `teacher_ids`.
    """
    if is_admin(teacher_id):
        return list(GROUPS)
    return [
        g for g in GROUPS
        if g.get("teacher_id") == teacher_id or teacher_id in (g.get("teacher_ids") or [])
    ]


def learners_in_group(group_id: str) -> list[str]:
    return [e["learner_id"] for e in ENROLLMENTS if e["group_id"] == group_id]


def teacher_can_access_group(teacher_id: str, group_id: str) -> bool:
    if is_admin(teacher_id):
        return True
    return any(g["id"] == group_id for g in groups_for_teacher(teacher_id))


def teacher_can_access_learner(teacher_id: str, learner_id: str) -> bool:
    """True iff the learner is enrolled in one of the teacher's groups (or admin)."""
    if is_admin(teacher_id):
        return True
    allowed_groups = {g["id"] for g in groups_for_teacher(teacher_id)}
    return any(
        e["learner_id"] == learner_id and e["group_id"] in allowed_groups
        for e in ENROLLMENTS
    )


def get_group(group_id: str) -> Optional[dict[str, Any]]:
    return _GROUP_BY_ID.get(group_id)
