import { lazy, Suspense } from 'react'

/* Three.js is roughly 600KB, and the robot is decorative on every screen that
   shows it — the mapping questions, the results card and the login dialog all
   stay usable while it loads. Importing it through this wrapper keeps the
   renderer out of the entry chunk without changing any call site. */

type YuviRobot3DProps = React.ComponentProps<typeof import('./YuviRobot3D')['YuviRobot3D']>

const YuviRobot3DImpl = lazy(() =>
  import('./YuviRobot3D').then((module) => ({ default: module.YuviRobot3D })))

export function YuviRobot3D(props: YuviRobot3DProps) {
  /* The placeholder holds the renderer's exact box (`robot-3d-canvas` is
     always 100% of its parent) so the surrounding layout never shifts when the
     chunk lands. */
  const placeholder = (
    <div className="robot-3d-canvas" style={{ width: '100%', height: '100%' }} aria-hidden="true" />
  )
  return (
    <Suspense fallback={placeholder}>
      <YuviRobot3DImpl {...props} />
    </Suspense>
  )
}
