# Unity Overworld Grounding Architecture

**Status:** Proposed architecture; implementation is blocked on topology-plan approval  
**Decision date:** 2026-07-15  
**Primary 720 coverage:** Feature 1 — personalized learning-item delivery and understandable world navigation  
**Supporting coverage:** Feature 3 — continuous visible companion; Feature 4 — understandable learning position  
**Applies to:** `unity-learning-world/` terrain, traversal, section cameras, structural connectors, editor tooling, tests, and visual-review evidence

## 1. Decision

Replace the rejected three-disc grounding experiment with an **authored, data-driven, editor-baked 2.5D grounding system**.

A camera section is a composition and navigation region, not one circular mesh. Each section may contain:

- a large asymmetric outer footprint;
- concave boundaries and intentional negative spaces;
- multiple elevation bands;
- lower basins, upper shelves, overlooks, courtyards, ravines, and cutouts;
- several surface families;
- local loops and branches;
- explicit connector portals;
- reserved volumes for future hero landmarks and atmosphere;
- exactly one authored static whole-section camera view.

Macro layout remains authored. The system must not auto-place districts on a regular grid or derive geography from the number of curriculum units. Deterministic tools may generate meshes from authored definitions, but they may not replace composition decisions.

The generated result is baked into prefabs and mesh assets in the Editor. Runtime code continues to consume the existing `TerrainVisual`, `WorldTraversalSurface`, `WorldSectionView`, `WorldSectionCameraController`, and `BridgeVisual` contracts. Runtime procedural terrain generation is not part of this decision.

## 2. Rejection Record

The current `HighFidelityGroundingWorldBuilder` output is a **technical experiment, not approved production art**.

It proved that the project can provide:

- native dimensional terrain meshes;
- renderer-free traversal colliders;
- structural connectors;
- elevated movement projection;
- one static camera view per section;
- no visible Unity Yubi;
- clean geometry without square seams or duplicate cliff z-fighting;
- 209 passing EditMode tests.

It was nevertheless rejected because it reads as:

- three repeated circular or oval platforms;
- three small footprints with insufficient hero-asset capacity;
- a simple left-to-right chain;
- grass on nearly every top surface;
- concentric “pancake” shelves;
- straight tan route ribbons;
- generic ramps and steps without landings or retaining structure;
- little meaningful negative space, lower terrain, switchback movement, or traversal around and behind landforms.

The current prefab, review scene, captures, and tests are retained temporarily as rejected evidence. They must not be described as an approval gate or used as the production template.

## 3. Goals

1. Create one continuous explorable world that begins at the far-left and unfolds right and up-right.
2. Give every section a distinct topology, elevation profile, palette, and traversal rhythm.
3. Make the ground large and deep enough to host future hero buildings, vegetation, props, foreground framing, and atmosphere without constricting movement.
4. Support movement up, around, behind, across, and down—not only across a flat central ribbon.
5. Keep traversal independent from visible roads, paint, and decorative surfaces.
6. Preserve the React/Three.js Yubi as the only visible avatar.
7. Preserve exactly one static authored whole-section camera view per section, with transitions only at section boundaries.
8. Keep all learner progress, mastery, recommendation, unlock, and resume truth outside Unity.
9. Produce deterministic, reviewable, testable assets suitable for Unity 6 WebGL.
10. Allow later addition of landmarks and atmosphere without changing terrain topology or runtime browser contracts.

## 4. Non-Goals

This phase does not:

- place buildings, trees, props, signs, characters, or atmospheric effects;
- redesign the visible Three.js Yubi;
- change browser method names or event names;
- move learner state into Unity;
- add runtime terrain generation;
- add NavMesh as a replacement for the current projection-based movement system;
- install ProBuilder, Cinemachine, URP, Addressables, or a terrain package;
- build Unity WebGL or React artifacts;
- copy a proprietary overworld map, silhouette, structure, character, label, music cue, or encounter layout;
- pursue a line-count target or one giant “complete world” builder.

## 5. Research Conclusions

The reusable design lessons from strong illustrated overworlds are abstract:

- overworld navigation is breathing room between focused activities;
- distinct regions need distinct themes and palettes;
- local branches, loops, shortcuts, and discoveries make traversal feel intentional;
- routes should reveal destinations without turning the map into a corridor;
- geography, elevation, structure, and negative space should establish region identity before props do;
- composition must read from the gameplay camera, not only from an overhead map.

The reusable Unity architecture lessons are:

- use ScriptableObjects for authoring-time definitions, not runtime learner state;
- keep scene/prefab components focused and self-contained;
- keep geometry and validation logic in pure C# where practical;
- use thin Editor-facing assembly and capture tools;
- bake deterministic runtime assets instead of generating expensive geometry at runtime;
- profile real WebGL builds before raising budgets or adding packages.

