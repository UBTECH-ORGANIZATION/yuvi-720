"""HTTP adapter for the Kata (CET) content platform — the real 720 provider.

Kata (`kata.cet.ac.il`) owns content + metadata across two surfaces, both authed
by ``X-API-Key``:
  - **Catalog**: ``/api/v1/catalog/content-units`` · ``/content-units/{id}`` ·
    ``/components`` · ``/search`` — paged ``{items,page,limit,total}`` with real
    MoE-coded objectives (``MOE.SCI.G7…``).
  - **xAPI Launcher**: ``POST /api/v1/launcher/context`` → a ready-to-embed
    ``launchUrl``. Content reports xAPI to Kata; Kata forwards each statement to
    the ``lrsEndpoint``/``lrsAuth`` we supply (our own ``/api/xapi`` ingest).

Spark owns learner routing, signed launch credentials, xAPI persistence, and the
Shared Learning Brain. This adapter deliberately mirrors the old
``content_provider`` interface (``list_units`` / ``get_unit`` /
``resolve_component`` + a ``KataError`` shaped like ``ContentProviderError``) so
call sites swap with minimal churn, and adds ``create_launch_context``.

Authoritative notes: `.github/skills/720-lrs-reporting/references/kata-and-directions.md`.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Any, Optional

import httpx


DEFAULT_KATA_BASE_URL = "https://kata.cet.ac.il"
_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,159}$")

# Kata content-language label ⇄ our locale code.
_KATA_LANGUAGE_TO_LOCALE = {"hebrew": "he", "arabic": "ar", "english": "en"}
_LOCALE_TO_KATA_LANGUAGE = {"he": "Hebrew", "ar": "Arabic", "en": "English"}

_MAX_PAGE_LIMIT = 200


class KataError(RuntimeError):
    """A safe Kata-integration error that never exposes upstream details."""

    def __init__(self, code: str, status_code: int = 502) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


# Kept as an alias so existing ``except content_provider.ContentProviderError``
# sites keep catching after the import swap.
ContentProviderError = KataError


def kata_base_url() -> str:
    return (os.environ.get("KATA_BASE_URL") or DEFAULT_KATA_BASE_URL).rstrip("/")


def _api_key() -> str:
    key = os.environ.get("KATA_API_KEY")
    if not key:
        raise KataError("kata_api_key_missing", 503)
    return key


def _timeout_seconds() -> float:
    return float(os.environ.get("KATA_TIMEOUT_SECONDS", "12"))


def _safe_id(value: str, field: str) -> str:
    candidate = str(value or "").strip()
    if not _ID_PATTERN.fullmatch(candidate):
        raise KataError(f"invalid_{field}", 422)
    return candidate


def kata_language(locale: Optional[str]) -> Optional[str]:
    """Map our locale (he/ar/en) to Kata's content-language label."""
    return _LOCALE_TO_KATA_LANGUAGE.get((locale or "").strip().lower())


# ── Normalization (produces the same shape old content_provider did, +extras) ──
def _locales(values: object) -> list[str]:
    if not isinstance(values, list):
        return []
    locales = {
        _KATA_LANGUAGE_TO_LOCALE.get(str(value).strip().casefold())
        for value in values
    }
    return sorted(locale for locale in locales if locale)


def _title_translations(unit: dict[str, Any]) -> dict[str, str]:
    """Map Kata ``titleTranslations`` (by language label) to locale codes."""
    raw = unit.get("titleTranslations")
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for label, text in raw.items():
        locale = _KATA_LANGUAGE_TO_LOCALE.get(str(label).strip().casefold())
        if locale and text:
            out[locale] = str(text)
    return out


def _recommended_after_fail(component: dict[str, Any]) -> list[str]:
    recommended = component.get("recommendedAfterFail")
    if isinstance(recommended, str):
        return [recommended] if recommended else []
    if isinstance(recommended, list):
        return [str(value) for value in recommended if value]
    return []


def _question_row(question: dict[str, Any]) -> dict[str, Any]:
    """Bounded, server-only snapshot of one question (text/options/answer).

    Powers the coach's exact-question context. NEVER shipped to the client — the
    correct answer lives here so the coach can guide without revealing it."""
    def _texts(values: object, limit: int) -> list[str]:
        if not isinstance(values, list):
            return [] if values in (None, "") else [str(values)[:200]]
        return [str(v)[:200] for v in values[:limit] if v not in (None, "")]

    return {
        "questionId": str(question.get("questionId") or ""),
        "questionType": str(question.get("questionType") or ""),
        "questionText": str(question.get("questionText") or "")[:600],
        "answers": _texts(question.get("answers"), 12),
        "correctAnswers": _texts(question.get("correctAnswers"), 12),
    }


