# XP and Sparks Product Specification

Status: Proposed

## 1. Product Decision

Yuvilab Spark will have two complementary reward systems:

- **Sparks** are spendable currency. Learners earn and receive Sparks, then choose how to spend them in Yubi Studio.
- **XP** is permanent progression. XP is never spent, transferred, lost, or reduced. It determines the learner's level from 1 to 50.

XP does not replace Sparks, streaks, mastery, or curriculum progress. A level is a game-progression signal, not a grade and not evidence of subject mastery. The product must never compare one learner's XP or level with another learner's.

## 2. Current Product Surfaces

The existing system already provides most of the integration points needed for XP:

| Surface | Current behavior | XP opportunity |
|---|---|---|
| Personal objectives | Sparks are paid for `started`, `progressed`, `summarized`, and one help request | Award stage XP for the learner's first objective; later objectives award XP only when completed |
| Teacher kudos | A teacher can optionally give 10, 20, or 40 Sparks | Do not grant XP; XP should represent learner activity, not teacher discretion |
| Teacher Quests | The teacher specifies the Sparks granted when the quest is completed | Award 20 XP only when the entire Teacher Quest is finished |
| Learning hierarchy | Mathematics and Science contain learning goals; goals contain learning modules; modules contain components | Award 15 XP for a completed module and 50 XP for a completed learning goal; components award no XP |
| Asking for learning support | Hint/explanation/help usage is tracked | Award XP only at the lifetime milestones of 30, 60, and 90 qualifying requests |
| Streaks | Permanently unlock cosmetics and room props | Keep independent; level rewards use separate acquisition rules |
| Yubi Studio | Sparks purchase cosmetics; some items are earned; server enforces 20 minutes per hour | Levels can unlock room features and new level-exclusive furniture that is unavailable in the catalog |

Relevant owning code:

- `backend/app/services/rewards/wallet.py`: server-authoritative Sparks wallet and idempotent ledger.
- `backend/app/services/events.py`: normalized learning events and exact component completion detection.
- `backend/app/services/tasks/attempts.py`: Teacher Quest submission and learner-facing finished-state response.
- `backend/app/services/unlocks.py`: earned avatar and room unlock rules.
- `backend/app/services/studio_time.py`: server-authoritative Yubi Studio time budget.
- `frontend/src/components/SparkPanel.tsx`: Sparks balance, earning explanation, and history.
- `frontend/src/features/Yuvi-studio/useStudioDesign.ts`: Studio catalog, ownership, and purchase state.

## 3. Design Principles

1. **Reward meaningful action, not correctness.** XP recognizes configured completion and support-use milestones. It must not be multiplied by score, mastery, speed, or fewer hints.
2. **One event, one award.** Every XP award has a deterministic idempotency key tied to an authoritative source event.
3. **No farming.** Replays, reloads, duplicate xAPI delivery, repeated hint clicks, and repeated submissions grant nothing extra.
4. **No punishment.** XP and unlocked rewards are permanent. A broken streak, failed answer, abandoned task, or support request never removes XP.
5. **No leaderboard.** XP is personal progress only. Teachers may inspect the learner's evidence-backed history but should not rank or compare learners.
6. **Transparent rules.** The learner can see what granted XP and what the next level unlocks. Internal anti-abuse caps may be disclosed without showing grades.
7. **Server authority.** The client never submits an XP amount, target level, reward, Sparks bonus, or time bonus.
8. **Localized and accessible.** New copy must exist in Hebrew, Arabic, and English, with RTL/LTR support and reduced-motion celebration behavior.

## 4. XP Award Rules

Only the rules in this section award XP in the initial implementation. They should be configuration constants with a `rules_version`, not values duplicated in clients.

