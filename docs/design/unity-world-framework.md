# Unity World Framework — Quest, Progression & Guidance

Status: **design locked, not yet built.** This is the **ground base for every world** in the
Yuvi learning overworld. It defines the reusable systems (stations, inhabitants, inventory,
tools, gathering, hand-over, guidance, badges) once; each world is a *content instance* on top.
**World 1 — Arrival Valley** is the reference instance (§16).

The Unity world (grounding, dressing, camera, sun/lamps, serpent, React bridge) already exists
and ships as the prebuilt WebGL blob. Nothing in this doc is implemented yet.

---

## 1. Purpose & layering

Three layers, cleanly separated:

1. **World (Unity)** — the 3D space, characters, tools, cameras, physics. Authored per world.
2. **Framework (this doc)** — the reusable progression/guidance systems, identical across worlds.
3. **Content (adaptive)** — which skills/objectives fill each task, chosen per-kid from the
   Shared Learning Brain at runtime.

HUD (inventory, dialogue, hotbar, badges, cinematic UI, Help-Yuvi chat) = **React overlays**.
Held tools + characters + gather nodes = **Unity** (procedural low-poly, WebGL-safe, no imported
models). Inventory *icons* = **2D SVGs** (Minecraft-style symbols), not 3D.

---

## 2. Core loop — reusable stations, not a fixed chain

A world has a **stable set of station slots** (a house + a stationary **steward NPC** + an
"offer zone" each). It does **not** have a fixed "4 tasks then done" structure. Instead:

- The brain emits an **ordered task queue** (strictly linear). Each task targets a station slot —
  **and a slot can be re-used by multiple tasks** at different points in the queue.
- A station's steward reflects the **current** task on that slot and cycles:
  `dormant (dim) → active (lit, "?") → lesson → done ("✓", brief) → dormant again → re-tasked later`.
- Only **one task is active at a time**; task N unlocks when N-1 completes (strictly linear),
  enforced *physically* by the tool/resource gate — the steward won't engage without the goods.

Per-task beat:

> **Reach** the steward (gated by required tool + gathered resource) → **hand over** the resource
> → **lesson** (adaptive) → **reward** (often a new tool) + steward `✓` → next task lights up on
> its slot → Help-Yuvi/guiding point points the way → repeat.

**World completion** = the world's ground-task quota is met → flight tool granted → capstone →
badge + cinematic → next world.

---

## 3. Locked design decisions

| Decision | Choice |
|---|---|
| Lesson content | **Adaptive** (brain-driven) inside a fixed authored scaffold |
| Progression | **Strictly linear**, enforced by tool/resource gates |
| Stations | **Reusable task slots** — re-taskable, not one-and-done |
| Flight | The **final tool**, granted after the ground-task quota |
| Asset pipeline | **Procedural low-poly** (MeshB); code-driven animations; WebGL-safe |
| Held tools | **Unity view-models** (first-person). NOT three.js |
| Inventory icons | **2D SVG** symbols (Minecraft-style) |
| Gather tone | **Peaceful nature-tending** (no combat) |
| Guidance | **Help-Yuvi agent + in-world guiding points**. No persistent minimap/compass |
| HUD | Keep Help Yuvi, camera, help; **remove map + compass**; add bottom inventory hotbar + manage button |

---

## 4. World inhabitants (a lively world)

Two NPC kinds, both **Unity procedural low-poly**:

### 4.1 Ambient wanderers
Background villagers that make the world feel alive.
- **Valid navigation only**: baked **NavMesh** over the walkable grass, carved by the existing
  water/coast/river barriers and building footprints — so agents **never** get stuck, walk off
  edges, or enter the river/cliffs. Each has a leash radius and picks random *reachable* points,
  walks, idles, occasionally greets, repeats. Agents avoid each other and the player.
- Small count (~6–10) for WebGL budget. Idle + walk + wave anims, code-driven.

