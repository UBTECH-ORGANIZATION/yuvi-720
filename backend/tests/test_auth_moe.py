"""Ministry of Education OIDC sign-in — the checks that keep it a login and not a hole.

Everything here runs against a stub provider: a throwaway RSA key whose public
half is injected into the discovery cache. No network, no Mongo.

The bar these tests hold is deliberately one-sided. A false rejection is a child
who has to click "log in" twice; a false acceptance is a stranger holding a
child's account. So every negative case is asserted explicitly.
"""

from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.responses import RedirectResponse
from jwt.algorithms import RSAAlgorithm

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth.moe import claims as moe_claims
from app.auth.moe import client as moe_client
from app.auth.moe import config as moe_config
from app.auth.moe import discovery, provisioning, state, verify
from app.auth.moe import redirect as moe_redirect
from app.auth.moe.client import OidcError
from app.core import env as core_env
from app.routes import static_pages
from app.services import org_repository

ISSUER = "https://stub.example/nidp/oauth/nam"
CLIENT_ID = "stub-client-id"
KEY_ID = "stub-key-1"


def run(coro):
    return asyncio.run(coro)


class StubProvider:
    """A minimal RS256 issuer, so signature checks are exercised for real."""

    def __init__(self, kid: str = KEY_ID) -> None:
        self.kid = kid
        self.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        jwk = json.loads(RSAAlgorithm.to_jwk(self.private_key.public_key()))
        jwk["kid"] = kid
        jwk["alg"] = "RS256"
        jwk["use"] = "sig"
        self.jwks = {"keys": [jwk]}

    def id_token(self, **overrides) -> str:
        now = datetime.now(timezone.utc)
        payload = {
            "iss": ISSUER,
            "aud": CLIENT_ID,
            "sub": "moe-subject-0001",
            "iat": now,
            "exp": now + timedelta(minutes=5),
            "nonce": "the-nonce",
        }
        payload.update(overrides)
        headers = {"kid": overrides.pop("kid", self.kid)}
        return jwt.encode(
            payload, self.private_key, algorithm="RS256", headers=headers
        )


class MoeOidcTestCase(unittest.TestCase):
    """Shared stub-provider wiring: config env, discovery cache, JSON org store."""

    def setUp(self) -> None:
        import os

        self.provider = StubProvider()
        self._env_backup = {
            key: os.environ.get(key)
            for key in (
                "MOE_OIDC_ENABLED",
                "MOE_OIDC_CLIENT_ID",
                "MOE_OIDC_CLIENT_SECRET",
                "MOE_OIDC_ISSUER",
                "MOE_OIDC_REDIRECT_PATH",
                "MOE_OIDC_REDIRECT_URI",
                "MOE_LEARNER_ID_SALT",
                "PUBLIC_APP_URL",
                "SPARK_ENVIRONMENT",
                "ENVIRONMENT",
                "SECRET_KEY",
            )
        }
        os.environ.update(
            {
                "MOE_OIDC_ENABLED": "true",
                "MOE_OIDC_CLIENT_ID": CLIENT_ID,
                "MOE_OIDC_CLIENT_SECRET": "stub-secret",
                "MOE_OIDC_ISSUER": ISSUER,
                "MOE_OIDC_REDIRECT_PATH": "/api/auth/moe/callback",
                "MOE_LEARNER_ID_SALT": "test-salt",
                "PUBLIC_APP_URL": "https://dev.spark.yuvilab.ai",
                "SECRET_KEY": "test-signing-secret-value",
            }
        )
        # The override is opt-in; a developer's own shell must not leak into it.
        os.environ.pop("MOE_OIDC_REDIRECT_URI", None)
        self._os = os

        discovery.reset_cache()
        discovery._metadata = {
            "issuer": ISSUER,
            "authorization_endpoint": f"{ISSUER}/authz",
            "token_endpoint": f"{ISSUER}/token",
            "userinfo_endpoint": f"{ISSUER}/userinfo",
            "jwks_uri": f"{ISSUER}/keys",
            "end_session_endpoint": f"{ISSUER}/end_session",
        }
        discovery._metadata_expires_at = time.time() + 3600
        discovery._jwks = self.provider.jwks
        discovery._jwks_expires_at = time.time() + 3600

    def tearDown(self) -> None:
        for key, value in self._env_backup.items():
            if value is None:
                self._os.environ.pop(key, None)
            else:
                self._os.environ[key] = value
        discovery.reset_cache()


