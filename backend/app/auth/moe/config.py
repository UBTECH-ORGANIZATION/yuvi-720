"""MoE OIDC settings, read from the environment at call time.

Read at call time rather than at import so tests and the deploy pipeline can
change a slot setting without re-importing the package.
"""

from __future__ import annotations

import os
from typing import Optional

from app.core.env import is_local

# The Ministry's dev tenant. Discovery overrides these at runtime; they are the
# fallback for the case where `.well-known` is unreachable mid-incident.
DEFAULT_ISSUER = "https://is.remote.education.gov.il/nidp/oauth/nam"
DEFAULT_SCOPES = "openid profileEXT eduorg edustudent"
DEFAULT_REDIRECT_PATH = "/api/auth/moe/callback"
DEFAULT_AUTHORIZE_ENDPOINT = f"{DEFAULT_ISSUER}/authz"
DEFAULT_TOKEN_ENDPOINT = f"{DEFAULT_ISSUER}/token"
DEFAULT_USERINFO_ENDPOINT = f"{DEFAULT_ISSUER}/userinfo"
DEFAULT_JWKS_ENDPOINT = f"{DEFAULT_ISSUER}/keys"
DEFAULT_END_SESSION_ENDPOINT = (
    "https://is.remote.education.gov.il/nidp/oauth/v1/nam/end_session"
)
# The Ministry's non-standard logout: it takes the return address in a
# `logoutURL` query parameter rather than `post_logout_redirect_uri`.
DEFAULT_LOGOUT_PAGE = "https://is.remote.education.gov.il/nidp/jsp/logoutSuccess.jsp"


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def is_enabled() -> bool:
    """Off by default so a slot without Ministry credentials boots normally."""
    return _env("MOE_OIDC_ENABLED").lower() in {"1", "true", "yes", "on"}


def client_id() -> str:
    return _env("MOE_OIDC_CLIENT_ID")


def client_secret() -> str:
    return _env("MOE_OIDC_CLIENT_SECRET")


def issuer() -> str:
    return _env("MOE_OIDC_ISSUER", DEFAULT_ISSUER)


def discovery_url() -> str:
    return _env(
        "MOE_OIDC_DISCOVERY_URL", f"{issuer()}/.well-known/openid-configuration"
    )


def scopes() -> str:
    return _env("MOE_OIDC_SCOPES", DEFAULT_SCOPES)


def token_auth_method() -> str:
    """`client_secret_basic` or `client_secret_post` — confirmed per tenant."""
    method = _env("MOE_OIDC_TOKEN_AUTH_METHOD", "client_secret_basic").lower()
    return method if method in {"client_secret_basic", "client_secret_post"} else "client_secret_basic"


def redirect_path() -> str:
    path = _env("MOE_OIDC_REDIRECT_PATH", DEFAULT_REDIRECT_PATH)
    return path if path.startswith("/") else f"/{path}"


def redirect_uri() -> str:
    """Must match the Ministry's registration byte for byte, or the token
    exchange fails with `invalid_grant` and no further explanation."""
    base = (
        _env("PUBLIC_APP_URL") or _env("FRONTEND_URL") or "http://localhost:8000"
    ).rstrip("/")
    return f"{base}{redirect_path()}"


def post_logout_url() -> str:
    """Where the Ministry sends the browser after it tears down its session."""
    explicit = _env("MOE_OIDC_POST_LOGOUT_URL")
    if explicit:
        return explicit
    return (_env("PUBLIC_APP_URL") or _env("FRONTEND_URL") or "http://localhost:8000").rstrip("/")


def logout_page() -> str:
    return _env("MOE_OIDC_LOGOUT_PAGE", DEFAULT_LOGOUT_PAGE)


def jwks_ttl_seconds() -> int:
    try:
        return max(60, int(_env("MOE_OIDC_JWKS_TTL_SECONDS", "3600")))
    except ValueError:
        return 3600


def http_timeout_seconds() -> float:
    try:
        return max(1.0, float(_env("MOE_OIDC_HTTP_TIMEOUT_SECONDS", "10")))
    except ValueError:
        return 10.0


def learner_id_salt() -> str:
    """Salts the OIDC subject into our pseudonymous learner_id.

    Deliberately not `SECRET_KEY`: rotating the session secret must not orphan
    every learner's brain document.
    """
    salt = _env("MOE_LEARNER_ID_SALT")
    if salt:
        return salt
    if not is_local():
        raise RuntimeError("MOE_LEARNER_ID_SALT must be set outside local development")
    return "yuvi720-local-moe-salt"


def verify_configuration() -> Optional[str]:
    """Return the name of the first missing setting, or None when usable."""
    if not is_enabled():
        return None
    for name, value in (
        ("MOE_OIDC_CLIENT_ID", client_id()),
        ("MOE_OIDC_CLIENT_SECRET", client_secret()),
    ):
        if not value:
            return name
    try:
        learner_id_salt()
    except RuntimeError:
        return "MOE_LEARNER_ID_SALT"
    return None
