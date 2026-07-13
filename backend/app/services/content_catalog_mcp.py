"""Standard MCP facade over the external 720 content provider.

Catalog discovery is deliberately separate from xAPI delivery: MCP answers what
approved content is available; signed xAPI launches report what the learner did.
The tools expose no learner data and can be called by the Pedagogical Agent.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

from fastapi import FastAPI
from mcp.server.fastmcp import FastMCP

from app.services import content_provider


content_catalog_mcp = FastMCP(
    "yuvilab-content-catalog",
    instructions=(
        "Read-only tools for approved 720 learning units and components. "
        "Do not invent objectives or components that are absent from these tools."
    ),
    streamable_http_path="/",
    stateless_http=True,
    json_response=True,
)


@content_catalog_mcp.tool()
async def list_learning_units(subject: Optional[str] = None) -> list[dict]:
    """List approved provider units, optionally filtered by subject key."""
    units = await content_provider.list_units()
    if subject:
        units = [unit for unit in units if unit.get("subject") == subject]
    return units


@content_catalog_mcp.tool()
async def get_learning_unit(unit_id: str) -> dict:
    """Get one approved unit with its ordered component metadata."""
    return await content_provider.get_unit(unit_id)


@content_catalog_mcp.tool()
async def get_learning_component(
    component_id: str,
    unit_id: Optional[str] = None,
) -> dict:
    """Resolve one approved component and its parent unit."""
    unit, component = await content_provider.resolve_component(component_id, unit_id)
    return {"unit": unit, "component": component}


content_catalog_mcp_app = content_catalog_mcp.streamable_http_app()


@asynccontextmanager
async def content_catalog_mcp_lifespan() -> AsyncIterator[None]:
    """Run the mounted MCP transport's session manager in the parent lifespan."""
    async with content_catalog_mcp_app.router.lifespan_context(content_catalog_mcp_app):
        yield


def mount_content_catalog_mcp(app: FastAPI) -> None:
    """Mount the stateless Streamable HTTP MCP transport before static routes."""
    app.mount("/mcp/content-catalog", content_catalog_mcp_app)
