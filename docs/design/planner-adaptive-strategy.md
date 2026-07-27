# Adaptive Planner Strategy (720-aligned)

## Context

After the Kata content migration, the planner decides only *which objective* is
next and launches that objective's **first component by `order`** — identical for
every learner. As Kata fills with more objectives and components carrying real
difficulty metadata, the platform must decide *what next **and at what
difficulty/path***, adapting to how the learner is actually doing.

This design is **rewritten to honor the official 720 content spec** (הנחיות
לפיתוח תוכן תומך פלטפורמות 720). The key realization from the spec: it removes
almost all freedom at the **objective/unit** level (objectives are *linear*) and
concentrates every adaptive decision at the **component/path level within a
unit** — which it explicitly assigns to the platform. So the real work is the
within-unit picker, not objective-level cleverness.

## What the 720 spec mandates (the rules we must honor)

| Spec section | Rule | Consequence for us |
|---|---|---|
| §3 (end) | **"יעדי הלמידה בנויים לינארית"** — objectives are linear; you cannot do an objective before its predecessor | No difficulty/interest re-ranking of objectives. Walk the linear order. |
| §2, taxonomy | Objectives within a sub-topic are ordered by **rising complexity** | The linear order already encodes easy→hard; we don't re-sort it. |
| metadata | `prerequisiteLearningObjective` = provider-declared prior objective | Gate an objective until its prerequisites are achieved (on top of linear order). |
| §3.2 (modular) | **"התהלוך בין הרכיבים מתבצע על ידי המערכת, בהתאם להגדרות הספק ולנתוני הלומד (ביצועים, העדפות, היסטוריה)"** | The platform navigates components in a modular unit, using performance + preferences + history. This is our picker. |
| §2, §3.1 | Three mastery levels **בסיסי/ממוצע/מתקדם** define differentiated **paths within a unit**; never shown to the learner | Difficulty/path adaptation is mandated, internal-only. |
| §3.1 | Components that are pedagogically **שקולים** and share the same `order` are interchangeable; the system picks one **"תוך התבססות על ערך שקול ללומד"** | Group same-`order` components; choose one by learner fit + `isRequired`. |
| §3.2 (closed/hybrid) | A **closed** unit navigates its own items; the system does NOT pick sub-components. Hybrid = partial. | Gate the picker on unit type; never sequence inside a closed unit. |
| §3.3 | Passing an `isAssessment` component = **כשירות ביעד הלמידה**; any one assessment pass completes the objective | Route toward an assessment; `achieved` is set on assessment success. |
| metadata | `masteryLevel` is **not mandatory in תשפ"ז** | Lead difficulty decisions with `relativeDifficulty` (1–5); treat `masteryLevel` as an optional signal. |

**Left to us (the spec empowers but does not prescribe):** the actual selection
*algorithm* — how to weight performance/preferences/history/mastery-level/pace,
spaced review, and difficulty. That is the recommendation engine's job.

## Architecture — two layers

### Layer A — Linear objective walk (`planner.py`, deterministic)

Objectives are linear, so this stays simple and explainable:

1. **Spaced review first** — an `achieved` objective whose review window lapsed
   (`mastery.is_due_for_review`) or that failed after mastery (`needs_review`)
   resurfaces before new material. (Spec doesn't forbid review; it strengthens a
   weak pass.)
2. **Next linear objective** whose `prerequisiteLearningObjective`s are all
   achieved and that isn't yet mastered.
3. Interest stays a **tie-break only within equal rank** — never enough to jump
   the linear order.

**Remove** the difficulty/readiness re-ranking of objectives from the earlier
draft — the spec forbids reordering objectives.

**Cross-subject arbitration** (`planner.next_focus`): the 720 spec fixes order
*within* a sub-topic but is silent on choosing *between* subjects (math vs
science), so that's the platform's call. Rule: (1) **global spaced-review first**
— any objective due for review, across all subjects, most-overdue first (a
science skill due today beats brand-new math); (2) else **new material in the
most-behind subject** (lowest `mastered/total`), tie-broken by
**least-recently-practiced**, then fixed subject order (stable — can't ping-pong
every session). Resume (an open task) still precedes all of this in `_hero`.

**Objective order source:** the ministry's ordered `learningObjective` list is
still *"הרשימה בעבודה"* (in progress). Until it ships, `kata_catalog` derives an
interim order topologically from `prerequisiteLearningObjective` depth. When the
ordered list lands, replace the interim order with it (single seam in
`kata_catalog._order_objectives`).

### Layer B — Within-unit component picker (the adaptive engine)

New `content_catalog.select_component(objective_id, mastery_entry, signals, roadmap, locale)`,
run **only for modular/hybrid units**. `list_available_content` stays as the
candidate source; the picker chooses among its non-locked candidates.

Decision order (deterministic, each branch returns `(component, reason)`):

0. **Unit-type gate.** Infer type from structure (single component → *closed*;
   multiple ordered components → *modular*; mixed → *hybrid*). For a closed unit,
   launch the one component and let the content navigate its items — **do not
   pick sub-components**. Only proceed below for modular/hybrid components.