Reference sources:

- Cuphead official site: <https://www.cupheadgame.com/>
- Unity Open Project 1: <https://github.com/UnityTechnologies/open-project-1>
- Unity Boat Attack: <https://github.com/Unity-Technologies/BoatAttack>
- Unity 2D Tech Demos: <https://github.com/Unity-Technologies/2d-techdemos>

These sources inform craft, workflow, modularity, and thematic differentiation only. They are not implementation templates to copy literally. Boat Attack in particular is a graphics reference, not a production architecture authority.

## 6. Architecture Decision Record

### 6.1 Context

There are three plausible approaches:

1. Continue hardcoding each terrain section in one Editor builder.
2. Generate districts automatically from count, seeds, or a regular placement algorithm.
3. Author macro geography as data and use deterministic Editor tools to bake meshes, colliders, cameras, and review assets.

### 6.2 Chosen option

Choose option 3: **authored macro geography plus deterministic editor baking**.

### 6.3 Why this option won

- Topology and composition remain intentional.
- Sections can be structurally different rather than palette-swapped variants.
- Definitions can be reviewed before mesh generation.
- Pure geometry code becomes unit-testable.
- Generated output remains efficient at runtime.
- Existing runtime and browser contracts remain stable.
- The world can grow without expanding one monolithic builder.
- The product owner can approve silhouettes and movement flow before dressing work begins.

### 6.4 Rejected options

#### Continue the monolithic builder

Rejected because geography, material creation, traversal, cameras, captures, and validation are coupled. Every new section increases hardcoded positions, special cases, and review risk.

#### Automatic grid or seed-driven layout

Rejected because the user explicitly requires natural, undefined composition with sections that can have entirely different layouts and dimensions. A grid makes placement scalable in code but generic in experience.

#### Unity Terrain heightmaps

Rejected for this phase because the target uses authored 2.5D silhouettes, cutouts, courtyards, cliff edges, and compact static camera compositions. Unity Terrain would not solve the section-identity or connector-composition problem and would introduce a different authoring/runtime model.

#### Add ProBuilder or a third-party polygon package now

Deferred. The first implementation should use focused project-owned Editor geometry code. Revisit only if concave outlines, holes, or scene-handle authoring cannot be made robust within the planned bounded implementation.

### 6.5 Consequences

- Initial work is slower than generating three seeded platforms.
- Definitions and validation must be designed before more production meshes.
- Editor tools become a real supported subsystem.
- Generated mesh assets must be versioned and reproducible.
- Visual approval remains a human gate; tests cannot claim aesthetic quality.

### 6.6 Revisit triggers

Reconsider dependencies or representation only if:

- polygon-with-holes triangulation remains unstable after focused tests;
- designers cannot edit outlines and portals safely with scene handles;
- baked collider complexity exceeds measured WebGL budgets;
- static camera coverage cannot represent a required section without a contract change;
- profiling demonstrates that generated mesh organization causes unacceptable draw calls or memory use.

## 7. Core Model: A Section Is a Region, Not a Disc

A `GroundSectionDefinition` describes a region containing several cooperating ground features.

### 7.1 Section composition

Each section definition owns:

- a unique section ID;
- an authored world transform;
- one outer boundary;
- zero or more holes or voids;
- two or more elevation bands;
- transition features between bands;
- surface assignments per band or polygon region;
- connector portals;
- route-guide splines for decorative composition only;
- a camera definition;
- a simple camera coverage volume;
- landmark reservation zones;
- atmosphere reservation zones;
- quiet/open-space reservations;
- validation targets and performance budgets.

The outer boundary does not need to resemble the camera volume. Walkability, visible silhouette, and camera selection are separate concerns.

### 7.2 Elevation bands

An elevation band is an authored polygon region with:

- a target elevation;
- top-surface theme;
- boundary treatment;
- optional holes;
- explicit transitions to neighboring bands;
- a simplified traversal surface source;
- a role such as basin, plaza, shelf, ridge, courtyard, overlook, or apron.

Bands may overlap in plan only where an intentional transition resolves the ownership. The generated top surfaces must not be coincident.

### 7.3 Negative space

Negative space is authored, not accidental. Supported forms include:

- courtyard void;
- stream or ravine channel;
- pond or wetland cutout;
- cliff notch;
- sheltered lower court;
- narrow pass;
- visual-only inaccessible pocket;
- reserved landmark footprint.

A hole must declare whether it is:

- non-walkable open void;
- lower walkable band;
- water/background feature;
- reserved future landmark footprint.