class AuthorizationRequestTest(MoeOidcTestCase):
    def test_authorization_url_carries_every_required_parameter(self) -> None:
        transaction = state.create_transaction(return_to="/student-dashboard")
        url = run(
            moe_client.build_authorization_url(
                state=transaction["state"],
                nonce=transaction["nonce"],
                challenge=transaction["code_challenge"],
            )
        )
        query = parse_qs(urlparse(url).query)

        self.assertEqual(query["response_type"], ["code"])
        self.assertEqual(query["client_id"], [CLIENT_ID])
        self.assertEqual(query["code_challenge_method"], ["S256"])
        self.assertEqual(query["state"], [transaction["state"]])
        self.assertEqual(query["nonce"], [transaction["nonce"]])
        # Must match what the Ministry registered, character for character.
        self.assertEqual(
            query["redirect_uri"], ["https://dev.spark.yuvilab.ai/api/auth/moe/callback"]
        )

    def test_pkce_challenge_is_the_sha256_of_the_verifier(self) -> None:
        transaction = state.create_transaction()
        self.assertEqual(
            transaction["code_challenge"],
            state.code_challenge(transaction["code_verifier"]),
        )
        self.assertNotEqual(transaction["code_verifier"], transaction["code_challenge"])

    def test_each_transaction_is_unique(self) -> None:
        first = state.create_transaction()
        second = state.create_transaction()
        self.assertNotEqual(first["state"], second["state"])
        self.assertNotEqual(first["nonce"], second["nonce"])
        self.assertNotEqual(first["code_verifier"], second["code_verifier"])


class ReturnToTest(MoeOidcTestCase):
    def test_absolute_urls_are_refused(self) -> None:
        """`return_to` is attacker-controlled; an absolute URL here would make
        our login endpoint a laundering service for a phishing page."""
        for hostile in (
            "https://evil.example/steal",
            "//evil.example/steal",
            "http://evil.example",
            "javascript:alert(1)",
            "",
            None,
        ):
            self.assertEqual(state.sanitize_return_to(hostile), "/", msg=repr(hostile))

    def test_relative_paths_survive(self) -> None:
        self.assertEqual(state.sanitize_return_to("/teacher"), "/teacher")
        self.assertEqual(
            state.sanitize_return_to("/lesson?unit=3"), "/lesson?unit=3"
        )


class TransactionCookieTest(MoeOidcTestCase):
    def test_round_trip(self) -> None:
        transaction = state.create_transaction(return_to="/teacher")
        decoded = state.decode_transaction(state.encode_transaction(transaction))
        self.assertIsNotNone(decoded)
        assert decoded is not None
        self.assertEqual(decoded["state"], transaction["state"])
        self.assertEqual(decoded["cv"], transaction["code_verifier"])
        self.assertEqual(decoded["rt"], "/teacher")

    def test_tampered_or_missing_cookie_is_rejected(self) -> None:
        token = state.encode_transaction(state.create_transaction())
        self.assertIsNone(state.decode_transaction(None))
        self.assertIsNone(state.decode_transaction(""))
        self.assertIsNone(state.decode_transaction(token + "x"))
        self.assertIsNone(state.decode_transaction("not-a-jwt"))

    def test_cookie_signed_with_another_secret_is_rejected(self) -> None:
        """The cookie is the CSRF defence; forging one must require our key."""
        payload = {
            "state": "attacker-state",
            "nonce": "n",
            "cv": "v",
            "rt": "/",
            "iss": "yuvilab-spark",
            "aud": "yuvilab-spark-oidc-tx",
            "iat": datetime.now(timezone.utc),
            "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
        }
        forged = jwt.encode(payload, "a-different-secret", algorithm="HS256")
        self.assertIsNone(state.decode_transaction(forged))

    def test_expired_transaction_is_rejected(self) -> None:
        past = datetime.now(timezone.utc) - timedelta(minutes=30)
        from app.core.env import signing_secret

        expired = jwt.encode(
            {
                "state": "s",
                "nonce": "n",
                "cv": "v",
                "rt": "/",
                "iss": "yuvilab-spark",
                "aud": "yuvilab-spark-oidc-tx",
                "iat": past,
                "exp": past + timedelta(minutes=10),
            },
            signing_secret(),
            algorithm="HS256",
        )
        self.assertIsNone(state.decode_transaction(expired))