### 4.2 Station stewards (one per house)
- Stand at their door, **dormant/dim** until their slot's current task is active.
- On activation: light up with a `?` marker, face the player when near, greet.
- On hand-over: accept animation → open the lesson. On completion: brief `✓`, then dim.
- Stationary (NavMeshObstacle) so wanderers path around them.

---

## 5. Inventory, tools & the hotbar

### 5.1 Model
- **Tools** — persistent, equippable (Basket, Lantern, …, Wings). Kept for the whole world;
  later tasks may require an earlier tool again.
- **Resources** — counted, consumable (blossoms, dew, pearls). Spent on hand-over.

### 5.2 HUD
- **Bottom hotbar row** (Minecraft-style): quick slots showing **2D SVG icons** of equipped
  tools / held resources; the active slot is highlighted. Click/number-key to equip.
- **Manage button** → opens the **inventory panel**: what's equipped vs. **saved for later**,
  drag to the hotbar, inspect counts. This is the "equip / stash" manager.
- Icons are authored SVGs per tool/resource so the symbol language is consistent.

### 5.3 Held tool (Unity, first-person)
- The equipped tool renders as a **Unity view-model** anchored to the FP camera, idle sway.
- **Left-click = use**: swing/scoop animation + SFX; if a valid gather node is in range+aim, the
  node plays its harvest anim + particle and the resource flies to inventory with a pickup chime.
  Wrong tool / no target = a soft "whiff".
- **First-person is the tool-use view** (the default). Iso is a look-around/navigation view; the
  held tool need not render there (keeps everything Unity, avoids a three.js tool path).

---

## 6. Gathering nodes
Procedural node meshes placed in the world (blossom patch, glimmer-cap cluster, fountain dew
point, river pearl spot). States: `available → harvesting → depleted → (optional respawn)`. A
node only responds to its **matching tool** (aim + range check on use).

---

## 7. Hand-over interaction (giving the steward what you gathered)
You must **hold** the required item, then transfer it. Two verbs (pick per task):

- **Present to NPC** — hold the item, enter the steward's **offer zone** (a soft glowing ring at
  their feet + the steward's `?` pulses). Left-click aimed at the steward → Yuvi's hand extends
  (Unity anim), the item arcs to the steward, they react (nod + sparkle + SFX), the item is
  consumed, the lesson opens.
- **Place at a socket** — for items that belong somewhere (e.g. pour Dew on a sapling): a
  highlighted **socket/pedestal** appears; click to place. Same feedback, item consumed.

Both are honest: no valid target in range → nothing is consumed, and Help-Yuvi can explain why.

---

## 8. Guidance — Help Yuvi (no minimap)

Guidance is delivered by the **Help-Yuvi agent** (the existing **Companion** —
`CompanionProvider` / `openCompanion`), made **world-aware and able to act on the world**. There
is **no persistent minimap or compass**.

### 8.1 Context (the agent always knows the world state on /learning)
On the learning screen, Help-Yuvi receives a live context payload: active task + its step
(gather / hand-over / lesson), inventory + tools owned, current station, player position, what's
done, what's next. Sourced from the same quest state that drives the world, so it's never wrong.

### 8.2 Capabilities (the agent can trigger events)
Free-form kid questions ("I picked the pink flowers, now what?") get a **clean, short** answer
**and** an action — it *shows*, not just tells:
- `place_guiding_point(target)` — spawn a glowing waypoint + soft ground trail toward the next
  node/steward/location.
- `highlight(entity)` — outline/ping a steward or node.
- `focus_camera(target)` — optional gentle camera nudge.
- `open_inventory()` / `hint_equip(tool)` — nudge the right HUD action.

This replaces minimap wayfinding: when the kid is lost, Help-Yuvi drops a guiding point exactly
where they need to go and explains the next step in kid-clear language.

---

## 9. World HUD (target state)

- **Keep**: Help Yuvi (Companion chat), **camera** (FP/iso toggle), **help (?)**.
- **Remove**: **map** and **compass** buttons + their behavior
  (`LearningPortalPage.tsx` lines ~288/322/326/465).
