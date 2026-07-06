# Yuvilab Spark Agent Instructions

Yuvilab Spark is a Hebrew-first, AI-assisted learning platform for the Israeli Ministry of Education 720 program. The product supports personalized and adaptive learning, learner mapping, a student dashboard, a teacher/mentor view, mentoring goals, and an AI learning companion.

## Project Shape
- Backend: FastAPI app setup in `backend/server.py`, with route modules under `backend/app/routes/`, service logic under `backend/app/services/`, shared configuration under `backend/app/core/`, and persistence helpers in dedicated modules such as `backend/learner_state.py`.
- Frontend: Vite + React + TypeScript in `frontend/`, with remaining self-contained iframe/lomda content in `learning-agent/`.
- AI: Azure OpenAI through APIM using `gpt-5-mini`, with fallback behavior when LLM calls fail.
- Data direction: MongoDB/Cosmos is configured and is the persistence source of truth. Mock data in `backend/mock_data.py` is demo seed/fallback only.
- Deployment: Docker to Azure App Service. Existing CI/CD is in `.github/workflows/deploy-spark.yml`; resource names include `rg-yuvi-720`, `ubi-yuvi-720`, and `yuvi720acr`.

## Important Folders
- `learner-mapping/`: initial learner mapping questionnaire and results flow.
- `learning-agent/`: learning/lesson/generator surfaces, including generated interactive lomda pages.
- `student-dashboard/`: student progress, profile, goals, strengths, challenges, and competencies.
- `teacher-view/`: teacher/mentor group and individual student insights.
- `mentoring/`: mentoring conversation surface.
- `shared/`: shared theme, robot assets, and future shared runtime code such as localization.
- `backend/app/routes/`: FastAPI routers for feature APIs and static/React serving.
- `backend/app/services/`: reusable backend service logic such as LLM access.
- `backend/app/core/`: shared configuration such as filesystem paths.
- `backend/`: app bootstrap, persistence helpers, mock seed/fallback data, and environment templates.

## 720 Program Priorities
- Target deadline: minimum 720 requirements by 30/07/2026.
- The highest-weight areas are learning agent / personal companion (25%), personalized content delivery (20%), and teacher view (20%).
- Use the `720-delivery-requirements` skill whenever planning roadmap, backlog, Azure DevOps work items, demos, proof videos, or feature coverage for the 30/07 deadline.
- Use the `720-content-standards` skill whenever authoring, reviewing, generating, importing, or instrumenting 720 content units, components, items, metadata, xAPI events, feedback, or adaptive routes.

## Agentic Architecture (Shared Learning Brain)
- The product is being built as **one AI mentor per student** around a **Shared Learning Brain / Context Engine**: a single per-learner document in MongoDB keyed by a **non-identifying `learner_id`** (collection `learners`) that all agents read from and write to. Agents are stateless specialists; the brain is the only durable memory.
- Six agents map to 720 features: Onboarding (F2), Learning Coach (F3, floating chat on every screen + proactive), Pedagogical (F1, adaptive next content), Reflection (self-awareness), Teacher Insights (F6, explainable + group-scoped), Safety (cross-cutting gate). The brain projection powers the dashboard (F4).
- Orchestration uses **Microsoft Agent Framework** as a layer over the existing **APIM** model access; keep deterministic + JSON fallbacks so the demo runs without agent/Mongo/APIM infra (never the production path).
- Replace mock/LLM-invented data with brain projections: progress/mastery come from real `learning_events` (xAPI), not the LLM; the LLM only phrases verbal, non-numeric feedback. Every AI claim must be traceable to a brain field or event.
- **Design for microservices from day one.** Keep bounded contexts (brain/context engine, xAPI ingest, agents orchestrator, insights, mentoring, org) as separable modules with no shared in-memory state, and treat the event bus and the proactive push channel as interfaces — so the current App Service monolith can later split into **AKS services wired by Azure Service Bus** with no agent/brain contract change. See `docs/architecture/shared-learning-brain.md` §16.
- The canonical design is `docs/architecture/shared-learning-brain.md`. Use the `720-agent-architecture` skill whenever working on the brain, agents, orchestration, context assembly, xAPI ingestion, dashboard/teacher-view projection, or mock-data replacement.

## Language, Direction, and Tone
- Supported product languages: Hebrew (`he`, RTL), Arabic (`ar`, RTL), English (`en`, LTR).
- All new user-visible strings must be localizable. Hebrew is the source language unless the task explicitly says otherwise.
- Do not add hardcoded learner-facing language. React text must use the React i18n provider and locale keys; static HTML should use `data-i18n`; backend prompts/fallbacks must be keyed by language.
- Persist selected language in MongoDB-backed learner state through backend APIs, not in `localStorage` or `sessionStorage`.
- Use warm, clear, age-appropriate language for students. Do not blame the learner. Avoid numeric scores in student-facing learning feedback.
- The AI agent must answer in the selected product language and must support at least Hebrew and Arabic for 720 compliance.

## Privacy and AI Safety
- Tell students when they are using AI.
- Do not send personally identifying learner details to the AI agent. Use non-identifying learner profile context only.
- Keep AI outputs child-safe, educational, and explainable. Teacher-facing AI insights must show the raw data or reason behind flags such as "requires immediate attention".
- Use model/API options that do not train on submitted learner data.

## Implementation Preferences
- Prefer small, demoable changes that map directly to a 720 requirement.
- Keep frontend changes framework-free unless the user explicitly approves a migration.
- For localization, prefer `shared/i18n.js`, locale JSON files, `data-i18n` attributes, `dir` on `<html>`, logical CSS properties, and backend prompt dictionaries keyed by language.
- Do not use `localStorage` or `sessionStorage` for learner profile, mapping results, dashboard cache, content progress, mentoring state, language preference, or AI memory. Use MongoDB-backed backend APIs.
- For Azure DevOps, use MCP tools when available. Link work items to the relevant 720 feature number and requirement clause.