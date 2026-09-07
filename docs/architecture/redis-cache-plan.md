# Redis for the two portals: what to cache, per slot, in what order

Status: plan, 2026-09-07. Nothing here is built yet.

The complaint: going back and forth between screens in the teacher portal and
the student portal re-loads screens that were already loaded, and the chats
reopen slowly. This document says why, what a Redis per slot buys, what it
does not buy, and the order of work.

## 1. Why screens reload

Three facts explain almost all of it. None of them is a database problem.

1. **Every navigation remounts the page.** `frontend/src/app/App.tsx:440`
   keys the route element by `language:pathname`, and `pathname` from
   `useRoute()` includes the query string. Every page's `useState` and
   `useEffect` data is thrown away on every route change, and on every
   `?tab=`, `?conversation=`, `?component=` change too.
2. **Nothing on the client caches a response.** No React Query, no SWR, no
   module-level map. `services/api.ts` is a bare `fetch`. The only shared
   thing is the ref-counted SSE connection in `services/realtime.ts`.
3. **The backend's caches are per process and short.** A single uvicorn
   process per slot (`Dockerfile:47`, no workers). Its in-memory TTL dicts
   (`teacher_bands` 60 s, `learning_catalog` units 300 s, `learning_analytics`
   600 s) die on every deploy and every slot swap, and most of the heavy
   handlers have no cache at all.

Two specific bugs sit on top of these:

- The coach panel reloads its conversation list and messages **on every
  navigation** because `pathname` is in the dependency list of the history
  effect (`frontend/src/providers/CompanionProvider.tsx:888`). The panel
  visibly empties and shows a spinner even though nothing changed. This is
  "the chats are slow".
- The learner app bar is rendered inside every page instead of in a shell
  above the route key, so `/api/me/messages-unread`, `/api/tasks` and
  `/api/learner-state` fire on every navigation. The teacher lane already
  solves this with `TeacherShell`.

## 2. What was measured

Three requests each, against the dev backend on this laptop talking to the
dev Cosmos cluster in North Europe. Every number is dominated by round trips,
so read them as query counts, not as production latency. In Azure the same
handlers run roughly 10 to 20 times faster, and the ranking is unchanged.

| Endpoint | cold | warm | what it does |
|---|---:|---:|---|
| `GET /api/learning/catalog` | 23.8 s | 12 s | per unit: `get_brain` + unit events + illustration, for every unit, per learner. **Polled every 5 s during a lesson.** |
| `GET /api/brain/{id}/dashboard` | 13.3 s | 6 s | two event scans, decisions, activeness, a write-back, projection |
| `GET /api/badges` | 11 s | 4.3 s | every event the child ever produced |
| `GET /api/notifications` | 3.8 s | 4.5 s | runs a deadline reconcile (a write) on every read |
| `GET /api/tasks` | 2.1 s | 1.8 s | fired by the app bar on every navigation, and again by the tasks page |
| `GET /api/teacher/groups/{g}/learnings` | 24.5 s | 25 s | three roster fan-outs in one handler, no cache; refetched every time the focus panel opens |
| `GET /api/teacher/roster` | 28 s | 1.5 s | cheap when warm, but refetched on **every preference write** (class, subject, period, theme) |
| `GET /api/teacher/groups/{g}/goals` | 21 s | 9 s | N × (conversations + enrichment); the goals page also fetches the snapshot only for names |
| `GET /api/teacher/students/{id}` | 14.5 s | 9 s | one of seven parallel requests on profile mount |
| `GET /api/teacher/groups/{g}/moments` | 15 s | 3.8 s | N × moments per learner, on every return to the home screen |
| `GET /api/teacher/goals/pending-count` | 9.4 s | 8.4 s | walks groups → learners → counts, every 120 s per open tab |
| `GET /api/teacher/groups/{g}/engagement` | 7.4 s | 7.1 s | N × events with a 6000-row limit |
| `GET /api/teacher/groups/{g}/gaps` | 4.9 s | 7.2 s | N × `get_brain` + catalog |
| `GET /api/teacher/groups/{g}/focus` | 5.9 s | 4.8 s | **serial** `await get_brain()` per learner, no gather |
| `GET /api/teacher/groups/{g}/snapshot` | 2.7 s | 0.3 s | the only heavy handler with a cache today (60 s, in process) |

The class has 7 learners. The teacher home screen fires snapshot, engagement,
gaps, mood and moments on every mount. The student profile fires seven
requests on mount and all of them again on any query-string change.

