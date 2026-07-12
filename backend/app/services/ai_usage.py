"""Privacy-safe, append-only metering for external AI provider requests.

MongoDB/Cosmos is authoritative. A local JSON fallback exists only so local demos
can inspect usage without infrastructure. Events never contain prompts, model
responses, learner names, email addresses, provider URLs, headers, or secrets.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from time import perf_counter
from typing import Any, Literal, Optional
from uuid import uuid4

from app.brain.repository import _get_collection_named


ActorType = Literal["learner", "teacher", "admin", "system"]
MeterType = Literal["tokens", "characters"]
UsageStatus = Literal["exact", "unavailable", "not_applicable"]
RequestStatus = Literal["completed", "failed", "cancelled", "unavailable"]

_RUNTIME_DIR = Path(__file__).resolve().parents[2] / ".runtime"
_FALLBACK_FILE = _RUNTIME_DIR / "ai_usage_events.json"
_FALLBACK_LOCK = asyncio.Lock()
_indexes_ready = False


@dataclass(frozen=True)
class UsageContext:
    """Non-identifying attribution required by every external AI request."""

    actor_id: str
    actor_type: ActorType
    endpoint: str
    feature: str
    operation: str
    source: str
    session_id: Optional[str] = None
    exchange_id: Optional[str] = None
    request_id: Optional[str] = None

    def __post_init__(self) -> None:
        required = {
            "actor_id": self.actor_id,
            "endpoint": self.endpoint,
            "feature": self.feature,
            "operation": self.operation,
            "source": self.source,
        }
        missing = [name for name, value in required.items() if not str(value or "").strip()]
        if missing:
            raise ValueError(f"UsageContext requires: {', '.join(missing)}")

    def for_operation(self, operation: str, *, source: Optional[str] = None) -> "UsageContext":
        return replace(self, operation=operation, source=source or self.source)


@dataclass(frozen=True)
class UsageTimer:
    started_at: datetime
    started_perf: float

    @classmethod
    def start(cls) -> "UsageTimer":
        return cls(datetime.now(timezone.utc), perf_counter())

    def latency_ms(self) -> int:
        return max(0, round((perf_counter() - self.started_perf) * 1000))


def token_usage_from_payload(payload: Any) -> Optional[dict[str, int]]:
    """Normalize Azure/OpenAI usage without estimating missing values."""
    if not isinstance(payload, dict):
        return None
    input_tokens = payload.get("prompt_tokens", payload.get("input_tokens"))
    output_tokens = payload.get("completion_tokens", payload.get("output_tokens"))
    total_tokens = payload.get("total_tokens")
    if not any(isinstance(value, int) for value in (input_tokens, output_tokens, total_tokens)):
        return None
    details = payload.get("prompt_tokens_details") or payload.get("input_tokens_details") or {}
    cached_tokens = details.get("cached_tokens") if isinstance(details, dict) else None
    return {
        "input_tokens": input_tokens if isinstance(input_tokens, int) else None,
        "output_tokens": output_tokens if isinstance(output_tokens, int) else None,
        "total_tokens": total_tokens if isinstance(total_tokens, int) else None,
        "cached_input_tokens": cached_tokens if isinstance(cached_tokens, int) else None,
    }


def provider_request_id(headers: Any) -> Optional[str]:
    """Read a provider correlation ID without persisting any headers."""
    for name in ("x-request-id", "apim-request-id", "x-ms-request-id"):
        value = headers.get(name) if headers is not None else None
        if value:
            return str(value)[:200]
    return None


def sanitized_error_type(error: Optional[BaseException]) -> Optional[str]:
    if error is None:
        return None
    return type(error).__name__[:120]


async def _ensure_indexes() -> None:
    global _indexes_ready
    if _indexes_ready:
        return
    collection = _get_collection_named("ai_usage_events")
    if collection is None:
        return
    try:
        await collection.create_index("event_id", unique=True, name="event_id_unique")
        await collection.create_index([("started_at", -1)], name="started_at_desc")
        await collection.create_index([("actor_id", 1), ("started_at", -1)], name="actor_started")
        await collection.create_index([("endpoint", 1), ("started_at", -1)], name="endpoint_started")
        await collection.create_index([("operation", 1), ("started_at", -1)], name="operation_started")
        _indexes_ready = True
    except Exception as exc:  # Cosmos may manage indexes outside the Mongo API.
        print(f"⚠️ AI usage index setup skipped: {type(exc).__name__}")


async def _pricing_for(
    provider: str,
    deployment: str,
    meter: MeterType,
    at: datetime,
) -> Optional[dict[str, Any]]:
    collection = _get_collection_named("ai_usage_pricing")
    if collection is None:
        return None
    query = {
        "provider": provider,
        "meter": meter,
        "deployment": {"$in": [deployment, "*"]},
        "effective_from": {"$lte": at},
        "$or": [
            {"effective_to": None},
            {"effective_to": {"$exists": False}},
            {"effective_to": {"$gt": at}},
        ],
    }
    try:
        return await collection.find_one(query, sort=[("effective_from", -1)])
    except Exception as exc:
        print(f"⚠️ AI pricing lookup failed: {type(exc).__name__}")
        return None


def _decimal(value: Any) -> Optional[Decimal]:
    try:
        return Decimal(str(value)) if value is not None else None
    except (InvalidOperation, ValueError):
        return None


def _price_snapshot(
    pricing: Optional[dict[str, Any]],
    meter: MeterType,
    usage: Optional[dict[str, int]],
    quantity: Optional[int],
) -> tuple[Optional[float], Optional[dict[str, Any]]]:
    if not pricing:
        return None, None
    unit = _decimal(pricing.get("unit_size")) or Decimal("1000000")
    if unit <= 0:
        return None, None

    cost: Optional[Decimal] = None
    rates: dict[str, Any]
    if meter == "tokens" and usage:
        input_rate = _decimal(pricing.get("input_usd_per_unit"))
        output_rate = _decimal(pricing.get("output_usd_per_unit"))
        cached_rate = _decimal(pricing.get("cached_input_usd_per_unit"))
        input_tokens = usage.get("input_tokens")
        output_tokens = usage.get("output_tokens")
        cached_tokens = usage.get("cached_input_tokens") or 0
        if input_rate is None or output_rate is None or input_tokens is None or output_tokens is None:
            return None, None
        uncached_tokens = max(0, input_tokens - cached_tokens)
        effective_cached_rate = cached_rate if cached_rate is not None else input_rate
        cost = (
            Decimal(uncached_tokens) * input_rate
            + Decimal(cached_tokens) * effective_cached_rate
            + Decimal(output_tokens) * output_rate
        ) / unit
        rates = {
            "unit_size": int(unit),
            "input_usd_per_unit": float(input_rate),
            "output_usd_per_unit": float(output_rate),
            "cached_input_usd_per_unit": float(effective_cached_rate),
        }
    elif meter == "characters" and quantity is not None:
        rate = _decimal(pricing.get("characters_usd_per_unit"))
        if rate is None:
            return None, None
        cost = Decimal(quantity) * rate / unit
        rates = {"unit_size": int(unit), "characters_usd_per_unit": float(rate)}
    else:
        return None, None

    return float(cost.quantize(Decimal("0.00000001"))), {
        "pricing_id": str(pricing.get("pricing_id") or pricing.get("_id") or ""),
        "currency": pricing.get("currency") or "USD",
        "rates": rates,
    }


async def record_usage(
    *,
    context: UsageContext,
    timer: UsageTimer,
    provider: str,
    gateway: str,
    deployment: str,
    api_version: Optional[str],
    streaming: bool,
    meter: MeterType,
    status: RequestStatus,
    usage_status: UsageStatus,
    usage: Optional[dict[str, int]] = None,
    quantity: Optional[int] = None,
    quantity_unit: Optional[str] = None,
    provider_request: Optional[str] = None,
    error: Optional[BaseException] = None,
    response_bytes: Optional[int] = None,
    model_tier: Optional[str] = None,
) -> dict[str, Any]:
    """Persist exactly one sanitized event for one external provider attempt."""
    finished_at = datetime.now(timezone.utc)
    pricing = await _pricing_for(provider, deployment, meter, timer.started_at)
    cost_usd, pricing_snapshot = _price_snapshot(pricing, meter, usage, quantity)
    event: dict[str, Any] = {
        "event_id": uuid4().hex,
        "request_id": context.request_id or uuid4().hex,
        "actor_id": context.actor_id,
        "actor_type": context.actor_type,
        "session_id": context.session_id,
        "exchange_id": context.exchange_id,
        "endpoint": context.endpoint,
        "feature": context.feature,
        "operation": context.operation,
        "source": context.source,
        "provider": provider,
        "gateway": gateway,
        "deployment": deployment,
        "model_tier": model_tier,
        "api_version": api_version,
        "streaming": streaming,
        "meter": meter,
        "status": status,
        "usage_status": usage_status,
        "started_at": timer.started_at,
        "finished_at": finished_at,
        "latency_ms": timer.latency_ms(),
        "provider_request_id": provider_request,
        "error_type": sanitized_error_type(error),
        "cost_usd": cost_usd,
        "pricing_snapshot": pricing_snapshot,
    }
    if meter == "tokens":
        event.update(usage or {
            "input_tokens": None,
            "output_tokens": None,
            "total_tokens": None,
            "cached_input_tokens": None,
        })
    else:
        event.update({
            "quantity": quantity,
            "quantity_unit": quantity_unit or "characters",
            "response_bytes": response_bytes,
        })

    collection = _get_collection_named("ai_usage_events")
    if collection is not None:
        try:
            await _ensure_indexes()
            await collection.insert_one(event)
            return event
        except Exception as exc:
            print(f"⚠️ AI usage write failed, using demo fallback: {type(exc).__name__}")
    await _append_fallback(event)
    return event


async def _append_fallback(event: dict[str, Any]) -> None:
    serializable = {
        key: value.isoformat() if isinstance(value, datetime) else value
        for key, value in event.items()
    }
    async with _FALLBACK_LOCK:
        events = _read_fallback()
        events.append(serializable)
        try:
            _RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
            _FALLBACK_FILE.write_text(
                json.dumps(events[-10000:], ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except OSError as exc:
            print(f"⚠️ AI usage fallback write failed: {type(exc).__name__}")


def _read_fallback() -> list[dict[str, Any]]:
    try:
        if _FALLBACK_FILE.exists():
            payload = json.loads(_FALLBACK_FILE.read_text(encoding="utf-8"))
            return payload if isinstance(payload, list) else []
    except (OSError, json.JSONDecodeError):
        pass
    return []


async def list_usage_events(
    *,
    start: datetime,
    end: datetime,
    limit: int = 5000,
) -> list[dict[str, Any]]:
    """Read sanitized events for admin aggregation, newest first."""
    collection = _get_collection_named("ai_usage_events")
    if collection is not None:
        try:
            cursor = collection.find({"started_at": {"$gte": start, "$lt": end}}).sort("started_at", -1).limit(limit)
            return [document async for document in cursor]
        except Exception as exc:
            print(f"⚠️ AI usage read failed, using demo fallback: {type(exc).__name__}")
    selected = []
    for event in _read_fallback():
        try:
            at = datetime.fromisoformat(str(event.get("started_at")))
            if at.tzinfo is None:
                at = at.replace(tzinfo=timezone.utc)
            if start <= at < end:
                selected.append(event)
        except (TypeError, ValueError):
            continue
    selected.sort(key=lambda item: str(item.get("started_at") or ""), reverse=True)
    return selected[:limit]
