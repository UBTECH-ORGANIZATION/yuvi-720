---
description: "Use when implementing frontend or backend features in yuvi-720. Covers folder structure, code separation, architecture, validation, legacy cleanup, localization, FastAPI, vanilla JS, and 720 compliance."
applyTo: "backend/**,frontend/**,learner-mapping/**,learning-agent/**,student-dashboard/**,teacher-view/**,mentoring/**,shared/**,locales/**"
---
# Yuvilab Spark Implementation Architecture

## Default Architecture
- Backend: FastAPI in `backend/`, with reusable logic split into small modules as features grow.
- Persistence: MongoDB/Cosmos is the source of truth for learner profile, language preference, dashboard cache, mentoring state, content progress, and AI memory. Do not use `localStorage` or `sessionStorage` for app state.
- Frontend today: vanilla HTML/CSS/JavaScript. React migration is now explicitly approved by the user.
- Shared frontend behavior belongs in `shared/`; translatable text belongs in `locales/`.
- Keep all changes mapped to a 720 requirement where possible.
- Local development: do not request backend/frontend restarts by default. FastAPI `--reload`, static file serving, Vite dev server, and browser refresh are usually enough. Restart only for dependency, environment, startup, port, or stuck-process changes.

## Frontend Best Practices
- HTML owns semantic structure, accessible labels, page landmarks, and static mounting points.
- CSS owns layout, visual state, animation, and responsive behavior.
- JavaScript owns state, API calls, event handling, rendering, persistence, and runtime localization.
- Persist frontend state through backend APIs backed by MongoDB. Browser storage is allowed only for temporary, non-authoritative UI ephemera when explicitly justified.
- Avoid new large inline scripts. Prefer extracting focused shared modules for repeated logic.
- Do not duplicate language, API, chat, dashboard, or component-rendering helpers across pages.
- Use `shared/i18n.js`, `data-i18n`, `data-i18n-*`, and locale JSON files for user-visible text.
- React-rendered user-visible text must use the React i18n provider and locale keys. Static HTML must use `data-i18n` attributes. Backend prompts and fallbacks must use language-keyed dictionaries.
- Direction must come from `document.documentElement.dir`: `he` and `ar` are RTL; `en` is LTR.
- Use logical CSS properties: `margin-inline-*`, `padding-inline-*`, `inset-inline-*`, `text-align: start`.
- Use `dir="auto"` or plaintext bidi handling for user-generated mixed-language content.
- Keep student UI encouraging, concrete, and age-appropriate for grades 7-9.

## React Migration Plan
- Use Vite + React + TypeScript unless the user chooses a different React stack.
- Preserve visual design first: theme colors, spacing, Yuvi robot, stepper, chat card rhythm, dashboard panels, and RTL-first layout should survive migration.
- Create a React app in `frontend/` or `src/frontend/` with:
	- `src/app/` for app shell, route state, providers, and page composition.
	- `src/components/` for reusable UI components.
	- `src/features/learner-mapping/`, `student-dashboard/`, `learning-agent/`, `teacher-view/`, `mentoring/` for feature modules.
	- `src/services/` for API and streaming clients.
	- `src/i18n/` for locale loading and direction helpers, reusing existing `locales/he.json`, `en.json`, and `ar.json` where possible.
	- `src/styles/` for global tokens and migrated CSS.
- Migrate route by route. Do not delete a legacy static page until its React replacement matches current behavior and design and has been validated.
- After a route is migrated, remove its replaced HTML/CSS/JS and update FastAPI mounts/build output accordingly.
- Avoid duplicating business logic in React. Keep scoring, questionnaire localization, prompt text, and AI orchestration in backend modules.
- Validate every migrated route in Hebrew RTL, Arabic RTL, and English LTR.

## Backend Best Practices
- Keep route handlers thin. Move reusable logic into dedicated modules such as `questionnaire_locales.py`, prompt templates, scoring, LLM access, dashboard generation, mentoring, and data access.
- Put persistence logic in dedicated backend modules instead of scattering MongoDB calls through route handlers.
- Use async I/O for HTTP, database, and storage calls.
- Keep LLM prompt templates and fallback text language-keyed.
- Keep the app demoable when LLM credentials are missing.
- Use environment variables for secrets and deployment configuration.
- Use Pydantic models when endpoint request/response contracts become more than trivial dictionaries.
- Do not send personally identifying learner details to AI. Use non-identifying learner profile traits and learning context.
- Teacher-facing AI insights must be explainable and show raw evidence for flags.
- Route every external AI/provider request through an approved instrumented service. Every model call requires `UsageContext`; do not invoke APIM, Azure OpenAI, Agent Framework runs, or Azure Speech directly from feature routes or agents.
- Persist one privacy-safe usage event per provider attempt. Streaming finalizes once after completion/failure/cancellation, exact provider usage is never estimated, and unknown pricing remains null.
- Keep prompts, responses, PII, disclosures, provider URLs/headers/secrets, and exception messages out of usage telemetry.

## Folder Structure Direction
- `backend/server.py`: FastAPI app bootstrap only: middleware, router inclusion, static mount registration, and uvicorn entrypoint.
- `backend/app/routes/`: APIRouter modules grouped by feature or surface, such as learner mapping, learner state, static pages, learning agent, dashboard, mentoring, and teacher view.
- `backend/app/services/`: reusable logic such as LLM clients, dashboard generation, mentoring workflows, recommendations, and content generation.
- `backend/app/core/`: shared configuration, paths, settings, constants, and app-wide helpers.
- `backend/*_locales.py` or `backend/app/core/*_locales.py`: localized content and prompt dictionaries.
- `backend/learner_state.py` and future persistence modules: MongoDB/Cosmos data access isolated from route handlers.
- `shared/`: frontend runtime utilities and shared assets.
- `locales/`: `he.json`, `en.json`, `ar.json` with matching keys.
- Feature folders (`learner-mapping/`, `learning-agent/`, `student-dashboard/`, `teacher-view/`, `mentoring/`): page-specific HTML/CSS/JS only.

## Legacy Cleanup Policy
- Delete dead, duplicated, or replaced legacy code when your implementation supersedes it and validation passes.
- Remove hardcoded strings when replacing them with locale keys.
- Remove duplicate prompt copies when replacing them with centralized prompt dictionaries.
- Remove unused fallback/demo branches only after confirming the new path works without LLM credentials.
- Do not delete unrelated user changes. If uncertain whether code is still used, search references first.
- If cleanup is too large for the current task, leave a clear follow-up note or Azure DevOps task.

## Validation Expectations
- For backend changes: run `python3 -m py_compile` on touched modules and, when possible, a small endpoint/import smoke test.
- For frontend JS changes: run `node --check` on touched scripts.
- For JSON changes: run `python3 -m json.tool` on touched JSON files.
- For UI/direction changes: use a browser smoke test for Hebrew RTL, English LTR, and Arabic RTL.
- Always run `git diff --check` before finishing.
- For AI changes, run the usage guard/tests and verify every provider call has stable endpoint, feature, operation, pseudonymous actor, and session/exchange attribution where available.