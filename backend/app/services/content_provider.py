"""HTTP adapter for the approved external 720 content-provider catalog.

The provider owns content and metadata. Spark owns learner routing, signed launch
credentials, xAPI persistence, and the Shared Learning Brain. Keeping this adapter
behind a small interface also lets the same calls be exposed as MCP tools without
coupling agents to provider-specific HTTP paths.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Any, Optional
from urllib.parse import urlencode

import httpx


DEFAULT_CONTENT_PROVIDER_URL = "https://yuvi720-content-provider.azurewebsites.net"
_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$")
_PROVIDER_LANGUAGE_TO_LOCALE = {
    "hebrew": "he",
    "arabic": "ar",
    "english": "en",
}


class ContentProviderError(RuntimeError):
    """A safe provider-integration error that never exposes upstream details."""

    def __init__(self, code: str, status_code: int = 502) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


def provider_base_url() -> str:
    return (
        os.environ.get("CONTENT_PROVIDER_BASE_URL")
        or DEFAULT_CONTENT_PROVIDER_URL
    ).rstrip("/")


def _safe_id(value: str, field: str) -> str:
    candidate = str(value or "").strip()
    if not _ID_PATTERN.fullmatch(candidate):
        raise ContentProviderError(f"invalid_{field}", 422)
    return candidate


def _subject_from_unit_id(unit_id: str) -> str:
    lowered = unit_id.casefold()
    if "-math-" in lowered:
        return "math"
    if "-science-" in lowered:
        return "science"
    return "other"


def _locales(values: object) -> list[str]:
    if not isinstance(values, list):
        return []
    locales = {
        _PROVIDER_LANGUAGE_TO_LOCALE.get(str(value).strip().casefold())
        for value in values
    }
    return sorted(locale for locale in locales if locale)


def _information_to_bot(component: dict[str, Any]) -> Optional[str]:
    parts: list[str] = []
    for item in component.get("subContent") or []:
        if not isinstance(item, dict):
            continue
        text = str(item.get("informationToBot") or "").strip()
        if text and text not in parts:
            parts.append(text)
    return " ".join(parts)[:1800] or None


def normalize_component(component: dict[str, Any]) -> dict[str, Any]:
    """Normalize provider metadata without inventing closed-list values."""
    recommended = component.get("recommendedAfterFail")
    if isinstance(recommended, str):
        recommended_ids = [recommended] if recommended else []
    elif isinstance(recommended, list):
        recommended_ids = [str(value) for value in recommended if value]
    else:
        recommended_ids = []

    question_ids: list[str] = []
    for item in component.get("subContent") or []:
        if not isinstance(item, dict):
            continue
        for question in item.get("questions") or []:
            if isinstance(question, dict) and question.get("questionId"):
                question_ids.append(str(question["questionId"]))

    return {
        "id": str(component.get("id") or ""),
        "unit_id": str(component.get("learningUnitId") or ""),
        "title": str(component.get("title") or ""),
        "purpose": component.get("componentPurpose"),
        "is_assessment": bool(component.get("isAssessment")),
        "is_required": bool(component.get("isRequired", True)),
        "relative_difficulty": component.get("relativeDifficulty"),
        "mastery_level": component.get("masteryLevel"),
        "order": component.get("order"),
        "languages": _locales(component.get("languages")),
        "estimated_minutes": component.get("estimatedTimeInMinutes"),
        "recommended_after_fail": recommended_ids,
        "information_to_bot": _information_to_bot(component),
        "question_ids": question_ids,
    }


def normalize_unit(unit: dict[str, Any]) -> dict[str, Any]:
    components = [
        normalize_component(component)
        for component in unit.get("components") or []
        if isinstance(component, dict) and component.get("id")
    ]
    locales = sorted({locale for component in components for locale in component["languages"]})
    unit_id = str(unit.get("id") or "")
    objective_id = str(unit.get("learningObjective") or unit_id)
    return {
        "id": unit_id,
        "title": str(unit.get("title") or ""),
        "sub_topic": str(unit.get("subTopic") or ""),
        "objective_id": objective_id,
        "subject": _subject_from_unit_id(unit_id),
        "languages": locales,
        "components": components,
        "source": "content_provider",
    }


async def _get_json(path: str) -> Any:
    timeout_seconds = float(os.environ.get("CONTENT_PROVIDER_TIMEOUT_SECONDS", "8"))
    try:
        async with httpx.AsyncClient(
            base_url=provider_base_url(),
            timeout=httpx.Timeout(timeout_seconds),
            follow_redirects=False,
            headers={"Accept": "application/json", "User-Agent": "Yuvilab-Spark/1.0"},
        ) as client:
            response = await client.get(path)
            if response.status_code == 404:
                raise ContentProviderError("content_not_found", 404)
            response.raise_for_status()
            return response.json()
    except ContentProviderError:
        raise
    except (httpx.HTTPError, json.JSONDecodeError, ValueError) as exc:
        print(f"⚠️ Content provider request failed: {type(exc).__name__}")
        raise ContentProviderError("content_provider_unavailable") from exc


async def get_unit(unit_id: str) -> dict[str, Any]:
    safe_unit_id = _safe_id(unit_id, "unit_id")
    payload = await _get_json(f"/api/catalog/units/{safe_unit_id}")
    if not isinstance(payload, dict):
        raise ContentProviderError("invalid_provider_response")
    return normalize_unit(payload)


async def list_units() -> list[dict[str, Any]]:
    """Return full normalized units so locale and item metadata remain truthful."""
    payload = await _get_json("/api/catalog/units")
    if not isinstance(payload, list):
        raise ContentProviderError("invalid_provider_response")
    ids = [
        _safe_id(str(unit.get("id") or ""), "unit_id")
        for unit in payload
        if isinstance(unit, dict) and unit.get("id")
    ]
    results = await asyncio.gather(*(get_unit(unit_id) for unit_id in ids), return_exceptions=True)
    units = [result for result in results if isinstance(result, dict)]
    if ids and not units:
        raise ContentProviderError("content_provider_unavailable")
    return units


async def resolve_component(
    component_id: str,
    unit_id: Optional[str] = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Resolve and validate a component against its provider-owned unit."""
    safe_component_id = _safe_id(component_id, "component_id")
    if unit_id:
        units = [await get_unit(_safe_id(unit_id, "unit_id"))]
    else:
        units = await list_units()

    for unit in units:
        component = next(
            (row for row in unit["components"] if row["id"] == safe_component_id),
            None,
        )
        if component:
            return unit, component
    raise ContentProviderError("content_not_found", 404)


def build_player_url(
    unit_id: str,
    component_id: str,
    slxapi: dict[str, Any],
) -> str:
    """Build the provider iframe URL with a compact signed ``slxapi`` launch."""
    safe_unit_id = _safe_id(unit_id, "unit_id")
    safe_component_id = _safe_id(component_id, "component_id")
    query = urlencode({
        "unit": safe_unit_id,
        "component": safe_component_id,
        "slxapi": json.dumps(slxapi, ensure_ascii=False, separators=(",", ":")),
    })
    return f"{provider_base_url()}/player?{query}"
