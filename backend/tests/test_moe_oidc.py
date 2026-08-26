"""The parts of ministry sign-in that are security, not plumbing.

Every test here is a refusal: a token that must not be accepted, a `state` that
must not work twice, a `return_to` that must not leave the app. The happy path
is covered end to end against the development IdP; these cover what an attacker
would try instead.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.auth.moe import client, transactions
from app.routes.auth_moe import _safe_return_to

ISSUER = "https://idp.example.test"
CLIENT_ID = "yuvilab-test"

_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def run(coro):
    return asyncio.run(coro)


def sign(claims: dict, *, key=_key, algorithm: str = "RS256") -> str:
    return jwt.encode(claims, key, algorithm=algorithm, headers={"kid": "k1"})


def forge_hs256(claims: dict, secret: bytes) -> str:
    """Hand-rolled because PyJWT refuses to *encode* HS256 with a public key —
    which is exactly why an attacker would assemble the token themselves."""
    def segment(data: dict) -> bytes:
        raw = json.dumps(data, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(raw).rstrip(b"=")

    signing_input = (
        segment({"alg": "HS256", "typ": "JWT", "kid": "k1"}) + b"." + segment(claims)
    )
    signature = base64.urlsafe_b64encode(
        hmac.new(secret, signing_input, hashlib.sha256).digest()
    ).rstrip(b"=")
    return (signing_input + b"." + signature).decode("ascii")


def base_claims(**overrides) -> dict:
    now = int(time.time())
    return {
        "iss": ISSUER,
        "aud": CLIENT_ID,
        "sub": "1003106405",
        "iat": now,
        "exp": now + 600,
        "nonce": "the-nonce",
        "exidentifier": "1003106405",
        **overrides,
    }


class IdTokenVerificationTest(unittest.TestCase):
    def verify(self, token: str, *, nonce: str = "the-nonce"):
        with patch.dict("os.environ", {"MOE_OIDC_CLIENT_ID": CLIENT_ID}), \
             patch.object(client, "_signing_key", new=AsyncMock(return_value=_key.public_key())), \
             patch.object(client, "expected_issuer", new=AsyncMock(return_value=ISSUER)):
            return run(client.verify_id_token(token, nonce=nonce))

    def test_valid_token_is_accepted(self):
        claims = self.verify(sign(base_claims()))
        self.assertEqual(claims["exidentifier"], "1003106405")

    def test_signature_from_another_key_is_rejected(self):
        with self.assertRaises(client.MoeOidcError):
            self.verify(sign(base_claims(), key=_other_key))

    def test_wrong_audience_is_rejected(self):
        with self.assertRaises(client.MoeOidcError):
            self.verify(sign(base_claims(aud="someone-else")))

    def test_wrong_issuer_is_rejected(self):
        with self.assertRaises(client.MoeOidcError):
            self.verify(sign(base_claims(iss="https://evil.example")))

    def test_expired_token_is_rejected(self):
        past = int(time.time()) - 4000
        with self.assertRaises(client.MoeOidcError):
            self.verify(sign(base_claims(iat=past, exp=past + 600)))

    def test_replayed_nonce_is_rejected(self):
        # A token minted for a *different* login attempt of ours. Signature,
        # issuer and audience all check out; only the nonce says it is not this
        # browser's login.
        with self.assertRaises(client.MoeOidcError):
            self.verify(sign(base_claims(nonce="someone-elses-nonce")))

    def test_unsigned_token_is_rejected(self):
        token = jwt.encode(base_claims(), key=None, algorithm="none")
        with self.assertRaises(client.MoeOidcError) as caught:
            self.verify(token)
        self.assertIn("unsupported", str(caught.exception))

    def test_hs256_signed_with_the_public_key_is_rejected(self):
        # Algorithm confusion: the public key is public, so if HS256 were
        # allowed anyone could mint a token with it.
        public_pem = _key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        with self.assertRaises(client.MoeOidcError) as caught:
            self.verify(forge_hs256(base_claims(), public_pem))
        self.assertIn("unsupported", str(caught.exception))


class TransactionTest(unittest.TestCase):
    def setUp(self):
        # No Mongo in tests: exercise the in-memory path deliberately.
        patcher = patch.object(transactions, "_collection", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_state_works_exactly_once(self):
        state = run(transactions.create(
            nonce="n", code_verifier="v", return_to="/student-dashboard"))
        first = run(transactions.consume(state))
        self.assertEqual(first["return_to"], "/student-dashboard")
        # The replay defence: a second callback with the same state gets nothing.
        self.assertIsNone(run(transactions.consume(state)))

    def test_unknown_state_is_none(self):
        self.assertIsNone(run(transactions.consume("never-issued")))


class ReturnToTest(unittest.TestCase):
    def test_in_app_paths_are_kept(self):
        self.assertEqual(_safe_return_to("/teacher/students"), "/teacher/students")

    def test_absolute_urls_are_dropped(self):
        self.assertEqual(_safe_return_to("https://evil.example/steal"), "/")

    def test_scheme_relative_urls_are_dropped(self):
        # `//evil.example` is a URL, not a path — the classic open-redirect miss.
        self.assertEqual(_safe_return_to("//evil.example"), "/")

    def test_backslash_is_dropped(self):
        self.assertEqual(_safe_return_to("/\\evil.example"), "/")


class PkceTest(unittest.TestCase):
    def test_challenge_is_derived_from_the_verifier(self):
        verifier = client.generate_pkce_verifier()
        self.assertEqual(
            client.pkce_challenge(verifier), client.pkce_challenge(verifier))
        self.assertNotEqual(
            client.pkce_challenge(verifier),
            client.pkce_challenge(client.generate_pkce_verifier()),
        )


if __name__ == "__main__":
    unittest.main()
