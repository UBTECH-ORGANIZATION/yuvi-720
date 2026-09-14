"""id_token validation against the Ministry's JWKS.

Every check the spec calls for is here and none is optional: signature,
issuer, audience, expiry, and the nonce that binds the token to the browser
that started this login. A token missing any of them is a token we cannot
attribute to the person in front of us.
"""

from __future__ import annotations

from typing import Any

import jwt
from jwt.algorithms import RSAAlgorithm

from app.auth.moe import config, discovery
from app.auth.moe.client import OidcError

_LEEWAY_SECONDS = 60


def _key_for(kid: str | None, keys: list[dict[str, Any]]) -> Any:
    for key in keys:
        if kid is None or key.get("kid") == kid:
            return RSAAlgorithm.from_jwk(key)
    return None


async def verify_id_token(id_token: str, *, nonce: str) -> dict[str, Any]:
    try:
        header = jwt.get_unverified_header(id_token)
    except jwt.PyJWTError:
        raise OidcError("bad_id_token")

    kid = header.get("kid")
    key_set = await discovery.jwks()
    key = _key_for(kid, list(key_set.get("keys") or []))
    if key is None:
        # An unknown kid is the Ministry rotating a key, not an attack — refetch
        # once before giving up.
        key_set = await discovery.jwks(force_refresh=True)
        key = _key_for(kid, list(key_set.get("keys") or []))
    if key is None:
        raise OidcError("unknown_signing_key")

    algorithm = header.get("alg") or "RS256"
    if algorithm not in {"RS256", "RS384", "RS512"}:
        # Never take the algorithm from the token alone: "none" and HS256 signed
        # with the public key are the two classic id_token forgeries.
        raise OidcError("unsupported_algorithm")

    try:
        claims = jwt.decode(
            id_token,
            key=key,
            algorithms=[algorithm],
            audience=config.client_id(),
            issuer=await discovery.endpoint("issuer") or config.issuer(),
            leeway=_LEEWAY_SECONDS,
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
        )
    except jwt.PyJWTError as exc:
        print(f"⚠️ MoE id_token rejected: {type(exc).__name__}")
        raise OidcError("bad_id_token")

    if claims.get("nonce") != nonce:
        raise OidcError("nonce_mismatch")
    if not str(claims.get("sub") or "").strip():
        raise OidcError("missing_subject")
    return claims