## 8. Initial Grounding Approval Slice

The first replacement remains a three-section slice so comparison and review stay bounded. Unlike the rejected experiment, the sections must not share one shape grammar.

### 8.1 Section A — Asymmetric Arrival Valley

**Purpose:** spacious far-left entry and orientation ground.  
**Target footprint:** approximately 34 × 22 world units.  
**Surface family:** warm packed earth, muted meadow edges, exposed stone—not a grass disc.  
**Elevation range:** at least 2.4 world units across three bands.

Composition:

- broad low arrival plaza near the far-left edge;
- long asymmetric valley body with one concave side;
- a rising side shelf that curves around the plaza;
- a rear overlook large enough for a future secondary structure;
- one open branch returning toward the main plaza;
- one broad land-neck departure toward Section B;
- no road across the exact center;
- reserved hero zone of at least 10 × 8 units;
- reserved quiet/help zone of at least 6 × 5 units.

### 8.2 Section B — Split-Level Archive Court

**Purpose:** demonstrate an architectural ground language before any building is placed.  
**Target footprint:** approximately 36 × 30 world units.  
**Surface family:** cool courtyard stone, worn earth, planted edge strips, retaining masonry.  
**Elevation range:** at least 3.2 world units across four bands.

Composition:

- irregular L-shaped or hooked outer silhouette;
- a meaningful courtyard void or lower court, not a small disc on a larger disc;
- broad lower apron receiving the land neck;
- retaining-wall terrace wrapping only part of the court;
- authored stair with top and bottom landings;
- alternate sloped return route forming a local loop;
- upper overlook with room for a future Archive Hall hero asset;
- side departure portal aligned with a ravine threshold rather than the central axis;
- reserved hero zone of at least 12 × 9 units.

### 8.3 Section C — Winding Ravine and Hooked Ridge

**Purpose:** prove depth, traversal around terrain, and a non-grass theme.  
**Target footprint:** approximately 42 × 32 world units.  
**Surface family:** cool slate, forest floor, damp ravine bed, restrained moss.  
**Elevation range:** at least 4.0 world units across four or five bands.

Composition:

- hooked ridge silhouette rather than an oval;
- a lower ravine or stream bed cutting through part of the section;
- one structural bridge crossing;
- one longer switchback or curved ascent;
- one upper route that travels behind or around a ridge shoulder;
- a broad summit/overlook with hero-asset capacity;
- a lower optional branch that reconnects after the crossing;
- no concentric shelves;
- no straight route from entry to exit.

### 8.4 Network topology

The initial network uses:

- one main right/up-right spine;
- one local loop in Section B;
- one optional lower branch in Section C;
- one broad mainland neck between Sections A and B;
- one retained stair/ramp transition inside Section B;
- one bridge or causeway crossing between Sections B and C;
- explicit portals and approach aprons at every section boundary.

The world remains one connected mainland/campus. A ravine or stream may create a local crossing, but the result must not read as floating islands.

## 9. Future Section Archetype Library

After the initial three-section slice is approved, additional sections may use these original archetypes:

1. **Ochre maker ground** — boardwalk loop, compact work yards, sunken activity court, warm mineral soil.
2. **Observation ridge** — long switchback ascent, narrow overlooks, broad summit, cool exposed rock.
3. **Reflection wetland garden** — pond cutouts, connected dry ground, garden bridges, sheltered lower basin.
4. **Story grove hollow** — broad canopy reservation, curved stage court, root-like edge geometry, forest floor.
5. **Mentor garden terrace** — quiet branching gardens, private edge pockets, accessible gentle slopes.
6. **Challenge threshold** — gate terrain, multiple approach choices, recovery side route, no punitive visual language.

No archetype is a reskinned copy. Each must differ in at least:

- normalized outer silhouette;
- aspect ratio;
- elevation-band graph;
- negative-space type;
- dominant surface family;
- traversal rhythm;
- connector grammar.

## 10. Authoring Data Model

### 10.1 ScriptableObject assets

Use ScriptableObjects for authoring-time data only.

#### `WorldGroundingDefinition`

Owns:

- world ID and schema version;
- ordered section references;
- connector definitions;
- global material/theme references;
- initial spawn portal;
- terminal continuation portal;
- global validation and WebGL budget profile.

#### `GroundSectionDefinition`

Owns:

- section ID and authored transform;
- outer boundary and holes;
- elevation bands;
- internal transitions;
- surface-theme references;
- portals;
- route-guide splines;
- camera definition;
- reserved zones;
- per-section budget overrides.

Separate section assets are preferred over one deeply nested asset because they improve review, reuse, merge behavior, and Inspector clarity.

#### `GroundThemeProfile`