- **Adjust help (?)** content: now explains the *mechanics* — move/look, equip from the hotbar,
  use tools with left-click, gather, hand over to stewards, ask Help-Yuvi when stuck, earn tools,
  unlock flight, earn badges. Localized he/en/ar.
- **Add**: bottom **inventory hotbar** + **manage** button (§5.2).

---

## 10. Flight, capstone & finale
- **Flight** = the final tool, granted when the ground-task quota is met. `DemoPlayerController.
  flightUnlocked` gates `Space`/fly until the bridge flips it. Wings show on the FP view-model.
- **Capstone** = fly to a raised landmark (the bluff Pavilion in World 1) for the adaptive
  **synthesis challenge** tying the world's skills together.
- **Finale** = scripted camera sweep + **cloud curtain** parts to the next world; award **two
  badges** (subject-mastery + world-clear), both wearable in the Yubi Studio wardrobe. A world
  HUD "Design Yuvi" button routes to the Studio (earn → customize loop). **Cosmetic unlocks +
  badge rewards + the unlock dialog are fully specified in §21.**

---

## 11. Adaptive × linear architecture
- **Fixed (authored per world):** the station slots, the world's tools & gather nodes, the
  hand-over verbs, world-native mechanics (e.g. dusk lantern), the capstone & finale.
- **Adaptive (per-kid, runtime):** the ordered **task queue** from the brain — which objective
  each task teaches, and which slot (possibly reused) hosts it. Tools/gates stay authorable
  because the *vocabulary* (tools, nodes, slots) is fixed; the brain only sequences tasks over it.

---

## 12. Learning bridge & agent contract

The world is motivation + navigation; pedagogy stays in React + agents + brain. A task **is** a
learning objective; interacting opens it as a full-screen React overlay over the paused world.
On mastery (xAPI → brain) → React → world marks `✓` and advances.

**Bridge — React → Unity:** `SetTaskQueue(list)`, `SetActiveTask(task)`, `GrantTool(id)`,
`SetInventory(state)`, `MarkTaskComplete(id)`, `UnlockFlight()`, `PlayFinale()`,
`PlaceGuidingPoint(target)`, `Highlight(entity)`, `FocusCamera(target)`.
**Bridge — Unity → React:** `StewardReached(id)`, `ToolUsed(id, hitNode?)`,
`ResourceGathered(id, count)`, `OfferMade(stewardId, itemId)`, `RequestOpenLesson(taskId)`,
`FinaleComplete()`, `PlayerPose(pos, yaw)`.

**Help-Yuvi agent** consumes a world-context payload (§8.1) and calls the `PlaceGuidingPoint /
Highlight / FocusCamera / open_inventory` actions via the bridge. It is the Companion, extended.

---

## 13. Persistence
Task-queue progress, inventory (tools + resources), unlocked flight, and badges all live in
**learner memory** (server), keyed to the learner. Refresh/relogin restores exact world state;
Unity holds only the live session view.

---

## 14. Asset list (procedural, WebGL-safe)
- **Tools** (Unity FP view-model + code-driven use-anim + 2 SFX + a 2D SVG icon each):
  Basket, Lantern, Dew Flask, River Net, Balloon-Wings.
- **Gather nodes** (mesh + harvest state + particle + pickup chime): Lumi Blossom, Glimmer-cap,
  Fountain Dew point, River Pearl.
- **NPCs**: ambient wanderer (idle/walk/wave), station steward (dormant/greet/accept).
- **Shared VFX/SFX**: guiding point + trail, offer sparkle, pickup chime, whiff, equip sound,
  task-complete flourish, badge fanfare.
- **NavMesh** baked over walkable grass.

---

## 15. Phased build plan

