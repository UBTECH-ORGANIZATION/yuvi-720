# Yuvilab Spark — Shared Learning Brain Architecture

> Canonical architecture for the 720 agentic system. This is the source of truth for how the
> **Shared Learning Brain (Context Engine)**, the **Microsoft Agent Framework** agent layer, the
> **frontend surfaces**, and the **content + xAPI pipeline** fit together — and how we retire the
> current mock/LLM‑invented data to make the product "legit".
>
> Audience: engineers implementing yuvi-720, and the `.github` agent toolchain (`720-content-builder`
> agent + `720-*` skills) which must treat this document as the architecture baseline.
>
> Related: `.github/skills/720-agent-architecture/SKILL.md`,
> `.github/skills/720-delivery-requirements/SKILL.md`,
> `.github/skills/720-content-standards/SKILL.md`,
> `.github/instructions/content-authoring.instructions.md`.

---

## 0. TL;DR

We are building **one AI mentor per student**. Everything the system knows about a learner lives in a
single **Learner Brain** document in MongoDB, keyed by a **non-identifying learner id**. A team of
specialized agents (Microsoft Agent Framework) **read from and write to that brain** — they never hold
private state of their own. A floating **Learning Coach** companion is available on every screen, talks
to the student in their language, and *actually relates to them* because the brain feeds it interests,
strengths, struggles, goals, and live learning events. The dashboards, teacher view, and mentoring
surfaces render **the same brain**, not mock data.

```
Questionnaire ─┐
Learning events ─┤→  LEARNER BRAIN (Context Engine, MongoDB)  →  Agents  →  Surfaces (React + floating chat)
Mentoring goals ─┤        ▲ read / ▼ write                         │
Teacher notes ───┘        └─────────────── agents update the brain ┘
```

---

## 1. Vision & the picture

The reference diagram ("720 LEARNING SYSTEM — A team of AI agents. One shared brain. Every student.")
defines six agents orbiting a central **Shared Learning Brain — The Context Engine**, over a
**Shared Context Memory** of: Student Profile, Goals, Progress, Learning History, Strengths,
Challenges, Preferences.

That picture maps 1:1 onto the 720 minimum requirements:

| Diagram agent | Purpose (from diagram) | 720 feature it satisfies | Weight |
|---|---|---|---|
| **1. Onboarding Agent** | Understands the student as a unique learner | F2 Initial learner mapping → seeds the brain | 5% |
| **2. Learning Coach Agent** | Guides, explains, supports in real time | F3 Learning agent / personal companion (floating chat, proactive) | 25% |
| **3. Pedagogical Agent** | Decides what to teach next; adapts content, level, approach | F1 Personalized learning item delivery (adaptive routing) | 20% |
| **4. Reflection Agent** | Helps the student reflect, build self‑awareness, deepen learning | Additional req: self‑reflection; F4 self‑awareness competency | (F4) |
| **5. Teacher Insights Agent** | Turns learning data into clear, actionable insights | F6 Teacher view (explainable, group + student) | 20% |
| **6. Safety Agent** | Ensures a safe, respectful, appropriate environment | AI‑use rules, privacy, student welfare (cross‑cutting) | gate |
| **Context Engine (brain)** | Shared memory read/written by all agents | F4 Student dashboard (renders the brain) | 15% |

Mentoring goals (F5, 10%), feedback (F7, 3%), and org/permissions (F8, 2%) are **brain‑adjacent
services** that write into or scope the brain.

**Design law:** agents are *stateless specialists*. The **only** durable memory is the Learner Brain.
This is what makes the mentor coherent across screens and sessions, and what makes every AI claim
explainable (we can always point at the brain field / event that produced it).

---

## 2. Current state audit (grounded in the repo)

### 2.1 What exists today

**Backend** (`backend/`):
- `server.py` — FastAPI bootstrap, includes 6 routers + static React mount.
- `app/services/llm.py` — **direct HTTP** call to Azure OpenAI through APIM (`call_llm`,
  `call_llm_stream`). No agent framework, no tools, no orchestration.
- `app/routes/learner_mapping.py` — `/api/questionnaire`, `/api/submit` → scores via
  `mock_data.calculate_scores` and persists `mapping_results`.
- `app/routes/profile.py` — `/api/analyze-profile`, `/api/results-chat` (per‑request prompt with
  scores inlined; can emit `score_updates`).
- `app/routes/dashboard.py` — `/api/generate-dashboard` (**LLM invents** subjects, progress numbers,
  goals, competencies) + `MOCK_STUDENTS` fallback.
- `app/routes/mapping_chat.py` — `/api/section-summary(-stream)`, `/api/mapping-chat(-stream)`.
- `app/routes/learning_content.py` — `/api/create-lomda-stream` → one‑shot self‑contained HTML game,
  **not instrumented** (no xAPI, no metadata, no routing).
- `app/routes/learner_state.py` — `/api/learner-state` GET/PATCH.
- `learner_state.py` — MongoDB collection `learner_state`, fields:
  `language, mapping_results, profile_cache, dashboard_cache, game_progress` (+ JSON fallback).
- `mock_data.py` — `QUESTIONNAIRE`, `DIMENSIONS`, `MOCK_STUDENTS`, `calculate_scores`,
  `generate_insights`, `generate_recommendations`.

**Frontend** (`frontend/src/`):
- Vite + React + TS. Manual routing (`app/router.tsx`, `app/App.tsx`).
- Features: `learner-mapping`, `results`, `student-dashboard`, `teacher-view`, `mentoring`,
  `learning-portal`, `learning-lesson`, `learning-create`.
- `services/api.ts` — `apiGet/Post/Patch`, `streamPost` (SSE), `getLearnerState/updateLearnerState`.
- **No floating companion**, no proactive nudges, no xAPI posting, no WebSocket.

### 2.2 The honest gap list

| # | Gap | Consequence |
|---|---|---|
| G1 | **No unified brain.** State is fragmented into `mapping_results / profile_cache / dashboard_cache / game_progress`. | Agents can't share memory; the "mentor" forgets across screens. |
| G2 | **No agent layer / orchestration.** Each route hand‑builds a prompt and calls `call_llm`. | No tools, no proactivity, no handoff, no Safety gate, hard to evolve. |
| G3 | **Dashboards & teacher view are invented.** `generate-dashboard` asks the LLM to make up progress numbers; teacher view uses `MOCK_STUDENTS`. | Not real, not explainable, violates F4/F6. |
| G4 | **No learning‑event stream.** Lomdot are not instrumented; there is no xAPI ingestion. | Nothing feeds the brain from actual learning → F1/F3/F6 impossible for real. |
| G5 | **No content model.** No content units/components/items/metadata in DB; `create-lomda-stream` is a toy. | No adaptive routing, no `recommendedAfterFail`, no `informationToBot`. |
| G6 | **No proactive companion.** No idle / misconception / success triggers, not on every screen. | F3 core behavior missing. |
| G7 | **No mentoring, groups, permissions, or feedback persistence.** | F5/F6/F7/F8 unmet. |
| G8 | **Privacy boundary not enforced in code.** Prompts inline learner name + scores directly. | Must route all AI I/O through a non‑identifying Context bundle + Safety gate. |

This document defines the target that closes G1–G8.

---

## 3. Target architecture (layers)

```mermaid
flowchart TB
  subgraph Surfaces["Frontend surfaces (React + TS)"]
    MAP["Learner mapping"]
    DASH["Student dashboard"]
    LESSON["Lesson (iframe lomda)"]
    TEACH["Teacher view"]
    MENT["Mentoring"]
    COACH["★ Floating Learning Coach (every screen)"]
  end

  subgraph API["FastAPI (backend/app)"]
    RB["/api/brain/*"]
    RA["/api/agent/* (coach, reflect, insights)"]
    RX["/api/xapi (+ slxapi launch)"]
    RM["/api/mentoring/*, /api/feedback, /api/orgs/*"]
  end

  subgraph Agents["Agent layer — Microsoft Agent Framework (backend/app/agents)"]
    ON["Onboarding"]
    PE["Pedagogical"]
    CO["Learning Coach"]
    RE["Reflection"]
    TI["Teacher Insights"]
    SA["Safety (gate on all learner I/O)"]
    ORCH["Orchestrator + Trigger engine"]
  end

  subgraph Engine["Context Engine (backend/app/brain)"]
    CTX["Context assembler (non‑identifying bundle)"]
    UPD["Brain updater (write‑back)"]
  end

  subgraph DB["MongoDB / Cosmos"]
    BRAIN[("learners — THE BRAIN")]
    EVT[("learning_events")]
    CU[("content_units / components / items")]
    MENTC[("mentoring_conversations")]
    ORG[("schools / teachers / groups / enrollments")]
    FB[("feedback_reports")]
    SESS[("agent_sessions")]
  end

  Surfaces --> API
  COACH <-->|SSE stream + proactive push| RA
  LESSON -->|events| RX
  API --> Agents
  Agents <--> Engine
  Engine <--> DB
  RX --> EVT --> ORCH
  ORCH --> CO & PE & RE & TI
  Agents -->|LLM via APIM gateway| LLM[["Azure OpenAI (APIM, gpt-*)"]]
  SA -. screens .- CO
  SA -. screens .- RE
```

Four layers, top to bottom:

1. **Surfaces** — React features + the always‑present floating Coach.
2. **API** — thin FastAPI routers (validate, authorize, delegate). No prompt logic here.
3. **Agent layer** — Microsoft Agent Framework agents + orchestrator + trigger engine.
4. **Context Engine + DB** — the brain, the event log, the content model, and supporting collections.

---

## 4. The Learner Brain (Context Engine) — single source of truth

### 4.1 Identity & privacy boundary

- The brain is keyed by **`learner_id`** — a **pseudonymous** id (the "מעורבל" id from unified sign‑in),
  never the real ת"ז.
- The brain stores a **display name** (`identity.display_name`) for *UI only*. The name and any PII
  **never** enter an AI prompt. Agents receive only the **Context bundle** (§4.4), which excludes name,
  school, contact, health, family, age.
- All AI calls go through the **Safety Agent gate** and use a model API declared not to train on
  submitted data (720 AI‑use rule).
- **Who is asking matters as much as who it's about.** Sessions arrive from unified sign‑in with a
  **role** (student / teacher / admin) and group claims. The API layer resolves role → permitted
  routes, and F8 scoping (groups/enrollments) is applied **server‑side before any brain read**. Agents
  never make authorization decisions — by the time an agent runs, its view is already scoped (§5.8).

### 4.2 Collection: `learners` (the brain document)

