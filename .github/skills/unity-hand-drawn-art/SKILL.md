---
name: unity-hand-drawn-art
description: "Use when designing or implementing the Yuvilab Unity learning world, characters, props, landmarks, effects, animation, shaders, or visual assets in an original 1930s hand-inked rubber-hose cartoon direction. Converts requests for objects that look drawn into a safe, production-ready 2D/2.5D Unity workflow."
argument-hint: "Describe the Unity scene, character, prop, landmark, effect, or animation to create."
---
# Unity Hand-Drawn Art Direction

Use this skill for the Unity learning world whenever the requested result should feel illustrated rather than made from clean 3D primitives.

## Creative Target

Build an **original 1930s theatrical-cartoon visual language**:
- Variable-width black ink contours with small, deliberate imperfections.
- Watercolor/gouache fills, restrained paper grain, and slightly uneven color registration.
- Rounded rubber-hose curves, readable silhouettes, expressive poses, squash and stretch.
- Painted multi-plane backgrounds with subtle parallax and a stage-like composition.
- Warm off-white highlights, muted pigments, and deep ink shadows rather than glossy realism.
- Props and landmarks should look like drawings placed in a living illustrated world.

Do not copy named characters, bosses, levels, logos, music, UI, or proprietary assets from an existing game. Use references only to identify broad visual properties and produce original designs.

## Default Unity Representation

Choose the cheapest representation that preserves the drawing:
1. **Sprite-first 2D** for characters, props, effects, and interactive landmarks.
2. **2.5D paper-theater cards** for an explorable world: transparent illustrated sprites on quads, shallow depth, orthographic camera, painted parallax layers.
3. **Simple 3D collision/proxy geometry** behind the artwork when movement or hit testing needs volume.
4. Use full 3D meshes only when rotation or depth materially improves gameplay. Final visible surfaces must still carry illustrated textures and inked edges.

Primitive cubes, capsules, cylinders, and spheres are blockout tools, not final learner-facing art.

## Asset Prompt Pattern

When generating an original prop or landmark image, prefer this structure:

> Original hand-inked 1930s theatrical cartoon [object], strong readable silhouette, variable black contour, watercolor and gouache fill, subtle paper grain, slightly imperfect registration, front three-quarter view, isolated on transparent background, no text, no logo, no existing character.

Add the object function, emotional tone, palette, and required interaction states. Request separate transparent layers or sprite-sheet frames when animation is needed.

## Production Workflow

1. Inspect the current scene, render pipeline, camera, sorting, import settings, and WebGL budget before changing assets.
2. Define the asset's gameplay role and states: idle, hover/focus, available, locked, completed, reaction, or transition.
3. Produce one representative test asset and render it in the actual scene.
4. Obtain visual approval before applying the treatment to multiple assets or landmarks.
5. Import art as sprites with consistent pixels-per-unit, pivots, naming, alpha handling, and sprite-atlas grouping.
6. Keep collision and progression logic separate from the visible drawing.
7. Validate at computer and tablet resolutions, with mouse and touch.
8. Capture a review screenshot and report scene hierarchy, materials, texture sizes, draw calls, and visible states.

## Animation Rules

- Prefer hand-authored key poses with held frames; use 12 fps timing presented on a 24/60 fps runtime where appropriate.
- Use stepped or intentionally eased timing rather than uniformly smooth interpolation.
- Add restrained line boil or texture drift; it must not impair readability or cause motion discomfort.
- Use squash, stretch, anticipation, overshoot, and recovery while preserving the silhouette.
- Smear frames are separate authored frames, never generic motion blur.
- Keep idle loops short and quiet. Respect reduced-motion mode by disabling boil, parallax drift, camera shake, and nonessential looping.

## Materials and Rendering

- Prefer transparent sprite or unlit/cutout materials that preserve authored colors.
- Avoid plastic PBR highlights, metallic surfaces, perfect gradients, and heavy bloom.
- Paper grain should be subtle and screen-stable; do not create distracting high-frequency shimmer.
- Use ink outlines authored in the sprite where possible. Shader outlines are acceptable only when they remain stable at WebGL resolutions.
- For 2.5D cards, prevent z-fighting and control ordering with explicit sorting layers/groups or disciplined shallow depth.
- Keep alpha overdraw bounded; crop transparent sprite rectangles and atlas related assets.

## 720 Product Boundaries

- Unity renders the world; React/FastAPI and Brain/xAPI state remain authoritative for curriculum order, progress, mastery, and unlocks.
- Never encode learner progression into artwork, Animator state, or scene-only flags.
- Do not send learner PII into Unity or any asset-generation prompt.
- Use non-identifying IDs for interactive objects and preserve the existing React-to-Unity contract.
- Learner-facing states must remain understandable without color alone.
- Keep text in the localized React layer unless a Unity text surface is explicitly required and supports Hebrew, Arabic, English, RTL/LTR, and fallback fonts.

## WebGL Guardrails

- Atlas related sprites and reuse materials.
- Use power-of-two texture limits appropriate to on-screen size; do not default every asset to 4K.
- Prefer a small number of large painted background layers over many overlapping transparent particles.
- Pool repeated effects and avoid per-frame material allocation.
- Test load time, memory, overdraw, and frame rate in the React-hosted WebGL build, not only in the Editor.

## Acceptance Checklist

- The object reads as an intentional drawing at gameplay scale.
- Silhouette and interaction state are immediately understandable.
- No copied proprietary character, level, logo, or asset is present.
- The visible art is not raw primitive geometry.
- Reduced-motion behavior is safe.
- Progression remains backend-derived.
- A scene screenshot and WebGL validation are available for review.
