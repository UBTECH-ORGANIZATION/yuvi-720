"""Application Insights / OpenTelemetry setup — import-safe and optional.

Wires the FastAPI app to Azure Monitor so we get request latency, dependency
calls (httpx, aiohttp, Mongo), exceptions, logs and custom metrics in
Application Insights.

Activation is driven purely by the ``APPLICATIONINSIGHTS_CONNECTION_STRING``
environment variable (set on the Azure App Service). When it is absent — local
dev, tests, CI — the exporter is a no-op so nothing needs Azure to run. If the
optional ``azure-monitor-opentelemetry`` dependency is missing, it degrades to a
warning instead of crashing the app.

Request timing is deliberately *not* conditional on any of that: the
``RequestTimingMiddleware`` uses the standard library only, so a slow endpoint
shows up in the local console and in the ``Server-Timing`` response header even
with no Azure resource attached. Monitoring you can only read in the cloud is
monitoring you will not read while you are fixing the thing.
"""

from __future__ import annotations

import logging
import os
import time
from contextlib import contextmanager
from typing import Any, Iterator, Optional

_configured = False

logger = logging.getLogger(__name__)

#: Requests slower than this are logged as slow. School hardware on a school
#: network is the target, so the bar is deliberately low.
SLOW_REQUEST_MS = float(os.getenv("SPARK_SLOW_REQUEST_MS", "800"))

#: Paths that must never open a server span. Static assets would swamp the
#: request table, and an SSE stream is a single span held open for minutes,
#: which poisons every latency percentile in the portal.
_EXCLUDED_URLS = ",".join(
    (
        "^/assets",
        "^/shared",
        "^/locales",
        "^/moments",
        "favicon",
        "/healthz",
        "/api/agent/.*stream",
        "/api/teacher/live/stream",
        "/api/support/ws",
    )
)


def _service_version() -> str:
    """Whatever the deploy pipeline stamped on the image, else 'dev'."""
    for key in ("SPARK_RELEASE", "IMAGE_TAG", "GIT_SHA", "GITHUB_SHA"):
        value = (os.getenv(key) or "").strip()
        if value:
            return value[:40]
    return "dev"


def _environment() -> str:
    """dev / english / production — used to split the dashboards per slot."""
    explicit = (os.getenv("SPARK_ENVIRONMENT") or "").strip()
    if explicit:
        return explicit
    slot = (os.getenv("WEBSITE_SLOT_NAME") or "").strip()
    if slot:
        return "production" if slot.lower() == "production" else slot
    return "local"


def _instrument_clients() -> list[str]:
    """Turn on dependency tracking for the clients we actually call out with.

    The Azure Monitor distro only auto-instruments a fixed list (django, flask,
    requests, urllib*, psycopg2, fastapi) — httpx, aiohttp and pymongo are not
    on it, and those three *are* our outbound traffic: APIM/Azure OpenAI, the
    Kata content API and every Mongo query. Without this the portal shows a slow
    request with no explanation of where the time went.

    Each is independent and best effort: a missing optional package must not
    cost us the instrumentation that is installed.
    """
    enabled: list[str] = []

    try:  # APIM / Azure OpenAI / Kata / LRS
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

        HTTPXClientInstrumentor().instrument()
        enabled.append("httpx")
    except Exception:
        logger.debug("httpx instrumentation unavailable", exc_info=True)

    try:  # Mongo/Cosmos — motor drives pymongo's monitoring hooks
        from opentelemetry.instrumentation.pymongo import PymongoInstrumentor

        PymongoInstrumentor().instrument()
        enabled.append("pymongo")
    except Exception:
        logger.debug("pymongo instrumentation unavailable", exc_info=True)

    try:
        from opentelemetry.instrumentation.aiohttp_client import (
            AioHttpClientInstrumentor,
        )

        AioHttpClientInstrumentor().instrument()
        enabled.append("aiohttp")
    except Exception:
        logger.debug("aiohttp instrumentation unavailable", exc_info=True)

    return enabled


def configure_telemetry(app, service_name: str = "spark-backend") -> bool:
    """Attach Azure Monitor telemetry to a FastAPI app. Safe to call once.

    Returns ``True`` when telemetry was configured, ``False`` when skipped.
    """
    global _configured
    if _configured:
        return True

    # Timing middleware first and unconditionally — it has no Azure dependency.
    try:
        app.add_middleware(RequestTimingMiddleware)
    except Exception:  # pragma: no cover - never break app startup on telemetry
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
            "azure-monitor-opentelemetry not installed; telemetry disabled. "
            "Add it to requirements.txt to enable Application Insights."
        )
        return False

    try:
        os.environ.setdefault("OTEL_SERVICE_NAME", service_name)
        resource = Resource.create(
            {
                "service.name": service_name,
                # Azure Monitor builds cloud_RoleName as "namespace.name", so
                # putting the slot here is what keeps a dev-slot deploy from
                # dragging the production latency percentiles around.
                "service.namespace": _environment(),
                "service.version": _service_version(),
                "service.instance.id": os.getenv("WEBSITE_INSTANCE_ID", "local"),
                "deployment.environment": _environment(),
            }
        )
        configure_azure_monitor(
            connection_string=connection_string,
            resource=resource,
            # Live Metrics is what makes "is it slow right now?" answerable
            # during a school demo instead of five minutes afterwards.
            enable_live_metrics=True,
            # The distro would auto-instrument FastAPI globally; we do it below
            # with an exclusion list instead, so static assets and SSE streams
            # stay out of the request table.
            instrumentation_options={
                "fastapi": {"enabled": False},
                "django": {"enabled": False},
                "flask": {"enabled": False},
                "psycopg2": {"enabled": False},
            },
        )
        FastAPIInstrumentor.instrument_app(app, excluded_urls=_EXCLUDED_URLS)
        clients = _instrument_clients()
        _configured = True
        logger.info(
            "Application Insights configured for %s (%s, %s); dependencies: %s",
            service_name,
            _environment(),
            _service_version(),
            ", ".join(clients) or "none",
        )
        return True
    except Exception:  # pragma: no cover - never break app startup on telemetry
        logger.exception("Failed to configure Application Insights telemetry.")
        return False


