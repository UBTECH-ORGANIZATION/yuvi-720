"""Runtime telemetry configuration for the browser.

The browser SDK needs a connection string before it can send anything. It is
resolved here at request time rather than baked into the bundle at build time
because one Docker image is promoted across the dev, english and production
slots — a build-time value would report every slot's telemetry to whichever
resource CI happened to know about.

The connection string returned here is an *ingestion* key. It is designed to be
public (every browser using Application Insights holds one); it grants write
access to telemetry only, never read access to any data.
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.core.telemetry import browser_config


router = APIRouter(prefix="/api", tags=["telemetry"])


@router.get("/telemetry/config")
async def telemetry_config():
    """Tell the browser whether to start telemetry, and with what identity.

    Unauthenticated on purpose: the landing page and the login screen are part
    of the first-load experience we are trying to measure, and they are exactly
    where a slow cold start hurts most.
    """
    return JSONResponse(
        content=browser_config(),
        # Long enough that a class of learners arriving at once doesn't add a
        # request each, short enough that flipping the App Service setting takes
        # effect within a lesson.
        headers={"Cache-Control": "public, max-age=300"},
    )
