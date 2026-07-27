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
import type { CoachVisual } from '../../services/agents'

const MafsScene = lazy(() =>
  import('./MafsScene').then((module) => ({ default: module.MafsScene })),
)
// RDKit's WASM runtime is ~10 MB — it must never enter the main bundle, and is
// fetched only when a learner actually receives a chemistry visual.
const MoleculeScene = lazy(() =>
  import('./MoleculeScene').then((module) => ({ default: module.MoleculeScene })),
)

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