```jsonc
{
  "_id": "learner_pseudo_9f13c",          // pseudonymous id (key)
  "identity": {                           // UI-only, NEVER sent to AI
    "display_name": "נועה",
    "grade": "ז",
    "locale": "he"                        // he | ar | en  (product language, MongoDB-backed)
  },

  // ── F2 Onboarding output (written by Onboarding Agent) ──
  "profile": {
    "activeness": {                       // the 6 MoE פעלנות components (0-100 internal, never shown)
      "motivation_relevance": 78,
      "growth_mindset": 64,
      "initiative_responsibility": 71,
      "self_regulation": 55,
      "self_awareness": 69,
      "support_emotional": 73
    },
    "mapping_scores": { /* academic / psycho_pedagogical / environmental sub-scores */ },
    "learning_style": "hands-on, short bursts, immediate feedback",
    "interests": ["כדורגל", "משחקי מחשב", "חלל"],   // ← powers relatable examples
    "preferences": ["independent_first", "visual_explanations"],
    "environment": "quiet, prefers digital",
    "source": "mapping+coach",            // provenance for explainability
    "updated_at": "2026-07-05T10:00:00Z"
  },

  // ── F4 dashboard is a projection of these ──
  "strengths": [ { "label": "סקרנות", "evidence_ref": "evt_...", "since": "..." } ],
  "challenges": [ { "objective_id": "math-angles-vertical", "label": "זוויות קודקודיות",
                    "evidence_ref": "evt_...", "status": "working" } ],

  // ── F1/F6 curriculum progress from real events (NOT invented) ──
  "mastery": {
    "math-angles-vertical": { "level": "intermediate", "achieved": false,
                              "last_score": 0.5, "attempts": 3, "misconceptions": ["adjacent_vs_vertical"] }
  },
  "progress": {                          // per-subject rollup of `mastery` (math + science for תשפ"ז)
    "math":    { "objectives_total": 24, "objectives_mastered": 9 },
    "science": { "objectives_total": 18, "objectives_mastered": 4 }
  },

  // ── planner output cache (§5.6) — recomputed on new events, never hand-edited ──
  "next_recommendations": { "math": ["obj-frac-add", "obj-frac-sub"], "science": ["obj-cells-1"],
                            "computed_at": "..." },

  // ── F5 goals (mirrored from mentoring_conversations, learner-visible ones) ──
  "goals": [ { "id": "goal_..", "text": "לתרגל ריכוז 10 דק'", "deadline": "2026-07-20",
               "source": "mentoring", "status": "open", "visible_to_learner": true } ],

  // ── F6 teacher-authored guidance — HIGH precedence for agent DECISIONS, never for mastery numbers (§5.7) ──
  "teacher_directives": [ { "id": "td_..", "text": "תן יותר דוגמאות חזותיות בשברים",
                            "scope": "objective:math-frac-add", "priority": "high", "author": "teacher",
                            "group": "group_7A_math", "visible_to_learner": false,
                            "created_at": "...", "expires_at": null } ],

  // ── Reflection Agent output — the FULL log lives in the `reflections` collection (R2);
  //    the brain embeds only the recent window used for bundle assembly ──
  "reflections_recent": [ { "prompt_id": "..", "answer": "..", "self_rating": 3, "at": "..",
                            "system_estimate": 0.5 } ],   // last N; self vs system comparison

  // ── live "where am I" state for resume + coach context ──
  "current_state": {
    "unit_id": "YuviDori-math-angles-0001",
    "component_id": "YuviDori-math-angles-0001-00003",
    "item_id": "...-00003-00002",
    "resume_token": { /* opaque, lets us resume mid-task without save/submit (F1.6) */ },
    "pace": "on_track"                    // on_track | ahead | behind
  },

  // ── agent working notes (short, non-identifying, human-readable scratch observations) ──
  "agent_notes": [ { "agent": "coach", "note": "responds well to sports analogies", "at": "..." } ],

  // ── procedural memory: consolidated "what works for THIS learner" (promoted by §5.7 consolidator) ──
  "strategies": [ { "note": "sports analogies land well", "confidence": 0.8,
                    "evidence_refs": ["evt_...", "chat_..."], "last_seen": "..." } ],

  "enrollments": ["group_7A_math"],       // F8 scoping
  "created_at": "...", "updated_at": "..."
}
```

> The old `learner_state` fields collapse into this: `mapping_results → profile.mapping_scores`,
> `profile_cache → profile`, `dashboard_cache →` computed on read (no cache of invented data),
> `game_progress → mastery / current_state`, `language → identity.locale`.

### 4.3 Supporting collections

- **`learning_events`** — append‑only xAPI‑shaped events (§8). The *raw evidence* for everything.
- **`learning_objectives`** — the **curriculum spine** (the MoE syllabus as data): topic → sub‑topic →
  objective, with `subject`, `order` (linear within a sub‑topic — you cannot do an objective before the
  one before it), and `prerequisites[]`. This is what the planner walks to decide *what to learn next*
  (§5.6). For **math/science the objectives and their content come from the Ministry**, not the
  provider — the platform routes over the approved catalog.
- **`content_units` / `content_components` / `content_items`** — 720 content model + metadata
  (`informationToBot`, `masteryLevel`, `relativeDifficulty`, `recommendedAfterFail`,
  `prerequisiteLearningObjective`, `questions[]`, `isAssessment` …). See content‑standards references.
- **`mentoring_conversations`** — F5 (date, teacher, learner, meeting stage, notes, next steps,
  deadline, visibility, `author` = teacher|learner, `teacher_only` notes).
- **`reflections`** — the full reflection log; the brain embeds only `reflections_recent` (last N).
  The brain is a **projection, not a log** (R2) — this is the rule applied, not just stated.
- **`schools` / `teachers` / `groups` / `enrollments`** — F8 entities + permission scoping for F6.
- **`feedback_reports`** — F7 technical issue + UX reports (in‑ and out‑of‑system).
- **`agent_sessions`** — per‑learner conversation/thread state for the Agent Framework, keyed by
  **`{ learner_id, session_id, role }`** (working memory: last N turns + rolling summary + entity
  ledger); lets the Coach resume a chat exactly where the learner left off on return — no `localStorage`,
  all in Mongo.

### 4.4 The Context bundle (what agents actually see)

The Context Engine assembles a **non‑identifying** bundle on demand. Shown here is the **Coach view**
— there is no single universal bundle; §5.8 defines the exact projection each agent role receives:

```jsonc
{
  "profile": { "activeness": {...}, "learning_style": "...", "interests": [...], "preferences": [...] },
  "strengths": [...], "challenges": [...],
  "goals": [ {"text": "...", "deadline": "..."} ],
  "current": { "objective_id": "math-angles-vertical", "unit_title": "זוויות",
               "informationToBot": "מטרת הפריט: ... טעויות נפוצות: ...",  // from item metadata
               "recent_events": [ {"verb":"answered","success":false,"misconception":"..."} ] },
  "locale": "he"
}
```

- Contains **no** name/PII. `informationToBot` (from content metadata) is the bridge that lets the Coach
  give item‑specific help; `recent_events` let it detect struggle.
- Everything the mentor "knows about him" is here: interests → relatable examples; challenges + recent
  events → targeted help; goals → motivation; locale → language.

**Assembly rules (context engineering, not just data access):**

- **Token budget first.** Every bundle section has a fixed budget allocated *before* retrieval
  (profile summary ≤ N tokens, `recent_events` = last K, one active goal, …). Retrieval **fills a
  budget**; it never grows the prompt. This prevents the classic failure mode where memory gradually
  starves instructions and reasoning space.
- **Placement matters.** Hard rules and safety constraints render at the **top** of the prompt; the
  *current item* (`informationToBot`) and `recent_events` render **last**, closest to the generation
  point — mitigating the "lost in the middle" attention dip on mid‑context content.
- **Delimited blocks.** Brain‑derived content is wrapped in explicit delimiters
  (`<learner_context>…</learner_context>`) and declared as *data, not instructions* — cheap
  defense‑in‑depth against prompt injection via chat or content metadata (R7).
- **Precedence.** Current user message > session working memory > durable semantic memory. On
  contradiction the fresher scope wins at *read* time; durable *writes* are reconciled only by the
  consolidator (§5.7), never mid‑conversation.

### 4.5 Memory model — four memory types over one brain

The brain document + its supporting collections implement the four standard agentic memory types.
The taxonomy decides **where a fact lives, how it is retrieved, and when it decays** — instead of one
undifferentiated blob:

| Type | What it holds here | Backing store | Retrieval | Lifecycle |
|---|---|---|---|---|
| **Working** | `current_state` + the live Coach session: last 6–10 turns verbatim, a **rolling summary** (fixed size, regenerated), and a small **entity ledger** of session facts | brain + `agent_sessions` | injected every call | session‑scoped; trimmed continuously, summary absorbs what falls off |
| **Episodic** | `learning_events`, `reflections`, mentoring history — everything that *happened* | append‑only collections | queried by objective/recency (never injected wholesale) | permanent evidence; old tails compressed into summaries |
| **Semantic** | `profile.*`, `mastery`, `strengths/challenges`, `goals` — stable facts about the learner | brain document | field projection through agent scopes (§5.8) | updated only via events + consolidation; soft facts decay (§5.7) |
| **Procedural** | `strategies[]` — *what works for this learner* ("sports analogies land", "video after fail beats re‑reading") | brain document | injected into Coach/Pedagogical bundles | promoted from repeated evidence; confidence‑weighted |

The split fixes two concrete problems in the old sketch: the Coach session is no longer a raw capped
transcript (recent turns + rolling summary + entity ledger answer "what did we talk about?" without
replaying everything), and learned teaching tactics get a first‑class, consolidated home instead of
living informally inside `agent_notes`.

---

## 5. Agent layer (Microsoft Agent Framework)

### 5.1 Why Agent Framework here

Today `llm.py` is a bare HTTP call. We adopt **Microsoft Agent Framework** (`agent-framework`) to get:
- first‑class **agents with tools** (function tools that read/write the brain),
- **sessions/threads** (continuity across turns and sessions),
- **orchestration** (workflow for the pedagogical loop; handoff/router for the coach),
- a natural place to insert the **Safety gate** and the **non‑identifying Context bundle**,
- **`ContextProvider` hooks (`before_run` / `after_run`)** — the framework‑native seam where the
  Context Engine plugs in: scoped bundle **injection** before every model call and memory‑candidate
  **capture** after it (§5.4, §5.7). No per‑route hand‑rolled prompt assembly.
- **`HistoryProvider`** — pluggable chat‑history persistence. We back it with `agent_sessions`
  (Mongo), and add a second **write‑only audit provider** (`store_context_messages=True`) that records
  *exactly what context each agent saw* per invocation — explainability (§11) as infrastructure, not
  as an afterthought. (Rule: exactly **one** history provider has `load_messages=True`, so history is
  never replayed twice into the same call.)

**Model access stays on APIM.** The APIM endpoint is Azure OpenAI‑compatible, so we point the Agent
Framework chat client at it (base URL + `api-key`/`Ocp-Apim-Subscription-Key` header, api‑version from
env — same values `llm.py` already resolves). `call_llm` / `call_llm_stream` remain as the **fallback**
path and for simple non‑agent endpoints, so the app stays demoable without agent infra.

```python
# backend/app/agents/client.py  (sketch — integrates Agent Framework with the existing APIM config)
from agent_framework.azure import AzureOpenAIChatClient
from app.services.llm import _resolve_llm_config   # reuse APIM endpoint/key/deployment/api_version

def build_chat_client() -> AzureOpenAIChatClient | None:
    endpoint, key, deployment, api_version = _resolve_llm_config()
    if not endpoint or not key:
        return None                                  # → callers fall back to call_llm()
    return AzureOpenAIChatClient(
        endpoint=endpoint, api_key=key,
        deployment_name=deployment, api_version=api_version,
    )
```

> If a given Agent Framework version cannot target APIM directly, wrap the existing `call_llm` in a
> thin custom chat client so agents/tools work unchanged while model traffic keeps flowing through APIM.
> The agent *definitions, tools, and orchestration in this doc do not change* either way.

### 5.2 Proposed backend package

```
backend/app/
  brain/
    schema.py           # dataclasses/Pydantic for the brain + collections
    repository.py       # async Mongo access (source of truth) + JSON fallback
    context_engine.py   # assemble non-identifying Context bundle; write-back updates
    consolidator.py     # memory lifecycle: dedupe, conflict resolution, decay, promotion (§5.7)
  agents/
    client.py           # Agent Framework chat client over APIM (+ fallback flag)
    providers.py        # MAF ContextProvider/HistoryProvider bridges to the brain (§5.4)
    tools.py            # function tools = brain read/write, content lookup, event queries
    onboarding.py       # Onboarding Agent
    pedagogical.py      # Pedagogical Agent (next-content decision)
    coach.py            # Learning Coach Agent (floating chat + proactive)
    reflection.py       # Reflection Agent
    teacher_insights.py # Teacher Insights Agent (explainable)
    safety.py           # Safety Agent (gate + PII strip + AI disclosure)
    orchestrator.py     # workflow wiring + trigger engine
  services/
    llm.py              # existing APIM gateway (fallback + simple calls)
    events.py           # xAPI ingest (idempotent, §8.2) + normalization → learning_events
    planner.py          # deterministic curriculum planner (§5.6) — subject + next objective
    dashboard.py        # PROJECT brain → dashboard DTO (replaces LLM-invented numbers)
    insights.py         # deterministic aggregations behind Teacher Insights
```

### 5.3 The six agents (contract table)

Each agent: **reads** part of the brain (via Context bundle / tools), **produces** an output, and
**writes back** specific brain fields. Agents never write PII; all learner‑facing text passes the
Safety gate.

