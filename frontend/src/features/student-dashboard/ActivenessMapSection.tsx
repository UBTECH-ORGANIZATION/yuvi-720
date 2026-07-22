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
const GATE_SPARKS = ['#8a6cff', '#38a1f0', '#25b483', '#e59a3c', '#c56ad6']
// Pixels of overscroll wheel travel that fully grows the gate.
const GROW_RANGE = 760
const GATE_W = 344
const GATE_H = 118
const easeOut = (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : 1 - Math.pow(1 - p, 2))
const lerp = (a: number, b: number, e: number) => a + (b - a) * e

/** True if the wheel target sits inside a scroll container that can still scroll
 * up — so an up-scroll should scroll it, not collapse the map. */
const canScrollUpWithin = (start: EventTarget | null) => {
  let el = start instanceof HTMLElement ? start : null
  while (el && el !== document.body) {
    if (el.scrollTop > 0) {
      const oy = getComputedStyle(el).overflowY
      if (oy === 'auto' || oy === 'scroll') return true
    }
    el = el.parentElement
  }
  return false
}

/**
 * Bottom gateway into the activeness space.
 *
 * When the learner reaches the end of the dashboard, an animated portal gate
 * pops up. From there, continuing to scroll down (or tapping) makes **the gate
 * itself grow** — it expands from its arch at the bottom until it fills the whole
 * content area below the app nav bar. Its own text fades as it grows, and once
 * it's filled, the map elements fade in on top. Its gradient is the page's
 * background, so the fill is seamless. Reduced motion opens instantly.
 *
 * The 3D scene (ActivenessMap3D) stays in the repo untouched.
 */