| Authoritative event | XP | Idempotency scope | Notes |
|---|---:|---|---|
| Learning module completed | 15 | learner + module ID | Award when every required component in the module is complete; individual components award 0 XP |
| Learning goal completed | 50 | learner + learning-goal ID | Award when every required module in the learning goal is complete |
| Teacher Quest completed | 20 | learner + Teacher Quest ID | Award only when the quest reaches its persisted finished state; partial completion awards 0 XP |
| Personal learning path opened after onboarding | 20 | learner + onboarding completion | Award once after the learner finishes the mapping questionnaire and profile-summary journey; also grants 50 Sparks |
| First personal objective started | 20 | learner + objective ID + stage | Applies only to the first objective created for the learner |
| First personal objective progressed | 30 | learner + objective ID + stage | Applies only to that first objective and only when the persisted stage changes |
| First personal objective completed | 50 | learner + objective ID + stage | The first objective can award 100 XP across all three stages |
| Second and later personal objective completed | 50 | learner + objective ID + stage | Starting or progressing these objectives awards 0 XP |
| 30th qualifying help request | 15 | learner + help milestone 30 | Lifetime milestone; awarded once |
| 60th qualifying help request | 15 | learner + help milestone 60 | Lifetime milestone; awarded once |
| 90th qualifying help request | 15 | learner + help milestone 90 | Final help milestone; no help XP after this award |

### Completion and milestone rules

- The curriculum hierarchy is `subject -> learning goal -> learning module -> component`. Mathematics and Science are subjects and do not themselves award XP.
- Module and learning-goal completion must be derived from the server-owned curriculum graph and persisted completion evidence. The client never declares a module or goal complete.
- Completing the final required component may settle both awards in one receipt: 15 XP for its module and, when it also finishes the enclosing learning goal, 50 XP for that goal.
- A Teacher Quest grants exactly 20 XP at full completion regardless of the Sparks amount selected by the teacher. Draft, assigned, opened, in-progress, partially answered, and submitted-but-not-finished states grant 0 XP.
- Opening the personal learning path grants 20 XP and 50 Sparks only after the persisted mapping and profile-summary journeys are complete. It is a single server-confirmed onboarding event, not a reward for a repeated dashboard navigation.
- The "first personal objective" is the earliest persisted objective for that learner, determined by stable creation time and ID. Deleting, archiving, or recreating objectives must not reset which objective is first.
- A qualifying help request is a persisted, purposeful learner request for a hint, explanation, Yubi support, or teacher help. UI retries and duplicate events share one request ID and count once.
- Help milestones use the learner's lifetime count across modules and subjects. They do not reset by day, school year, subject, or level. Each threshold grants 15 XP once, for a maximum of 45 help XP.
- Teacher kudos can grant Sparks but never XP.
- No XP for individual component completion, partial Teacher Quest completion, starting or progressing the second or later personal objective, help requests before/between milestones, login, time-on-page, opening Yubi Studio, buying/equipping an item, chat message count, repeated attempts, or passive video playback.
- No XP for an unverified client event. Offline events may award later after server ingestion, using the original source ID.

## 5. Level Curve

All learners start at **Level 1 with 0 XP**. `XP to next` is the amount earned while at that level. `Total XP` is the cumulative amount required to enter the next level. Level 50 is the display cap.

The curve is intentionally approachable through Level 10 and slower through Level 27. Every transition from Level 28 onward requires a fixed **1,100 XP**, preventing late-level progression from becoming unrealistic. Reaching Level 30 requires 26,800 total XP, and reaching the Level 50 display cap requires 48,800 total XP.

