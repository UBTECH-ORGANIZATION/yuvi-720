"""Authorized read access to support screenshot attachments.

The container is private and there is no public URL or long-lived SAS: an
administrator fetches a blob through this service, which is already behind the
admin cookie.
"""

from __future__ import annotations

import os
import re
from typing import Optional

CONTAINER = "support-attachments"

_BLOB_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}/[A-Za-z0-9]{8,40}\.(png|jpg|webp)$")


def is_safe_blob_name(name: str) -> bool:
    return bool(_BLOB_NAME.fullmatch(name or ""))


def _connection_string() -> str:
    return (os.environ.get("SUPPORT_STORAGE_CONNECTION_STRING") or "").strip()


def _account_url() -> str:
    return (os.environ.get("SUPPORT_STORAGE_ACCOUNT_URL") or "").strip().rstrip("/")


def is_configured() -> bool:
    return bool(_connection_string() or _account_url())


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


async def download(blob_name: str) -> Optional[tuple[bytes, str]]:
    if not is_configured() or not is_safe_blob_name(blob_name):
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
        print(f"⚠️ Admin attachment read failed: {type(exc).__name__}")
        return None
    finally:
        await service.close()
