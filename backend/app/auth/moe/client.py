"""OpenID Connect relying-party transport for the ministry IdP.

Authorization Code + PKCE, verified server-side. The browser never receives a
ministry token: it arrives on our redirect URI, is validated here, and is
discarded once the profile has been read out of it.

Nothing is logged but exception *types* — an id_token, an access token and an
authorization code are all bearer credentials.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import os
import time
import urllib.parse
from typing import Any, Optional

import httpx
import jwt
from jwt import PyJWKSet

from app.auth.moe import config

_SUPPORTED_ALGORITHMS = ("RS256", "RS384", "RS512", "ES256", "ES384")

# Discovery and JWKS are stable for hours; both are re-read on a cache miss.
_DISCOVERY_TTL_SECONDS = 3600.0
_JWKS_TTL_SECONDS = 3600.0
# A key rotation must not be able to make us hammer the ministry's JWKS.
_JWKS_MIN_REFETCH_SECONDS = 30.0


class MoeOidcError(RuntimeError):
    """Sign-in could not be completed. Message is safe to log, never to show."""


_discovery_cache: Optional[dict[str, Any]] = None
_discovery_expires_at = 0.0
_discovery_lock = asyncio.Lock()

_jwks_cache: Optional[PyJWKSet] = None
_jwks_expires_at = 0.0
_jwks_fetched_at = 0.0
_jwks_lock = asyncio.Lock()


def reset_caches() -> None:
    """Drop discovery + JWKS state. For tests and for the dev IdP restart."""
    global _discovery_cache, _discovery_expires_at, _jwks_cache
    global _jwks_expires_at, _jwks_fetched_at
    _discovery_cache = None
    _discovery_expires_at = 0.0
    _jwks_cache = None
    _jwks_expires_at = 0.0
    _jwks_fetched_at = 0.0


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=config.http_timeout_seconds())


async def discovery() -> dict[str, Any]:
    """The ministry's `openid-configuration`, cached."""
    global _discovery_cache, _discovery_expires_at
    now = time.monotonic()
    if _discovery_cache is not None and now < _discovery_expires_at:
        return _discovery_cache

    async with _discovery_lock:
        now = time.monotonic()
        if _discovery_cache is not None and now < _discovery_expires_at:
            return _discovery_cache
        url = config.discovery_url()
        if not url:
            raise MoeOidcError("MOE_OIDC_DISCOVERY_URL is not configured")
        try:
            async with _client() as client:
                response = await client.get(url)
                response.raise_for_status()
                document = response.json()
        except Exception as exc:
            raise MoeOidcError(f"discovery fetch failed: {type(exc).__name__}") from exc
        if not isinstance(document, dict) or not document.get("authorization_endpoint"):
            raise MoeOidcError("discovery document is not a valid OpenID configuration")
        _discovery_cache = document
        _discovery_expires_at = time.monotonic() + _DISCOVERY_TTL_SECONDS
        return document


async def _endpoint(name: str) -> str:
    document = await discovery()
    value = document.get(name)
    if not isinstance(value, str) or not value:
        raise MoeOidcError(f"discovery document has no {name}")
    return value


async def expected_issuer() -> str:
    configured = config.optional_issuer()
    if configured:
        return configured
    return await _endpoint("issuer")


async def _jwks(*, force: bool = False) -> PyJWKSet:
    global _jwks_cache, _jwks_expires_at, _jwks_fetched_at
    now = time.monotonic()
    if not force and _jwks_cache is not None and now < _jwks_expires_at:
        return _jwks_cache

    async with _jwks_lock:
        now = time.monotonic()
        if not force and _jwks_cache is not None and now < _jwks_expires_at:
            return _jwks_cache
        if force and now - _jwks_fetched_at < _JWKS_MIN_REFETCH_SECONDS:
            if _jwks_cache is not None:
                return _jwks_cache
        url = await _endpoint("jwks_uri")
        try:
            async with _client() as client:
                response = await client.get(url)
                response.raise_for_status()
                payload = response.json()
            key_set = PyJWKSet.from_dict(payload)
        except Exception as exc:
            raise MoeOidcError(f"jwks fetch failed: {type(exc).__name__}") from exc
        _jwks_cache = key_set
        _jwks_fetched_at = time.monotonic()
        _jwks_expires_at = _jwks_fetched_at + _JWKS_TTL_SECONDS
        return key_set


