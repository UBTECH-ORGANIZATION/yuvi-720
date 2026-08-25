---
name: fluid-motion
description: Interaction and motion design for the teacher/student portals — Apple fluid-interface principles adapted to our RTL-first, CSS-first, school-hardware reality. Use when designing or reviewing anything that moves, presses, drags, or scrolls.
---

# Fluid motion for yuvi-720

Adapted from Emil Kowalski's apple-design skill (Apple WWDC "Designing Fluid
Interfaces" / "Details of UI Typography" material), rewritten for this project.
The original assumes LTR English, a spring library, and desktop-class GPUs. We
have Hebrew/Arabic RTL, a deliberately CSS-first stack, and cheap school
laptops. Where those conflict, THIS file wins.

## The core idea

An interface feels alive when motion starts from the current on-screen value,
inherits the user's velocity, and can be grabbed or reversed at any instant.
It feels dead when input is locked during a transition, when feedback waits
for release, or when an animation snaps from a value that was never on screen.

## Response — feedback on pointerdown, never on release

- Press states fire on `pointerdown` (`:active` in CSS is fine), commit on
  `pointerup`. A button that only reacts on click-up feels laggy even at 0ms.
- During a gesture the UI tracks 1:1 continuously — never only at gesture end.
  (The book's wheel-accumulation floor-turn and the scroll-driven `--p`
  choreography in `moments-album.css` are the house pattern: input drives a
  custom property every frame.)
- No debounce on anything the finger touches. Debounce network, not motion.

## Interruptibility

- Never lock input while something animates. Every transition must be
  cancelable mid-flight without a visual jump.
- Always animate FROM the presentation value (what's on screen now), never by
  restarting from the logical start. If a CSS keyframe animation can be
  interrupted by user input, that's the sign the value belongs in a custom
  property driven by JS/scroll instead (this is how the book stage works).
- Decide commit-vs-revert by velocity sign at release, not by position alone.

## Springs and momentum — the CSS-first translation

We do NOT ship Framer Motion / Motion. Prefer, in order:

1. Scroll- or input-driven custom properties (fully interruptible for free).
2. CSS transitions with good easing (`ease-out` for enters, mirrored curves
   for reversible pairs) — a transition retargets smoothly mid-flight, unlike
   a keyframe animation.
3. A rAF tween with `easeOutCubic` for one-shot cinematics (the book's
   `beginIntro`).
4. A spring library — only for a genuinely gesture-driven surface (touch-drag
   page turning would qualify), and it's a dependency decision to surface, not
   sneak in.

Numbers worth keeping even in CSS terms: default motion ≈ 300–400ms with no
overshoot; add bounce only when the user's own gesture carried momentum.

**Momentum projection** (for wheel/flick release — where should it land?):

```js
// exponential decay; deceleration 0.998 scroll-like, 0.99 snappier
const project = (v, d = 0.998) => (v / 1000) * d / (1 - d)
const target = nearestSnapPoint(current + project(releaseVelocity))
```

**Rubber-banding** at hard edges (first/last page, scroll floor) — progressive
resistance instead of a dead stop:

```js
const rubberband = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over))
```

**Gesture thresholds**: ~10px of movement before committing to a direction;
generous hit areas; cancel-by-dragging-away on taps.

## Performance — school hardware is the target device

- Animate ONLY `transform` and `opacity`. No animated `box-shadow`, `filter`,
  layout properties, or `background-position`.
- `will-change` sparingly, right before motion, removed after.
- **No `backdrop-filter` chrome.** Apple's translucent-material language is
  expensive on the laptops classrooms actually have, and it isn't our design
  language anyway — hierarchy here comes from flat `--sp-*` token cards,
  spacing, and type weight (teacher design v3). Dim-behind-modal with
  `--sp-overlay` is the one sanctioned "material".

## RTL — where the original skill is silent and we are not

- Every horizontal trajectory mirrors with direction: enter-from and exit-to
  the same edge, per direction. Never hardcode a physical side for motion that
  means "forward/back".
- Put the direction class ON the element whose children the animation CSS
  selects (the `.tch-book.is-rtl` leaf-combo lesson — a direction class on an
  ancestor the selectors don't reference silently kills the animation).
- Centering that must not shift with direction uses physical properties
  deliberately, with a comment (the gift's `left: 50%; translate: -50%`).
- `transform-origin`, `perspective-origin`, and clip insets all mirror; check
  each one, they fail silently.

## Typography — the part of the original to overrule

The source skill says "tighten large text with negative tracking". That rule
is Latin-only:

- **NEVER apply `letter-spacing` to Arabic** — it breaks the joined script.
- Avoid it on Hebrew too; the gain is marginal and shared components render
  all three locales from the same CSS.
- Build hierarchy from size + weight + line-height as a set instead. Tight
  leading on large Hebrew display text is fine and we use it.
- `rem`/`em` for type and spacing so user font-size settings scale the layout.
- Hebrew wording rules live elsewhere and still apply (גרש not apostrophe,
  gender-free phrasing).

## Reduced motion & transparency

- `prefers-reduced-motion: reduce` means gentler, not gone: replace
  slides/springs/3D with a short opacity cross-fade; keep the feedback itself.
  (The book intro and gift already do this in `moments-album.css` — extend
  that pattern, don't invent a new one.)
- Respect `prefers-reduced-transparency` and `prefers-contrast: more` where a
  surface is translucent or low-contrast: raise opacity, add a real border.
- No large slow-looping background motion (~0.2 Hz oscillation is the
  vestibular worst case).

## Effects that depend on data — the three-times-learned rule

An effect that queries DOM which only exists after data lands must dep on
that data (`[pages.length]`), or it arms against nothing and dies silently.
Any new IntersectionObserver, wheel listener, or measurement effect in a
data-driven cinematic gets this check in review.

## Review checklist (the principles, compressed)

- Does the screen answer: where am I, where can I go, how do I get back?
- Is every control next to the thing it affects? A label that explains a
  mapping means the mapping is weak.
- Feedback comes in four kinds — status, completion, warning, error — and
  meaningful actions confirm inline, not with a blocking dialog unless truly
  irreversible.
- Specific labels beat safe generic ones (name the destination, not "עוד").
- Delight is the eight principles landing, not confetti — except the one
  weekly gift, which earned it.