Owns shared authoring values:

- top material family;
- cliff/retaining material family;
- edge-rim treatment;
- contact-shadow treatment;
- optional accent material;
- mesh-density targets;
- color/value constraints;
- allowed transition profiles.

It does not contain runtime progression state.

### 10.2 Serializable value types

Use serializable value types for:

- `GroundPolygonDefinition`;
- `GroundElevationBand`;
- `GroundTransitionDefinition`;
- `GroundPortal`;
- `GroundConnectorDefinition`;
- `GroundCameraDefinition`;
- `GroundReservedZone`;
- `GroundRouteGuide`;
- `GroundingBudgetProfile`.

Avoid polymorphic `SerializeReference` data in the first version. Prefer enums plus explicit fields until connector or transition behaviors genuinely require polymorphism.

### 10.3 Runtime state boundary

Definitions must never contain:

- learner IDs;
- progress;
- mastery;
- selected content;
- recommended content;
- scores;
- teacher insights;
- resume state.

Runtime availability may toggle existing connector state visuals, but the backend/React contract remains authoritative.

## 11. Script Roles and Responsibilities

Do not make every class a `MonoBehaviour`.

| Script | Role | Responsibility |
|---|---|---|
| `WorldGroundingDefinition` | ScriptableObject config | World-level authored topology references and budgets |
| `GroundSectionDefinition` | ScriptableObject config | One section’s authored polygons, bands, portals, camera, and reservations |
| `GroundThemeProfile` | ScriptableObject config | Shared surface and boundary style values |
| `GroundPolygon` | Pure C# value/domain type | Validated polygon operations independent of Unity objects |
| `GroundPolygonTriangulator` | Pure C# service | Deterministic concave polygon and hole triangulation |
| `GroundBoundaryGenerator` | Pure C# service | Cliff, retaining-wall, rim, and contact-shadow mesh data |
| `GroundTransitionGenerator` | Pure C# service | Stairs, ramps, switchbacks, landings, and aprons |
| `GroundConnectorGenerator` | Pure C# service | Connector geometry from explicit portals |
| `GroundTraversalGenerator` | Pure C# service | Simplified invisible traversal mesh/collider data |
| `GroundingValidationService` | Pure C# service | Geometry, topology, capacity, variety, and budget reports |
| `GroundingWorldAssembler` | Editor service | Creates GameObjects, saves meshes/prefabs, assigns runtime contracts |
| `GroundingSceneHandles` | Editor tool | Safe manipulation of vertices, portals, routes, and reserved zones |
| `GroundingReviewSceneBuilder` | Editor service | Creates deterministic review scenes and debug modes |
| `GroundingCaptureService` | Editor service | Captures overview, sections, connectors, silhouette, height, and traversal evidence |
| Existing runtime contracts | MonoBehaviour bridges | Runtime traversal, cameras, browser integration, and connector state |

The current `HighFidelityGroundingWorldBuilder` should not absorb these roles.

## 12. Geometry Pipeline

### 12.1 Pipeline stages

1. Load and validate authored definitions.
2. Normalize polygon winding and reject self-intersections.
3. Resolve holes and elevation-band adjacency.
4. Triangulate top surfaces deterministically.
5. Generate one authoritative boundary surface for each exposed edge.
6. Generate retaining walls where neighboring bands create intentional vertical boundaries.
7. Generate explicit transitions with landings and approach aprons.
8. Generate visible route-guide ribbons only where authored.
9. Generate simplified invisible traversal surfaces independently.
10. Generate connector geometry from paired portals.
11. Assemble runtime contract hierarchy.
12. Save deterministic mesh assets and prefab.
13. Generate review scene and validation report.

### 12.2 Polygon requirements

The first production triangulator must support:

- convex and concave simple polygons;
- stable clockwise/counter-clockwise normalization;
- one or more holes;
- duplicate-point cleanup;
- minimum edge length;
- collinear-point simplification;
- deterministic output order;
- actionable validation errors.

A center-fan triangulation is forbidden for production section tops because it assumes star-shaped geometry and does not support the required concavity and holes.

### 12.3 Boundary ownership

Each exposed edge has exactly one visible boundary owner:

- cliff skirt;
- retaining wall;
- slope transition;
- connector apron;
- water/void contact edge;
- hidden internal adjacency.

Do not render both legacy plateau sides and explicit cliff skirts. Coincident boundary surfaces are a blocking failure.

### 12.4 Stairs and ramps

A transition is not a loose primitive placed on a platform. It must include:

- source landing;
- destination landing;
- clear width;
- side/retaining treatment where exposed;
- top-surface continuity;
- traversal surface;
- maximum rise compatible with `WorldTraversalSurface` projection;
- camera readability;
- contact shadows and no floating edges.

