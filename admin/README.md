# Yuvilab Spark Administration

This directory is an independently deployable administration service. It owns the AI-usage reporting UI; the learner-facing Spark service remains the only writer of provider usage events.

Production URL: <https://admin.spark.yuvilab.ai>

## Current access mode

Google administrator authentication is required by default. `ADMIN_PUBLIC_ACCESS=false` keeps the UI and usage API behind Google OpenID Connect and the `ADMIN_EMAILS` allowlist. Public preview mode must not be enabled in production.

## Security boundary

- Public preview mode bypasses authentication and is visibly labelled in the UI.
- When public mode is disabled, Google OpenID Connect establishes the administrator identity and `ADMIN_EMAILS` is rechecked on every authenticated request.
- The API reads only an explicit allowlist of operational fields from `ai_usage_events`.
- Prompts, model responses, names, learner emails, disclosures, provider URLs, headers, secrets, and exception messages are never queried.
- The current container startup synchronizes the approved pricing catalog. Its MongoDB credential therefore needs read access to `ai_usage_events` and read/upsert/index access to `ai_usage_pricing`. It does not need write access to usage events.
- The learner-facing Spark backend has the inverse responsibility: it inserts `ai_usage_events` and reads effective pricing from `ai_usage_pricing` when finalizing each event.

## Local run

1. Copy `env.template` to `.env` and configure MongoDB.
2. Keep `ADMIN_PUBLIC_ACCESS=false` and configure Google OAuth plus the administrator allowlist.
3. Run `./dev.sh` from this directory.
4. Open `http://localhost:9998`.

The script builds the React frontend and starts the standalone FastAPI service on port `9998`. The frontend can also run independently on port `5198`; its Vite proxy targets the admin API on `9998`.

## Model pricing

The container idempotently synchronizes effective-dated Azure OpenAI Global Standard
rates into `ai_usage_pricing` before the API starts. The current catalog covers
`gpt-5.4`, `gpt-5.4-mini`, and the legacy `gpt-5-mini` fallback. Rates come from
the official Azure OpenAI pricing page and are stored per one million tokens.
Pricing is snapshotted only onto new usage events. Historical events with missing
pricing remain `null`; they are never estimated or rewritten.

| Deployment | Input / 1M | Cached input / 1M | Output / 1M | Effective from |
|---|---:|---:|---:|---|
| `gpt-5.4` | $2.50 | $0.25 | $15.00 | 2026-07-11 UTC |
| `gpt-5.4-mini` | $0.75 | $0.08 | $4.50 | 2026-07-11 UTC |
| `gpt-5-mini` | $0.25 | $0.03 | $2.00 | 2026-07-11 UTC |

The source is <https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/>. `gpt-5.4` uses the Global Standard rate for context shorter than 272K tokens.

The startup command is `python -m scripts.sync_pricing && uvicorn ...`. Synchronization uses static, reviewed catalog records from `backend/pricing_catalog.py`; it does not scrape the pricing page. Upserts are safe to repeat. A synchronization failure prevents the API from starting so readiness cannot report a catalog that was expected but not published.

### Why an exact event can have a null cost

The Spark writer resolves pricing once, using the event start time, before inserting the append-only event. A match requires the same provider, deployment (or `*`), meter, and effective interval. If the record is absent at that moment, if required token counts are unavailable, or if a required rate is missing, both `cost_usd` and `pricing_snapshot` remain `null`.

Adding a price later does not mutate old events. In the initial production sample, all 31 events were recorded between 11:48 and 11:56 UTC on 2026-07-11, while the first three pricing documents were inserted at 13:26 UTC. Those 31 events correctly remain unpriced. New matching token events receive a cost and immutable pricing snapshot.

Azure Speech is metered by submitted characters, not tokens. No verified Speech character rate is currently present in the catalog, so Speech costs remain `null` until an effective-dated `azure_speech`/`characters` record is approved.

## Azure configuration

The independent `.github/workflows/deploy-admin.yml` workflow runs backend tests, builds the React frontend, builds and pushes `yuvi-720-admin`, deploys the commit-tagged image to `ubi-admin-yuvi-720`, and verifies readiness. Changes under `admin/**` trigger this workflow without deploying the learner application.

Configure these App Service settings:

- `ADMIN_ENV=production`
- `ADMIN_PUBLIC_ACCESS=false`
- `ADMIN_BASE_URL=https://admin.spark.yuvilab.ai`
- `ADMIN_COOKIE_SECURE=true`
- `WEBSITES_PORT=8000`
- `MONGODB_CONNECTION_STRING`
- `MONGODB_DATABASE=yuvi720`
- `ADMIN_SECRET_KEY`
- `ADMIN_EMAILS`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

The deployed App Service health-check path is `/health/ready`; `/health/live` is the process liveness endpoint. Register `https://admin.spark.yuvilab.ai/auth/callback` as a Google OAuth redirect URI. For local development, also register `http://localhost:9998/auth/callback`.

Readiness succeeds only when the built frontend exists and MongoDB responds. Liveness checks only the admin process.

## Production state verified 2026-07-12

- Custom domain and managed TLS are active at <https://admin.spark.yuvilab.ai>.
- Google authentication and the administrator email allowlist protect the admin UI and API.
- The report exposes totals plus daily, actor, endpoint, operation, deployment, and 720-feature groupings through sanitized projections.
- The UI presents KPI cards, activity/model/operation charts, current model rates, grouped tables, filters, and recent sanitized requests.
- Hebrew and Arabic render RTL; English renders LTR.
- The pricing collection contains the three token-rate records listed above.
