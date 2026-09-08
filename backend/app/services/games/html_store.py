"""Where a game's HTML lives. Never Mongo.

One key, ``games/{learner_id}/{game_id}/v{n}/index.html``, and two backends
behind it chosen by ``GAMES_STORAGE``:

    local   (default) files under ``backend/.runtime/games/…`` — the dev box,
            the test suite, and a worker running next to the app.
    blob    Azure Blob Storage — container ``GAMES_BLOB_CONTAINER`` (default
            ``games``), reached through ``AZURE_STORAGE_CONNECTION_STRING`` or
            ``GAMES_STORAGE_ACCOUNT_URL`` + ``DefaultAzureCredential`` (managed
            identity in production, the same ladder ``support_media`` uses).

The key is the whole contract between the app and the worker: the worker
writes ``put_html`` and stores the key on the version entry, the app reads it
back with ``get_html``. Neither side knows which backend served it, which is
what lets a game built on a laptop be served from the same code path as one
built in the Container App.

Reads return text and writes take text: a game is one UTF-8 document, and the
byte-level details (content type, hashing) are settled here so that the sha256
on the version entry is the hash of exactly what was stored.
"""

from __future__ import annotations

import hashlib
import logging
import os
from pathlib import Path
from typing import Any, Optional, Protocol

log = logging.getLogger(__name__)

STORAGE_LOCAL = "local"
STORAGE_BLOB = "blob"

_LOCAL_ROOT = Path(__file__).resolve().parents[3] / ".runtime"
_DEFAULT_CONTAINER = "games"


class HtmlStoreError(Exception):
    """A storage failure the caller may see. The message is a stable code."""


def storage_mode() -> str:
    mode = (os.environ.get("GAMES_STORAGE") or STORAGE_LOCAL).strip().lower()
    if mode not in (STORAGE_LOCAL, STORAGE_BLOB):
        log.warning("GAMES_STORAGE=%r is not local|blob; using local", mode)
        return STORAGE_LOCAL
    return mode


def blob_path(learner_id: str, game_id: str, v: int) -> str:
    """The storage key of one version. Also the Blob name in the container."""
    return f"games/{learner_id}/{game_id}/v{int(v)}/index.html"


def sha256_of(html: str) -> str:
    return hashlib.sha256(html.encode("utf-8")).hexdigest()


class _Backend(Protocol):
    async def put(self, key: str, html: str) -> None: ...
    async def put_bytes(self, key: str, data: bytes, content_type: str) -> None: ...
    async def get(self, key: str) -> Optional[str]: ...
    async def exists(self, key: str) -> bool: ...


# ── local filesystem ─────────────────────────────────────────────────────────

class _LocalBackend:
    """Files under ``.runtime``. The key is the path, so the layout on disk is
    the layout in the container — a dump of one is a restore of the other."""

    def __init__(self, root: Optional[Path] = None) -> None:
        self.root = (root or _LOCAL_ROOT).resolve()

    def _path(self, key: str) -> Path:
        candidate = (self.root / key).resolve()
        if not candidate.is_relative_to(self.root):
            raise HtmlStoreError("bad_key")
        return candidate

    async def put(self, key: str, html: str) -> None:
        target = self._path(key)
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(html, encoding="utf-8")
        except OSError as exc:
            log.warning("game html local write failed: %s", exc)
            raise HtmlStoreError("storage_unavailable") from None

    async def put_bytes(self, key: str, data: bytes, content_type: str) -> None:
        target = self._path(key)
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        except OSError as exc:
            log.warning("game asset local write failed: %s", exc)
            raise HtmlStoreError("storage_unavailable") from None

    async def get(self, key: str) -> Optional[str]:
        target = self._path(key)
        try:
            return target.read_text(encoding="utf-8") if target.exists() else None
        except OSError as exc:
            log.warning("game html local read failed: %s", exc)
            raise HtmlStoreError("storage_unavailable") from None

    async def exists(self, key: str) -> bool:
        return self._path(key).exists()


# ── Azure Blob ───────────────────────────────────────────────────────────────