Switchbacks are composed from multiple transition segments and landings, not one steep diagonal slab.

### 12.5 Generated asset policy

Editor generation writes stable assets under a dedicated generated-grounding folder. Generated names include world ID, section ID, feature role, and schema/generator version where needed.

Generation must be idempotent:

- same definitions and generator version produce equivalent hierarchy and geometry;
- obsolete generated assets are reported, not silently accumulated;
- author-authored source assets are never overwritten;
- all generated meshes use readable names and deterministic ordering.

## 13. Traversal and Elevation

### 13.1 Preserved contract

`WorldTraversalSurface` remains the runtime projection authority. Its movement root remains invisible and contains non-trigger colliders with no renderers.

### 13.2 Collider strategy

Use simplified baked colliders:

- low-density static `MeshCollider` for irregular broad bands where necessary;
- compound primitive colliders for simple plazas, landings, and steps;
- explicit connector walk surfaces;
- no collider derived blindly from every visible detail;
- no Rigidbody on static terrain.

Collider topology must be simpler than visible geometry and profiled on WebGL.

### 13.3 Continuity rules

For every connected portal pair:

- visible surfaces meet an authored apron or intentional gap/crossing;
- traversal surfaces overlap or meet within tolerance;
- rise/drop stays within configured projection limits per movement sample;
- no invisible wall blocks the apparent open route;
- no traversal collider allows walking through a visible cliff or void;
- route continuity is sampled in both directions.

### 13.4 Roads remain visual

Visible roads, stones, soil wear, or boardwalk markings may guide attention, but they never define the only walkable corridor. Open plazas, courtyards, plateaus, and safe ground remain area-walkable through separate colliders.

## 14. Connector Grammar

### 14.1 Portal model

Every connector begins with two explicit portals. A portal owns:

- section ID;
- local position;
- forward direction;
- clear width;
- surface elevation;
- approach depth;
- lock/state capability;
- preferred camera-boundary side.

Validation rejects portals that face away from each other beyond tolerance, overlap reserved hero zones, or lack sufficient approach space.

### 14.2 Connector families

Supported authored families:

1. broad land neck;
2. stone stair or retained causeway;
3. timber bridge;
4. stone arch crossing;
5. curved garden bridge;
6. boardwalk;
7. retained ramp;
8. stepping crossing;
9. gate or tunnel threshold.

A connector family defines geometry grammar, not world progression. Only connectors that need open/locked visual states use the existing `BridgeVisual` contract.

### 14.3 Approach aprons

Every connector includes start and end aprons integrated into section geometry. A bridge placed between unrelated platform edges without approaches is rejected.

### 14.4 Camera boundaries

Section transitions occur at authored boundary thresholds near connector centers, after Yubi has clearly left one composition and entered the next. The transition must not fire repeatedly while Yubi moves on a landing or apron.

## 15. Static Section Camera Contract

The production camera model is:

- exactly one authored camera anchor per section;
- exactly one authored orthographic size per section;
- camera position remains fixed while Yubi moves within the section;
- smooth interpolation occurs only when the active section changes;
- reduced motion may snap between authored views;
- avatar projection continues throughout transitions.

Camera definition is authored after terrain composition, not copied as one global offset.

Each camera view must show:

- the complete walkable section or its intentionally framed navigable composition;
- arrival and departure thresholds;
- reserved hero landmark zone;
- major elevation relationships;
- enough screen margin for the React/Three.js avatar overlay;
- no required route hidden behind future foreground reservations.

The camera coverage volume remains independent from irregular walkability. For the first implementation, use carefully authored non-ambiguous box coverage volumes to preserve the existing `WorldSectionView` contract. Do not expand the runtime contract until a real section proves one box cannot provide stable selection.

## 16. Theme and Material Profiles

The first three sections must use visibly different dominant surface families.

### Arrival profile

- packed warm earth;
- muted meadow edge accents;
- pale exposed stone;
- restrained green coverage below 45% of visible top area.

### Archive profile

- cool irregular courtyard stone;
- worn earth repairs;
- planted edge strips;
- masonry retaining walls;
- green coverage below 25%.

### Ravine profile

- slate and dark exposed rock;
- forest-floor pockets;
- damp lower bed;
- moss only as an accent;
- green coverage below 35%.

Shared materials are preferred over unique material instances. Variation comes from vertex color, mesh grouping, limited texture atlases, and authored accents—not one new material per polygon.

## 17. Reserved Capacity Before Dressing

Ground approval must prove that later art can fit without rebuilding topology.

Every section includes debug-visible reservation zones for:

- one hero landmark;
- at least one secondary activity/structure zone;
- one quiet/help/rest zone;
- connector clearance;
- primary open movement area;
- future vegetation clusters;
- future foreground framing;
- atmosphere/background root.

Reservation zones are metadata/debug geometry only. They have no learner-facing renderer in production.

Validation checks:

- minimum area and dimensions;
- overlap with cliffs, holes, and connectors;
- camera visibility;
- movement clearance around the hero footprint;
- route alternatives after the hero asset is hypothetically occupied.

## 18. Editor Authoring UX

### 18.1 Inspector strategy

Use private serialized fields with clear groupings:

- Identity;
- Placement;
- Outer Boundary;
- Elevation Bands;
- Transitions;
- Portals and Connectors;
- Camera;
- Reservations;
- Theme;
- Budgets and Validation.

Use tooltips only where units or constraints are not obvious. Apply `Min`, `Range`, and lightweight `OnValidate` normalization for safe values. Do not bury source polygons in one unstructured list.

### 18.2 Scene handles

Provide scene handles for:

- polygon vertices;
- hole vertices;
- portal position, width, and forward direction;
- route-guide control points;
- camera anchor preview;
- coverage volume;
- reservation rectangles/polygons;
- elevation-band preview.

Handles must support undo and display section-local coordinates. Invalid edges, self-intersections, and portal misalignment should be visible before building.

### 18.3 Debug views

The review scene supports toggles for:

- final theme materials;
- grayscale silhouette;
- elevation bands by debug color;
- traversal colliders;
- connector portals and aprons;
- camera coverage volumes;
- reservation zones;
- boundary ownership.

Debug colors are evidence tools, not proposed art direction.

## 19. Validation Strategy

Technical tests prove contracts and measurable composition constraints. Human review proves visual quality.

### 19.1 Definition validation

Reject definitions with:

- duplicate section IDs;
- fewer than three meaningful outer-boundary turns;
- self-intersecting polygons;
- invalid hole containment;
- duplicate or near-zero edges;
- overlapping elevation bands without an explicit transition rule;
- unpaired portals;
- missing camera definitions;
- missing hero reservation;
- unsupported material/theme references.

### 19.2 Variety validation

The representative world must demonstrate:

- at least three dominant surface families;
- distinct section aspect ratios;
- distinct elevation-band graphs;
- distinct negative-space patterns;
- at least three connector/transition categories across inter-section and internal movement;
- at least one loop or branch beyond the main spine;
- no requirement that a section be circular, radial, convex, or centered on a road.

Add a normalized outline-signature report to flag suspiciously similar silhouettes. It is a warning for review, not an aesthetic pass/fail oracle.

### 19.3 Capacity validation

For the initial slice:

- Arrival footprint target: at least 34 × 22 units;
- Archive footprint target: at least 36 × 30 units;
- Ravine footprint target: at least 42 × 32 units;
- each section has a hero reservation meeting its stated minimum;
- each hero reservation has a walkable perimeter or approach clearance;
- each section retains a meaningful open movement area after reservations are applied.

Exact thresholds may be adjusted once the first authored blockout is viewed through its final static camera, but reductions require an explicit review note.

### 19.4 Geometry validation

Automated checks include:

- no degenerate triangles;
- no NaN or infinite vertices;
- valid normals and bounds;
- no duplicate coincident boundary owner for an edge;
- top-surface winding faces upward;
- no generated visible mesh under `MovementZonesRoot`;
- no trigger under traversal surfaces;
- no visible Unity Yubi;
- no landmarks, vegetation, props, or atmosphere during grounding approval.

### 19.5 Traversal validation

Sample movement paths through:

- initial spawn to Section A departure;
- A-to-B land neck in both directions;
- B lower apron to upper overlook via stairs;
- B upper overlook to lower apron via alternate slope;
- B-to-C crossing in both directions;
- C lower branch and return;
- C ascent to summit.

Tests assert continuity, allowed rise/drop, and no projection into voids.

### 19.6 Camera validation

Assert:

- exactly one `WorldSectionView` per authored section;
- unique IDs;
- valid invisible trigger coverage;
- camera remains fixed for movement inside a section;
- one transition occurs when crossing a threshold;
- no camera ping-pong on aprons;
- reduced motion snaps;
- all reserved hero zones and required portals are inside the authored frame.

## 20. Visual Review Evidence

No grounding becomes approved from tests alone.

Generate:

1. one connected overview;
2. one authored static-camera capture per section;
3. one close-up per connector and major internal transition;
4. one grayscale silhouette capture per section;
5. one elevation-band debug capture per section;
6. one traversal-overlay debug capture per section;
7. one reservation-capacity capture per section;
8. one camera-boundary transition recording after the grounding slice is visually accepted.

