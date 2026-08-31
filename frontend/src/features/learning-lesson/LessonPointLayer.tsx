/** The overlay through which Yuvi points at the lomda. Sits above the
 *  cross-origin iframe inside `.learning-player-frame-wrap` (already
 *  position:relative) and draws only what the pointer model deems
 *  trustworthy: a region highlight when the capture geometry transfers, a
 *  bottom-edge "look lower" chevron when the target is below the fold of a
 *  screen that scrolls inside the iframe, a whole-frame glow otherwise.
 *  Rects are fractions, so percentage positioning tracks every resize for
 *  free. The layer itself never intercepts input — only the dismiss chip
 *  does: a pointer stays until the learner closes it or the screen moves.
 */

import { useEffect, useRef, useState } from 'react'
import type { CoachPointerFrame } from '../../services/agents'
import { presentPointer } from '../../services/pointer'

interface LessonPointLayerProps {
  pointer: CoachPointerFrame | null
  playback: 'frame' | 'tab'
  language: string
  onDismiss: () => void
}

const DISMISS_LABEL: Record<string, string> = {
  he: 'הבנתי',
  ar: 'فهمت',
  en: 'Got it',
}
const SCROLL_HINT: Record<string, string> = {
  he: 'גללו למטה',
  ar: 'مرّروا لأسفل',
  en: 'Scroll down',
}

export function LessonPointLayer({ pointer, playback, language, onDismiss }: LessonPointLayerProps) {
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
  if (presentation.mode === 'none') {
    return <div ref={layerRef} className="lesson-point-layer" aria-hidden="true" />
  }
  const dismiss = (
    <button
      type="button"
      className="lesson-point-dismiss"
      onClick={onDismiss}
      aria-label={DISMISS_LABEL[language] || DISMISS_LABEL.he}
    >
      {DISMISS_LABEL[language] || DISMISS_LABEL.he} ✓
    </button>
  )

  return (
    <div ref={layerRef} className="lesson-point-layer">
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
      {presentation.mode === 'edge' && (
        <div
          className="lesson-point-edge"
          style={{ left: `${presentation.x * 100}%` }}
        >
          <span className="lesson-point-edge__hint" dir="auto">
            {SCROLL_HINT[language] || SCROLL_HINT.he}
          </span>
          <span className="lesson-point-edge__chevron" aria-hidden="true">⌄</span>
        </div>
      )}
      {dismiss}
    </div>
  )
}
