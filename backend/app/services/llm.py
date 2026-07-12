"""LLM gateway service for learner-facing AI features."""

import asyncio
import json
import os
import re
from pathlib import Path
from typing import AsyncGenerator, Literal

import httpx

from app.services.ai_usage import (
    UsageContext,
    UsageTimer,
    provider_request_id,
    record_usage,
    token_usage_from_payload,
)


APP_ROOT = Path(__file__).resolve().parents[3]
ENV_PATHS = [
    APP_ROOT / "backend" / ".env",
    APP_ROOT / ".env",
    APP_ROOT.parent / "src" / "backend" / ".env",
]

# Canonical loader lives in app.core.env (import-safe for every entrypoint).
from app.core.env import ensure_env_loaded, load_env_file  # noqa: E402,F401

ensure_env_loaded()

LlmModelTier = Literal["strong", "mini"]


def _deployment_for_tier(model_tier: LlmModelTier) -> str:
    if model_tier == "strong":
        return (
            os.environ.get("LLM_STRONG_DEPLOYMENT_NAME")
            or os.environ.get("GPT_54_DEPLOYMENT_NAME")
            or "gpt-5.4"
        )
    return (
        os.environ.get("LLM_MINI_DEPLOYMENT_NAME")
        or os.environ.get("LLM_WEAK_DEPLOYMENT_NAME")
        or "gpt-5.4-mini"
    )


def _resolve_llm_config(model_tier: LlmModelTier = "mini") -> tuple[str, str, str, str]:
    apim_base = os.environ.get("APIM_BASE_URL", "").rstrip("/")
    apim_key = os.environ.get("APIM_SUBSCRIPTION_KEY", "")
    deployment = _deployment_for_tier(model_tier)
    api_version = os.environ.get("APIM_API_VERSION", "2024-10-21")

    endpoint, key = apim_base, apim_key
    if not endpoint or not key:
        foundry = os.environ.get("AZURE_AI_FOUNDRY_ENDPOINT", "")
        foundry_key = os.environ.get("AZURE_AI_FOUNDRY_API_KEY", "")
        if foundry and foundry_key:
            endpoint = re.sub(r"/api/projects/.*", "", foundry.rstrip("/")) + "/openai"
            key = foundry_key

    return endpoint, key, deployment, api_version


async def call_llm(
    messages: list,
    *,
    usage_context: UsageContext,
    max_tokens: int = 1200,
    json_mode: bool = False,
    model_tier: LlmModelTier = "mini",
):
    """Call the shared Azure OpenAI model through the APIM gateway."""
    timer = UsageTimer.start()
    endpoint, key, deployment, api_version = _resolve_llm_config(model_tier)
    gateway = "apim" if os.environ.get("APIM_BASE_URL") else "foundry"
    if not endpoint or not key:
        print("⚠️ No LLM endpoint configured (APIM/Foundry)")
        await record_usage(
            context=usage_context,
            timer=timer,
            provider="azure_openai",
            gateway=gateway,
            deployment=deployment,
            api_version=api_version,
            streaming=False,
            meter="tokens",
            status="unavailable",
            usage_status="unavailable",
            model_tier=model_tier,
        )
        return None

    url = f"{endpoint}/deployments/{deployment}/chat/completions?api-version={api_version}"
    headers = {
        "Ocp-Apim-Subscription-Key": key,
        "api-key": key,
        "Content-Type": "application/json",
    }
    token_key = "max_completion_tokens" if deployment.startswith("gpt-5") else "max_tokens"
    body = {"messages": messages, token_key: max_tokens}
    if json_mode:
        body["response_format"] = {"type": "json_object"}

    response = None
    error = None
    status = "failed"
    usage = None
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(url, json=body, headers=headers)
            if response.status_code == 200:
                data = response.json()
                usage = token_usage_from_payload(data.get("usage"))
                status = "completed"
                content = (data.get("choices") or [{}])[0].get("message", {}).get("content")
                if content and content.strip():
                    return content.strip()
                print("⚠️ LLM returned empty content")
                return None
            print(f"⚠️ LLM HTTP {response.status_code}")
            return None
    except Exception as exc:
        error = exc
        print(f"⚠️ LLM request failed: {type(exc).__name__}")
        return None
    finally:
        await record_usage(
            context=usage_context,
            timer=timer,
            provider="azure_openai",
            gateway=gateway,
            deployment=deployment,
            api_version=api_version,
            streaming=False,
            meter="tokens",
            status=status,
            usage_status="exact" if usage is not None else "unavailable",
            usage=usage,
            provider_request=provider_request_id(response.headers) if response is not None else None,
            error=error,
            model_tier=model_tier,
        )


async def call_llm_stream(
    messages: list,
    *,
    usage_context: UsageContext,
    max_tokens: int = 4000,
    model_tier: LlmModelTier = "mini",
) -> AsyncGenerator[str, None]:
    """Stream tokens from the Azure OpenAI model."""
    timer = UsageTimer.start()
    endpoint, key, deployment, api_version = _resolve_llm_config(model_tier)
    gateway = "apim" if os.environ.get("APIM_BASE_URL") else "foundry"
    if not endpoint or not key:
        await record_usage(
            context=usage_context,
            timer=timer,
            provider="azure_openai",
            gateway=gateway,
            deployment=deployment,
            api_version=api_version,
            streaming=True,
            meter="tokens",
            status="unavailable",
            usage_status="unavailable",
            model_tier=model_tier,
        )
        return

    url = f"{endpoint}/deployments/{deployment}/chat/completions?api-version={api_version}"
    headers = {
        "Ocp-Apim-Subscription-Key": key,
        "api-key": key,
        "Content-Type": "application/json",
    }
    token_key = "max_completion_tokens" if deployment.startswith("gpt-5") else "max_tokens"
    body = {
        "messages": messages,
        token_key: max_tokens,
        "stream": True,
        "stream_options": {"include_usage": True},
    }

    status = "cancelled"
    usage = None
    provider_request = None
    error = None
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            async with client.stream("POST", url, json=body, headers=headers) as response:
                provider_request = provider_request_id(response.headers)
                if response.status_code != 200:
                    status = "failed"
                    print(f"⚠️ LLM stream HTTP {response.status_code}")
                    return
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data_str = line[6:]
                    if data_str == "[DONE]":
                        status = "completed"
                        break
                    try:
                        chunk = json.loads(data_str)
                        chunk_usage = token_usage_from_payload(chunk.get("usage"))
                        if chunk_usage is not None:
                            usage = chunk_usage
                        delta = (chunk.get("choices") or [{}])[0].get("delta", {})
                        content = delta.get("content")
                        if content:
                            yield content
                    except (json.JSONDecodeError, IndexError, KeyError):
                        continue
                else:
                    status = "completed"
    except asyncio.CancelledError as exc:
        error = exc
        status = "cancelled"
        raise
    except Exception as exc:
        error = exc
        status = "failed"
        print(f"⚠️ LLM stream error: {type(exc).__name__}")
    finally:
        write = asyncio.create_task(record_usage(
            context=usage_context,
            timer=timer,
            provider="azure_openai",
            gateway=gateway,
            deployment=deployment,
            api_version=api_version,
            streaming=True,
            meter="tokens",
            status=status,
            usage_status="exact" if usage is not None else "unavailable",
            usage=usage,
            provider_request=provider_request,
            error=error,
            model_tier=model_tier,
        ))
        try:
            await asyncio.shield(write)
        except asyncio.CancelledError:
            pass