Captures must use a real graphics device. Blank or corrupted captures are blocking failures.

### 20.1 Strict rejection criteria

Reject a candidate if it contains any of these patterns:

- repeated circular or oval section silhouettes;
- concentric pancake shelves;
- a straight road through every section;
- a uniform grass treatment;
- sections too small for declared reservations;
- generic ramps without landings or retaining structure;
- floating or disconnected terrain;
- connector geometry without integrated approaches;
- terrain depth visible only from the overview but unreadable from the section camera;
- camera framing that hides a required route or future hero zone;
- duplicate cliff surfaces, z-fighting, hollow tops, or tile seams.

## 21. Initial WebGL Budgets

These are starting guardrails, not claims of measured final capacity.

### Three-section grounding-only slice

- visible terrain and connectors: target ≤ 60,000 triangles total;
- simplified traversal colliders: target ≤ 24,000 triangles total;
- shared ground material slots: target ≤ 8;
- transparent materials: water/debug only, excluded from approval art where not required;
- no runtime mesh generation;
- no per-frame terrain updates;
- no `Find` or reflection in movement/camera hot paths;
- static batching or mesh grouping evaluated after visual approval;
- generated mesh memory and draw calls recorded in the validation report.

### Scaled world

Do not extrapolate blindly from the three-section slice. Before adding sections four through eight, profile:

- loaded mesh memory;
- draw calls and batches from each static camera;
- collider raycast cost;
- WebGL build size;
- frame time on the agreed low-power device profile.

Introduce LOD, camera-local activation, or mesh combining only in response to measured bottlenecks.

## 22. File and Module Plan

### Runtime authoring data

- `Assets/Scripts/World/Grounding/Definitions/WorldGroundingDefinition.cs`
- `Assets/Scripts/World/Grounding/Definitions/GroundSectionDefinition.cs`
- `Assets/Scripts/World/Grounding/Definitions/GroundThemeProfile.cs`
- `Assets/Scripts/World/Grounding/Definitions/GroundingValueTypes.cs`

These contain authoring data and pure serializable types. They do not generate runtime state.

### Pure geometry and validation

- `Assets/Scripts/World/Grounding/Geometry/GroundPolygon.cs`
- `Assets/Scripts/World/Grounding/Geometry/GroundPolygonTriangulator.cs`
- `Assets/Scripts/World/Grounding/Geometry/GroundBoundaryGenerator.cs`
- `Assets/Scripts/World/Grounding/Geometry/GroundTransitionGenerator.cs`
- `Assets/Scripts/World/Grounding/Geometry/GroundConnectorGenerator.cs`
- `Assets/Scripts/World/Grounding/Geometry/GroundTraversalGenerator.cs`
- `Assets/Scripts/World/Grounding/Validation/GroundingValidationService.cs`
- `Assets/Scripts/World/Grounding/Validation/GroundingValidationReport.cs`

### Editor assembly and review

- `Assets/Scripts/World/Editor/Grounding/GroundingWorldAssembler.cs`
- `Assets/Scripts/World/Editor/Grounding/GroundingAssetWriter.cs`
- `Assets/Scripts/World/Editor/Grounding/GroundingSceneHandles.cs`
- `Assets/Scripts/World/Editor/Grounding/GroundingReviewSceneBuilder.cs`
- `Assets/Scripts/World/Editor/Grounding/GroundingCaptureService.cs`
- `Assets/Scripts/World/Editor/Grounding/GroundingBuildMenu.cs`

### Authored data and generated output

- `Assets/Data/World/Grounding/Worlds/`
- `Assets/Data/World/Grounding/Sections/`
- `Assets/Data/World/Grounding/Themes/`
- `Assets/Art/World/HighFidelity/Generated/Grounding/`
- `Assets/Prefabs/World/Grounding/`
- `Assets/Scenes/ArtReview/Grounding/`

Keep the current assembly definitions until compilation boundaries provide a measured benefit. Do not add an assembly solely because the subsystem may eventually grow.

## 23. Migration Plan

### Phase 0 — Record and freeze the rejected experiment

- mark current grounding as technically passing but visually rejected;
- keep current prefab, scene, captures, and tests as temporary regression evidence;
- stop calling methods or menu items “approval” in new work;
- do not add features to the rejected builder.

**Exit gate:** this document is accepted as the implementation basis.

### Phase 1 — Definitions and pure validation

- add ScriptableObject definitions and serializable value types;
- add polygon normalization/intersection validation;
- add topology, portal, reservation, and budget validation;
- create definitions for the three initial sections without generating production art.