def _sub_content_bot_index(
    component: dict[str, Any]
) -> tuple[Optional[str], dict[str, str], list[str], dict[str, list[dict[str, Any]]]]:
    """Return (aggregated informationToBot, per-item/question bot text, question
    ids, per-item question snapshots).

    Kata keeps ``informationToBot`` + the questions on each ``subContent`` item
    (not on the component), so we build lookups keyed by BOTH the sub-content
    item id and each of its question ids — letting the coach resolve the exact
    item + question the learner is on for sharp, mistake-aware hints (plan §8).
    """
    parts: list[str] = []
    by_item: dict[str, str] = {}
    question_ids: list[str] = []
    questions_by_item: dict[str, list[dict[str, Any]]] = {}
    for item in component.get("subContent") or []:
        if not isinstance(item, dict):
            continue
        text = str(item.get("informationToBot") or "").strip()
        item_id = str(item.get("id") or "").strip()
        if text:
            if text not in parts:
                parts.append(text)
            if item_id:
                by_item[item_id] = text
        rows: list[dict[str, Any]] = []
        for question in item.get("questions") or []:
            if isinstance(question, dict) and question.get("questionId"):
                qid = str(question["questionId"])
                question_ids.append(qid)
                if text:
                    by_item.setdefault(qid, text)
                rows.append(_question_row(question))
        if item_id and rows:
            questions_by_item[item_id] = rows
    aggregate = " ".join(parts)[:1800] or None
    return aggregate, by_item, question_ids, questions_by_item


def normalize_component(component: dict[str, Any]) -> dict[str, Any]:
    information_to_bot, information_by_item, question_ids, questions_by_item = (
        _sub_content_bot_index(component)
    )
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
        "recommended_after_fail": _recommended_after_fail(component),
        "information_to_bot": information_to_bot,
        "information_by_item": information_by_item,
        "questions_by_item": questions_by_item,
        "question_ids": question_ids,
        "cognitive_level": component.get("cognitiveLevel"),
        "depth_level": component.get("depthLevel"),
        "media_format": (
            (component.get("subContent") or [{}])[0].get("mediaFormat")
            if component.get("subContent") else None
        ),
    }


def subject_from_objective(objective_key: str, sub_topic: str = "") -> str:
    """Derive the learner-facing subject from the dotted MOE key.

    ``MOE.SCI.…`` → science, ``MOE.MATH.…`` → math, else ``other``. Never guess
    from the (opaque) unit id — the domain lives in the objective/sub-topic key.
    """
    key = f"{objective_key or ''} {sub_topic or ''}".upper()
    if re.search(r"\bMOE\.SCI\b|\.SCI\.|\bSCI\b", key):
        return "science"
    if re.search(r"\bMOE\.MATH\b|\.MATH\.|\bMATH\b", key):
        return "math"
    return "other"


def normalize_unit(unit: dict[str, Any]) -> dict[str, Any]:
    components = [
        normalize_component(component)
        for component in unit.get("components") or []
        if isinstance(component, dict) and component.get("id")
    ]
    locales = sorted({locale for component in components for locale in component["languages"]})
    unit_id = str(unit.get("id") or "")
    sub_topic = str(unit.get("subTopic") or "")
    objective_id = str(unit.get("learningObjective") or unit_id)
    prerequisites = [
        str(value)
        for value in (unit.get("prerequisiteLearningObjective") or [])
        if value
    ]
    return {
        "id": unit_id,
        "title": str(unit.get("title") or ""),
        "titles": _title_translations(unit),
        "sub_topic": sub_topic,
        "objective_id": objective_id,
        "subject": subject_from_objective(objective_id, sub_topic),
        "prerequisites": prerequisites,
        "languages": locales,
        "components": components,
        "source": "kata",
    }


# ── HTTP ──────────────────────────────────────────────────────────────────────
def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=kata_base_url(),
        timeout=httpx.Timeout(_timeout_seconds()),
        follow_redirects=False,
        headers={
            "Accept": "application/json",
            "User-Agent": "Yuvilab-Spark/1.0",
            "X-API-Key": _api_key(),
        },
    )


async def _get_json(path: str, params: Optional[dict[str, Any]] = None) -> Any:
    clean = {k: v for k, v in (params or {}).items() if v is not None}
    try:
        async with _client() as client:
            response = await client.get(path, params=clean)
            if response.status_code == 404:
                raise KataError("content_not_found", 404)
            response.raise_for_status()
            return response.json()
    except KataError:
        raise
    except (httpx.HTTPError, json.JSONDecodeError, ValueError) as exc:
        print(f"⚠️ Kata request failed: {type(exc).__name__}")
        raise KataError("kata_unavailable") from exc


async def _post_json(path: str, body: dict[str, Any]) -> Any:
    try:
        async with _client() as client:
            response = await client.post(path, json=body)
            if response.status_code >= 400:
                # Surface a stable code; never leak Kata's error body.
                raise KataError("kata_launch_rejected", 502)
            return response.json()
    except KataError:
        raise
    except (httpx.HTTPError, json.JSONDecodeError, ValueError) as exc:
        print(f"⚠️ Kata launcher request failed: {type(exc).__name__}")
        raise KataError("kata_unavailable") from exc


