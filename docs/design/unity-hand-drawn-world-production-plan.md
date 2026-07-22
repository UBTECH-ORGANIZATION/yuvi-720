
> **Visual rejection record (2026):** The Atlas terrain experiment, all earlier generated primitive world assets, and grayscale composition A were rejected by the product owner. Composition A was too sparse and separated the world into disconnected islands. They are not references, fallbacks, or approved production assets. New work must use one continuous explorable world, camera framing around Yuvi, substantially denser authored detail, and an animation-ready runtime representation.
# Unity Hand-Drawn Learning World — Production Plan

**Status:** Approved architecture for asset-by-asset high-fidelity production  
**Primary 720 coverage:** Feature 1 — personalized learning-item delivery and world navigation  
**Supporting coverage:** Feature 3 — visible AI companion; Feature 4 — understandable learning position  
**Target:** Unity 6 WebGL embedded in the React learning portal  
**Art direction:** Original hand-inked theatrical-cartoon world with watercolor/gouache fills; inspired by the craft and density of early animation, without copying protected characters, maps, buildings, UI, music, or silhouettes.

## 1. Decision

The world will use a **hybrid deformable-mesh 2.5D pipeline**, not blanket dense 3D and not SVG/sprite layers as the required runtime representation.

- Terrain, cliffs, bridges, roofs, water, and depth-critical structures use shallow native Unity meshes.
- Buildings use dimensional lit geometry with authored proportions, readable structural depth, and restrained stylization.
- Trees, grass, flags, cloth, vines, and character parts use segmented transform rigs or skinned meshes where deformation matters.
- Rigid mesh cards remain acceptable only for distant or static details that do not need deformation or structural depth.
- A small WebGL-safe shared material set supplies painted colors, restrained texture/grain, state cues, and optional shared wind parameters.
- Yuvi remains the canonical customized Three.js model rendered by React above Unity. Unity owns only its invisible movement, collision, interaction, section-camera selection, and world-space projection proxy.
- Invisible simplified geometry owns traversal, obstacles, and interaction. Visible meshes never become the source of progression, mastery, unlock, or resume state.
- SVG may remain as concept/source evidence, but production prefabs and runtime animation must not depend on SVG import, SVG rendering, or exact exported sprite dimensions.

This preserves the drawn silhouette and WebGL budget while allowing wind, squash, bend, gesture, and later animation without rebuilding every asset.

### 1.1 Production workflow decision

Production proceeds one asset or tightly reusable family at a time. Each asset is built in an isolated lit review scene, inspected at gameplay and close-up scales, revised until visually approved, and only then integrated into the connected world. Compilation, contract, accessibility, reduced-motion, low-power, movement, and WebGL gates remain blocking. Bulk generation may create technical proxies but cannot promote learner-facing art without visual approval.

### 1.2 Verified starting point

- Unity `6000.0.79f1` is connected and compiling cleanly.
- The project uses the Built-in Render Pipeline (`m_CustomRenderPipeline` is unset), with OpenGL ES 3 selected for WebGL.
- The production scene retains one `LearningWorldController`, but rejected runtime primitive visual generation has been removed.
- Structural prefab contracts and `WorldAssetCatalog` exist and are populated by a deterministic bulk mesh builder.
- The Atlas terrain experiment and its source assets were deleted and must not be restored or used as fallback art.
- The WebGL build is already hosted successfully at the React `/learning` route in the VS Code integrated browser.
- The current browser run reports repeated `getInternalformatParameter: invalid internalformat` WebGL warnings. Treat these as a baseline compatibility investigation before approving new texture formats or shaders; do not attribute them to future art assets without profiling.
- WebGL memory is configured to grow from `256` MiB to a maximum of `768` MiB. Build compression is currently disabled, so transferred artifact size must be measured rather than inferred.

## 2. Non-Negotiable Product and Architecture Boundaries

### 2.1 Stable React-to-Unity interface

The public `LearningWorldController` façade must retain these methods:

- `Configure(string json)`
- `SetSelected(string landmarkId)`
- `Focus(string landmarkId)`
- `TravelTo(string landmarkId)`
- `ShowBlocked(string landmarkId)`
- `ResetCamera(string unused = "")`
- `SetPaused(string paused)`

The following browser events must retain their current names and meanings:

- `runtime-ready`
- `ready`
- `landmark-select`
- `blocked`
- `bridge-blocked`
- `Yuvi-interact`
- `travel-complete`
- `stats`
- `error`

Art-system refactoring may happen behind this façade. It must not require the React host to understand prefabs, zones, materials, or visual variants.

### 2.2 Data ownership

- React and backend APIs provide unit ordering and landmark state.
- Shared Learning Brain/xAPI/content-provider data remains authoritative for progress, mastery, recommendations, unlocks, resume position, and assessment status.
- Unity visualizes only the narrow, non-identifying `WorldConfig` contract.
- Unity does not persist learner state.
- Unity does not invent progression, numeric scores, mastery, or teacher insights.
- Unity does not receive names, email addresses, school details, disclosures, or other learner PII.
- Global learning progress remains in the platform UI, not inside the Unity canvas.

### 2.3 Localization and accessibility

- Learner-facing labels, descriptions, instructions, and detailed status text stay in localized React UI unless a separate Unity localization implementation is approved.
- Decorative signs should use icons or abstract marks, not baked Hebrew/Arabic/English text.
- State must never rely only on color. Each state needs a silhouette, icon, prop, motion, or pattern cue.
- React retains the semantic landmark list and accessible fallback for the canvas.
- Keyboard, mouse, and touch paths remain equivalent.
- `reducedMotion` and `lowPower` must affect every environmental and character animation system.

