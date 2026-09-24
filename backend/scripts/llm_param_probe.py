#!/usr/bin/env python3
"""Which optional provider parameters does our APIM lane accept?

    python scripts/llm_param_probe.py

Sends one tiny request per (tier, parameter) through the same gateway the app
uses and prints whether the provider answered 200 or refused. Nothing here is
switched on by the answer — it only tells a person whether a caching or
reasoning setting is even available on the configured api-version before
anyone builds on it. Costs a few hundred tokens in total.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.env import ensure_env_loaded  # noqa: E402

ensure_env_loaded()

from app.services.ai_usage import UsageContext  # noqa: E402
from app.services.llm import LlmError, call_llm  # noqa: E402

PROBES = {
    "baseline": {},
    "prompt_cache_key": {"prompt_cache_key": "yuvi-probe"},
    "prompt_cache_retention=24h": {"prompt_cache_retention": "24h"},
    "reasoning_effort=low": {"reasoning_effort": "low"},
    "reasoning_effort=none": {"reasoning_effort": "none"},
}


async def main() -> int:
    usage = UsageContext(
        actor_id="llm-param-probe", actor_type="system",
        endpoint="script:llm_param_probe", feature="platform_operations",
        operation="platform.llm_param_probe", source="llm_param_probe",
    )
    print(f"api-version {os.environ.get('APIM_API_VERSION', '2024-10-21')}")
    for tier in ("mini", "strong"):
        for name, extra in PROBES.items():
            try:
                reply = await call_llm(
                    [{"role": "user", "content": "Reply with the single word: ok"}],
                    usage_context=usage, max_tokens=64, model_tier=tier,
                    extra=extra, raise_on_error=True,
                )
                verdict = "accepted" if reply is not None else "empty reply"
            except LlmError as exc:
                verdict = f"refused HTTP {exc.status_code} {exc.code}".strip()
            except Exception as exc:  # network etc.
                verdict = f"error {type(exc).__name__}"
            print(f"  {tier:6} {name:28} {verdict}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