| Current level | XP to next | Total XP for next level |
|---:|---:|---:|
| 1 | 100 | 100 |
| 2 | 125 | 225 |
| 3 | 150 | 375 |
| 4 | 175 | 550 |
| 5 | 200 | 750 |
| 6 | 225 | 975 |
| 7 | 250 | 1,225 |
| 8 | 275 | 1,500 |
| 9 | 300 | 1,800 |
| 10 | 350 | 2,150 |
| 11 | 400 | 2,550 |
| 12 | 450 | 3,000 |
| 13 | 500 | 3,500 |
| 14 | 550 | 4,050 |
| 15 | 600 | 4,650 |
| 16 | 650 | 5,300 |
| 17 | 700 | 6,000 |
| 18 | 750 | 6,750 |
| 19 | 800 | 7,550 |
| 20 | 900 | 8,450 |
| 21 | 1,100 | 9,550 |
| 22 | 1,350 | 10,900 |
| 23 | 1,700 | 12,600 |
| 24 | 2,100 | 14,700 |
| 25 | 2,600 | 17,300 |
| 26 | 3,250 | 20,550 |
| 27 | 4,050 | 24,600 |
| 28 | 1,100 | 25,700 |
| 29 | 1,100 | 26,800 |
| 30 | 1,100 | 27,900 |
| 31 | 1,100 | 29,000 |
| 32 | 1,100 | 30,100 |
| 33 | 1,100 | 31,200 |
| 34 | 1,100 | 32,300 |
| 35 | 1,100 | 33,400 |
| 36 | 1,100 | 34,500 |
| 37 | 1,100 | 35,600 |
| 38 | 1,100 | 36,700 |
| 39 | 1,100 | 37,800 |
| 40 | 1,100 | 38,900 |
| 41 | 1,100 | 40,000 |
| 42 | 1,100 | 41,100 |
| 43 | 1,100 | 42,200 |
| 44 | 1,100 | 43,300 |
| 45 | 1,100 | 44,400 |
| 46 | 1,100 | 45,500 |
| 47 | 1,100 | 46,600 |
| 48 | 1,100 | 47,700 |
| 49 | 1,100 | 48,800 |
| 50 | - | - |

The curve must be stored as an explicit versioned table. Do not recompute historical level from a newly edited formula. A future curve change requires a migration or a new season/version decision.

## 6. Level Rewards

Level rewards are claimed automatically in the same server transaction or settlement flow that crosses the threshold. Crossing several levels at once grants every missed reward exactly once.

### Reward schedule for Levels 2-29

| Reached level | Reward |
|---:|---|
| 2 | 30 Sparks |
| 3 | Studio wall decal set and **Neon Sign** (`neon`) |
| 4 | 40 Sparks |
| 5 | One new precision-crafted, level-exclusive furniture piece unavailable in the catalog (`level_furniture_05`) |
| 6 | Yubi room ambient-light color set and **String Lights** (`stringLights`) |
| 7 | 50 Sparks |
| 8 | Studio desk accessory and **Globe** (`globe`) |
| 9 | One new precision-crafted, level-exclusive furniture piece unavailable in the catalog (`level_furniture_09`) |
| 10 | New Yubi room music/sound theme, **Street Sports Arena layout** (`layout:sportsArena`), and 25 Sparks |
| 11 | Profile level-frame cosmetic |
| 12 | 60 Sparks |
| 13 | Studio poster set |
| 14 | One new precision-crafted, level-exclusive furniture piece unavailable in the catalog (`level_furniture_14`) |
| 15 | Interactive room component: **Telescope** (`telescope`); no academic advantage |
| 16 | 70 Sparks |
| 17 | One new precision-crafted, level-exclusive furniture piece unavailable in the catalog (`level_furniture_17`) |
| 18 | One new precision-crafted, level-exclusive furniture piece unavailable in the catalog (`level_furniture_18`) |
| 19 | 80 Sparks |
| 20 | Named room theme entitlement, **Yubi's Gaming Room layout** (`layout:creatorLoft`), **Star Projector** (`starProjector`), and one extra-hint token |
| 21 | 90 Sparks |
| 22 | Animated profile level-frame cosmetic |
| 23 | Studio display shelf and **Trophies** (`trophies`) |
| 24 | One new precision-crafted, level-exclusive furniture piece unavailable in the catalog (`level_furniture_24`) |
| 25 | Prestige Yubi cosmetic: **Dragon Wings** (`dragonwings`), and 50 Sparks |
| 26 | One new precision-crafted, level-exclusive furniture piece unavailable in the catalog (`level_furniture_26`) |
| 27 | Premium room ambience set |
| 28 | 120 Sparks |
| 29 | Level-29 room monument showing personal journey milestones |