def _container_name() -> str:
    return (os.environ.get("GAMES_BLOB_CONTAINER") or _DEFAULT_CONTAINER).strip()


def _connection_string() -> str:
    return (os.environ.get("AZURE_STORAGE_CONNECTION_STRING") or "").strip()


def _account_url() -> str:
    return (os.environ.get("GAMES_STORAGE_ACCOUNT_URL") or "").strip().rstrip("/")


class _BlobBackend:
    """Azure Blob, imported lazily so a dev box without the SDK's credential
    chain never pays for it. One service client per call, closed after — the
    app serves a handful of games a minute, not thousands."""

    def _clients(self) -> tuple[Any, Any]:
        from azure.storage.blob.aio import BlobServiceClient

        connection = _connection_string()
        if connection:
            service = BlobServiceClient.from_connection_string(connection)
        elif _account_url():
            from azure.identity.aio import DefaultAzureCredential

            service = BlobServiceClient(_account_url(), credential=DefaultAzureCredential())
        else:
            raise HtmlStoreError("storage_not_configured")
        return service, service.get_container_client(_container_name())

    async def put(self, key: str, html: str) -> None:
        from azure.storage.blob import ContentSettings

        service, container = self._clients()
        try:
            await container.upload_blob(
                key, html.encode("utf-8"), overwrite=True,
                content_settings=ContentSettings(content_type="text/html; charset=utf-8"),
            )
        except Exception as exc:
            log.warning("game html blob upload failed: %s", type(exc).__name__)
            raise HtmlStoreError("storage_unavailable") from None
        finally:
            await service.close()

    async def put_bytes(self, key: str, data: bytes, content_type: str) -> None:
        from azure.storage.blob import ContentSettings

        service, container = self._clients()
        try:
            await container.upload_blob(
                key, data, overwrite=True, content_settings=ContentSettings(content_type=content_type),
            )
        except Exception as exc:
            log.warning("game asset blob upload failed: %s", type(exc).__name__)
            raise HtmlStoreError("storage_unavailable") from None
        finally:
            await service.close()

    async def get(self, key: str) -> Optional[str]:
        service, container = self._clients()
        try:
            blob = container.get_blob_client(key)
            if not await blob.exists():
                return None
            stream = await blob.download_blob()
            return (await stream.readall()).decode("utf-8")
        except Exception as exc:
            log.warning("game html blob read failed: %s", type(exc).__name__)
            raise HtmlStoreError("storage_unavailable") from None
        finally:
            await service.close()

    async def exists(self, key: str) -> bool:
        service, container = self._clients()
        try:
            return bool(await container.get_blob_client(key).exists())
        except Exception as exc:
            log.warning("game html blob head failed: %s", type(exc).__name__)
            raise HtmlStoreError("storage_unavailable") from None
        finally:
            await service.close()


def backend() -> _Backend:
    """The backend for this process, read from the environment on every call so
    a test can flip it with one env var and nothing has to be reset."""
    if storage_mode() == STORAGE_BLOB:
        return _BlobBackend()
    return _LocalBackend()


# ── public API ───────────────────────────────────────────────────────────────

async def put_html(learner_id: str, game_id: str, v: int, html: str) -> dict[str, Any]:
    """Store one version. Returns what the version entry records about it."""
    key = blob_path(learner_id, game_id, v)
    await backend().put(key, html)
    return {"blob_path": key, "sha256": sha256_of(html), "bytes": len(html.encode("utf-8"))}


async def put_bytes(
    learner_id: str, game_id: str, v: int, name: str, data: bytes,
    content_type: str = "application/octet-stream",
) -> str:
    """Store a sidecar asset of a version (the thumbnail). Returns its key."""
    key = blob_path(learner_id, game_id, v).rsplit("/", 1)[0] + "/" + name
    await backend().put_bytes(key, data, content_type)
    return key


async def get_html(key: str) -> Optional[str]:
    """The stored document, or None when the key holds nothing."""
    return await backend().get(key)


async def html_exists(key: str) -> bool:
    return await backend().exists(key)
