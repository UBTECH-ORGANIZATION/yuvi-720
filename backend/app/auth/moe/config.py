"""Env surface for MoE unified sign-in.

Same shape as `app.services.lrs.config`: plain `os.getenv` readers, no settings
object, so a value can be flipped in App Service without a code change.

Every value the ministry issues (discovery URL, client id/secret, scope strings,
role codes) is read here and nowhere else. Until they arrive, `is_enabled()` is
false and the app keeps its local password login.
"""

from __future__ import annotations

import json
import os
from typing import Any, Optional

# Client authentication at the token endpoint. The ministry has not yet told us
# which it expects, so it is configurable rather than guessed.
AUTH_METHODS = ("client_secret_post", "client_secret_basic")


def _get(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def _flag(name: str, default: bool = False) -> bool:
    raw = _get(name)
    if not raw:
        return default
    return raw.lower() in {"1", "true", "yes", "on"}


def is_production() -> bool:
    return _get("ENVIRONMENT").lower() in {"production", "prod"}


def is_enabled() -> bool:
    """True once a discovery URL and a client id exist.

    Deliberately derived rather than a separate flag: an operator who fills in
    half the configuration gets local login, not a login button that 500s.
    """
    if not _flag("MOE_OIDC_ENABLED", True):
        return False
    return bool(discovery_url() and client_id())


def discovery_url() -> str:
    return _get("MOE_OIDC_DISCOVERY_URL")


def issuer() -> str:
    """Expected `iss`. Falls back to the discovery document's own issuer."""
    return _get("MOE_OIDC_ISSUER")


def client_id() -> str:
    return _get("MOE_OIDC_CLIENT_ID")


def client_secret() -> str:
    return _get("MOE_OIDC_CLIENT_SECRET")


def scopes() -> str:
    return _get("MOE_OIDC_SCOPES", "openid profile")


def token_auth_method() -> str:
    method = _get("MOE_OIDC_TOKEN_AUTH_METHOD", "client_secret_post")
    return method if method in AUTH_METHODS else "client_secret_post"


def use_pkce() -> bool:
    return _flag("MOE_OIDC_PKCE", True)


def public_app_url() -> str:
    return (_get("PUBLIC_APP_URL") or _get("FRONTEND_URL")).rstrip("/")


def redirect_uri() -> str:
    """Must match what was declared on the ministry connection form."""
    explicit = _get("MOE_OIDC_REDIRECT_URI")
    if explicit:
        return explicit
    base = public_app_url() or "http://localhost:8720"
    return f"{base}/api/auth/moe/callback"


def logout_url() -> str:
    """Ministry logout, per the connection guidelines §5.2.ח.

    `{return}` is substituted with our own URL. Empty means "no ministry
    logout" — the local cookie is still cleared either way.
    """
    template = _get(
        "MOE_OIDC_LOGOUT_URL",
        "https://is.remote.education.gov.il/nidp/jsp/logoutSuccess.jsp?logoutURL={return}",
    )
    if not template:
        return ""
    return template.replace("{return}", public_app_url() or "")


def http_timeout_seconds() -> float:
    try:
        return float(_get("MOE_OIDC_TIMEOUT_SECONDS", "12"))
    except ValueError:
        return 12.0


def clock_skew_seconds() -> int:
    try:
        return int(_get("MOE_OIDC_CLOCK_SKEW_SECONDS", "60"))
    except ValueError:
        return 60


def id_pepper() -> str:
    """HMAC key that turns an exidentifier into our opaque `learner_id`.

    Rotating it re-keys every learner, orphaning their brain — so production
    refuses to start a sign-in without an explicit value rather than silently
    deriving ids from a shared default.
    """
    pepper = _get("MOE_ID_PEPPER")
    if pepper:
        return pepper
    if is_production():
        raise RuntimeError("MOE_ID_PEPPER must be set in production")
    return "yuvi720-dev-pepper"


def supplier_code() -> str:
    """Our ministry supplier code (8800000xxx), used to recognise our own
    support staff arriving through the ministry (operations appendix §ב)."""
    return _get("MOE_SUPPLIER_CODE")


def role_map() -> dict[str, Any]:
    """Ministry role codes → app roles, as JSON.

    Kept in configuration because the ministry has not published the full
    `orgrolessimple` table yet and will extend it; a code list in the image
    would mean a redeploy per ministry change.

        {"teacher": ["..."], "student": ["..."], "support": ["793","794","795"]}
    """
    raw = _get("MOE_ROLE_MAP_JSON")
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        print("⚠️ MOE_ROLE_MAP_JSON is not valid JSON — falling back to defaults")
        return {}
    return parsed if isinstance(parsed, dict) else {}


def mock_enabled() -> bool:
    """Serve the in-process development IdP. Never in production."""
    return _flag("MOE_OIDC_MOCK") and not is_production()


def local_login_enabled() -> bool:
    """Username/password login. Team development only — the ministry is the
    only identity source in production."""
    return _flag("AUTH_LOCAL_LOGIN_ENABLED", not is_production())


def post_login_redirect() -> str:
    """Where the callback drops the browser. The app router then sends the user
    to the right home for their role."""
    return _get("MOE_OIDC_POST_LOGIN_PATH", "/")


def missing_settings() -> list[str]:
    """Configuration the ministry still owes us, for the startup log."""
    required = {
        "MOE_OIDC_DISCOVERY_URL": discovery_url(),
        "MOE_OIDC_CLIENT_ID": client_id(),
        "MOE_OIDC_CLIENT_SECRET": client_secret(),
    }
    return [name for name, value in required.items() if not value]


def optional_issuer() -> Optional[str]:
    return issuer() or None