**Phase 0 — Vertical slice (prove the feel).** ONE full link, first-person: hotbar + Basket
Unity view-model + Lumi Blossom node + click-to-use (swing + SFX + particle) + resource→inventory
(SVG icon) + present-to-steward hand-over + adaptive-lesson stub + `✓` + reward Lantern. Ship
nothing else until this feels great. **Also ships:** the dev bypass flag (§18), the first
world-story smoke test (§19), and a scaffold of the `world-story-qa` skill (§20).

**Phase 1 — Quest engine + persistence.** Reusable-station task queue, strictly-linear gating,
learner-memory-backed state, `✓`/dormant reflection on load.

**Phase 2 — Help-Yuvi guidance.** World-context payload + `PlaceGuidingPoint/Highlight` actions;
guiding point + trail in-world. Remove map/compass buttons; expand help (?) content.

**Phase 3 — Inhabitants.** NavMesh bake + ambient wanderers; station stewards with
dormant/greet/accept states.

**Phase 4 — Full tool-chain content.** Remaining tools + nodes + hand-over verbs; dusk mechanic.

**Phase 5 — Flight + capstone.** Wings as final tool; bluff synthesis challenge.

**Phase 6 — Finale.** Badge + cinematic + cloud-curtain → next-world gateway + Studio wardrobe.

**Cross-cutting — every phase ships behavioural tests** (§19) and honours the dev bypass (§18);
no world change merges without its world-story tests green.

---

## 16. World 1 — Arrival Valley (reference instance)

Station slots (reusable): **Farm, Cottage, Hut, Townhouse** (+ Kiosk = flight vendor, Pavilion =
capstone on the bluff). Peaceful nature-tending tool-chain (world-native mechanics reuse existing
systems):

| Task (first pass) | Steward | Gate: gather with… | Reward | Reuses |
|---|---|---|---|---|
| 1 | Farmer (Farm) | **Lumi Blossoms** ← Basket | **Lantern** | pink flowers |
| 2 | Weaver (Cottage) | **Glimmer-caps** ← Lantern *(dusk only)* | **Dew Flask** | sun cycle + lamps |
| 3 | Hermit (Hut) | **Fountain Dew** ← Dew Flask | **River Net** | fountain |
| 4 | Keeper (Townhouse) | **River Pearl** ← River Net *(serpent gifts at peak)* | *(flight)* | river + serpent |

The brain may add **further tasks re-using these slots** before flight unlocks (e.g. a second
Farm task with a new adaptive objective). Greeter at the fountain gives the Basket and teaches the
loop (ungated first gather). Flight after the ground-task quota → Kiosk vendor grants Wings → fly
to the Story Pavilion → finale → **World 2**.

---

## 17. Pacing guardrails & risks
- **Keep gathers short** (1–3 nearby items) so linear + gather ≠ grind.
- **Reading always optional**; never block progress on dialogue — Help-Yuvi covers the lost kid.
- **NavMesh correctness is critical** — wanderers stuck/in-river/off-edge breaks the "lively"
  goal; bake carefully against water/coast/cliff barriers and verify.
- **Reusable-station clarity** — the steward's dormant/active/done visual must make it obvious
  when a slot has a *new* task vs. is finished, or kids will re-walk cleared houses.
- **FP-first tools** — tool visuals/anims target first-person; iso is navigation only.
- **Rebuild discipline** — every world change needs an explicit WebGL rebuild + commit of
  `frontend/public/unity-world/`; never auto-rebuild.
- **Dev bypass fails closed** — the skip/debug flags (§18) are dev-only and hard-guarded on
  `import.meta.env.DEV`; a production bundle must ignore them even if the env var leaks.
- **Tests gate changes** — no world/story change lands without its behavioural tests (§19) green.

---

## 18. Dev & debug flags (fast story iteration)

For dev/debug we must be able to walk the whole story **without solving tasks**. All flags are
**dev-only**, hard-guarded on `import.meta.env.DEV`, and never active in a production build.