| Agent | Trigger | Reads | Writes to brain | Key tools |
|---|---|---|---|---|
| **Onboarding** | Mapping submitted (F2) | `mapping_scores` | `profile.activeness`, `interests`, `preferences`, `learning_style`, initial `strengths/challenges` | `get_mapping`, `write_profile`, `set_interests` |
| **Pedagogical** | Learner enters/finishes a component (F1) | `mastery`, `current_state`, content metadata | `current_state`, `mastery` snapshot, route decision | `get_brain`, `list_candidate_components(objective, mastery)`, `select_next`, `record_route` |
| **Learning Coach** | Floating chat message **or** proactive trigger (F3) | Context bundle + `informationToBot` + `recent_events` | `agent_notes` (scratch); **staged** memory candidates → consolidator (§5.7) | `get_context`, `get_item_info`, `offer_hint`, `log_interaction`, `stage_memory_candidate` |
| **Reflection** | After hard task / schedule / idle recovery | `mastery`, recent events | `reflections` (+ `self_rating` vs `system_estimate`) | `get_reflection_prompt`, `store_reflection` |
| **Teacher Insights** | Teacher opens view / real‑time (F6) | brain + `learning_events` + group | *nothing in learner brain*; returns explainable insights | `aggregate_group`, `flag_attention(reason, raw_evidence)`, `recommend_actions`, `explain_flag` |
| **Safety** | Every learner‑facing AI in/out | message + policy | may append `agent_notes` on escalation | `screen_input`, `screen_output`, `strip_pii`, `assert_ai_disclosure` |

**Two write lanes (keeps §5.7 honest):** tools may write **directly** only to scratch/append fields
(`agent_notes`, interaction logs, `reflections`) and to working state owned by that agent
(`current_state` for the Pedagogical agent). Anything that changes the **durable picture of the
learner** — `profile.*`, `strategies`, `challenges` — is *staged* by the capture step and applied only
by the consolidator (§5.7). Exception: the **Onboarding agent seeds `profile` directly** — it runs once,
from deterministic questionnaire scores, before any conversational memory exists. The §5.8 allow‑lists
encode exactly this split.

**Coach ⇄ Pedagogical split (important):** the **Coach** talks and supports *inside the current item*;
the **Pedagogical** agent decides *which item/component comes next*. The Coach can *ask* the Pedagogical
agent for an alternative representation (e.g. video instead of text) when it detects a misconception —
this is the `recommendedAfterFail` path in content metadata.

### 5.4 Agent sketch (Coach) — how "it really relates to the student"

```python
# backend/app/agents/coach.py (sketch)
COACH_INSTRUCTIONS = """
אתה "יובי", מלווה למידה של תלמיד/ה בכיתות ז'–ט'. ענה בשפת המוצר (locale).
- דבר חם, מכבד, לא ילדותי, קצר (1–3 משפטים).
- השתמש בתחומי העניין של התלמיד/ה מ-context.profile.interests כדי לתת דוגמאות שמתחברות אליו/אליה.
- אם recent_events מראים כישלון חוזר/תפיסה שגויה — הצע ייצוג אחר או רמז ממוקד, אל תיתן את התשובה מיד.
- אם התלמיד/ה מתוסכל/ת — עודד, נרמל את הקושי, הצע צעד קטן.
- לעולם אל תמציא עובדות על התלמיד/ה; הסתמך רק על ה-context.
- שקיפות: המערכת כבר יידעה שמדובר ב-AI; אל תתחזה לאדם.
"""

# backend/app/agents/providers.py (sketch) — the brain plugs into MAF hooks, not into each route
class BrainContextProvider(ContextProvider):
    """Per-agent-role scoped memory bridge (one instance per role)."""
    def __init__(self, role: str):                       # "coach" | "pedagogical" | ...
        super().__init__(f"brain_{role}")
        self.role = role

    async def before_run(self, *, agent, session, context, state) -> None:
        # INJECT: scoped view (§5.8), budgeted + placed + delimited (§4.4)
        bundle = await context_engine.build_bundle(state["learner_id"], view=self.role)
        context.extend_instructions(self.source_id, render_bundle(bundle))

    async def after_run(self, *, agent, session, context, state) -> None:
        # CAPTURE: distill memory candidates; staging only — never direct writes (§5.7)
        candidates = extract_memory_candidates(context)
        await context_engine.stage_candidates(state["learner_id"], self.role, candidates)


# backend/app/agents/coach.py (sketch) — memory is provider wiring, not route logic
def build_coach() -> Agent:
    return Agent(
        client=build_chat_client(),                      # APIM-backed (§5.1)
        name="coach",
        instructions=COACH_INSTRUCTIONS,                 # from PROMPTS[locale] (§11.1)
        tools=[offer_hint, log_interaction, update_profile_signal],
        context_providers=[
            MongoHistoryProvider("agent_sessions", load_messages=True),   # WORKING memory:
                                                         #   last N turns + rolling summary + entity ledger
            BrainContextProvider("coach"),               # SEMANTIC + PROCEDURAL memory, coach-scoped
            AuditHistoryProvider("agent_audit",          # exactly-what-the-agent-saw, write-only,
                                 store_context_messages=True),  # fuels explainability (§11)
        ],
    )

async def run_coach(learner_id, user_message=None, trigger=None):
    agent = build_coach()
    session = await agent_sessions.session_for(learner_id, "coach")
    prompt = user_message or PROACTIVE_PROMPTS[trigger]  # idle / misconception / success
    return await safety.gated(agent.run)(prompt, session=session,   # Safety wraps in/out
                                         state={"learner_id": learner_id})
```

Because `ctx.profile.interests` and `ctx.current.informationToBot` are always injected, the Coach can
say things like *"זוכר את הזווית בבעיטת קרן בכדורגל? זו זווית קודקודית — שווה לזו שממול"* — real
personalization, powered by the brain, not a generic tutor.

### 5.5 Orchestration & the trigger engine (proactivity — F3.5)

```mermaid
sequenceDiagram
  participant L as Lesson iframe
  participant X as /api/xapi
  participant E as learning_events
  participant T as Trigger engine
  participant C as Coach agent
  participant S as SSE push → floating chat

  L->>X: answered {success:false, misconception:"adjacent_vs_vertical"}
  X->>E: append event
  E-->>T: notify
  T->>T: 3rd consecutive fail on same objective → "misconception"
  T->>C: run_coach(trigger="misconception")
  C-->>S: proactive nudge + alt representation offer
  Note over T: also fires on idle (no mouse/scroll/input) and on effort/success
```

Triggers (minimum set, all from real events):
- **Idle in task** — no `answered`/interaction for N seconds → gentle hint offer.
- **Misconception** — K consecutive fails on the same `learningObjective` → alternative representation
  (delegates to Pedagogical for `recommendedAfterFail`).
- **Effort / success** — complex component completed, or improvement after a fail streak, or long work
  streak → short positive reinforcement.

Orchestration shape:
- **Pedagogical loop** → an Agent Framework **workflow** (enter component → observe events → decide next
  → update `current_state`/`mastery`).
- **Coach** → event/chat‑driven, single agent with tools + session; may **hand off** to Reflection
  (after hard task) or request a route from Pedagogical.
- **Teacher Insights** → invoked by teacher view; read‑only over brain + events, returns explainable
  payloads. It also **receives live signals** (`emit_teacher_signal` from Reflection / the trigger
  engine) and **pushes real‑time alerts** (`push_live_alert`) to the teacher portal while the learner is
  connected — "passed an objective", "consecutive failures", "gone idle" — each carrying its raw evidence.
- **Safety** → a wrapper/gate, not a conversational node; wraps every learner‑facing in/out.
  **Tiered, so it doesn't double cost/latency (R4): tier 1 is deterministic** (PII patterns,
  blocklists, disclosure/format checks) and runs synchronously on *every* message; **tier 2 (LLM
  screening) runs only** when tier 1 flags, on proactive nudges, and on a random sample — never as a
  blanket second model call per turn.

**Runtime shape (honest for P1–P4):** ingest → trigger evaluation → SSE push all run **in‑process**
(single App Service instance): an asyncio queue plus per‑session idle timers. That is fine for the
pilot; it does **not** survive scale‑out (an event landing on worker A cannot push to a learner whose
SSE socket lives on worker B). The seam is isolated in `events.py` + the push channel: scaling out
swaps in Mongo change streams / Azure Service Bus and a shared pub‑sub, with **zero change** to agent
or brain contracts. (Risk R15.)

### 5.6 Curriculum planning — how the mentor knows *what to teach next*

This is the question "what learning do I need, and in which subject?". The answer must be **deterministic
and curriculum‑driven — the LLM never invents the syllabus or the sequence.** The plan is a function of
three data sources, not a guess:

1. the **`learning_objectives`** spine (ordered, with prerequisites) — for math/science this catalog is
   supplied by the Ministry;
2. the learner's **`mastery`** in the brain (what is already achieved, from real events);
3. the learner's **goals + profile** (mentoring goals, interests) — used only to *rank/engage*, never to
   reorder the curriculum illegally.

**Two layers, clean split:**
- **Planner (deterministic, code — `services/planner.py`)** chooses the *subject + objective*.
- **Pedagogical Agent** chooses the *content unit → component → representation* within that objective
  (by `masteryLevel`, `relativeDifficulty`, `recommendedAfterFail`), and phrases it.
- **Content availability is exposed as an MCP tool server** (`content-catalog`). The Pedagogical Agent
  does not hold the catalog: it **calls a tool** — `list_available_content(objective, mastery, locale,
  difficulty)` — that returns the approved components the platform can currently serve, then selects one
  by rules + memory context. The planner still owns the *sequence*; the MCP server owns *what is
  available*; the agent owns *which of the available fits this learner now*. (This is the same seam that
  later lets an external content provider expose its catalog over MCP without changing the agent.)

```python
# services/planner.py (sketch) — "what next", scoped to enrolled subjects e.g. ["math","science"]
def plan_next(brain, subjects):
    plan = {}
    for subject in subjects:                      # only MoE-approved subjects the learner is enrolled in
        objectives = curriculum.ordered(subject)  # linear spine from learning_objectives
        frontier = [o for o in objectives
                    if prerequisites_met(o, brain.mastery)   # can't skip ahead
                    and not mastered(o, brain.mastery)]      # not done yet
        # rank the frontier: due reviews (weak/decaying mastery) first, then curriculum order;
        # interests only break ties (pick the objective with a more engaging available unit)
        frontier.sort(key=lambda o: (review_due(o, brain), o.order, -interest_fit(o, brain)))
        plan[subject] = {
            "next": frontier[:3],                  # what to learn next
            "mastered": count_mastered(subject, brain.mastery),
            "total": len(objectives),
        }
    return plan   # cached into brain.next_recommendations; rendered by dashboard + coach + teacher view
```

```mermaid
flowchart LR
  S[Enrolled subjects\n(math, science)] --> C[learning_objectives spine]
  C --> F{For each objective:\nprereqs mastered?\nnot yet mastered?}
  F -->|yes| FR[Frontier]
  M[brain.mastery] --> F
  FR --> R[Rank: due reviews → order → interest tie-break]
  G[goals + interests] --> R
  R --> N[next_recommendations]
  N --> PED[Pedagogical Agent picks unit/component]
  N --> DASH[Dashboard \"what's next\"]
  N --> TV[Teacher \"progress vs objectives\"]
```