## 3. Visual Pillars

### 3.1 Drawn, not manufactured

Every visible asset should contain evidence of an artist's hand:

- variable-width dark ink contours;
- asymmetry and gently imperfect geometry;
- gouache/watercolor value variation;
- restrained paper grain;
- slight registration offset only where it improves charm;
- curved, lively silhouettes instead of perfect boxes and cylinders;
- painted contact shadows rather than heavy photorealistic lighting;
- deliberate clusters of detail separated by calm negative space.

### 3.2 Readable from the gameplay camera

- A building must be identifiable from its outer silhouette before details are visible.
- Landmarks should remain distinct at the default orthographic zoom.
- Walkable open space, stairs, ramps, and local bridge entrances must remain visible behind trees and props.
- Interactive elements receive stronger edge contrast than decorative elements.
- Foreground framing assets may overlap terrain but never cover a current target or Yuvi.

### 3.3 Rich but organized

The target reference is used for **density, layering, variety, and care**, not as a map to reproduce.

Each screen frame should contain:

1. one clear primary destination;
2. two to four secondary visual anchors;
3. readable open-space composition with optional decorative path language;
4. terrain transitions that explain elevation and boundaries;
5. clustered vegetation and props;
6. quiet areas that prevent cognitive overload;
7. foreground, midground, and background depth cues.

### 3.4 Calm learning-state language

The world may be playful, but learning state is calm and actionable:

- no aggressive red failure screens;
- no numeric learner grades;
- no student comparisons;
- recovery routes look inviting rather than punitive;
- locked content communicates “not yet” rather than failure;
- celebrations are short, warm, and suppressible by reduced-motion settings.

### 3.5 Continuous world and camera-led exploration

- The navigable world is one connected mainland/campus, not a chain of detached islands.
- Districts are separated through elevation, vegetation, architecture, streams, courtyards, and gates—not empty water gaps or mandatory road corridors.
- A bridge may cross a local stream, ravine, or canal, but it must not be the only connection between large floating land pieces.
- The complete world is larger than one gameplay viewport. Each authored section owns one static whole-section view, and the camera reveals the next composition only when Yuvi crosses a section boundary.
- Yuvi enters from the far-left arrival area rather than spawning at the map center or beside the current/recommended landmark. District order unfolds first to the right, then through right/up-right transitions, so the world is discovered through movement.
- At normal gameplay zoom, Yuvi, nearby walkable space, one primary destination, and two to four secondary anchors remain visible.
- Overview framing is a review/debug presentation; the learner experience uses fixed authored section framing with smooth boundary transitions and optional shallow visual parallax.
- Dense detail is authored in clusters with walkable-area and interaction exclusion zones, so richness never hides Yuvi or landmark approaches.
- Roads and trails are decorative composition tools only. They never define or limit where Yuvi may walk.
- Walkability is authored as invisible area polygons or simple traversal colliders, independently of terrain paint and sprite silhouettes.
- World height is real: raised terraces, ramps, stairs, bridges, and slopes project Yuvi onto different ground elevations.
- The broad play pattern is an original illustrated overworld with free roaming, landmark interaction, and section-led camera reveals. Do not copy proprietary map layouts, assets, characters, code, or encounter design.

## 4. World Composition Grammar

The complete world is assembled from authored kits rather than one enormous painting. Each learning unit maps to a district or landmark within the same connected landform while the platform still controls order and availability.

### 4.1 Map layers

| Layer | Purpose | Typical assets |
|---|---|---|
| Far background | World scale and atmosphere | painted sky gradient, distant mountains, cloud banks, distant settlement silhouettes |
| Water/background plane | Local environmental features | streams, ponds, canals, shoreline glimpses, large shadow wash |
| Terrain base | Navigable land | grass/soil/sand/wetland tops, cliffs, coast |
| Ground-detail layer | Composition and story | optional roads, stepping stones, worn grass, stairs, ramps, bridge approaches |
| Landmark layer | Learning destinations | buildings, gates, gardens, docks, stages |
| Midground decoration | Story and variety | trees, rocks, fences, carts, lamps, plants |
| Character layer | Yuvi and residents | avatar, guides, ambient creatures |
| Foreground framing | Depth and composition | large leaves, cliff edges, mist cards |
| State/VFX layer | Interaction feedback | selection halo, current banner, lock treatment, completion flourish |

### 4.2 Zone composition recipe

Every authored zone should include:

- one hero landmark;
- one secondary structure or activity space;
- one arrival point and one departure point;
- at least two open-space branches or visual loops; roads may suggest them but never constrain them;
- one distinct terrain feature;
- one vegetation family with three silhouette sizes;
- one storytelling prop cluster;
- one quiet rest/help area;
- a clear open-space, bridge, gate, terrace, or shoreline transition to the next zone;
- collision and click proxies independent of the artwork.

### 4.3 Original district themes

These are visual containers, not hard-coded curriculum subjects:

1. **Welcome Harbor** — docks, small cottages, orientation pavilion, calm shallows.
2. **Maker Meadow** — awnings, workshop sheds, gears/tools as decorative motifs.
3. **Story Grove** — curved tree canopies, open-air stage, lantern paths.
4. **Archive Hill** — stacked reading rooms, paper-vane tower, sheltered courtyards.
5. **Observation Ridge** — telescope-like abstract forms, wind indicators, high paths.
6. **Reflection Gardens** — ponds, benches, gentle bridges, quiet pavilions.
7. **Mentor Lodge** — welcoming shared table, notice board, private garden boundary.
8. **Challenge Crossing** — gates and route choices that communicate readiness without scores.