| Flag (Vite env) | Effect |
|---|---|
| `VITE_WORLD_DEBUG` | Master dev switch — enables the debug overlay + all flags below. |
| `VITE_WORLD_SKIP_TASKS` | **The "continue without solving" flag.** Interacting with / offering to a steward **auto-completes** the active task — skips the lesson overlay **and** waives the gather/resource gate — so world state advances immediately. Lets you blast through the task queue. |
| `VITE_WORLD_UNLOCK_ALL` | Grant every tool + unlock flight up front (test late-world traversal without the chain). |

Debug overlay actions (gated by `VITE_WORLD_DEBUG`): jump to task N / station, force time-of-day
(test the dusk Glimmer-cap mechanic), teleport to steward / node / bluff, grant tool, refill or
clear inventory, replay the finale.

- **Dev learner** — bypassed runs use a throwaway **dev learner id / `dev` namespace** so skipped
  completions never pollute real learner-memory or xAPI.
- **Real path exercised** — bypass still flows through the same bridge messages (§12), so a
  skipped playthrough tests the real Unity↔React integration, just without lesson content.

---

## 19. Automated world-story QA (behavioural tests)

Goal: drive the world story **automatically** — for regression *and* to debug the story fast
without a human playing. Two harness layers:

- **Unity PlayMode tests** (Unity Test Framework, existing `Assets/Tests`) — script the player +
  bridge in-scene and assert in-world behaviour:
  - right tool harvests a node / wrong tool whiffs / resource count increments;
  - hand-over consumes **only** with the correct held item in the offer zone;
  - steward state cycle (dormant → active `?` → done `✓` → dormant on re-task);
  - **NavMesh sanity** — sample wanderer positions over N seconds; assert always on the navmesh,
    **never** inside water/coast/cliff barriers, **never** stuck (near-zero velocity too long);
  - flight collider gate + fly ceiling.
- **Browser e2e (Playwright)** — pattern after `scripts/test-companion-visuals.mjs`. Load
  `/learning` and drive the world via **bridge messages** (`SendMessage`), **not** pixel-clicking
  the WebGL canvas. Feed a scripted task queue; simulate `StewardReached` / `ToolUsed` /
  `OfferMade`; assert React quest-engine transitions, hotbar/inventory HUD, Help-Yuvi guiding-point
  actions, and **persistence across reload**. Uses `VITE_WORLD_SKIP_TASKS` to skip lessons.

**Behavioural test categories:** story progression + strict-linear gating (steward N locked until
N-1 done); gather/tool; hand-over; guidance (Help-Yuvi places a **reachable** point to the correct
target for the current step); inhabitants/navmesh; flight gate; persistence; **dev-bypass
integrity** (a prod build refuses the flag).

**The world-story playthrough** — one script runs the entire task queue end-to-end (bypass on),
asserting every transition through flight → capstone → finale. This is the one-command "did I
break the story" smoke test, and the primary tool for automated story debugging.

---

## 20. `world-story-qa` skill (so agents can debug the story)

A Claude Code skill at `.github/skills/world-story-qa/` so any agent (esp.
`720-content-builder`) knows how to QA/debug the world story without a human.

`SKILL.md` covers:
- enabling the dev flags (§18) and the dev-learner namespace;
- running the Unity PlayMode tests **and** the Playwright world-story playthrough (with commands);
- the bridge message vocabulary (§12) for scripting interactions;
- **authoring a new behavioural test** when a task/tool/steward is added;
- reading failures — navmesh-stuck, gating violation, unreachable guiding point, non-consumed
  hand-over, bypass leaking into prod.

Registration: add `world-story-qa` to the tools/skills list in
`.github/agents/720-content-builder.agent.md` (alongside `unity-skills`, `unity-hand-drawn-art`).
Authored alongside **Phase 0**, once there's a harness to document.

---

## 21. Cosmetic unlocks & Yubi Studio integration

Progress and badges unlock **Yubi Studio cosmetics** — the earn→customize loop. This **extends
the existing system**, it does not replace it.

