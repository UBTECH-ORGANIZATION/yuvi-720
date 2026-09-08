# game_gen — Learning Game Lab worker

Builds one validated learning game per job: GitHub Copilot SDK (`claude-opus-5`)
writes the HTML, hands it to the `submit_game` tool, the tool post-processes it,
injects the serve-time harness, runs it headlessly in Chromium and checks the
learning contract, and a mini model judges whether the learning is integral.
Design: `docs/design/learning-game-lab.md`. ADO: #545 (this package is task #546).

## Layout

| Module | Role | Origin |
|---|---|---|
| `config.py` | env, model, Copilot CLI resolution, language rule | ported from vibe `agent/config.py` |
| `copilot_session.py` | `HeadlessCopilotSession` on SDK 1.0.13: tools, credit cap, usage capture | ported from vibe `agent/session.py` |
| `prompts.py` | builder/editor system messages, learning contract, harness API, judge | vibe `game_prompts.py` + Yuvi |
| `context_pack.py` | `ContextPack` (no answers) + `AnswerKey` from a Kata component | Yuvi |
| `harness.py`, `harness/*.js` | storage shim, fit-to-frame, error reporter, `YuviLearn` bridge | vibe `gameFrame.ts` + `EditorView` + Yuvi |
| `pipeline.py` | `run_job(JobSpec)`: tools → validate → judge → `JobResult` | Yuvi |
| `validator.py` | Playwright validator + learning-contract assertions | ported from vibe `html_validator.py` |
| `patch_engine.py`, `html_utils.py`, `code_utils.py`, `libraries.py` | edit DSL, extraction, deterministic fixes, curated CDNs | ported from vibe |
| `usage.py` | ledger adapter (`ai_usage_events`) + USD estimate from SDK billing | Yuvi |
| `spike.py` | task #546 runner → `runs/<stamp>/…` + `runs/report.md` | Yuvi |

## Run locally

```bash
cd workers
python3 -m venv game_gen/.venv && game_gen/.venv/bin/pip install -r game_gen/requirements.txt pytest pytest-asyncio
game_gen/.venv/bin/python -m playwright install chromium
game_gen/.venv/bin/python -m pytest game_gen/tests -q            # unit + Chromium smoke tests
# fixture with real Kata questions (gitignored — holds correct answers):
(cd ../backend && .venv/bin/python ../workers/game_gen/scripts/dump_fixture.py)
game_gen/.venv/bin/python -m game_gen.spike --genre shooter --component 0 --credits 300
game_gen/.venv/bin/python -m game_gen.spike --matrix                # 5 runs across genres
```

### The worker (consumes jobs the backend enqueues)

```bash
cd workers && game_gen/.venv/bin/pip install -r ../backend/requirements.txt   # backend services are imported directly
cd workers && PYTHONPATH=.:../backend game_gen/.venv/bin/python -m game_gen.worker
# GAME_JOBS_MODE=mongo (default): polls learner_game_jobs; GAME_WORKER_ONCE=1 drains and exits
# GAME_JOBS_MODE=servicebus: receives pointer messages from the game-jobs queue (task #548)
```

Auth: with no `COPILOT_GITHUB_TOKEN` the SDK uses the logged-in Copilot CLI
(`copilot` / `gh auth`). In Azure the worker gets a service-account token.

## Contract the games are held to

`YuviLearn.next()` must be called within ~15 s of Start, the question is shown
in a DOM overlay, `YuviLearn.answer()` grades (server-side in the app, local
key only under the validator), progress is gated by answers. The validator
fails a game that throws, stays blank, freezes, or never asks.
