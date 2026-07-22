import { Suspense, lazy, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useReducedMotion } from 'motion/react'
import { animate, stagger } from 'animejs'
import { Icon } from '../../components/primitives'
import { LearnerAppBar } from '../../components/LearnerAppBar'
import { useI18n } from '../../i18n/I18nProvider'
import { getLearnerState, updateLearnerState } from '../../services/api'
import type { DashboardDTO } from '../../services/brain'
import './activeness-map.css'

const ActivenessMap = lazy(() =>
  import('./ActivenessMap').then((m) => ({ default: m.ActivenessMap })),
)

interface ActivenessMapSectionProps {
  competencies: DashboardDTO['competencies']
  studentName: string
}

/** Domain accent colours that orbit the gate portal as a teaser. */
const GATE_SPARKS = ['#8a6cff', '#6d7cf0', '#5566e0', '#4aa3e8', '#c56ad6']
const EXIT_MS = 320

/**
 * Bottom gateway into the activeness space.
 *
 * A calm card docks at the bottom of the dashboard. Tapping it opens the
 * activeness map as a **full-screen sheet that slides up and fades in** (with a
 * very subtle scale) over the same dark surface as the rest of the product — no
 * expanding dome. Closing slides it back down. Reduced motion opens instantly.
 *
 * The 3D scene (ActivenessMap3D) stays in the repo untouched.
 */
export function ActivenessMapSection({ competencies, studentName }: ActivenessMapSectionProps) {
  const { t } = useI18n()
  const reduceMotion = useReducedMotion()
  const [visible, setVisible] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [initial, setInitial] = useState<
    { positions?: Record<string, number>; focus?: string | null; history?: { at: string; positions: Record<string, number> }[] } | null | undefined
  >(undefined)
  const persisted = useRef(false)
  const gateRef = useRef<HTMLButtonElement>(null)
  const exitTimer = useRef(0)

  // Show the docked gate once the learner reaches the bottom of the dashboard.
  useEffect(() => {
    const onScroll = () => {
      const top = window.scrollY || document.documentElement.scrollTop
      const height = document.documentElement.scrollHeight
      const view = window.innerHeight
      setVisible(Math.ceil(top + view) >= height - 4)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const loadInitial = () =>
    getLearnerState()
      .then((state) => setInitial((state.activeness_map as any) ?? null))
      .catch(() => setInitial(null))

  const openSheet = () => {
    if (mounted) return
    void loadInitial()
    setClosing(false)
    setMounted(true)
  }

  const unmount = () => {
    setMounted(false)
    setOpen(false)
    setClosing(false)
    persisted.current = false
  }

  const close = () => {
    if (reduceMotion) { unmount(); return }
    setClosing(true)
    setOpen(false)
    window.clearTimeout(exitTimer.current)
    exitTimer.current = window.setTimeout(unmount, EXIT_MS)
  }

  // Reveal the inner map (and its intro animations) once the sheet has mounted.
  useEffect(() => {
    if (!mounted) return
    if (reduceMotion) { setOpen(true); return }
    const id = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(id)
  }, [mounted, reduceMotion])

  // Lock the page behind the sheet while it is open.
  useEffect(() => {
    if (!mounted) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [mounted])

  // Portal sparks teaser on the docked gate.
  useEffect(() => {
    if (reduceMotion || !visible || mounted) return
    const gate = gateRef.current
    if (!gate) return
    const sparks = gate.querySelectorAll<HTMLElement>('.trail-gate__spark')
    if (!sparks.length) return
    const a = animate(sparks, { scale: [0, 1], opacity: [0, 1], duration: 640, delay: stagger(90, { from: 'center' }), ease: 'outBack' })
    return () => { a?.revert?.() }
  }, [visible, mounted, reduceMotion])

  // Record this visit's positions into a rolling history (≈one point per day).
  // The map compares "now" against the ~7-days-ago point, so we must NOT reset
  // the baseline on every open — we only append when the newest point is stale
  // enough (≥20h), keeping ~a day's granularity and >7 days of depth. Gated on
  // `initial !== undefined` so we never clobber prior history before it loads.
  useEffect(() => {
    if (!open || persisted.current || initial === undefined) return
    persisted.current = true
    const positions: Record<string, number> = {}
    competencies.slice(0, 6).forEach((c) => { positions[c.key] = Math.round(Number(c.value) || 0) })
    const prior = initial?.history ?? []
    const lastAt = prior.length ? Date.parse(prior[prior.length - 1].at) : 0
    const APPEND_GAP_MS = 20 * 60 * 60 * 1000
    const history = (Date.now() - lastAt >= APPEND_GAP_MS
      ? [...prior, { at: new Date().toISOString(), positions }]
      : prior
    ).slice(-24)
    void updateLearnerState({ activeness_map: { positions, focus: initial?.focus ?? null, history } }).catch(() => undefined)
  }, [open, initial, competencies])

  useEffect(() => () => window.clearTimeout(exitTimer.current), [])

  const gatePortal = (
    <span className="trail-gate__portal" aria-hidden="true">
      <span className="gw-portal__ring gw-portal__ring--1" />
      <span className="gw-portal__ring gw-portal__ring--3" />
      <span className="gw-portal__core" />
      {GATE_SPARKS.map((color, i) => {
        const ang = (i / GATE_SPARKS.length) * Math.PI * 2 - Math.PI / 2
        const r = 26
        return (
          <span
            key={color}
            className="trail-gate__spark"
            style={{ '--gw-c': color, left: `calc(50% + ${(Math.cos(ang) * r).toFixed(1)}px)`, top: `calc(50% + ${(Math.sin(ang) * r).toFixed(1)}px)` } as CSSProperties}
          />
        )
      })}
    </span>
  )

  return (
    <>
      <button
        ref={gateRef}
        type="button"
        className={`trail-gate${visible && !mounted ? ' trail-gate--visible' : ''}`}
        onClick={openSheet}
        aria-label={t('actmap.dockTitle')}
        aria-hidden={!visible}
        tabIndex={visible ? 0 : -1}
      >
        {gatePortal}
        <span className="trail-gate__label">
          <span className="trail-gate__title">{t('actmap.dockTitle')}</span>
          <span className="trail-gate__hint">
            <Icon name="chevronUp" size={14} strokeWidth={2.4} />
            {t('actmap.reveal.enter')}
          </span>
        </span>
      </button>

      {mounted && (
        <div className={`amap-overlay${open ? ' is-open' : ''}${closing ? ' is-closing' : ''}`}>
          <div className="amap__nav">
            <LearnerAppBar studentName={studentName} />
          </div>
          <div className="amap__sheet">
            <Suspense fallback={null}>
              <ActivenessMap
                competencies={competencies}
                studentName={studentName}
                initial={initial}
                revealed={open}
                onClose={close}
              />
            </Suspense>
          </div>
        </div>
      )}
    </>
  )
}
