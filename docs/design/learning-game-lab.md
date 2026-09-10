# Learning Game Lab — AI-created learning games for the learner

Status: PLAN (2026-09-08). Owner: gal@yuvilab.ai. ADO: PBI under epic #225 Student Portal.

Decisions taken with Gal on 2026-09-08:

- Generation = **full HTML codegen as in vibe-coding-kids** (one self-contained HTML per game), not a spec-only runtime.
- AI path = **GitHub Copilot SDK with `claude-opus-5`**, reusing the vibe-coding-kids session wrapper.
- Worker lives **in this repo** as an Azure Container App fed by an Azure Service Bus queue. Token events land in Yuvi's own `ai_usage_events`.

---

## 1. Product

### 1.1 The prop: a computer in the kid's room ("Game Lab")

- A fixed station in the lab room next to `explore` / `mission`: a desk computer with a glowing Yuvi logo above the screen (emissive cyan, low-poly, per the world art direction). Screen idles with a subtle "code rain"; when a game is generating the logo pulses; when one is ready it flashes once.
- Walking onto its pad opens a side panel exactly like the avatar / room stations (`StationPanel` + `SegmentedNav`). Station id `gamelab`. Right-click / long-press also opens it (existing `PropMenu` path).

### 1.2 The panel

Tabs: **My games** | **Create**.

**My games** (history): cards newest-first — thumbnail, title, learning objective chip, component chip, status (queued / building step / ready / failed / editing), version count, tokens spent shown as Yuvi "sparks" (kid-facing budget). Actions: Play, Edit, Duplicate-as-new-prompt, Delete. Same list mechanics as the companion conversation history (cursor pagination, inline confirm delete).

**Create** wizard, three steps, all mandatory:

1. **Learning objective** — picker over the learner's own path (units grouped by MoE objective; objectives with visited or on-path components first, then the rest of the subject catalog).
2. **Learning component** — the component inside that objective (title, purpose, difficulty). This is the "learning context": one paragraph, the **learning description**, written once per component by the mini model (what is learned, the 2-4 facts/rules/vocabulary, typical mistakes, the level) and cached; picking a component warms it.
3. **The game** — a free-text **brief** (up to 600 chars: world, hero, what you do, what is exciting) is the one design input. Optional **inspiration chips** (3D, shooting, running, platforms, boss, puzzle, tower, story, open world) are flavour for the designer, never a constraint: Yuvi owns genre, engine and form (revised 2026-09-08 after the first playthrough — the genre step boxed the model into toy games). Optional "deep thinking". The build card shows live steps; the finished game carries Yuvi's `design_brief` (shown in the player's console).

Hard rule shown in the UI and scored in the pipeline (revised 2026-09-10): **every game is a learning game — the learning lives in the mechanics.** The concept IS the core loop (mass → a cargo shooter where you hit the crates whose net weight matches the manifest; coordinates → the map is the grid and every jump is typed as (x, y)); the vocabulary is on the objects, the HUD and the level names. Questions are the model's choice, never a requirement; the learning judge scores learning-through-play and asks for one revision when it is weak.

### 1.3 In the lesson page

`CompanionChat` in task mode gains a third tab: **Chat | Path | Games**.

- Lists games created for the current component, then for the same objective. Each card: play, edit, status.
- "Create a game for this" shortcut deep-links to the studio station with objective + component preselected.
- **Play** opens a full-screen overlay (`GamePlayer`) that fills the lesson chrome (same precedent as `isActiveTaskRoute`): the game iframe, a slim top bar (title, sparks, exit), and a collapsible right-side **Yuvi edit panel** — a chat where the kid says what to change, plus a "something is broken" button. Runtime errors captured from the iframe surface as "Yuvi noticed a bug — fix it?".

### 1.4 Notifications and sound

