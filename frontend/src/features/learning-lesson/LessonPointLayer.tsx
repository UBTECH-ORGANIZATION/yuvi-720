/** The overlay through which Yuvi points at the lomda. Sits above the
 *  cross-origin iframe inside `.learning-player-frame-wrap` (already
 *  position:relative) and draws only what the pointer model deems
 *  trustworthy: a pixel-perfect region highlight interpolated from the
 *  nightly multi-width capture, a bottom-edge "look lower" chevron when the
 *  target is below the fold of a screen that scrolls inside the iframe, a
 *  whole-frame glow otherwise. The layer itself never intercepts input —
 *  only the dismiss chip does: a pointer stays until the learner closes it
 *  or the screen moves. The chip rides WITH the highlight (a control that
 *  belongs to the mark, not to the frame corner), falling back above it at
 *  the bottom of the box.
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

const CHIP_HALF_WIDTH = 64
const CHIP_HEIGHT = 44

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

  const dismissChip = (style: React.CSSProperties) => (
    <button
      type="button"
      className="lesson-point-dismiss"
      style={style}
      onClick={onDismiss}
      aria-label={DISMISS_LABEL[language] || DISMISS_LABEL.he}
    >
      {DISMISS_LABEL[language] || DISMISS_LABEL.he} ✓
    </button>
  )

  if (presentation.mode === 'rect') {
    const { rect } = presentation
    // The chip sits in the MIDDLE of the highlight — the mark and its
    // control are one thing — clamped inside the box for slivers at the
    // frame's edge.
    const chipLeft = Math.max(
      CHIP_HALF_WIDTH + 6,
      Math.min(box.w - CHIP_HALF_WIDTH - 6, rect.x + rect.w / 2),
    )
    const chipTop = Math.max(
      CHIP_HEIGHT / 2 + 6,
      Math.min(box.h - CHIP_HEIGHT / 2 - 6, rect.y + rect.h / 2),
    )
    return (
      <div ref={layerRef} className="lesson-point-layer">
        <div
          className="lesson-point-highlight"
          style={{
            left: `${rect.x}px`, top: `${rect.y}px`,
            width: `${rect.w}px`, height: `${rect.h}px`,
          }}
        />
        {dismissChip({
          left: `${chipLeft}px`, top: `${chipTop}px`,
          transform: 'translate(-50%, -50%)',
        })}
      </div>
    )
  }

  return (
    <div ref={layerRef} className="lesson-point-layer">
      {presentation.mode === 'glow' && <div className="lesson-point-glow" />}
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
      {dismissChip(
        presentation.mode === 'edge'
          ? { insetBlockEnd: '14px', insetInlineEnd: '16px' }
          : { insetBlockEnd: '14px', insetInlineStart: '50%', transform: 'translateX(-50%)' },
      )}
    </div>
  )
}
