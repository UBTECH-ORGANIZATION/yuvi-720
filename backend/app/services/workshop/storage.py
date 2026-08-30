"""Blob storage for Yuvi Workshop artifacts.

Artifacts are immutable: every build writes a new version path and nothing is
ever overwritten, so "restore version 3" is a pointer move rather than a rebuild.

The container is private and there is no SAS anywhere. Reads go through an
authorized route that replays the bytes under a `CSP: sandbox` header, which
forces an opaque origin even when a learner opens the artifact URL directly in a
tab — a short-lived SAS on a public host could not have done that.
"""

from __future__ import annotations

import os
from pathlib import Path
import re
from typing import Optional

CONTAINER = "workshop-projects"

_FALLBACK_ROOT = Path(__file__).resolve().parents[3] / ".runtime" / CONTAINER
_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


class StorageError(Exception):
    """Raised when an artifact cannot be stored or read; message is a code."""


def build_path(learner_id: str, project_id: str, version: int) -> str:
    """Compose the immutable path of one artifact version."""
    owner = re.sub(r"[^A-Za-z0-9_-]", "", learner_id or "")[:64]
    project = re.sub(r"[^A-Za-z0-9_-]", "", project_id or "")[:64]
    if not _SEGMENT.fullmatch(owner) or not _SEGMENT.fullmatch(project) or version < 1:
        raise StorageError("invalid_artifact_path")
    return f"{owner}/{project}/v{version}/index.html"


def _connection_string() -> str:
    return (os.environ.get("WORKSHOP_STORAGE_CONNECTION_STRING") or "").strip()


def _account_url() -> str:
    return (os.environ.get("WORKSHOP_STORAGE_ACCOUNT_URL") or "").strip().rstrip("/")


def is_configured() -> bool:
    return bool(_connection_string() or _account_url())


def _fallback_path(blob_path: str) -> Optional[Path]:
    candidate = (_FALLBACK_ROOT / blob_path).resolve()
    root = _FALLBACK_ROOT.resolve()
    return candidate if candidate.is_relative_to(root) else None


def _container_client():
    """Build a container client, preferring managed identity over a secret."""
    from azure.storage.blob.aio import BlobServiceClient

    connection = _connection_string()
    if connection:
        service = BlobServiceClient.from_connection_string(connection)
    else:
        from azure.identity.aio import DefaultAzureCredential

        service = BlobServiceClient(_account_url(), credential=DefaultAzureCredential())
    return service, service.get_container_client(CONTAINER)


async def put(blob_path: str, html: str) -> None:
    """Write one artifact version. Existing versions are never replaced."""
    data = html.encode("utf-8")

    if not is_configured():
        target = _fallback_path(blob_path)
        if target is None:
            raise StorageError("workshop_storage_unavailable")
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        except OSError:
            raise StorageError("workshop_storage_unavailable") from None
        return

    service, container = _container_client()
    try:
        from azure.storage.blob import ContentSettings

        try:
            await container.create_container()
        except Exception:
            pass   # already there, or the credential may only write blobs

        await container.upload_blob(
            blob_path,
            data,
            overwrite=False,
            content_settings=ContentSettings(
                content_type="text/html; charset=utf-8",
                cache_control="private, max-age=31536000, immutable",
            ),
        )
    except Exception as exc:
        if "BlobAlreadyExists" in str(exc):
            raise StorageError("artifact_already_exists") from None
        print(f"⚠️ workshop artifact upload failed: {type(exc).__name__}")
        raise StorageError("workshop_storage_unavailable") from None
    finally:
        await service.close()


async def get(blob_path: str) -> str:
    """Read one artifact version back."""
    if not is_configured():
        target = _fallback_path(blob_path)
        if target is None or not target.is_file():
            raise StorageError("artifact_not_found")
        return target.read_text(encoding="utf-8")

    service, container = _container_client()
    try:
        stream = await container.download_blob(blob_path)
        data = await stream.readall()
        return data.decode("utf-8")
    except Exception as exc:
        if "BlobNotFound" in str(exc):
            raise StorageError("artifact_not_found") from None
        print(f"⚠️ workshop artifact download failed: {type(exc).__name__}")
        raise StorageError("workshop_storage_unavailable") from None
    finally:
        await service.close()
