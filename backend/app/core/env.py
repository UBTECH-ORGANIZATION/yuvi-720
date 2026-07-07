"""Environment loading for the backend — import-safe, idempotent.

Any entrypoint that touches persistence or the LLM (server, tests, one-off
scripts) gets `.env` loaded just by importing a module that imports this one.
Previously env-loading lived only in `services/llm.py`, so scripts that imported
just the brain repository silently ran without `MONGODB_CONNECTION_STRING` and
fell back to JSON — a store split. Never overrides existing env vars.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[3]
ENV_PATHS = [
    APP_ROOT / "backend" / ".env",
    APP_ROOT / ".env",
]

_loaded = False


def load_env_file(path: Path) -> bool:
    """Lightweight .env loader. Does not override existing environment variables."""
    try:
        if not path.exists():
            return False
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key) and key not in os.environ:
                os.environ[key] = value
        return True
    except Exception as exc:  # pragma: no cover
        print(f"⚠️ Failed to load .env: {exc}")
        return False


def ensure_env_loaded() -> None:
    global _loaded
    if _loaded:
        return
    _loaded = True
    for env_path in ENV_PATHS:
        if load_env_file(env_path):
            print(f"✅ Loaded env from {env_path}")
            return
    print("ℹ️ No .env found; using process environment only.")


ensure_env_loaded()
