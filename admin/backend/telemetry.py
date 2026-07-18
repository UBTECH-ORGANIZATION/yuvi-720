"""Application Insights / OpenTelemetry setup for the admin API — import-safe.

Mirrors the main backend telemetry helper. Activation depends solely on the
``APPLICATIONINSIGHTS_CONNECTION_STRING`` environment variable that the Azure
App Service provides; when absent (local dev, tests) this is a no-op.
"""

from __future__ import annotations

import logging
import os

_configured = False

logger = logging.getLogger(__name__)


def configure_telemetry(app, service_name: str = "spark-admin") -> bool:
    """Attach Azure Monitor telemetry to the admin FastAPI app. Safe to call once."""
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
            "azure-monitor-opentelemetry not installed; telemetry disabled."
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
