/** The overlay through which Yuvi points at the lomda. Sits above the
 *  cross-origin iframe inside `.learning-player-frame-wrap` (already
 *  position:relative), never intercepts input, and draws only what the
 *  pointer model deems trustworthy: a region highlight when the capture
 *  geometry transfers, a whole-frame glow otherwise. Rects are fractions, so
 *  percentage positioning tracks every resize for free — only the
 *  too-small-to-trust gate needs a measured box.
 */

import { useEffect, useRef, useState } from 'react'
import type { CoachPointerFrame } from '../../services/agents'
import { presentPointer } from '../../services/pointer'

interface LessonPointLayerProps {
  pointer: CoachPointerFrame | null
  playback: 'frame' | 'tab'
}

export function LessonPointLayer({ pointer, playback }: LessonPointLayerProps) {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = layerRef.current
    if (!el) return
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const presentation = presentPointer(pointer, playback, box.w, box.h)

  return (
    <div ref={layerRef} className="lesson-point-layer" aria-hidden="true">
      {presentation.mode === 'glow' && <div className="lesson-point-glow" />}
      {presentation.mode === 'rect' && (
        <div
          className="lesson-point-highlight"
          style={{
            left: `${presentation.rect.x * 100}%`,
            top: `${presentation.rect.y * 100}%`,
            width: `${presentation.rect.w * 100}%`,
            height: `${presentation.rect.h * 100}%`,
          }}
        />
      )}
    </div>
  )
}
