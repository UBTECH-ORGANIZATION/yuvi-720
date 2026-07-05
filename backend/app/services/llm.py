"""LLM gateway service for learner-facing AI features."""

from pathlib import Path
from typing import AsyncGenerator
import json
import os
import re

import httpx


APP_ROOT = Path(__file__).resolve().parents[3]
ENV_PATHS = [
    APP_ROOT / "backend" / ".env",
    APP_ROOT / ".env",
    APP_ROOT.parent / "src" / "backend" / ".env",
]


def load_env_file(path: Path) -> bool:
    """Lightweight .env loader. Does not override existing environment variables."""
    try:
        if not path.exists():
            return False
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key) and key not in os.environ:
                os.environ[key] = value
        print(f"✅ Loaded LLM env from {path}")
        return True
    except Exception as exc:
        print(f"⚠️ Failed to load .env: {exc}")
        return False


if not any(load_env_file(env_path) for env_path in ENV_PATHS):
    print("ℹ️ No LLM .env found; AI features will use fallback responses.")


def _resolve_llm_config() -> tuple[str, str, str, str]:
    apim_base = os.environ.get("APIM_BASE_URL", "").rstrip("/")
    apim_key = os.environ.get("APIM_SUBSCRIPTION_KEY", "")
    deployment = (
        os.environ.get("MODEL_DEPLOYMENT_NAME")
        or os.environ.get("COPILOT_MODEL")
        or "gpt-4.1-mini"
    )
    if deployment in {"gpt-5-mini", "gpt-5-mini-2025-08-07"}:
        deployment = "gpt-4.1-mini"
    api_version = os.environ.get("APIM_API_VERSION", "2024-10-21")

    endpoint, key = apim_base, apim_key
    if not endpoint or not key:
        foundry = os.environ.get("AZURE_AI_FOUNDRY_ENDPOINT", "")
        foundry_key = os.environ.get("AZURE_AI_FOUNDRY_API_KEY", "")
        if foundry and foundry_key:
            endpoint = re.sub(r"/api/projects/.*", "", foundry.rstrip("/")) + "/openai"
            key = foundry_key

    return endpoint, key, deployment, api_version


async def call_llm(messages: list, max_tokens: int = 1200, json_mode: bool = False):
    """Call the shared Azure OpenAI model through the APIM gateway."""
    endpoint, key, deployment, api_version = _resolve_llm_config()
    if not endpoint or not key:
        print("⚠️ No LLM endpoint configured (APIM/Foundry)")
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

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(url, json=body, headers=headers)
            if response.status_code == 200:
                data = response.json()
                content = (data.get("choices") or [{}])[0].get("message", {}).get("content")
                if content and content.strip():
                    return content.strip()
                print(f"⚠️ LLM returned empty content: {str(data)[:300]}")
                return None
            print(f"⚠️ LLM HTTP {response.status_code}: {response.text[:300]}")
            return None
    except Exception as exc:
        print(f"⚠️ LLM request failed: {exc}")
        return None


async def call_llm_stream(messages: list, max_tokens: int = 4000) -> AsyncGenerator[str, None]:
    """Stream tokens from the Azure OpenAI model."""
    endpoint, key, deployment, api_version = _resolve_llm_config()
    if not endpoint or not key:
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
    }

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            async with client.stream("POST", url, json=body, headers=headers) as response:
                if response.status_code != 200:
                    print(f"⚠️ LLM stream HTTP {response.status_code}")
                    return
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data_str = line[6:]
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                        delta = (chunk.get("choices") or [{}])[0].get("delta", {})
                        content = delta.get("content")
                        if content:
                            yield content
                    except (json.JSONDecodeError, IndexError, KeyError):
                        continue
    except Exception as exc:
        print(f"⚠️ LLM stream error: {exc}")