# game_gen — Learning Game Lab worker

Builds one validated learning game per job. The model designs freely from a
one-paragraph learning description: a mini model pitches the game first, the
builder (GitHub Copilot SDK, model and effort per job) writes the HTML as reply
text, the worker post-processes it, injects the serve-time harness, runs it
headlessly in Chromium (errors, liveness, canvas, a 2 s play score), a mini
judge scores it, and a weak create gets one revision turn. Every job row ends
with timings, per-attempt detail and the verdict.
Design: `docs/design/learning-game-lab.md`. ADO: #545.

## Layout

| Module | Role |
|---|---|
| `config.py` | env, model, Copilot CLI resolution, language rule |
| `copilot_session.py` | `HeadlessCopilotSession` on SDK 1.0.13: usage capture, credit cap, `list_model_ids()` |
| `prompts.py` | builder/editor system messages (identity → learning stance → bridge helper → ambition → tech rules → delivery), `PLAN_SYSTEM`/`plan_prompt`, `JUDGE_SYSTEM`/`judge_prompt`, `REVISION_PROMPT`, `SHRINK_PROMPT` |
| `context_pack.py` | `ContextPack` from the job payload's `context` (titles, subject, grade, purpose, `learning_description`); no answers anywhere |
| `harness.py`, `harness/*.js` | storage shim, fit-to-frame, error reporter, the thin `YuviLearn` bridge |
| `pipeline.py` | `run_job(JobSpec)`: plan → build → validate → judge → (revise → re-judge) → `JobResult{timings, judge}` |
| `validator.py` | Playwright validator: load, Start + poster, harness state, play score, heartbeat, canvas, screenshot |
| `patch_engine.py`, `html_utils.py`, `code_utils.py`, `libraries.py` | edit DSL, extraction, deterministic fixes, curated CDNs |
| `usage.py` | ledger adapter (`ai_usage_events`) + USD estimate from SDK billing |
| `worker.py` | job consumer (Mongo poll / Service Bus): streams code, thinking, plan and patch frames; persists version + job fields |
| `spike.py` | local runner → `runs/<stamp>/…` + `runs/report.md` |
| `scripts/dump_fixture.py` | fixture of `ContextPack` rows from the live catalog (descriptions cached in Mongo) |
| `scripts/games_report.py` | the weak-spot finder: per (model, effort) pass rate, stage p50/p95, cost, judge means, revision/shrink rate, top errors |
| `scripts/bakeoff.py` | the model × effort × component × brief matrix, queued to the cloud worker or run locally |

## Run locally

```bash
cd workers
python3 -m venv game_gen/.venv && game_gen/.venv/bin/pip install -r game_gen/requirements.txt pytest pytest-asyncio
game_gen/.venv/bin/python -m playwright install chromium
game_gen/.venv/bin/python -m pytest game_gen/tests -q            # unit + Chromium smoke tests
(cd ../backend && .venv/bin/python ../workers/game_gen/scripts/dump_fixture.py)   # fixture rows (gitignored)
game_gen/.venv/bin/python -m game_gen.spike --genre shooter --component 0 --model claude-sonnet-5 --effort low
game_gen/.venv/bin/python -m game_gen.spike --matrix --no-plan
```

### The worker (consumes jobs the backend enqueues)

```bash
cd workers && game_gen/.venv/bin/pip install -r ../backend/requirements.txt   # backend services are imported directly
cd workers && PYTHONPATH=.:../backend game_gen/.venv/bin/python -m game_gen.worker
# GAME_JOBS_MODE=mongo (default): polls learner_game_jobs; GAME_WORKER_ONCE=1 drains and exits
# GAME_JOBS_MODE=servicebus: receives pointer messages from the game-jobs queue
```

Auth: with no `COPILOT_GITHUB_TOKEN` the SDK uses the logged-in Copilot CLI
(`copilot` / `gh auth`). In Azure the worker gets a service-account token.
`COPILOT_MODEL` is the last-resort model when the job carries none;
`JUDGE_MODEL` / `PLAN_MODEL` override the mini model for A/B.

### Reports and the bake-off

```bash
cd workers && PYTHONPATH=.:../backend game_gen/.venv/bin/python -m game_gen.scripts.games_report --since-hours 24
cd workers && PYTHONPATH=.:../backend game_gen/.venv/bin/python -m game_gen.scripts.bakeoff --efforts low --mode queue --learner <id> --dry-run
```

## Contract

**Job payload** (`payload`): `kind`, `genre`, `vibe`, `inspirations`, `language`,
`device`, `learner_title`, `instruction`/`errors`/`history`/`version` (edit/fix),
`model` (None → `COPILOT_MODEL` → `claude-opus-5`), `reasoning_effort`
(default `low`), `judge`, `plan`, and `context = {component: {id, title, purpose,
relative_difficulty}, unit: {id, title, subject}, objective: {id, title,
description, curriculum_title}, learning_description}`. No question rows, no
answers, no blueprints.

**Job row fields written at done/failed**: `model`, `reasoning_effort`,
`timings {queued_s, wake_s, session_start_s, plan_s, model_s[], validate_s[],
judge_s, revise_s, rejudge_s, persist_s, total_s}`, `attempts_detail [{n, ok,
reason, validate_s, model_s, output_tokens, html_lines, error_classes,
play_score}]`, `judge {scores {learning_through_play, fun, polish, age_fit},
notes, top_fix, revised, before, model} | None`. The version entry carries the
same `judge`.

**Realtime frames** (`notify.publish_progress`): `code`, `thinking`, `summary`,
`patching`, `build`, `validate`, `validated`, `judge`, `tool`, plus `plan`
(`detail` = the pitch, ≤ 600 chars; also written to the game's `description`).
A judge revision streams as `code` frames exactly like an edit.

**The bridge** (`harness/yuvi_learn.js`, injected by the backend `/html` route and
by the validator): `window.__yuvi.learn = {asked, answered, correct, done}`;
`YuviLearn.language` / `componentTitle`; `YuviLearn.mount(q, el)` renders
`{text, answers?, correct, type?, figure?}` and grades locally against
`q.correct`; `YuviLearn.progress(patch?)`; `YuviLearn.done(summary?)`; legacy
no-ops `next()` / `answer()` / `reset()`. Posts `ready {mode:'free'}` on load.

**What the validator holds a game to**: it loads without errors, Start works,
the rAF heartbeat runs (≥ 30 ticks), the canvas is not blank, `window.__yuvi`
exists. The play score (`{frames, input_reacts, dom_text}`) is informational
and goes to the judge. There is no learning contract: the game owns its questions.
