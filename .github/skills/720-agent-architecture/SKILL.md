---
name: 720-agent-architecture
description: "Use when implementing or reviewing the yuvi-720 agentic system: the Shared Learning Brain / Context Engine, the six-agent model (Onboarding, Learning Coach, Pedagogical, Reflection, Teacher Insights, Safety), Microsoft Agent Framework orchestration, the floating learning companion, xAPI event ingestion into the brain, dashboard/teacher-view projection from real data, and replacing mock/LLM-invented data. Load alongside 720-delivery-requirements (feature scope) and 720-content-standards (content/metadata/xAPI shapes)."
argument-hint: "Describe the brain, agent, orchestration, context, xAPI ingestion, or mock-replacement task."
---
# 720 Agent Architecture

The canonical architecture lives in
[`docs/architecture/shared-learning-brain.md`](../../../docs/architecture/shared-learning-brain.md).
Treat that document as the source of truth. This skill is the fast index; open the doc for schemas,
sketches, sequence diagrams, phasing, and acceptance criteria.

## Core Idea
One AI mentor per student. Everything the system knows about a learner lives in a **single Learner
Brain document** in MongoDB keyed by a **non-identifying `learner_id`**. Specialized agents are
**stateless specialists** that read from and write to the brain — the brain is the only durable memory.
Surfaces (dashboards, teacher view, floating chat) render the brain, not mock data.

## The Six Agents ↔ 720 Features
- **Onboarding** → F2 mapping: writes `profile.activeness / interests / preferences / learning_style`.
- **Learning Coach** → F3 companion (25%): floating chat on every screen + proactive nudges; uses
  `profile.interests` and item `informationToBot` to relate to the student.
- **Pedagogical** → F1 delivery (20%): decides the next component/level; uses `recommendedAfterFail`.
- **Reflection** → self-reflection + F4 self-awareness: stores reflections + self vs system estimate.
- **Teacher Insights** → F6 teacher view (20%): explainable insights over real events; returns raw
  evidence behind every flag; group-scoped; no student comparison.
- **Safety** → cross-cutting gate on all learner-facing AI I/O: strips PII, enforces AI disclosure.
- **Context Engine (brain)** → F4 dashboard (15%): the shared memory all agents read/write.

## Non-Negotiables (enforce in code + review)
- The brain is keyed by a **pseudonymous** id; PII (name, school, ת"ז, contact, health, family, age)
  **never** enters an AI prompt. Agents receive only the non-identifying **Context bundle**.
- **Least-context access.** Each agent gets only its scoped brain view; write-back is validated against
  a per-agent allow-list (`context_engine.view_for(agent)` + `apply_writes`). Enforce in code, not just
  prompts. See the access matrix in the architecture doc §5.8.
- **Curriculum is data, not LLM invention.** "What to learn next" is a deterministic planner over the
  ordered `learning_objectives` spine + real `mastery` (doc §5.6). The LLM never sequences the syllabus.
  Math/science objectives and content come from the Ministry.
- **Chat persists.** After every Coach turn, extract durable, kid-safe signals (interests, preferences,
  self-reported difficulty, goals) into the brain with provenance + confidence (doc §5.7). Chat-sourced
  beliefs are *soft* (decay, hard event-facts win on conflict); **chat never sets mastery**.
- **Numbers are never invented.** Progress/mastery come from `learning_events` (xAPI); the LLM only
  phrases verbal, non-numeric, encouraging feedback for learners.
- **Every AI claim is traceable** to a brain field or a `learning_events` row (explainability for F6).
- **Localization is cross-cutting (he/ar/en).** Every learner- and teacher-facing string this
  architecture introduces (agent replies, proactive nudges, feedback, dashboard/teacher/mentoring
  labels, fallbacks) must be localized — Hebrew source, keys in all of `he.json`/`en.json`/`ar.json`.
  Language lives in `identity.locale` (MongoDB-backed, part of the Context bundle, passed to every AI
  call); backend prompts + fallbacks come from language-keyed dictionaries, never inline text; agents
  answer in `identity.locale` and must support Hebrew + Arabic. RTL for he/ar, LTR for en. See
  `.github/instructions/localization.instructions.md` and doc §11.1.
- Model access stays on **APIM**; Microsoft Agent Framework is the orchestration layer over it. Keep
  deterministic + JSON fallbacks so the demo runs without agent/Mongo/APIM infra (never the prod path).
- Prefer a **deterministic learning engine** (planner, triggers, mastery, aggregation) with LLM agents
  on top for language/empathy/adaptive judgment. Avoid over-agenting.
- Follow `720-content-standards` for content metadata, `informationToBot`, xAPI verbs, `slxapi` launch,
  iframe rules; follow `720-delivery-requirements` for feature scope and weights.

## Implementation Map (target)
- `backend/app/brain/` — `repository.py`, `context_engine.py`, `schema.py` (collection: `learners`).
- `backend/app/agents/` — `client.py` (Agent Framework over APIM), `tools.py`, one file per agent,
  `orchestrator.py` (pedagogical workflow + trigger engine).
- `backend/app/services/` — `events.py` (xAPI ingest), `dashboard.py` (brain projection), `insights.py`.
- Frontend — global `CompanionChat.tsx` mounted in `app/App.tsx`; surfaces read `/api/brain/*` and
  `/api/agent/*`; lesson iframe posts to `/api/xapi`.

## Mock-Replacement Checklist
- Remove `mock_data.MOCK_STUDENTS` once dashboard + teacher view read the brain.
- Replace `dashboard.generate-dashboard` invented numbers with `services/dashboard.py` projection.
- Move `learner_state.game_progress` → `learners.mastery` + `current_state` (enables real resume).
- Replace ad-hoc prompts inlining name+scores with the Context bundle + Safety gate.
- Keep the MoE-approved questionnaire instrument; move its interpretation into the Onboarding Agent.

## Procedure
1. Identify which agent(s) / brain fields / events the task touches.
2. Open the architecture doc section for that piece (§4 brain, §5 agents, §6 backend, §7 frontend,
   §8 xAPI, §9 mock replacement).
3. Implement against the contract table (§5.3): what the agent reads, writes, and its tools.
4. Verify non-negotiables above (privacy, no invented numbers, explainability, fallback).
5. Map the change to a 720 feature/clause and note demo evidence.