class IdTokenVerificationTest(MoeOidcTestCase):
    def test_valid_token_is_accepted(self) -> None:
        claims = run(
            verify.verify_id_token(self.provider.id_token(), nonce="the-nonce")
        )
        self.assertEqual(claims["sub"], "moe-subject-0001")

    def test_wrong_nonce_is_rejected(self) -> None:
        """Without this check a token captured from another login could be
        replayed into this browser's session."""
        with self.assertRaises(OidcError) as caught:
            run(verify.verify_id_token(self.provider.id_token(), nonce="different"))
        self.assertEqual(caught.exception.code, "nonce_mismatch")

    def test_wrong_audience_is_rejected(self) -> None:
        token = self.provider.id_token(aud="someone-elses-client")
        with self.assertRaises(OidcError):
            run(verify.verify_id_token(token, nonce="the-nonce"))

    def test_wrong_issuer_is_rejected(self) -> None:
        token = self.provider.id_token(iss="https://not-the-ministry.example")
        with self.assertRaises(OidcError):
            run(verify.verify_id_token(token, nonce="the-nonce"))

    def test_expired_token_is_rejected(self) -> None:
        past = datetime.now(timezone.utc) - timedelta(hours=2)
        token = self.provider.id_token(iat=past, exp=past + timedelta(minutes=5))
        with self.assertRaises(OidcError):
            run(verify.verify_id_token(token, nonce="the-nonce"))

    def test_token_signed_by_a_foreign_key_is_rejected(self) -> None:
        impostor = StubProvider()
        token = impostor.id_token()
        with self.assertRaises(OidcError):
            run(verify.verify_id_token(token, nonce="the-nonce"))
    def test_unsigned_token_is_rejected(self) -> None:
        """`alg: none` is the oldest JWT forgery there is."""
        token = jwt.encode(
            {
                "iss": ISSUER,
                "aud": CLIENT_ID,
                "sub": "intruder",
                "iat": datetime.now(timezone.utc),
                "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
                "nonce": "the-nonce",
            },
            key="",
            algorithm="none",
        )
        with self.assertRaises(OidcError):
            run(verify.verify_id_token(token, nonce="the-nonce"))

    def test_unknown_kid_triggers_one_jwks_refresh(self) -> None:
        """A key rotation must not lock the country out until the TTL expires."""
        rotated = StubProvider(kid="stub-key-2")
        token = rotated.id_token()
        refreshed: list[bool] = []

        async def fake_jwks(*, force_refresh: bool = False):
            refreshed.append(force_refresh)
            return rotated.jwks if force_refresh else self.provider.jwks

        original = discovery.jwks
        discovery.jwks = fake_jwks  # type: ignore[assignment]
        try:
            claims = run(verify.verify_id_token(token, nonce="the-nonce"))
        finally:
            discovery.jwks = original  # type: ignore[assignment]

        self.assertEqual(claims["sub"], "moe-subject-0001")
        self.assertEqual(refreshed, [False, True])


