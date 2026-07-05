# YuviLab 720 Agent Instructions

YuviLab 720 (Spark) is a Hebrew-first, AI-assisted learning platform for the Israeli Ministry of Education 720 program. The product supports personalized and adaptive learning, learner mapping, a student dashboard, a teacher/mentor view, mentoring goals, and an AI learning companion.

## Project Shape
- Backend: FastAPI in `backend/server.py`, with static frontend folders served directly. No Node build pipeline.
- Frontend: vanilla HTML/CSS/JavaScript, Three.js where needed, RTL Hebrew UI by default.
- AI: Azure OpenAI through APIM using `gpt-5-mini`, with fallback behavior when LLM calls fail.
- Data direction: MongoDB/Cosmos is planned/configured; much of the demo still uses mock data in `backend/mock_data.py`.
- Deployment: Docker to Azure App Service. Existing CI/CD is in `.github/workflows/deploy-spark.yml`; resource names include `rg-yuvi-720`, `ubi-yuvi-720`, and `yuvi720acr`.

## Important Folders
- `learner-mapping/`: initial learner mapping questionnaire and results flow.
- `learning-agent/`: learning/lesson/generator surfaces, including generated interactive lomda pages.
- `student-dashboard/`: student progress, profile, goals, strengths, challenges, and competencies.
- `teacher-view/`: teacher/mentor group and individual student insights.
- `mentoring/`: mentoring conversation surface.
- `shared/`: shared theme, robot assets, and future shared runtime code such as localization.
- `backend/`: API, LLM calls, static serving, mock data, and environment templates.

## 720 Program Priorities
- Target deadline: minimum 720 requirements by 30/07/2026.
- The highest-weight areas are learning agent / personal companion (25%), personalized content delivery (20%), and teacher view (20%).
- Use the `720-delivery-requirements` skill whenever planning roadmap, backlog, Azure DevOps work items, demos, proof videos, or feature coverage for the 30/07 deadline.
- Use the `720-content-standards` skill whenever authoring, reviewing, generating, importing, or instrumenting 720 content units, components, items, metadata, xAPI events, feedback, or adaptive routes.

## Language, Direction, and Tone
- Supported product languages: Hebrew (`he`, RTL), Arabic (`ar`, RTL), English (`en`, LTR).
- All new user-visible strings must be localizable. Hebrew is the source language unless the task explicitly says otherwise.
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
- For Azure DevOps, use MCP tools when available. Link work items to the relevant 720 feature number and requirement clause.