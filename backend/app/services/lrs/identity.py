"""Resolve a learner's MoE reporting identity: exidentifier + school + nmm.

v1 (staging): env-configured stub values, overridable by optional fields on
the learner's `users` document (`exidentifier`, `school_symbol`, `nmm_id`)
when those exist. Follow-up (tracked in the plan): real MoE SSO exidentifier
+ org mapping.

PII boundary: the exidentifier returned here is used ONLY to build outbound
LRS statements. Never write it to the brain, an LLM prompt, or logs.
"""

from __future__ import annotations

from typing import Optional, TypedDict

from app.services.lrs import config


class ReportingIdentity(TypedDict):
    exidentifier: str
    school: Optional[str]
    nmm: Optional[str]


async def resolve_reporting_identity(learner_id: str) -> Optional[ReportingIdentity]:
    """Return the reporting identity, or None when none is configured
    (→ the reporter skips the statement rather than sending junk)."""
    exidentifier = config.test_exidentifier()
    school: Optional[str] = config.default_school() or None
    nmm: Optional[str] = config.default_nmm() or None

    try:  # optional per-learner overrides, when the users doc carries them
        from app.auth.repository import get_user_by_id

        user = await get_user_by_id(learner_id)
        if user:
            exidentifier = str(user.get("exidentifier") or exidentifier)
            school = str(user.get("school_symbol") or school or "") or None
            nmm = str(user.get("nmm_id") or nmm or "") or None
    except Exception:  # never let identity lookup break reporting
        pass

    if not exidentifier:
        return None
    return {"exidentifier": exidentifier, "school": school, "nmm": nmm}
