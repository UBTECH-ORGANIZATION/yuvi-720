"""HTTP calls to the Ministry's OIDC endpoints.

Nothing here logs a code, a token or a claim value — an exception carries only
the endpoint and the HTTP status.
"""

from __future__ import annotations

from typing import Any, Optional
from urllib.parse import urlencode

import httpx

from app.auth.moe import config, discovery


class OidcError(Exception):
    """A login that cannot continue. `code` is safe to show a browser."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


async def build_authorization_url(*, state: str, nonce: str, challenge: str) -> str:
    endpoint = await discovery.endpoint("authorization_endpoint")
    query = urlencode(
        {
            "response_type": "code",
            "client_id": config.client_id(),
            "redirect_uri": config.redirect_uri(),
            "scope": config.scopes(),
            "state": state,
            "nonce": nonce,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )
    return f"{endpoint}?{query}"


async def exchange_code(*, code: str, code_verifier: str) -> dict[str, Any]:
    endpoint = await discovery.endpoint("token_endpoint")
    form: dict[str, str] = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": config.redirect_uri(),
        "code_verifier": code_verifier,
        "client_id": config.client_id(),
    }
    auth: Optional[tuple[str, str]] = None
    if config.token_auth_method() == "client_secret_basic":
        auth = (config.client_id(), config.client_secret())
    else:
        form["client_secret"] = config.client_secret()

    try:
        async with httpx.AsyncClient(timeout=config.http_timeout_seconds()) as client:
            response = await client.post(
                endpoint,
                data=form,
                auth=auth,
                headers={"Accept": "application/json"},
            )
    except httpx.HTTPError:
        raise OidcError("provider_unreachable")

    if response.status_code >= 400:
        print(f"⚠️ MoE token exchange rejected: HTTP {response.status_code}")
        raise OidcError("token_exchange_failed")
    try:
        payload = response.json()
    except ValueError:
        raise OidcError("token_exchange_failed")
    if not isinstance(payload, dict) or not payload.get("id_token"):
        raise OidcError("missing_id_token")
    return payload


async def fetch_userinfo(access_token: str) -> dict[str, Any]:
    """Best-effort: the id_token is the authority, userinfo only fills gaps.

    The Ministry puts the `eduorg` / `edustudent` scope claims here rather than
    in the id_token, so a failure is degraded-but-usable, not fatal.
    """
    endpoint = await discovery.endpoint("userinfo_endpoint")
    if not endpoint or not access_token:
        return {}
    try:
        async with httpx.AsyncClient(timeout=config.http_timeout_seconds()) as client:
            response = await client.get(
                endpoint,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/json",
                },
            )
        if response.status_code >= 400:
            print(f"⚠️ MoE userinfo rejected: HTTP {response.status_code}")
            return {}
        payload = response.json()
    except (httpx.HTTPError, ValueError):
        return {}
    return payload if isinstance(payload, dict) else {}


async def build_end_session_url(id_token: Optional[str]) -> str:
    """RP-initiated logout, with the Ministry's `logoutURL` page as fallback.

    Their `logoutSuccess.jsp?logoutURL=` form is non-standard but is what the
    integration document specifies, so it is what we fall back to.
    """
    return_to = config.post_logout_url()
    endpoint = await discovery.endpoint("end_session_endpoint")
    if endpoint and id_token:
        query = urlencode(
            {"id_token_hint": id_token, "post_logout_redirect_uri": return_to}
        )
        return f"{endpoint}?{query}"
    return f"{config.logout_page()}?{urlencode({'logoutURL': return_to})}"
