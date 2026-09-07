"""The read cache: which Redis, versioned keys, and a store that fails open.

Mirrors the shape of the database guard tests: the configuration module
decides *which* cache once and loudly; the store never raises on the way to
a handler.
"""

from __future__ import annotations

import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core import cache as cache_config  # noqa: E402
from app.services import cache_store  # noqa: E402


def _env(**values):
    cleared = {k: None for k in (
        "REDIS_CONNECTION_STRING", "SPARK_CACHE", "SPARK_ENVIRONMENT", "ENVIRONMENT",
        "WEBSITE_SLOT_NAME", "SPARK_ALLOW_PRODUCTION_REDIS", "REDIS_PRODUCTION_HOSTS",
    )}
    cleared.update(values)
    return mock.patch.dict(os.environ, {k: v for k, v in cleared.items() if v is not None}, clear=False)


class WhichCache(unittest.TestCase):
    def setUp(self):
        cache_config.reset_verification_cache()
        for key in ("REDIS_CONNECTION_STRING", "SPARK_CACHE", "SPARK_ENVIRONMENT", "ENVIRONMENT",
                    "WEBSITE_SLOT_NAME", "SPARK_ALLOW_PRODUCTION_REDIS"):
            os.environ.pop(key, None)

    def test_nothing_configured_is_off_outside_production(self):
        with _env(SPARK_ENVIRONMENT="dev"):
            self.assertEqual(cache_config.cache_mode(), "off")
            cache_config.verify_configuration()  # a notice, not an error

    def test_production_without_a_cache_refuses_to_boot(self):
        with _env(SPARK_ENVIRONMENT="production"):
            with self.assertRaises(RuntimeError):
                cache_config.verify_configuration()

    def test_production_may_run_uncached_only_on_purpose(self):
        with _env(SPARK_ENVIRONMENT="production", SPARK_CACHE="off"):
            cache_config.verify_configuration()

    def test_a_laptop_may_not_open_the_production_cache(self):
        with _env(SPARK_ENVIRONMENT="local",
                  REDIS_CONNECTION_STRING="rediss://:secret@redis-yuvi-720.northeurope.redis.azure.net:10000/0"):
            with self.assertRaises(RuntimeError) as caught:
                cache_config.verify_configuration()
            self.assertNotIn("secret", str(caught.exception))

    def test_the_production_cache_is_known_by_name_in_any_region(self):
        for region in ("northeurope", "westeurope", "swedencentral"):
            self.assertTrue(cache_config.is_production_host(f"redis-yuvi-720.{region}.redis.azure.net"))
            self.assertFalse(cache_config.is_production_host(f"redis-yuvi-720-dev.{region}.redis.azure.net"))
        self.assertFalse(cache_config.is_production_host("localhost"))
        with _env(REDIS_PRODUCTION_HOSTS="cache.example.net"):
            self.assertTrue(cache_config.is_production_host("cache.example.net"))
            self.assertFalse(cache_config.is_production_host("redis-yuvi-720.westeurope.redis.azure.net"))

    def test_the_escape_hatch_is_loud_but_allowed(self):
        with _env(SPARK_ENVIRONMENT="local", SPARK_ALLOW_PRODUCTION_REDIS="1",
                  REDIS_CONNECTION_STRING="rediss://:secret@redis-yuvi-720.northeurope.redis.azure.net:10000/0"):
            cache_config.verify_configuration()

    def test_the_host_never_carries_the_key(self):
        self.assertEqual(
            cache_config.connection_host("rediss://:abc123@redis-yuvi-720-dev.northeurope.redis.azure.net:10000/0"),
            "redis-yuvi-720-dev.northeurope.redis.azure.net",
        )
        self.assertEqual(cache_config.connection_host("garbage:abc123@host.example:10000"), "host.example")
        with _env(REDIS_CONNECTION_STRING="rediss://:abc123@redis-yuvi-720-dev.northeurope.redis.azure.net:10000/0"):
            self.assertNotIn("abc123", cache_config.describe_line())

    def test_keys_are_fenced_by_environment(self):
        with _env(SPARK_ENVIRONMENT="dev"):
            self.assertEqual(cache_config.key_prefix(), "spark:dev:v1:")
        with _env(SPARK_ENVIRONMENT="production"):
            self.assertEqual(cache_config.key_prefix(), "spark:production:v1:")


