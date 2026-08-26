"""Ministry profile → a Spark account (`users`) and its org rows.

Idempotent: every sign-in re-applies the same document, so a class change or a
new placement at the ministry lands on the next login without a migration.

What is stored, and why it is safe:
  * `exidentifier` — the scrambled id, needed to address outbound LRS
    statements. It never leaves the `users` document.
  * `display_name` — UI only, never sent to an LLM or to the LRS.
  * institutions / role codes — org scoping and support triage.
There is no field here for a national id, a phone number or an address, so a
mis-provisioned token type cannot leak one into the database.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.auth.moe.claims import Institution, MoeProfile
from app.auth.moe.identity import derive_learner_id
from app.auth.moe.roles import is_supplier_support, resolve_roles
from app.auth.moe import config
from app.auth.dependencies import ROLE_LEARNER
from app.auth.repository import get_user_by_id, upsert_user
from app.services import org_repository


class NotPermittedError(PermissionError):
    """Authenticated by the ministry, but holds no role this product serves."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _institution_row(institution: Institution) -> dict[str, Any]:
    return {
        "symbol": institution.symbol,
        "entity_type": institution.entity_type,
        "roles": list(institution.roles),
        "school_class": institution.school_class,
        "parallel": institution.parallel,
        "group_key": institution.group_key,
    }


def _group_name(institution: Institution) -> str:
    parts = [part for part in (institution.school_class, institution.parallel) if part]
    return "-".join(parts) if parts else institution.symbol


async def _sync_org(learner_id: str, roles: list[str], profile: MoeProfile) -> None:
    """Mirror ministry placements into the org graph.

    Only *students* are enrolled automatically: their class arrives in the
    token. A teacher's token names their schools but not which classes they
    teach, so a teacher is linked to a school and their groups are assigned by
    an administrator — inventing links here would hand one teacher the whole
    school's children.
    """
    for institution in profile.schools:
        if institution.symbol == config.supplier_code():
            continue  # our own supplier entity is not a school
        try:
            await org_repository.upsert_school(
                institution.symbol,
                name=institution.symbol,
                moe_code=institution.symbol,
            )
        except Exception as exc:  # org sync must never fail a sign-in
            print(f"⚠️ MoE school sync skipped: {type(exc).__name__}")
            continue

        group_key = institution.group_key
        if not group_key or ROLE_LEARNER not in roles:
            continue
        try:
            await org_repository.upsert_group(
                group_key,
                school_id=institution.symbol,
                name=_group_name(institution),
                grade=institution.school_class,
            )
            await org_repository.enroll_learner(
                learner_id, group_key, school_id=institution.symbol
            )
        except Exception as exc:
            print(f"⚠️ MoE enrollment sync skipped: {type(exc).__name__}")


async def provision(profile: MoeProfile) -> dict[str, Any]:
    """Create or refresh the account behind a ministry identity.

    Returns the stored document. Raises `NotPermittedError` when the identity
    carries no role we serve — the caller turns that into the ministry-mandated
    "אינך מורשה למערכת" screen rather than a blank 403.
    """
    roles = resolve_roles(profile)
    if not roles:
        raise NotPermittedError("no_role")

    learner_id = derive_learner_id(profile.exidentifier)
    existing = await get_user_by_id(learner_id) or {}

    primary = next(iter(profile.schools), None)
    document: dict[str, Any] = {
        **existing,
        "_id": learner_id,
        # Ministry accounts have no password; the username exists only because
        # the rest of the app expects the field. It is never typed by anyone.
        "username": learner_id,
        "display_name": profile.display_name or existing.get("display_name") or "",
        "roles": roles,
        "identity_source": "moe",
        "exidentifier": profile.exidentifier,
        "school_symbol": primary.symbol if primary else existing.get("school_symbol"),
        "institutions": [_institution_row(item) for item in profile.institutions],
        "moe_role_codes": list(profile.role_codes),
        "moe_parental_consent": profile.parental_consent,
        "moe_is_supplier_support": is_supplier_support(profile),
        "moe_synced_at": _now(),
    }
    # A ministry identity must never inherit a local password, including on an
    # account that used to have one.
    document.pop("password", None)

    stored = await upsert_user(document)
    await _sync_org(learner_id, roles, profile)
    return stored