### Existing catalog items converted to level rewards

The following seven items currently exist in the server-owned Sparks catalog. When the XP system launches, they become **level-earned only** and must no longer be returned as purchasable shop rows. Their current prices are retained here as economy context, not as a second acquisition path.

| Reached level | Catalog item | Stable ID | Current Sparks price | Unlock destination |
|---:|---|---|---:|---|
| 3 | Neon Sign | `neon` | 40 | `room_unlocks` |
| 6 | String Lights | `stringLights` | 30 | `room_unlocks` |
| 8 | Globe | `globe` | 40 | `room_unlocks` |
| 15 | Telescope | `telescope` | 90 | `room_unlocks` |
| 20 | Star Projector | `starProjector` | 70 | `room_unlocks` |
| 23 | Trophies | `trophies` | 50 | `room_unlocks` |
| 25 | Dragon Wings | `dragonwings` | 120 | `avatar_unlocks` |

The progression reward configuration is the sole new acquisition rule for these IDs. Remove them from `backend/app/services/rewards/catalog.py` as part of the XP implementation, then grant them through the level-reward settlement service. Do not also add them to streak or mapping rules in `backend/app/services/unlocks.py`.

### Default-locked room layouts converted to level rewards

Two room layouts are locked in the default Studio experience. Their assigned XP levels replace both existing acquisition requirements after the XP system launches. Remove the Sparks purchase option for both layouts. Remove the prerequisite of 6 or 10 completed learning components. Neither former gate remains an alternative acquisition path.

| Reached level | Room layout | Stable entitlement ID | Previous requirement | Unlock destination |
|---:|---|---|---|---|
| 10 | Street Sports Arena | `layout:sportsArena` | 1,000 Sparks and 6 completed components | `room_layout_unlocks` |
| 20 | Yubi's Gaming Room | `layout:creatorLoft` | 1,000 Sparks and 10 completed components | `room_layout_unlocks` |

The assigned level is the only new acquisition path for each layout. Learners who already own either layout keep it. The level-reward settlement service must grant each entitlement automatically and idempotently when the learner reaches its required level, including retroactive settlement for learners already at or above that level.

### New level-exclusive furniture

Levels 5, 9, 14, 17, 18, 24, and 26 each grant one distinct, precision-crafted furniture piece created specifically for XP progression. These are seven new assets, not alternate names or variants of existing catalog items.

| Reached level | Stable entitlement ID | Acquisition rule | Unlock destination |
|---:|---|---|---|
| 5 | `level_furniture_05` | Level reward only | `room_unlocks` |
| 9 | `level_furniture_09` | Level reward only | `room_unlocks` |
| 14 | `level_furniture_14` | Level reward only | `room_unlocks` |
| 17 | `level_furniture_17` | Level reward only | `room_unlocks` |
| 18 | `level_furniture_18` | Level reward only | `room_unlocks` |
| 24 | `level_furniture_24` | Level reward only | `room_unlocks` |
| 26 | `level_furniture_26` | Level reward only | `room_unlocks` |

Product design must define a unique name and visual design for every piece before implementation while preserving these stable entitlement IDs. None of the seven IDs may be added to the Sparks catalog, purchased through another route, or reused by streak, mapping, or promotional unlock rules. Each piece is granted automatically, permanently, and idempotently when its level is reached.

### Levels 30-50

Levels 30 and above are prestige levels. Each grants a permanent visual variant of the level frame plus **100 Sparks**. Levels 30, 35, 40, 45, and 50 also grant a unique prestige room object. These rewards must not unlock curriculum, alter mastery, reveal answers, or create teacher-visible status comparisons.