**Evidence:** Inspector/scene-handle screenshots and validation report.  
**Exit gate:** topology definitions are understandable and invalid inputs fail clearly.

### Phase 2 — Macro topology blockout

- generate only broad elevation bands, boundaries, portals, and camera views;
- use simple debug/theme materials;
- generate overview, silhouette, height, reservation, and traversal captures;
- review the entire three-section network before local detail.

**Exit gate:** product owner approves scale, silhouettes, depth, branch/loop flow, and static camera framing. No detailed terrain work proceeds without this approval.

### Phase 3 — Section A grounding

- build Arrival Valley top surfaces, boundaries, transitions, and traversal;
- review from its authored camera and connector close-ups;
- perform bounded corrections.

**Exit gate:** Section A visual and traversal approval.

### Phase 4 — Section B grounding

- build Archive Court bands, lower court/void, retained stairs, alternate return route, and traversal;
- integrate A-to-B land neck and camera threshold;
- perform bounded corrections.

**Exit gate:** Section B and A-to-B transition approval.

### Phase 5 — Section C grounding

- build Ravine/Ridge bands, lower branch, switchback, crossing, summit, and traversal;
- integrate B-to-C connector and camera threshold;
- perform bounded corrections.

**Exit gate:** Section C and B-to-C transition approval.

### Phase 6 — Grounding system promotion

- replace grounding experiment tests with production-definition tests;
- run full EditMode regression suite;
- capture final grounding evidence set;
- obtain explicit visual approval;
- only then delete the rejected builder, prefab, review scene, captures, and experiment-specific tests.

**Exit gate:** grounding production gate passes technically and visually.

### Phase 7 — Dressing resumes

Only after grounding approval:

- place one hero asset/family at a time;
- add atmosphere and vegetation by section;
- preserve reservation and traversal clearances;
- validate static section composition after every major asset family.

WebGL and React builds remain deferred until the explicit integration/final build gate.

## 24. Test Migration

The current tests named `GroundingApprovalWorld_*` prove only the rejected experiment’s contract. During migration:

1. rename their conceptual status to experiment/regression without breaking existing code prematurely;
2. add pure tests for polygon, holes, triangulation, boundary ownership, portals, and transitions;
3. add authored-definition tests for variety and capacity;
4. add prefab integration tests against the new production path;
5. preserve all stable browser, Three.js avatar, traversal, and static-camera tests;
6. delete legacy experiment tests only when the new production prefab has explicit visual approval.

New representative test groups:

- `GroundPolygonTests`;
- `GroundTriangulationTests`;
- `GroundBoundaryOwnershipTests`;
- `GroundPortalAlignmentTests`;
- `GroundTransitionTraversalTests`;
- `GroundSectionDefinitionValidationTests`;
- `GroundingWorldVarietyTests`;
- `GroundingReservationCapacityTests`;
- `GroundingProductionPrefabTests`;
- `GroundingSectionCameraIntegrationTests`.

## 25. Preserved Contracts

The redesign must not break:

- `LearningWorldController.Configure(string)`;
- `LearningWorldController.SetSelected(string)`;
- `LearningWorldController.Focus(string)`;
- `LearningWorldController.TravelTo(string)`;
- `LearningWorldController.ShowBlocked(string)`;
- `LearningWorldController.ResetCamera(string)`;
- `LearningWorldController.SetPaused(string)`;
- existing browser event names and meanings;
- renderer-free Unity player proxy;
- `WorldBrowserEvents.AvatarProjection` data consumed by React;
- `TerrainVisual` hierarchy contract;
- `WorldTraversalSurface` projection contract;
- `WorldSectionView` static authored view contract;
- `WorldSectionCameraController` transition behavior;
- `BridgeVisual` state contract where a lockable structural crossing needs it;
- backend/Brain ownership of all learner and progression truth.

## 26. Definition of Done

The grounding redesign is done only when:

- the current three-disc experiment is no longer the production path;
- all three replacement sections are visibly distinct in topology and surface family;
- each section meets approved scale and reservation capacity;
- movement includes local branches/loops and meaningful elevation change;
- every section and connector is continuously traversable in both directions where intended;
- movement colliders remain invisible and independent from roads;
- one static whole-section camera view is authored and stable for each section;
- Three.js remains the only visible Yubi;
- no landmarks, props, vegetation, or atmosphere were used to disguise weak grounding during approval;
- geometry has no duplicate boundary surfaces, z-fighting, hollow tops, or tile seams;
- automated validation and the complete EditMode suite pass;
- the full capture evidence set is nonblank and reviewed;
- the product owner explicitly approves the grounding visuals;
- WebGL/React builds remain untouched until the later integration gate.
