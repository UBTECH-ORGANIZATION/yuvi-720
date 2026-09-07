# Redis for the two portals: what to cache, per slot, in what order

Status: plan, 2026-09-07, sized for 10,000 users. The two caches, the slot
settings and the local `.env` entry are created by `infra/redis/provision.sh`
(run it once, as an owner of the subscription); no application code reads
them yet.

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

## 3b. At ten thousand users

Assume 10,000 registered learners across roughly 350 classes of 30, about
400 teachers, and a school-hours peak of 2,000 learners in a lesson at once
with 150 teachers looking at a dashboard. Everything below follows from
those numbers.

**What breaks first is polling, not queries.** Two loops in the learner
portal run per open lesson tab:

| Loop | Today | At 2,000 concurrent lessons |
|---|---|---|
| Coach support state, every 2.5 s | brain read + five catalog lookups + an activity query | **800 requests a second**, each with a brain read |
| Lesson catalog projection, every 5 s | the heaviest handler in the app, per learner over every unit | **400 requests a second** of the heaviest handler |

No cache makes that acceptable; the learner already holds an SSE connection,
so both loops become pushes from the event fold. This is the single change
the design cannot do without.

**One process cannot carry it.** 2,000 learner SSE streams plus 150 teacher
streams on one uvicorn process is fine for I/O, but every cached projection
that misses is CPU on the same event loop, and one instance is one failure
domain. The target shape is **three P1v3 instances per slot** behind the
existing Front Door, which is only possible once the bus, presence and
cooldowns are in Redis. That moves the coordination phase ahead of the
long tail of read caching.

**Redis sizing.** Cache the learner-specific delta, never the whole payload:
the catalog response is 209 KB per learner because it carries the provider
units; those are global and cached once per language. The per-learner part
(progress state per component, the resume pointer) is a few KB.

| Item | Per key | Keys | Total |
|---|---:|---:|---:|
| learner catalog delta | 5 KB | 10,000 | 50 MB |
| learner dashboard projection | 11 KB | 10,000 | 110 MB |
| learner state document | 11 KB | 10,000 | 110 MB |
| chat tail, 20 turns, both roles | 20 KB | 10,000 | 200 MB |
| class snapshot + learnings + goals | 120 KB | 350 | 42 MB |
| Kata units and snapshot, three languages | 2 MB | 3 | 6 MB |
| presence, cooldowns, counters | 0.2 KB | 15,000 | 3 MB |

About 520 MB with every key populated at once, which never happens because
TTLs are minutes. Values are stored compressed (zlib, level 1; JSON of this
shape shrinks 6 to 10 times), so the working set is well under 200 MB.
Production is Balanced B1 (1 GB, replicated) with `allkeys-lru` as the
safety net; it scales up in place to B3 without a redeploy if the numbers
above turn out low. Dev is B0 (0.5 GB), no replication.

**Cosmos.** With the caches in place, the steady-state read load on the
production cluster is one brain read per learner event plus one class
fan-out per class per two minutes, instead of one class fan-out per teacher
screen and one brain read per unit per learner per five seconds. That is
the difference between needing a bigger Cosmos tier at 10,000 users and
not.

**Connections.** Redis pool of 20 per instance × 3 instances = 60 client
connections on a cache rated for thousands; SSE streams are terminated by
each instance and fanned out from Redis pub/sub, so a learner and their
teacher no longer need to land on the same instance.

## 3c. The reduced list

The full tables in section 4 are the inventory. At ten thousand users, only
these nine changes move the needle; everything else is a long tail to do
only when a measurement says so.

