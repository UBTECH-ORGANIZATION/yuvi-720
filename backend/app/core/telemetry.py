"""Application Insights / OpenTelemetry setup — import-safe and optional.

Wires the FastAPI app to Azure Monitor so we get request latency, dependency
calls (httpx/Mongo), exceptions, and custom metrics in Application Insights.

Activation is driven purely by the ``APPLICATIONINSIGHTS_CONNECTION_STRING``
environment variable (set on the Azure App Service). When it is absent — local
dev, tests, CI — this module is a no-op so nothing needs Azure to run. If the
optional ``azure-monitor-opentelemetry`` dependency is missing, it degrades to a
warning instead of crashing the app.
"""

from __future__ import annotations

import logging
import os

_configured = False

logger = logging.getLogger(__name__)


def configure_telemetry(app, service_name: str = "spark-backend") -> bool:
    """Attach Azure Monitor telemetry to a FastAPI app. Safe to call once.

    Returns ``True`` when telemetry was configured, ``False`` when skipped.
    """
    global _configured
    if _configured:
        return True

    connection_string = os.getenv("APPLICATIONINSIGHTS_CONNECTION_STRING")
    if not connection_string:
        logger.info("App Insights connection string not set; telemetry disabled.")
        return False

    try:
        from azure.monitor.opentelemetry import configure_azure_monitor
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    except ImportError:
        logger.warning(
            "azure-monitor-opentelemetry not installed; telemetry disabled. "
            "Add it to requirements.txt to enable Application Insights."
        )
        return False

    try:
        os.environ.setdefault("OTEL_SERVICE_NAME", service_name)
        configure_azure_monitor(connection_string=connection_string)
        FastAPIInstrumentor.instrument_app(app)
        _configured = True
        logger.info("Application Insights telemetry configured for %s.", service_name)
        return True
    except Exception:  # pragma: no cover - never break app startup on telemetry
        logger.exception("Failed to configure Application Insights telemetry.")
        return False