## 3. What Redis buys, and what it does not

Redis buys three things here:

- **Survival.** A cache that outlives a deploy, a swap and a restart. Today
  every deploy cold-starts the Kata catalog, every TTL dict and presence.
- **Sharing across processes.** The precondition for `WEB_CONCURRENCY > 1`
  and for a second instance. The architecture diagram already reserves Redis
  for this (bus, presence, cooldowns, counters) as roadmap step 4.
- **Room.** Larger and more numerous cached projections than one process's
  heap should hold.

Redis does not fix the remount, the `pathname` dependency, the 5-second poll
or the duplicate fetches. Those are frontend changes and they remove more
load than any cache. They ship first.

## 4. The order of work

### Phase 0. Free wins on the client and the obvious backend fixes

No Redis. One or two days. Biggest visible effect on "back and forth".

| # | Change | Where | Removes |
|---|---|---|---|
| 0.1 | Drop `pathname` from the coach history effect; reload history only on conversation mode, lesson epoch and explicit selection | `CompanionProvider.tsx:845-888` | two requests and a spinner per navigation in the chat panel |
| 0.2 | Hoist `LearnerAppBar` into a `LearnerShell` above the route key, like `TeacherShell` | `App.tsx:440-492`, ten page files | three requests per navigation |
| 0.3 | Key `TeacherRosterProvider` and `NotificationsProvider` effects on `user?.user_id`, not the `user` object (the pattern `TeacherScopeProvider.tsx:148` documents) | `TeacherRosterProvider.tsx:60`, `NotificationsProvider.tsx:86` | a roster and a notifications fetch on every preference write |
| 0.4 | Feed the name-only snapshot callers from `useTeacherRoster()` | Goals `:76`, Messages `:125`, `LaunchDialog.tsx:80`, tour `App.tsx:450` | four of the six snapshot call sites |
| 0.5 | Replace the lesson page's 5 s full-catalog poll with the existing learner SSE trigger channel (the fold already publishes completion), keep a 30 s safety poll | `LessonPage.tsx:298-317` | 12 catalog projections a minute per open lesson |
| 0.6 | Skip the dashboard effects when `/student-dashboard/chat` or `/calendar` is the sub-route | `StudentDashboardPage.tsx:47-89` | three heavy requests the pane never renders |
| 0.7 | `gather` the serial brain loop in the focus handler | `teacher_students.py:1516` | N × round trip |
| 0.8 | Move the deadline reconcile off the notifications read path into the fold or a timer | `routes/notifications.py:23-31` | a write on every read |
| 0.9 | Consider keying the route element on `pathname` without `search` and letting pages react to query changes with effects. Riskier: pages today rely on the remount. Do it per page, starting with the student profile `?tab=` | `App.tsx:440` | the seven-request burst on tab change |

### Phase 1. One Redis per slot, wired like the two databases

One day of code plus the Azure resources. Nothing is cached yet; this is
the plumbing and the guards.

**Resources.** Two caches in `rg-yuvi-720`, North Europe, the region the app
runs in. Azure Managed Redis, Balanced tier, TLS only, access keys stored as
app settings the same way the Mongo strings are:

| Slot | Resource | Size | Why |
|---|---|---|---|
| production | `redis-yuvi-720` | Balanced B1 (1 GB) | replicated, SLA; the projections for a whole school fit many times over |
| dev | `redis-yuvi-720-dev` | Balanced B0 (0.5 GB) | cheapest tier; synthetic data |

No `english` cache: that slot has no workflow and no traffic; it falls back
to `SPARK_CACHE=memory`.

**Settings, mirroring `MONGODB_CONNECTION_STRING` exactly.**

| Setting | Sticky | Role |
|---|---|---|
| `REDIS_CONNECTION_STRING` | yes | `rediss://…` for the slot's own cache. Sticky so a swap leaves the cache behind, as it leaves the database behind. |
| `REDIS_PRODUCTION_HOSTS` | no | override for the production-host guard; defaults in code to the production cache host |
| `SPARK_CACHE` | yes | `memory` = deliberate no-Redis path (CI, local, `english`). Matches `SPARK_STORAGE=json`. |
| `SPARK_ALLOW_PRODUCTION_REDIS` | no | one-off escape hatch with the same 🚨 banner as `SPARK_ALLOW_PRODUCTION_DB` |

