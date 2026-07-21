# MoE LRS — Auth, Transport, Retry/Dedup, Ledger

## OAuth2 (client credentials) — VERIFIED LIVE against staging 2026-07-20
- `POST {LRS_TOKEN_URL}` with a **form-encoded body** (`application/x-www-form-urlencoded`):
  `grant_type=client_credentials&client_id=…&client_secret=…&scope=lrs`
- ⚠️ The Postman collection shows query-string params — the live server REJECTS that with 400 "Missing or duplicate parameters". Form body is required.
- Response: `access_token` (JWT; staging `sub: "LRS Yuvilab"`); `expires_in` is nested under `token_details` (3600s). `lrs/auth.py` caches with a 60s refresh margin + single-flight lock.

## Statements endpoint
- `POST {LRS_STATEMENTS_URL}` — staging `https://lrs-stg.education.gov.il/xAPI/statements` (confirmed; NOT `/data/xAPI/...`).
- Headers (exactly): `Authorization: Bearer <token>` · `Content-Type: application/json` · `X-Experience-API-Version: 1.0.3`.
- Success: `204` (staging observed) or `200` with an array of statement ids. One 401 → refresh token once + retry (`lrs/client.py`).

## Near-Real-Time + Retry/Resend + dedup (spec-mandated)
- `outbox.enqueue` persists first, then fires an immediate shielded send.
- Failure → exponential backoff (15s·2^n, cap 600s), swept every 30s by `run_sweeper` (started in `server.py` lifespan when enabled).
- The statement `id` is generated ONCE (uuid4) and resent unchanged — a duplicate-id rejection by the LRS means "already delivered" and is treated as success. Never mint a new id for a retry.

## The ledger (`lrs_outbox` collection — never purged)
Row: full `statement` + denormalized `learner_id, exidentifier, verb, activity_type, object_id, session_id, source(kata|platform), status(pending|sent|failed), attempts, last_error, last_response, occurred_at, created_at, sent_at`. Indexed on learner_id/status/verb/session_id/created_at/exidentifier. This answers "what exactly did we report, when, and what did the LRS say" — for audit and debugging.

## Env (see backend/.env.example)
`LRS_ENABLED, LRS_TOKEN_URL, LRS_STATEMENTS_URL, LRS_CLIENT_ID, LRS_CLIENT_SECRET, LRS_SCOPE, LRS_XAPI_VERSION, LRS_SUPPLIER_DOMAIN, LRS_PROGRAM_IRI, LRS_KATA_ECAT_ID, LRS_TEST_EXIDENTIFIER, LRS_DEFAULT_SCHOOL, LRS_DEFAULT_NMM`. Azure slots: set per-slot with `--slot-settings` (staging creds on dev, prod creds from MoE later); non-secret keys are verified by `deploy-spark.yml` required_settings.
