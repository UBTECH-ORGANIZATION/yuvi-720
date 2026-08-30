import { forwardRef, lazy, Suspense } from 'react'
import type { YuviAvatarHandle } from './YuviAvatar3D'

/* Same reasoning as `YuviRobot3DLazy`: the avatar drags in Three.js plus the
   lab-room and asset builders. Screens that only decorate with it load it after
   their own content is on screen. */

type YuviAvatarProps = React.ComponentProps<typeof import('./YuviAvatar3D')['YuviAvatar3D']>

const YuviAvatar3DImpl = lazy(() =>
  import('./YuviAvatar3D').then((module) => ({ default: module.YuviAvatar3D })))

export const YuviAvatar3D = forwardRef<YuviAvatarHandle, YuviAvatarProps>(
  function YuviAvatar3DLazy(props, ref) {
    /* While the chunk loads, show the same 2D robot the renderer itself keeps
       behind its canvas — Yuvi is present from the first frame, and the box is
       identical, so nothing shifts when the real avatar takes over. */
    const placeholder = (
      <div className="Yuvi-avatar-canvas" style={{ width: '100%', height: '100%' }} aria-hidden="true">
        <img className="Yuvi-avatar-canvas__fallback" src="/shared/yubi-robot.png" alt="" />
      </div>
    )
    return (
      <Suspense fallback={placeholder}>
        <YuviAvatar3DImpl {...props} ref={ref} />
      </Suspense>
    )
  }
)