The same visual district can host different approved content. Building art must not imply unapproved curriculum content.

## 5. Asset Production Levels

### 5.1 Hero assets

Hero assets receive the deepest review during the holistic world pass and may receive focused follow-up iterations after that pass.

- primary buildings;
- unique bridges;
- Yuvi;
- major terrain chunks;
- district gates;
- waterfalls, caves, and towers;
- signature interactive landmarks.

### 5.2 Modular assets

Modular assets are designed as families with shared proportions and palette:

- path segments;
- terrain edges;
- stairs and ramps;
- bridge end caps;
- trees and bushes;
- rocks and flowers;
- fences, lamps, benches, signs;
- roof, door, window, chimney, and awning variants.

### 5.3 Dressing assets

Dressing assets provide controlled variation and should be inexpensive:

- grass tufts;
- pebbles;
- leaves;
- shells;
- mushrooms;
- paper scraps;
- small crates and tools;
- ripples and foam marks;
- tiny foreground silhouettes.

## 6. Detailed Asset Inventory

## 6.1 Terrain top-surface kit

Create each top surface as a seamless base plus irregular painted edge/stamp variants.

| Family | Required variants | Notes |
|---|---:|---|
| Soft meadow grass | 4 bases + 8 stamps | primary friendly terrain; warm/cool and sparse/dense variants |
| Dry grass | 3 bases + 6 stamps | transition near cliffs and exposed ridges |
| Forest floor | 3 bases + 8 stamps | leaf litter, roots, moss patches |
| Garden lawn | 2 bases + 6 stamps | more maintained, near mentor/reflection structures |
| Packed earth | 3 bases + 6 stamps | under props and secondary paths |
| Rocky plateau | 3 bases + 8 cracks | high ground, caves, observation areas |
| Sand and beach | 3 bases + 8 shore marks | shells, wet/dry transition, no repeated stripe look |
| Wetland/marsh | 3 bases + 8 puddle/reed stamps | use sparingly; strong walkability boundary |
| Courtyard stone | 4 tile groups + 6 repairs | irregular hand-set stones; avoid perfect grids |
| Timber platform | 3 plank groups | docks, platforms, bridge landings |

## 6.2 Terrain silhouettes and landforms

- connected mainland district: convex, concave, corridor, plaza, courtyard;
- continuous district transition: meadow-to-grove, village-to-garden, ridge-to-valley;
- peninsula or shoreline inset: broad, narrow, hooked, always connected to the mainland;
- local stream/canal crossing: shallow ford, timber bridge, stone bridge, stepping route;
- raised plateau: low and high variants;
- hill mound: three silhouettes;
- cliff shelf and overlook;
- cave mouth with open, closed, and softly lit states;
- shoreline cove;
- waterfall ledge;
- river channel;
- pond basin;
- ravine/chasm boundary;
- distant non-navigable mountain and settlement silhouettes.

Each navigable landform needs:

- painted top;
- cliff or edge art;
- coast/foam contact layer where relevant;
- contact shadow;
- simplified navigation polygon or set of zones;
- bridge/path anchor transforms;
- decoration exclusion zones around landmarks and routes.

## 6.3 Cliff, coast, and elevation kit

For each edge family, create straight, gentle curve, sharp curve, inner corner, outer corner, tip, and transition pieces.

- grassy cliff edge;
- sandstone cliff;
- dark rock cliff;
- mossy cliff;
- beach edge;
- muddy wetland edge;
- courtyard retaining wall;
- timber retaining wall;
- waterfall lip;
- cave/ravine edge;
- painted foam line;
- shallow-water line;
- land contact shadow;
- cliff strata accents;
- hanging roots, vines, and small ledges.

## 6.4 Decorative ground-detail kit

Paths add history, composition, and gentle wayfinding. They are optional artwork and never define the walkable surface.

- parchment/ochre main road;
- packed-earth trail;
- stepping-stone route;
- courtyard stones;
- timber boardwalk;
- garden path;
- rocky mountain trail;
- wetland plank path;
- bridge approach;
- cave threshold;
- stairs: short, medium, turning;
- ramps: earth, timber, stone;
- junctions: T, Y, four-way, fork, loop;
- endpoints: landmark apron, gate, dock, rest area;
- worn edges, wheel ruts, leaf cover, puddles, repair patches.

Each ground-detail family may include straight, short, long, left curve, right curve, S-curve, widening, narrowing, junction, end cap, and transition stamps. Open grass, courtyards, gardens, and plateaus remain freely walkable where their independent movement areas permit it.

## 6.5 Bridge system

Every bridge is a prefab family with approach pieces, walk surface, rail/edge treatment, shadow, collision strip, and state attachment points.

1. **Rope bridge**
   - short and long spans;
   - calm sag and stronger sag silhouettes;
   - plank variation sheet;
   - rope rails and posts;
   - open, locked, repaired, and broken-background variants.

2. **Timber beam bridge**
   - rustic, maintained, and patched;
   - straight and slight-curve versions;
   - entry posts and lantern options.

3. **Stone arch bridge**
   - single arch and double arch;
   - dry crossing, stream, and canal versions;
   - moss and clean variants.

4. **Garden bridge**
   - compact arched silhouette;
   - rail and no-rail variants;
   - pond and stream approaches.

5. **Drawbridge/gate bridge**
   - open and closed states;
   - chain/winch art;
   - used for strong “not yet” communication.

6. **Stepping stones**
   - small, medium, and irregular paths;
   - dry, shallow-water, and misty variants.

7. **Boardwalk**
   - straight, turning, junction, platform, and damaged-background sections.

State treatment cannot be only a tint:

- locked: closed gate/rope tie plus lock-shaped sign and muted motion;
- available: open entrance plus small fluttering pennant;
- current/recommended: distinct compass marker and warm directional light;
- completed: repaired detail, flowers/ribbon, and a stable emblem;
- recovery route: visible helping-hand or lantern motif, never a failure symbol.

## 6.6 Building and landmark families

Each building family requires a unique overall silhouette, roof language, entrance, window rhythm, chimney/tower element, small prop cluster, painted shadow, collision footprint, selection anchor, and at least two non-color state cues.

### A. Welcome cottages

- squat cottage;
- tall narrow cottage;
- paired cottage;
- harbor cottage;
- porch, awning, roof, door, window, chimney, planter, and mailbox variants.

### B. Learning halls

- round hall;
- long hall;
- courtyard hall;
- small pavilion;
- banner and entrance variants that do not contain baked text.

### C. Workshop/maker structures

- open workshop;
- tool shed;
- wind-powered workshop;
- covered outdoor table;
- decorative gears, pulleys, paper plans, crates, and safe tools.

### D. Library/archive structures

- stacked archive house;
- reading pavilion;
- scroll/book tower silhouette;
- covered shelves and reading-nook props;
- avoid tiny unreadable book details at gameplay scale.

### E. Observatory/observation structures

- hill observatory;
- wind-and-weather tower;
- viewing platform;
- abstract lens/telescope motifs rather than realistic scientific instruction.

### F. Theater/story structures

- open-air stage;
- story tent;
- puppet pavilion;
- backstage wagon;
- curtain, lantern, mask, and scenery variants with original iconography.

### G. Mentor and reflection structures

- mentor lodge;
- quiet pavilion;
- garden shelter;
- shared table area;
- private-note visual boundaries must not imply hidden learner data inside Unity.

### H. Garden and greenhouse structures

- glasshouse silhouette;
- seed shed;
- pergola;
- fountain/pond pavilion;
- vines, pots, watering tools, and trellis variants.

### I. Towers and gates

- district gate;
- watch/wayfinding tower;
- clockless bell tower;
- bridge gatehouse;
- assessment/challenge gate that avoids numeric scores and punitive imagery.

### J. Harbor and travel structures

- dock office;
- boathouse;
- ferry shelter;
- lighthouse-inspired wayfinding tower;
- cranes, ropes, barrels, nets, and mooring posts.

### K. Small kiosks and tents

- help kiosk;
- map kiosk;
- rest tent;
- market-style decorative canopy;
- use icon signage and localized React labels outside the canvas.

### L. Unique hero landmarks

Produce these in the same deterministic batch as the modular families, then review them in context:

- grand archive hill;
- reflection tree pavilion;
- waterwheel workshop;
- cloud observation tower;
- story amphitheater;
- mentor garden lodge;
- challenge crossing gate;
- central compass plaza.

## 6.7 Landmark state kit

State is applied through child renderers/animators so the base building stays reusable.

| State | Shape cue | Pattern/prop cue | Motion cue |
|---|---|---|---|
| Locked | closed door/gate | rope tie or lock emblem | nearly still; slow breathing cloud only |
| Available | open approach | lit lantern or raised pennant | subtle flag/leaf motion |
| Current | compass/arrow silhouette | warm threshold and focus ring | short pulse on change, then stable |
| Recommended | helping lantern/path markers | distinct companion emblem | gentle directional shimmer |
| Completed | repaired/flourishing silhouette | ribbon, flowers, stamped emblem | one short flourish, no looping celebration |
| Recovery alternative | open side route | lantern/help motif | calm guiding blink |
| Selected/hovered | larger outline and base shadow | focus halo | 120–180 ms lift or outline reveal |
| Blocked feedback | gate bounce/rope tension | “not yet” emblem | one short response; no shake loop |

## 6.8 Vegetation kit

### Trees

At minimum, create four silhouette scales for each major family:

- round meadow tree;
- tall narrow cypress-like tree;
- bent coastal tree;
- broad story-grove tree;
- orchard tree;
- willow-like pond tree;
- pine/highland tree;
- dead/fallen decorative tree used sparingly and never as punishment.

For each family:

- young, medium, mature, and hero silhouettes;
- mirrored or independently redrawn variants;
- trunk, canopy, and foreground branch layers;
- still and gentle-sway clips;
- reduced-motion still frame;
- cluster prefab with safe path clearance.

### Ground vegetation

- bushes: round, tall, flowering, hedge;
- grass: short, tall, edge, wind-swept;
- flowers: six shapes across controlled palette groups;
- reeds and cattails;
- ferns;
- mushrooms;
- vines and hanging roots;
- lily pads;
- moss stamps;
- leaf piles;
- foreground framing leaves.

## 6.9 Rock and geological kit

- pebble clusters;
- small rounded rocks;
- medium boulders;
- tall landmark rocks;
- flat stepping stones;
- layered sandstone;
- dark highland rocks;
- mossy rocks;
- cave rocks;
- cliff-face accent stones;
- crystal-like abstract accents only when appropriate and not presented as curriculum content.

Every family needs three silhouettes and at least two rotations/redraws to prevent obvious repetition.

## 6.10 Prop and storytelling kit

### Navigation and comfort

- icon signposts;
- fences and gates;
- lamps and lanterns;
- benches;
- shade canopies;
- rest blankets/cushions;
- help bell or companion beacon;
- bridge markers;
- dock posts.

### Work and travel

- crates and barrels;
- carts and wagons;
- ropes and pulleys;
- baskets;
- safe hand tools;
- paper plans;
- backpacks;
- boat silhouettes for background only;
- ladders and scaffolds;
- repair materials.