# ── Catalog ───────────────────────────────────────────────────────────────────
async def get_unit(unit_id: str, language: Optional[str] = None) -> dict[str, Any]:
    safe_unit_id = _safe_id(unit_id, "unit_id")
    params = {"language": kata_language(language)} if language else None
    payload = await _get_json(f"/api/v1/catalog/content-units/{safe_unit_id}", params)
    if not isinstance(payload, dict):
        raise KataError("invalid_kata_response")
    return normalize_unit(payload)


async def _list_unit_ids(**filters: Any) -> list[str]:
    """Page through the unit summaries and collect ids (no components yet)."""
    ids: list[str] = []
    page = 1
    while True:
        payload = await _get_json(
            "/api/v1/catalog/content-units",
            {**filters, "page": page, "limit": _MAX_PAGE_LIMIT},
        )
        if not isinstance(payload, dict):
            raise KataError("invalid_kata_response")
        items = payload.get("items") or []
        for unit in items:
            if isinstance(unit, dict) and unit.get("id"):
                ids.append(_safe_id(str(unit["id"]), "unit_id"))
        total = int(payload.get("total") or 0)
        if len(ids) >= total or not items:
            break
        page += 1
    return ids


async def list_units(language: Optional[str] = None, **filters: Any) -> list[dict[str, Any]]:
    """Return full normalized units (summaries fanned out to full detail)."""
    ids = await _list_unit_ids(language=kata_language(language), **filters)
    results = await asyncio.gather(
        *(get_unit(unit_id, language) for unit_id in ids), return_exceptions=True
    )
    units = [result for result in results if isinstance(result, dict)]
    if ids and not units:
        raise KataError("kata_unavailable")
    return units


async def resolve_component(
    component_id: str,
    unit_id: Optional[str] = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Resolve and validate a component against its Kata-owned unit."""
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
    raise KataError("content_not_found", 404)


async def list_components(
    *,
    learning_objective: Optional[str] = None,
    component_purpose: Optional[str] = None,
    is_assessment: Optional[bool] = None,
    relative_difficulty: Optional[int] = None,
    language: Optional[str] = None,
    provider: Optional[str] = None,
) -> list[dict[str, Any]]:
    """List normalized components, optionally filtered (server-side)."""
    out: list[dict[str, Any]] = []
    page = 1
    while True:
        payload = await _get_json(
            "/api/v1/catalog/components",
            {
                "learningObjective": learning_objective,
                "componentPurpose": component_purpose,
                "isAssessment": is_assessment,
                "relativeDifficulty": relative_difficulty,
                "language": kata_language(language),
                "provider": provider,
                "page": page,
                "limit": _MAX_PAGE_LIMIT,
            },
        )
        if not isinstance(payload, dict):
            raise KataError("invalid_kata_response")
        items = payload.get("items") or []
        for component in items:
            if isinstance(component, dict) and component.get("id"):
                out.append(normalize_component(component))
        total = int(payload.get("total") or 0)
        if len(out) >= total or not items:
            break
        page += 1
    return out


async def search(
    q: str, language: Optional[str] = None, page: int = 1, limit: int = 50
) -> dict[str, Any]:
    """Full-text catalog search (returns the raw paged unit-summary page)."""
    if not (q or "").strip():
        raise KataError("empty_query", 422)
    return await _get_json(
        "/api/v1/catalog/search",
        {"q": q, "language": kata_language(language), "page": page, "limit": limit},
    )


# ── xAPI Launcher ─────────────────────────────────────────────────────────────
async def create_launch_context(
    *,
    component_id: str,
    student_id: str,
    platform_url: str,
    lrs_endpoint: str,
    lrs_auth: str,
    student_name: Optional[str] = None,
) -> dict[str, Any]:
    """Create a Kata launch context → ``{launchUrl, registrationId}``.

    ``student_id`` MUST be pseudonymous (never a real ת"ז) — it becomes the xAPI
    actor account name, which is exactly what our ingest matches the launch
    against. ``lrs_endpoint``/``lrs_auth`` are Kata's downstream forward target
    (our own ``/api/xapi/{token}/`` ingest); stored server-side, never in the URL.
    """
    body: dict[str, Any] = {
        "componentId": _safe_id(component_id, "component_id"),
        "studentId": student_id,
        "platformUrl": platform_url,
        "lrsEndpoint": lrs_endpoint,
        "lrsAuth": lrs_auth,
    }
    if student_name:
        body["studentName"] = student_name
    payload = await _post_json("/api/v1/launcher/context", body)
    if not isinstance(payload, dict) or not payload.get("launchUrl"):
        raise KataError("kata_launch_rejected", 502)
    return {
        "launch_url": str(payload["launchUrl"]),
        "registration_id": payload.get("registrationId"),
    }
