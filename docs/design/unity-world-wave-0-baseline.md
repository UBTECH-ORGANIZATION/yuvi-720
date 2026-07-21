
> **Historical evidence only:** The Atlas terrain experiment documented below was explicitly rejected and its source scene, scripts, shader, and render tooling were removed. Nothing in this baseline is approved for reuse in the replacement art direction.
# Unity Learning World — Wave 0 Baseline

**Captured:** 2026-07-15  
**Plan:** `unity-hand-drawn-world-production-plan.md`  
**Approval gate:** Wave 0A — baseline before art-system expansion  
**Unity:** `6000.0.79f1`  
**Renderer:** Built-in Render Pipeline, WebGL/OpenGL ES 3

## Scope

This baseline records the current production WebGL world and the existing `AtlasIslandReview` terrain experiment before new asset folders, catalogs, prefabs, grayscale compositions, or learner-facing art are added.

It does not approve the existing primitive production art or the Atlas terrain direction. It exists so later visual changes can be compared against measured starting evidence.

## Evidence

- React-hosted WebGL screenshot: `artifacts/companion-visuals/unity-webgl-baseline.png`
- Screenshot dimensions: `948 × 1032`
- Screenshot size: `321,400` bytes
- Active Editor review scene: `Assets/ArtReview/AtlasIslandReview.unity`
- Production route: `/learning`

## WebGL build footprint

| Artifact | Bytes |
|---|---:|
| `unity-world.data` | 11,837,685 |
| `unity-world.framework.js` | 370,222 |
| `unity-world.loader.js` | 26,454 |
| `unity-world.wasm` | 14,997,471 |
| **Total** | **27,231,832** |

The current uncompressed build is approximately `25.97 MiB`. This is the whole starting build, not art-only growth.

## React-hosted runtime

Measured in the VS Code integrated Chromium browser against `http://127.0.0.1:8720/learning`.

| Metric | Baseline |
|---|---:|
| `runtime-ready` after warm reload | 1,760 ms |
| `ready` after warm reload | 1,875 ms |
| first `stats` event | 2,768 ms |
| warmed FPS, 8 one-second samples | 60 average / 60 minimum |
| WebGL compatibility warnings per reload | 6 |

All six warnings were `WebGL: INVALID_ENUM: getInternalformatParameter: invalid internalformat` and reproduce before the next art package. They remain a baseline compatibility investigation rather than evidence against future assets.

The warm reload used browser caches. Localhost transfer durations are not a substitute for the required school-network cold-load gate.

## Runtime diagnostics limitation

The current browser `stats` event reports `drawCalls: 0` and `triangles: 0` while the rendered world visibly contains geometry. These two browser counters are invalid and must not be used as acceptance evidence until the Unity 6 diagnostics path is corrected.

FPS, world position, and zoom values are being emitted. Draw-call and triangle acceptance remains pending a trustworthy runtime counter or WebGL profiler capture.

## Active Editor terrain review

The existing `AtlasIslandReview` experiment was measured independently from the primitive production WebGL world.

| Metric | Baseline |
|---|---:|
| Scene objects | 21 active objects, 4 roots |
| Hierarchy depth | 2 |
| Cameras / lights | 1 / 2 |
| Mesh renderers | 16 |
| Triangles | 1,608 |
| Material slots | 16 |
| Unique scene materials | 14 |
| Scene shaders | 2 (`Standard`, `Yuvi/AtlasTransparent`) |
| Transparent renderers | 7 |
| Prefab instances | 0 |
| Compilation | 0 errors, 0 warnings |

The project-owned generated terrain textures visible in the memory report total approximately `10.67 MiB` uncompressed in the Editor:

- two `512 × 512` RGBA textures at approximately `2.67 MiB` each;
- eight `256 × 256` RGBA textures at approximately `0.67 MiB` each.

The Editor-wide texture total (`138.72 MiB`) includes Editor UI, fonts, gizmos, render targets, and other non-build resources, so it is not a valid resident WebGL texture-memory value.

## Baseline findings

1. The production frame still reads as generated primitive geometry and requires the planned sprite-first illustrated replacement.
2. The Atlas terrain experiment is technically small in geometry but creates runtime materials and readable/mipmapped textures; it is not yet an authored asset/prefab pipeline.
3. The current WebGL artifact is already above the vertical slice's `18 MiB` art-growth threshold as a total build. Future review must compare build deltas, not compare the whole build to the growth allowance.
4. Build compression is disabled, making transferred artifact size directly measurable but currently expensive.
5. Browser draw-call and triangle telemetry is broken and must be repaired before the final Wave 0 technical-budget approval.
6. The review scene has no `AudioListener`. This is acceptable for a silent visual review scene but should remain explicit rather than becoming a production-scene pattern.

## Gate decision requested

Approve this as the immutable **Wave 0A baseline** before proceeding to **Wave 0B: asset folder/catalog/prefab skeleton and contract tests**.

Wave 0B will not yet mass-produce assets or replace the learner-facing world. It will create the reusable structure needed for one grayscale vertical-slice composition and preserve the existing React-to-Unity façade.