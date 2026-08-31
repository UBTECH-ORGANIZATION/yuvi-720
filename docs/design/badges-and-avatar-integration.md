# Badges + Badge-as-Avatar Integration (post-Kata)

## Context

We have a finished badge visual system (the "Yuvi Learning Badges" artifact): a
self-contained `badgeSVG()` that renders flat, theme-aware coins — **6 subject
families** (science/math/language/discovery/stem + a `world` capstone), **3 tiers**
(bronze 1★ / silver 2★ / gold 3★), and **3 states** (locked / in-progress with a
fill ring / earned). Now that content runs on real Kata, badges can be computed
from real mastery, and the user wants them **usable as an optional profile-avatar
picture** (replacing today's initial-letter avatar), with a **screen to pick one**.

Two pieces of infra already exist and this plan builds on them:
- `learner_state.avatar` + `learner_state.avatar_unlocks` (fields already present;
  `get_learner_state`/`update_learner_state` allow-list them) — the Yuvi-studio 3D
  avatar customizer already reads/writes them (`features/Yuvi-studio/useStudioDesign.ts`).
- The dashboard already emits an `avatar` (currently `display_name[0]`) and a
  `hero.mode === "complete"` state (bare today).

## How badges are earned (deterministic, from the Kata-fed brain)

Badges are a **projection of the brain**, same discipline as the dashboard — no
invented state. A backend `badges.py` service computes, per learner:

- **Subject badge** (one per subject present in the Kata catalog): progress =
  `mastered / total` objectives for that subject (already computed by
  `planner.plan_next` → `{mastered, total}`). Map to state/tier:
  - `total == 0` or `mastered == 0` → **locked** (or in-progress at 0 once started);
  - `0 < ratio < 1` → **in-progress**, ring = `ratio`;
  - `ratio >= 1` → **earned**; **tier** by thresholds on breadth × depth — e.g.
    bronze = all objectives touched/basic, silver = all at ≥ intermediate, gold =
    all `achieved` at advanced (reuse `mastery.entry.level`). Thresholds live in a
    tunable block.
- **World badge** (`world` family — "Arrival Valley"): earned when a learning
  world is completed (all its objectives mastered).
  Ties to the existing world-completion signal; gold + confetti (the capstone).
- **`certifies`** text (for the teacher view) = the subject's objective titles
  (`kata_catalog.localized_objective_title`), so a badge reads as real evidence.

Subject → glyph/color mapping mirrors the artifact (`science→flask`, `math→math`,
`language→book`, `discovery→planet`, `stem→gear`, `world→valley`). Only subjects
that exist in Kata render; the set grows as the catalog grows.

**Persistence:** newly-earned badges are written to `learner_state.badges`
(add to `_empty_state` + the `update_learner_state` allow-list, next to the
existing `avatar`/`avatar_unlocks`). Earning a badge may also append a cosmetic id
to `avatar_unlocks` (the artifact's "grants Crown/Space-helmet" idea) — optional,
wires into Yuvi-studio.

## Frontend: the reusable `<Badge>` component

Port `badgeSVG()` into `frontend/src/components/Badge.tsx`:
```
<Badge subject="science" glyph="flask" tier="gold"
       state="inprogress" progress={0.68} size={120} title="Lab Explorer" mini? />
```
Pure SVG, theme-aware (it already reads CSS vars / `prefers-color-scheme`),
crisp 32px→full. A `<BadgeToast>` (task-complete "+N% to silver") and the
earn-celebration (confetti) come from the same artifact code. DTO from the badges
endpoint drives them — no logic in the component.

## Where badges live in the UI

1. **Badge shelf screen** (new route, e.g. `/badges` or a tab in a profile page) —
   the artifact's "Kid profile — badge shelf": earned coins, in-progress rings,
   locked silhouettes grouped by subject, with "what's left". This is also the
   **avatar picker** surface (below).
2. **Task-complete toast** — on lesson completion (`LessonPage` already detects
   completion via the xAPI/catalog path), nudge the relevant subject badge ring
   forward with a `+N%` toast.
3. **Earn celebration** — when a badge flips to earned, the confetti moment
   (reuse the completion dialog surface in `LessonPage`).
4. **All-completed hero card** (below) — showcases the earned `world` badge.
5. **Teacher view** — the artifact's table (badge · tier · certifies · progress)
   drops into `TeacherViewPage`; teacher-facing may show tier/level (internal
   signals are allowed for teachers, unlike learners).

## Badge-as-avatar (the core ask)

Today the profile avatar is the initial letter (`dashboard.avatar = display_name[0]`,
rendered in the app bar / profile). Change: let a learner **pick one of their
EARNED badges as their profile picture**, else fall back to the initial letter (or
the Yuvi 3D avatar).

- **Model:** store the choice in `learner_state.avatar` as a small tagged object,
  e.g. `{ "kind": "badge", "badge": {subject, glyph, tier} }`, or `{ "kind":
  "initial" }` (default), or `{ "kind": "yuvi" }` (the studio avatar). This keeps
  one avatar field authoritative across the app. (Yuvi-studio currently stores a
  design object in `avatar`; namespace it under `kind: "yuvi"` so both coexist.)
- **Picker:** on the badge shelf, each **earned** badge gets a "Use as picture"
  affordance; selecting it `updateLearnerState({ avatar: {kind:"badge", badge} })`.
  Locked/in-progress badges aren't selectable (a real "unlock to use" hook).
- **Render seam:** a single `<ProfileAvatar>` component resolves the avatar field →
  a `<Badge mini>` when `kind==="badge"`, the initial-letter chip otherwise. Use it
  everywhere the avatar shows (app bar, dashboard hero/profile). One component, so
  the picked badge appears consistently.
- **Backend:** `dashboard.avatar` becomes this resolved descriptor (or the frontend
  reads `learner_state.avatar` directly, as Yuvi-studio does). Validate on write
  that the chosen badge is actually earned (server-side, against `badges.py`).

## The "all-completed" hero card

Today `hero.mode === "complete"` shows only fallback text + no CTA
(`DashboardHero.tsx:71-79`). Redesign it as a **celebration that showcases the
world-clear badge**:
- Big earned `world` "Arrival Valley" gold `<Badge>` (with the artifact's glow +
  optional confetti), replacing the `HeroInteractive` visual in complete mode.
- Congratulatory title/lead (`sdash.hero.complete.*`, extend the he/ar/en locale
  keys), e.g. "You've cleared everything available — here's your capstone."
- CTAs: **"See my badges"** (→ badge shelf) and **"Review learning"** (`onBrowse`),
  since there's no next lesson to start.
- Honest copy: "available" content — as Kata adds objectives, `complete` recedes
  and the normal `next` hero returns automatically.

## Backend endpoints

- `GET /api/badges` (or fold into the dashboard/brain projection) → `[{subject,
  glyph, tier, title, state, progress, certifies, earned_at}]` computed by
  `badges.py` from the brain (prime `kata_catalog.ensure_loaded()` first).
- `POST /api/learner-state {avatar}` — already exists (`update_learner_state`);
  extend validation to accept the tagged avatar object and verify a chosen badge
  is earned.
- Badge earn is detected at ingest/dashboard projection time (compare freshly
  computed badges vs `learner_state.badges`); newly-earned ones drive the toast /
  celebration and are persisted.

## Files

- **New:** `backend/app/services/badges.py` (projection), `frontend/src/components/Badge.tsx`,
  `frontend/src/components/ProfileAvatar.tsx`, a badge-shelf screen under
  `frontend/src/features/badges/`.
- **Edit:** `backend/learner_state.py` (+`badges` field, allow-list), `dashboard.py`
  (avatar descriptor + expose badges or a separate endpoint), `DashboardHero.tsx`
  (all-completed card), `LessonPage.tsx` (task-complete toast + earn celebration),
  `TeacherViewPage.tsx` (evidence table), the app bar/profile avatar → `<ProfileAvatar>`,
  locale files (`sdash.hero.complete.*`, badge strings).

## Sequencing (suggested)

1. `<Badge>` component + `badges.py` projection + `GET /api/badges` (read-only; no
   UI yet) — verify tiers/states against gal's real mastery.
2. Badge shelf screen + `<ProfileAvatar>` + the avatar picker (persist to
   `learner_state.avatar`, render app-bar/hero).
3. All-completed hero card (world badge showcase).
4. Task-complete toast + earn celebration in `LessonPage`.
5. Teacher evidence table.

## Open product choices

1. **Tier thresholds** — what breadth/depth earns bronze vs silver vs gold
   (defaults proposed above; tunable).
2. **Subject set** — badges only for Kata subjects present (math/science today),
   or pre-show locked coins for the artifact's full set (language/discovery/stem)
   as "coming soon"?
3. **Avatar precedence** — if a learner has both a Yuvi-studio 3D avatar and picks
   a badge, which wins as the small profile picture? (Proposed: the explicit
   pick wins; `kind` field disambiguates.)
4. **World badge trigger** — tie to full-subject mastery
   or a dedicated capstone assessment?