class ClaimMappingTest(MoeOidcTestCase):
    def test_learner_id_is_stable_and_not_the_national_id(self) -> None:
        first = moe_claims.derive_learner_id("moe-subject-0001")
        second = moe_claims.derive_learner_id("moe-subject-0001")
        self.assertEqual(first, second)
        self.assertTrue(first.startswith("moe_"))
        self.assertNotIn("moe-subject-0001", first)

    def test_different_subjects_get_different_learner_ids(self) -> None:
        self.assertNotEqual(
            moe_claims.derive_learner_id("a"), moe_claims.derive_learner_id("b")
        )

    def test_salt_change_changes_the_derivation(self) -> None:
        baseline = moe_claims.derive_learner_id("moe-subject-0001")
        self._os.environ["MOE_LEARNER_ID_SALT"] = "a-different-salt"
        self.assertNotEqual(moe_claims.derive_learner_id("moe-subject-0001"), baseline)

    def test_identity_keeps_the_exidentifier_out_of_the_learner_id(self) -> None:
        identity = moe_claims.build_identity(
            {"sub": "moe-subject-0001", "name": "דנה כהן"},
            {"exidentifier": "SCRAMBLED-123456789", "schoolSymbol": "544321", "nmm": "7-3"},
            granted_scopes="openid edustudent",
        )
        self.assertEqual(identity["exidentifier"], "SCRAMBLED-123456789")
        self.assertNotIn("SCRAMBLED", identity["learner_id"])
        self.assertEqual(identity["display_name"], "דנה כהן")
        self.assertEqual(identity["school_symbol"], "544321")
        self.assertEqual(identity["nmm_id"], "7-3")

    def test_missing_optional_claims_are_none_not_invented(self) -> None:
        identity = moe_claims.build_identity({"sub": "s"}, {})
        self.assertIsNone(identity["exidentifier"])
        self.assertIsNone(identity["school_symbol"])
        self.assertIsNone(identity["nmm_id"])
        self.assertEqual(identity["display_name"], "")

    def test_missing_subject_is_fatal(self) -> None:
        with self.assertRaises(ValueError):
            moe_claims.build_identity({"name": "no subject"}, {})

    def test_teacher_claim_wins_over_student_scope(self) -> None:
        """A homeroom teacher who is also enrolled somewhere must not be routed
        into a student dashboard."""
        roles = moe_claims.resolve_roles(
            {"role": "teacher"}, granted_scopes="openid edustudent eduorg"
        )
        self.assertEqual(roles, ["teacher"])

    def test_student_scope_maps_to_learner(self) -> None:
        self.assertEqual(
            moe_claims.resolve_roles({}, granted_scopes="openid edustudent"),
            ["learner"],
        )

    def test_unknown_affiliation_falls_back_to_the_least_privileged_role(self) -> None:
        self.assertEqual(moe_claims.resolve_roles({"role": "visitor"}), ["learner"])

    def test_admin_is_never_granted_from_claims(self) -> None:
        """Admin is a database grant. The Ministry cannot mint one by claim."""
        for value in ("admin", "administrator", "superuser", "root"):
            self.assertNotIn("admin", moe_claims.resolve_roles({"role": value}))

    def test_locale_falls_back_to_hebrew(self) -> None:
        self.assertEqual(moe_claims.build_identity({"sub": "s", "locale": "ar-IL"}, {})["locale"], "ar")
        self.assertEqual(moe_claims.build_identity({"sub": "s", "locale": "fr"}, {})["locale"], "he")
        self.assertEqual(moe_claims.build_identity({"sub": "s"}, {})["locale"], "he")


