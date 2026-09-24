"""Pure roll-ups over ``ai_usage_events`` rows — no IO, no provider calls.

The before/after arithmetic for token work lives here so it can be tested
against hand-built rows: ``scripts/ai_usage_report.py`` feeds it dev Mongo (a
projection, never prompts — the rows have none) or an eval sandbox's JSON
file, and prints what it returns.

Cost prefers the event's own ``cost_usd`` (priced at write time from the
reviewed catalog). A row written without pricing — every JSON-mode row, every
dev row before the catalog was published — is priced from ``PRICES`` below and
flagged ``estimated``, never silently treated as free.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Iterable, Optional

#: USD per 1M tokens: (input, cached input, output). Mirrors the reviewed
#: catalog (admin/backend/pricing_catalog.py) — update both together.
PRICES: dict[str, tuple[float, float, float]] = {
    "gpt-5.4": (2.50, 0.25, 15.00),
    "gpt-5.4-mini": (0.75, 0.08, 4.50),
    "gpt-5-mini": (0.25, 0.03, 2.00),
}


def _int(value: Any) -> int:
    return int(value) if isinstance(value, (int, float)) and value > 0 else 0


def event_cost(event: dict[str, Any]) -> tuple[float, bool]:
    """(USD, estimated). Recorded cost wins; tokens × PRICES otherwise."""
    recorded = event.get("cost_usd")
    if isinstance(recorded, (int, float)):
        return float(recorded), False
    rates = PRICES.get(str(event.get("deployment") or ""))
    if not rates or event.get("meter", "tokens") != "tokens":
        return 0.0, False
    tokens_in = _int(event.get("input_tokens"))
    cached = min(_int(event.get("cached_input_tokens")), tokens_in)
    out = _int(event.get("output_tokens"))
    cost = ((tokens_in - cached) * rates[0] + cached * rates[1] + out * rates[2]) / 1e6
    return cost, True


def _percentile(values: list[int], share: float) -> Optional[int]:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(share * (len(ordered) - 1))))
    return ordered[index]


def _key(event: dict[str, Any], group_by: tuple[str, ...]) -> str:
    return " · ".join(str(event.get(field) or "—") for field in group_by)


def rollup(
    events: Iterable[dict[str, Any]], group_by: tuple[str, ...] = ("operation",),
) -> list[dict[str, Any]]:
    """One row per group, most expensive first, with each row's cost share."""
    groups: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "calls": 0, "input": 0, "cached": 0, "output": 0, "reasoning": 0,
        "cost": 0.0, "estimated": False, "latencies": [], "length_cut": 0,
    })
    for event in events:
        row = groups[_key(event, group_by)]
        row["calls"] += 1
        row["input"] += _int(event.get("input_tokens"))
        row["cached"] += _int(event.get("cached_input_tokens"))
        row["output"] += _int(event.get("output_tokens"))
        row["reasoning"] += _int(event.get("reasoning_tokens"))
        cost, estimated = event_cost(event)
        row["cost"] += cost
        row["estimated"] = row["estimated"] or estimated
        if isinstance(event.get("latency_ms"), (int, float)):
            row["latencies"].append(int(event["latency_ms"]))
        if event.get("finish_reason") == "length":
            row["length_cut"] += 1
    total = sum(row["cost"] for row in groups.values()) or 0.0
    rows = []
    for key, row in groups.items():
        latencies = row.pop("latencies")
        rows.append({
            "key": key,
            **row,
            "cost": round(row["cost"], 6),
            "cached_share": round(row["cached"] / row["input"], 4) if row["input"] else 0.0,
            "avg_input": round(row["input"] / row["calls"]) if row["calls"] else 0,
            "avg_output": round(row["output"] / row["calls"]) if row["calls"] else 0,
            "share": round(row["cost"] / total, 4) if total else 0.0,
            "p50_ms": _percentile(latencies, 0.5),
            "p95_ms": _percentile(latencies, 0.95),
        })
    return sorted(rows, key=lambda r: (-r["cost"], -r["calls"], r["key"]))


def compare(
    before: list[dict[str, Any]], after: list[dict[str, Any]],
    *, before_days: float = 1.0, after_days: float = 1.0,
) -> list[dict[str, Any]]:
    """Per-group deltas between two windows, normalized per day so windows
    of different lengths compare honestly."""
    b = {row["key"]: row for row in before}
    a = {row["key"]: row for row in after}
    out = []
    for key in sorted(set(b) | set(a)):
        old, new = b.get(key) or {}, a.get(key) or {}
        old_cost = (old.get("cost") or 0.0) / max(before_days, 1e-9)
        new_cost = (new.get("cost") or 0.0) / max(after_days, 1e-9)
        out.append({
            "key": key,
            "calls_per_day": (round((old.get("calls") or 0) / max(before_days, 1e-9), 2),
                              round((new.get("calls") or 0) / max(after_days, 1e-9), 2)),
            "avg_input": (old.get("avg_input"), new.get("avg_input")),
            "cached_share": (old.get("cached_share"), new.get("cached_share")),
            "cost_per_day": (round(old_cost, 6), round(new_cost, 6)),
            "delta_cost_per_day": round(new_cost - old_cost, 6),
        })
    return sorted(out, key=lambda r: r["delta_cost_per_day"])


def per_exchange(events: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """exchange_id → the calls one learner turn made: how many planning
    rounds it paid for, its total cost, and the operations involved."""
    turns: dict[str, dict[str, Any]] = {}
    for event in events:
        exchange = str(event.get("exchange_id") or "")
        if not exchange:
            continue
        turn = turns.setdefault(exchange, {
            "calls": 0, "cost": 0.0, "operations": [], "planning_calls": 0})
        turn["calls"] += 1
        turn["cost"] += event_cost(event)[0]
        operation = str(event.get("operation") or "")
        turn["operations"].append(operation)
        if ".tool_plan." in operation:
            turn["planning_calls"] += 1
    return turns
