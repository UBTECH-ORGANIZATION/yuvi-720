"""Agent layer package (Microsoft Agent Framework over APIM).

Agents are stateless specialists that read/write scoped views of the brain
(architecture §5). Model access stays on APIM; `client.build_chat_client()`
returns an Agent Framework client when the package is installed, else `None`
so callers fall back to the deterministic path + `services.llm.call_llm`
(the app must stay demoable without agent infra — §5.1 / §15 R11).
"""

from app.agents.client import build_chat_client, agent_framework_available

__all__ = ["build_chat_client", "agent_framework_available"]
