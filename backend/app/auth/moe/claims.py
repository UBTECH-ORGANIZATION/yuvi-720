"""Ministry claims → the identity the rest of the app understands.

Claim names are a lookup table rather than attribute access because the
Ministry's `profileEXT` / `eduorg` / `edustudent` scopes are documented loosely
and differ between their dev and production tenants. When a name turns out to
be wrong, the fix is one tuple here and not a change to the login flow.
"""

from __future__ import annotations

import hashlib
import hmac
import re
from typing import Any, Iterable, Optional, TypedDict

from app.auth.moe import config

ROLE_LEARNER = "learner"
ROLE_TEACHER = "teacher"

# First present, non-empty claim wins.
_SUBJECT_CLAIMS = ("sub",)
_EXIDENTIFIER_CLAIMS = ("exidentifier", "exIdentifier", "ExIdentifier", "uid", "userId")
_DISPLAY_NAME_CLAIMS = ("name", "displayName", "fullName", "cn", "given_name")
_SCHOOL_CLAIMS = ("schoolSymbol", "school_symbol", "semelMosad", "semel_mosad", "orgId", "school")
_CLASS_CLAIMS = ("nmm", "nmmId", "kvutsa", "classCode", "class_id", "className", "kita")
_GRADE_CLAIMS = ("grade", "shichva", "classGrade", "level")
_ROLE_CLAIMS = ("role", "roles", "userType", "eduPersonAffiliation", "affiliation")
_LOCALE_CLAIMS = ("locale", "language", "lang")

_TEACHER_TOKENS = {"teacher", "staff", "educator", "faculty", "principal", "moreh", "mora", "מורה", "צוות"}
_STUDENT_TOKENS = {"student", "pupil", "learner", "talmid", "תלמיד"}

_SUPPORTED_LOCALES = {"he", "ar", "en"}
_ID_SAFE = re.compile(r"[^a-z0-9_-]")


class MoeIdentity(TypedDict):
    learner_id: str
    username: str
    display_name: str
    roles: list[str]
    exidentifier: Optional[str]
    school_symbol: Optional[str]
    nmm_id: Optional[str]
    grade: Optional[str]
    locale: str


def _first(source: dict[str, Any], names: Iterable[str]) -> Optional[str]:
    for name in names:
        value = source.get(name)
        if isinstance(value, (str, int)) and str(value).strip():
            return str(value).strip()
        if isinstance(value, list) and value:
            joined = str(value[0]).strip()
            if joined:
                return joined
    return None


def _role_tokens(source: dict[str, Any]) -> set[str]:
    tokens: set[str] = set()
    for name in _ROLE_CLAIMS:
        value = source.get(name)
        if isinstance(value, str):
            tokens.update(part.strip().lower() for part in re.split(r"[,;|\s]+", value) if part.strip())
        elif isinstance(value, list):
            tokens.update(str(part).strip().lower() for part in value if str(part).strip())
    return tokens


def derive_learner_id(subject: str) -> str:
    """Pseudonymous and stable: the same person always lands on the same brain.

    An HMAC rather than a plain hash so the mapping cannot be reversed by
    hashing a candidate list of Ministry subjects.
    """
    digest = hmac.new(
        config.learner_id_salt().encode("utf-8"), subject.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return f"moe_{digest[:24]}"


def resolve_roles(claims: dict[str, Any], *, granted_scopes: str = "") -> list[str]:
    """Teacher wins when a person carries both — a homeroom teacher who is also
    enrolled somewhere must not land on a student dashboard."""
    tokens = _role_tokens(claims)
    scopes = {scope.strip().lower() for scope in (granted_scopes or "").split() if scope.strip()}
    if tokens & _TEACHER_TOKENS:
        return [ROLE_TEACHER]
    if tokens & _STUDENT_TOKENS or "edustudent" in scopes:
        return [ROLE_LEARNER]
    # Unknown affiliation is treated as a learner: it is the least-privileged
    # role, and a wrongly-demoted teacher is a support ticket while a wrongly
    # promoted student is a data breach.
    return [ROLE_LEARNER]


def _locale(value: Optional[str]) -> str:
    candidate = (value or "").strip().lower()[:2]
    return candidate if candidate in _SUPPORTED_LOCALES else "he"


def build_identity(
    claims: dict[str, Any],
    userinfo: Optional[dict[str, Any]] = None,
    *,
    granted_scopes: str = "",
) -> MoeIdentity:
    """id_token claims first; userinfo fills what the token did not carry."""
    merged: dict[str, Any] = {**(userinfo or {}), **claims}

    subject = _first(merged, _SUBJECT_CLAIMS)
    if not subject:
        raise ValueError("missing_subject")

    learner_id = derive_learner_id(subject)
    display_name = _first(merged, _DISPLAY_NAME_CLAIMS) or ""
    return {
        "learner_id": learner_id,
        "username": learner_id,
        "display_name": display_name,
        "roles": resolve_roles(merged, granted_scopes=granted_scopes),
        "exidentifier": _first(merged, _EXIDENTIFIER_CLAIMS),
        "school_symbol": _first(merged, _SCHOOL_CLAIMS),
        "nmm_id": _first(merged, _CLASS_CLAIMS),
        "grade": _first(merged, _GRADE_CLAIMS),
        "locale": _locale(_first(merged, _LOCALE_CLAIMS)),
    }