| # | Change | Why it is on the short list |
|---|---|---|
| 1 | Support state and lesson completion become pushes over the existing learner SSE; delete both polls | 1,200 requests a second at peak, gone |
| 2 | Drop `pathname` from the coach history effect; hoist the learner app bar above the route key | five requests and a spinner per navigation, gone |
| 3 | One Redis per slot, wired like the database, fail-open | the plumbing everything below needs |
| 4 | Version-bumped class cache for snapshot, learnings and goals | the three slowest teacher handlers; 350 classes × once per two minutes instead of per screen |
| 5 | Version-bumped learner cache for the catalog delta, the dashboard projection and the learner state document | the three slowest learner handlers and the eight-call-site document |
| 6 | Chat tails and working memory write-through | the panel opens from cache; every coach turn skips a Mongo read |
| 7 | Bus, presence, cooldowns and the alert counter on Redis | unlocks three instances per slot |
| 8 | Scale the slot to three instances; keep `WEB_CONCURRENCY=1` per container | one failure domain becomes three |
| 9 | Kata units and snapshot in Redis with refresh-ahead | a deploy or swap no longer cold-starts the catalog |

Dropped from the first pass: calendar, timetable, badge definitions, the
questionnaire, my-teachers, mood, moments, engagement, the profile long
tail, the pending count. Each is real but small at this scale, and each
gets cheaper on its own once the class and learner versions exist.

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

One day of code. `infra/redis/provision.sh` creates the two caches, waits
for them, sets both slots' sticky settings and appends the dev cache to
`backend/.env`, without printing a key. Nothing is cached until the code
lands.

**Resources.** Two caches in `rg-yuvi-720`, North Europe, the region the app
runs in. Azure Managed Redis, Balanced tier, TLS only, access keys stored as
app settings the same way the Mongo strings are:

| Slot | Resource | Size | Why |
|---|---|---|---|
| production | `redis-yuvi-720` | Balanced B1 (1 GB), high availability on | replicated, SLA; sized in 3b, scales in place to B3 |
| dev | `redis-yuvi-720-dev` | Balanced B0 (0.5 GB), no replication | cheapest tier; synthetic data |

**Kind.** The provisioning script defaults to Azure Cache for Redis
(Standard C1 production, Basic C0 dev, TLS on 6380): this subscription is a
sponsorship offer and Azure Managed Redis answered `InsufficientCapacity`
for every size in two regions within seconds, which is the offer having no
allocation for that family, not the regions being full. The app speaks
plain Redis either way; `CACHE_KIND=managed` switches the script back to
the Balanced sizes above when the offer allows them. The classic tier's
retirement is announced for 2028-09-30.

No `english` cache: that slot has no workflow and no traffic; it falls back
to `SPARK_CACHE=memory`. Both caches: TLS only, port 10000, `allkeys-lru`,
Enterprise clustering policy so a plain (non-cluster) client sees one
endpoint, access-key auth for now. The local `backend/.env` points at the
dev cache, as it points at the dev database.

**Settings, mirroring `MONGODB_CONNECTION_STRING` exactly.**

| Setting | Sticky | Role |
|---|---|---|
| `REDIS_CONNECTION_STRING` | yes | `rediss://…` for the slot's own cache. Sticky so a swap leaves the cache behind, as it leaves the database behind. |
| `REDIS_PRODUCTION_HOSTS` | no | override for the production-host guard; defaults in code to the production cache host |
| `SPARK_CACHE` | yes | `redis` on both slots and locally; `memory` = the deliberate no-Redis path (CI, `english`). Matches `SPARK_STORAGE=json`. |
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
asks for and what unblocks more than one instance. At ten thousand users
it runs right after Phase 1, before the long tail of Phase 2 (see 3c).

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
- **Network exposure.** Both caches start on their public endpoint with
  TLS and key auth, which is exactly how the two Cosmos clusters are exposed
  today (public access enabled, no private endpoints). The dev slot has no
  VNet integration, so dev cannot do otherwise. Production is integrated
  into `vnet-yuvi-lrs` with route-all for the LRS egress firewall, so a
  private endpoint plus a `privatelink.*.redis.azure.net` DNS zone is
  possible there; it touches the firewall's routing, so it is a deliberate
  follow-up (`PUBLIC_ACCESS=Disabled` in the script), not a default.
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
