"""Ministry roles → app roles.

The ministry authenticates; it never authorizes (connection guidelines §4.3,
§4.4). So this maps a token onto `learner` / `teacher` and stops there:
**`admin` is never derived from a token.** It stays a live `org_admins` grant
re-checked on every request by `require_admin`, which is what makes revoking an
administrator take effect immediately instead of at their next login.

An empty result is a real answer, not a failure — it is the "אינך מורשה
למערכת" case the ministry test appendix requires us to handle (§11.4.3).
"""

from __future__ import annotations

from app.auth.dependencies import ROLE_LEARNER, ROLE_TEACHER
from app.auth.moe import config
from app.auth.moe.claims import MoeProfile

# Operations appendix §א: the ICT role holders the ministry stopped distributing
# as name lists. Whoever carries one of these gets a supplier's full content
# access, which for us is the teacher lane.
ICT_ROLE_CODES = ("793", "794", "795")


def _configured(bucket: str) -> tuple[str, ...]:
    raw = config.role_map().get(bucket)
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, (list, tuple)):
        return ()
    return tuple(str(code).strip() for code in raw if str(code).strip())


def teacher_role_codes() -> tuple[str, ...]:
    return _configured("teacher")


def student_role_codes() -> tuple[str, ...]:
    return _configured("student")


def support_role_codes() -> tuple[str, ...]:
    return _configured("support") or ICT_ROLE_CODES


def is_supplier_support(profile: MoeProfile) -> bool:
    """One of our own staff, signing in through the ministry.

    Recognised by an org role scoped to our supplier entity, which is exactly
    how the operations appendix says a supplier tells its support people apart.
    """
    code = config.supplier_code()
    if not code:
        return False
    return any(institution.symbol == code for institution in profile.institutions)


def resolve_roles(profile: MoeProfile) -> list[str]:
    """App roles for this ministry identity. Empty means "not permitted"."""
    codes = set(profile.role_codes)

    if profile.is_student or codes & set(student_role_codes()):
        return [ROLE_LEARNER]

    if codes & set(teacher_role_codes()):
        return [ROLE_TEACHER]
    if codes & set(support_role_codes()):
        return [ROLE_TEACHER]
    if is_supplier_support(profile):
        return [ROLE_TEACHER]

    # The ministry has not published the full role-code table yet, so until
    # MOE_ROLE_MAP_JSON is filled in there is nothing to match a teacher against.
    # A non-student carrying any org role at a school is treated as staff: the
    # alternative is locking out every real teacher during the pilot, and the
    # lane they reach is read-scoped to their own groups anyway.
    if not teacher_role_codes():
        if any(institution.is_school for institution in profile.institutions):
            return [ROLE_TEACHER]

    return []
