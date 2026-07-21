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
    return _get("LRS_SUPPLIER_DOMAIN", "https://720.example.co.il").rstrip("/")


def program_iri() -> str:
    return _get(
        "LRS_PROGRAM_IRI",
        "https://lxp.education.gov.il/xapi/moe/program/720-platform",
    )


def timeout_seconds() -> float:
    return float(_get("LRS_TIMEOUT_SECONDS", "10"))


def kata_ecat_id() -> str:
    """Kata's item id in the MoE educational catalog (ECAT) — tags the
    content-vendor grouping on forwarded content events. Empty until assigned."""
    return _get("LRS_KATA_ECAT_ID")


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
    return bool(token_url() and statements_url() and client_id() and client_secret())