export function ActivenessMapSection({ competencies, studentName }: ActivenessMapSectionProps) {
  const { t } = useI18n()
  const reduceMotion = useReducedMotion()
  const [visible, setVisible] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [committed, setCommitted] = useState(false)
  const [initial, setInitial] = useState<
    { positions?: Record<string, number>; focus?: string | null; history?: { at: string; positions: Record<string, number> }[] } | null | undefined
  >(undefined)
  const persisted = useRef(false)

  const gateRef = useRef<HTMLButtonElement>(null)
  const belowRef = useRef<HTMLDivElement>(null)
  const growRef = useRef<HTMLDivElement>(null)
  const growInnerRef = useRef<HTMLDivElement>(null)
  const scrimRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const p = useRef(0)
  const lastWheel = useRef(0)
  const forceOpen = useRef(false)
  const closing = useRef(false)
  const raf = useRef(0)
  const committedRef = useRef(false)
  const visibleRef = useRef(false)
  committedRef.current = committed
  visibleRef.current = visible

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

  const applyGrow = (value: number) => {
    const below = belowRef.current
    const grow = growRef.current
    if (below && grow) {
      const r = below.getBoundingClientRect()
      const e = easeOut(value)
      const gw = Math.min(GATE_W, r.width - 24)
      // Re-establish bottom-anchored sizing (clears any commit inset:0 fill).
      grow.style.top = 'auto'
      grow.style.right = 'auto'
      grow.style.bottom = '0'
      grow.style.left = '50%'
      grow.style.transform = 'translateX(-50%)'
      grow.style.width = `${lerp(gw, r.width, e).toFixed(1)}px`
      grow.style.height = `${lerp(GATE_H, r.height, e).toFixed(1)}px`
      const rh = lerp(50, 2, e)
      const rv = lerp(100, 3, e)
      grow.style.borderRadius = `${rh}% ${rh}% 0 0 / ${rv}% ${rv}% 0 0`
    }
    // Gate's own text/portal fade as it grows.
    if (growInnerRef.current) growInnerRef.current.style.opacity = Math.max(0, 1 - value * 2.2).toFixed(3)
    // Dim the dashboard showing behind the still-growing gate — light early
    // (dashboard stays legible) then deepening as the gate fills.
    if (scrimRef.current) scrimRef.current.style.opacity = Math.min(0.82, value * value * 1.1).toFixed(3)
    // Map elements fade in only once the gate has (almost) filled.
    if (contentRef.current) contentRef.current.style.opacity = Math.max(0, Math.min(1, (value - 0.72) / 0.28)).toFixed(3)
    if (gateRef.current) gateRef.current.style.opacity = '0'
  }

  const commit = () => {
    committedRef.current = true // sync so a post-commit wheel can't re-apply sizing
    p.current = 1
    applyGrow(1)
    // Snap to exactly fill the content area via inset:0 (scrollbar-proof).
    if (growRef.current) {
      const g = growRef.current.style
      g.top = '0'; g.left = '0'; g.right = '0'; g.bottom = '0'
      g.width = 'auto'; g.height = 'auto'
      g.transform = 'none'
      g.borderRadius = '0' // fill the content area square — no rounded-corner gaps
    }
    forceOpen.current = false
    closing.current = false
    cancelAnimationFrame(raf.current)
    setCommitted(true)
  }
  const unmountMap = () => {
    cancelAnimationFrame(raf.current)
    forceOpen.current = false
    closing.current = false
    p.current = 0
    persisted.current = false
    setMounted(false)
    setCommitted(false)
    if (gateRef.current) gateRef.current.style.opacity = ''
  }

  const engine = () => {
    if (committedRef.current) return
    const dragging = Date.now() - lastWheel.current < 150
    if (!dragging) {
      const target = closing.current ? 0 : forceOpen.current || p.current >= 0.5 ? 1 : 0
      p.current += (target - p.current) * 0.18
      if (target === 1 && p.current > 0.985) { commit(); return }
      if (target === 0 && p.current < 0.014) { unmountMap(); return }
    }
    applyGrow(p.current)
    raf.current = requestAnimationFrame(engine)
  }
  const startEngine = () => { cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(engine) }

  const loadInitial = () =>
    getLearnerState()
      .then((state) => setInitial((state.activeness_map as any) ?? null))
      .catch(() => setInitial(null))

  const openViaTap = () => {
    if (mounted) return
    void loadInitial()
    setMounted(true)
    if (reduceMotion) { p.current = 1; setCommitted(true); return }
    forceOpen.current = true
    closing.current = false
    startEngine()
  }

  const close = () => {
    setCommitted(false)
    if (reduceMotion) { unmountMap(); return }
    closing.current = true
    forceOpen.current = false
    startEngine()
  }

  useEffect(() => {
    if (reduceMotion) return
    const onWheel = (e: WheelEvent) => {
      if (committedRef.current) {
        // Map is open: scrolling up past the top of its content reverses the
        // reveal — the map shrinks back down into the gate at the dashboard
        // bottom, so opening and closing feel like one continuous scroll.
        if (e.deltaY < 0 && !canScrollUpWithin(e.target)) {
          e.preventDefault()
          close()
        }
        return
      }
      const atBottom =
        Math.ceil((window.scrollY || document.documentElement.scrollTop) + window.innerHeight) >=
        document.documentElement.scrollHeight - 4
      if (!visibleRef.current || !atBottom) return
      if (e.deltaY > 0) {
        if (!mounted) { void loadInitial(); setMounted(true) }
        e.preventDefault()
        closing.current = false
        p.current = Math.min(1, p.current + e.deltaY / GROW_RANGE)
        lastWheel.current = Date.now()
        applyGrow(p.current)
        if (p.current >= 1) commit()
        else startEngine()
      } else if (mounted && p.current > 0 && e.deltaY < 0) {
        e.preventDefault()
        p.current = Math.max(0, p.current + e.deltaY / GROW_RANGE)
        lastWheel.current = Date.now()
        applyGrow(p.current)
        startEngine()
      }
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, reduceMotion])

  // Keep the growing gate sized correctly on viewport resize.
  useEffect(() => {
    if (!mounted) return
    const onResize = () => applyGrow(p.current)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted])

  // Size the gate immediately when the overlay mounts (before the first frame).
  useEffect(() => { if (mounted) applyGrow(p.current) }, [mounted])

  useEffect(() => {
    if (reduceMotion || !visible || mounted) return
    const gate = gateRef.current
    if (!gate) return
    const sparks = gate.querySelectorAll<HTMLElement>('.trail-gate__spark')
    if (!sparks.length) return
    const a = animate(sparks, { scale: [0, 1], opacity: [0, 1], duration: 640, delay: stagger(90, { from: 'center' }), ease: 'outBack' })
    return () => { a?.revert?.() }
  }, [visible, mounted, reduceMotion])

  useEffect(() => {
    if (!mounted) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [mounted])

  // Record this visit's positions into a rolling history (≈one point per day).
  // The map compares "now" against the ~7-days-ago point, so we must NOT reset
  // the baseline on every open — we only append when the newest point is stale
  // enough (≥20h), keeping ~a day's granularity and >7 days of depth. `positions`
  // still tracks the latest values (legacy/focus). Gated on `initial !==
  // undefined` so we never clobber prior history before it has loaded.
  useEffect(() => {
    if (!committed || persisted.current || initial === undefined) return
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
  }, [committed, initial, competencies])

  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const gatePortal = (
    <span className="trail-gate__portal" aria-hidden="true">
      <span className="gw-portal__ring gw-portal__ring--1" />
      <span className="gw-portal__ring gw-portal__ring--3" />
      <span className="gw-portal__core" />
      {GATE_SPARKS.map((color, i) => {
        const ang = (i / GATE_SPARKS.length) * Math.PI * 2 - Math.PI / 2
        const r = 30
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
        onClick={openViaTap}
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
        <div className={`amap-overlay${committed ? ' is-committed' : ''}`}>
          <div className="amap__nav">
            <LearnerAppBar studentName={studentName} />
          </div>
          <div className="amap__below" ref={belowRef}>
            <div className="amap__scrim" ref={scrimRef} aria-hidden="true" />
            {/* The gate, grown to fill — also the page background. */}
            <div className="trail-gate trail-gate--grow" ref={growRef} aria-hidden="true">
              <div className="trail-gate__growinner" ref={growInnerRef}>
                {gatePortal}
                <span className="trail-gate__label">
                  <span className="trail-gate__title">{t('actmap.dockTitle')}</span>
                  <span className="trail-gate__hint"><Icon name="chevronUp" size={14} strokeWidth={2.4} />{t('actmap.reveal.enter')}</span>
                </span>
              </div>
            </div>
            <div className="amap__content" ref={contentRef}>
              <Suspense fallback={null}>
                <ActivenessMap
                  competencies={competencies}
                  studentName={studentName}
                  initial={initial}
                  revealed={committed}
                  onClose={close}
                />
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
