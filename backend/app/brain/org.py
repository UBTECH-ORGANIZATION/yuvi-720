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
    {"id": "teacher-demo", "name": "מורה הדגמה", "school_id": "school-rabin",
     "role": "teacher", "group_ids": ["group-7a-math"]},
    {"id": "admin-demo", "name": "מנהל/ת הדגמה", "school_id": "school-rabin",
     "role": "admin", "group_ids": []},
]
GROUPS = [
    {"id": "group-7a-math", "name": "ז'1 · מתמטיקה", "school_id": "school-rabin",
     "subject": "math", "teacher_id": "teacher-demo"},
]
# enrollments link a learner_id → group. The demo learners are enrolled so the
# teacher view shows real brains once they have used the system (see
# `scripts/seed_demo.py`, which populates their mapping + learning events).
ENROLLMENTS = [
    {"learner_id": "demo-learner", "group_id": "group-7a-math"},
    {"learner_id": "demo-learner-noa", "group_id": "group-7a-math"},
    {"learner_id": "demo-learner-adam", "group_id": "group-7a-math"},
]

_TEACHER_BY_ID = {t["id"]: t for t in TEACHERS}
_GROUP_BY_ID = {g["id"]: g for g in GROUPS}


def get_teacher(teacher_id: str) -> Optional[dict[str, Any]]:
    return _TEACHER_BY_ID.get(teacher_id)


def is_admin(teacher_id: str) -> bool:
    t = get_teacher(teacher_id)
    return bool(t and t.get("role") == "admin")


def groups_for_teacher(teacher_id: str) -> list[dict[str, Any]]:
    """Groups the teacher may access (admin → all groups)."""
    if is_admin(teacher_id):
        return list(GROUPS)
    return [g for g in GROUPS if g.get("teacher_id") == teacher_id]


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