**Code.** `backend/app/core/cache.py` mirrors `core/database.py` function for
function: `connection_string()`, `cache_mode()` (non-raising, hot-path safe),
`connection_host()` that never leaks the password, `is_production_host()`,
`describe_line()`, `verify_configuration()` (idempotent, three failure modes:
production without Redis, no Redis and no `SPARK_CACHE=memory`, production
host from a non-production environment), `announce()`. Called from
`create_app()` next to the database checks and from the client factory so
scripts are covered.

One async client, singleton, bounded pool of 20, connect timeout 50 ms,
operation timeout 100 ms, the same reasoning as the Mongo pool comment in
`brain/repository.py:60-70`. `redis>=5,<6` plus
`opentelemetry-instrumentation-redis` so cache latency shows in App Insights.

**Fail open, always.** Every existing cache in the codebase degrades rather
than raises. A Redis timeout returns a miss and the handler computes. Worst
case with Redis down is today.

**Helper.** One decorator and one primitive:

```python
@cached(key=lambda gid, lang, days: f"grp:{gid}:{{ver:grp:{gid}}}:snapshot:{lang}:{days}", ttl=120)
async def group_insights(...): ...

await bump("grp", gid)   # from the event fold; invalidates every key of that class
```

Keys are `spark:{env}:v1:{scope}:{id}:{version}:{name}:{args}`. `{env}` is
`database.environment_name()`, so dev and production can never read each
other's entries even if a string is mispointed. `{version}` is an `INCR`
counter per class and per learner. Invalidation is a bump, never a `SCAN`
or a pattern delete. Every key has a TTL, 24 h at most, so drift self-heals.
The bump is debounced with `SET NX EX 20` so a live lesson does not thrash
the class cache on every answer.

**Workflows.** Add `REDIS_CONNECTION_STRING` and `SPARK_CACHE` to the dev
`--slot-settings` block and the required-settings gate in `deploy-spark.yml`;
add a "refuse to deploy dev against the production Redis" step next to the
Mongo one (host only, never the string); extend the pre-swap check to assert
the production slot's Redis host; add the soft warning in
`deploy-production-ref.yml`; `SPARK_CACHE: memory` in `ci.yml` beside
`SPARK_STORAGE: json`.

### Phase 2. Cache the reads, in order of measured pain

Two to three days for the learner side, two to three for the teacher side.
Each row is one change with one invalidation seam.

**Where invalidation lives.** Almost every heavy read is a projection of
events and brain state, and both change in one place: the event fold in
`services/events.py` and `apply_brain_updates`. The fold bumps the learner's
version and, through the roster, the class version. Org writes bump the
teacher's version. That is three seams for the whole table.

Learner portal:

| # | What | Key | TTL | Bumped by |
|---|---|---|---|---|
| L1 | Learning catalog projection (`learning_catalog.read_catalog`) | `learner:{id}:{ver}:catalog:{lang}:{catgen}` | 300 s | fold, session create, path choice |
| L2 | Kata units per language and the catalog snapshot (promote the two in-process dicts) | `kata:units:{lang}:{catgen}`, `kata:snapshot:{catgen}` | 300 s, refresh ahead | catalog import (`catgen` = `kata_catalog` load stamp) |
| L3 | Dashboard projection (`routes/brain.read_dashboard`); move the activeness write-back into the fold | `learner:{id}:{ver}:dash:{lang}` | 300 s | fold, goal write, teacher pin |
| L4 | Coach support state, global half only (ordinals, parts, teaching items per component) | `comp:{component_id}:{lang}:structure` | 1 h | catalog import |
| L5 | Learner state document (eight call sites) | `learner:{id}:state` | 300 s, write-through in `learner_state.save` | any learner-state write |
| L6 | Badges definitions per language; learner earn state stays live | `badges:defs:{lang}` | 24 h | content deploy |
| L7 | Mapping questionnaire, my teachers, tasks list | `content:questionnaire:{lang}` 24 h; `learner:{id}:teachers` 15 min; `learner:{id}:{ver}:tasks` 60 s | org writes, assign, submit |

Chats (both portals):

