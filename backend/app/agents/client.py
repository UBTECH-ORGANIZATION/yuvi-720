"""Telemetry-preserving Microsoft Agent Framework adapter.

The framework supplies orchestration and context-provider lifecycle only. Every
provider request still goes through ``app.services.llm`` so APIM routing, exact
provider token usage, privacy-safe ``UsageContext``, and failure recording remain
the single approved model-access path.
"""

from __future__ import annotations

from collections.abc import AsyncIterable, Mapping, Sequence
from typing import Any, Optional

from app.services.ai_usage import UsageContext
from app.services.llm import LlmModelTier, call_llm, call_llm_stream


def agent_framework_available() -> bool:
    try:
        import agent_framework  # noqa: F401
        return True
    except Exception:
        return False


def _provider_messages(messages: Sequence[Any]) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for message in messages:
        role = str(getattr(message, "role", "user"))
        text = str(getattr(message, "text", "") or "")
        if role in {"system", "developer", "user", "assistant"} and text:
            result.append({"role": role, "content": text})
    return result


def build_chat_client(
    usage_context: UsageContext,
    model_tier: LlmModelTier = "strong",
    *,
    max_tokens: int = 700,
) -> Optional[Any]:
    """Return an Agent Framework client backed by the tracked APIM gateway."""
    if not agent_framework_available():
        return None

    from agent_framework import (
        BaseChatClient,
        ChatResponse,
        ChatResponseUpdate,
        Content,
        Message,
        ResponseStream,
    )

    class TrackedApimChatClient(BaseChatClient):
        OTEL_PROVIDER_NAME = "yuvi_apim"

        def __init__(self) -> None:
            super().__init__(additional_properties={"gateway": "apim", "telemetry": "ai_usage_events"})

        def _inner_get_response(
            self,
            *,
            messages: Sequence[Any],
            stream: bool,
            options: Mapping[str, Any],
            **kwargs: Any,
        ) -> Any:
            del options, kwargs
            payload = _provider_messages(messages)
            if stream:
                async def stream_updates() -> AsyncIterable[Any]:
                    async for chunk in call_llm_stream(
                        payload,
                        usage_context=usage_context,
                        max_tokens=max_tokens,
                        model_tier=model_tier,
                    ):
                        yield ChatResponseUpdate(
                            role="assistant",
                            contents=[Content.from_dict({"type": "text", "text": chunk})],
                        )
                return ResponseStream(stream_updates(), finalizer=ChatResponse.from_updates)

            async def response() -> Any:
                text = await call_llm(
                    payload,
                    usage_context=usage_context,
                    max_tokens=max_tokens,
                    model_tier=model_tier,
                )
                return ChatResponse(
                    messages=Message("assistant", [text or ""]),
                    model=f"yuvi-{model_tier}",
                )
            return response()

    return TrackedApimChatClient()
