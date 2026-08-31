"""One place that decides *which* database this process is allowed to talk to.

Until now there was a single connection string and it pointed at production, so
a script run on a laptop wrote to real learner records, and a deployment that
forgot the variable fell back to JSON files without anyone noticing. Both
failures were silent. This module makes the choice explicit and loud:

* ``MONGODB_CONNECTION_STRING`` present  → Mongo, and the host is announced.
* absent **and** ``SPARK_STORAGE=json``  → the JSON fallback, on purpose.
* absent and nothing said                → ``RuntimeError``. A misconfigured
  deployment must fail at boot, not quietly write to a container filesystem.

On top of that, a non-production process may not open the production cluster.
The environment name (``SPARK_ENVIRONMENT``/``ENVIRONMENT``) has to say
``production`` before the production host is reachable, so the default state of
a developer machine is "cannot touch prod" rather than "must remember not to".
"""

from __future__ import annotations

import os
import re
from typing import Optional
from urllib.parse import urlsplit

from app.core.env import ensure_env_loaded, is_production

ensure_env_loaded()

#: Storage backends. ``json`` is the offline demo path, never a deployment.
MONGO = "mongo"
JSON = "json"

#: Hosts that belong to the production cluster. Overridable so the guard can be
#: re-pointed without a code change if the cluster is ever renamed.
_DEFAULT_PRODUCTION_HOSTS = (
    "yuvi720.mongocluster.cosmos.azure.com",
    "yuvi720.global.mongocluster.cosmos.azure.com",
)

_ESCAPE_HATCH = "SPARK_ALLOW_PRODUCTION_DB"
_TRUTHY = {"1", "true", "yes", "on"}


def environment_name() -> str:
    """dev / english / production / local — the same names telemetry uses."""
    for key in ("SPARK_ENVIRONMENT", "ENVIRONMENT"):
        value = (os.environ.get(key) or "").strip()
        if value:
            return value.lower()
    slot = (os.environ.get("WEBSITE_SLOT_NAME") or "").strip()
    if slot:
        return "production" if slot.lower() == "production" else slot.lower()
    return "local"


def connection_string() -> str:
    return (os.environ.get("MONGODB_CONNECTION_STRING") or "").strip()


def database_name() -> str:
    return (
        os.environ.get("MONGODB_DATABASE")
        or os.environ.get("MONGODB_DB")
        or "yuvi720"
    )


def storage_mode() -> str:
    """``mongo`` when a connection string is configured, else ``json``.

    Deliberately does not raise: hot paths call this on every collection
    lookup. Whether the resulting choice is *allowed* is decided once, by
    :func:`verify_configuration`.
    """
    return MONGO if connection_string() else JSON


def json_fallback_requested() -> bool:
    return (os.environ.get("SPARK_STORAGE") or "").strip().lower() == JSON


def production_hosts() -> tuple[str, ...]:
    configured = (os.environ.get("MONGODB_PRODUCTION_HOSTS") or "").strip()
    if not configured:
        return _DEFAULT_PRODUCTION_HOSTS
    return tuple(h.strip().lower() for h in configured.split(",") if h.strip())


def connection_host(uri: Optional[str] = None) -> Optional[str]:
    """The host of the given cluster (the configured one by default), credentials removed.

    Safe to log and to show in the admin console — that is the whole point:
    "which database am I on" must be answerable by looking, not by trusting a
    config file to match what the process actually loaded.
    """
    raw = connection_string() if uri is None else uri
    if not raw:
        return None
    try:
        parsed = urlsplit(raw)
        if parsed.hostname:
            return parsed.hostname.lower()
    except ValueError:
        pass
    # A malformed URI still must not leak the password into a log line.
    match = re.search(r"@([^/?,]+)", raw)
    return match.group(1).lower() if match else None


def is_production_host(host: Optional[str] = None) -> bool:
    resolved = host if host is not None else connection_host()
    return bool(resolved) and resolved in production_hosts()


def describe() -> dict[str, Optional[str]]:
    """Non-secret summary of the store this process is wired to."""
    return {
        "environment": environment_name(),
        "storage": storage_mode(),
        "host": connection_host(),
        "database": database_name() if storage_mode() == MONGO else None,
    }


def describe_line() -> str:
    info = describe()
    if info["storage"] == JSON:
        return (
            f"storage=json environment={info['environment']} "
            "(local JSON files — no database)"
        )
    return (
        f"storage=mongo environment={info['environment']} "
        f"host={info['host']} database={info['database']}"
    )


_verified = False


def verify_configuration() -> None:
    """Fail loudly on a store this process must not be using. Idempotent.

    Called from the app lifespan *and* from the client factory, so a one-off
    script gets the same guard as the server without having to remember it.
    """
    global _verified
    if _verified:
        return

    host = connection_host()
    environment = environment_name()

    if not connection_string():
        if is_production():
            raise RuntimeError(
                "MONGODB_CONNECTION_STRING is required in production; refusing "
                "to start on the JSON fallback."
            )
        if not json_fallback_requested():
            raise RuntimeError(
                "MONGODB_CONNECTION_STRING is not set. Point it at the dev "
                "cluster, or set SPARK_STORAGE=json to run deliberately "
                "offline on local JSON files."
            )
    elif is_production_host(host) and not is_production():
        if (os.environ.get(_ESCAPE_HATCH) or "").strip().lower() not in _TRUTHY:
            raise RuntimeError(
                f"Refusing to open the production database ({host}) from "
                f"environment '{environment}'. Use the dev cluster. If this "
                f"really is a production process, set SPARK_ENVIRONMENT="
                f"production; for a one-off deliberate exception set "
                f"{_ESCAPE_HATCH}=1."
            )
        print(f"🚨 {_ESCAPE_HATCH} is set — this process is writing to PRODUCTION ({host}).")

    _verified = True


def reset_verification_cache() -> None:
    """Test hook: re-evaluate the guard after the environment changes."""
    global _verified
    _verified = False


def announce() -> str:
    """Print (once per call) and return the storage banner."""
    line = describe_line()
    if storage_mode() == JSON:
        print(f"🗄️ {line}")
    elif is_production_host():
        print(f"🗄️ {line}  ← PRODUCTION")
    else:
        print(f"🗄️ {line}")
    return line