### 21.1 What already exists (reuse, don't reinvent)
- **Catalog** — `frontend/src/features/yubi-studio/yubiAssets.ts` (`YUBI_CATALOG`): 32 cosmetics
  across 5 slots (`headTop / face / body / handR / back`), each a procedural `THREE.Group`
  (`build()`), some with a `requirementKey`. Plus recolorable **colors** (`body/eyes/smile/glow`)
  and 2 **variants** (`classic/girl`) in `yubiDesign.ts`.
- **The gate** — `useStudioDesign.ts`: `isLocked(asset) = Boolean(asset.requirementKey) &&
  !unlockedIds.has(asset.id)`, where `unlockedIds` loads from persisted
  **`learner_state.avatar_unlocks: string[]`** (`services/api.ts`). **Granting a cosmetic =
  appending its id to `avatar_unlocks`.** Free items (no `requirementKey`) are always available.
- **Existing hooks** — `PHASE_REWARDS` (mapping-section → item), `PREVIEW_ALL` dev bypass in
  `StudioContent.tsx`, and `getThumbnails()` (renders each asset in 3D — reuse for the dialog).
- **Persisted design** — `learner_state.avatar` = `{variant, colors, equipped}` (`yubiDesign.ts`).

### 21.2 First-entry state (what's open on day one)
On first entry to the Yubi platform the learner already has: **all free cosmetics** (every item
with no `requirementKey` — ~22 today), **all colors**, and **both variants**. So a kid can
personalize immediately. Everything with a `requirementKey` is **locked** until its id lands in
`avatar_unlocks`. Nothing about the world is required to start customizing.

### 21.3 Reward taxonomy
1. **Common cosmetics (random)** — granted at world **task milestones**. A *random* still-locked
   common item from a pool. This is the "random assets unlock regarding progress" ask.
2. **Signature cosmetics (badge)** — a *specific* themed item tied to a badge (world-clear /
   subject-mastery). Deterministic, rarer, memorable.
3. **Colors / skins (new reward type)** — special palettes/skins become unlockable rewards
   (today colors are all free; we add a lockable pool so a badge can grant a "signature skin").

### 21.4 The locking ladder (progression → unlocks)
| Trigger | Grants | Notes |
|---|---|---|
| **First entry / onboarding** | free set + colors + variants | already open (§21.2) |
| **Mapping sections** (legacy `PHASE_REWARDS`) | crown / jetpack / ironman | keep; unify under `avatar_unlocks` |
| **World task milestone** | **1 random common cosmetic** | every task, or every Nth (tunable) |
| **World flight earned** (ground-task quota met) | the **jetpack** back cosmetic | re-theme jetpack's requirement from `section5` → "world flight earned" |
| **Subject-mastery badge** | a **subject-signature** cosmetic (+ optional signature skin) | authored per subject |
| **World-clear badge** | a **world-signature** cosmetic | e.g. crown re-themed to World-1 clear |

**"What unlocks flying"** — two distinct things, keep them clear:
- **World flight (gameplay)** = the **Wings tool**, unlocked after the ground-task quota (§10).
  This is what lets you actually fly in the world.
- **Studio flight cosmetics** (back slot: angelwings/jetpack/dragonwings/rocketpack) = wearable
  decorations, no gameplay effect. **Tie:** earning world flight *also* grants the **jetpack**
  cosmetic + fires the unlock dialog, so gaining flight yields a wearable trophy.

### 21.5 Random-but-fair grant
Random selection is **server-side and seeded** (by learner id + milestone index) so it's
deterministic per learner (reload never rerolls) and not client-exploitable. Excludes already-
unlocked ids. **Pool exhausted** → fall back to a color/skin reward, or a "duplicate → sparkle
bonus". New signature cosmetics/skins are authored with the same procedural `build()` pattern and
added to the catalog with a `requirementKey`.

