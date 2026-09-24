# Deploy paths

Every route into an environment, and what guards it. The workflows' header
comments describe each one in detail; this is the map.

| Trigger | Workflow | Runs tests | Lands on | Guard |
|---|---|---|---|---|
| Push to `main` | `deploy-spark.yml` | yes (`ci.yml`) | Spark **Dev slot** (`dev.spark.yuvilab.ai`) | branch rule `main-protection`: PR + 3 required checks |
| Manual, `promote=true`, **from `main`** | `deploy-spark.yml` | yes | Dev → **Production** slot swap (`spark.yuvilab.ai`) | `github.ref == main` on the job, `production` environment |
| Manual from any other branch | `deploy-spark.yml` | yes | Dev slot only ("Dev preview of <branch>") | `promote-production` never runs; `latest` is not retagged |
| Push to `main` touching the worker | `deploy-game-gen.yml` | yes | `ca-game-gen-dev` Container App | branch rule |
| Manual, `confirm=prod`, **from `main`** | `deploy-game-gen.yml` | yes | `ca-game-gen-dev` then `ca-game-gen-prod` | `github.ref == main`, `production` environment |
| Push to `main` touching `admin/` | `deploy-admin.yml` | yes | Admin web app (**production**, no dev slot) | branch rule |
| Manual, `confirm=ADMIN-PRODUCTION`, **from `main`** | `deploy-admin.yml` | yes | Admin web app | typed confirm + `github.ref == main` |
| Manual, any ref, `confirm=DEPLOY-PRODUCTION` | `deploy-production-ref.yml` | yes (on that ref) | **Production** slot directly, Dev untouched | break-glass hotfix; typed confirm, `production` environment |
| Nightly schedule | `content-nightly.yml` | dispatches `ci.yml` and waits for it on the PR's head commit | opens/updates a PR to `main`; with repo variable `CONTENT_AUTOMERGE=on`, merges it and dispatches `deploy-spark.yml` (`promote=false`, **Dev slot only**) | `content_guard.py` must pass, CI green on the exact SHA (`--match-head-commit`); `shadow` rehearses without merging; unset/`off` leaves the PR to a person. No deploy when only `index.json` changed |

## Rules of thumb

- Production only ever receives a build of `main`, except through the
  break-glass hotfix workflow, which says so in its name.
- The Dev slot is also the branch-preview surface: dispatching
  `deploy-spark.yml` from a feature branch with `promote=false` is the
  supported way to try a branch on `dev.spark.yuvilab.ai`. Remember that the
  next push to `main` replaces it.
- `:latest` on ACR means "what `main` last built". Branch runs tag their
  sha only.
- One deploy at a time per target: every deploy workflow has a
  `concurrency` group with `cancel-in-progress: false`, so a second run waits.

## Repository settings that back the YAML

Set in GitHub → Settings → Environments (not in code):

- `production` and `admin`: required reviewer, and *Deployment branches* =
  `main` only. This makes the branch guard hold even if a workflow's `if` is
  edited away.
- `staging` / `dev`: no branch restriction, so branch previews keep working.

Check with `gh api repos/{owner}/{repo}/environments/production`.