### Learning-world atmosphere

- books and scroll bundles;
- chalkboard-like icon boards without baked text;
- globes/maps using original abstract geography;
- lenses and weather vanes;
- stage scenery;
- garden pots;
- musical-looking decorative props without copying instruments tied to protected characters;
- banners with original geometric motifs.

### Small life and ambience

- birds, butterflies, fireflies, fish shadows, snails, and frogs;
- ambient creatures are decorative, non-collectible, and disabled/reduced in low-power mode.

## 6.11 Water and atmospheric system

### Water assets

- ocean base paint texture;
- two current overlays;
- broad wave bands;
- shoreline foam strips;
- rock foam rings;
- bridge-pier ripples;
- pond surface;
- stream ribbon;
- waterfall sheet and mist base;
- shallow-water sand overlay;
- reflected-light wash.

### Atmospheric assets

- three cloud-bank silhouettes;
- six small cloud puffs;
- mist ribbons;
- cloud shadows;
- dust/pollen motes;
- drifting leaves;
- small chimney smoke;
- lantern glow;
- distant rain curtain only if an approved zone needs it.

Motion rules:

- no full-screen constant motion;
- use staggered short loops and held poses;
- reduced-motion freezes decorative loops and removes camera-scale movement;
- low-power disables most particles and uses one water/current layer;
- no flashing, rapid strobing, or high-frequency contrast changes.

## 6.12 Yuvi and resident characters

### Yuvi integration deliverables

- reuse the existing `YuviAvatar3D` geometry, variants, colors, accessories, face animation, and interaction behavior;
- keep a renderer-free Unity player proxy for movement, collision, interaction, routes, and camera follow;
- emit normalized viewport position, visibility, scale, heading, and movement state to React at a smooth bounded cadence;
- render Yuvi in a transparent Three.js layer above the Unity canvas without remounting it during movement;
- preserve low-power, reduced-motion, keyboard activation, and click-to-open-companion behavior;
- accept that this first hybrid version always composites Yuvi above Unity depth; do not place critical foreground occluders over its route.

Animation target for the existing Three.js avatar:

- authored on twos/held poses around a 12 fps visual cadence;
- engine playback may remain at 60 fps while sprite/cutout poses update at the authored cadence;
- short anticipation and settle poses;
- smooth heading/flight transitions driven by Unity movement state;
- visual animation never changes Unity collision bounds or authoritative position.

### Residents/guides

Start with only three reusable original residents:

- harbor guide;
- workshop caretaker;
- garden/story guide.

Each receives idle, acknowledge, point, and celebrate clips. Residents do not deliver unlocalized text inside Unity; they trigger React companion/UI behavior.

## 7. Technical Architecture

## 7.1 Project tier

Treat this as a **long-lived visual product**, but use a small architecture:

1. **LearningWorldController façade** — preserves browser API and coordinates configuration.
2. **WorldLayoutBuilder** — chooses authored continuous districts, elevation zones, and landmark anchors from unit count.
3. **WorldPresentationBuilder** — instantiates terrain, landmarks, props, and state layers.
4. **WorldAssetCatalog** — `ScriptableObject` containing authored prefab families and safe visual fallbacks.
5. **WorldStatePresenter** — maps `locked/current/available/completed` to visual overlays without changing source data.
6. **WorldTraversalSurface** — owns invisible walkable areas, projected elevation, local crossings, and click destinations independently of roads and painted terrain.
7. **WorldMotionController** — centralizes ambient motion, reduced-motion, low-power, and pause behavior.

Do not create a broad service framework or hidden global singleton. `LearningWorldController` remains the explicit scene entry point.

## 7.2 Scene contract

The production scene should contain these roots:

- `LearningWorld`
  - `LearningWorldController`
  - inspector reference to `WorldAssetCatalog`
- `WorldCameraRig`
  - orthographic `Camera`
  - `AudioListener`
- `WorldLighting`
  - one main directional light only if the chosen art treatment needs it
- `RuntimeWorldRoot`
  - generated visual and collision content
- `WorldSystems`
  - motion/state/pooling helpers

The current build may continue creating these objects from one bootstrap during migration, but the final scene must validate required references before accepting `Configure`.

## 7.3 Prefab contract

Every interactive landmark prefab contains:

- root transform at ground-contact center;
- `LandmarkVisual` component;
- `VisualRoot` child;
- `StateRoot` child;
- `ShadowRoot` child;
- `InteractionAnchor`;
- `ApproachAnchor`;
- `FocusAnchor`;
- simplified box/capsule/polygon collider on the landmark interaction layer;
- optional ambient animator disabled by reduced-motion mode.

Every bridge prefab contains:

- `StartAnchor` and `EndAnchor`;
- `WalkSurface` proxy;
- `VisualRoot`;
- `OpenState` and `LockedState` roots;
- `BlockedInteractionAnchor`;
- optional water-contact effect anchors.

Every decoration prefab is visual-only by default and must not introduce a collider unless explicitly required.

## 7.4 Catalog data

Use `ScriptableObject` only for authored static visual data:

- terrain family IDs;
- landmark family IDs;
- prefab variants;
- allowed palette/tint masks;
- state-overlay prefabs;
- density and exclusion radii;
- low-power substitutes;
- review status/version.

Never store live learner state, current progress, selected landmark, or runtime position in `ScriptableObject` assets.

## 7.5 Sorting and depth

Use explicit sorting/depth bands, even though movement remains in the XZ plane:

| Band | Content |
|---:|---|
| -50 to -40 | far background and distant silhouettes |
| -39 to -30 | water and water shadows |
| -29 to -20 | terrain base, cliffs, coast |
| -19 to -10 | decorative ground marks, bridge surfaces, terrain stamps |
| -9 to 0 | building bases and small props |
| 1 to 10 | characters and mid-height vegetation |
| 11 to 20 | roofs, tree canopies, foreground parts |
| 21 to 30 | interaction overlays and state emblems |
| 31 to 40 | transient VFX |

Within a band, derive order from world depth consistently. Do not solve ordering with arbitrary per-prefab values.

## 7.6 Collision and movement

The legacy ellipse-only `IslandZone` and island-to-island bridge routing model is rejected. Movement uses one continuous collection of authored walkable-area colliders.

Migration path:

1. Author broad invisible walkable-area proxies for open ground, courtyards, ramps, terraces, stairs, and local bridges.
2. Project Yuvi to the highest valid ground surface while enforcing maximum rise and drop limits.
3. Allow free keyboard and pointer movement anywhere inside these areas; do not snap movement to roads.
4. Add decoration exclusion radii around open movement space and landmark approaches.
5. Validate that every reachable landmark has a continuous traversable area connection.
6. Keep visuals, traversal, obstacle collision, and learning-state locks independently replaceable.
7. Use simple box or low-poly mesh colliders, never sprite alpha or detailed render meshes.

### 7.7 2.5D depth and camera mechanics

- Use a pitched orthographic camera that follows Yuvi with restrained look-ahead and bounded zoom.
- Terrain tops, ramps, stairs, cliffs, bridges, and building bases occupy real world-space height.
- Illustrated façades, roofs, trees, props, and effects are layered silhouette meshes at shallow depth offsets, with transform segments where movement matters.
- Landmark prefabs separate base, façade, roof/foreground, shadow, movable pivots, and state layers so Yuvi can pass visually behind tall elements where appropriate.
- Painted contact shadows, shallow geometry, and height-separated mesh layers provide depth; glossy primitives and generic perspective extrusion do not.
- Foreground layers may use restrained camera-relative parallax. Reduced-motion freezes nonessential parallax, wind, deformation, and line-boil movement.
- Movement remains on the XZ plane projected to authored ground height; visible roads have no movement authority.

## 8. Asset Folder and Naming Standard

```text
Assets/
  Art/
    World/
      ArtSource/
      Atlases/
      Buildings/
      Bridges/
      Characters/
      Effects/
      Materials/
      Props/
      Terrain/
      Vegetation/
      Water/
  Data/
    World/
      Catalogs/
      Layouts/
  Prefabs/
    World/
      Buildings/
      Bridges/
      Characters/
      Effects/
      Props/
      Terrain/
      Vegetation/
  Scenes/
    LearningWorld.unity
    ArtReview/
  Scripts/
    World/
      Runtime/
      Editor/
  Shaders/
    World/
```

Naming prefixes:

- `SPR_` sprite;
- `TEX_` non-sprite texture;
- `ATL_` sprite atlas;
- `MAT_` material;
- `SHD_` shader;
- `PF_` prefab;
- `SO_` ScriptableObject asset;
- `ANIM_` animation clip;
- `CTRL_` animator controller;
- `SCN_` review or production scene.

Pattern:

`<Prefix>_YW_<Family>_<Type>_<Variant>_<State>`

Examples:

- `SPR_YW_Terrain_Grass_A_Base`
- `PF_YW_Bridge_Rope_Long_Available`
- `PF_YW_Landmark_ArchiveHill_A`
- `ANIM_YW_Yuvi_Help_A`

## 9. Source-Art and Import Standard

### 9.1 Source deliverables

Every approved asset keeps:

- editable layered source file;
- approved model/mesh source or deterministic Unity mesh-generation definition;
- concept sheet;
- palette reference;
- integration notes;
- copyright/originality review note for hero assets.

### 9.2 Mesh and optional texture defaults

Initial defaults, adjusted only after representative-world measurement:

- pivot: ground-contact point for props/buildings, bend root for vegetation, body root for characters;
- deformation segments are separate transforms or bones with stable names and captured rest poses;
- ordinary dressing assets target tens of vertices, hero silhouettes hundreds, not dense sculpt topology;
- shared meshes and materials are reused by repeated families;
- mesh colliders are not copied from render meshes; use boxes or deliberately simplified low-poly proxies;
- imported textures are optional surface treatment, never embedded learner-facing text;
- no Read/Write unless a verified runtime need exists;
- normal maps avoided by default;
- platform-specific WebGL mesh/texture behavior is tested before formats are locked.

### 9.3 Texture size classes

- tiny stamps/icons: 128–256 px;
- ordinary props/plants: 256–512 px;
- trees and modular building layers: 512–1024 px;
- hero building or terrain sheet: up to 2048 px only with review;
- no 4096 px texture without a measured exception.

Group optional textures by update/material behavior, not merely by folder:

- static terrain stamps;
- static vegetation;
- building bases;
- building state overlays;
- animated environment frames;
- character frames;
- VFX.

Do not combine frequently animated and fully static art if that breaks batching or forces unnecessary memory residency. Mesh-only color families should share instancing-compatible materials.

## 10. Materials and Shaders

Use the smallest WebGL-safe shader set:

1. **Opaque/cutout painted sprite** — unlit or lightly lit; alpha clipping where appropriate.
2. **Transparent painted sprite** — for foam, mist, and soft edges; used sparingly to control overdraw.
3. **Painted water** — one or two texture samples, UV offset, tint, optional foam mask.
4. **State overlay** — tint plus pattern/outline support; no full-screen post-processing dependency.

Avoid:

- geometry or tessellation shaders;
- compute shaders;
- screen-space outlines on every object;
- per-object unique material instances;
- expensive normal/specular stacks;
- large transparent layers covering the entire screen;
- shader features that cannot be tested in the actual WebGL build.

Ink outlines should be part of the artwork for most assets. A shader outline is reserved for temporary interaction focus, not the permanent drawing style.

## 11. Animation Standard

### 11.1 Character clips

- Yuvi idle: 2–4 seconds with held poses;
- move: 8–12 unique drawings or equivalent cutout poses per cycle;
- turn: short directional settle;
- help/point: under 1.5 seconds;
- celebrate: under 2 seconds and non-looping;
- concern/recovery: supportive, never shaming;
- click acknowledge: under 1 second.

### 11.2 Environment clips

- trees: 3–6 second staggered sway;
- flags: 1.5–3 seconds;
- water currents: slow continuous offset;
- foam: 4–8 frame sparse loops;
- smoke: short low-opacity loop;
- ambient creatures: mostly held poses with occasional movement.

### 11.3 Runtime control

`WorldMotionController` owns global switches:

- `Normal`: full approved ambient set;
- `ReducedMotion`: character essentials only, decorative loops frozen, no pulsing scale/camera motion;
- `LowPower`: reduced frame sets, vegetation animation off, particles minimized, distant decorations culled;
- `Paused`: all Unity animation and motion paused consistently.

Avoid one `Update()` per decorative object. Group environmental motion through shared materials, animators, or a small centralized scheduler.

## 12. WebGL Budgets and Gates

These are production gates, not claims about the current build. Capture a real baseline before the first art integration.

| Metric | Normal target | Low-power target | Hard review threshold |
|---|---:|---:|---:|
| Frame rate after warm-up | 60 fps desktop; 50+ tablet | 45+ fps target devices | sustained below 40 fps |
| Draw calls in representative two-zone view | <= 120 | <= 85 | > 160 |
| Visible triangles | <= 120k | <= 70k | > 180k |
| Resident texture memory | <= 96 MiB | <= 48 MiB | > 128 MiB |
| Active particles | <= 250 | <= 80 | > 400 |
| Per-frame managed allocation after load | approximately 0 B | approximately 0 B | recurring GC spikes |
| Cold time to interactive | <= 8 s on target school network | <= 8 s | > 12 s |
| Complete production-world art growth | <= 12 MiB transferred data | same | > 18 MiB |
| Transparent full-screen layers | <= 2 | <= 1 | > 3 |

Required devices/browsers before approving mass production:

- current Safari on a supported iPad;
- Chrome on a representative school Chromebook;
- Chrome/Edge desktop integrated graphics;
- Firefox desktop smoke test;
- both normal and `lowPower` configurations.

Every build records:

- Unity build output size;
- transferred `.data`, `.wasm`, and framework sizes;
- cold and warm load times;
- average/minimum frame rate;
- draw calls and triangles from the existing `stats` event;
- memory where browser/Unity profiling permits;
- console errors and shader fallbacks.

## 13. Asset-by-Asset Production and Review Pipeline

### Gate A — Asset brief and isolated scene

- gameplay purpose, silhouette, scale against Yuvi, state needs, motion needs, and originality constraints are explicit;
- the asset is generated or authored in an isolated lit review scene;
- the operation is safely rerunnable without deleting unrelated work.

### Gate B — Automated integration

- compilation succeeds and every catalog ID resolves;
- required prefab contracts, anchors, state roots, simplified colliders, and motion pivots exist;
- production prefabs use native meshes and do not require SVG imports, `SpriteRenderer`, or exact texture dimensions;
- traversal, obstacles, interaction, visuals, and learner state remain independent.

### Gate C — Close-up visual approval

- inspect perspective, side, and robot-follow gameplay captures;
- reject flat silhouettes, crude intersections, inflated blobs, weak material response, noisy clutter, and disconnected parts;
- verify sharp silhouette, believable construction, cohesive materials, grounded contact, and animation-ready segmentation;
- do not begin the next hero asset until the current asset passes visual review.

### Gate D — Motion and accessibility

- wind and character motion use centralized control, not one `Update()` per decorative object;
- normal, low-power, reduced-motion, and paused modes work across the complete scene;
- no state relies only on color and no baked learner-facing text is present.

### Gate E — WebGL, movement, and browser contract

- target-browser rendering matches the Editor closely and performance remains within budget;
- free roaming, elevation, far-left spawn, and right/up-right discovery remain intact;
- touch, keyboard, semantic React fallback, public methods, and browser events pass unchanged.

### Gate F — Integration and owner approval

- the approved asset is integrated without changing traversal or learning-state ownership;
- close-up and world-context screenshots are generated;
- catalog entry/version and hero originality notes are recorded before advancing.

## 14. Representative Complete-World Gate

Build and inspect the complete original connected world in one production pass. It must include continuous terrain and elevation, water, all eight district landmark families, all seven bridge families, vegetation/geology/prop families, Yuvi, state cues, background atmosphere, and normal/low-power/reduced-motion behavior.

The holistic review includes a full composition overview and robot-centered 16:9 captures from the left entrance, middle districts, and right/up-right destination. It must demonstrate all district families, at least six vegetation silhouettes, multiple prop clusters, and animation-ready motion pivots.

### Complete-world approval criteria