### 21.6 The unlock dialog
Fires whenever new id(s) enter `avatar_unlocks` (world milestone, flight, badge, or mapping).
Multiple unlocks **queue** one after another.
- **Live 3D viewer** in the middle with **OrbitControls** (drag to orbit, wheel/pinch to zoom):
  - **object cosmetic** → render the item (reusing `asset.build()` + `createMaterials`), optionally
    on Yuvi;
  - **color / skin** → render the **full Yuvi with it applied** (`refreshMaterials`), so the kid
    sees themselves recolored and can spin/zoom.
- **Buttons: Equip** (applies to the right slot / sets colors, persists to `learner_state.avatar`
  immediately) and **Close** (keeps it in the wardrobe, unequipped).
- Localized (he/en/ar). Reuses the studio's three.js material + build pipeline; no new asset type.

### 21.7 Badges (new, drive signature unlocks)
Badges don't exist yet. Add a persisted **`learner_state.badges`** collection; each badge =
`{id, world, subject?, kind: 'subject-mastery' | 'world-clear', signatureCosmeticId, earnedAt}`.
On earn: play the finale cinematic (§10) → award badge → grant its signature cosmetic(s) → run the
unlock dialog → badge shows in the Studio wardrobe. Badges are the *record of achievement*;
cosmetics are the *wearable reward* they grant.

### 21.8 Data & integration
- **Source of truth** = learner memory: `avatar_unlocks` (owned cosmetics), `avatar` (current
  design), `badges` (new). All server-persisted; survive reload/relogin.
- **Grant API** — the world quest engine (React) computes milestone/flight/badge events and calls
  a grant endpoint that appends to `avatar_unlocks` / records a badge, then emits an
  `unlock-available` event the dialog consumes. Idempotent (no double-grant on replay).
- **Bridge** — no new Unity→cosmetic coupling needed: the world already emits `MarkTaskComplete`,
  `UnlockFlight`, `FinaleComplete` (§12); React maps those to grants. Unity stays cosmetics-
  agnostic; all wardrobe/dialog UI is React.
- **Dev/QA** — `PREVIEW_ALL` (studio) + the §18 dev flags let us force-unlock and replay the
  dialog; §19 adds tests: milestone→grant, random determinism, dialog equip persists, flight→jetpack
  grant, badge→signature grant, no double-grant.

### 21.9 Build phases (fold into §15)
- **Phase 1** already persists progress → add the **grant API** + `avatar_unlocks` append on task
  milestone, and the **unlock dialog** (single-item, object case).
- **Phase 5/6** → badges collection + signature grants + the flight→jetpack tie + color/skin
  reward type + queued multi-unlock.

### 21.10 Guardrail
Every world-driven grant must be **idempotent and server-authoritative** — cosmetics are
permanent, so a replayed milestone or a reloaded page must never double-grant, reroll a random
reward, or let a client self-grant a locked id.

---

## 22. Badges — design system, progress & recognition

Badges are the **record of learning achievement** (cosmetics from §21 are the wearable reward they
hand out). They must feel *earned*: invested SVG art, a visible progress ramp, a celebratory
earn moment, and clear meaning for both kid and teacher.

### 22.1 Taxonomy
- **Subject-mastery badge** — earned by mastering a subject's skills (adaptive, brain-driven).
  Tiered **bronze → silver → gold** by mastery depth. One family per subject.
- **World-clear badge** — earned by completing a world (all ground tasks + capstone). One per world.
- (Later) **milestone/streak badges** — optional, same system.

Each badge references the **signature cosmetic** it grants (§21.3) so the two loops connect.

### 22.2 SVG design system ("really invested" art)
A shared **shape grammar** so every badge reads as one family, matched to the world art direction
(sharp geometric low-poly, glossy grey/white + **neon cyan** energy — see the art-direction memory):
- **Frame** — a faceted **hex/shield** medallion with a metal rim (tier metal: bronze/silver/gold)
  and an inner **neon-cyan energy ring**.
- **Glyph** — a distinct central emblem per subject (e.g. numerals/orbit/leaf/quill/beaker), sharp
  and geometric, on a dark inset so it pops.