The **same plan object** feeds three surfaces so they never disagree: the learner's "what's next", the
dashboard curriculum list (F4), and the teacher's progress‑vs‑objectives view (F6). Because it is
computed from the objective graph + real mastery, it is fully **explainable** ("next = fractions because
you mastered its prerequisite and it's the earliest unmastered objective in the sub‑topic").

> Cold start (new learner, empty `mastery`): the planner returns the first objective of each enrolled
> subject; the Coach leans on `interests` from onboarding for engagement until events accrue.

### 5.7 Memory lifecycle — capture → validate → consolidate → inject

When the student talks to Yuvi, the mentor must **remember** what it learns — "I actually love
basketball, not football", "fractions confuse me", "I study better at night". But raw capture alone
**rots**: duplicates pile up, stale beliefs linger, chat contradicts events. So memory is a managed
**pipeline**, not a side effect of chatting:

```
① CAPTURE     (after_run hook)   Coach turn → extract_memory_candidates(transcript_delta)
                each: { field, value, confidence, evidence_quote, source:"chat", ttl? }
                types: interest_add/remove · preference · self_reported_difficulty ·
                       misconception_hint · emotional_signal · goal_mention · strategy_worked
② VALIDATE    (sync)             Safety gate (PII / off-limits) + per-agent write allow-list (§5.8);
                low-confidence candidates → staged as *pending*, never applied directly
③ CONSOLIDATE (async job)        session-end + nightly (brain/consolidator.py):
                dedupe near-identical facts · resolve conflicts (hard beats soft, then recency) ·
                decay unreaffirmed soft facts (confidence × time) · expire TTL ·
                compress episodic tails into rolling summaries ·
                PROMOTE stable repeated soft facts → structured profile/strategies fields
④ INJECT      (before_run hook)  next bundle renders the consolidated view —
                budgeted, placed, delimited per §4.4
```

Rules that keep this safe and correct:
- **Soft vs hard knowledge.** Chat‑sourced beliefs are **soft** (`source:"chat"`, `confidence`,
  `last_seen`); event‑sourced facts are **hard**. On conflict, **hard wins**; unreaffirmed soft interests
  **decay**. This prevents the mentor from being talked into a wrong picture of the learner.
- **Teacher directives outrank both — for *decisions* only.** A teacher‑authored `teacher_directives`
  entry (from the teacher portal) is injected at **top precedence when an agent decides what to offer or
  how to frame it** (Pedagogical routing, Coach tone/examples). Precedence for decisions is therefore
  **teacher directive > hard event‑fact > soft chat**. It **never overrides `mastery`/`progress` numbers**
  — those come *only* from `learning_events`; a teacher steers *choices*, not *measurements*. Directives
  carry `scope`, `priority`, and optional `expires_at`, and are visible in the audit trail like any other
  injected context.
- **Chat never sets mastery.** "I get it" is at most a `Selected/isUnderstood` signal, not proof — only
  `answered/completed` events move `mastery`. (Otherwise a student could talk their way to "mastered".)
- **Privacy + safety.** Drop anything PII or off‑limits (health, family, contact); low‑confidence
  candidates are stored as pending, not applied. Only the distilled candidates enter the brain; the raw
  transcript stays capped in `agent_sessions` (working memory: last N turns + rolling summary).
- **Provenance for explainability.** Every captured field keeps its `evidence_quote`, so a teacher/dev
  can see *why* the brain believes it.
- **Consolidation is the only promoter.** Capture may only *stage*; the consolidator is the **single
  writer** that upgrades soft → structured. One writer means no races between agents "discovering"
  profile facts mid‑conversation, and stable notes graduate into schema fields over time instead of
  accumulating as free text.

> Pattern sources: OpenAI Agents SDK *context personalization* cookbook (session vs global notes,
> post‑session consolidation, precedence rules, delimiter‑wrapped injection); Microsoft Agent Framework
> *memory* tutorial (`ContextProvider` / `HistoryProvider` / audit store); context‑vs‑memory engineering
> guidance (four memory types, write‑policy gates, retrieval budgets, placement); practical context
> management patterns (rolling summary + entity ledger, hot/cold tiering, decay).

### 5.7.1 Where memory lives — storage decision (alternatives evaluated)

| Option | Verdict | Why |
|---|---|---|
| **Mongo/Cosmos brain + MAF providers** (chosen) | ✅ | One queryable learner model = the explainability substrate 720 requires; scope enforcement stays in **our** code (§5.8); no learner data leaves the Azure boundary; adds Azure consumption (Cosmos RU/s), which is a program goal. |
| Mem0 (`Mem0ContextProvider`) | ❌ for now | Managed extraction/retrieval is attractive, but learner data would transit a third‑party service — breaks the PII boundary (§4.1) — and its opaque retrieval weakens "every claim traceable to a brain field" (§11). Revisit only if self‑hosted inside our Azure tenant. |
| Foundry Agent Service server‑side threads | ❌ as the brain | Persists *conversations*, not a queryable learner model; scopes, consolidation, and projections would still be ours. May later replace `agent_sessions` raw storage — nothing else changes. |
| Vector index for episodic recall (Mongo/Cosmos vector or Azure AI Search) | ⏳ P4+ | Becomes useful when `learning_events`/`reflections` outgrow recency queries ("have we struggled with something like this before?"). Slots in behind `context_engine` retrieval without changing any agent contract. |

### 5.8 Agent access scopes (least‑context — read/write roles)

Giving every agent the whole brain is a real problem: worse answers (irrelevant context), higher token
cost, a larger **prompt‑injection blast radius**, and privacy leakage. So the Context Engine exposes a
**per‑agent scoped view**, and write‑back is validated against a **per‑agent allow‑list** — the same
pattern already used by `learner_state.update_learner_state`'s `allowed` set, generalized.

```python
# backend/app/brain/context_engine.py (sketch)
AGENT_VIEWS = {
  "onboarding":  {"read": ["profile.mapping_scores", "onboarding_chat"],
                  "write": ["profile.activeness", "profile.interests", "profile.preferences",
                            "profile.learning_style", "strengths", "challenges"]},
  "pedagogical": {"read": ["mastery", "current_state", "next_recommendations"],   # + curriculum/content
                  "write": ["current_state", "next_recommendations", "mastery"]},
  "coach":       {"read": ["profile.interests", "goals", "current.informationToBot",
                            "current.recent_events", "identity.locale"],
                  "write": ["agent_notes", "staged_candidates"]},   # durable fields only via consolidator (§5.7)
  "reflection":  {"read": ["mastery", "recent_events", "reflections"],
                  "write": ["reflections"]},
  "teacher_insights": {"read": ["group_aggregates", "evidence"],   # scoped to the teacher's groups only
                  "write": []},                                      # never writes the learner brain
  "safety":      {"read": ["message", "policy"], "write": ["escalations"]},
}

def view_for(agent, learner_id):      # returns ONLY that agent's slice
    return project(load_brain(learner_id), AGENT_VIEWS[agent]["read"])

def apply_writes(agent, learner_id, updates):
    assert_allowed(updates, AGENT_VIEWS[agent]["write"])   # rejects out-of-scope writes
    return field_scoped_set(learner_id, updates)           # $set per field, not whole-doc replace
```

| Agent | Reads (scoped) | May write | Never sees |
|---|---|---|---|
| **Onboarding** | mapping scores, onboarding chat | profile.*, initial strengths/challenges | events, other learners, teacher notes |
| **Pedagogical** | mastery, current_state, curriculum graph, content metadata | current_state, next_recommendations, mastery | interests, chat transcript, reflections, teacher notes |
| **Learning Coach** | Context bundle (interests, current item `informationToBot`, recent events, goals, locale) | agent_notes (scratch); staged candidates → consolidator | raw activeness numbers, `teacher_only` notes, other learners |
| **Reflection** | mastery, recent events, prior reflections | reflections (+ self vs system) | interests, teacher notes, other learners |
| **Teacher Insights** | group aggregates + evidence, **their groups only** | *nothing in the learner brain* | other groups, learner chat transcript, PII |
| **Safety** | the single message + policy | escalation flags | full brain, events, other learners |
| **Teacher (portal write lane)** | their groups' learners + directives | `teacher_directives`, learner‑visible `goals`, mentoring notes | learner chat transcript, other groups, raw activeness internals |

> **Teacher write lane vs Teacher Insights agent.** The **Insights agent stays read‑only** on the learner
> brain (it only *reads* to explain). Teacher *writes* happen through a **separate, authenticated portal
> lane** (server‑side, group‑scoped) that appends `teacher_directives` / goals / mentoring notes — never an
> LLM path. This is how a teacher "guides" the agents (§5.7 precedence) without ever touching real mastery
> numbers or another teacher's groups.

**Why this shape:** the Coach doesn't need raw פעלנות numbers to be warm (interests + current item are
enough); the Pedagogical agent reasons over mastery + curriculum, and only receives interests as a tiny
engagement *hint*, not as reasoning input; Teacher Insights is group‑scoped and **write‑blocked** on the
learner brain. Enforcement lives in **code** (the view + allow‑list), so even a jailbroken prompt cannot
read or write outside its scope.

---

## 6. Backend changes (concrete)

1. **Introduce the brain** (`app/brain/`): `repository.py` (Mongo `learners`, `learning_events`,
   content, mentoring, org, feedback, `agent_sessions`), `context_engine.py` (bundle + write‑back),
   `schema.py` (Pydantic). Keep the JSON fallback pattern from `learner_state.py`.
2. **Introduce the agent layer** (`app/agents/`) per §5.2 with Agent Framework client over APIM.
3. **New routers** (thin):
   - `/api/brain/{learner_id}` → GET full brain projection; sub‑routes for dashboard DTO.
   - `/api/agent/coach/stream` (SSE) → floating chat; `/api/agent/coach/proactive` (SSE push channel).
   - `/api/agent/reflect`, `/api/agent/insights` (teacher), `/api/agent/route/next` (pedagogical).
   - `/api/xapi` (+ `slxapi` launch context) → ingest events.
   - `/api/mentoring/*`, `/api/feedback`, `/api/orgs/*`, `/api/groups/*`.
4. **Refactor existing routers to read the brain**:
   - `learner_mapping.submit` → after scoring, call **Onboarding Agent** to populate `profile` (keep
     `calculate_scores` as the deterministic scorer; the agent phrases + derives interests, not numbers).
   - `profile.analyze-profile` / `results-chat` → become **thin** callers of the Coach/Onboarding over
     the Context bundle (stop inlining name+scores into ad‑hoc prompts).
   - `dashboard.generate-dashboard` → **replaced** by `services/dashboard.py` projecting the brain
     (real progress from `mastery`/events; LLM only writes the *verbal* feedback, never numbers).
   - `learning_content.create-lomda-stream` → generated lomdot must be **instrumented** (emit xAPI,
     carry metadata incl. `informationToBot`, no YouTube, 100% width/16:9, resume support).
5. **Validation**: promote request bodies to Pydantic models for the new endpoints; keep responses
   localized and non‑numeric for learners.
6. **Keep fallbacks**: if Agent Framework/APIM/Mongo are unavailable, deterministic services + JSON
   fallback keep the demo alive (never the production path).
7. **Localization (§11.1)**: all backend text — agent instructions, proactive‑trigger prompts, feedback,
   summaries, and fallbacks — comes from **language‑keyed dictionaries** honoring `identity.locale`;
   never inline strings. Every AI call receives the learner's locale.

---

## 7. Frontend changes (concrete)

> The full screen-by-screen build plan (routes ↔ APIs ↔ brain fields ↔ states, the design-system
> refactor, and the migration/legacy-removal order) is **§17**. This section lists the component-level
> changes; §17 is the delivery plan.

1. **Floating Learning Coach** (`frontend/src/components/CompanionChat.tsx`) mounted **globally** in
   `app/App.tsx` so it appears on **every** route (F3 "accessible from every screen"). It:
   - streams chat via SSE from `/api/agent/coach/stream`,
   - subscribes to **proactive** nudges (SSE/EventSource on `/api/agent/coach/proactive`),
   - shows the mandatory AI‑use disclosure line,
   - reads/writes only through backend APIs (no `localStorage`), honors `dir`/locale.
2. **Dashboards & teacher view** fetch from `/api/brain/...` / `/api/agent/insights` — **remove**
   dependency on invented `generate-dashboard` numbers; render real progress + explainable flags.
3. **Lesson surface** (`learning-lesson`) posts **xAPI** events to `/api/xapi` from the iframe host and
   supports **resume** from `current_state.resume_token`.
4. **Mentoring** (`mentoring`) reads/writes `/api/mentoring/*` (F5 fields + visibility).
5. `services/api.ts` gains: `getBrain`, `streamCoach`, `subscribeProactive`, `postXapi`,
   `getTeacherInsights`, `mentoring*`. Keep the existing SSE `streamPost` helper.
6. **Localization (§11.1)**: every string in the companion, dashboards, teacher view, and mentoring uses
   the React i18n provider + locale keys (Hebrew source; keys in `he/en/ar.json`) — no hardcoded text.
   `dir` follows `identity.locale`; use logical CSS + `dir="auto"` on chat/user‑generated content.

---

## 8. Content + xAPI pipeline (the fuel for the brain)

The brain is only as smart as the events feeding it. The content is **external** (fetched from content
providers, or our own generated lomdot) and shown to the learner inside an **iframe**. So the key
question is: *how do we know what's happening inside content we didn't write?*

### 8.1 We don't invent the events — 720 defines a closed vocabulary

We never "guess" or scrape events at runtime. The 720 standard defines a **fixed, closed xAPI
vocabulary** that every content provider is **required** to emit. Knowing the events = knowing this
contract.

