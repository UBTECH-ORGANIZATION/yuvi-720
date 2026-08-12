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


class LlmError(Exception):
    """A provider refusal a caller asked to SEE rather than to be spared.

    Every caller here treats a failure the same way — `None`, degrade, carry on
    — and that is right for a feature. It is wrong for a screen: when the
    provider's own content filter refuses to process a message, *that refusal is
    a finding about the message*, and a screen that receives it as `None` is a
    screen that reports "nothing to worry about" precisely when there was.

    Raised only when a caller passes `raise_on_error=True`, so nothing else in
    the codebase changes shape.
    """

    def __init__(self, status_code: int, code: str = "", payload: dict | None = None):
        super().__init__(f"llm_http_{status_code}")
        self.status_code = status_code
        self.code = code
        self.payload = payload or {}

    @property
    def content_filtered(self) -> bool:
        return self.status_code == 400 and self.code == "content_filter"

    def filtered_categories(self) -> set[str]:
        """Azure's own harm labels on the INPUT, when it filtered one.

        `jailbreak` and `indirect_attack` are deliberately not here: they say
        the prompt looked like an attack on the model, which is not the same
        claim as "this text would harm the person receiving it".
        """
        inner = (self.payload.get("error") or {}).get("innererror") or {}
        result = inner.get("content_filter_result") or {}
        return {
            name for name in ("sexual", "violence", "hate", "self_harm")
            if isinstance(result.get(name), dict) and result[name].get("filtered")
        }


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
    tools: list | None = None,
    tool_choice: str | dict | None = None,
    raise_on_error: bool = False,
):
    """Call the shared Azure OpenAI model through the APIM gateway.

    Return shape depends on `tools`, deliberately:

    * without `tools` — the assistant text, or `None`. Every existing caller.
    * with `tools` — the **whole** `choices[0].message` dict, because the useful
      part of a tool-calling round is `tool_calls`, and a helper that returned
      only `content` would drop it (`content` is `None` on a pure tool turn).

    Usage recording is unchanged: one `ai_usage_events` row per provider call,
    so an N-round tool loop writes N rows and stays attributable per round.
    """
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
    if tools:
        body["tools"] = tools
        if tool_choice is not None:
            body["tool_choice"] = tool_choice

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
                message = (data.get("choices") or [{}])[0].get("message", {}) or {}
                if tools:
                    # A tool turn legitimately has `content: null`, so emptiness
                    # is not a failure here — the caller inspects `tool_calls`.
                    return message
                content = message.get("content")
                if content and content.strip():
                    return content.strip()
                print("⚠️ LLM returned empty content")
                return None
            print(f"⚠️ LLM HTTP {response.status_code}")
            if raise_on_error:
                try:
                    payload = response.json()
                except ValueError:
                    payload = {}
                error = LlmError(
                    response.status_code,
                    str((payload.get("error") or {}).get("code") or ""),
                    payload,
                )
                raise error
            return None
    except LlmError:
        raise
    except Exception as exc:
        error = exc
        print(f"⚠️ LLM request failed: {type(exc).__name__}")
        if raise_on_error:
            raise
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


def _merge_tool_call_deltas(
    accumulator: dict[int, dict], deltas: list[dict],
) -> None:
    """Fold streamed `tool_calls` fragments into whole calls, keyed by index.

    The provider splits one tool call across many chunks: the first carries the
    id and function name, the rest append a few characters of `arguments` each.
    Only the index is stable, which is why it — not the id — is the key here.
    """
    for delta in deltas or []:
        if not isinstance(delta, dict):
            continue
        index = delta.get("index")
        if not isinstance(index, int):
            index = len(accumulator)
        call = accumulator.setdefault(
            index, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}}
        )
        if delta.get("id"):
            call["id"] = delta["id"]
        function = delta.get("function") or {}
        if function.get("name"):
            call["function"]["name"] = function["name"]
        if function.get("arguments"):
            call["function"]["arguments"] += function["arguments"]


async def call_llm_stream_tools(
    messages: list,
    *,
    usage_context: UsageContext,
    max_tokens: int = 900,
    model_tier: LlmModelTier = "mini",
    tools: list | None = None,
    tool_choice: str | dict | None = None,
) -> AsyncGenerator[dict, None]:
    """Stream a tool-calling round, yielding tagged events.

    `call_llm_stream` cannot serve a tool-calling agent: it yields bare strings
    and drops `delta.tool_calls`, so a round that decides to call a tool would
    look like an empty answer. This yields instead:

        {"type": "text", "text": "..."}          per content delta, live
        {"type": "message", "message": {...}}    terminal, assembled

    The terminal event is shaped exactly like `call_llm(..., tools=...)`'s return
    value, so a caller's tool-dispatch path needs no streaming-specific branch.
    It is emitted on every completed round — including text-only ones — so the
    caller always ends up with the same message dict it would have had.

    Note the ordering contract: text is yielded as it arrives, *before* the
    caller can inspect the finished message. A caller that must gate on the
    finished answer has to buffer the text events itself.
    """
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
    if tools:
        body["tools"] = tools
        if tool_choice is not None:
            body["tool_choice"] = tool_choice

    status = "cancelled"
    usage = None
    provider_request = None
    error = None
    text_parts: list[str] = []
    tool_calls: dict[int, dict] = {}
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            async with client.stream("POST", url, json=body, headers=headers) as response:
                provider_request = provider_request_id(response.headers)
                if response.status_code != 200:
                    status = "failed"
                    print(f"⚠️ LLM tool stream HTTP {response.status_code}")
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
                        delta = (chunk.get("choices") or [{}])[0].get("delta", {}) or {}
                        content = delta.get("content")
                        if content:
                            text_parts.append(content)
                            yield {"type": "text", "text": content}
                        if delta.get("tool_calls"):
                            _merge_tool_call_deltas(tool_calls, delta["tool_calls"])
                    except (json.JSONDecodeError, IndexError, KeyError):
                        continue
                else:
                    status = "completed"
        if status == "completed":
            message: dict = {"role": "assistant", "content": "".join(text_parts) or None}
            if tool_calls:
                message["tool_calls"] = [tool_calls[i] for i in sorted(tool_calls)]
            yield {"type": "message", "message": message}
    except asyncio.CancelledError as exc:
        error = exc
        status = "cancelled"
        raise
    except Exception as exc:
        error = exc
        status = "failed"
        print(f"⚠️ LLM tool stream error: {type(exc).__name__}")
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