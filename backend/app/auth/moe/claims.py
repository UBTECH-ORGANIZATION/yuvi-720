"""Ministry token claims → a typed profile.

**The single place that knows ministry claim names.** They differ per protocol
and the published table is ambiguous for OpenID (`name` / `nickname` /
`displayname` all appear against the same row), so each field is read through a
list of aliases, case-insensitively. When the ministry sends a real type-3
token, correcting a name is a one-line edit here and nothing else moves.

Token type 3 ("מידע כללי") is what we asked for: `exidentifier` and school
placement, no national id. If a `zehut` ever shows up because a different token
type was provisioned, it is dropped on the floor by construction — this module
simply has no field for it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Optional

# Ministry claim names, most specific first. Matched case-insensitively.
_ALIASES: dict[str, tuple[str, ...]] = {
    "exidentifier": ("exidentifier",),
    "given_name": ("given_name", "givenname"),
    "family_name": ("family_name", "surname"),
    "display_name": ("displayname", "display_name"),
    "given_name_kinui": ("shempratikinui",),
    "family_name_kinui": ("shemmishpachakinui",),
    "is_student": ("isstudent",),
    "student_school": ("studentmosad",),
    "student_class": ("studentkita",),
    "student_parallel": ("studentmakbila",),
    "extra_placements": ("shibutznosaf",),
    "role_codes": ("orgrolessimple",),
    "role_complex": ("orgrolecomplex", "complexorgroles"),
    "role_entities": ("orgrolesyeshuyot",),
    "parental_consent": ("ishurhorim",),
}

# `667[mosad:189084]` — role code, entity type, entity symbol.
_COMPLEX_ROLE = re.compile(r"^\s*(?P<role>[^\[\]]+?)\s*\[\s*(?P<entity>[^:\]]+?)\s*:\s*(?P<symbol>[^\]]+?)\s*\]\s*$")
# `3[112409:6,1]` — an additional placement: school, class, parallel.
_PLACEMENT = re.compile(r"\[\s*(?P<symbol>[^:\]]+?)\s*:\s*(?P<rest>[^\]]*)\]")

SCHOOL_ENTITY_HINTS = ("mosad", "מוסד")


@dataclass(frozen=True)
class Institution:
    """One ministry entity the person is attached to."""

    symbol: str
    entity_type: str = "mosad"
    roles: tuple[str, ...] = ()
    school_class: Optional[str] = None
    parallel: Optional[str] = None

    @property
    def is_school(self) -> bool:
        return any(hint in self.entity_type.lower() for hint in SCHOOL_ENTITY_HINTS)

    @property
    def group_key(self) -> Optional[str]:
        """`{school}-{class}{parallel}` — the class this person sits in, if any."""
        if not self.school_class:
            return None
        return f"{self.symbol}-{self.school_class}{self.parallel or ''}"


@dataclass(frozen=True)
class MoeProfile:
    exidentifier: str
    display_name: str
    is_student: bool
    role_codes: tuple[str, ...] = ()
    institutions: tuple[Institution, ...] = ()
    parental_consent: Optional[str] = None
    raw_claim_names: tuple[str, ...] = field(default=(), repr=False)

    @property
    def schools(self) -> tuple[Institution, ...]:
        return tuple(item for item in self.institutions if item.is_school)


class ClaimsError(ValueError):
    """The token is valid but unusable — no exidentifier to identify anyone by."""


def _lookup(claims: dict[str, Any], key: str) -> Any:
    lowered = {str(name).lower(): value for name, value in claims.items()}
    for alias in _ALIASES[key]:
        value = lowered.get(alias.lower())
        if value not in (None, "", []):
            return value
    return None


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return ", ".join(str(item) for item in value if item not in (None, ""))
    return str(value).strip()


def _as_list(value: Any) -> list[str]:
    """Ministry multi-values arrive as a JSON array or a comma-joined string."""
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        items: list[str] = []
        for entry in value:
            items.extend(_as_list(entry))
        return items
    return [part.strip() for part in split_top_level(str(value)) if part.strip()]


def split_top_level(value: str, separator: str = ",") -> list[str]:
    """Split on `separator`, ignoring separators inside `[...]`.

    Required because both multi-valued ministry formats use commas at the top
    level *and* inside brackets: `3[112409:6,1],4[190210:7,2]` is two placements,
    not four fragments.
    """
    parts: list[str] = []
    depth = 0
    current: list[str] = []
    for character in value:
        if character == "[":
            depth += 1
        elif character == "]":
            depth = max(0, depth - 1)
        if character == separator and depth == 0:
            parts.append("".join(current))
            current = []
            continue
        current.append(character)
    parts.append("".join(current))
    return parts


def _truthy_flag(value: Any) -> bool:
    """`isstudent` is documented as Yes/No but sampled as Y/N."""
    text = _as_text(value).strip().lower()
    return text in {"y", "yes", "true", "1", "כן"}


def _parse_complex_roles(value: Any) -> list[Institution]:
    institutions: list[Institution] = []
    for entry in _as_list(value):
        match = _COMPLEX_ROLE.match(entry)
        if not match:
            continue
        institutions.append(Institution(
            symbol=match.group("symbol"),
            entity_type=match.group("entity"),
            roles=(match.group("role"),),
        ))
    return institutions


def _parse_placements(value: Any) -> list[Institution]:
    institutions: list[Institution] = []
    for entry in _as_list(value):
        match = _PLACEMENT.search(entry)
        if not match:
            continue
        rest = [part.strip() for part in match.group("rest").split(",") if part.strip()]
        institutions.append(Institution(
            symbol=match.group("symbol"),
            entity_type="mosad",
            school_class=rest[0] if rest else None,
            parallel=rest[1] if len(rest) > 1 else None,
        ))
    return institutions


def _merge(institutions: list[Institution]) -> tuple[Institution, ...]:
    """Collapse to one entry per (symbol, entity type), unioning roles.

    A teacher legitimately appears several times for the same school, once per
    role code, and a student's own school also arrives from two claims.
    """
    merged: dict[tuple[str, str], Institution] = {}
    for item in institutions:
        if not item.symbol:
            continue
        key = (item.symbol, item.entity_type.lower())
        existing = merged.get(key)
        if existing is None:
            merged[key] = item
            continue
        merged[key] = Institution(
            symbol=existing.symbol,
            entity_type=existing.entity_type,
            roles=tuple(dict.fromkeys(existing.roles + item.roles)),
            school_class=existing.school_class or item.school_class,
            parallel=existing.parallel or item.parallel,
        )
    return tuple(merged.values())


def _display_name(claims: dict[str, Any]) -> str:
    explicit = _as_text(_lookup(claims, "display_name"))
    if explicit:
        return explicit
    # Schools address a child by their כינוי when one is recorded, so it wins
    # over the registry name before we fall back to the registry name.
    for first_key, last_key in (
        ("given_name_kinui", "family_name_kinui"),
        ("given_name", "family_name"),
    ):
        first = _as_text(_lookup(claims, first_key))
        last = _as_text(_lookup(claims, last_key))
        if first or last:
            return " ".join(part for part in (first, last) if part)
    return ""


def parse_profile(claims: dict[str, Any]) -> MoeProfile:
    """Read a ministry token (id_token claims merged with userinfo) into a profile.

    Raises `ClaimsError` when there is no exidentifier — without it we cannot
    key an account, and inventing one would silently fork a learner's history.
    """
    exidentifier = _as_text(_lookup(claims, "exidentifier"))
    if not exidentifier:
        raise ClaimsError("token carries no exidentifier")

    # Order matters: the first school becomes the account's primary. A child's
    # own `studentmosad` outranks the additional placements in `shibutznosaf`,
    # which would otherwise win purely by claim order.
    institutions: list[Institution] = []
    student_school = _as_text(_lookup(claims, "student_school"))
    if student_school:
        institutions.append(Institution(
            symbol=student_school,
            entity_type="mosad",
            school_class=_as_text(_lookup(claims, "student_class")) or None,
            parallel=_as_text(_lookup(claims, "student_parallel")) or None,
        ))

    institutions.extend(_parse_complex_roles(_lookup(claims, "role_complex")))
    institutions.extend(_parse_placements(_lookup(claims, "extra_placements")))

    # Bare entity symbols, when the complex claim is absent. No class, no role —
    # enough to know the person is attached to that school.
    for symbol in _as_list(_lookup(claims, "role_entities")):
        institutions.append(Institution(symbol=symbol, entity_type="mosad"))

    return MoeProfile(
        exidentifier=exidentifier,
        display_name=_display_name(claims),
        is_student=_truthy_flag(_lookup(claims, "is_student")),
        role_codes=tuple(dict.fromkeys(_as_list(_lookup(claims, "role_codes")))),
        institutions=_merge(institutions),
        parental_consent=_as_text(_lookup(claims, "parental_consent")) or None,
        raw_claim_names=tuple(sorted(str(name) for name in claims)),
    )