- Bell kinds: `game_ready`, `game_failed`, `game_edit_ready`, `game_fix_ready`. Action route opens the player.
- A short synthesized chime (`notificationChime.ts`, WebAudio, no media file, respects reduced-motion/mute) plays when a `game_*` notification arrives live. First bell sound in the app: also used for teacher-message arrivals later if wanted.
- The studio prop reacts to the same realtime frame (logo flash).

### 1.5 Out of scope for v1

Teacher-authored games (already exist as teacher tasks), sharing games between learners, publishing outside the app, 3D games, multiplayer.

---

## 2. Architecture

```
Learner (React)                         Yuvi backend (App Service)                  Azure
──────────────                          ──────────────────────────                  ─────
Studio station / Games tab  ──POST /api/games──▶  games.store (Mongo)              Service Bus Standard
                                                  enqueue(job)  ─────────────────▶  queue: game-jobs (sessions = game_id)
GamePlayer (iframe srcdoc)  ◀──GET html────────  Blob (HTML, thumbs)                       │ KEDA azure-servicebus
  YuviLearn bridge ──POST /check──▶ server-side grading, learner_signals                   ▼
  error reporter  ──POST /report-bug──▶ enqueue(fix)                              Container App: ca-yuvi-game-gen
SSE user:{id}  ◀── realtime (Redis bridge) ◀───────────────────────────────────── worker: Copilot SDK (claude-opus-5)
Bell + chime   ◀── notifications                                                  + Playwright validator + patch engine
                                                                                  writes ai_usage_events, game doc, blob
```

### 2.1 Data

Collections (Mongo, via `_get_collection_named`):

- `learner_games` — `_id: game_id`, `learner_id`, `objective_id`, `unit_id`, `component_id`, `path_node_id`, `title`, `genre`, `prompt`, `language`, `status` (`queued|planning|building|validating|fixing|ready|failed`), `current_version`, `versions[] {v, blob_path, sha256, created_at, source: create|edit|fix, summary}`, `thumb_blob_path`, `errors_last[]`, `sparks_spent`, `created_at`, `updated_at`, `deleted_at`.
- `learner_game_jobs` — `_id: job_id`, `game_id`, `learner_id`, `kind` (`create|edit|fix`), `payload` (instruction, error report, the trimmed context + learning description, `model`, `reasoning_effort`), `status`, `attempts`, `worker_replica`, `started_at`, `finished_at`, `error_class`, `usage_summary` (tokens in/out/cache, cost snapshot), `timings` (queued / wake / session_start / plan / model[] / validate[] / judge / revise / persist / total, seconds), `attempts_detail[]`, `judge` (the verdict, see §2.5 step 6).
- `game_learning_descriptions` — `_id: {component_id}|{language}|{prompt_version}`, `text`, `fingerprint` (title, purpose, teacher notes, question texts as evidence, unit/objective titles + description), `generated_at`. Written once per component; regenerated only when the fingerprint drifts. (2026-09-10: replaced `learner_game_answers`, `game_question_blueprints`, `game_question_instances`, `game_question_options`, which nothing reads any more.)

HTML never goes into Mongo (vibe rule). Blob layout: `games/{learner_id}/{game_id}/v{n}/index.html`, `thumb.png`.

### 2.2 API (Yuvi backend, `backend/app/routes/games.py`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/games?component=&objective=&cursor=` | learner's games, scoped by session |
| POST | `/api/games` | `{objective_id, unit_id, component_id, vibe, inspirations[], deep_thinking}` (`genre` optional, default `open`) → creates game + `create` job |
| GET | `/api/games/{id}` | status, versions, errors |
| GET | `/api/games/{id}/html?v=` | authenticated; returns HTML with the runtime harness injected at serve time |
| POST | `/api/games/{id}/edit` | `{instruction}` → `edit` job |
| POST | `/api/games/{id}/report-bug` | `{errors[], note}` → `fix` job (auto path capped at 2 per version) |
| POST | `/api/games/prepare` | `{component_id, language}` → 202 `{ready}`; warms the learning description on pick |
| POST | `/api/games/{id}/revert` | `{v}` |
| DELETE | `/api/games/{id}` | soft delete |
| GET | `/api/games/objectives` | picker data: objectives → components for the learner's subject/path (every component is offered) |
| GET | `/api/admin/games/jobs` | admin: recent jobs with timings, judge verdict, model, cost — the weak-spot finder (`workers/game_gen/scripts/games_report.py` prints the same as a table) |

