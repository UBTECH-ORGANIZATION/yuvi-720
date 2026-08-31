# Databases: dev and production

*Work item 248.*

## The two clusters

| | production | dev |
|---|---|---|
| Cluster | `yuvi720` | `yuvi720-dev` |
| Host | `yuvi720.mongocluster.cosmos.azure.com` | `yuvi720-dev.mongocluster.cosmos.azure.com` |
| Resource group | `rg-yuvi-720` | `rg-yuvi-720` |
| Region | North Europe | North Europe |
| Tier | M20, 32 GB | M10, 32 GB |
| Contains | real learners | synthetic seed data only |

They are two separate Azure resources with separate credentials, not two
databases inside one account. A compromised or fat-fingered dev credential
cannot reach production data.

## Which environment reaches which

| Process | `SPARK_ENVIRONMENT` | Cluster | Database |
|---|---|---|---|
| Production slot of `ubi-yuvi-720` | `production` | `yuvi720` | `yuvi720` |
| Dev slot of `ubi-yuvi-720` | `dev` | `yuvi720-dev` | `yuvi720` |
| English slot of `ubi-yuvi-720` | `english` | `yuvi720-dev` | `yuvi720_english` |
| Admin console (deployed) | `production` (`ADMIN_ENV`) | `yuvi720` | `yuvi720` |
| A developer laptop | `local` | `yuvi720-dev` | `yuvi720` |
| CI | `test` | none — `SPARK_STORAGE=json` | — |

`MONGODB_CONNECTION_STRING`, `MONGODB_DATABASE` and `SPARK_ENVIRONMENT` are all
**slot settings**, so a dev → production swap moves the image and leaves the
database behind.

## The guard

[`backend/app/core/database.py`](../../backend/app/core/database.py) is the only
place that decides which store a process may open. It runs at boot
(`create_app`) and again in the Mongo client factory, so a one-off script is
covered without having to remember anything.

* Connection string present → Mongo, and the host is printed at startup.
* Absent **and** `SPARK_STORAGE=json` → the JSON fallback, deliberately.
* Absent and nothing said → `RuntimeError`. A deployment that lost its
  connection string fails at boot instead of quietly writing to a container
  filesystem that disappears on the next restart.
* Production host from a non-production environment → `RuntimeError`, unless
  `SPARK_ALLOW_PRODUCTION_DB=1` is set for that one command, which prints a
  warning on every boot.

To see what a process actually reached — as opposed to what its config claims:

```bash
cd backend && ./.venv/bin/python scripts/which_database.py
```

It connects, asks the server which node answered, and exits non-zero if a
non-production process turns out to be on production.

## Filling dev from scratch

Learner data in dev is **generated, never copied from production**. The one
exception is the list of people who can sign in.

**Accounts.** So that the same people can sign in to dev, copy the `users`
collection — and only that collection:

```bash
cd backend
SPARK_PRODUCTION_MONGODB_URI='mongodb+srv://…yuvi720…' \
    ./.venv/bin/python scripts/copy_users_from_production.py --dry-run
```

No events, no brains, no mastery, no conversations — nothing a child produced.
The production URI is passed on the command line for that one command so it
never lands in a `.env`, and the script refuses to write into production.

**Learning data.** When a screen needs a class with history behind it:

```bash
cd backend && ./.venv/bin/python scripts/seed_dev.py --dry-run
cd backend && ./.venv/bin/python scripts/seed_dev.py
```

That runs the existing seed scripts in dependency order — school and roster,
accounts, Gal's class, a 40-student class, two months of history, timetable,
habit-score signals, wellbeing history. Every step is idempotent, so re-running
is safe, and `--from '<step>'` resumes after a failure part-way through. The
script refuses to run against production; there is no flag to override that.

## Taking a schema change to production

There is no migration framework, and this is not proposing one. Mongo documents
are schema-less, so nearly every change is additive and the code simply has to
read old documents. The sequence below is what makes that true in practice.

1. **Write the change so old documents still read.** New fields get a default at
   the read site, never a required key. If a document without the field would
   crash a dashboard, that is the bug — fix it before deploying, not after.
2. **Add the index in code, not by hand.** Index creation lives in the app
   lifespan (`index_steps` in [`backend/server.py`](../../backend/server.py)) and
   runs on every boot, isolated per step so one failure does not skip the rest.
   Adding it there means dev, English and production all converge on the same
   indexes without anyone running a command.
3. **Prove it on dev.** Deploy to the dev slot, watch the startup log for the
   `🗄️ storage=mongo environment=dev host=yuvi720-dev…` line and for index
   failures, then exercise the affected screen.
4. **If old documents need rewriting, write a one-off script** under
   `backend/scripts/`, and make it idempotent and resumable. Run it against dev
   first. It must count what it changed and print that count.
5. **Run the backfill against production before the swap**, not after, so the
   code that lands already sees the shape it expects:
   `SPARK_ALLOW_PRODUCTION_DB=1 SPARK_ENVIRONMENT=production ./.venv/bin/python scripts/<script>.py`
   — run by whoever holds the production credentials, from their machine, with
   the output kept.
6. **Swap dev → production** with the manual trigger on
   `.github/workflows/deploy-spark.yml`. The workflow re-checks that production
   still owns the production cluster before it swaps.
7. **Watch the production startup line and the admin console badge.** The
   console top bar names the environment and database it is reading; if it does
   not say `production` / `yuvi720`, stop and fix that first.

Rolling back is the swap in the other direction. That is why step 1 matters:
the previous image has to survive the new documents.

## Open questions

* Is there a third environment (staging), or does the dev slot serve that role?
* Who holds the production connection string, and where is it kept besides the
  App Service settings?
* The deployed admin console reads production by design. Locally it now points
  at dev, which means local admin work sees seeded usage rather than real usage
  — acceptable, or does it need its own read-only production credential?
