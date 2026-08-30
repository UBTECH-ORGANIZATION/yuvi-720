"""Mongo metadata for Yuvi Studio projects and versions.

Only metadata lives here — artifact HTML is in blob storage, because a document
that grows with every build is exactly the shape Cosmos punishes.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Optional
import uuid

from app.brain.repository import _get_collection_named

PROJECTS = "studio_projects"
VERSIONS = "studio_versions"

MAX_PROJECTS_PER_LEARNER = 40
KINDS = ("game", "site", "lomda")

_FALLBACK_FILE = Path(__file__).resolve().parents[3] / ".runtime" / "studio.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_fallback() -> dict[str, Any]:
    try:
        if _FALLBACK_FILE.is_file():
            data = json.loads(_FALLBACK_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                data.setdefault("projects", {})
                data.setdefault("versions", {})
                return data
    except (OSError, json.JSONDecodeError):
        pass
    return {"projects": {}, "versions": {}}


def _write_fallback(data: dict[str, Any]) -> None:
    try:
        _FALLBACK_FILE.parent.mkdir(parents=True, exist_ok=True)
        _FALLBACK_FILE.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    except OSError as exc:
        print(f"⚠️ studio fallback write failed: {exc}")


def public_project(document: dict[str, Any]) -> dict[str, Any]:
    """The project as the learner may see it — blob paths never leave the backend."""
    return {
        "id": document.get("_id"),
        "title": document.get("title") or "",
        "kind": document.get("kind") or "game",
        "objectiveId": document.get("objective_id"),
        "language": document.get("language") or "he",
        "status": document.get("status") or "draft",
        "currentVersion": document.get("current_version") or 0,
        "createdAt": document.get("created_at"),
        "updatedAt": document.get("updated_at"),
    }


def public_version(document: dict[str, Any]) -> dict[str, Any]:
    return {
        "version": document.get("version"),
        "summary": document.get("summary") or "",
        "request": document.get("request") or "",
        "createdAt": document.get("created_at"),
        "safetyCodes": document.get("safety_codes") or [],
    }


async def create_project(
    learner_id: str,
    *,
    title: str,
    kind: str,
    language: str,
    objective_id: Optional[str] = None,
) -> dict[str, Any]:
    document = {
        "_id": uuid.uuid4().hex,
        "learner_id": learner_id,
        "title": (title or "").strip()[:120],
        "kind": kind if kind in KINDS else "game",
        "language": language,
        "objective_id": objective_id,
        "status": "draft",
        "current_version": 0,
        "deleted": False,
        "created_at": _now(),
        "updated_at": _now(),
    }

    collection = _get_collection_named(PROJECTS)
    if collection is not None:
        try:
            await collection.insert_one(dict(document))
            return document
        except Exception as exc:
            print(f"⚠️ studio project create failed, using fallback: {exc}")

    data = _read_fallback()
    data["projects"][document["_id"]] = document
    _write_fallback(data)
    return document


async def get_project(project_id: str) -> Optional[dict[str, Any]]:
    collection = _get_collection_named(PROJECTS)
    if collection is not None:
        try:
            document = await collection.find_one({"_id": project_id})
            if document is not None:
                return None if document.get("deleted") else document
        except Exception as exc:
            print(f"⚠️ studio project read failed, using fallback: {exc}")

    document = _read_fallback()["projects"].get(project_id)
    if document is None or document.get("deleted"):
        return None
    return document


async def list_projects(learner_id: str, limit: int = 30) -> list[dict[str, Any]]:
    collection = _get_collection_named(PROJECTS)
    if collection is not None:
        try:
            cursor = (
                collection.find({"learner_id": learner_id, "deleted": {"$ne": True}})
                .sort("updated_at", -1)
                .limit(limit)
            )
            return await cursor.to_list(length=limit)
        except Exception as exc:
            print(f"⚠️ studio project list failed, using fallback: {exc}")

    documents = [
        document for document in _read_fallback()["projects"].values()
        if document.get("learner_id") == learner_id and not document.get("deleted")
    ]
    documents.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
    return documents[:limit]


async def count_projects(learner_id: str) -> int:
    collection = _get_collection_named(PROJECTS)
    if collection is not None:
        try:
            return await collection.count_documents(
                {"learner_id": learner_id, "deleted": {"$ne": True}}
            )
        except Exception as exc:
            print(f"⚠️ studio project count failed, using fallback: {exc}")

    return len([
        document for document in _read_fallback()["projects"].values()
        if document.get("learner_id") == learner_id and not document.get("deleted")
    ])


async def update_project(project_id: str, updates: dict[str, Any]) -> None:
    payload = {**updates, "updated_at": _now()}

    collection = _get_collection_named(PROJECTS)
    if collection is not None:
        try:
            await collection.update_one({"_id": project_id}, {"$set": payload})
            return
        except Exception as exc:
            print(f"⚠️ studio project update failed, using fallback: {exc}")

    data = _read_fallback()
    document = data["projects"].get(project_id)
    if document is not None:
        document.update(payload)
        _write_fallback(data)


async def add_version(
    project_id: str,
    learner_id: str,
    *,
    version: int,
    blob_path: str,
    request: str,
    summary: str,
    safety_codes: list[str],
) -> dict[str, Any]:
    document = {
        "_id": f"{project_id}:{version}",
        "project_id": project_id,
        "learner_id": learner_id,
        "version": version,
        "blob_path": blob_path,
        "request": (request or "")[:600],
        "summary": (summary or "")[:400],
        "safety_codes": safety_codes,
        "created_at": _now(),
    }

    collection = _get_collection_named(VERSIONS)
    if collection is not None:
        try:
            await collection.insert_one(dict(document))
            return document
        except Exception as exc:
            print(f"⚠️ studio version create failed, using fallback: {exc}")

    data = _read_fallback()
    data["versions"][document["_id"]] = document
    _write_fallback(data)
    return document


async def get_version(project_id: str, version: int) -> Optional[dict[str, Any]]:
    collection = _get_collection_named(VERSIONS)
    if collection is not None:
        try:
            document = await collection.find_one({"_id": f"{project_id}:{version}"})
            if document is not None:
                return document
        except Exception as exc:
            print(f"⚠️ studio version read failed, using fallback: {exc}")

    return _read_fallback()["versions"].get(f"{project_id}:{version}")


async def list_versions(project_id: str, limit: int = 20) -> list[dict[str, Any]]:
    collection = _get_collection_named(VERSIONS)
    if collection is not None:
        try:
            cursor = collection.find({"project_id": project_id}).sort("version", -1).limit(limit)
            return await cursor.to_list(length=limit)
        except Exception as exc:
            print(f"⚠️ studio version list failed, using fallback: {exc}")

    documents = [
        document for document in _read_fallback()["versions"].values()
        if document.get("project_id") == project_id
    ]
    documents.sort(key=lambda item: item.get("version") or 0, reverse=True)
    return documents[:limit]


async def count_builds_since(learner_id: str, since: str) -> int:
    """Builds a learner has run since an ISO timestamp — the daily cost cap."""
    collection = _get_collection_named(VERSIONS)
    if collection is not None:
        try:
            return await collection.count_documents(
                {"learner_id": learner_id, "created_at": {"$gte": since}}
            )
        except Exception as exc:
            print(f"⚠️ studio build count failed, using fallback: {exc}")

    return len([
        document for document in _read_fallback()["versions"].values()
        if document.get("learner_id") == learner_id
        and (document.get("created_at") or "") >= since
    ])


async def delete_project(project_id: str) -> None:
    """Soft delete — versions stay so a teacher can still see what happened."""
    await update_project(project_id, {"deleted": True})
