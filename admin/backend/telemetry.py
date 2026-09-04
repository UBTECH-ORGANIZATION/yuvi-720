"""Application Insights / OpenTelemetry setup for the admin API — import-safe.

Mirrors the main backend telemetry helper (``backend/app/core/telemetry.py``),
deliberately duplicated rather than imported: the admin console is a separate
deployable with its own requirements, and a cross-service import would couple
their build graphs for the sake of forty lines.

Activation depends solely on the ``APPLICATIONINSIGHTS_CONNECTION_STRING``
environment variable that the Azure App Service provides; when absent (local
dev, tests) this is a no-op.
"""

from __future__ import annotations

import logging
import os
import time

_configured = False

logger = logging.getLogger(__name__)

SLOW_REQUEST_MS = float(os.getenv("SPARK_SLOW_REQUEST_MS", "800"))


def _service_version() -> str:
    for key in ("SPARK_RELEASE", "IMAGE_TAG", "GIT_SHA", "GITHUB_SHA"):
        value = (os.getenv(key) or "").strip()
        if value:
            return value[:40]
    return "dev"


def _environment() -> str:
    explicit = (os.getenv("SPARK_ENVIRONMENT") or "").strip()
    if explicit:
        return explicit
    slot = (os.getenv("WEBSITE_SLOT_NAME") or "").strip()
    if slot:
        return "production" if slot.lower() == "production" else slot
    return "local"


def _instrument_clients() -> list[str]:
    """Track the admin console's own outbound calls: Mongo and HTTP."""
    enabled: list[str] = []
    try:
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

        HTTPXClientInstrumentor().instrument()
        enabled.append("httpx")
    except Exception:
        logger.debug("httpx instrumentation unavailable", exc_info=True)
    try:
        from opentelemetry.instrumentation.pymongo import PymongoInstrumentor

        PymongoInstrumentor().instrument()
        enabled.append("pymongo")
    except Exception:
        logger.debug("pymongo instrumentation unavailable", exc_info=True)
    return enabled


def _quiet_exporter_logs() -> None:
    """Keep the exporter's own HTTP chatter out of the slot's log stream.

    ``azure.core`` narrates every telemetry upload at INFO and the exporter
    adds a line per transmission — a screenful per flush on the App Service
    log stream. WARNING keeps real delivery failures visible.
    """
    for name in (
        "azure.core.pipeline.policies.http_logging_policy",
        "azure.monitor.opentelemetry.exporter",
    ):
        logging.getLogger(name).setLevel(logging.WARNING)


class RequestTimingMiddleware:
    """Raw-ASGI request timer: `Server-Timing` header plus a slow-request log.

    Works with no Azure resource attached, which is the point — a slow admin
    page should be diagnosable from the container log alone.
    """

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started = time.perf_counter()

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                elapsed_ms = (time.perf_counter() - started) * 1000
                message.setdefault("headers", []).append(
                    (b"server-timing", f"app;dur={elapsed_ms:.1f}".encode("latin-1"))
                )
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            elapsed_ms = (time.perf_counter() - started) * 1000
            if elapsed_ms >= SLOW_REQUEST_MS:
                route = scope.get("route")
                name = getattr(route, "path", None) or scope.get("path", "?")
                logger.warning(
                    "slow request %s %s took %.0fms",
                    scope.get("method", "?"),
                    name,
                    elapsed_ms,
                )


def configure_telemetry(app, service_name: str = "spark-admin") -> bool:
    """Attach Azure Monitor telemetry to the admin FastAPI app. Safe to call once."""
    global _configured
    if _configured:
        return True

    try:
        app.add_middleware(RequestTimingMiddleware)
    except Exception:  # pragma: no cover
        logger.exception("Failed to install request timing middleware.")

    connection_string = os.getenv("APPLICATIONINSIGHTS_CONNECTION_STRING")
    if not connection_string:
        logger.info("App Insights connection string not set; telemetry disabled.")
        return False

    try:
        from azure.monitor.opentelemetry import configure_azure_monitor
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.sdk.resources import Resource
    except ImportError:
        logger.warning(
            "azure-monitor-opentelemetry not installed; telemetry disabled."
        )
        return False

    try:
        os.environ.setdefault("OTEL_SERVICE_NAME", service_name)
        resource = Resource.create(
            {
                "service.name": service_name,
                # cloud_RoleName becomes "<slot>.spark-admin" — the admin API
                # and the learner app must never share a latency series.
                "service.namespace": _environment(),
                "service.version": _service_version(),
                "service.instance.id": os.getenv("WEBSITE_INSTANCE_ID", "local"),
                "deployment.environment": _environment(),
            }
        )
        configure_azure_monitor(
            connection_string=connection_string,
            resource=resource,
            enable_live_metrics=True,
            # We instrument FastAPI explicitly below; letting the distro also do
            # it globally would double-count every request.
            instrumentation_options={
                "fastapi": {"enabled": False},
                "django": {"enabled": False},
                "flask": {"enabled": False},
                "psycopg2": {"enabled": False},
            },
        )
        # The support console holds a WebSocket open for the whole session; as a
        # span it would be one multi-minute "request" skewing every percentile.
        FastAPIInstrumentor.instrument_app(app, excluded_urls="/healthz,/support/ws")
        clients = _instrument_clients()
        _quiet_exporter_logs()
        _configured = True
        logger.info(
            "Application Insights configured for %s (%s); dependencies: %s",
            service_name,
            _environment(),
            ", ".join(clients) or "none",
        )
        return True
    except Exception:  # pragma: no cover - never break app startup on telemetry
        logger.exception("Failed to configure Application Insights telemetry.")
        return False