| # | What | Key | TTL | Bumped by |
|---|---|---|---|---|
| C1 | Coach conversation list per mode and the first page of messages per conversation | `learner:{id}:chat:{mode}:list`, `conv:{cid}:tail` | 600 s, write-through on `append_turn` | append, create, delete, end-lesson |
| C2 | `sessions.get_recent` and `get_conversation_memory`, read on every coach turn | `agent:sess:{id}:{session}:{role}` | 300 s, write-through | append, summarise, end-lesson |
| C3 | Teacher assistant threads and tail, and the resolved scope (`_resolve_scope` runs on every message) | `teacher:{id}:threads`, `thread:{tid}:tail`, `teacher:{id}:{ver}:scope` | 600 s / 15 min | append; org writes |

Teacher portal:

| # | What | Key | TTL | Bumped by |
|---|---|---|---|---|
| T1 | Group snapshot (promote `teacher_bands._ttl_cache`) | `grp:{gid}:{ver}:snapshot:{lang}:{days}` | 120 s | class bump |
| T2 | Group learnings, pulse and gaps (the 25 s handler) | `grp:{gid}:{ver}:learnings:{lang}` | 600 s | class bump |
| T3 | Engagement, mood, gaps, moments, focus | `grp:{gid}:{ver}:{name}:{args}` | 300 s | class bump; pin-next for focus |
| T4 | Group goals and pending count | `grp:{gid}:{ver}:goals`, `teacher:{id}:{ver}:pending` | 60 s | goal writes bump the class |
| T5 | Roster per teacher, groups, subgroups, subjects | `teacher:{id}:{ver}:roster` and friends | 15 min | org and subgroup writes |
| T6 | Student profile bundle: detail, activity, badges, trends, scores, objectives, roadmap | `learner:{id}:{ver}:{name}:{lang}` | 300 s | learner bump; insight writes |
| T7 | Calendar range and timetable | `grp:{gid}:{ver}:cal:{from}:{to}:{scope}`, `grp:{gid}:timetable` | 300 s / 30 min | calendar and timetable writes |

Deliberately not cached: `content_review._cache` (child-authored text, the
module's own comment forbids persisting it), the whole coach bundle (too
volatile; cache its inputs L2, L3, L5, C2 instead), the LLM outputs that are
already Mongo-cached with fingerprints (explainer, goal suggestions, digests).

### Phase 3. Coordination on Redis

Two to three days. Not about speed; this is what the architecture diagram
asks for and what unblocks a second instance and `WEB_CONCURRENCY > 1`.

- `realtime._subscribers` → Redis pub/sub on the existing
  `learner:/user:/teacher:/group:` channel names. One file, no caller changes.
- `presence._state` and offline timers → keys with TTL. Removes the boot
  rehydration and the 20 s `getLive` merge poll.
- `triggers.*` cooldown dicts → `SET NX EX`.
- `teacher_alerts._seq` → `INCR` (today's read-modify-write would issue
  duplicate sequence numbers across instances).
- `events._brain_fold_locks` → a Redis lock. Correctness, not speed.
- `support._public_hits` → a real distributed rate limiter.

## 5. Targets and how to check them

- A screen the teacher has already visited returns in under 300 ms of server
  time on the second visit. Measured by the App Insights request table,
  split by `cloud_RoleName` per slot.
- The coach panel opens with history in under 100 ms and never shows the
  empty state on navigation.
- A lesson tab costs one request per real completion, not twelve a minute.
- Redis down: no 5xx, latency returns to today's numbers. Verified by
  pointing the dev slot at a wrong host for one deploy.

## 6. Risks

- **Staleness after an answer.** Handled by bumping the learner and class
  version in the fold. The fold is the single write seam; anything that
  writes brain state outside it (scripts, the nightly content job) must
  bump too. The 24 h TTL cap bounds the damage if one is missed.
- **Personal data in the cache.** The cache holds the same projections Mongo
  holds, nothing more; chat text is only cached as the tail Mongo already
  stores. TLS in transit, encryption at rest by the platform. Keys carry
  ids, never names. `content_review` stays out.
- **Cost.** Two Balanced caches, on the order of tens of dollars a month
  together. Verify at creation.
- **Swap semantics.** The string is sticky, so production always talks to
  the production cache. The version counters live in each cache, so a swap
  never mixes them.

## 7. Open questions

- Whether to key the route element on `pathname` alone (0.9). It fixes the
  profile-tab burst but changes the contract every page relies on.
- Whether the lesson completion push should ride the existing learner
  trigger SSE or a dedicated `learning:` topic.
- Entra authentication for Redis instead of access keys. Keys match the Mongo
  pattern today; Entra is the better end state and can come with Phase 3.
