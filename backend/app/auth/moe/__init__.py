"""MoE "הזדהות אחידה" (unified identity) sign-in over OpenID Connect.

The ministry is the identity provider; this package is the relying party. It
only *authenticates* — every authorization decision stays ours (guidelines §4.3,
§4.4), so the ministry token can name a role but can never grant an admin scope.

PII boundary. The token carries a real person. Only `exidentifier` (the
scrambled 10-digit id, token type 3) is retained, and only on the `users`
document, where it feeds outbound LRS statements. `learner_id` — the key the
brain, the agents and every learning event use — is an HMAC of it, so nothing
downstream of `identity.py` can be reversed to a ministry identity.

Layout:
    config.py         env surface; everything the ministry issues lands here
    client.py         discovery · JWKS · authorization URL · code exchange
    transactions.py   one-shot server-side state/nonce/PKCE store
    claims.py         ministry claim names → a typed profile
    identity.py       exidentifier → opaque learner_id
    roles.py          ministry role codes → app roles
    provisioning.py   profile → `users` + org rows
"""
