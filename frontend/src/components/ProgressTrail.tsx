/* The learner's progress through a unit — a filled trail, never a number.

   An adaptive path has a moving total: a repair round grows it, a passed
   assessment shrinks it, a learner asking for more practice grows it again. So
   "שלב 3 מתוך 5" is a promise we cannot keep, and 720 §3.4 wants the unit-level
   progress axis owned by the platform and free of numeric scores anyway. The
   learner gets a bar and a sentence; the totals live in the teacher view.

   The trap this component exists to avoid: inserting a step takes 3/5 → 3/6, so
   a naive bar RETRACTS — visibly worse than a changing number. The fill is
   therefore monotone per unit. Growth is rendered by the track getting longer
   ahead of you; what you have walked never un-walks. */

import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import './progress-trail.css'

const STORE_KEY = 'yuvilab:progress-ceiling'

type Ceilings = Record<string, number>

function readCeilings(): Ceilings {
  try {
    return JSON.parse(sessionStorage.getItem(STORE_KEY) || '{}') as Ceilings
  } catch {
    return {}
  }
}

/** The highest fill this unit has ever shown in this sitting.
 *
 *  Kept in sessionStorage rather than component state so a reload — or moving
 *  between the dashboard card, the lesson toolbar and the roadmap, which all
 *  render this — cannot flash the bar backwards. A shrink only ever happens when
 *  the learner passed the assessment early, which moves the ratio to 1 anyway. */
export function useMonotonicRatio(unitId: string | null | undefined, ratio: number): number {
  const key = unitId || ''
  const [shown, setShown] = useState(() => {
    if (!key) return ratio
    return Math.max(readCeilings()[key] ?? 0, ratio)
  })
  const lastKey = useRef(key)

  useEffect(() => {
    if (!key) {
      setShown(ratio)
      return
    }
    const ceilings = readCeilings()
    const previous = lastKey.current === key ? Math.max(ceilings[key] ?? 0, shown) : (ceilings[key] ?? 0)
    lastKey.current = key
    const next = Math.max(previous, ratio)
    if (next !== shown) setShown(next)
    if (next !== ceilings[key]) {
      try {
        sessionStorage.setItem(STORE_KEY, JSON.stringify({ ...ceilings, [key]: next }))
      } catch {
        /* a full or blocked storage must never break the lesson */
      }
    }
  }, [key, ratio, shown])

  return shown
}

interface ProgressTrailProps {
  unitId?: string | null
  /** 0…1 from the server — `steps_completed / steps_total` for THIS learner. */
  ratio: number
  /** Small caption under the bar. Pass null for the bare bar. */
  label?: string | null
  size?: 'sm' | 'md'
  tone?: string
}

export function ProgressTrail({ unitId, ratio, label, size = 'md', tone }: ProgressTrailProps) {
  const { t } = useI18n()
  const shown = useMonotonicRatio(unitId, Math.max(0, Math.min(1, ratio || 0)))
  const percent = Math.round(shown * 100)

  return (
    <div className={`progress-trail progress-trail--${size}`}>
      <div
        className="progress-trail__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        // The number is for assistive tech, which needs SOME quantity; the
        // visual UI stays wordless on purpose.
        aria-valuetext={label || t('learning.progress.aria', { percent })}
      >
        <span
          className="progress-trail__fill"
          style={{ inlineSize: `${percent}%`, ...(tone ? { background: tone } : {}) }}
        />
      </div>
      {label ? <small className="progress-trail__label">{label}</small> : null}
    </div>
  )
}
