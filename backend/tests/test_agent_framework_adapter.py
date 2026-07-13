"""Microsoft Agent Framework adapter keeps model access on tracked APIM helpers."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from app.agents.client import _provider_messages, build_chat_client
from app.services.ai_usage import UsageContext


class AgentFrameworkAdapterTests(unittest.IsolatedAsyncioTestCase):
    def context(self) -> UsageContext:
        return UsageContext(
            actor_id="learner-pseudonym",
            actor_type="learner",
            endpoint="/api/agent/coach/stream",
            feature="feature_3_learning_companion",
            operation="coach.reply",
            source="test",
        )

    def test_framework_messages_convert_without_metadata(self) -> None:
        from agent_framework import Message

        converted = _provider_messages([
            Message("system", ["instructions"]),
            Message("user", ["question"], additional_properties={"secret": "not-forwarded"}),
        ])
        self.assertEqual(converted, [
            {"role": "system", "content": "instructions"},
            {"role": "user", "content": "question"},
        ])
        self.assertNotIn("secret", str(converted))

    async def test_agent_stream_delegates_to_instrumented_gateway(self) -> None:
        async def fake_stream(*args, **kwargs):
            self.assertEqual(kwargs["usage_context"].operation, "coach.reply")
            yield "personal "
            yield "reply"

        with patch("app.agents.client.call_llm_stream", fake_stream):
            from agent_framework import Agent

            client = build_chat_client(self.context(), model_tier="strong", max_tokens=80)
            self.assertIsNotNone(client)
            agent = Agent(client, name="test_coach")
            chunks = [update.text async for update in agent.run("hello", stream=True) if update.text]

        self.assertEqual(chunks, ["personal ", "reply"])


if __name__ == "__main__":
    unittest.main()