class RequestTimingMiddleware:
    """Time every request, expose it to the browser, and flag the slow ones.

    Written as raw ASGI rather than ``BaseHTTPMiddleware`` on purpose: that base
    class wraps each request in an anyio task group and pumps the response
    through a queue, which is measurable overhead on exactly the streaming
    endpoints (SSE coach turns) we least want to slow down.

    The ``Server-Timing`` header means anyone with devtools open — including on
    a school laptop — can see the server's own number next to the network time,
    which is the only way to tell "the server is slow" apart from "the school's
    line is slow". That distinction is the whole question here.
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
                headers = message.setdefault("headers", [])
                headers.append(
                    (b"server-timing", f"app;dur={elapsed_ms:.1f}".encode("latin-1"))
                )
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            elapsed_ms = (time.perf_counter() - started) * 1000
            if elapsed_ms >= SLOW_REQUEST_MS:
                route = scope.get("route")
                # The route template, not the raw path: `/api/brain/{learner_id}`
                # aggregates, `/api/brain/9f3c…` is one row per learner and
                # tells you nothing.
                name = getattr(route, "path", None) or scope.get("path", "?")
                logger.warning(
                    "slow request %s %s took %.0fms",
                    scope.get("method", "?"),
                    name,
                    elapsed_ms,
                )


@contextmanager
def measure(name: str, **attributes: Any) -> Iterator[None]:
    """Record a named span for work that is neither a request nor a client call.

    Use it for in-process work that is expensive and otherwise invisible:
    projecting the brain into a dashboard, building the catalog snapshot,
    scoring a questionnaire. Without it a 3-second request shows 200ms of Mongo
    and 2.8 seconds of unexplained gap.

    Never raises on its own and never swallows: if OpenTelemetry is missing the
    body still runs, and any exception from the body still propagates.

    Attributes must stay operational — ids, counts, languages. Never a learner
    name, never prompt or response text.
    """
    try:
        from opentelemetry import trace

        tracer = trace.get_tracer("spark")
    except Exception:
        yield
        return

    with tracer.start_as_current_span(name) as span:
        started = time.perf_counter()
        try:
            for key, value in attributes.items():
                span.set_attribute(f"spark.{key}", value)
        except Exception:  # pragma: no cover - attributes are never worth a 500
            pass
        try:
            yield
        finally:
            try:
                span.set_attribute(
                    "spark.duration_ms",
                    round((time.perf_counter() - started) * 1000, 1),
                )
            except Exception:  # pragma: no cover
                pass


_histograms: dict[str, Any] = {}


def track_metric(name: str, value: float, **attributes: Any) -> None:
    """Emit one custom measurement (milliseconds, counts, bytes).

    Best effort by design: telemetry must never be the reason a learner sees an
    error page.
    """
    try:
        from opentelemetry import metrics

        histogram = _histograms.get(name)
        if histogram is None:
            histogram = metrics.get_meter("spark").create_histogram(name)
            _histograms[name] = histogram
        histogram.record(value, {f"spark.{k}": v for k, v in attributes.items()})
    except Exception:  # pragma: no cover
        logger.debug("metric %s dropped", name, exc_info=True)


def browser_config() -> dict[str, Optional[str] | bool | float]:
    """What the browser SDK needs in order to start, resolved at runtime.

    Runtime rather than build time because one Docker image is deployed to every
    slot: baking the connection string into the bundle would send dev, english
    and production telemetry to whichever resource CI happened to know about.
    ``APPLICATIONINSIGHTS_CONNECTION_STRING_BROWSER`` lets ops point the browser
    at a separate resource; otherwise it shares the backend's, which is what
    makes a browser page view and the server request it triggered join up into
    one end-to-end transaction.
    """
    connection_string = (
        os.getenv("APPLICATIONINSIGHTS_CONNECTION_STRING_BROWSER")
        or os.getenv("APPLICATIONINSIGHTS_CONNECTION_STRING")
        or ""
    ).strip()
    try:
        sampling = float(os.getenv("SPARK_BROWSER_SAMPLING_PERCENT", "100"))
    except ValueError:
        sampling = 100.0
    return {
        "enabled": bool(connection_string),
        "connectionString": connection_string or None,
        # Same "<slot>.<service>" shape the backend reports, so one dashboard
        # filter covers the browser and the server it talked to.
        "roleName": os.getenv(
            "SPARK_BROWSER_ROLE_NAME", f"{_environment()}.spark-web"
        ),
        "environment": _environment(),
        "release": _service_version(),
        "samplingPercentage": max(0.0, min(100.0, sampling)),
    }
