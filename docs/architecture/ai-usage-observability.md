# AI Usage Observability

## Purpose

Yuvilab Spark records one privacy-safe, append-only event for every external AI provider request. The system supports operational and cost reporting by pseudonymous actor, endpoint, 720 feature, and AI operation without copying learner content or identity into telemetry.

## Request path

1. A feature constructs `UsageContext` with `actor_id`, `actor_type`, `endpoint`, `feature`, `operation`, and `source`; session and exchange IDs are added when available.
2. The request uses an approved central provider wrapper.
3. The wrapper reads exact provider usage metadata and finalizes one event.
4. The writer looks up an effective price by provider, deployment (or wildcard), billing meter, and request start time. It calculates a cost only from exact provider quantities and complete verified rates.
5. `ai_usage_events` is written in MongoDB/Cosmos. A bounded JSON fallback exists only for local demo resilience.
6. The independently deployed admin API reads explicit allowlists of sanitized event and pricing fields and aggregates them. It never reads prompts or responses because those fields do not exist in the event schema.

## Collections

### `ai_usage_events`

Each event contains:

- Correlation: `event_id`, `request_id`, optional provider request ID, session ID, exchange ID.
- Attribution: pseudonymous actor ID/type, endpoint, feature, operation, source.
- Provider: provider, gateway, deployment/voice, API version, streaming flag.
- Meter: exact token counts or character quantity, usage status, request status.
- Operations: UTC start/end, latency, sanitized error class, optional response byte count.
- Cost: nullable USD cost and an immutable pricing snapshot.

Prohibited fields include prompts, responses, learner names, emails, disclosures, URLs, request headers, keys, SSML, and exception messages.

### `ai_usage_pricing`

Pricing is explicit and effective-dated. The reviewed catalog in `admin/backend/pricing_catalog.py` is idempotently published to this collection by `admin/scripts/sync_pricing.py`; runtime cost resolution reads the collection rather than hidden fallback constants.

Token pricing document example:

```json
{
  "pricing_id": "azure-openai-gpt-5.4-mini-global-standard-2026-07-11",
  "provider": "azure_openai",
  "deployment": "gpt-5.4-mini",
  "display_name": "GPT-5.4 mini",
  "meter": "tokens",
  "unit_size": 1000000,
  "input_usd_per_unit": 0.75,
  "output_usd_per_unit": 4.5,
  "cached_input_usd_per_unit": 0.08,
  "currency": "USD",
  "price_scope": "Global Standard",
  "effective_from": "MongoDB UTC datetime",
  "effective_to": null
}
```

Current verified Azure OpenAI Global Standard rates, effective 2026-07-11 UTC:

| Deployment | Input / 1M | Cached input / 1M | Output / 1M | Notes |
|---|---:|---:|---:|---|
| `gpt-5.4` | $2.50 | $0.25 | $15.00 | Context shorter than 272K tokens |
| `gpt-5.4-mini` | $0.75 | $0.08 | $4.50 | Current mini deployment |
| `gpt-5-mini` | $0.25 | $0.03 | $2.00 | Legacy fallback deployment |

The reviewed source is the [Azure OpenAI pricing page](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/). Character pricing uses `characters_usd_per_unit`. No verified Azure Speech character rate is currently published, so Speech events remain unpriced until an effective-dated record is approved. Never invent a missing rate.

### Cost calculation and snapshot semantics

For token usage:

$$
\mathrm{cost} = \frac{(\mathrm{input}-\mathrm{cached})r_i + \mathrm{cached}r_c + \mathrm{output}r_o}{\mathrm{unit\ size}}
$$

The result is stored to eight decimal places. The event also stores `pricing_snapshot` with the pricing ID, currency, unit size, and rates used. This makes the recorded charge explainable after the live catalog changes.

Pricing is resolved once during event finalization. If no matching document exists at that moment, required provider quantities are unavailable, or required rates are incomplete, `cost_usd` and `pricing_snapshot` remain `null`. Publishing a rate later does not rewrite append-only historical events and the admin must never treat `null` as zero.

## Streaming semantics

Azure OpenAI streams request terminal usage metadata with `stream_options.include_usage`. Text chunks are never usage events. The gateway records exactly one event in `finally` and distinguishes completed, failed, cancelled, and unavailable requests. Missing terminal usage remains unavailable; it is not estimated from text.

