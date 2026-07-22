"""Immutable asset routes for curated lesson illustrations.

Illustrations are hand-authored and shipped in-code (see
``app.services.lesson_illustrations``). There is no generation endpoint and no
model call — this router only serves the pre-built SVG assets.
"""

from __future__ import annotations

import hashlib
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Response

from app.services.lesson_illustrations import get_asset


router = APIRouter(tags=["lesson-illustrations"])


@router.get("/api/learning/illustrations/{asset_id}.svg")
async def read_illustration(asset_id: str, request: Request, motion: Optional[str] = None):
    """Serve a curated, inert SVG asset (animated, or motion-reduced)."""
    asset = await get_asset(asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="illustration_not_found")
    svg = asset.get("static_svg") if motion == "reduce" else asset["svg"]
    svg = svg or asset["svg"]
    etag = f'"{hashlib.sha256(svg.encode("utf-8")).hexdigest()}"'
    headers = {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Security-Policy": "default-src 'none'; style-src 'none'; sandbox",
        "ETag": etag,
        "X-Content-Type-Options": "nosniff",
    }
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(content=svg, media_type="image/svg+xml", headers=headers)