Daily caps (config): 3 creates, 10 edits, per learner; teachers/admin can raise per group later.

### 2.3 Job envelope and queue

Service Bus **Standard**, queue `game-jobs`, sessions enabled, `sessionId = game_id` (edits/fixes on one game never interleave), `maxDeliveryCount = 3`, lock duration 5 min with a renew loop, DLQ consumed by the same worker to mark `failed` + notify. Body ≤ 4 KB: `{job_id, game_id, learner_id, kind, payload_ref}`; big payloads (current HTML, error dumps) travel via Blob refs.

Local dev: `GAME_JOBS_MODE=inline` runs the worker pipeline in-process inside the backend (same code, no Service Bus), mirroring vibe's `_should_use_service_bus`. Production: `servicebus`.

### 2.4 Worker (Container App `ca-yuvi-game-gen`)

- Code: `workers/game_gen/` in this repo, Python 3.11, imports `backend/app` for `ai_usage`, `notifications`, `realtime`, `kata_client` snapshot readers.
- Image: `workers/game_gen/Dockerfile` — python slim + Copilot CLI binary (official backend-services Dockerfile pattern) + Playwright Chromium + Noto fonts (Hebrew/Arabic).
- Scaling: KEDA `azure-servicebus` rule, `messageCount: "1"` (one build per replica), **`minReplicas 1`** (2026-09-10: one replica always warm — the 30–60 s cold start was the single largest fixed wait; ~1 vCPU/2 GiB of idle spend is a few Opus builds a month), `maxReplicas` 2 (dev) / 10 (prod), CPU 1 / 2 GiB, `activeRevisionsMode single`, managed identity with *Service Bus Data Receiver* + *Storage Blob Data Contributor* + *AcrPull*.
- Resources (rg-yuvi-720, North Europe): Service Bus Standard namespace `sb-yuvi-720` with queues `game-jobs-dev` / `game-jobs-prod` (sessions, maxDeliveryCount 3, lock 5 min); Container Apps environment `cae-yuvi-720` on `law-yuvi-720`; apps `ca-game-gen-dev` / `ca-game-gen-prod`; blob containers `games-dev` / `games-prod` in `yuvi720blobstorage`. The App Service (`ubi-yuvi-720`, prod + `dev` slot) got system identities with *Service Bus Data Sender* + *Blob Data Contributor* and the matching slot settings (`GAME_JOBS_MODE=servicebus`, `GAME_JOBS_QUEUE`, `GAME_JOBS_SERVICEBUS_NAMESPACE`, `GAMES_STORAGE=blob`, `GAMES_BLOB_CONTAINER`, `GAMES_STORAGE_ACCOUNT_URL`).
- Environment contract: `backend/env.template` (backend keys) and `workers/game_gen/env.template` (worker keys = the Container App env vars in `infra/game-gen/main.bicep`). Secrets on the apps: `copilot-github-token` (the vibe-coding-kids Copilot token, per Gal 2026-09-08), `mongodb-connection-string`, `redis-connection-string`.
- Deploy: `.github/workflows/deploy-game-gen.yml` — `az acr build` → Bicep to dev on every push touching the worker; prod only on manual dispatch with `confirm=prod`. Needs repo secrets `AZURE_CREDENTIALS` and `COPILOT_GITHUB_TOKEN`.

### 2.5 Pipeline (per job) — revised 2026-09-10