## Current operations and meters

| Feature | Endpoint | Operation | Provider | Meter |
|---|---|---|---|---|
| F1 personalized content | `/api/create-lomda-stream` | `learning_content.generate` | Azure OpenAI through APIM | tokens |
| F2 mapping | `/api/submit` | `onboarding.interest_extraction` | Azure OpenAI through APIM | tokens |
| F2 mapping | `/api/analyze-profile` | `profile.analysis` | Azure OpenAI through APIM | tokens |
| F2 mapping | `/api/results-chat` | `profile.results_chat` | Azure OpenAI through APIM | tokens |
| F3 companion | `/api/agent/coach/stream` | `safety.disclosure_classification` | Azure OpenAI through APIM | tokens |
| F3 companion | `/api/agent/coach/stream` | `coach.reply` | Azure OpenAI through APIM | tokens |
| F3 companion | `/api/agent/coach/stream` | `coach.title` | Azure OpenAI through APIM | tokens |
| F3 companion | `/api/agent/coach/stream` | `coach.visual_plan` | Azure OpenAI through APIM | tokens |
| F3 companion | `/api/agent/coach/stream` | `onboarding.interest_extraction` | Azure OpenAI through APIM | tokens |
| F3 companion | `/api/agent/coach/proactive` | `coach.proactive` | Azure OpenAI through APIM | tokens |
| F3 companion | `/api/agent/coach/tts` | `coach.speech` | Azure Speech REST | characters |

Speech records the normalized text submitted for synthesis as a character count and may record response bytes for operations analysis. It never stores the text or SSML.

## Administration and security

AI usage administration is an independent application under `admin/`; the learner-facing Spark backend does not mount an admin API or admin SPA route. Production currently runs the explicitly temporary `ADMIN_PUBLIC_ACCESS=true` mode requested for review, so report responses return `access_mode: public_preview` and the UI labels that state. The retained protected mode uses Google OpenID Connect, a server-side `ADMIN_EMAILS` allowlist, and an HTTP-only signed administrator cookie; protected responses return `access_mode: authenticated_admin`.

The admin report projection contains only approved operational fields from `ai_usage_events` and safe catalog fields from `ai_usage_pricing`. It groups by pseudonymous actor, endpoint, operation, deployment, feature, and day without copying identity into telemetry. Because the current container publishes the catalog before starting, its credential requires read access to events and read/upsert/index access to pricing. It does not write usage events. A future split bootstrap identity can reduce the long-running API identity to read-only access.

The React dashboard presents six KPI cards, daily activity, deployment distribution, top-operation charts, effective rates, grouped tables, filters, and recent sanitized requests. Hebrew and Arabic are RTL; English is LTR.

## Deployment and health

`.github/workflows/deploy-admin.yml` validates the backend and frontend, builds the independent `yuvi-720-admin` image, pushes a commit tag and `latest`, deploys `ubi-admin-yuvi-720`, and verifies `/health/ready`. Changes under `admin/**` or to the workflow itself trigger this deployment.

Container startup runs `python -m scripts.sync_pricing && uvicorn ...`. The sync uses reviewed static documents and idempotent upserts; it does not scrape Azure. A sync failure prevents API startup. `/health/live` checks the process. `/health/ready` additionally requires the frontend build and a working MongoDB connection.

The production custom domain is <https://admin.spark.yuvilab.ai> with Azure-managed TLS.

## Production verification snapshot — 2026-07-11

- Both the Azure default hostname and custom domain returned ready.
- The expanded report exposed deployment and feature groupings plus three pricing records.
- The first 31 usage events were recorded between 11:48 and 11:56 UTC before the catalog documents were inserted at 13:26 UTC. They retain `cost_usd: null` and `pricing_snapshot: null` by design.
- New matching token events can be priced at write time; historical costs are not reconstructed in the browser or admin API.

## Adding a new AI capability

- Reuse an instrumented provider wrapper.
- Add a stable operation name and the matching 720 feature.
- Pass a pseudonymous actor and available session/exchange correlation.
- Add tests for success, provider failure, cancellation/stream finalization, exact meter parsing, and privacy exclusions.
- Add verified effective-dated pricing only when commercial rates are known.
- Publish pricing before generating events when costs are required from the first request.
- Never reconstruct historical usage from prompts or generated content; exact tracking starts when instrumentation is deployed.
