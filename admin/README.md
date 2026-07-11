# Yuvilab Spark Administration

This directory is an independently deployable administration service. It owns the AI-usage reporting UI; the learner-facing Spark service remains the only writer of provider usage events.

## Current access mode

`ADMIN_PUBLIC_ACCESS=true` is the current default. The UI and usage API open directly without login. This is a temporary preview mode. Set `ADMIN_PUBLIC_ACCESS=false` to activate the retained Google administrator authentication flow.

## Security boundary

- Public preview mode bypasses authentication and is visibly labelled in the UI.
- When public mode is disabled, Google OpenID Connect establishes the administrator identity and `ADMIN_EMAILS` is rechecked on every authenticated request.
- The API reads only an explicit allowlist of operational fields from `ai_usage_events`.
- Prompts, model responses, names, learner emails, disclosures, provider URLs, headers, secrets, and exception messages are never queried.
- Use a MongoDB credential limited to read access on `ai_usage_events` in production.

## Local run

1. Copy `env.template` to `.env` and configure MongoDB.
2. Keep `ADMIN_PUBLIC_ACCESS=true` for public preview access.
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

## Azure configuration

The independent deployment workflow builds `admin/Dockerfile` and deploys image `yuvi-720-admin` to the admin Web App. Configure these App Service settings as secrets:

- `ADMIN_ENV=production`
- `ADMIN_PUBLIC_ACCESS=true`
- `ADMIN_BASE_URL=https://admin.spark.yuvilab.ai`
- `ADMIN_COOKIE_SECURE=true`
- `WEBSITES_PORT=8000`
- `MONGODB_CONNECTION_STRING`
- `MONGODB_DATABASE=yuvi720`

The deployed App Service health-check path is `/health/ready`; `/health/live` is the process liveness endpoint. When authentication is enabled later, also configure `ADMIN_SECRET_KEY`, `ADMIN_EMAILS`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`, then add `https://admin.spark.yuvilab.ai/auth/callback` to Google OAuth redirect URIs.
