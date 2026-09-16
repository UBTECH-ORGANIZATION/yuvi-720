# מדריך המערכת למדריכי Spark — תהליך התחזוקה

<div dir="rtl">

התיקייה הזו מייצרת קובץ PDF אחד בעברית, `spark-user-guide-he.pdf`, שמסביר למדריכי Spark
איך לעבוד עם המערכת מקצה לקצה — מהתחברות ועד מעקב אחרי תלמידים.

**הטקסט נכתב בידי אדם. רק התמונות אוטומטיות.**

</div>

---

## How it fits together

```
docs/guide/docs-map.json        ← single source of truth
    ├── chapters/*.he.md        ← the Hebrew prose (human-written)
    ├── screenshots/<chapter>/  ← captured by Playwright (never edited by hand)
    ├── template/guide.html     ← RTL A4 print stylesheet
    └── spark-user-guide-he.pdf ← the deliverable (committed)

frontend/scripts/docs/
    ├── map.mjs        loads + validates docs-map.json
    ├── harness.mjs    browser session, login, clock freeze, animation freeze, shoot()
    ├── scenarios/*    one file per chapter — the clicks that produce its screenshots
    ├── capture.mjs    runs the scenarios
    ├── build-pdf.mjs  markdown + template → PDF
    └── plan.mjs       changed files → which chapters need re-capturing
```

`docs-map.json` is the only place that knows a chapter exists. It carries the chapter's
title, its markdown file, its scenario, the fixture account it signs in as, and — the
important part — its `watchPaths`: the source globs that, when they change, mean the
chapter's screenshots are now lying.

## Running it locally

You need the backend serving the built bundle with seeded fixture data.

```bash
# once
npm ci --prefix frontend
npx --prefix frontend playwright install chromium
npm run build --prefix frontend          # FastAPI serves static/react

cd backend
python scripts/seed_dev.py               # needs MongoDB; refuses SPARK_STORAGE=json
python -m uvicorn server:create_app --factory --port 8720
```

Then, in another shell:

```bash
npm run docs:capture --prefix frontend                       # all chapters
npm run docs:capture --prefix frontend -- --chapters=mentoring,teacher-goals
npm run docs:pdf     --prefix frontend                       # markdown + shots → PDF
npm run docs:build   --prefix frontend                       # both
npm run docs:plan    --prefix frontend -- --all --json       # what would be captured
```

`docs:capture` wipes a chapter's screenshot folder before re-shooting it, so a
screenshot you delete from the markdown stops being committed.

> **Note on determinism.** The clock is frozen at 09:00 Asia/Jerusalem and every
> animation and transition is zeroed, but the seed data is generated *relative to the
> real current day*. Dates inside the screenshots therefore move over time. That is why
> only the chapters whose source actually changed get re-captured — untouched chapters
> keep yesterday's images and the PDF stays stable.

## What the automation does on `main`

`.github/workflows/docs-guide.yml`:

1. **plan** — diffs the push, runs `plan.mjs`, and decides which chapters (if any) are
   stale. A push that touches nothing documented ends here.
2. **build** — boots a throwaway `mongo:7`, seeds it, builds the bundle, serves it with
   FastAPI, re-captures **only the planned chapters**, rebuilds the PDF, and uploads
   everything as an artifact.
3. **propose** — commits the changed PNGs and the PDF to the rolling branch
   `docs/guide-auto` and opens (or updates) a pull request.

`main` is protected, so the guide always arrives as a reviewable PR — never a push.
The PR body carries a checklist, because **the pipeline cannot tell that the prose went
stale**. If a screen changed enough that the Hebrew text no longer describes it, edit
the chapter on that branch before merging.

A pull request that touches `frontend/scripts/docs/**`, `docs/guide/**`, or the workflow
itself captures *every* chapter and uploads the artifact without proposing anything —
that is the guard against a scenario whose selectors have quietly died.

## Adding a chapter

1. Add an entry to `docs-map.json`: `id`, `order`, `lane` (`student` / `teacher` /
   `shared`), `title`, `markdown`, `scenario`, `account`, and `watchPaths`.
2. Write `chapters/<id>.he.md`. One `#` H1 matching the map title; reference images as
   `![alt](../screenshots/<id>/NN-slug.png)`; put instructor-only notes in
   `> **למדריך:** ...` blockquotes.
3. Write `frontend/scripts/docs/scenarios/<scenario>.mjs` exporting
   `{ id, async run({ base, page, shoot, goto, settle, waitFor, newSession }) }`, calling
   `shoot(page, 'slug', { selector })` once per image in the markdown.
4. `npm test --prefix frontend` — `tests/docs-plan.test.ts` asserts the map stays
   coherent (every chapter has watchPaths, every account key resolves).

## Fixture accounts

Seeded by `backend/scripts/seed_dev.py`, password `Aa12345`:

| key            | user      | why                                           |
| -------------- | --------- | --------------------------------------------- |
| `learner`      | `d450-12` | a learner with rich, realistic history         |
| `freshLearner` | `dvir`    | has **not** completed mapping — for chapter 2  |
| `goalLearner`  | `d450-25` | has an active mentoring goal                   |
| `teacher`      | `gal`     | teacher of `gal-class`, with calendar events   |

The harness marks `onboarded: true` accounts as having finished mapping (via
`PATCH /api/learner-state`) so `OnboardingProvider` does not bounce them back to the
questionnaire mid-capture.

## Known rough edges

- **WebGL scenes** (Yuvi Studio) are the least reliable headless capture. If one comes
  out black, prefer a hand-approved static image over a flaky scenario.
- A scenario whose selectors all miss logs `⚠️ <slug>: no candidate selector matched`
  and falls back to a full-viewport shot rather than failing the run — read the capture
  log, do not just trust the exit code.
- `build-pdf.mjs` exits non-zero if the markdown references a screenshot that does not
  exist, and asserts a Hebrew font is installed before printing (CI installs
  `fonts-noto-core`).
