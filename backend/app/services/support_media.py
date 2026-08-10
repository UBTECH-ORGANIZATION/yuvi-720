"""Screenshot attachments for support reports, stored in a private Blob container.

Nothing is ever served from a public URL or a long-lived SAS: reads go through an
authorized proxy route so only the reporter or an administrator can fetch a blob.
Uploads are validated by magic bytes, because a browser-supplied content type is
not evidence of anything.
"""

from __future__ import annotations

import os
from pathlib import Path
import re
from typing import Optional
from uuid import uuid4

CONTAINER = "support-attachments"
MAX_BYTES = 5 * 1024 * 1024
MAX_PER_TICKET = 3

_FALLBACK_ROOT = Path(__file__).resolve().parents[2] / ".runtime" / CONTAINER
_container_ready = False

# (magic prefix, content type, extension)
_SIGNATURES: tuple[tuple[bytes, str, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", "image/png", ".png"),
    (b"\xff\xd8\xff", "image/jpeg", ".jpg"),
)
_BLOB_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}/[A-Za-z0-9]{8,40}\.(png|jpg|webp)$")


class AttachmentError(Exception):
    """Raised for a rejected upload; the message is a stable error code."""


def sniff_image(data: bytes) -> tuple[str, str]:
    """Return (content_type, extension) or raise for anything not an image."""
    for prefix, content_type, extension in _SIGNATURES:
        if data.startswith(prefix):
            return content_type, extension
    # WEBP is "RIFF" + 4 size bytes + "WEBP".
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", ".webp"
    raise AttachmentError("unsupported_file_type")


def is_safe_blob_name(name: str) -> bool:
    return bool(_BLOB_NAME.fullmatch(name or ""))


def build_blob_name(owner_id: str, extension: str) -> str:
    safe_owner = re.sub(r"[^A-Za-z0-9_-]", "", owner_id)[:64] or "unknown"
    return f"{safe_owner}/{uuid4().hex}{extension}"


def _connection_string() -> str:
    return (os.environ.get("SUPPORT_STORAGE_CONNECTION_STRING") or "").strip()


def _account_url() -> str:
    return (os.environ.get("SUPPORT_STORAGE_ACCOUNT_URL") or "").strip().rstrip("/")


def is_configured() -> bool:
    return bool(_connection_string() or _account_url())


def _fallback_path(blob_name: str) -> Optional[Path]:
    """Resolve a blob name under the local dev store, or None if it escapes it."""
    candidate = (_FALLBACK_ROOT / blob_name).resolve()
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


async def upload(owner_id: str, data: bytes) -> dict[str, object]:
    if len(data) > MAX_BYTES:
        raise AttachmentError("file_too_large")
    content_type, extension = sniff_image(data)
    blob_name = build_blob_name(owner_id, extension)

    # Without a storage account the demo keeps working off disk, like every
    # other repository here — never the deployed path.
    if not is_configured():
        target = _fallback_path(blob_name)
        if target is None:
            raise AttachmentError("attachments_unavailable")
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            target.with_suffix(target.suffix + ".type").write_text(content_type, encoding="utf-8")
        except OSError as exc:
            print(f"⚠️ support attachment fallback write failed: {exc}")
            raise AttachmentError("attachments_unavailable") from None
        return {"blob_name": blob_name, "content_type": content_type, "size": len(data)}

    service, container = _container_client()
    try:
        from azure.storage.blob import ContentSettings

        global _container_ready
        if not _container_ready:
            # One attempt per process; a 409 just means someone else made it.
            try:
                await container.create_container()
            except Exception:
                pass
            _container_ready = True

        await container.upload_blob(
            blob_name,
            data,
            content_settings=ContentSettings(content_type=content_type),
        )
    except Exception as exc:
        print(f"⚠️ support attachment upload failed: {type(exc).__name__}")
        raise AttachmentError("attachments_unavailable") from None
    finally:
        await service.close()
    return {"blob_name": blob_name, "content_type": content_type, "size": len(data)}


async def download(blob_name: str) -> Optional[tuple[bytes, str]]:
    if not is_safe_blob_name(blob_name):
        return None

    if not is_configured():
        source = _fallback_path(blob_name)
        if source is None or not source.exists():
            return None
        try:
            marker = source.with_suffix(source.suffix + ".type")
            content_type = (
                marker.read_text(encoding="utf-8").strip() if marker.exists()
                else "application/octet-stream"
            )
            return source.read_bytes(), content_type
        except OSError as exc:
            print(f"⚠️ support attachment fallback read failed: {exc}")
            return None

    service, container = _container_client()
    try:
        stream = await container.download_blob(blob_name)
        data = await stream.readall()
        properties = getattr(stream, "properties", None)
        settings = getattr(properties, "content_settings", None)
        content_type = getattr(settings, "content_type", None) or "application/octet-stream"
        return data, content_type
    except Exception as exc:
        print(f"⚠️ support attachment read failed: {type(exc).__name__}")
        return None
    finally:
        await service.close()


def owner_of(blob_name: str) -> str:
    return blob_name.split("/", 1)[0] if "/" in blob_name else ""
