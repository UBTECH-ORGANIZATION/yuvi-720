import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'

const EXIT_MS = 620

/**
 * The prologue shown while the stage builds: a portal of rings around Yuvi and
 * a line of copy, over the stage's dark backdrop.
 *
 * Deliberately no WebGL of its own. The first version rendered the rings
 * through a second `high-performance` context and Yuvi through a third — three
 * render loops on an integrated GPU at the exact moment the real stage was
 * building its room and compiling its programs, which is the one moment that
 * must be cheap (see `renderTier.ts`). The rings are CSS now and Yuvi is the
 * same 2D robot the renderer keeps behind its canvas, so the prologue costs
 * the compositor a few layers and the GPU nothing.
 */
export function StudioLoadingExperience({ ready, onExited }: { ready: boolean; onExited: () => void }) {
  const { t } = useI18n()
  const onExitedRef = useRef(onExited)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => { onExitedRef.current = onExited }, [onExited])

  useEffect(() => {
    if (ready) setLeaving(true)
  }, [ready])

  useEffect(() => {
    if (!leaving) return
    const timeout = window.setTimeout(() => onExitedRef.current(), EXIT_MS)
    return () => window.clearTimeout(timeout)
  }, [leaving])

  return <section className={`ys-loading${leaving ? ' is-leaving' : ''}`} aria-live="polite" aria-label={t('YuviStudio.loading.label')}>
    <div className="ys-loading__portal-system" aria-hidden>
      <div className="ys-loading__portal">
        <span className="ys-loading__ring" />
        <span className="ys-loading__ring" />
        <span className="ys-loading__ring" />
      </div>
      <div className="ys-loading__yuvi">
        <img src="/shared/yubi-robot.png" alt="" />
      </div>
    </div>
    <div className="ys-loading__copy">
      <p>{t('YuviStudio.loading.status')}</p>
      <span aria-hidden><i /><i /><i /></span>
    </div>
  </section>
}