class ProvisioningTest(MoeOidcTestCase):
    def setUp(self) -> None:
        super().setUp()
        self._tmp = tempfile.TemporaryDirectory()
        self._org_file = org_repository.FALLBACK_ORG_FILE
        org_repository.FALLBACK_ORG_FILE = Path(self._tmp.name) / "org.json"
        self._org_getter = org_repository._get_collection_named
        org_repository._get_collection_named = lambda name: None  # type: ignore[assignment]

        self.users: dict[str, dict] = {}
        self.brains: dict[str, dict] = {}

        async def fake_get_user_by_id(user_id):
            return self.users.get(user_id)

        async def fake_upsert_user(document):
            self.users[document["_id"]] = dict(document)
            return dict(document)

        async def fake_get_brain(learner_id):
            return self.brains.setdefault(learner_id, {"_id": learner_id})

        async def fake_apply_brain_updates(learner_id, updates):
            self.brains.setdefault(learner_id, {"_id": learner_id}).update(updates)

        self._patches = []
        self._patch(provisioning, "get_user_by_id", fake_get_user_by_id)
        self._patch(provisioning, "upsert_user", fake_upsert_user)

        from app.brain import repository as brain_repository

        self._patch(brain_repository, "get_brain", fake_get_brain)
        self._patch(brain_repository, "apply_brain_updates", fake_apply_brain_updates)

    def _patch(self, module, name, replacement) -> None:
        self._patches.append((module, name, getattr(module, name)))
        setattr(module, name, replacement)

    def tearDown(self) -> None:
        for module, name, original in reversed(self._patches):
            setattr(module, name, original)
        org_repository.FALLBACK_ORG_FILE = self._org_file
        org_repository._get_collection_named = self._org_getter  # type: ignore[assignment]
        self._tmp.cleanup()
        super().tearDown()

    def _identity(self, **overrides) -> dict:
        identity = moe_claims.build_identity(
            {"sub": "moe-subject-0001", "name": "דנה כהן", "locale": "he"},
            {"exidentifier": "SCRAMBLED-123", "schoolSymbol": "544321", "nmm": "7-3"},
            granted_scopes="openid edustudent",
        )
        identity.update(overrides)  # type: ignore[typeddict-item]
        return identity

    def test_first_login_creates_user_brain_and_enrollment(self) -> None:
        identity = self._identity()
        user = run(provisioning.provision(identity))

        self.assertEqual(user["_id"], identity["learner_id"])
        self.assertEqual(user["roles"], ["learner"])
        self.assertEqual(user["identity_provider"], "moe")
        self.assertEqual(user["exidentifier"], "SCRAMBLED-123")
        self.assertIn(identity["learner_id"], self.brains)

        enrollments = run(
            org_repository.list_enrollments(
                learner_id=identity["learner_id"], group_id="7-3"
            )
        )
        self.assertEqual(len(enrollments), 1)

    def test_no_password_is_ever_written(self) -> None:
        """A Ministry account with a password hash would be a second door into
        it — one the Ministry cannot revoke."""
        user = run(provisioning.provision(self._identity()))
        self.assertNotIn("password", user)
        self.assertNotIn("must_change_password", user)

    def test_exidentifier_never_reaches_the_brain(self) -> None:
        identity = self._identity()
        run(provisioning.provision(identity))
        serialized = json.dumps(self.brains[identity["learner_id"]], ensure_ascii=False)
        self.assertNotIn("SCRAMBLED-123", serialized)
        self.assertNotIn("moe-subject-0001", serialized)

    def test_repeat_login_is_idempotent(self) -> None:
        identity = self._identity()
        run(provisioning.provision(identity))
        run(provisioning.provision(identity))
        run(provisioning.provision(identity))

        self.assertEqual(len(self.users), 1)
        enrollments = run(
            org_repository.list_enrollments(
                learner_id=identity["learner_id"], group_id="7-3"
            )
        )
        self.assertEqual(len(enrollments), 1)

    def test_repeat_login_does_not_reset_a_chosen_language(self) -> None:
        """Preferences belong to the learner. Re-asserting the Ministry's locale
        every morning would silently undo an in-app language switch."""
        identity = self._identity()
        run(provisioning.provision(identity))
        self.users[identity["learner_id"]]["preferences"]["language"] = "ar"

        user = run(provisioning.provision(identity))
        self.assertEqual(user["preferences"]["language"], "ar")

    def test_teacher_is_linked_not_enrolled(self) -> None:
        identity = self._identity(roles=["teacher"])
        run(provisioning.provision(identity))

        links = run(
            org_repository.list_teacher_links(
                teacher_id=identity["learner_id"], group_id="7-3"
            )
        )
        self.assertEqual(len(links), 1)
        self.assertEqual(
            run(
                org_repository.list_enrollments(
                    learner_id=identity["learner_id"], group_id="7-3"
                )
            ),
            [],
        )
        # No learner brain for a teacher account.
        self.assertNotIn(identity["learner_id"], self.brains)

    def test_missing_school_claim_does_not_fail_the_login(self) -> None:
        """An incomplete claim set is the Ministry's data problem, not a reason
        to lock a child out."""
        identity = self._identity(school_symbol=None, nmm_id=None)
        user = run(provisioning.provision(identity))
        self.assertEqual(user["_id"], identity["learner_id"])


class PasswordLoginGateTest(MoeOidcTestCase):
    def test_password_login_is_refused_in_cloud_environments(self) -> None:
        for environment in ("dev", "english", "production", "prod"):
            self._os.environ["SPARK_ENVIRONMENT"] = environment
            self._os.environ["ENVIRONMENT"] = environment
            self.assertFalse(
                core_env.password_login_allowed(),
                msg=f"password login must be closed in {environment}",
            )

    def test_password_login_is_allowed_locally(self) -> None:
        for environment in ("local", "test", ""):
            self._os.environ["SPARK_ENVIRONMENT"] = environment
            self._os.environ["ENVIRONMENT"] = environment
            self.assertTrue(core_env.password_login_allowed(), msg=repr(environment))

    def test_production_is_closed_even_if_something_says_local(self) -> None:
        """Belt and braces: two variables disagreeing must fail closed."""
        self._os.environ["SPARK_ENVIRONMENT"] = "local"
        self._os.environ["ENVIRONMENT"] = "production"
        self.assertFalse(core_env.password_login_allowed())


class ConfigurationTest(MoeOidcTestCase):
    def test_missing_client_id_is_reported(self) -> None:
        self._os.environ["MOE_OIDC_CLIENT_ID"] = ""
        self.assertEqual(moe_config.verify_configuration(), "MOE_OIDC_CLIENT_ID")

    def test_complete_configuration_reports_nothing_missing(self) -> None:
        self.assertIsNone(moe_config.verify_configuration())

    def test_learner_id_salt_is_required_outside_local(self) -> None:
        """Falling back to a shared default salt would make two environments
        derive the same `learner_id`, merging real and test children."""
        self._os.environ["SPARK_ENVIRONMENT"] = "dev"
        self._os.environ["ENVIRONMENT"] = "dev"
        self._os.environ["MOE_LEARNER_ID_SALT"] = ""
        with self.assertRaises(RuntimeError):
            moe_config.learner_id_salt()


