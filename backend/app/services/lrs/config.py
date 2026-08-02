"""Env-driven configuration for the outbound MoE-LRS reporter.

Follows the repo convention (`os.environ.get`, no pydantic-settings). The
whole feature is gated on `is_enabled()`: when off (the default for dev/tests
without an `.env`), every reporter call is a fast no-op and nothing touches
the network.
"""

from __future__ import annotations

import os

from app.core.env import ensure_env_loaded

ensure_env_loaded()

_TRUTHY = {"1", "true", "yes", "on"}


def _get(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def token_url() -> str:
    return _get("LRS_TOKEN_URL")


def statements_url() -> str:
    return _get("LRS_STATEMENTS_URL")


def client_id() -> str:
    return _get("LRS_CLIENT_ID")


def client_secret() -> str:
    return _get("LRS_CLIENT_SECRET")


def scope() -> str:
    return _get("LRS_SCOPE", "lrs")


def xapi_version() -> str:
    return _get("LRS_XAPI_VERSION", "1.0.3")


def supplier_domain() -> str:
    """Base IRI for every object/grouping id (no trailing slash)."""
    return _get("LRS_SUPPLIER_DOMAIN").rstrip("/")


def program_iri() -> str:
    return _get(
        "LRS_PROGRAM_IRI",
        "https://lxp.education.gov.il/xapi/moe/program/720-platform",
    )


def timeout_seconds() -> float:
    return float(_get("LRS_TIMEOUT_SECONDS", "10"))


def kata_ecat_id() -> str:
    """Single-id fallback for `grouping→content-vendor`.

    Only correct where a provider registered ONE catalog item for everything it
    serves us. `ecat_item_id()` is what report paths should call.
    """
    return _get("LRS_KATA_ECAT_ID")


def ecat_items() -> dict[str, str]:
    """Content id → ECAT item id, from `LRS_ECAT_ITEMS` (JSON object).

    `grouping→content-vendor` carries "מזהה הפריט בקטלוג החינוכי" — the id of
    the CONTENT ITEM in the ministry's catalog, so it belongs to the piece of
    content, not to the vendor as a whole: two units from the same provider can
    (and normally do) carry different ones. Kata's catalog API publishes no ECAT
    field today, so until it does the mapping is configuration.

    Keys may be a unit, a component or an item id — whichever level the ministry
    registered. Malformed JSON is ignored rather than raised: a misconfigured map
    must not take reporting down, and `identity_problems()` reports the gap.
    """
    raw = _get("LRS_ECAT_ITEMS")
    if not raw:
        return {}
    try:
        import json
        parsed = json.loads(raw)
    except Exception:
        print("⚠️ LRS_ECAT_ITEMS is not valid JSON — ignoring the map")
        return {}
    if not isinstance(parsed, dict):
        return {}
    return {
        str(key): str(value).strip()
        for key, value in parsed.items()
        if str(value or "").strip()
    }


def ecat_item_id(
    *,
    item_id: str | None = None,
    component_id: str | None = None,
    unit_id: str | None = None,
) -> str:
    """The ECAT item id for one piece of content — most specific level first.

    An item's own registration wins over its component's, which wins over its
    unit's; the single-id fallback covers a provider with one catalog entry.
    """
    mapping = ecat_items()
    for key in (item_id, component_id, unit_id):
        if key and mapping.get(key):
            return mapping[key]
    return kata_ecat_id()


# ── Stub reporting identity (staging) — replaced per-learner later ───────────
def test_exidentifier() -> str:
    return _get("LRS_TEST_EXIDENTIFIER")


def default_school() -> str:
    return _get("LRS_DEFAULT_SCHOOL")


def default_nmm() -> str:
    return _get("LRS_DEFAULT_NMM")


def is_enabled() -> bool:
    """Reporting is on only when explicitly enabled AND fully configured."""
    if _get("LRS_ENABLED").lower() not in _TRUTHY:
        return False
    return bool(
        token_url()
        and statements_url()
        and client_id()
        and client_secret()
        and supplier_domain()
    )


# ── Identity hygiene ─────────────────────────────────────────────────────────
# The MoE integration review (28/07) rejected two grouping ids for being
# placeholders rather than real identifiers:
#   grouping → lms            sent `https://720.example.co.il`   (example domain)
#   grouping → content-vendor sent `ECAT-720-contract`           (not a catalog id)
# Neither is detectable at the schema level — the statement validates and means
# nothing — so the check lives here and every report path can ask.
_PLACEHOLDER_MARKERS = ("example", "changeme", "contract", "todo", "your-")


def _looks_like_placeholder(value: str) -> bool:
    lowered = value.lower()
    return any(marker in lowered for marker in _PLACEHOLDER_MARKERS)


def identity_problems() -> list[str]:
    """Human-readable reasons the outbound identity is not fit to report with."""
    problems: list[str] = []
    domain = supplier_domain()
    if not domain:
        problems.append("LRS_SUPPLIER_DOMAIN is empty — the lms/session/object ids need it")
    elif _looks_like_placeholder(domain):
        problems.append(
            f"LRS_SUPPLIER_DOMAIN is a placeholder ({domain}) — grouping→lms must be "
            "the platform's real domain"
        )
    # content-vendor is per CONTENT, so either a map or a single registration
    # satisfies it — but something has to be configured, and no value may be a
    # stand-in.
    mapping = ecat_items()
    single = kata_ecat_id()
    if not mapping and not single:
        problems.append(
            "no ECAT catalog id configured — set LRS_ECAT_ITEMS (content id → ECAT "
            "item id) or LRS_KATA_ECAT_ID; content events must carry one in "
            "grouping→content-vendor"
        )
    if single and _looks_like_placeholder(single):
        problems.append(
            f"LRS_KATA_ECAT_ID is a placeholder ({single}) — it must be the id from "
            "the MoE educational catalog"
        )
    for key, value in mapping.items():
        if _looks_like_placeholder(value):
            problems.append(
                f"LRS_ECAT_ITEMS[{key}] is a placeholder ({value}) — it must be the "
                "id from the MoE educational catalog"
            )
    if not test_exidentifier():
        problems.append("LRS_TEST_EXIDENTIFIER is empty — nothing to report as")
    return problems
