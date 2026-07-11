"""Typed aggregation for privacy-safe AI provider usage events."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict


class UsageBucket(BaseModel):
    key: str
    requests: int
    completed: int
    failed: int
    input_tokens: int
    output_tokens: int
    total_tokens: int
    characters: int
    cost_usd: Optional[float]
    unpriced_requests: int
    exact_usage_events: Optional[int] = None


class UsageEvent(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    event_id: str
    started_at: str
    actor_id: str
    actor_type: str
    endpoint: str
    feature: str
    operation: str
    provider: str
    deployment: str
    model_tier: Optional[str]
    streaming: bool
    meter: str
    status: str
    usage_status: str
    input_tokens: Optional[int]
    output_tokens: Optional[int]
    total_tokens: Optional[int]
    quantity: Optional[int]
    cost_usd: Optional[float]
    latency_ms: int


class PricingRate(BaseModel):
    pricing_id: str
    provider: str
    deployment: str
    display_name: str
    meter: str
    unit_size: int
    input_usd_per_unit: Optional[float]
    cached_input_usd_per_unit: Optional[float]
    output_usd_per_unit: Optional[float]
    characters_usd_per_unit: Optional[float]
    currency: str
    price_scope: str
    pricing_note: Optional[str]
    source_url: str
    source_checked_at: str
    effective_from: str


class UsagePeriod(BaseModel):
    days: int
    start: str
    end: str


class UsageFilters(BaseModel):
    actor_id: Optional[str]
    endpoint: Optional[str]


class UsageSummary(BaseModel):
    access_mode: Literal["public_preview", "authenticated_admin"]
    period: UsagePeriod
    filters: UsageFilters
    totals: UsageBucket
    by_actor: list[UsageBucket]
    by_endpoint: list[UsageBucket]
    by_operation: list[UsageBucket]
    by_deployment: list[UsageBucket]
    by_feature: list[UsageBucket]
    daily: list[UsageBucket]
    recent: list[UsageEvent]
    pricing: list[PricingRate]


def _number(value: Any) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _optional_number(value: Any) -> Optional[int]:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _cost(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _iso(value: Any) -> Optional[str]:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat()
    return str(value) if value else None


def _text(value: Any, fallback: str = "unknown") -> str:
    return str(value) if value not in (None, "") else fallback


def _new_bucket(label: str) -> dict[str, Any]:
    return {
        "key": label,
        "requests": 0,
        "completed": 0,
        "failed": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "total_tokens": 0,
        "characters": 0,
        "cost_usd": None,
        "unpriced_requests": 0,
    }


def _add(bucket: dict[str, Any], event: dict[str, Any]) -> None:
    bucket["requests"] += 1
    status = event.get("status")
    if status == "completed":
        bucket["completed"] += 1
    elif status in {"failed", "cancelled", "unavailable"}:
        bucket["failed"] += 1
    bucket["input_tokens"] += _number(event.get("input_tokens"))
    bucket["output_tokens"] += _number(event.get("output_tokens"))
    bucket["total_tokens"] += _number(event.get("total_tokens"))
    if event.get("meter") == "characters":
        bucket["characters"] += _number(event.get("quantity"))
    event_cost = _cost(event.get("cost_usd"))
    if event_cost is None:
        bucket["unpriced_requests"] += 1
    else:
        bucket["cost_usd"] = round((bucket["cost_usd"] or 0.0) + event_cost, 8)


def _group(events: list[dict[str, Any]], field: str) -> list[UsageBucket]:
    buckets: dict[str, dict[str, Any]] = {}
    for event in events:
        key = _text(event.get(field))
        _add(buckets.setdefault(key, _new_bucket(key)), event)
    ordered = sorted(buckets.values(), key=lambda item: item["requests"], reverse=True)
    return [UsageBucket.model_validate(bucket) for bucket in ordered]


def _recent_event(event: dict[str, Any]) -> UsageEvent:
    return UsageEvent(
        event_id=_text(event.get("event_id")),
        started_at=_iso(event.get("started_at")) or "",
        actor_id=_text(event.get("actor_id")),
        actor_type=_text(event.get("actor_type")),
        endpoint=_text(event.get("endpoint")),
        feature=_text(event.get("feature")),
        operation=_text(event.get("operation")),
        provider=_text(event.get("provider")),
        deployment=_text(event.get("deployment")),
        model_tier=_text(event.get("model_tier")) if event.get("model_tier") else None,
        streaming=bool(event.get("streaming")),
        meter=_text(event.get("meter")),
        status=_text(event.get("status")),
        usage_status=_text(event.get("usage_status")),
        input_tokens=_optional_number(event.get("input_tokens")),
        output_tokens=_optional_number(event.get("output_tokens")),
        total_tokens=_optional_number(event.get("total_tokens")),
        quantity=_optional_number(event.get("quantity")),
        cost_usd=_cost(event.get("cost_usd")),
        latency_ms=_number(event.get("latency_ms")),
    )


def _pricing_rate(document: dict[str, Any]) -> PricingRate:
    return PricingRate(
        pricing_id=_text(document.get("pricing_id")),
        provider=_text(document.get("provider")),
        deployment=_text(document.get("deployment")),
        display_name=_text(document.get("display_name"), _text(document.get("deployment"))),
        meter=_text(document.get("meter")),
        unit_size=_number(document.get("unit_size")),
        input_usd_per_unit=_cost(document.get("input_usd_per_unit")),
        cached_input_usd_per_unit=_cost(document.get("cached_input_usd_per_unit")),
        output_usd_per_unit=_cost(document.get("output_usd_per_unit")),
        characters_usd_per_unit=_cost(document.get("characters_usd_per_unit")),
        currency=_text(document.get("currency"), "USD"),
        price_scope=_text(document.get("price_scope")),
        pricing_note=_text(document.get("pricing_note")) if document.get("pricing_note") else None,
        source_url=_text(document.get("source_url")),
        source_checked_at=_iso(document.get("source_checked_at")) or "",
        effective_from=_iso(document.get("effective_from")) or "",
    )


def build_usage_summary(
    *,
    events: list[dict[str, Any]],
    days: int,
    start: datetime,
    end: datetime,
    actor_id: Optional[str],
    endpoint: Optional[str],
    pricing: Optional[list[dict[str, Any]]] = None,
    access_mode: Literal["public_preview", "authenticated_admin"] = "authenticated_admin",
) -> UsageSummary:
    """Aggregate already-sanitized events without identity enrichment."""
    totals = _new_bucket("total")
    exact_usage_events = 0
    daily_buckets: dict[str, dict[str, Any]] = {}

    for event in events:
        _add(totals, event)
        if event.get("usage_status") == "exact":
            exact_usage_events += 1
        day = (_iso(event.get("started_at")) or "unknown")[:10]
        _add(daily_buckets.setdefault(day, _new_bucket(day)), event)

    totals["exact_usage_events"] = exact_usage_events
    return UsageSummary(
        access_mode=access_mode,
        period=UsagePeriod(days=days, start=start.isoformat(), end=end.isoformat()),
        filters=UsageFilters(actor_id=actor_id, endpoint=endpoint),
        totals=UsageBucket.model_validate(totals),
        by_actor=_group(events, "actor_id"),
        by_endpoint=_group(events, "endpoint"),
        by_operation=_group(events, "operation"),
        by_deployment=_group(events, "deployment"),
        by_feature=_group(events, "feature"),
        daily=[UsageBucket.model_validate(daily_buckets[key]) for key in sorted(daily_buckets)],
        recent=[_recent_event(event) for event in events[:100]],
        pricing=[_pricing_rate(document) for document in (pricing or [])],
    )
