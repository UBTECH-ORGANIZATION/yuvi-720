/** The overlay through which Yuvi shows what to look at. Sits above the
 *  cross-origin iframe inside `.learning-player-frame-wrap` (already
 *  position:relative) and draws only what the pointer model deems
 *  trustworthy (services/pointer.ts):
 *
 *  - rect: the object's own highlight, interpolated from the nightly capture,
 *    with its NAME on a badge ("המאזניים") — dashed when a whole region
 *    stands in for a finer target;
 *  - edge: "scroll to: <name>" at the bottom edge, when the target sits below
 *    the fold of a screen that scrolls inside the iframe;
 *  - callout: a labeled pill when the target can be named but not placed.
 *
 *  The layer never intercepts input — only the dismiss chip does: a mark
 *  stays until the learner closes it or the screen moves. The chip rides
 *  with the badge (a control that belongs to the mark, not to the frame).
 *  The name is announced politely to screen readers once per mark.
 */

import { useEffect, useRef, useState } from 'react'
import type { CoachPointerFrame } from '../../services/agents'
import { focusKind, focusLabel, presentPointer } from '../../services/pointer'
import { trackEvent } from '../../services/telemetry'
import { useI18n } from '../../i18n/I18nProvider'

interface LessonPointLayerProps {
  pointer: CoachPointerFrame | null
  playback: 'frame' | 'tab'
  language: string
  onDismiss: () => void
}

/** Room the badge row needs above a rect before it flips below it. */
const BADGE_ROW_HEIGHT = 44

export function LessonPointLayer({ pointer, playback, language, onDismiss }: LessonPointLayerProps) {
  const { t } = useI18n()
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
  const label = focusLabel(pointer, language, t)

  // One render record per mark (not per resize): which presentation the
  // learner actually got, and why — the number that says whether marks land.
  const reported = useRef<CoachPointerFrame | null>(null)
  useEffect(() => {
    if (!pointer || presentation.mode === 'none' || reported.current === pointer || !box.w) return
    reported.current = pointer
    trackEvent('coach.focus.render', {
      mode: presentation.mode,
      reason: presentation.reason,
      precision: pointer.precision || 'v1',
      kind: focusKind(pointer) || 'none',
      box: `${Math.round(box.w)}x${Math.round(box.h)}`,
    })
  }, [pointer, presentation, box.w, box.h])

  if (presentation.mode === 'none' || (presentation.mode === 'callout' && !label)) {
    return <div ref={layerRef} className="lesson-point-layer" aria-hidden="true" />
  }

  const dismiss = (
    <button
      type="button"
      className="lesson-point-dismiss"
      onClick={onDismiss}
      aria-label={t('focus.dismiss')}
    >
      {t('focus.dismiss')} ✓
    </button>
  )
  const announce = (
    <span className="lesson-point-sr" aria-live="polite">{t('focus.look_at', { label })}</span>
  )

  if (presentation.mode === 'rect') {
    const { rect } = presentation
    // The badge row sits on the rect's top edge — above it when there is
    // room, else just inside its bottom — never over the middle of what the
    // learner is supposed to read.
    const above = rect.y >= BADGE_ROW_HEIGHT
    const rowTop = above ? rect.y - BADGE_ROW_HEIGHT + 4 : Math.min(box.h - BADGE_ROW_HEIGHT, rect.y + rect.h + 4)
    const rowCenter = Math.max(12, Math.min(box.w - 12, rect.x + rect.w / 2))
    return (
      <div
        ref={layerRef}
        className="lesson-point-layer"
        data-mode="rect"
        data-reason={presentation.reason}
      >
        <div
          className={`lesson-point-highlight${presentation.approx ? ' is-approx' : ''}`}
          style={{
            left: `${rect.x}px`, top: `${rect.y}px`,
            width: `${rect.w}px`, height: `${rect.h}px`,
          }}
        />
        <div
          className="lesson-point-badge-row"
          style={{ left: `${rowCenter}px`, top: `${Math.max(4, rowTop)}px` }}
        >
          <span className="lesson-point-badge" dir="auto">{label}</span>
          {dismiss}
        </div>
        {announce}
      </div>
    )
  }

  if (presentation.mode === 'edge') {
    return (
      <div ref={layerRef} className="lesson-point-layer" data-mode="edge" data-reason={presentation.reason}>
        <div className="lesson-point-edge" style={{ left: `${presentation.x * 100}%` }}>
          <span className="lesson-point-edge__hint" dir="auto">
            {t('focus.scroll_to', { label })}
          </span>
          <span className="lesson-point-edge__chevron" aria-hidden="true">⌄</span>
        </div>
        <div className="lesson-point-corner">{dismiss}</div>
        {announce}
      </div>
    )
  }

  return (
    <div ref={layerRef} className="lesson-point-layer" data-mode="callout" data-reason={presentation.reason}>
      <div className="lesson-point-callout">
        <span className="lesson-point-callout__eyes" aria-hidden="true">👀</span>
        <span className="lesson-point-callout__label" dir="auto">{label}</span>
        {dismiss}
      </div>
      {announce}
    </div>
  )
}