class RedirectUriTest(MoeOidcTestCase):
    """The Ministry compares redirect URIs as strings, not as URLs."""

    def test_path_is_used_when_no_override_is_set(self) -> None:
        self.assertEqual(
            moe_redirect.redirect_uri(),
            "https://dev.spark.yuvilab.ai/api/auth/moe/callback",
        )
        self.assertFalse(moe_redirect.is_root_callback())

    def test_override_wins_and_is_sent_verbatim(self) -> None:
        """Registered today is the bare origin — no path, no trailing slash.
        Adding either turns the authorization request into `invalid_grant`."""
        self._os.environ["MOE_OIDC_REDIRECT_URI"] = "https://dev.spark.yuvilab.ai"
        self.assertEqual(moe_redirect.redirect_uri(), "https://dev.spark.yuvilab.ai")
        self.assertTrue(moe_redirect.is_root_callback())

        transaction = state.create_transaction()
        url = run(
            moe_client.build_authorization_url(
                state=transaction["state"],
                nonce=transaction["nonce"],
                challenge=transaction["code_challenge"],
            )
        )
        query = parse_qs(urlparse(url).query)
        self.assertEqual(query["redirect_uri"], ["https://dev.spark.yuvilab.ai"])

    def test_trailing_slash_still_counts_as_the_root(self) -> None:
        self._os.environ["MOE_OIDC_REDIRECT_URI"] = "https://dev.spark.yuvilab.ai/"
        self.assertTrue(moe_redirect.is_root_callback())

    def test_blank_override_falls_back_to_the_path(self) -> None:
        self._os.environ["MOE_OIDC_REDIRECT_URI"] = "   "
        self.assertEqual(
            moe_redirect.redirect_uri(),
            "https://dev.spark.yuvilab.ai/api/auth/moe/callback",
        )


class RootCallbackTest(MoeOidcTestCase):
    """The site root doubles as the callback while the origin is what's
    registered — but only then, and only for a request that carries a code."""

    @staticmethod
    def _request(query: str):
        from starlette.requests import Request

        return Request(
            {
                "type": "http",
                "method": "GET",
                "path": "/",
                "query_string": query.encode(),
                "headers": [],
            }
        )

    def test_plain_page_load_still_serves_the_app(self) -> None:
        self._os.environ["MOE_OIDC_REDIRECT_URI"] = "https://dev.spark.yuvilab.ai"
        response = run(static_pages.root(self._request("")))
        self.assertNotIsInstance(response, RedirectResponse)

    def test_our_own_error_redirect_does_not_loop(self) -> None:
        """`_failure` sends the browser to `/?auth_error=…`; if the root treated
        that as a callback the failure would bounce forever."""
        self._os.environ["MOE_OIDC_REDIRECT_URI"] = "https://dev.spark.yuvilab.ai"
        response = run(static_pages.root(self._request("auth_error=sso_denied")))
        self.assertNotIsInstance(response, RedirectResponse)

    def test_a_code_at_the_root_is_completed_as_a_login(self) -> None:
        self._os.environ["MOE_OIDC_REDIRECT_URI"] = "https://dev.spark.yuvilab.ai"
        response = run(
            static_pages.root(
                self._request("code=abc&state=xyz"), code="abc", state="xyz"
            )
        )
        # No transaction cookie on the request, so this lands on the failure
        # redirect — what matters is that the login path ran at all.
        self.assertIsInstance(response, RedirectResponse)
        self.assertIn("auth_error=login_expired", response.headers["location"])

    def test_the_root_ignores_codes_when_the_callback_path_is_registered(self) -> None:
        response = run(
            static_pages.root(
                self._request("code=abc&state=xyz"), code="abc", state="xyz"
            )
        )
        self.assertNotIsInstance(response, RedirectResponse)


class LogoutTest(MoeOidcTestCase):
    def test_end_session_url_is_used_when_the_provider_offers_one(self) -> None:
        url = run(moe_client.build_end_session_url(None))
        self.assertTrue(url.startswith(f"{ISSUER}/end_session") or "logoutURL=" in url)

    def test_id_token_hint_is_passed_when_available(self) -> None:
        url = run(moe_client.build_end_session_url("an-id-token"))
        query = parse_qs(urlparse(url).query)
        self.assertEqual(query["id_token_hint"], ["an-id-token"])


if __name__ == "__main__":
    unittest.main()
