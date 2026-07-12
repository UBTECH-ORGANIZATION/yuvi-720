---
description: "Use when adding or changing AI, LLM, Agent Framework, APIM, Azure OpenAI, Azure Speech, token usage, provider telemetry, model pricing, or AI admin reporting."
applyTo: "backend/app/agents/**,backend/app/services/**,backend/app/routes/**,backend/tests/**,admin/**"
---
# AI Usage Tracking Contract

- Every external AI request must go through an approved central gateway and persist exactly one append-only `ai_usage_events` event.
- Every `call_llm()` and `call_llm_stream()` invocation must pass a typed `UsageContext` with a pseudonymous actor, endpoint, 720 feature, stable operation, and source. Include session/exchange IDs when available.
- Record provider-reported usage only. Never estimate missing tokens. Use `usage_status: unavailable` and nullable token fields when the provider does not return usage.
- Streaming requests must request terminal usage metadata, finalize once in `finally`, and distinguish completed, failed, cancelled, and unavailable requests. Never write one event per chunk.
- Non-token services use their actual billing meter. Azure Speech records normalized submitted character count, never text or SSML.
- Never persist prompts, model outputs, learner names, email addresses, disclosures, URLs, headers, API keys, or exception messages in usage telemetry. Store only sanitized error class names.
- Pricing comes from effective-dated `ai_usage_pricing` records and is snapshotted onto the event. Unknown pricing produces `cost_usd: null`, never zero or an invented rate.
- MongoDB/Cosmos is authoritative. The local JSON event fallback is demo resilience only.
- Admin reports may group by pseudonymous actor, endpoint, feature, operation, provider, deployment, and date. Identity enrichment must happen at read time under authenticated authorization, never by copying PII into telemetry.
- AI administration must remain in the standalone `admin/` service and require a server-derived, allowlisted administrator identity. Do not expose usage reporting from the learner-facing FastAPI or React applications.
- When adding a provider or gateway, extend tests that verify one event per attempt, cancellation finalization, exact usage parsing, privacy-field exclusion, and explicit attribution.