### Reward constraints

- **Extra-hint token:** permits one additional scaffold step after the normal hint ladder is exhausted. It must not reveal the answer. Maximum stored balance: 3. Consumption is server-authoritative and attached to a component/question ID.
- **Sparks bonus:** uses the existing Sparks wallet and reward ledger with an idempotency key such as `earn:{learner_id}:level:{level}`. Level bonuses should not consume the ordinary daily earned-Sparks cap.
- **Cosmetics and furniture:** use dedicated stable IDs and the existing server unlock paths. The seven catalog conversions above are explicit exceptions: prior purchases remain owned, while future ownership comes only from reaching the specified level. The seven new furniture pieces are level-exclusive and must never appear as purchasable catalog rows. Do not reuse any item already granted by mapping, streak, or purchase.

## 7. Learner Experience

### Persistent display

#### Learner app-bar XP redesign

Use **Alternative C: Level Medallion** from the Hebrew design document as the canonical learner account-button design. The redesigned button replaces the current avatar-led visual treatment with a prominent circular level medallion, keeps the learner name and account chevron, displays exact current-level XP beneath the name, and uses a thin progress line along the button's lower edge. It remains the existing account-menu trigger: selecting it must continue to open and close the same account menu.

Current implementation anchors:

- `frontend/src/components/AppBar.tsx` renders the account area in `.app-bar-user` and the existing `UserMenu` trigger.
- `frontend/src/components/UserMenu.tsx` owns the existing account button, its expanded state, and the account menu. It should render the Level Medallion treatment when learner progression data is available.
- `frontend/src/components/LearnerAppBar.tsx` is the learner-only composition boundary and should supply progression data without exposing the redesign in the teacher app bar.
- `frontend/src/components/learner-app-bar.css` and the existing user-menu styles should own learner-specific XP layout and responsive styling without duplicating menu behavior.

Implementation requirements:

1. Render the Level Medallion design inside the existing `.user-menu__trigger`; do not add a sibling XP control or a second click target.
2. Preserve the existing button's behavior and menu contract exactly: button semantics, click handler, `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`, keyboard activation, outside-click behavior, focus handling, and account-menu contents remain unchanged.
3. Replace the visible avatar with a circular medallion containing the localized level label and number, for example `Level 15`. Use a navy center, a restrained gold outline, and high-contrast text; the level must remain legible without relying on color.
4. Keep the learner name as the primary identity text. Beneath it, show exact progress within the current level, for example `320 / 600 XP`. Keep the existing chevron and rotate it only when the menu is expanded.
5. Place a thin horizontal progress track along the lower inside edge of the button. The filled portion uses the XP accent colors and must remain visually subordinate to the learner name and medallion.
6. Compute progress from server values: `(total_xp - current_level_start_xp) / (next_level_xp - current_level_start_xp)`, clamped from 0% to 100%. Do not infer thresholds or levels in CSS or duplicate the curve in React.
7. Hovering or focusing the account button displays a localized tooltip with the exact amount still required, for example `280 XP needed for Level 16`, and the exact progress context, for example `320 / 600 XP`. This tooltip must not intercept pointer input or replace the account menu.
8. Expose the progress track through a semantic `role="progressbar"` with `aria-valuemin="0"`, `aria-valuemax` equal to the current-level XP requirement, `aria-valuenow` equal to XP earned within the current level, and localized `aria-valuetext`. The button's accessible name must include learner identity, current level, and its existing account-menu action.
9. Use logical layout properties for Hebrew/Arabic RTL and English LTR. Use a stable pill-shaped button, approximately a 40 px medallion, and responsive constraints so values and translated labels do not resize the app bar.
10. Animate only the progress fill and chevron. Respect `prefers-reduced-motion` by disabling movement and retaining a simple state change.
11. At compact/mobile widths, shorten the identity area and progress line while retaining the learner name and level medallion. The control must not overlap the hamburger, Sparks wallet, notifications, or Studio control.
12. At Level 50, show the localized Level 50 medallion, a full progress line, maximum-level text beneath the name, and a localized maximum-level tooltip instead of an amount to the next level.
13. **Loading fallback:** reserve the redesigned button's dimensions while progression loads to prevent app-bar layout shift. If progression fails to load, render the existing account button visual treatment; its menu remains fully functional.