- The frame reads as an original illustrated world rather than textured primitives.
- District silhouettes remain distinct and landmarks are recognizable at default zoom.
- Open walkable areas remain understandable without forcing Yuvi onto a road.
- The world reads as one connected place rather than separated islands.
- Dense nearby detail retains unobstructed movement and landmark approaches.
- Raised terrain, shallow structure, and foreground/midground/background meshes create clear 2.5D depth.
- State cues are distinguishable without reading color.
- Yuvi remains readable, clickable, and animation-ready.
- Existing React methods/events pass unchanged and navigation collision does not follow render meshes.
- The representative complete world stays inside all hard WebGL thresholds.
- Hebrew RTL, Arabic RTL, and English LTR platform overlays remain correct around the canvas.
- Reviewers approve the originality/direction or produce a bounded revision list after seeing the complete result.

## 15. Asset Production Phases

### Phase 0 — Baseline and contracts

Freeze browser/API tests and prove free roaming, elevation, camera behavior, topology, catalog contracts, and technical baseline.

### Phase 1 — One high-fidelity asset

Build one landmark or reusable family with lit materials, authored proportions, real depth, motion pivots, prefab contract, and catalog entry.

Exit gate: automated asset, catalog, collider, motion, and no-runtime-SVG validation passes.

### Phase 2 — Isolated visual review

Capture close-up and gameplay views, revise until approved, then integrate into the continuous world while preserving independent traversal.

Exit gate: runtime movement and browser methods/events pass unchanged.

### Phase 3 — Technical validation

Run focused and full EditMode tests, normal/reduced-motion/low-power checks, WebGL build, React publication, hosted movement smoke tests, and performance evidence.

Exit gate: all blocking technical gates pass.

### Phase 4 — Holistic review

Capture overview and gameplay-camera evidence, complete originality review, and produce one prioritized revision list across the assembled world.

### Phase 5 — Revision and polish

Apply the owner’s prioritized fixes without changing stable browser/data contracts; regenerate, retest, rebuild, and recapture.

Exit gate: the full world is cohesive, measurable, accessible, animation-ready, and contract-compatible.

## 16. Effort and Prioritization Model

Use three asset classes when planning capacity:

| Class | Typical scope | Expected review depth |
|---|---|---|
| Hero | unique building, Yuvi, major bridge, waterfall/cave | brief + silhouette + color + animation + integration + WebGL + originality review |
| Modular | tree family, path family, roof/door kit, bridge segments | family concept + representative integration + batch validation |
| Dressing | flowers, pebbles, shells, small props | palette/silhouette sheet + atlas/import review |

Prioritize work by this formula:

`priority = route_readability + reuse_count + interaction_importance + visual_impact - technical_risk`

Do not begin a unique hero asset while a reusable terrain, route, or state-language dependency remains unresolved.

## 17. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Bulk-generated assets look inconsistent | use one palette/material/line/scale grammar, deterministic family builders, and a holistic complete-world review |
| Reference is copied too literally | design original map grammar and silhouettes; retain hero originality notes |
| Mesh count or topology hurts WebGL | shared low-poly meshes/materials, family budgets, instancing-compatible materials, and low-power substitutes |
| Organic art no longer matches traversal | keep authored movement zones independent of render-mesh silhouettes |
| Runtime materials break batching | shared materials and `MaterialPropertyBlock`/approved tint masks; no per-instance material cloning |
| Too many ambient `Update()` loops | centralized motion controller and shared shader/material animation |
| State becomes inaccessible | shape/prop/pattern cues plus React semantic fallback; grayscale reviews |
| Text cannot support RTL/LTR | keep learner-facing text in React; no baked text in world art |
| Build becomes too large | mesh/family budgets, optional texture size classes, complete-world growth cap, and measured build reports |
| Reduced motion is incomplete | global motion modes; every animated prefab declares a still state |
| Structural blockout leaks into learner-facing visuals | keep proxy colliders renderer-free and fail validation when authored visual prefabs are missing |
| Art refactor breaks learning flow | automated contract checks for methods/events and Configure-to-ready behavior |

## 18. Definition of Done for the World Redesign

The redesign is complete only when:

- all visible placeholder primitives in learner-facing normal mode have approved illustrated replacements;
- missing authored visuals fail explicitly; rejected primitive art never returns as a learner-facing fallback;
- every landmark family has accessible state variants;
- every navigable surface has verified collision/movement coverage;
- bridges connect authored anchors without route gaps;
- Yuvi supports normal, reduced-motion, and low-power modes;
- no learner PII or authoritative progress state is stored or generated in Unity;
- React-to-Unity methods and events remain stable;
- the world can be rebuilt reproducibly through the existing WebGL build pipeline;
- review screenshots and a proof video exist for Hebrew RTL, Arabic RTL, and English LTR shells;
- target-browser/device performance meets the approved gates;
- no protected characters, layouts, buildings, logos, music, or asset silhouettes were reproduced.

## 19. Immediate Next Work Package

The baseline, structural catalog, invisible free-roaming surface, raised-terrace/ramp projection, robot-follow camera, stable React bridge, far-left entrance, and right/up-right topology are implemented. Rejected procedural composition art has been removed.

Proceed in this order:

1. publish and visually validate the Three.js Yuvi overlay synchronized to Unity's invisible player proxy;
2. inspect the high-fidelity central learning tree in its isolated lit review scene and capture close-up evidence;
3. revise that tree until it is sharp, cohesive, grounded, and approved at gameplay scale;
4. integrate the approved tree without changing the browser façade, traversal, or Brain/xAPI data ownership;
5. continue one landmark or reusable asset family at a time through the same review gates;
6. reconnect approved assets into the continuous far-left-to-right/up-right world;
7. run full tests, accessibility/motion validation, WebGL publication, hosted movement smoke tests, and final holistic review.

Do not resume bulk learner-facing art generation. Do not delete the prior source evidence until each replacement and complete build validate.