- **Ribbon banner** — a lower banner carrying the title; localized.
- **Tier & rarity** — metal + facet count + glow intensity escalate bronze→silver→gold.
- **States** (one SVG, data-driven): **locked** (desaturated silhouette + 🔒), **in-progress**
  (full art dimmed under a radial % ring, §22.3), **earned** (full color + specular shine + subtle
  idle shimmer).
- **Delivered as** layered inline SVG (gradients/filters, theme-aware, crisp at 32→512 px). Live in
  `frontend/public/badges/` (or a `<Badge>` component); a design gallery is the source of truth for
  the look.

### 22.3 Progress overlay + radial ring
While a badge is unearned, the kid can see **how close** they are: the badge sits inside a
**radial progress ring** showing % toward earning (0–100), with the exact figure on hover/tap.
Progress = mastery signal from the brain/xAPI (skills mastered / total for that badge). The ring
appears in the profile, the toast, and any badge overlay.

### 22.4 In-world task toast
On each `MarkTaskComplete` (§12), a **toast** slides in with: the relevant badge's **symbol**, the
**ring ticking up** (old% → new%), and a **"+N%"** delta. The kid *sees themselves progress*
toward the badge every task. Auto-dismiss; localized; queues if several fire.

### 22.5 Earn moment — the big cinematic
When a badge is earned, a **full-screen celebratory cinematic** plays: dim the app, the badge
**zooms in** with light rays + confetti + a shine sweep, tier metal gleams, fanfare SFX, then it
settles into a "New badge!" card with **its meaning** and a **See in profile / Continue** button.
For a **world-clear** badge this is folded into the world finale (§10); for **subject-mastery** it
plays wherever mastery lands. Distinct from the small toast — this is the payoff.

### 22.6 Kid profile — badge status
A **Badges** area in the kid's profile:
- **Earned** — full-art grid, tier, title, date, and one-line meaning; tap → the earn card again.
- **In-progress** — dimmed art + radial % ring + "what's left" hint.
- **Locked** — silhouette + how to start.
Grouped by subject/world; shows tier progression (bronze→silver→gold) per subject.

### 22.7 Teacher view — badges as learning evidence
Teachers see, per kid and per class, **which badges were earned, when, and what they mean in
learning terms** — the subject/skills each badge certifies (mastery evidence), tier reached, and
in-progress badges with %. A class roll-up highlights who's mastered what and who's stalled. This
reuses the existing teacher-insights/dashboard projection; badges become a legible achievement lens
over the same brain/xAPI mastery data.

### 22.8 Data model
Extend `learner_state.badges` (from §21.7) — each badge:
`{ id, family (subject|world), subject?, world?, kind: 'subject-mastery'|'world-clear',
tier: 'bronze'|'silver'|'gold', title, glyph, meaning, progress: 0..1, signatureCosmeticId,
earnedAt|null }`. **Progress is server-computed** from mastery (brain/xAPI); the client renders it.

### 22.9 Integration
- **Source of truth** = learner memory (`badges`), server-computed progress; survives reload.
- **Bridge** — reuse `MarkTaskComplete` → toast; `FinaleComplete` / mastery event → earn cinematic;
  no new Unity coupling (all badge UI is React).
- **Grants** — earning a badge triggers its signature cosmetic grant (§21) + unlock dialog.
- **Localized** he/en/ar (titles, meanings, ring/toast copy).

### 22.10 Phases & guardrails
- **Phase 2** — badge SVG system + profile status view + progress ring + task toast (progress is
  visible early, even before earning is wired).
- **Phase 6** — earn cinematic + signature-cosmetic tie + teacher badge lens.
- **Guardrails** — progress must be **honest** (real mastery, never inflated); **no premature earn**
  (server decides); earning is **idempotent** (replays don't re-fire the cinematic or re-grant);
  every badge has a **meaning string** so it's never a mystery trophy.