Suggested visual anatomy:

```text
[ Level 15 ]  learner name             chevron
              320 / 600 XP
              |████████████░░░░░░░░|
 hover/focus: 280 XP needed for Level 16 · 320 / 600 XP
 click/Enter/Space: open the existing account menu
```

The Sparks wallet remains a separate control in the learner app bar. The Level Medallion and progress line communicate permanent progression only and must not imply that XP can be spent. The integrated XP presentation adds no new click action: the entire button still performs only its existing account-menu action.

### Award and level-up feedback

- **Every server-confirmed action that awards XP displays a creative, non-blocking `XpAwardPopup` directly below the learner's name/account control.** The popup must identify the completed action in warm, localized language and show the exact amount earned, for example `Learning module completed · +15 XP`.
- The popup appears only after the authoritative award receipt is returned. Replayed, duplicated, rejected, or zero-XP actions do not display it. An offline action displays the popup when its verified award receipt is later delivered, not when the client first queues the action.
- One learner action produces one popup. If the action settles multiple XP reasons, such as completing both a module and its enclosing learning goal, the popup shows each reason and amount as separate lines plus the combined XP total; it must not open competing popups.
- Queue receipts that arrive while a popup is visible and show them in award order. Each popup remains long enough to read, can be dismissed, does not steal focus, and never covers or blocks the account menu, app-bar controls, or learning task.
- Give the popup a distinctive celebratory treatment tied to the XP visual language, using a concise entrance and exit animation, XP iconography, and the progress-bar accent colors. Respect `prefers-reduced-motion` by replacing movement with a simple opacity change.
- Announce the localized action and XP amount through a polite live region. The announcement must occur once per settled receipt even when visual motion is disabled.
- A level-up opens one concise celebration after the learning flow has safely completed.
- If multiple levels are crossed, show the final level and a grouped list of rewards, not several dialogs.
- Sparks and XP earned from the same action appear in the same anchored popup, for example `Teacher Quest completed · +20 Sparks · +20 XP`, while preserving their different meanings.
- Respect `prefers-reduced-motion`; sound remains optional and follows the existing celebration-audio policy.

## 8. Data Model

XP is game economy/progression state, not a learner belief and not mastery. Store it beside the existing wallet in dedicated persistence, not in AI-readable profile context.

### `learner_progression`

```json
{
  "_id": "pseudonymous_learner_id",
  "learner_id": "pseudonymous_learner_id",
  "total_xp": 4650,
  "level": 15,
  "rules_version": 1,
  "milestones": {
    "first_objective_id": "objective_001",
    "qualifying_help_requests": 60,
    "claimed_help_thresholds": [30, 60]
  },
  "entitlements": {
    "extra_hint_tokens": 1
  },
  "claimed_level_rewards": [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  "updated_at": "2026-09-14T10:00:00Z"
}
```

### `xp_ledger`

```json
{
  "_id": "xp:{learner_id}:module:{module_id}",
  "learner_id": "pseudonymous_learner_id",
  "kind": "earn",
  "amount": 15,
  "reason": "learning_module.completed",
  "source": {
    "type": "learning_event",
    "id": "event_id",
    "module_id": "catalog_module_id",
    "learning_goal_id": "catalog_learning_goal_id"
  },
  "rules_version": 1,
  "total_after": 4750,
  "level_before": 15,
  "level_after": 15,
  "at": "2026-09-14T10:00:00Z"
}
```

Indexes:

- unique `_id` for idempotency,
- `{learner_id: 1, at: -1}` for learner history,
- optional `{source.id: 1}` for audit/debugging.