1. **Resume** an open `resume_token` component if incomplete.
2. **After-fail routing.** If the last assessment/practice failed (esp. with a
   misconception), route to a `recommended_after_fail` id — an easier/alternative
   representation. *(exists; formalized into the picker.)*
3. **Same-`order` equivalent selection.** Among candidates sharing the current
   `order` (pedagogically שקול), pick the one best matching the learner:
   `masteryLevel` band if present, else lower `relativeDifficulty` for a
   struggling learner / higher for a confident one; respect `isRequired`.
4. **Mastery-level path + skip-ahead.** Map the learner's mastery to a band and
   prefer components of that `masteryLevel`:
   - struggling (low `score_ewma`, `failures`, `wheel_spinning`) → **basic**,
     `instruction`/low `relativeDifficulty`; never skip intro.
   - on-track → next by `order` at matching difficulty.
   - confident (high `score_ewma` + `confidence`, streak, `level ≥ intermediate`)
     → step difficulty up; **skip already-mastered instruction** and advance
     toward the assessment.
5. **Assessment routing + readiness gate.** Only surface an `isAssessment`
   component once the learner has enough effortful practice success on the
   objective (e.g. `consecutive_successes ≥ N` or ≥K practice passes); otherwise
   route to more practice. Passing any assessment component sets `achieved`
   (competence) — already handled in `events`/`mastery`.
6. **Fallback** → earliest-by-`order` incomplete required component (today's
   behavior).

The picker consumes `learning_progress.project_unit_roadmap` states so it never
selects a `locked` component, and returns a `reason` string for coach
transparency + logging (same explainability principle as the planner).

## Signals available (nothing new to capture)

**Learner (brain `mastery.entry_for`):** `score_ewma`, `confidence`,
`consecutive_successes`, `level`, `failures`, `needs_review`, `misconceptions`;
plus `behavior_signals` (`rapid_guessing`/`wheel_spinning`) and
`current_state.pace`.

**Content (Kata, already normalized in `kata_client.normalize_component`):**
`order`, `purpose` (instruction/practice/both), `is_assessment`, `is_required`,
`relative_difficulty` (1–5), `mastery_level` (optional this year),
`cognitive_level`, `depth_level`, `recommended_after_fail`, `estimated_minutes`.

## Files to change

- `app/services/planner.py` — trim `plan_next` to the linear walk (review → next
  linear frontier); drop objective difficulty re-ranking.
- `app/services/content_catalog.py` — **new** `select_component(...)` (the picker)
  + a small tunable threshold block; keep `list_available_content` as the source
  and `recommended_after_fail` for branch 2.
- `app/agents/pedagogical.py` — `select_next` calls `select_component` instead of
  `candidates[0]`; `route_after_fail` already aligns with branch 2.
- `app/services/dashboard.py` — `_hero` uses the same picker so the dashboard
  "next" card and the agent agree.
- `app/services/kata_catalog.py` — `_order_objectives` seam documented as the
  place the ministry ordered-objective list replaces the interim topological
  order; add a `unit_type` inference helper (closed/modular/hybrid).
- `app/routes/agent.py` — `route/next` response gains `difficulty` + `reason`;
  log each pick to `tutor_decisions` for teacher insight + tuning.

## Config / thresholds (tunable, mirror `mastery.py` constants)

- band cutoffs (struggling / on-track / confident) on `score_ewma` + `confidence`;
- assessment-readiness threshold (`consecutive_successes ≥ N` or ≥K practice
  passes);
- skip-ahead aggressiveness (skip instruction entirely vs always show one intro).

## Testing

- Unit tests: synthetic mastery bands × a **multi-difficulty component fixture**
  → assert basic vs advanced vs assessment picks, lock-respect, after-fail
  routing, same-`order` equivalent choice, assessment gate, and closed-unit
  no-pick.
- Extend the flow driver: a fail-heavy learner → easier/after-fail; a streak
  learner → skip-ahead + earlier assessment.
- Staging has only 1 objective / 5 components, so seed a synthetic
  multi-difficulty Kata fixture (or mock `kata_catalog`) — the live catalog can't
  yet exercise sequencing.

## Open items (ministry-pending)

- **Ordered objective list** (*הרשימה בעבודה*) — replaces the interim topological
  order in `kata_catalog._order_objectives` when it ships.
- **`masteryLevel`** optional in תשפ"ז — picker must work from `relativeDifficulty`
  alone until levels are populated.
- **Unit type** has no explicit metadata field — inferred from structure until
  one is added.

## Product choices to confirm (defaults set, tunable)

1. Skip-ahead aggressiveness (skip instruction entirely for confident learners,
   or always show one intro?).
2. Assessment-readiness threshold (how much practice before the test unlocks?).
3. Whether the picker may advance *within* a unit past the current `order` stage
   for a strong learner, or only modulate difficulty within the stage. (Objective
   order is fixed by the spec; this is only about component order inside a unit.)
