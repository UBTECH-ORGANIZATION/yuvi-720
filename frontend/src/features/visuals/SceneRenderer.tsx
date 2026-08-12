/* SceneRenderer — picks how a Coach visual is drawn, and guarantees a picture.
 *
 * Three payload shapes reach this component:
 *   type 'video'  → Manim MP4 (the animated path, unchanged)
 *   type 'image'  → server-rendered PNG/SVG, from conversation history stored
 *                   before client rendering existed
 *   type 'scene'  → drawn here in the browser from the sanitized scene spec
 *
 * Every 'scene' payload also carries the backend's deterministic SVG in
 * `data_url`. If the client renderer throws — an element type this build does
 * not know, a bad chunk, a Mafs upgrade — the boundary below falls back to that
 * image rather than leaving an empty chat bubble. That fallback is the reason
 * client rendering is safe to ship.
 */

import { Component, Suspense, lazy } from 'react'
import type { ReactNode } from 'react'
import type { CoachVisual, CoachVisualScene } from '../../services/agents'

const MafsScene = lazy(() =>
  import('./MafsScene').then((module) => ({ default: module.MafsScene })),
)
// RDKit's WASM runtime is ~10 MB — it must never enter the main bundle, and is
// fetched only when a learner actually receives a chemistry visual.
const MoleculeScene = lazy(() =>
  import('./MoleculeScene').then((module) => ({ default: module.MoleculeScene })),
)

/** What the STILL renderers can draw — `MafsScene`'s switch here, and the
 *  backend's deterministic SVG, which implement the same thirteen.
 *
 *  The backend's scene contract is wider than this: `prop` (balance scale,
 *  balloon, particle box, container, bar comparison) and `drawing` (authored
 *  SVG paths) are planned by the model, sanitized, laid out, and rendered
 *  correctly by Manim AND by the backend's deterministic SVG — but the browser
 *  renderer has no case for them, so it draws nothing.
 *
 *  Nothing throws when that happens. The error boundary below never fires, the
 *  fallback image never shows, and the result is an empty white panel where a
 *  diagram should be — which is exactly what a task deck's opening slide looked
 *  like: three props, and a blank box.
 *
 *  So the check is made before rendering rather than after failing: a scene the
 *  client cannot fully draw is shown as the server's SVG, which can draw it.
 *  This list is kept in step with the switch by `tests/scene-fallback.test.ts`.
 */
const CLIENT_ELEMENTS = new Set([
  'polygon', 'polyline', 'line', 'arrow', 'point', 'circle', 'rectangle',
  'arc', 'angle', 'right_angle', 'brace', 'number_line', 'axes', 'text',
])

function drawsSomething(scene: CoachVisualScene): boolean {
  if (scene?.render === 'molecule') return true
  const elements = Array.isArray(scene?.elements) ? scene.elements : []
  return elements.some((element) => CLIENT_ELEMENTS.has(String(element?.type)))
}

class RenderBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    // Not fatal — the fallback image is already showing. Logged so a broken
    // element mapping is diagnosable instead of silently degrading forever.
    console.warn('[visual] client renderer failed, using server SVG', error)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function StaticImage({ visual }: { visual: CoachVisual }) {
  return <img src={visual.data_url} alt={visual.alt || visual.title} />
}

export function SceneRenderer({ visual }: { visual: CoachVisual }) {
  if (visual.type === 'video') {
    return (
      <video
        src={visual.data_url}
        autoPlay
        muted
        loop
        playsInline
        aria-label={visual.alt || visual.title}
      />
    )
  }

  if (visual.type !== 'scene') return <StaticImage visual={visual} />

  /* Checked before rendering, not after failing: an unimplemented element type
     draws nothing and throws NOTHING, so the boundary below cannot catch it and
     the fallback never appears. The server's SVG is no help here — it
     implements the same thirteen types — so the honest answer is no picture.
     Old payloads stored before this check exist and are handled by it. */
  if (!drawsSomething(visual.scene)) return null

  const fallback = <StaticImage visual={visual} />
  const body =
    visual.renderer === 'molecule' ? (
      <MoleculeScene scene={visual.scene} />
    ) : (
      <MafsScene scene={visual.scene} />
    )
  return (
    <RenderBoundary fallback={fallback}>
      <Suspense fallback={fallback}>{body}</Suspense>
    </RenderBoundary>
  )
}

export default SceneRenderer
