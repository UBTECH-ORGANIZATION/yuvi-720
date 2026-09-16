"""One place that decides *which* cache this process is allowed to talk to.

The shape is `app.core.database` again, on purpose: one Redis per slot, the
way there is one Cosmos cluster per slot, with the same three questions
answered once and loudly at boot —

* ``REDIS_CONNECTION_STRING`` present     → Redis, and the host is announced.
* absent and ``SPARK_CACHE=memory``       → an in-process cache, on purpose
                                            (a laptop without Redis).
* absent and ``SPARK_CACHE=off``          → no caching at all, on purpose
                                            (CI: every test computes).
* absent and nothing said                 → ``off`` with a notice, except in
                                            production, where a missing cache
                                            is a misconfigured deployment and
                                            the process refuses to boot.

And the guard: a non-production process may not open the production cache,
unless ``SPARK_ALLOW_PRODUCTION_REDIS`` says so for one deliberate run.

Unlike the database, a cache that is *unreachable* at runtime is never an
error: every read falls open to a miss and the handler computes (see
`app.services.cache_store`). This module is only about which cache, not
whether it is up.
"""

from __future__ import annotations

import os
import re
from typing import Optional
from urllib.parse import urlsplit

from app.core.env import ensure_env_loaded, is_production
from app.core.database import environment_name

ensure_env_loaded()

REDIS = "redis"
MEMORY = "memory"
OFF = "off"

#: The production cache, by NAME. The hostname's tail depends on the kind
#: and region (`redis-yuvi-720.redis.cache.windows.net` for Azure Cache for
#: Redis, `redis-yuvi-720.<region>.redis.azure.net` for Managed Redis), and
#: both may change without a code change here: matching the first label
#: keeps the guard right after a move. `redis-yuvi-720-dev` is a different
#: first label, so it never matches. REDIS_PRODUCTION_HOSTS lists full
#: hostnames and overrides this.
_PRODUCTION_CACHE_NAME = "redis-yuvi-720"

_ESCAPE_HATCH = "SPARK_ALLOW_PRODUCTION_REDIS"
_TRUTHY = {"1", "true", "yes", "on"}


def connection_string() -> str:
    return (os.environ.get("REDIS_CONNECTION_STRING") or "").strip()


def requested_mode() -> str:
    return (os.environ.get("SPARK_CACHE") or "").strip().lower()


def cache_mode() -> str:
    """``redis`` when a connection string is configured, else what
    ``SPARK_CACHE`` asks for, else ``off``.

    Deliberately does not raise: the cache store calls this on every read.
    Whether the resulting choice is *allowed* is decided once, by
    :func:`verify_configuration`.
    """
    if connection_string():
        return REDIS
    requested = requested_mode()
    if requested in (MEMORY, OFF):
        return requested
    return OFF


def production_hosts() -> tuple[str, ...]:
    """Explicit production hostnames, when configured; empty means the guard
    falls back to matching the production cache's name in any region."""
    configured = (os.environ.get("REDIS_PRODUCTION_HOSTS") or "").strip()
    if not configured:
        return ()
    return tuple(h.strip().lower() for h in configured.split(",") if h.strip())


def connection_host(uri: Optional[str] = None) -> Optional[str]:
    """The host of the cache, credentials removed. Safe to log."""
    raw = connection_string() if uri is None else uri
    if not raw:
        return None
    try:
        parsed = urlsplit(raw)
        if parsed.hostname:
            return parsed.hostname.lower()
    except ValueError:
        pass
    # A malformed URI still must not leak the key into a log line.
    match = re.search(r"@([^/?,:]+)", raw)
    return match.group(1).lower() if match else None


def is_production_host(host: Optional[str] = None) -> bool:
    resolved = host if host is not None else connection_host()
    if not resolved:
        return False
    configured = production_hosts()
    if configured:
        return resolved in configured
    return resolved.split(".", 1)[0] == _PRODUCTION_CACHE_NAME


def key_prefix() -> str:
    """Every key starts with the environment, so dev and production can never
    read each other's entries even if a connection string is mispointed."""
    return f"spark:{environment_name()}:v1:"


def describe() -> dict[str, Optional[str]]:
    """Non-secret summary of the cache this process is wired to."""
    mode = cache_mode()
    return {
        "environment": environment_name(),
        "cache": mode,
        "host": connection_host() if mode == REDIS else None,
        "prefix": key_prefix(),
    }


def describe_line() -> str:
    info = describe()
    if info["cache"] == REDIS:
        return f"cache=redis environment={info['environment']} host={info['host']} prefix={info['prefix']}"
    if info["cache"] == MEMORY:
        return f"cache=memory environment={info['environment']} (in-process, lost on restart)"
    return f"cache=off environment={info['environment']} (every read computes)"


_verified = False


def verify_configuration() -> None:
    """Fail loudly on a cache this process must not be using. Idempotent.

    Called from the app lifespan *and* from the cache store's first use, so a
    one-off script gets the same guard as the server.
    """
    global _verified
    if _verified:
        return

    host = connection_host()
    environment = environment_name()

    if not connection_string():
        if is_production() and requested_mode() != OFF:
            raise RuntimeError(
                "REDIS_CONNECTION_STRING is required in production; refusing "
                "to start without a cache. Run infra/redis/provision.sh, or "
                "set SPARK_CACHE=off to run production uncached on purpose."
            )
        if requested_mode() not in (MEMORY, OFF):
            print(
                "ℹ️ REDIS_CONNECTION_STRING is not set and SPARK_CACHE says "
                "nothing — running with the cache off. Set SPARK_CACHE=memory "
                "for an in-process cache, or point at the dev cache."
            )
    elif is_production_host(host) and not is_production():
        if (os.environ.get(_ESCAPE_HATCH) or "").strip().lower() not in _TRUTHY:
            raise RuntimeError(
                f"Refusing to open the production cache ({host}) from "
                f"environment '{environment}'. Use the dev cache. If this "
                f"really is a production process, set SPARK_ENVIRONMENT="
                f"production; for a one-off deliberate exception set "
                f"{_ESCAPE_HATCH}=1."
            )
        print(f"🚨 {_ESCAPE_HATCH} is set — this process is using the PRODUCTION cache ({host}).")

    _verified = True


def reset_verification_cache() -> None:
    """Test hook: re-evaluate the guard after the environment changes."""
    global _verified
    _verified = False


def announce() -> str:
    """Print (once per call) and return the cache banner."""
    line = describe_line()
    if cache_mode() == REDIS and is_production_host():
        print(f"⚡ {line}  ← PRODUCTION")
    else:
        print(f"⚡ {line}")
    return line
