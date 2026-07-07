"""Agent Framework chat client over the existing APIM gateway (§5.1).

We reuse the APIM endpoint/key/deployment/api-version that `services.llm`
already resolves, so model traffic keeps flowing through APIM whether or not the
Agent Framework package is installed. If it is not installed (or cannot target
APIM in this version), `build_chat_client()` returns None and callers fall back
to the deterministic path + `call_llm`. The agent *definitions and orchestration*
in this codebase do not depend on which path is active.
"""

from __future__ import annotations

from typing import Any, Optional

from app.services.llm import LlmModelTier, _resolve_llm_config


def agent_framework_available() -> bool:
    try:
        import agent_framework  # noqa: F401
        return True
    except Exception:
        return False


def build_chat_client(model_tier: LlmModelTier = "strong") -> Optional[Any]:
    """Return an Agent Framework chat client bound to APIM, or None to fall back."""
    if not agent_framework_available():
        return None
    endpoint, key, deployment, api_version = _resolve_llm_config(model_tier)
    if not endpoint or not key:
        return None
    try:
        from agent_framework.azure import AzureOpenAIChatClient  # type: ignore

        return AzureOpenAIChatClient(
            endpoint=endpoint,
            api_key=key,
            deployment_name=deployment,
            api_version=api_version,
        )
    except Exception as exc:  # pragma: no cover - version/shape differences
        print(f"ℹ️ Agent Framework client unavailable, using fallback: {exc}")
        return None