The implementation must avoid a reserved-ledger-row/stale-total race. Prefer a Mongo transaction where available. Otherwise use an atomic progression update with a unique claim and a recoverable settlement status (`pending`, `applied`) so a crash cannot permanently claim an event without adding its XP.

## 9. Backend Contracts

Create a focused `backend/app/services/progression/` package:

- `curve.py`: explicit versioned thresholds and pure level calculations.
- `rules.py`: source-event-to-XP rules, caps, and reason keys.
- `ledger.py`: idempotent claims, progression updates, and recent history.
- `rewards.py`: level-crossing settlement into Sparks, room/furniture unlocks, and hint tokens.
- `models.py`: Pydantic/public response contracts.

Routes under `/api/progression`:

| Method | Route | Purpose |
|---|---|---|
| GET | `/status` | Current XP, level, next threshold/reward, entitlements, and rule version |
| GET | `/ledger?limit=20` | Recent localized-reason data; no raw PII |
| POST | `/hint-token/use` | Consume one token for the active component/question after normal hints are exhausted |

There is no public generic `POST /grant`. Award entry points are internal service calls from authoritative flows:

- curriculum aggregation after persisted component evidence completes a learning module and, where applicable, its enclosing learning goal,
- Teacher Quest workflow after the quest reaches its persisted finished state,
- personal-objective workflow after a persisted stage transition, with first-objective eligibility resolved server-side,
- support-event ingestion after a unique qualifying request increases the lifetime count to 30, 60, or 90.

Each source flow sends identifiers and facts only. `progression.rules` resolves the XP amount.

## 10. Frontend Integration

Add:

- `ProgressionProvider` beside `RewardsProvider`, learner-only.
- The Level Medallion treatment inside the existing `UserMenu` trigger, plus an account-anchored `XpAwardPopup` and `LevelUpDialog` shared components.
- queued, combined award-receipt support so every XP-awarding action is acknowledged below the learner name without producing competing popups or dialogs.
- a next-reward preview in Yubi Studio locks; the integrated account-button progress display does not open a progression panel.
- localized strings in `he`, `ar`, and `en`; Hebrew is the source language.

Do not hardcode thresholds, XP values, or reward descriptions in React. The status API returns numeric progress and stable reward/reason keys; the frontend localizes keys.

## 11. Migration and Rollout

Do **not** silently reconstruct XP from every historical interaction. Historical telemetry may be incomplete or duplicated across content providers.

Recommended launch policy:

1. Every existing learner starts at Level 1 with 0 XP on the feature launch date.
2. Preserve all existing Sparks balances, purchases, streak unlocks, and cosmetics unchanged. Remove legacy achievement-badge state while retaining every permanent Studio entitlement.
3. Learners who bought one of the seven converted catalog items keep it permanently and receive no Sparks refund; they paid for immediate access before level progression existed. Reaching its assigned level later must be an idempotent no-op for ownership while the rest of that level's rewards still settle.
4. Optionally grant one transparent, fixed `early learner` cosmetic to existing learners; do not invent historical XP.
5. Gate UI behind `XP_SYSTEM_ENABLED` while still running service tests.
6. Enable for seeded/demo learners, then one internal class, then all learners.
7. Review anonymized economy metrics after two and six school weeks: XP/day distribution, level distribution, cap-hit rate, source mix, duplicate rejection rate, and reward claim failures.

Balance review must change future award rules or a future season/version. Never reduce earned XP or revoke claimed rewards.

## 12. Delivery Phases

### Phase 1: Core progression

- Curve, rules, ledger, status/history API, and idempotency.
- Learning-module and learning-goal aggregation, Teacher Quest completion, personal-objective stage, and help-milestone award adapters.
- Level Medallion account-button redesign, account-anchored XP award popup with receipt queue, and level-up dialog.
- Level rewards limited initially to Sparks and existing-safe cosmetic unlocks.