> **Authoritative source (closed lists).** The MoE **LXP vocabulary registry** — verbs, activity types,
> result extensions, domains — at `lxp.education.gov.il/vocabulery/{Verb,ActivityType,ResultExtension,Domain}.html`,
> with wire IRIs `https://lxp.education.gov.il/xapi/moe/verbs/{verb}` (and `/activities/`, `/extensions/`).
> The **real** verb set is `enter/exit · attempted · answered · scored · completed · submitted · read ·
> watched · listened · played/paused · play · downloaded · install · assigned · created · joined/leave ·
> voided` — there is **no** generic `Initialized/Selected/Requested`. The table below is the *conceptual*
> behavior; map it to those verbs (start→`enter`/`attempted`; a hint request or idle is **monitoring
> telemetry, not a verb**). Full mapping + activity types/extensions/domains:
> `.github/skills/720-content-standards/references/xapi-reporting.md`.

The conceptual set:

| Verb | When | Key payload |
|---|---|---|
| `Initialized` | learner starts an item **or** a component (distinguished by `object`) | `actor`, `object` (item/component id); mark assessment items in `context` |
| `Answered` | learner answers an assessed question/task | `object.id` = the metadata `questionId`; `result.response`, `result.success`, internal `result.score.scaled` |
| `Selected` | learner makes a **non‑assessed** choice | `context…category` = choice type (`learningType`/`practiceDecision`/`isUnderstood`/`isRepeat`/`externalLearning`); `result.response` |
| `Requested` | learner asks for a hint / help | `actor`, `object` |
| `Played` / `Paused` | media play/pause | exact second in the media |
| `Completed` | learner completes an item **or** component | emit **only after** feedback/summary; for `answered`‑bearing components include `result.success` + `score`; the platform may remove the component on `Completed` |

Every statement carries the three mandatory fields: **`actor`** (non‑identifying learner ref),
**`verb`**, **`object`** (the content entity id from metadata). Result/score is internal‑only and never
shown to the learner.

Alongside these, providers emit **monitoring/telemetry** (may be plain logs/analytics, not xAPI):
component/media **load error**, **slow load > 5 s**, **failed xAPI request**, **incomplete/closed before
completion**, and **prolonged inactivity** — these feed fault detection and the idle trigger.

### 8.2 The iframe → platform bridge (`slxapi` in, statements out)

The "mechanism of getting events from the iframe" is **not** reading inside the iframe — it is the
content **reporting back to an endpoint we control**, using credentials we hand it at launch:

```mermaid
sequenceDiagram
  participant P as Platform (parent app)
  participant IF as Content iframe (external)
  participant LRS as /api/xapi/.../statements (our endpoint)
  participant E as learning_events
  participant T as Trigger engine
  participant C as Floating Coach (parent)

  P->>IF: load with slxapi = "{endpoint, auth, actor(pseudo id)}"  (stringified JSON)
  Note over IF: content appends /statements to endpoint itself
  IF->>LRS: POST xAPI statement (Answered, success:false, questionId)  [auth token]
  LRS->>E: validate + normalize + append
  E-->>T: notify
  T->>C: SSE push (proactive nudge)
```

- **Launch:** the platform passes a top‑level **`slxapi`** parameter — **stringified JSON** with:
  - `endpoint` — the **base** reporting URL (our `/api/xapi/{launch}/`), *without* `/statements`
    (the content appends it);
  - `auth` — a per‑launch token (e.g. `Basic …`) scoped to that learner+session;
  - `actor` — display `name` + `account` with a **non‑identifying** learner id + platform `homePage`.
    **Never** the real ת"ז or PII.
- **Transport = HTTP POST**, learner‑authenticated by the launch token. This is standard xAPI‑to‑LRS.
  It works across origins (the iframe just makes a `fetch`/`XHR` to our URL), which `postMessage` and
  parent‑side DOM inspection do **not**.
- Our `/api/xapi` acts as a **lightweight LRS**: verify the token, confirm persistence back to the
  content (so it can honor the retry policy), append to `learning_events`, and notify the trigger engine
  + brain updater. Retries are transparent to the learner and must not block the flow.
- **Ingestion is idempotent — non‑negotiable.** The retry policy *guarantees* duplicate statements
  will arrive. The xAPI statement `id` is a **unique index** on `learning_events`; a replayed statement
  acks success **without** double‑counting `attempts`, re‑moving `mastery`, or re‑firing triggers.
  (Without this, every network blip inflates the learner's failure count.)

### 8.3 Because content is external, we depend on a conformance contract

We can only "know what's going on" to the extent the content **honors the vocabulary**. So accepted
content must pass a **conformance checklist** (and our own generated lomdot are the reference
implementation of it):

- Emits `Initialized` / `Answered` / `Completed` with the correct `object` ids and `questionId`s from
  the metadata, plus `result.success` + `score.scaled` on assessed components.
- Emits `Requested` on hints, `Selected` with the right choice `category`, `Played`/`Paused` for media.
- Emits `Completed` **only after** feedback/summary.
- Emits the monitoring events (load fail, slow load, inactivity) and follows the xAPI **retry policy**.
- Carries valid **metadata** including `informationToBot` (so the Coach can help item‑specifically),
  and obeys the iframe rules (100 % width, ~16:9, no YouTube, no global progress bar).

If a provider under‑instruments, our brain goes partially blind for that content — so conformance is a
gate for onboarding content, not an afterthought.

### 8.4 Cross‑origin reality check (idle detection)

Absence of interaction is **not** a statement, and the parent **cannot** read mouse/scroll inside a
**cross‑origin** iframe. So idle (Time Idle) detection has to come from one of:
1. the content emitting the **prolonged‑inactivity** telemetry event (preferred, per the standard), or
2. the content sending periodic **heartbeat** statements, or
3. for same‑origin / cooperating content, an optional **`window.postMessage`** fast‑lane to the parent.

We treat xAPI‑over‑HTTP as the **source of truth**; `postMessage` is only an optional low‑latency UX
channel (e.g. instant local progress), never the record.

### 8.5 From events to the brain

- **Ingestion** (`services/events.py`): validate → normalize → append to `learning_events` → notify the
  **Trigger engine** and **Brain updater** (update `mastery`, `current_state`, `challenges`, `progress`).
- **Metadata → informationToBot**: each item's `informationToBot` (goal, thinking strategies, common
  mistakes) flows into the Context bundle so the Coach gives item‑specific help.
- Real‑time reactivity: statement → `/api/xapi` → `learning_events` → trigger engine → **SSE** push to
  the floating Coach, which lives in the **parent** app (outside the iframe), so it can react without any
  access to the content's internals.

This is what turns "LLM invents a dashboard" into "dashboard is a projection of what the learner
actually did".

### 8.6 Reporting (LRS) vs fetching (routing), and how math/science "grades" are derived

Don't conflate the two channels — the LRS is **reporting**, not a content store:

1. **Fetching content (platform → provider).** *What* to fetch is decided by the deterministic
   **Planner** (§5.6) over the `learning_objectives` spine + `brain.mastery`; the **Pedagogical Agent**
   then picks the exact content unit/component from the `content_units` / `content_components` catalog
   metadata (matching `subject`, `masteryLevel`, `relativeDifficulty`, `targetSector/targetAudience`,
   `languages`). *How* it loads: the chosen component's metadata carries the **provider iframe URL**
   ("application == the link the provider gives the platform"), loaded with the `slxapi` launch param.
2. **Reporting learning (provider → platform).** Once loaded, the content **POSTs xAPI back** to our LRS
   endpoint (§8.2). That is the *only* thing the LRS does.

The loop: **plan → fetch/show → content reports events → brain updates mastery → re‑plan → fetch next.**

