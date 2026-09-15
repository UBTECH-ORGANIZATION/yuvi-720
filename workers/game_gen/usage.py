"""AI usage accounting for the game worker.

Two consumers:
1. The Yuvi ledger (``backend/app/services/ai_usage.record_usage``) — one
   append-only ``ai_usage_events`` row per provider attempt, exact SDK usage
   only, never estimated. Imported lazily so the worker also runs standalone
   (the spike) without the backend on the path.
2. A local USD estimate from the Copilot SDK's ``ModelBilling`` metadata for
   reports and kid-facing "sparks". ``token_prices`` are GitHub AI credits per
   ``batch_size`` tokens; 1 credit = $0.01.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Optional

log = logging.getLogger("game_gen.usage")

PROVIDER = "github_copilot"
GATEWAY = "copilot_cli"
FEATURE = "feature_7_learning_games"
ENDPOINT = "internal:game_generate"
SOURCE = "game_gen_worker"


@dataclass
class UsageTotals:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    calls: int = 0
    cost_usd: float = 0.0
    by_operation: dict[str, dict[str, float]] = field(default_factory=dict)

    def add(self, operation: str, usage: Any, cost_usd: float) -> None:
        inp = int(getattr(usage, "input_tokens", 0) or 0)
        out = int(getattr(usage, "output_tokens", 0) or 0)
        cr = int(getattr(usage, "cache_read_tokens", 0) or 0)
        cw = int(getattr(usage, "cache_write_tokens", 0) or 0)
        self.input_tokens += inp
        self.output_tokens += out
        self.cache_read_tokens += cr
        self.cache_write_tokens += cw
        self.calls += int(getattr(usage, "calls", 1) or 1)
        self.cost_usd += cost_usd
        row = self.by_operation.setdefault(operation, {"input": 0, "output": 0, "cache_read": 0, "cost_usd": 0.0})
        row["input"] += inp
        row["output"] += out
        row["cache_read"] += cr
        row["cost_usd"] += cost_usd

    def as_dict(self) -> dict[str, Any]:
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cache_read_tokens": self.cache_read_tokens,
            "cache_write_tokens": self.cache_write_tokens,
            "calls": self.calls,
            "cost_usd": round(self.cost_usd, 6),
            "by_operation": {k: {kk: (round(vv, 6) if isinstance(vv, float) else vv) for kk, vv in v.items()} for k, v in self.by_operation.items()},
        }


def estimate_cost_usd(usage: Any, billing: Any) -> float:
    """USD from SDK ModelBilling.token_prices (credits per batch_size tokens)."""
    prices = getattr(billing, "token_prices", None) if billing is not None else None
    if prices is None:
        return 0.0
    batch = float(getattr(prices, "batch_size", 1_000_000) or 1_000_000)
    inp = int(getattr(usage, "input_tokens", 0) or 0)
    out = int(getattr(usage, "output_tokens", 0) or 0)
    cr = int(getattr(usage, "cache_read_tokens", 0) or 0)
    cw = int(getattr(usage, "cache_write_tokens", 0) or 0)
    p_in = float(getattr(prices, "input_price", 0) or 0)
    p_out = float(getattr(prices, "output_price", 0) or 0)
    p_cr = float(getattr(prices, "cache_read_price", p_in) or p_in)
    p_cw = float(getattr(prices, "cache_write_price", 0) or 0)
    # Copilot reports input_tokens INCLUDING cache reads (mirrors Anthropic usage
    # semantics as observed in vibe's ledger); guard against negatives anyway.
    fresh_in = max(0, inp - cr)
    credits = (fresh_in * p_in + cr * p_cr + cw * p_cw + out * p_out) / batch
    return credits / 100.0


def usage_context(*, actor_id: str, game_id: str, job_id: str, operation: str) -> Optional[Any]:
    """Build a Yuvi UsageContext when the backend package is importable."""
    try:
        from app.services.ai_usage import UsageContext  # type: ignore
    except Exception:
        return None
    return UsageContext(
        actor_id=actor_id,
        actor_type="learner",
        endpoint=ENDPOINT,
        feature=FEATURE,
        operation=operation,
        source=SOURCE,
        session_id=game_id,
        exchange_id=job_id,
    )


async def record_to_ledger(
    *,
    context: Any,
    timer: Any,
    model: str,
    usage: Any,
    status: str,
    error: Optional[BaseException] = None,
    api_version: Optional[str] = None,
) -> None:
    """One ledger row per provider attempt. No-op when the backend is absent."""
    if context is None:
        return
    try:
        from app.services.ai_usage import record_usage  # type: ignore
    except Exception:
        return
    inp = int(getattr(usage, "input_tokens", 0) or 0)
    out = int(getattr(usage, "output_tokens", 0) or 0)
    have_usage = inp > 0 or out > 0
    await record_usage(
        context=context,
        timer=timer,
        provider=PROVIDER,
        gateway=GATEWAY,
        deployment=model,
        api_version=api_version,
        streaming=True,
        meter="tokens",
        status=status,
        usage_status="available" if have_usage else "unavailable",
        usage={
            "input_tokens": inp,
            "output_tokens": out,
            "total_tokens": inp + out,
            "cached_input_tokens": int(getattr(usage, "cache_read_tokens", 0) or 0),
            "reasoning_tokens": None,
        } if have_usage else None,
        error=error,
    )