### Phase 2: Entitlements

- Extra-hint token integration with the existing server hint ladder.
- New level-exclusive room, furniture, and avatar assets.

### Phase 3: Tuning and operations

- Admin read-only aggregate economy report without learner ranking.
- Rules-version controls, migration tooling, settlement repair command, and anomaly alerts.
- Product review of actual school-year progression before changing values.

## 13. Acceptance Criteria

1. A new learner has 0 XP, Level 1, and their existing Sparks wallet is unchanged.
2. Completing an individual component grants 0 XP; completing all required components in its learning module grants 15 XP exactly once.
3. Completing all required modules in a learning goal grants 50 XP exactly once, in addition to any 15 XP due for the final module.
4. A partially completed Teacher Quest grants 0 XP; its persisted finished state grants exactly 20 XP regardless of its teacher-selected Sparks amount.
5. The first personal objective grants 20 XP when started, 30 XP when progressed, and 50 XP when completed. The second and every later objective grants only 50 XP when completed.
6. Qualifying help requests 1-29 grant 0 XP; requests 30, 60, and 90 each grant 15 XP once; requests after 90 grant 0 XP.
7. Reopening, replaying, duplicate event delivery, or resubmitting an already-awarded activity grants no additional XP.
8. Teacher kudos may change Sparks but never changes XP.
9. Crossing multiple thresholds grants each level reward once and returns one grouped level-up receipt.
10. A failed reward side effect is recoverable and cannot cause XP or the reward to be applied twice.
11. The learner can explain from the UI the difference between XP and Sparks and can inspect recent XP sources.
12. Level data is absent from AI prompts and is never presented as mastery, a grade, or a comparison.
13. All learner-facing UI works in Hebrew RTL, Arabic RTL, and English LTR, including long reward names and Level 50.
14. Reduced-motion mode removes nonessential XP and level-up animation.
15. Levels 5, 9, 14, 17, 18, 24, and 26 each grant a different new furniture entitlement exactly once; none of those entitlements is available in the Sparks catalog or through another unlock rule.
16. Hint-token use is rejected unless the standard hint ladder is exhausted and the request names the active component/question.
17. The seven converted catalog IDs are absent from purchasable shop rows, unlock at their configured levels exactly once, and remain owned for learners who purchased them before launch.
18. The learner account button uses the Level Medallion design: a circular level medallion replaces the visible avatar, the learner name and chevron remain, exact current-level XP appears beneath the name, and a proportional progress line runs along the lower edge.
19. Hovering or focusing the redesigned account button reveals the exact XP remaining and current/required values. Clicking it, pressing Enter, or pressing Space performs only the existing account-menu action and preserves its expanded state, menu contents, keyboard behavior, and accessibility contract.
20. Every server-confirmed action that grants XP produces exactly one localized popup below the learner's name/account control containing the action and exact XP amount; zero-XP, rejected, and duplicate events produce none.
21. From Level 28 through Level 49, every `XP to next` value is exactly 1,100 XP; cumulative totals reach 25,700 XP for Level 29, 26,800 XP for Level 30, and 48,800 XP for Level 50.

## 14. 720 Alignment

- **F1 Personalized delivery:** extra hints are bounded scaffolds and never alter curriculum mastery.
- **F3 Learning companion:** celebrations and explanations are available through the shared learner shell; support-seeking is framed positively.
- **F4 Student dashboard:** XP is personal engagement progression, clearly separated from curriculum progress and numeric grades.
- **F5 Mentoring goals:** the first personal objective can reward its persisted stages; subsequent objectives award XP only at completion, without changing Sparks semantics.
- **F6 Teacher view:** any future XP display is evidence-backed and non-comparative; no leaderboard or attention flag may derive from low XP alone.

XP events are internal product events. Existing Ministry xAPI statements remain canonical learning evidence and must not be mutated or replaced with invented XP verbs.