1. **Context** (built at enqueue time on the Yuvi side, stored with the job): component / unit / objective titles, subject, grade (parsed from the objective's curriculum title), purpose, and the **learning description** — one paragraph per component from `game_learning_descriptions` (mini model, cached, fingerprint-gated; a deterministic fallback from the objective description if the model is unreachable). No question rows, no teacher notes, no answers travel with the job. Learner name and PII never enter the prompt.
2. **Plan pass** (`gpt-5.4-mini`, ~350 words, ≤20 s): a producer's one-page pitch in the kid's language — hook, world & look, core loop (how the learning idea IS the mechanic), 4-6 named stages, fail & reward, engine, signature moment. Streamed to the kid as the first narration line and written to the game's `description` at once. It is a starting point for the builder, never a spec.
3. **Build** — Copilot SDK session, model from the job (`payload.model`, default `GAME_MODEL_DEFAULT`, chosen by the bake-off in `workers/game_gen/scripts/bakeoff.py`), `reasoning_effort` **low** (medium with "deep thinking"). One flowing prompt: identity, the learning stance with cross-subject examples, the optional bridge helper, an ambition bar (what a senior Phaser 4 / Three.js developer ships: title screen with controls, a look, juice, WebAudio, a curve that adds elements, a fail state, a satisfying end), the technical rules the harness depends on, delivery format, language rule. No level counts, no line counts, no engine table. Output: TITLE / BRIEF / SUMMARY lines + one ```html``` file, ≤3 deliveries.
4. **Deterministic post-processing** — vibe `code_utils._validate_and_fix_code` + `libraries.normalize_cdn_urls` against the curated CDN list.
5. **Validate** — Playwright headless: load, no `pageerror` for 4 s, click Start, 3.5 s more, poster sampling (9 s), canvas non-blank, ≥ 30 rAF ticks, harness present, and a **play score** (frames rendered and whether the canvas reacts to keys/pointer). No learning-contract assertion. Structured errors go back for up to 2 repair rounds.
6. **Learning judge** — mini model scores `{learning_through_play, fun, polish, age_fit}` 0-5 with `notes` and one `top_fix`. A finished game is **never discarded**: below the bar (`learning_through_play < 3` or `fun + polish < 5`) the builder gets ONE revision turn in the same session with the judge's top fix (patches or a full game); a validated revision replaces the HTML and is judged again, otherwise the original stands. The verdict lands on the version entry and the job row.
7. **Persist** — upload HTML + poster to Blob, bump version, write `usage_summary` + `timings` + `judge`, `notify()` + `realtime.publish(user:{learner_id}, {type:'game', ...})`.

Edit jobs run steps 3–7 with the current HTML sent **line-numbered** and vibe's patch DSL (`REPLACE_LINES / INSERT_AFTER / DELETE_LINES`, all-or-nothing, brace-balance guard); >5000 lines forces full rewrite. Fix jobs add the captured error list, last `__yuvi` snapshot and the "you already tried X" memory of the last 5 attempts.

### 2.6 Runtime harness (injected at serve time, never generated)

Saves tokens and makes behaviour uniform. Prepended to every served HTML:

- `YuviLearn` — a thin **optional** helper (2026-09-10): `await YuviLearn.mount(q, el)` renders a question the model wrote itself (`{text, answers?, correct, type?, figure?}`) and grades it locally; `YuviLearn.progress(patch?)` and `YuviLearn.done(summary?)` post `learn.progress` / `learn.done` to the host (the celebration). Legacy `next()` / `answer()` resolve to null / a harmless result so games built before the change never throw. The game talks, the host listens; nothing is graded on the server.
- `YuviStorage` (postMessage-backed KV; `localStorage` shimmed in-memory, as in vibe).
- Error reporter (`error`, `unhandledrejection`, `console.error`, heartbeat) → parent, deduped, with a per-render nonce.
- Fit-to-frame scaler (vibe `gameFrame.ts`), viewport meta, `visualViewport` handling for tablets, pointer-lock passthrough.
- `window.__yuvi` state used by the validator and the bug loop.

The builder prompt documents only this API surface; the model never writes storage, scaling or error code.

### 2.7 Sandbox and content safety

- `<iframe sandbox="allow-scripts allow-pointer-lock" srcdoc=…>` — no `allow-same-origin`; the game gets an opaque origin. CSP on the served document: `default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; img-src data: blob:; media-src data: blob:; connect-src 'none'`.
- Prompts pass the existing `content_filter` before enqueue; the judge step re-checks age-appropriateness; violence in "shooter" games is limited to cartoon targets (rule in the builder prompt).
- HTML served only to its owner (or a teacher scoped to the learner) — never a public URL.

### 2.8 Responsiveness and RTL

Chromebooks, tablets, phones: `100vw × 100vh` canvas with the fit-to-frame scaler as a safety net; touch controls required when `touch` hint is set (nipplejs / on-screen buttons); keyboard hints otherwise. Hebrew/Arabic: `dir` on text elements only, never on `<html>/<body>` (breaks arrow keys); question and feedback text rendered in DOM overlays, not canvas text (Phaser RTL bugs); fonts Heebo/Rubik.

### 2.9 Token tracking and cost

Follows `.github/instructions/ai-usage-tracking.instructions.md`:

- One `ai_usage_events` row per provider attempt, from exact Copilot SDK `assistant.usage` events (input, output, cache read, cache write, model). Never estimated.
- `UsageContext(actor_id=learner_id, actor_type="learner", endpoint="internal:game_generate", feature="feature_7_learning_games", operation=…, source="game_gen_worker", session_id=game_id, exchange_id=job_id)` with operations `game.plan`, `game.build`, `game.patch`, `game.fix`, `game.judge`.
- New `ai_usage_pricing` rows: provider `github_copilot`, deployment `claude-opus-5`, $5 in / $0.50 cached / $25 out per 1M (Copilot bills Claude at provider list price since 2026-06 usage-based billing); `gpt-5.4-mini` already priced.
- Admin dashboard gets `feature_7_learning_games` for free through the existing feature grouping.
- Kid-facing "sparks" = cost bucketed, shown on the card; daily caps above.
- Expected cost (from vibe's production data, Opus 4.x): create ≈ 20–40k output + 25k input tokens ≈ $0.7–1.3 incl. one repair; edit ≈ $0.15–0.4. Ten parallel builds ≈ 10 × 1 vCPU for 3–10 min; container cost is negligible next to tokens.

### 2.10 Why not the alternatives (recorded for the record)

- Spec-only JSON runtime is ~10× cheaper and schema-safe, but Gal chose full codegen for creative freedom; the harness + validator + judge keep the cost and failure modes bounded.
- Direct Anthropic API would give structured outputs and cleaner telemetry at the same list price; Copilot SDK was chosen to reuse vibe's proven wrapper and existing seats. Keep a thin provider interface in the worker so this can flip later.
- Reusing the vibe-coding-kids deployment as the service was rejected: cross-repo coupling and token events outside Yuvi's ledger.

---

## 3. Delivery plan (ADO child tasks)

| # | Task | Exit criteria |
|---|---|---|
| 0 | **Spike: Copilot SDK + Opus 5 headless in a Container App** | `listModels()` shows `claude-opus-5` with the service token; 5 sample games built from a Kata component through the learning contract; median tokens/cost/time recorded; Playwright runs in the image. |
| 1 | **Backend core** | `learner_games` / jobs store, routes, Blob storage, context pack builder, Service Bus enqueue with inline fallback, notification kinds, realtime frames, pricing rows, daily caps, tests. |
| 2 | **Worker + infra** | Ported vibe modules under `workers/game_gen/`, learning contract prompt, harness, validator with contract assertions, repair loop, judge, DLQ consumer, Dockerfile, Bicep, deploy workflow, KEDA scaling verified with 10 parallel jobs. |
| 3 | **Studio Game Lab station** | Prop + station wiring (`StationId`, zones, pads, anchors), panel with history + create wizard, live build card, prop reacts to realtime frames. |
| 4 | **Lesson page Games tab + player** | Third tab, full-screen `GamePlayer`, YuviLearn bridge with server-side grading, edit chat panel, bug capture + auto-fix, bell chime, locales he/en/ar. |
| 5 | **Learning telemetry + teacher visibility** | (answers telemetry dropped with the question machinery, 2026-09-10) teacher profile shows student-made games; admin jobs report with timings + judge scores. |
| 6 | **Hardening** | Load test, cost report vs. estimate, content-safety review, a11y/RTL pass on Chromebook + tablet, docs update. |

Sequencing: 0 → 1 ∥ 3 → 2 → 4 → 5 → 6. Task 0 gates the model choice; if `claude-opus-5` is unavailable through Copilot for the org, fall back to the provider interface with Anthropic direct before building task 2.

---


### Revised 2026-09-10 — let the model design

Questions were the part the kids met first and the part that felt broken ("what chess board?"). Blueprints, figures, per-run instances and server grading were removed; the learning context became one paragraph; the prompt became one flowing brief with an ambition bar instead of a rule book; the judge revises instead of discarding; effort dropped to low/medium; the worker stays warm; and every job carries per-stage timings so the report (`scripts/games_report.py`) shows where the seconds and dollars go. The model default is chosen by the bake-off (Sonnet 5 / GPT-5.6 Sol / Opus 4.8 vs Opus 5), with the user's own play-through as the final vote. See [game-question-blueprints.md](game-question-blueprints.md) (superseded) for what was there before.

### Bake-off 2026-09-10 — the default model

48 games (3 components: mass gross/tare/net, chemical formulas, math coordinates × 2 briefs × 4 models × low/medium) built by the dev worker into gal's studio; judged by gpt-5.4-mini; every build passed the validator. `scripts/games_report.py --since-hours 6 --md`:

| model | effort | n | total_s p50 / p95 | cost mean / p95 | learning · fun · polish · age |
|---|---|---|---|---|---|
| **claude-sonnet-5** | **low** | 6 | **230 / 284** | **$0.19 / $0.23** | 4.8 · 4.2 · 4.7 · 5.0 |
| claude-sonnet-5 | medium | 6 | 396 / 437 | $0.29 / $0.33 | 4.8 · 4.2 · 4.5 · 4.8 |
| gpt-5.6-sol | low | 6 | 253 / 371 | $0.34 / $0.54 | 4.8 · 4.0 · 4.8 · 5.0 |
| gpt-5.6-sol | medium | 6 | 345 / 399 | $0.37 / $0.43 | 4.7 · 4.0 · 4.8 · 4.7 |
| claude-opus-4.8 | low | 6 | 309 / 386 | $0.53 / $0.84 | 4.5 · 4.2 · 4.5 · 5.0 |
| claude-opus-4.8 | medium | 6 | 314 / 432 | $0.54 / $0.76 | 4.3 · 4.0 · 4.5 · 5.0 |
| claude-opus-5 | low | 7 | 325 / 444 | $0.53 / $0.82 | 4.4 · 4.3 · 4.7 · 5.0 |
| claude-opus-5 | medium | 6 | 546 / 791 | $1.02 / $1.50 | 5.0 · 4.5 · 4.5 · 4.8 |

Decision: **`claude-sonnet-5`, effort `low`** is the default (`GAME_MODEL_DEFAULT`, worker `COPILOT_MODEL`); "deep thinking" runs Sonnet at `medium`. Medium effort bought no judge points on any model and cost 55-90 % more time. Opus 4.6 is not on the Copilot catalog (Opus 4.8 stood in). Where the seconds go at Sonnet low: model turn ≈ 160 s p50, validate ≈ 35 s, plan ≈ 17 s, judge ≈ 15 s, queue+wake < 5 s. Next weak spot: the second delivery after a validator error (Opus/Sol spent 60-90 s there); the play-score and poster windows are the next 20 s.

### Game page (revised 2026-09-08)

`/games/play?game=<id>&from=studio|lesson|bell` is the one door to a game: a normal learner page (app bar, platform theme) with the game on the stage, a floating HUD (back "to Yuvi", title, status, fullscreen), and Yuvi's chat on the right in the companion's visual language. While a build runs the stage is a **build console** that streams the code as it is written (the worker forwards `assistant.tool_call_delta` of `submit_game` as coalesced `event:'code'` realtime frames, ~1/s) and the chat is disabled. The chat has two modes: **change** (an edit job; carries the runtime errors the frame reported) and **question** (`POST /api/games/{id}/ask`, mini tier, answered from the source without a rebuild). Cards show the validator's screenshot (`GET /api/games/{id}/thumb`).

## 4. Integration seams (file map)

Room / station: `frontend/src/features/Yuvi-studio/RoomDesign.ts` (`StationId`, `DEFAULT_STATIONS`, `cloneRoom`, `normalizeRoom`, `sameRoom`), `YuviLabRoom.ts` (`LabRoomZoneId`, `ZONES`, `ZONE_PADS`, `STATION_RADIUS`, `pickStation`, `stationAnchor`, `setStations`, fixed props near line 676), `StudioContent.tsx` (`StudioMode`, `handleZoneChange`, `goToStation`, station buttons, panels), `panel/StationPanel.tsx`, `panel/SegmentedNav.tsx`, `styles/Yuvi-studio.css`.

Lesson page: `frontend/src/components/CompanionChat.tsx` (`taskView`, tablist, tab panels, composer gate, fullscreen restriction), `companion.css`, `features/learning-lesson/LessonPage.tsx`, `app/App.tsx` (`isActiveTaskRoute`), `features/learning-create/app.ts` (srcdoc precedent).

Backend: `backend/app/services/notifications.py` (`KINDS`, `notify`), `services/realtime.py` (`publish`, Redis bridge), `services/ai_usage.py` (`UsageContext`, `record_usage`), `services/llm.py` (mini tier for plan/judge), `services/kata_client.py` (`questions_by_item`, `information_to_bot`), `services/tasks/generate.py` (registry pattern for inline mode), `routes/learning_content.py` (Hebrew lomda prompt to fold into the learning contract), `brain/repository.py` (`_get_collection_named`), `auth/dependencies.py` (`require_learner`, `assert_can_read_learner`).

Frontend services: `services/notifications.ts` (`NotificationKind`), `providers/NotificationsProvider.tsx` (live frames), `services/celebrationAudio.ts` (chime sibling), `services/realtime.ts`.

vibe-coding-kids modules to port (paths under `src/backend/`): `agent/session.py` (Copilot wrapper, usage accumulation, truncate-last-exchange), `agent/config.py` (CLI resolution, provider, language rule), `agent/game_prompts.py` (builder system message), `agent/html_utils.py`, `agent/code_utils.py`, `agent/libraries.py`, `agent/patch_engine.py`, `html_validator.py`, `src/frontend/src/utils/gameFrame.ts`, `src/teacher-portal/backend/task_service_bus.py` (receive loop, lock renewal, DLQ).

---

## 5. Risks

- Copilot model catalogue is org-policy gated and had a regression hiding Claude models (Aug 2026). Mitigation: task 0 + provider interface.
- Single service-account seat absorbs all spend; Copilot credits are prepaid. Mitigation: daily caps, admin report, alert on daily cost.
- Opus builds take minutes; kids leave the page. Mitigation: everything is asynchronous, bell + chime, studio prop feedback, build survives navigation.
- Client-side game code can be inspected by the kid; correct answers are never in it (server grading).
- Playwright + Copilot CLI in one image is heavy (~1.5 GB). Acceptable for a scale-to-zero worker.