**Scope — math + science only (תשפ"ז).** These are the two focus subjects. Their `learning_objectives`
catalog **and** their content units are **supplied by the Ministry** (we may not author math/science
content without MoE approval). So the planner runs with `subjects = ["math", "science"]`, and every
content unit is tagged `subject ∈ {math, science}` through its `learningObjective`. The platform routes
over that approved catalog; it does not invent objectives or content.

**How "grades" (mastery) are known — straight from the LRS, never invented:**

| What we need | Where it comes from (xAPI result via LRS) |
|---|---|
| Did the learner pass this task? | `Answered` → `result.success` (bool); provider defines the threshold |
| Internal score (never shown) | `Answered` / `Completed` → `result.score.scaled` (0..1) |
| Objective mastered? | **`Completed` on a component flagged `isAssessment`** with `success:true` → כשירות in that objective |
| Component snapshot for routing | `Completed` → binary success + mastery/status snapshot |

The Brain updater writes these into `brain.mastery[objective_id] = { achieved, level, last_score,
attempts, misconceptions }`. Because each objective is tagged with its subject, we aggregate into
`progress.math` / `progress.science` = `{ objectives_mastered, objectives_total }`. **That** is the
"grade picture" the dashboard and teacher view render — **verbal for the learner, numeric only
internally** (`score.scaled` stays server‑side; learners never see a number, per 720).

---

## 9. Mock‑data replacement plan

| Today (mock/invented) | Replace with | Notes |
|---|---|---|
| `mock_data.MOCK_STUDENTS` (dashboard.py) | Real `learners` brains + `services/dashboard.py` projection | Delete `MOCK_STUDENTS` once teacher view + dashboard read the brain. |
| `dashboard.generate-dashboard` inventing progress/goals/competencies | `services/dashboard.py`: progress from `mastery`/events, goals from `mentoring_conversations`, competencies from `profile.activeness` | LLM only phrases verbal feedback; **numbers never invented**. |
| `mock_data.generate_insights` / `generate_recommendations` (heuristic) | **Teacher Insights Agent** over real `learning_events`, with deterministic aggregation as fallback | Must return raw evidence (explainability, F6). |
| `learner_state.game_progress` | `learners.mastery` + `learners.current_state` from xAPI | Enables real resume (F1.6). |
| `profile_cache` / `dashboard_cache` blobs | `learners.profile` (structured) + computed dashboard on read | Stop caching invented output. |
| `QUESTIONNAIRE` (mock 18‑item) | Keep the **MoE‑approved** instrument via `questionnaire_locales`; feed answers to Onboarding Agent | Instrument stays; *interpretation* moves to the brain. |
| Ad‑hoc prompts inlining name+scores (`profile.py`) | Context bundle (non‑identifying) + Safety gate | Closes privacy gap G8. |

**Phasing** (each phase is demoable and independently shippable):
- **P0 Brain skeleton**: `learners` collection + `context_engine` + migrate `learner_state` fields.
- **P1 Events**: `/api/xapi` + `learning_events` + instrument one real lomda.
- **P2 Onboarding + real dashboard**: mapping → brain; dashboard projects the brain (kill invented
  numbers + `MOCK_STUDENTS`).
- **P3 Coach**: floating companion on every screen + Safety gate + non‑identifying context.
- **P4 Pedagogical loop + triggers**: adaptive next‑content + idle/misconception/success proactivity.
- **P5 Teacher Insights + mentoring + org/permissions + feedback**.

> The full **per‑phase execution plan** — backend/frontend/data/agent deliverables, the 720 features each
> phase lights up, legacy removed, and a demoable exit gate — is **§18**. This table is the summary; §18
> is the build order.

---

## 10. End‑to‑end walkthroughs

**Onboarding (F2 → brain):** learner finishes questionnaire → `submit` scores deterministically →
Onboarding Agent reads scores + free‑text chat, writes `profile.activeness/interests/preferences` and
initial `strengths/challenges` → dashboard immediately reflects it.

**A lesson with a coached recovery (F1+F3):** learner works a component → iframe emits `answered`
(fail) twice on `angles-vertical` → third fail fires **misconception** trigger → Coach pushes a nudge
using a football analogy (interest) and offers an alternative representation → Pedagogical selects the
`recommendedAfterFail` video component → on `Completed` (after feedback) `mastery` updates → dashboard
progress ticks up.

**Teacher opens the view (F6):** Teacher Insights Agent aggregates the group's real events → flags a
learner "requires attention" **with raw evidence** ("0 activity 6 days; 2/5 last tasks") → shows 2–5
actionable recommendations, scoped to the teacher's groups, no student‑to‑student comparison.

**Mentoring (F5):** teacher logs a conversation (date/stage/notes/next steps/deadline, visibility) →
learner‑visible goals mirror into `learners.goals` → appear on the student dashboard.

---

## 11. Privacy, safety, explainability, localization (non‑negotiable)

- **PII never reaches AI.** Only the Context bundle (§4.4) is sent; Safety Agent strips anything stray.
- **Pseudonymous ids** everywhere in events/brain/`slxapi.actor`.
- **AI disclosure** shown wherever the learner talks to AI (the mandated Hebrew notice).
- **Model that doesn't train on data** (APIM/Foundry config).
- **Explainable teacher flags** — every flag returns the raw datum; the brain's `evidence_ref` /
  `learning_events` back every claim.
- **No numeric grades to learners** — numbers live in the brain for routing/analytics only; learner
  surfaces are verbal/encouraging.
- **No student comparisons** in any learner‑ or teacher‑facing insight.

### 11.1 Localization is a cross‑cutting requirement (he / ar / en)

**Everything this architecture introduces must be localized** — there are no exceptions. This applies to
every agent reply, proactive nudge, opening/closing message, feedback line, dashboard/teacher/mentoring
label, reflection prompt, and error/fallback string. See
[`.github/instructions/localization.instructions.md`](../../.github/instructions/localization.instructions.md).

- **Language is brain state.** The selected language lives in `identity.locale` (MongoDB‑backed, never
  `localStorage`/`sessionStorage`), is part of the Context bundle, and is passed to **every** AI call.
  The Coach and all agents answer in `identity.locale` and must support **Hebrew and Arabic** for 720.
- **No hardcoded strings.** No learner‑ or teacher‑facing text inline in React components, backend
  prompts, iframe templates, or generated UI. React text uses the i18n provider + keys; static HTML uses
  `data-i18n`; **backend prompts, agent instructions, proactive triggers, and fallbacks come from
  language‑keyed dictionaries** (e.g. `PROMPTS[locale]`), not inline literals.
- **Source of truth + coverage.** Hebrew is the source language; every new key is added to all three
  locale files (`he.json`, `en.json`, `ar.json`).
- **Direction + bidi.** `he`/`ar` = RTL, `en` = LTR; set `dir` on `document.documentElement`; use
  logical CSS properties (`margin-inline-*`, `text-align: start`); use `dir="auto"` on chat messages and
  any mixed‑language / user‑generated content.
- **Content routing respects language.** The planner/Pedagogical agent filter content by the component
  `languages` field against `identity.locale` (§8.6); if no approved localized component exists, surface
  the gap rather than showing the wrong language.

> The Coach instruction sketch (§5.4) already opens with *"ענה בשפת המוצר (locale)"* — that rule is the
> norm for **every** agent and surface in this document, not just the Coach.

---

## 12. Roadmap vs 30/07/2026 (by weight)

| Order | Feature (weight) | Architecture piece | Phase |
|---|---|---|---|
| 1 | F3 Learning agent 25% | Coach + Safety + triggers + brain context | P0→P4 |
| 2 | F1 Delivery 20% | Pedagogical loop + content model + xAPI | P1→P4 |
| 3 | F6 Teacher view 20% | Teacher Insights + events + groups/permissions | P5 |
| 4 | F4 Dashboard 15% | Brain projection (real, non‑numeric) | P2 |
| 5 | F5 Mentoring 10% | `mentoring_conversations` + goal mirror | P5 |
| 6 | F2 Mapping 5% | Onboarding Agent → brain | P2 |
| 7 | F7 Feedback 3% | `feedback_reports` + report UI | P5 |
| 8 | F8 Org/permissions 2% | schools/teachers/groups/enrollments scoping | P5 |

Sequencing note: build **P0 brain + P1 events first** — they are the substrate every weighted feature
depends on. Everything else becomes a projection or an agent over that substrate.

---

## 13. `.github` toolchain alignment

To keep the whole agent toolchain focused on this architecture:

- **New skill** `.github/skills/720-agent-architecture/SKILL.md` — loaded whenever work touches the
  brain, agents, orchestration, context engine, xAPI ingestion, dashboard projection, or mock‑data
  replacement. It points here as the source of truth.
- **`.github/copilot-instructions.md`** — adds an "Agentic Architecture" section pointing to this doc +
  the new skill, and states the Agent Framework + brain direction.
- **`.github/agents/720-content-builder.agent.md`** — loads the new skill and adds the brain /
  Context Engine / six‑agent model + mock‑replacement policy to its working memory.
- Existing skills stay authoritative for their domains: `720-content-standards` (content, metadata,
  xAPI shapes), `720-delivery-requirements` (feature scope/weights). This doc **composes** them into a
  runtime architecture; it does not replace them.

---

## 14. Acceptance criteria (per feature, demoable)

- **F2**: submitting the questionnaire writes `profile.activeness/interests/preferences` to `learners`;
  visible in dashboard + teacher view; no invented numbers.
- **F3**: floating Coach on every route; answers in he/ar/en; uses at least one learner interest in an
  example; fires a proactive nudge on idle and on a misconception streak; AI disclosure visible; no PII
  in the prompt (verify Context bundle).
- **F1**: after a fail streak the learner is routed to `recommendedAfterFail`; pace + opening/closing
  messages shown; resume from `current_state` works after closing mid‑task.
- **F4**: dashboard renders real progress from events; verbal, non‑numeric; goals from mentoring.
- **F6**: teacher sees only their groups; a flag shows its raw evidence; 2–5 actionable recs; no
  student comparison.
- **F5**: mentoring conversation with all required fields; learner‑visible goals mirror to the brain.
- **F7/F8**: feedback report persists; school/teacher/group/enrollment entities scope access.

---

## 15. Known flaws, risks, and mitigations

An honest list of where this design can break, and how we contain each one.

| # | Flaw / risk | Mitigation (built into the design) |
|---|---|---|
| R1 | **Curriculum was under‑specified** in v1 (how "next" is chosen). | §5.6 + `learning_objectives` spine: deterministic planner over an ordered objective graph; LLM never sequences the syllabus. |
| R2 | **Brain document unbounded growth** (`reflections`, `agent_notes`, `next_recommendations`) vs Mongo 16MB. | Keep the brain a **compact projection**: cap arrays (last N), roll history into `learning_events` / a `reflections` collection; the brain is not a log. |
| R3 | **Write contention** — trigger engine + several agents write the brain → lost updates. | Field‑scoped `$set` (never whole‑doc replace), per‑agent write allow‑list (§5.8), optimistic concurrency via `version`/`updated_at`. |
| R4 | **LLM everywhere = cost, latency, non‑determinism.** | Deterministic skeleton (planner, triggers, mastery, aggregations are **code**); LLM only for language, relation, and ambiguous judgment; debounce/cache. |
| R5 | **Idle detection isn't an event** (absence of events). | Client sends periodic heartbeats; the trigger engine treats "no interaction for N s while a task is open" as idle. |
| R6 | **Soft (chat) vs hard (event) knowledge conflict.** | §5.7 reconciliation: hard wins, soft decays, chat never sets mastery. |
| R7 | **Prompt injection** via learner chat or content `informationToBot` (both untrusted). | Treat content + chat as data, never instructions; Safety gate on I/O; scoped views (§5.8) cap the blast radius. |
| R8 | **Mastery from a single assessment pass is brittle.** | Store mastery with `confidence` + `attempts`; allow re‑check; spaced review resurfaces decaying mastery. |
| R9 | **Explainability drift** — LLM over‑claims in teacher insights. | Deterministic evidence first; the LLM may only *reword* the evidence, never add facts; every flag returns its raw datum. |
| R10 | **Content not available in the learner's locale / no approved alternative.** | Locale + `targetSector/targetAudience` filter with a defined fallback; if none, the planner surfaces the gap instead of inventing content. |
| R11 | **Degraded mode** (no APIM/Mongo/agent infra). | Deterministic + JSON fallbacks keep the demo alive, but must degrade **honestly** — never fabricate progress or insights. |
| R12 | **History replayed twice** — multiple MAF history providers loading messages into one call. | Exactly one `HistoryProvider` has `load_messages=True`; the audit provider is write‑only (`store_context_messages=True`, `load_messages=False`). |
| R13 | **Consolidator failure / lag** — staged candidates never promoted, or decay never runs. | Staging is durable (pending queue in Mongo); consolidation is idempotent and re‑runnable; the bundle renders only *consolidated* state, so a stalled consolidator degrades to "yesterday's memory", never to corrupted memory. |
| R14 | **Duplicate / replayed xAPI statements** — the mandated provider retry policy guarantees them. | Statement `id` unique index; idempotent ingest acks duplicates without re‑counting `attempts`, moving `mastery`, or re‑firing triggers (§8.2). |
| R15 | **In‑process triggers + SSE don't survive scale‑out** (event on worker A, learner socket on worker B). | Accepted single‑instance for P1–P4; the seam is isolated in `events.py` + the push channel → swap for Mongo change streams / Service Bus + shared pub‑sub when scaling (§5.5), with no agent/brain contract change. |

**Net:** the biggest structural risk is *over‑agenting* — pushing decisions into the LLM that belong in
deterministic code. The intended balance is a **deterministic learning engine** (curriculum, mastery,
triggers, aggregation) with **LLM agents layered on top** for language, empathy, and adaptive judgment.

---

## 16. Microservice‑readiness (path to AKS + Service Bus)

Everything in §§4–8 runs **in‑process on a single App Service today** (the honest P1–P4 shape, R15). But
each seam is drawn as an **interface**, so the system can later be pulled apart into independently
deployable services on **AKS**, wired by **Azure Service Bus** events, **without changing any agent or
brain contract**. Design rules that keep this migration cheap — apply them now even in the monolith:

**Modules now, few services later.** Build clean in‑process modules (`brain/context_engine`,
`services/events`, `agents/orchestrator`, `services/insights`, `services/dashboard`, mentoring, org) with
**no shared in‑memory state** — they cross only through the brain (Mongo/Cosmos) and the event‑bus
interface. **Keep the service count low** — over‑splitting buys distributed‑systems pain for no benefit at
this scale. When scale demands it, those modules group into **three** deployable services, not seven:

| Service (AKS) | Packs which modules | Responsibility | Talks to |
|---|---|---|---|
| **spark-web** | API/BFF, static React, SSE push, dashboard projection | serve the app + learner/teacher surfaces; hold the proactive push sockets | ← Front Door; ⇄ brain‑agents (HTTP); consumes `teacher_alerts` / push from the bus |
| **brain-agents** | Context Engine + all six agents + orchestrator + insights + planner | assemble scoped context, run agents via APIM, write‑back through the consolidator | ⇄ spark‑web; consumes `triggers`; → APIM → OpenAI; ⇄ Cosmos |
| **xapi-events** | xAPI ingest (LRS) + trigger engine + mastery/progress projection | idempotently ingest events, update mastery, publish topics | ← content iframe; → Service Bus; ⇄ Cosmos |

Why exactly these three: **web** scales on user/socket load, **events** on ingest throughput, and
**brain-agents** on LLM concurrency — three genuinely different scaling axes. Insights, mentoring, org and
dashboard stay **modules** inside those services; promote one to its own service **only** if a real
bottleneck appears.
- **The event bus is an interface.** Today: an in‑process asyncio queue + per‑session idle timers.
  Tomorrow: **Mongo change streams / Azure Service Bus** topics (`learning_events`, `triggers`,
  `teacher_alerts`) with competing consumers. `events.py` is the single swap point (R15).
- **The proactive push channel is an interface.** Today: in‑process SSE. Tomorrow: a shared pub/sub
  (Service Bus / Redis) so an event on worker A reaches a learner whose socket lives on worker B.
- **Stateless agents, state in the brain.** Agents hold no durable memory, so any agent can run as its
  own horizontally‑scaled pod; the brain + `agent_sessions` are the only state.
- **APIM stays the model gateway** and **Front Door stays the edge** in both shapes; only what sits
  *between* them changes (monolith → mesh of services).
- **Idempotent, replay‑safe ingestion** (§8.2) is already required — which is exactly the prerequisite for
  at‑least‑once Service Bus delivery, so going distributed adds no new correctness work.

> Target picture: **Front Door → APIM → AKS** running just **spark-web · brain-agents · xapi-events**,
> exchanging **Service Bus** events (`learning_events` · `triggers` · `teacher_alerts`) over Cosmos/Mongo
> + Blob + Monitor. The deck's future‑architecture slide renders exactly these three services and their
> messages — same agent + brain contracts as the monolith.

---

## 17. Frontend implementation plan (screens ↔ routes ↔ APIs ↔ brain)

The frontend is the visible half of every 720 feature. This section is the **contract** between the
**design** (owned by `.github/skills/720-UIUX/SKILL.md`), the **plan** (this doc), and the **backend**
(§6/§7). Division of labor: this doc says *what data a screen shows and where it comes from*; the UIUX
skill says *how it looks*. Do not duplicate visual rules here.

### 17.1 Where the frontend lives & non-negotiables
- **Stack:** Vite + React + TypeScript in `frontend/`. Built to **static assets** — today served by the
  single FastAPI app (`app/routes/static_pages.py`), tomorrow by **`spark-web`** / Front Door CDN (§16).
  The frontend is **not** its own runtime service.
- **Design language = the `720-UIUX` skill:** mature EdTech, **RTL-first**, calm, **no emojis, not
  childish**. Use the *mature ("older")* treatment as the bar — cf. the vibe-coding-kids academy "older"
  mode which strips the starfield/ornaments/emoji: clean **line-SVG icons**, soft cards, navy ink with
  royal-blue / teal / soft-purple accents, generous whitespace, calm shadows.
- **No `localStorage` / `sessionStorage`** for learner state — language, mapping, dashboard, progress,
  mentoring, and companion memory all flow through backend APIs (the brain).
- **i18n he/ar/en**, `dir` on `<html>`, logical CSS (`margin-inline`, `text-align: start`), `dir="auto"`
  on user- and AI-generated text.
- **Numbers rule:** learner screens are **verbal, non-numeric**; teacher screens show **evidence**.
- **The `יובי` companion is on learner routes only**; teacher/admin/reviewer screens use insights, never
  a student-style companion.

### 17.2 App shell & structure
```
frontend/src/
  app/          App.tsx (shell), router.tsx (path router: useRoute/navigate)
  providers/    I18nProvider · DirectionProvider · SessionProvider(role/group)
                BrainProvider(read cache) · CompanionProvider(SSE chat + proactive)
  components/   design-system primitives (17.3) + CompanionChat.tsx (global, learner routes)
  features/     landing-login · learner-mapping · results · student-dashboard · learning-portal
                learning-lesson · mentoring · teacher-view · (new) reflections · feedback · admin · reviewer
  services/     api.ts (typed fetch + SSE) · brain.ts · agents.ts · xapi.ts
  i18n/         he.json · ar.json · en.json
  styles/       tokens.css (design tokens) · base · utilities
```
Keep the current lightweight path router (`useRoute`/`navigate`) — **no new router dependency**.
Providers assemble once in `App.tsx`; `CompanionProvider` mounts the floating chat on learner routes and
opens the proactive SSE channel.

### 17.3 Design system — the refactor
Extract a **token layer** and a small set of **primitives**, then migrate features onto them. This *is*
the UI refactor the project needs (and the place the `720-UIUX` design lands in code):
- **Tokens** (`styles/tokens.css`): color (navy ink, royal blue, teal, soft purple, light gray-blue bg),
  radius, spacing scale, **calm** elevation, type scale, motion (honor `prefers-reduced-motion`).
- **Primitives** (`components/`): `Card` · `Panel` · `SectionHeader` · `StatusPill` (verbal —
  "מתקדם/כדאי לחזק/מוכן לאתגר") · **`EvidenceChip`** (the "why we think this" atom) · `Stepper` · `Tabs` ·
  `Filter` · `Timeline` (event history) · `Drawer`/`Sheet` · `CompanionChat` · `EmptyState` ·
  `LoadingState` · `ErrorState` · `Icon` (line-SVG set, **no emoji**).
- **The refactor removes:** emoji-driven UI, childish decoration, ad-hoc inline styles, every
  `localStorage` learner read, and the FE dependence on `LearnerState.profile_cache /
  dashboard_cache / game_progress` (replaced by brain projections, §9).

### 17.4 Screen ↔ route ↔ API ↔ brain map
"Now" = existing endpoint; "Target" = §6 endpoint. Every learner screen also mounts the companion.

| Screen (feature) | Route | Backend: now → target | Brain fields shown | Agent | Key states |
|---|---|---|---|---|---|
| Landing / login | `/` | static → unified sign-in `/auth/*` (role+group) | — | — | default · loading · error |
| Onboarding intro | `/learner-mapping` (intro) | `/api/questionnaire` | `identity.locale` | Onboarding | intro · consent · AI-disclosure |
| Mapping questionnaire | `/learner-mapping` | `/api/questionnaire`, `/api/submit`, `/api/mapping-chat-stream` → Onboarding agent | writes `profile.mapping_scores` | Onboarding | per-step · save · resume · validate |
| Results / profile | `/results` | `/api/analyze-profile` → `/api/brain/{id}` projection | `profile.*`, `strengths`, `challenges` | Onboarding/Coach | verbal only · loading · empty |
| **Student dashboard** | `/student-dashboard` | **kill** `/api/generate-dashboard` → `/api/brain/{id}` + `/api/agent/route/next` | `progress` (verbalized), `mastery`, `goals`, `current_state`, `next_recommendations` | Context Engine projection | real · empty · loading · resume CTA |
| Learning portal | `/learning-portal` | → `/api/brain/{id}` + content catalog | `next_recommendations`, subjects, status | Planner + Pedagogical | recommended vs browse · filters |
| **Learning lesson (anchor)** | `/learning-lesson` | → component load (Pedagogical/MCP) + iframe `slxapi` + `POST /api/xapi` + `/api/agent/coach/stream` (SSE) + `/api/agent/coach/proactive` | `current_state`, item `informationToBot`, `recent_events`, `resume_token` | Coach (+Pedagogical, Safety, Reflection) | loading · slow>5s · xapi-retry · idle · misconception · success · resume |
| Companion `יובי` (global) | overlay | `/api/agent/coach/stream`, `/api/agent/coach/proactive` | Context bundle, `agent_sessions` | Coach + Safety | collapsed · expanded · streaming · proactive · offline |
| Reflection | modal / `/reflections` | `/api/agent/reflect` | `reflections_recent` | Reflection | prompt · answer · save · share-toggle |
| Mentoring (learner) | `/mentoring` | → `/api/mentoring/*` | learner-visible `goals` | — | list · empty · add-note |
| **Teacher dashboard** | `/teacher-view` | **kill** `MOCK_STUDENTS` → `/api/agent/insights` + `/api/groups/*` | group aggregates + evidence, live alerts | Teacher Insights | group · filter · alerts · empty |
| Teacher student-detail | `/teacher-view/:id` | `/api/brain/{id}` (teacher scope) + `/api/agent/insights` | `mastery`+evidence, `Timeline`, strengths/challenges, `goals`, `teacher_directives`, shared reflections | Teacher Insights | detail · live · evidence-expand |
| Teacher directive composer | drawer | portal write lane → `teacher_directives` | `teacher_directives` | portal (not an agent) | compose · scope · priority · visibility · preview |
| Mentoring form (teacher) | `/mentoring` (teacher) | `/api/mentoring/*` | `mentoring_conversations`, `goals` mirror | — | draft · final · private-note · preview |
| Feedback / issue | modal / route | `POST /api/feedback` | `feedback_reports` (+ auto context) | — | form · context-attach · confirm |
| Admin overview | `/admin` | `/api/orgs/*`, `/api/groups/*` | schools · teachers · groups · enrollments | — | list · permission-preview |
| Reviewer / compliance | `/reviewer` | read-only brain + `learning_events` + audit | evidence trace, feature coverage, arch mini-map | read-only | trace · replay |

### 17.5 Data-flow patterns + `services/api.ts` additions
- **Reads** are **brain projections** (`GET /api/brain/{id}` and DTO sub-routes) — never invented on the
  client. **Live** data uses **SSE**: `streamCoach` (chat) and `subscribeProactive` (nudges + teacher
  alerts). The lesson iframe posts events via `postXapi` from the parent host.
- **Writes** go through **scoped endpoints** only; the client never writes the brain directly. Teacher
  guidance uses the **portal write lane** (`teacher_directives`), not an LLM path (§5.8).
- **Add to `services/api.ts`** (keep the existing `streamPost` SSE helper): `getBrain`, `getDashboard`,
  `getNext`, `streamCoach`, `subscribeProactive`, `postXapi`, `getTeacherInsights`, `subscribeAlerts`,
  `mentoringList/Create`, `saveDirective`, `postFeedback`, `orgs*`. Type every response DTO.

### 17.6 States, accessibility, localization (every screen)
Every screen must implement **loading / empty / error / success** (+ the lesson's `slow>5s`,
`xapi-retry`, `idle`, `misconception`, `resume`). RTL for he/ar, LTR for en; keyboard-navigable; visible
focus; `prefers-reduced-motion`; `EvidenceChip`s render the "why" for any AI claim; **no learner-facing
numbers**; teacher flags always expand to raw evidence.

### 17.7 Migration & legacy-removal order (each step demoable)
1. **Tokens + primitives** (`styles/tokens.css`, `components/*`) — establish the mature design system.
2. **Shell + providers** (i18n, direction, session/role, brain, companion).
3. **Companion** mounted globally on learner routes (SSE chat + proactive), Safety-gated.
4. **Student dashboard** → brain projection; **delete** `generate-dashboard` invented numbers usage.
5. **Learning lesson** → Pedagogical/MCP content + iframe `slxapi` + `postXapi` + resume.
6. **Teacher view** → insights + evidence + live alerts; **delete** `MOCK_STUDENTS` usage.
7. **Mentoring · directive composer · feedback · admin · reviewer**.
- **Remove as replaced (§9):** emoji/childish UI, ad-hoc inline styles, all `localStorage` learner reads,
  and FE reliance on `profile_cache / dashboard_cache / game_progress`. Keep i18n, the path router, and
  `streamPost`; keep legacy screens only until their refactored route is feature-equivalent, then delete.

### 17.8 Acceptance (frontend)
- Every learner screen: verbal (no numbers), companion present, AI disclosure visible, he/ar/en + RTL,
  no `localStorage` for learner state.
- Every teacher screen: each flag/insight expands to raw evidence; group-scoped; no student comparison.
- Dashboard + teacher view read **real** brain/insights (no `generate-dashboard`/`MOCK_STUDENTS`).
- Lesson posts real xAPI and resumes from `current_state`; companion streams + fires a proactive nudge.
- Design matches the `720-UIUX` skill bar (mature, calm, emoji-free, line-SVG icons).

---

## 18. Phased implementation plan (execution)

> **Implementation status (2026-07):** **P0–P5 are implemented and verified** against real
> Cosmos + APIM (each with a passing end-to-end check; PII boundary, idempotency, and
> no-invented-numbers enforced). Backend is complete for all eight features. **F6 teacher view is
> also refactored to real React** on the design-system primitives. **Remaining:** the §17 *visual*
> React refactor of the last legacy imperative pages (mentoring, student dashboard) onto their
> verified clients, and **P6** (hardening + AKS/Service Bus split). Per-phase build/verify detail below.
>
> | Phase | Features | Backend | Frontend | Verified |
> |---|---|---|---|---|
> | P0 brain + design tokens | F4 substrate | ✅ | ✅ tokens+primitives | ✅ |
> | P1 xAPI events | F1 | ✅ LRS+brain updater | ✅ lesson instrumented | ✅ |
> | P2 onboarding + dashboard | F2, F4 | ✅ projection (no invention) | legacy page on real data | ✅ |
> | P3 Coach + Safety | F3 | ✅ | ✅ floating companion | ✅ |
> | P4 pedagogical + triggers + memory | F1, F3 | ✅ | ✅ proactive+idle | ✅ |
> | P5 teacher + mentoring + org + feedback | F6, F5, F7, F8 | ✅ | F6 ✅ React · F5 client | ✅ |
> | P6 hardening/scale | — | ⏳ | ⏳ | — |

This is the **build order** for everything in §§4–17. It expands the phase sketch (§9) and the roadmap
(§12) into concrete, demoable increments. Guiding rules:

- **Substrate first.** P0 (brain) + P1 (events) are the foundation every weighted feature projects over;
  they are not optional groundwork you can defer behind a flashy demo.
- **Every phase ships.** Each phase ends at a **demoable, honest** state (no fabricated data) and maps to
  named 720 features + acceptance clauses (§14). A phase is "done" only when its **exit gate** passes.
- **Deterministic before agentic.** Within a phase, build the deterministic skeleton (schema, projection,
  planner, triggers, aggregation) first; layer the LLM agent on top for language/empathy/judgment (R4).
- **Vertical slices.** Prefer one screen wired end-to-end (surface → API → agent → brain → back) over
  broad half-built horizontals — proves the whole stack early.
- **Fallbacks stay green.** At no phase may removing APIM/Mongo/Agent Framework break the demo; degrade
  honestly (§15 R11).

Cross-cutting workstreams run in **every** phase, never as a trailing cleanup: **localization** (he/ar/en
keys added with each string, §11.1), **privacy/Safety** (no PII to AI, disclosure shown, §11), **legacy
removal** (delete mock/invented paths as each real path lands, §9), and **microservice hygiene** (no
shared in-memory state across module seams, §16).

### Phase 0 — Brain skeleton + design foundation
**Goal:** one queryable learner model + the mature design system, replacing fragmented `learner_state`.
- **Backend:** `app/brain/{schema.py, repository.py, context_engine.py}`; `learners` collection (§4.2)
  with field-scoped `$set` writes + `version`/`updated_at` (R3); JSON fallback preserved. `GET
  /api/brain/{learner_id}` projection. Migrate `learner_state` fields → brain (`language→identity.locale`,
  `mapping_results→profile.mapping_scores`, `game_progress→mastery/current_state`).
- **Frontend:** `styles/tokens.css` + design-system primitives (§17.3: `Card`, `Panel`, `StatusPill`,
  `EvidenceChip`, `Timeline`, `EmptyState`/`LoadingState`/`ErrorState`, line-SVG `Icon`); providers shell
  (I18n, Direction, Session/role, Brain). No feature migrated yet.
- **Data:** `learners`; keep `learning_objectives` seed stub (math/science placeholders until MoE catalog).
- **Features lit:** foundation for F4 (dashboard substrate).
- **Legacy removed:** none yet (parallel-run `learner_state` behind the brain repo).
- **Exit gate:** a real learner doc round-trips through `context_engine` with a scoped view; primitives
  render in Storybook/preview in he/ar/en RTL; no invented numbers introduced.

### Phase 1 — Event pipeline (xAPI LRS)
**Goal:** real learning events flow into the brain — the fuel for every projection (closes G4).
- **Backend:** `app/services/events.py` (validate → normalize → append `learning_events`; **idempotent**
  on statement `id` unique index, R14); `POST /api/xapi/{launch}/statements` lightweight LRS + `slxapi`
  launch minting (§8.2, non-identifying `actor`); Brain updater writes `mastery/current_state/progress`
  from `answered/completed` (§8.6). MoE LXP closed vocabulary enforced (§8.1).
- **Frontend:** `learning-lesson` host mounts the content iframe, passes `slxapi`, and `postXapi` from the
  parent; **resume** from `current_state.resume_token`.
- **Data:** `learning_events` (append-only, unique `id`); one **reference lomda** instrumented to the
  conformance checklist (§8.3) as the proving content.
- **Features lit:** F1 (partial — instrumented delivery + resume), F4 substrate becomes real.
- **Legacy removed:** begin retiring `learner_state.game_progress` (now derived from events).
- **Exit gate:** completing the reference lomda writes real `mastery`; replaying a statement does **not**
  double-count `attempts` or re-fire; resume works after closing mid-task without save/submit (F1.6).

### Phase 2 — Onboarding agent + real dashboard
**Goal:** mapping seeds the brain; the dashboard **projects** it (kills invented numbers + `MOCK_STUDENTS`).
- **Backend:** `app/agents/{client.py, providers.py, tools.py, onboarding.py}` (Agent Framework over APIM,
  §5.1); `agent_sessions` collection; `learner_mapping.submit` → deterministic `calculate_scores` then
  **Onboarding agent** derives `interests/preferences/learning_style` + initial `strengths/challenges`
  (agent phrases, never invents numbers). `app/services/dashboard.py` projects brain → DTO
  (`progress` verbalized, `goals`, competencies from `profile.activeness`). **Delete**
  `dashboard.generate-dashboard` invented path.
- **Frontend:** migrate `learner-mapping`, `results`, `student-dashboard` onto primitives; dashboard reads
  `/api/brain/{id}` (+ `/api/agent/route/next` stub); **verbal, non-numeric** learner view.
- **Data:** `agent_sessions`.
- **Features lit:** **F2** (5%), **F4** (15%).
- **Legacy removed:** `dashboard.generate-dashboard` numbers, `profile_cache`/`dashboard_cache`, and the
  FE `localStorage` learner reads for these screens.
- **Exit gate (§14 F2/F4):** questionnaire submit populates `profile.*`; dashboard shows real progress from
  events, verbal only, goals present; `MOCK_STUDENTS`/`generate-dashboard` no longer referenced by these
  routes.

### Phase 3 — Floating Learning Coach + Safety gate
**Goal:** the always-present companion that *relates* to the learner (highest weight, F3 25%).
- **Backend:** `app/agents/{coach.py, safety.py}`; `MongoHistoryProvider` (working memory: last N turns +
  rolling summary + entity ledger) + `AuditHistoryProvider` (write-only, exactly-what-it-saw, R12);
  `BrainContextProvider("coach")` scoped injection (§5.8) budgeted/placed/delimited (§4.4); **tiered
  Safety** (deterministic tier-1 always, LLM tier-2 on flag/sample, R4); `POST /api/agent/coach/stream`
  (SSE). Language-keyed instruction/prompt dictionaries (§11.1).
- **Frontend:** `CompanionChat.tsx` mounted **globally on learner routes** via `CompanionProvider`; SSE
  stream; AI-disclosure line; `dir="auto"` on messages; no `localStorage`.
- **Data:** brain `agent_notes`; staged memory candidates (consolidator wiring stubbed in P3, activated P4).
- **Features lit:** **F3** (25%) core conversational path; privacy boundary enforced in code (closes G8).
- **Legacy removed:** ad-hoc `profile.py` prompts inlining name+scores → Context bundle.
- **Exit gate (§14 F3):** Coach answers in he/ar/en on every learner route, uses ≥1 real interest in an
  example, AI disclosure visible, verified **no PII** in the assembled prompt (inspect the audit store).

### Phase 4 — Pedagogical loop + triggers + memory lifecycle
**Goal:** adaptive next-content + proactivity + persistent, self-correcting memory (F1 depth, F3 proactivity).
- **Backend:** `app/services/planner.py` (deterministic curriculum planner over `learning_objectives`
  spine, §5.6); `app/agents/{pedagogical.py, reflection.py}`; `orchestrator.py` (pedagogical workflow +
  in-process **trigger engine**: idle/misconception/success from real events, §5.5); MCP `content-catalog`
  tool `list_available_content(...)`; `brain/consolidator.py` (capture→validate→consolidate→inject, §5.7:
  hard>soft, decay, promote, chat never sets mastery); `POST /api/agent/coach/proactive` (SSE push),
  `/api/agent/route/next`, `/api/agent/reflect`.
- **Frontend:** `learning-portal` (recommended vs browse), `learning-lesson` full states
  (`slow>5s`/`xapi-retry`/`idle`/`misconception`/`success`/`resume`); `subscribeProactive`; Reflection
  modal (`reflections` + self-vs-system).
- **Data:** `content_units/components/items` metadata (incl. `informationToBot`, `recommendedAfterFail`);
  `reflections` collection.
- **Features lit:** **F1** (20%) full adaptive delivery; **F3** proactivity; F4 self-awareness competency.
- **Legacy removed:** heuristic `mock_data.generate_recommendations` for routing.
- **Exit gate (§14 F1):** a fail streak routes the learner to `recommendedAfterFail`; opening/closing +
  pace messages shown; a proactive nudge fires on idle **and** on a misconception streak; a chat-stated
  interest survives a session (consolidated), while "I get it" does **not** move `mastery`.

### Phase 5 — Teacher view + mentoring + org/permissions + feedback
**Goal:** the teacher/mentor half + the scoping and reporting features (F6 20%, F5, F7, F8).
- **Backend:** `app/agents/teacher_insights.py` (read-only, explainable, group-scoped) + deterministic
  `app/services/insights.py` aggregations; **teacher portal write lane** (`teacher_directives`, non-LLM,
  §5.8) feeding §5.7 precedence; live `emit_teacher_signal`/`push_live_alert`; `schools/teachers/groups/
  enrollments` (F8) with **server-side scoping before any brain read** (§4.1); `mentoring_conversations`
  (F5 fields + visibility + `author`); `feedback_reports` (F7, in/out-of-system); routers
  `/api/agent/insights`, `/api/groups/*`, `/api/orgs/*`, `/api/mentoring/*`, `/api/feedback`.
- **Frontend:** `teacher-view` (group + student-detail with `Timeline` + `EvidenceChip` on every flag,
  live alerts, filters), directive composer drawer, `mentoring` (teacher + learner), feedback modal,
  admin overview; **delete** `MOCK_STUDENTS` usage.
- **Data:** `groups/enrollments/schools/teachers`, `mentoring_conversations`, `feedback_reports`,
  `teacher_directives`.
- **Features lit:** **F6** (20%), **F5** (10%), **F7** (3%), **F8** (2%).
- **Legacy removed:** `mock_data.MOCK_STUDENTS`, `generate_insights` heuristic (fallback only).
- **Exit gate (§14 F5/F6/F7/F8):** teacher sees only their groups; every flag expands to raw evidence;
  2–5 actionable recs; **no** student-to-student comparison; mentoring conversation persists all required
  fields and learner-visible goals mirror to the brain; feedback report persists; group scoping enforced
  server-side.

### Phase 6 — Hardening & scale-readiness (post-minimum)
**Goal:** production robustness + the AKS/Service Bus split (no agent/brain contract change, §16).
- Swap in-process event bus + SSE push for **Mongo change streams / Azure Service Bus** (`learning_events`
  · `triggers` · `teacher_alerts`) so triggers survive scale-out (R15); split the monolith into
  **spark-web · brain-agents · xapi-events** on AKS behind Front Door + APIM. Add episodic **vector recall**
  behind `context_engine` if events outgrow recency queries (§5.7.1, P4+). Load/cost tuning, concurrency
  tests (R3), consolidator idempotency/lag drills (R13), reviewer/compliance route (evidence trace).
- **Exit gate:** an event on one pod pushes to a learner socket on another; contract tests prove agent +
  brain APIs unchanged across the split.

### Critical path & sequencing

```mermaid
flowchart LR
  P0["P0 Brain + design system"] --> P1["P1 Events (xAPI LRS)"]
  P1 --> P2["P2 Onboarding + real dashboard\nF2 · F4"]
  P2 --> P3["P3 Coach + Safety\nF3 core"]
  P3 --> P4["P4 Pedagogical + triggers + memory\nF1 · F3 proactive"]
  P4 --> P5["P5 Teacher · mentoring · org · feedback\nF6 · F5 · F7 · F8"]
  P5 --> P6["P6 Hardening + AKS/Service Bus"]
  P1 -. substrate .-> P4
  P1 -. substrate .-> P5
```

- **Hard dependencies:** P0→P1 (brain must exist before events land); P1→everything real (no true F1/F4/F6
  without events); P3→P4 (Coach exists before proactive triggers push to it); F8 scoping (P5) gates any
  multi-group teacher demo.
- **Weight vs order:** F3 (25%) is highest weight but depends on the P0–P1 substrate, so it lands in P3 —
  **do not** front-load a fake Coach over invented data to chase the weight; that violates the "numbers
  never invented" and "traceable" non-negotiables and creates rework.
- **Parallelizable within a phase:** deterministic services (planner, dashboard projection, insights
  aggregation) and their agent wrappers can be built by separate tracks since the agent only *phrases* the
  deterministic result.

### Definition of Done (applies to every phase)
A phase is complete only when: (1) its exit gate passes on **real** data (no fabrication); (2) the mapped
§14 acceptance clauses demo end-to-end; (3) new strings exist in `he/ar/en` and render RTL; (4) no PII
reaches any prompt and AI disclosure shows where applicable; (5) the replaced legacy path is **deleted**,
not left dormant; (6) fallbacks still keep the app demoable without APIM/Mongo/agent infra; (7) every
learner-facing claim is traceable to a brain field or a `learning_events` row.

---

*End of architecture. Implement against §6–§9; keep every AI claim traceable to a brain field or a
`learning_events` row.*
