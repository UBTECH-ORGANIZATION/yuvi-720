"""Just-in-time account provisioning from Ministry claims.

A person the Ministry vouches for gets an account on first login — there is no
admin step between "the school enrolled them" and "they can learn". Repeat
logins refresh what the Ministry owns (name, school, class, role) and touch
nothing the learner or a teacher authored.

No password hash is ever written for these accounts, so there is no credential
to steal and no second way into them.
"""

from __future__ import annotations

from typing import Any, Optional

from app.auth.moe.claims import MoeIdentity
from app.auth.repository import (
    DEFAULT_PREFERENCES,
    get_user_by_id,
    upsert_user,
)
from app.services import org_repository

PROVISIONING_ACTOR = "system:moe-sso"


async def _ensure_org(identity: MoeIdentity, *, is_teacher: bool) -> None:
    """Mirror the Ministry's school + class onto our org graph.

    Without this a JIT learner is enrolled nowhere, so no teacher can see them
    and the LRS `team` falls back to the school. Both are silent failures.
    """
    school_id = identity.get("school_symbol")
    group_id = identity.get("nmm_id")
    if not school_id:
        return

    school = await org_repository.get_school(school_id)
    if school is None:
        await org_repository.upsert_school(school_id, name=school_id, moe_code=school_id)

    if not group_id:
        return
    group = await org_repository.get_group(group_id)
    if group is None:
        await org_repository.upsert_group(
            group_id,
            school_id=school_id,
            name=group_id,
            grade=identity.get("grade"),
        )

    learner_id = identity["learner_id"]
    if is_teacher:
        links = await org_repository.list_teacher_links(
            teacher_id=learner_id, group_id=group_id
        )
        if not links:
            await org_repository.link_teacher(
                learner_id, group_id, school_id=school_id, link_role="teacher"
            )
        return

    enrollments = await org_repository.list_enrollments(
        learner_id=learner_id, group_id=group_id
    )
    if not enrollments:
        await org_repository.enroll_learner(
            learner_id, group_id, school_id=school_id
        )


async def _ensure_brain(user_id: str, *, display_name: str, locale: str, grade: Optional[str]) -> None:
    from app.brain.repository import apply_brain_updates, get_brain

    await get_brain(user_id)
    updates: dict[str, Any] = {
        "identity.display_name": display_name,
        "identity.locale": locale,
    }
    if grade:
        updates["identity.grade"] = grade
    await apply_brain_updates(user_id, updates)


async def provision(identity: MoeIdentity) -> dict[str, Any]:
    """Create or refresh the account behind a Ministry login. Idempotent."""
    user_id = identity["learner_id"]
    existing = await get_user_by_id(user_id) or {}
    is_teacher = "teacher" in identity["roles"]

    # Preferences are the learner's, not the Ministry's: only seed the language
    # on first login, so a later in-app switch is not undone every morning.
    preferences = dict(existing.get("preferences") or DEFAULT_PREFERENCES)
    preferences.setdefault("language", identity["locale"])
    if not existing:
        preferences["language"] = identity["locale"]

    document: dict[str, Any] = {
        **existing,
        "_id": user_id,
        "username": identity["username"],
        "display_name": identity["display_name"] or existing.get("display_name") or user_id,
        "roles": identity["roles"],
        "identity_provider": "moe",
        "preferences": preferences,
    }
    document.pop("password", None)
    document.pop("must_change_password", None)

    # Ministry-owned reporting fields. Kept out of the brain on purpose — see
    # the PII note in `app/auth/moe/__init__.py`.
    for key in ("exidentifier", "school_symbol", "nmm_id", "grade"):
        value = identity.get(key)
        if value:
            document[key] = value

    await upsert_user(document)

    if not is_teacher:
        await _ensure_brain(
            user_id,
            display_name=document["display_name"],
            locale=preferences["language"],
            grade=identity.get("grade"),
        )
    await _ensure_org(identity, is_teacher=is_teacher)

    await org_repository.record_audit(
        actor_id=PROVISIONING_ACTOR,
        action="provision_user" if not existing else "refresh_user",
        target_type="user",
        target_id=user_id,
        before=None,
        after={"roles": identity["roles"], "school_symbol": identity.get("school_symbol")},
        reason="moe_sso_login",
    )
    return document