async def _signing_key(kid: Optional[str]) -> Any:
    """The key for this token's `kid`, re-fetching the set once on a miss.

    An unknown kid is the normal shape of a key rotation, not an attack, so it
    is worth exactly one extra round trip — rate-limited above so a stream of
    forged kids cannot turn into a stream of requests to the ministry.
    """
    for force in (False, True):
        key_set = await _jwks(force=force)
        for key in key_set.keys:
            if kid is None or key.key_id == kid:
                return key.key
    raise MoeOidcError("no signing key matches the token kid")


def generate_pkce_verifier() -> str:
    return base64.urlsafe_b64encode(os.urandom(64)).decode("ascii").rstrip("=")


def pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


async def build_authorization_url(
    *, state: str, nonce: str, code_challenge: Optional[str]
) -> str:
    params = {
        "response_type": "code",
        "client_id": config.client_id(),
        "redirect_uri": config.redirect_uri(),
        "scope": config.scopes(),
        "state": state,
        "nonce": nonce,
    }
    if code_challenge:
        params["code_challenge"] = code_challenge
        params["code_challenge_method"] = "S256"
    endpoint = await _endpoint("authorization_endpoint")
    separator = "&" if "?" in endpoint else "?"
    return f"{endpoint}{separator}{urllib.parse.urlencode(params)}"


async def exchange_code(code: str, code_verifier: Optional[str]) -> dict[str, Any]:
    """Authorization code → token response. Never logs the code or the tokens."""
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": config.redirect_uri(),
        "client_id": config.client_id(),
    }
    if code_verifier:
        data["code_verifier"] = code_verifier

    auth: Optional[tuple[str, str]] = None
    if config.token_auth_method() == "client_secret_basic":
        auth = (config.client_id(), config.client_secret())
    else:
        data["client_secret"] = config.client_secret()

    endpoint = await _endpoint("token_endpoint")
    try:
        async with _client() as client:
            response = await client.post(endpoint, data=data, auth=auth)
    except Exception as exc:
        raise MoeOidcError(f"token request failed: {type(exc).__name__}") from exc
    if response.status_code >= 400:
        # The body can echo the code back; only the status is safe to surface.
        raise MoeOidcError(f"token endpoint returned {response.status_code}")
    try:
        payload = response.json()
    except ValueError as exc:
        raise MoeOidcError("token endpoint returned a non-JSON body") from exc
    if not isinstance(payload, dict) or not payload.get("id_token"):
        raise MoeOidcError("token response carries no id_token")
    return payload


async def verify_id_token(id_token: str, *, nonce: str) -> dict[str, Any]:
    """Validate signature, issuer, audience, expiry and nonce. Returns claims."""
    try:
        header = jwt.get_unverified_header(id_token)
    except jwt.PyJWTError as exc:
        raise MoeOidcError("id_token header is unreadable") from exc

    algorithm = header.get("alg")
    if algorithm not in _SUPPORTED_ALGORITHMS:
        # Blocks `none` and, more importantly, HS256 signed with a value an
        # attacker can guess — the classic algorithm-confusion swap.
        raise MoeOidcError(f"unsupported id_token algorithm: {algorithm}")

    key = await _signing_key(header.get("kid"))
    try:
        claims = jwt.decode(
            id_token,
            key,
            algorithms=[algorithm],
            audience=config.client_id(),
            issuer=await expected_issuer(),
            leeway=config.clock_skew_seconds(),
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
        )
    except jwt.PyJWTError as exc:
        raise MoeOidcError(f"id_token rejected: {type(exc).__name__}") from exc

    if claims.get("nonce") != nonce:
        # Without this an attacker can replay a token minted for another of our
        # own login attempts; state alone does not bind the token to the browser.
        raise MoeOidcError("id_token nonce does not match the login transaction")
    return claims


async def fetch_userinfo(access_token: str) -> dict[str, Any]:
    """Best-effort userinfo.

    The ministry has not confirmed whether the type-3 attributes ride the
    id_token, the userinfo response, or both — so both are read and merged.
    A failure here is not a sign-in failure.
    """
    try:
        endpoint = await _endpoint("userinfo_endpoint")
    except MoeOidcError:
        return {}
    try:
        async with _client() as client:
            response = await client.get(
                endpoint, headers={"Authorization": f"Bearer {access_token}"}
            )
            if response.status_code >= 400:
                return {}
            payload = response.json()
    except Exception as exc:
        print(f"⚠️ MoE userinfo skipped: {type(exc).__name__}")
        return {}
    return payload if isinstance(payload, dict) else {}
