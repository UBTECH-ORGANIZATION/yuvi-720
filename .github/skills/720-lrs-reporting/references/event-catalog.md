# 720 Event Catalog — all 14 families, verbs, and live trigger wiring

Golden fixtures: `docs/LRS/postman/720-LRS.postman_collection.json` (30 bodies). Spec: `docs/LRS/720 התממשקות לLRS 1.0` PDF (overrides the general MoE list). Builders: `lrs/statements.py`; wiring calls: `reporter.report_*`.

## Platform events — Yuvi generates (✅ = wired live)

| # | Family | Object IRI | Verbs | Trigger (where wired) |
|---|---|---|---|---|
| 1 | **Session** ✅ | `{d}/session/{sid}` | `enter` (device extensions), `suspend`, `resume`, `exit` (+`result.duration` = exit−enter) | login/logout in `routes/auth.py`; suspend/resume = frontend visibilitychange/pagehide beacon (`AuthProvider.tsx`) → `/api/auth/session/{suspend|resume}` |
| 2 | **Dashboard** ✅ | `{d}/dashboard/{type}` | `viewed` (+opt `result.duration`) | `student-personal` in `routes/dashboard.py`; `student-view`/`learning-group` in `routes/teacher.py` **after** the access check. `extensions/dashboardId`: student types → exidentifier, group types → NMM (auto-filled by the builder) |
| 3 | **Agency questionnaire** (onboarding) ✅ | `{d}/agency/{PRE\|POST}` type `questionnaire` | `initialized`, `answered` (per question: `result.response`+`score{min,max,raw}`, parent=agency), `completed` (+duration) | Yuvi's onboarding = mapping→results span: `initialized` on first `/api/questionnaire` load; `answered` per answer at `/api/submit`; `completed` on the `profile_summary_progress.completed` transition in `routes/learner_state.py`; duration = results-approved − mapping-start (`agency_started_at` on the users doc) |
| 4 | **Conversation (bot)** ✅ | `{d}/conversation/{id}` | `interacted` (one per chat turn), `rated` (`result.response` like/dislike) | student turn + bot turn in `coach/stream`; proactive nudges = bot turn with `conversationTrigger` mapped (idle→`idle-time`, misconception, success→`success-effort`) + `helpType=bot-help-offer`. Extensions: speaker/conversationTrigger/helpType/componentId/itemId — **chat text is never sent**. `rated`: builder ready, wiring waits for a like/dislike UI |
| 5 | **Reflection questionnaire** ✅ | `{d}/reflection/{qid}` type `questionnaire` | `initialized` (`extensions/reflactionTrigger`), `answered` (open→response XOR rating→score), `skipped`, `completed` (+duration) | personalized post-lesson flow: `services/reflection_flow.py` + `/api/agent/reflection/*` routes + `ReflectionPanel` in the LessonPage completion dialog (fires on `component-completed`). Questions generated from the session's real evidence; `system_estimate` computed server-side (never client-supplied); all 4 verbs live-verified (204) |
| 6 | **Mentor-student meeting** ✅ | `{d}/mentor-student-meeting/{id}` | `completed` (extensions mentor/student/meetingDate/mentoringPhase) | `POST /api/mentoring` in `routes/mentoring.py` |
| 7 | **Student goal** ✅(init) | `{d}/student-goal/{id}` (definition.extensions/goalType) | `initialized`, `updated`, `completed`; `context.instructor` when a teacher acts | `initialized` when a shared mentoring conversation mirrors a goal; updated/completed wait for goal-edit UI |
| 8 | **Help request** ✅ | the component/item asked from | `requested` (extensions helpSource `content\|platform`, helpType `hint\|explanation`) | the hint/explanation button → `coach/support` in `routes/agent.py` |
| 9 | **Selection (non-learning)** | choice object | `selected` — choice-type in `contextActivities.category` (`learningType/practiceDecision/isUnderstood/isRepeat/externalLearning`), value in `result.response` | mostly content-origin (forwarded); platform choice points use the same builder |

## Content events — received from Kata, enriched + forwarded ✅

Arrive at `/api/xapi` (Kata relay) → `events.ingest_statement` (first sight only) → `_forward_to_moe_lrs` → `enriched_content_statement`: actor swapped to exidentifier, envelope merged (incl. content-vendor/ecat), content's verb/object/result/parent/metadata preserved, NEW outbound id. Ledger `source="kata"`.

| # | Family | Verbs |
|---|---|---|
| 10 | **Component** | `initialized`, `completed` (`result.success`, `score.scaled`, `duration`) |
| 11 | **Item: questionnaire** | `initialized`, `completed` (score+duration) |
| 12 | **Question** | `answered` (response/success/score; extensions questionId/questionType/attemptNumber) |
| 13 | **Item skip** | `skipped` (every item type must support it; parent = container) |
| 14 | **Media** | `played`/`paused`/`completed` (extensions mediaFormat/mediaPosition/mediaDuration; `result.duration` = watch time) |

## Spec inconsistencies (build to the enum, keep configurable, confirm with MoE)
- `interacted` example uses `conversationTrigger:"helpRequest"`; the enum says `student-request` — we send the enum.
- `question` objects appear as both `activities/question` and `activities/item` — object_type is a parameter.
- Session `enter` is reported for any login (incl. teacher-role users) under the stub identity; revisit with real identity mapping.