class TheStoreInMemory(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        cache_config.reset_verification_cache()
        self._env = _env(SPARK_ENVIRONMENT="test", SPARK_CACHE="memory")
        self._env.start()
        await cache_store.reset()

    async def asyncTearDown(self):
        await cache_store.reset()
        self._env.stop()

    async def test_remember_computes_once_until_the_version_moves(self):
        calls = []

        async def compute():
            calls.append(1)
            return {"n": len(calls)}

        first = await cache_store.remember("grp", "g1", "snapshot", "he:7", 60, compute)
        second = await cache_store.remember("grp", "g1", "snapshot", "he:7", 60, compute)
        self.assertEqual(first, second)
        self.assertEqual(len(calls), 1)

        await cache_store.bump("grp", "g1")
        third = await cache_store.remember("grp", "g1", "snapshot", "he:7", 60, compute)
        self.assertEqual(third, {"n": 2})

    async def test_different_args_and_idents_do_not_collide(self):
        async def a():
            return "a"

        async def b():
            return "b"

        self.assertEqual(await cache_store.remember("grp", "g1", "x", "he", 60, a), "a")
        self.assertEqual(await cache_store.remember("grp", "g1", "x", "ar", 60, b), "b")
        self.assertEqual(await cache_store.remember("grp", "g2", "x", "he", 60, b), "b")

    async def test_the_decorator_reads_ident_and_args_from_the_call(self):
        calls = []

        @cache_store.cached("learner", "dash", ttl=60,
                            ident=lambda learner_id, **_: learner_id,
                            args=lambda learner_id, language="he", **_: language)
        async def dashboard(learner_id, language="he"):
            calls.append((learner_id, language))
            return {"for": learner_id, "lang": language}

        await dashboard("moti")
        await dashboard("moti")
        await dashboard("moti", language="ar")
        await dashboard("gal")
        self.assertEqual(calls, [("moti", "he"), ("moti", "ar"), ("gal", "he")])
        await cache_store.bump("learner", "moti")
        await dashboard("moti")
        self.assertEqual(len(calls), 4)

    async def test_large_values_are_compressed_and_come_back_whole(self):
        value = {"units": [{"title": "מסה ונפח של גופים", "i": i} for i in range(400)]}
        blob = cache_store.encode(value)
        self.assertEqual(blob[:1], b"\x01")
        raw = len(json.dumps(value, ensure_ascii=False))
        self.assertLess(len(blob) * 3, raw)
        self.assertEqual(cache_store.decode(blob), value)
        self.assertEqual(cache_store.decode(cache_store.encode({"x": "y"})), {"x": "y"})

    async def test_expiry_is_honoured(self):
        backend = cache_store._get_backend()
        await backend.set("k", b"\x00{}", 1)
        with mock.patch("app.services.cache_store.time.monotonic", return_value=1e12):
            self.assertIsNone(await backend.get("k"))


class TheStoreFailsOpen(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        cache_config.reset_verification_cache()
        self._env = _env(SPARK_ENVIRONMENT="test", SPARK_CACHE="memory")
        self._env.start()
        await cache_store.reset()

    async def asyncTearDown(self):
        await cache_store.reset()
        self._env.stop()

    async def test_a_broken_backend_is_a_miss_not_a_500(self):
        class Broken:
            async def get(self, key):
                raise ConnectionError("refused")

            async def set(self, key, value, ttl):
                raise ConnectionError("refused")

            async def incr(self, key, ttl):
                raise TimeoutError()

            async def delete(self, *keys):
                raise ConnectionError("refused")

            async def close(self):
                pass

        with mock.patch.object(cache_store, "_get_backend", return_value=Broken()):
            async def compute():
                return {"computed": True}

            self.assertEqual(await cache_store.remember("grp", "g", "n", "", 60, compute), {"computed": True})
            self.assertEqual(await cache_store.bump("grp", "g"), 0)
        self.assertGreater(cache_store.stats.errors, 0)

    async def test_off_means_every_call_computes(self):
        calls = []

        async def compute():
            calls.append(1)
            return len(calls)

        with _env(SPARK_ENVIRONMENT="test", SPARK_CACHE="off"):
            await cache_store.reset()
            await cache_store.remember("grp", "g", "n", "", 60, compute)
            await cache_store.remember("grp", "g", "n", "", 60, compute)
        self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
