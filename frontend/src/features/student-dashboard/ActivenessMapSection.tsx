import { Suspense, lazy, useEffect, useState } from 'react'
import { Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { getLearnerState } from '../../services/api'
import type { DashboardDTO } from '../../services/brain'
import './activeness-map.css'

const ActivenessMap3D = lazy(() =>
  import('./ActivenessMap3D').then((m) => ({ default: m.ActivenessMap3D })),
)

interface ActivenessMapSectionProps {
  competencies: DashboardDTO['competencies']
  studentName: string
}

/**
 * Floating activeness-map bubble that appears when the learner scrolls to the
 * bottom of the dashboard. Clicking it opens the 3D space with an animation.
 * The heavy WebGL scene is lazy-loaded so it never touches the initial render.
 */
export function ActivenessMapSection({ competencies, studentName }: ActivenessMapSectionProps) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const [visible, setVisible] = useState(false)
  const [initial, setInitial] = useState<{ positions?: Record<string, number>; focus?: string | null } | null>(null)

  const open = () => {
    if (expanded) return
    getLearnerState()
      .then((state) => setInitial((state.activeness_map as any) ?? null))
      .catch(() => setInitial(null))
      .finally(() => setExpanded(true))
  }

  // Show the bubble only when the learner reaches the very end of the page.
  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop
      const scrollHeight = document.documentElement.scrollHeight
      const clientHeight = window.innerHeight
      const reachedBottom = Math.ceil(scrollTop + clientHeight) >= scrollHeight
      setVisible(reachedBottom)
    }
    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Lock background scroll while the space is open.
  useEffect(() => {
    if (!expanded) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [expanded])

  return (
    <>
      <button
        className={`sd-actmap-bubble${visible && !expanded ? ' sd-actmap-bubble--visible' : ''}`}
        type="button"
        onClick={open}
        aria-label={t('actmap.dockTitle')}
        aria-hidden={!visible}
        tabIndex={visible ? 0 : -1}
      >
        <span className="sd-actmap-bubble__glow" aria-hidden="true" />
        <span className="sd-actmap-bubble__arrow" aria-hidden="true">
          <Icon name="chevronUp" size={16} strokeWidth={2.4} />
        </span>
        <span className="sd-actmap-bubble__content">
          <span className="sd-actmap-bubble__icon">
            <Icon name="map" size={18} />
          </span>
          <span className="sd-actmap-bubble__title">{t('actmap.dockTitle')}</span>
        </span>
      </button>

      {expanded && (
        <Suspense fallback={null}>
          <ActivenessMap3D
            competencies={competencies}
            studentName={studentName}
            initial={initial}
            onClose={() => setExpanded(false)}
          />
        </Suspense>
      )}
    </>
  )
}
