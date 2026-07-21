---
name: verify
description: Build, run and drive the yuvi-720 app (FastAPI backend + Vite/React frontend) to observe a change working end-to-end.
---

# Verifying yuvi-720

Two processes. Start both, then drive the browser with Playwright.

## Launch

```bash
# backend — :8720  (do NOT use `server:app`; the app is a factory)
cd backend && ./.venv/bin/python -m uvicorn server:create_app --factory --host 127.0.0.1 --port 8720

# frontend — :5173, proxies /api → 127.0.0.1:8720
cd frontend && npm run dev
```

`./dev.sh` starts both, but it reinstalls deps every run and traps signals, so
it's awkward to background. Prefer the two commands above.

**Check the port Vite actually bound.** If 5173 is taken it silently moves to
5174 and you will otherwise drive a stale server running someone else's code:

```bash
tail -4 <vite.log>   # "➜  Local:   http://localhost:5174/"
```

## Driving the UI

Playwright is in `frontend/node_modules` — put the driver script **inside
`frontend/`** and run it there, or the `playwright` import won't resolve.

```js
import { chromium } from 'playwright'
const b = await chromium.launch()
const ctx = await b.newContext({ colorScheme: 'light' })  // pin it for theme tests
```

Gotchas that cost time here:

- **Never `waitUntil: 'networkidle'` on an authenticated page.** The coach
  companion holds an SSE `EventSource` open, so the page never goes idle and
  the wait times out at 30s. Use `'load'` + an explicit `waitForTimeout`.
- **Scope selectors to the dialog.** The landing page has its own contact form,
  so a bare `button[type=submit]` hits the wrong button. Use
  `[role="dialog"] button[type=submit]`.
- App-bar buttons in order: `0` theme switcher, `1` **Sign out**. A loose
  `nth=` selector will log you out mid-test and silently invalidate everything
  after it.
- 401s in the console on the logged-out landing page are expected — the i18n
  provider probes `/api/learner-state` before sign-in.

## Auth

Seeded accounts: `gal` / `moti`, password `Aa12345`, roles `learner`+`teacher`.

```bash
cd backend && ./.venv/bin/python scripts/seed_users.py     # idempotent
```

Session is an httpOnly `spark_session` cookie. curl checks:

```bash
curl -i -c /tmp/jar -X POST localhost:8720/api/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"gal","password":"Aa12345"}'
curl -i -b /tmp/jar localhost:8720/api/brain/moti   # must be 403 — cross-account read
```

Identity is derived from the cookie only; a `learner_id` in a body or query
string is ignored. A useful probe is to send one and confirm the response comes
back scoped to the session user instead.

## Onboarding gate

A learner who has not completed mapping + profile verification is redirected to
the step their saved `learner_state` records, so `/student-dashboard`,
`/learning`, `/mentoring` and `/yuvi-studio` all bounce to `/learner-mapping`.
The redirect can take **5-7s** on heavy routes (the studio loads three.js
first) — wait long enough before concluding the gate is broken. `/results` and
the teacher lane are exempt.

## CSS tokens

`frontend/src/styles/tokens.css` defines `--sp-ink-900/700/500/400/300`,
`--sp-bg`, `--sp-surface`, `--sp-border`, `--sp-overlay`, `--sp-danger-600/100`,
and spacing `--sp-1..6, 8, 10, 12`. There is **no `--sp-text`, `--sp-text-muted`,
`--sp-danger`, or `--sp-7`** — referencing them fails silently (an invalid
`color-mix` renders nothing, a bad `padding` is dropped), so the page looks
subtly wrong rather than erroring. Screenshot new UI in both `colorScheme:
'light'` and `'dark'` to catch it.

## Mongo

`backend/.env` points at a real CosmosDB. Scripts touching it hit live data.
Without `MONGODB_CONNECTION_STRING` the app falls back to JSON under
`backend/.runtime/` (and, for learner_state, repo-root `.runtime/`).
