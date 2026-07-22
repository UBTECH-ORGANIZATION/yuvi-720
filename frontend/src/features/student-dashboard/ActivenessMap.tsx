import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { animate, stagger, svg } from 'animejs'
import { Icon } from '../../components/primitives'
import { CompetencyChat } from '../../components/CompetencyChat'
import { explainActivenessChange } from '../../services/agents'
import { useI18n } from '../../i18n/I18nProvider'
import type { DashboardDTO } from '../../services/brain'

type Competency = DashboardDTO['competencies'][number]
type Tone = 'strong' | 'steady' | 'support'
type HistorySnapshot = { at: string; positions: Record<string, number> }

interface ActivenessMapProps {
  competencies: Competency[]
  studentName: string
  initial?: { positions?: Record<string, number>; focus?: string | null; history?: HistorySnapshot[] } | null
  /** True once the background has filled — triggers the element intro. */
  revealed: boolean
  onClose: () => void
}

const DOMAIN_VISUAL: Record<string, { color: string; icon: string }> = {
  motivation_relevance: { color: '#25b483', icon: 'target' },
  growth_mindset: { color: '#8a6cff', icon: 'leaf' },
  initiative_responsibility: { color: '#38a1f0', icon: 'arrow' },
  self_regulation: { color: '#5566e0', icon: 'compass' },
  self_awareness: { color: '#c56ad6', icon: 'search' },
  support_emotional: { color: '#e59a3c', icon: 'message' },
}
const FALLBACK_VISUAL = { color: '#7c6cff', icon: 'spark' }
const visualFor = (key: string) => DOMAIN_VISUAL[key] ?? FALLBACK_VISUAL

const S = 440
const C = S / 2
const MAXR = S * 0.33 // outer ring radius — emblems sit on these vertices (kept
                      // in from the edge so their labels fit inside the board)
// Label distance beyond the emblem. Horizontal (side) labels need more room
// because their text is wide; vertical (top/bottom) labels need less, else they
// read as too far from the icon. Scale by how horizontal the axis is.
const LABEL_MIN = 38
const LABEL_MAX = 58
const labelOutFor = (ang: number) => LABEL_MIN + (LABEL_MAX - LABEL_MIN) * Math.abs(Math.cos(ang))
const TRACE_GAP = 13 // keep the change arrow from landing on the current dot
const LEVELS = 5
const PIPS = 5 // level segments shown in the overview list (visual, no numbers)
const CHANGE_THRESHOLD = 4 // points of movement that count as a real change
const WINDOW_DAYS = 7 // "what changed" compares against ~this many days ago (rolling)
const DAY_MS = 86400000
const sideFor = (tone: Tone): 'good' | 'reinforce' => (tone === 'support' ? 'reinforce' : 'good')
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clampLevel = (v: number) => Math.max(0.08, Math.min(1, v / 100))

interface Axis extends Competency {
  ang: number
  level: number
  vx: number // data vertex (level radius)
  vy: number
  ex: number // emblem vertex (outer ring)
  ey: number
  lx: number // label
  ly: number
  last: number | null // last-seen value (0–100) or null on first visit
  oldLevel: number
  ovx: number // previous-visit data vertex (for the morph / trace start)
  ovy: number
  delta: number
  dir: 'up' | 'down'
  changed: boolean
}

const polyPoints = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
const pct = (v: number) => (v / S) * 100

/** Small line-graph arrow — trending up or down (used for change indicators). */
function TrendIcon({ dir, size = 12 }: { dir: 'up' | 'down'; size?: number }) {
  return (
    <svg className="amap__trend" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir === 'up' ? (
        <>
          <polyline points="3,17 9,11 13,15 21,7" />
          <polyline points="15,7 21,7 21,13" />
        </>
      ) : (
        <>
          <polyline points="3,7 9,13 13,9 21,17" />
          <polyline points="15,17 21,17 21,11" />
        </>
      )}
    </svg>
  )
}

/**
 * Activeness map — a front-facing radar "level shape" on the left, an
 * explanation / how-to-improve / Yuvi-chat panel on the right.
 *
 * Each domain's glossy emblem sits ON the outer vertex; the filled polygon
 * reaches inward to that domain's level. On open, any domain that moved since
 * the learner's last visit animates its dot from the old position to the new
 * one along a yellow "change" trace, and the whole shape morphs into place.
 * Selecting a domain zooms into its vertex and shows that area's recent history.
 * No numeric scores are shown to the learner.
 */
export function ActivenessMap({ competencies, initial, revealed, onClose }: ActivenessMapProps) {
  const { t, language } = useI18n()
  const dir = language === 'en' ? 'ltr' : 'rtl'
  const reduceMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const boardRef = useRef<HTMLDivElement>(null)
  const dataRef = useRef<SVGGElement>(null)
  const dataPolyRef = useRef<SVGPolygonElement>(null)
  const played = useRef(false)
  const morphRaf = useRef(0)

  const [selectedKey, setSelectedKey] = useState<string | null>(initial?.focus ?? null)
  const [chatOpen, setChatOpen] = useState(false)
  const [whyByKey, setWhyByKey] = useState<Record<string, { loading: boolean; text: string | null }>>({})
  const whyReq = useRef<Set<string>>(new Set())

  const history = initial?.history ?? []

  // Rolling baseline: compare against the snapshot from ~WINDOW_DAYS ago (the
  // newest one at least that old), so a week's movement keeps showing across
  // opens. Before a full week of history exists, use the earliest snapshot so
  // movement still accumulates. Falls back to a bare `positions` blob (legacy).
  const nowMs = useMemo(() => Date.now(), [])
  const baseline = useMemo<Record<string, number> | null>(() => {
    const hist = initial?.history ?? []
    if (hist.length) {
      const cutoff = nowMs - WINDOW_DAYS * DAY_MS
      const older = hist.filter((h) => Date.parse(h.at) <= cutoff)
      const ref = older.length ? older[older.length - 1] : hist[0]
      return ref.positions ?? null
    }
    return initial?.positions ?? null
  }, [initial, nowMs])

  const axes = useMemo<Axis[]>(() => {
    const list = competencies.slice(0, 6)
    const n = list.length || 1
    return list.map((c, i) => {
      const ang = (-90 + (i * 360) / n) * (Math.PI / 180)
      const level = clampLevel(Number(c.value) || 0)
      const rawLast = baseline?.[c.key]
      const last = typeof rawLast === 'number' ? rawLast : null
      const oldLevel = last != null ? clampLevel(last) : level
      const delta = last != null ? (Number(c.value) || 0) - last : 0
      return {
        ...c,
        ang,
        level,
        vx: C + Math.cos(ang) * level * MAXR,
        vy: C + Math.sin(ang) * level * MAXR,
        ex: C + Math.cos(ang) * MAXR,
        ey: C + Math.sin(ang) * MAXR,
        lx: C + Math.cos(ang) * (MAXR + labelOutFor(ang)),
        ly: C + Math.sin(ang) * (MAXR + labelOutFor(ang)),
        last,
        oldLevel,
        ovx: C + Math.cos(ang) * oldLevel * MAXR,
        ovy: C + Math.sin(ang) * oldLevel * MAXR,
        delta,
        dir: delta >= 0 ? 'up' : 'down',
        changed: last != null && Math.abs(delta) >= CHANGE_THRESHOLD,
      }
    })
  }, [competencies, baseline])

  const hasBaseline = axes.some((a) => a.last != null)
  const changedAxes = axes.filter((a) => a.changed)

  const rings = useMemo(
    () =>
      Array.from({ length: LEVELS }, (_, g) =>
        polyPoints(axes.map((a) => ({ x: C + Math.cos(a.ang) * ((g + 1) / LEVELS) * MAXR, y: C + Math.sin(a.ang) * ((g + 1) / LEVELS) * MAXR }))),
      ),
    [axes],
  )
  const dataPoly = useMemo(() => polyPoints(axes.map((a) => ({ x: a.vx, y: a.vy }))), [axes])
  const oldPoly = useMemo(() => polyPoints(axes.map((a) => ({ x: a.ovx, y: a.ovy }))), [axes])

  // Hide the animated elements from the very first paint (before the background
  // has even finished filling), so they never flash at full opacity during the
  // grow and then get reset to 0 when the intro starts. The intro fades them in.
  useLayoutEffect(() => {
    if (reduceMotion) return
    boardRef.current
      ?.querySelectorAll<HTMLElement>('.amap__emblem-inner, .amap__label, .amap__data-g')
      .forEach((el) => { el.style.opacity = '0' })
  }, [reduceMotion])

  // ── Intro + change animation ────────────────────────────────────────────────
  useEffect(() => {
    if (!revealed || played.current) return
    played.current = true
    const board = boardRef.current
    const dataG = dataRef.current

    if (reduceMotion) {
      if (dataG) dataG.style.transform = 'scale(1)'
      board?.querySelectorAll<HTMLElement>('.amap__emblem-inner, .amap__label').forEach((el) => { el.style.opacity = '1'; if (el.classList.contains('amap__emblem-inner')) el.style.transform = 'scale(1)' })
      board?.querySelectorAll<HTMLElement>('.amap__trace, .amap__ghost').forEach((el) => { el.style.opacity = '1' })
      return
    }
    if (!board) return

    const ringEls = board.querySelectorAll<SVGPolygonElement>('.amap__ring')
    if (ringEls.length) animate(svg.createDrawable(ringEls), { draw: ['0 0', '0 1'], duration: 820, delay: stagger(70), ease: 'inOutSine' })
    const inners = board.querySelectorAll<HTMLElement>('.amap__emblem-inner')
    if (inners.length) animate(inners, { scale: [0, 1], opacity: [0, 1], duration: 640, delay: stagger(90, { start: 340 }), ease: 'outBack' })
    const labels = board.querySelectorAll<HTMLElement>('.amap__label')
    if (labels.length) animate(labels, { opacity: [0, 1], duration: 560, delay: stagger(70, { start: 440 }), ease: 'outQuad' })

    if (!hasBaseline) {
      // First-ever visit — no deltas, just bloom the shape from the centre.
      if (dataG) animate(dataG, { scale: [0, 1], opacity: [0, 1], duration: 780, ease: 'outBack' })
      return
    }

    // Returning visit — morph the shape from its last-seen form to the current
    // one, sliding each dot along a yellow trace so movement is legible.
    if (dataG) { dataG.style.transform = 'scale(1)'; animate(dataG, { opacity: [0, 1], duration: 420, ease: 'outQuad' }) }
    const dots = Array.from(board.querySelectorAll<SVGCircleElement>('.amap__dot'))
    const poly = dataPolyRef.current
    const traceEls = board.querySelectorAll<SVGLineElement>('.amap__trace')
    if (traceEls.length) animate(svg.createDrawable(traceEls), { draw: ['0 0', '0 1'], duration: 760, delay: 220, ease: 'outQuad' })
    board.querySelectorAll<HTMLElement>('.amap__trace, .amap__ghost').forEach((el) => { el.style.opacity = '1' })

    const start = performance.now()
    const DUR = 900
    const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2)
    const tick = (now: number) => {
      const e = easeInOut(Math.min(1, (now - start) / DUR))
      if (poly) poly.setAttribute('points', polyPoints(axes.map((a) => ({ x: lerp(a.ovx, a.vx, e), y: lerp(a.ovy, a.vy, e) }))))
      dots.forEach((c) => {
        const a = axes.find((x) => x.key === c.getAttribute('data-key'))
        if (!a) return
        c.setAttribute('cx', lerp(a.ovx, a.vx, e).toFixed(1))
        c.setAttribute('cy', lerp(a.ovy, a.vy, e).toFixed(1))
      })
      if (e < 1) morphRaf.current = requestAnimationFrame(tick)
    }
    // Begin the shape at its old form so the morph is visible.
    if (poly) poly.setAttribute('points', oldPoly)
    dots.forEach((c) => {
      const a = axes.find((x) => x.key === c.getAttribute('data-key'))
      if (a) { c.setAttribute('cx', a.ovx.toFixed(1)); c.setAttribute('cy', a.ovy.toFixed(1)) }
    })
    morphRaf.current = requestAnimationFrame(tick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed, reduceMotion])

  useEffect(() => () => cancelAnimationFrame(morphRaf.current), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (chatOpen) setChatOpen(false)
      else if (selectedKey) setSelectedKey(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chatOpen, selectedKey, onClose])

  // ── Zoom into the selected vertex ───────────────────────────────────────────
  const selected = selectedKey ? axes.find((a) => a.key === selectedKey) ?? null : null
  useEffect(() => {
    const board = boardRef.current
    if (!board) return
    if (selected && !reduceMotion) {
      board.style.transformOrigin = `${pct(selected.ex)}% ${pct(selected.ey)}%`
      board.style.transform = 'scale(1.42)'
    } else {
      board.style.transformOrigin = '50% 50%'
      board.style.transform = 'scale(1)'
    }
  }, [selected, reduceMotion])

  // Draw the mini-history sparkline whenever a domain with history is focused.
  const focusSeries = useMemo(() => {
    if (!selected) return [] as number[]
    const past = history.map((h) => h.positions?.[selected.key]).filter((n): n is number => typeof n === 'number')
    return [...past, Number(selected.value) || 0].slice(-8)
  }, [selected, history])
  useEffect(() => {
    if (!selected || reduceMotion || focusSeries.length < 2) return
    const line = document.querySelector<SVGPolylineElement>('.amap__spark-line')
    if (line) animate(svg.createDrawable(line), { draw: ['0 0', '0 1'], duration: 620, ease: 'outQuad' })
  }, [selected, focusSeries, reduceMotion])

  const selectDomain = (key: string) => { setSelectedKey(key); setChatOpen(false) }

  // "Needs strengthening" reflects both level AND trend: a low-band domain, or
  // one that dropped over the window, counts here — so a decline can't hide
  // behind a still-decent band. "Doing well" is everything else.
  const decliningKeys = new Set(changedAxes.filter((a) => a.dir === 'down').map((a) => a.key))
  const needsReinforce = axes.filter((a) => a.tone === 'support' || decliningKeys.has(a.key)).length
  const doingWell = axes.length - needsReinforce

  const onPanelMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`)
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`)
  }

  // Lazy-fetch the "why did this change?" blurb for the focused, changed domain.
  // Keyed on selectedKey (stable) — `selected` is a fresh object each render, so
  // depending on it would re-run the effect and cancel its own in-flight fetch.
  useEffect(() => {
    const a = selectedKey ? axes.find((x) => x.key === selectedKey) : null
    if (!a || !a.changed || chatOpen || whyReq.current.has(a.key)) return
    whyReq.current.add(a.key)
    setWhyByKey((m) => ({ ...m, [a.key]: { loading: true, text: null } }))
    let alive = true
    explainActivenessChange(a.key, a.dir, language)
      .then((text) => { if (alive) setWhyByKey((m) => ({ ...m, [a.key]: { loading: false, text } })) })
      .catch(() => { if (alive) setWhyByKey((m) => ({ ...m, [a.key]: { loading: false, text: null } })) })
    return () => { alive = false }
  }, [selectedKey, chatOpen, language, axes])

  // Sparkline geometry (small, drawn in its own viewBox).
  const spark = useMemo(() => {
    if (focusSeries.length < 2) return null
    const w = 168
    const h = 46
    const min = Math.min(...focusSeries)
    const max = Math.max(...focusSeries)
    const span = Math.max(1, max - min)
    const pts = focusSeries.map((v, i) => {
      const x = (i / (focusSeries.length - 1)) * w
      const y = h - ((v - min) / span) * h
      return { x, y }
    })
    return { w, h, pts, last: pts[pts.length - 1] }
  }, [focusSeries])

  return (
    <div className={`amap${dir === 'rtl' ? ' amap--rtl' : ''}`} dir={dir}>
      <div className="amap__body">
        {/* LEFT — front-facing radar with emblems on the outer vertices. */}
        <div className={`amap__stage${selected ? ' is-focused' : ''}`}>
          {!selected && hasBaseline && changedAxes.length > 0 && (
            <div className="amap__legend">
              <span className="amap__legend-title">{t('actmap.change.legendTitle')}</span>
              <span className="amap__legend-row">
                <span className="amap__legend-dot amap__legend-dot--now" aria-hidden="true" />
                {t('actmap.change.legendNow')}
              </span>
              <span className="amap__legend-row">
                <span className="amap__legend-ghost" aria-hidden="true" />
                {t('actmap.change.legendWas')}
              </span>
            </div>
          )}
          <div className="amap__radar">
            <div className="amap__board" ref={boardRef}>
              <svg className="amap__svg" viewBox={`0 0 ${S} ${S}`} aria-hidden="true">
                <defs>
                  <radialGradient id="amap-fill" cx="50%" cy="50%" r="60%">
                    <stop offset="0%" stopColor="rgba(150,130,255,.5)" />
                    <stop offset="72%" stopColor="rgba(96,120,240,.3)" />
                    <stop offset="100%" stopColor="rgba(60,180,220,.16)" />
                  </radialGradient>
                  {/* Arrowheads on the change trace (green up / red down), pointing to the current dot. */}
                  <marker id="amap-arrow-up" viewBox="0 0 10 10" refX="7.5" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                    <path d="M1,1 L9,5 L1,9" fill="none" stroke="#2ec77e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </marker>
                  <marker id="amap-arrow-down" viewBox="0 0 10 10" refX="7.5" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                    <path d="M1,1 L9,5 L1,9" fill="none" stroke="#ff5a5a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </marker>
                </defs>
                {rings.map((pts, g) => (
                  <polygon key={g} className="amap__ring" points={pts} />
                ))}
                {axes.map((a) => (
                  <line
                    key={a.key}
                    className={`amap__spoke${selectedKey === a.key ? ' is-focus' : ''}`}
                    x1={C}
                    y1={C}
                    x2={a.ex}
                    y2={a.ey}
                  />
                ))}
                <g className="amap__data-g" ref={dataRef} style={{ transformOrigin: `${C}px ${C}px`, transformBox: 'view-box' } as CSSProperties}>
                  <polygon className="amap__data" ref={dataPolyRef} points={dataPoly} fill="url(#amap-fill)" />
                  {axes.map((a) => (
                    <circle key={a.key} className="amap__dot" data-key={a.key} cx={a.vx} cy={a.vy} r={5} style={{ '--c': visualFor(a.key).color } as CSSProperties} />
                  ))}
                </g>

                {/* Change layer — ghost of the old position + yellow trace to the new. */}
                {hasBaseline && changedAxes.map((a) => {
                  // End the trace short of the current dot so the arrowhead
                  // doesn't sit on top of it.
                  const dx = a.vx - a.ovx, dy = a.vy - a.ovy
                  const d = Math.hypot(dx, dy) || 1
                  const gap = Math.min(TRACE_GAP, d * 0.34)
                  const tEnd = (d - gap) / d
                  return (
                    <g key={`ch-${a.key}`} className="amap__change">
                      <circle className="amap__ghost" cx={a.ovx} cy={a.ovy} r={4.4} />
                      <line className={`amap__trace amap__trace--${a.dir}`} data-key={a.key} x1={a.ovx} y1={a.ovy} x2={a.ovx + dx * tEnd} y2={a.ovy + dy * tEnd} markerEnd={`url(#amap-arrow-${a.dir})`} />
                    </g>
                  )
                })}
              </svg>

              {/* Emblems ON the outer vertices. */}
              {axes.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  className={`amap__emblem amap__emblem--${a.tone}${selectedKey === a.key ? ' is-active' : ''}${selected && selectedKey !== a.key ? ' is-dim' : ''}`}
                  style={{ left: `${pct(a.ex)}%`, top: `${pct(a.ey)}%`, '--c': visualFor(a.key).color } as CSSProperties}
                  onClick={() => selectDomain(a.key)}
                  aria-label={`${a.label} — ${t(`actmap.status.${a.tone}`)}`}
                >
                  <span className="amap__emblem-inner">
                    <span className="amap__emblem-dome"><Icon name={visualFor(a.key).icon} size={22} /></span>
                  </span>
                </button>
              ))}

              {/* Domain names just outside each vertex. */}
              {axes.map((a) => (
                <span
                  key={a.key}
                  className={`amap__label${selected && selectedKey !== a.key ? ' is-dim' : ''}`}
                  style={{ left: `${pct(a.lx)}%`, top: `${pct(a.ly)}%` }}
                  dir="auto"
                >
                  {a.label}
                </span>
              ))}
            </div>
          </div>

          {/* Concentrated view of the focused area: its recent trend. */}
          {selected && (
            <div className="amap__mini-history" style={{ '--c': visualFor(selected.key).color } as CSSProperties}>
              <div className="amap__mini-head">
                <span className="amap__mini-emblem"><Icon name={visualFor(selected.key).icon} size={15} /></span>
                <strong dir="auto">{selected.label}</strong>
              </div>
              {spark ? (
                <>
                  <svg className="amap__spark" viewBox={`0 0 ${spark.w} ${spark.h}`} preserveAspectRatio="none" aria-hidden="true">
                    <polyline className="amap__spark-line" points={spark.pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} />
                    <circle className="amap__spark-dot" cx={spark.last.x} cy={spark.last.y} r={3.4} />
                  </svg>
                  <span className="amap__mini-caption">{t('actmap.change.history')}</span>
                </>
              ) : (
                <span className="amap__mini-caption amap__mini-caption--empty">{t('actmap.change.noHistory')}</span>
              )}
            </div>
          )}
        </div>

        {/* RIGHT — explanation / how-to-improve / Yuvi chat. */}
        <aside className="amap__panel" onMouseMove={onPanelMove}>
          <span className="amap__panel-spot" aria-hidden="true" />

          {!selected ? (
            <div className="amap__overview">
              <div className="amap__phead">
                <button type="button" className="amap__back" onClick={onClose} aria-label={t('actmap.back')}>
                  <Icon name="arrow" size={18} />
                </button>
                <h3 className="amap__panel-title amap__panel-title--overview">{t('actmap.title')}</h3>
              </div>
              <p className="amap__overview-text" dir="auto">{t('actmap.map.overview')}</p>
              <div className="amap__overview-stats">
                <div className="amap__ovstat amap__ovstat--good">
                  <Icon name="check" size={16} />
                  <strong>{doingWell}</strong>
                  <span>{t('sdash.learningMap.good.title')}</span>
                </div>
                <div className="amap__ovstat amap__ovstat--reinforce">
                  <Icon name="target" size={16} />
                  <strong>{needsReinforce}</strong>
                  <span>{t('sdash.learningMap.reinforce.title')}</span>
                </div>
              </div>
              {/* Per-domain level list (visual pips, no numbers) — tap a row to open it. */}
              <ul className="amap__dlist">
                {axes.map((a) => {
                  const filled = Math.max(1, Math.round(a.level * PIPS))
                  return (
                    <li key={a.key}>
                      <button
                        type="button"
                        className={`amap__drow amap__drow--${a.tone}${a.changed ? ' is-changed' : ''}`}
                        style={{ '--c': visualFor(a.key).color } as CSSProperties}
                        onClick={() => selectDomain(a.key)}
                      >
                        <span className="amap__drow-mark"><Icon name={visualFor(a.key).icon} size={16} /></span>
                        <span className="amap__drow-main">
                          <span className="amap__drow-name" dir="auto">{a.label}</span>
                          {a.changed && (
                            <span className={`amap__change-chip amap__change-chip--${a.dir}`} aria-label={t(`actmap.change.${a.dir}`)}>
                              <TrendIcon dir={a.dir} size={13} />
                            </span>
                          )}
                        </span>
                        <span className="amap__drow-bar" aria-hidden="true">
                          {Array.from({ length: PIPS }, (_, i) => (
                            <span key={i} className={`amap__pip${i < filled ? ' is-on' : ''}`} />
                          ))}
                        </span>
                        <span className="amap__drow-go"><Icon name="chevronLeft" size={15} /></span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : chatOpen ? (
            <div className="amap__chatwrap">
              <button type="button" className="amap__chat-back" onClick={() => setChatOpen(false)}>
                <Icon name="arrow" size={16} />
                <span>{t('actmap.map.backToTips')}</span>
              </button>
              <div className="amap__chat-head" style={{ '--c': visualFor(selected.key).color } as CSSProperties}>
                <span className="amap__chat-emblem"><Icon name={visualFor(selected.key).icon} size={18} /></span>
                <strong dir="auto">{selected.label}</strong>
              </div>
              <CompetencyChat
                competencyKey={selected.key}
                greeting={t(`sdash.lmap.chat.greeting.${sideFor(selected.tone)}`, { topic: selected.label })}
                ephemeralNote={t('sdash.lmap.chat.ephemeral')}
                className="cchat--dark"
              />
            </div>
          ) : (
            <div className="amap__detail" style={{ '--c': visualFor(selected.key).color } as CSSProperties}>
              <div className="amap__detail-head">
                <button type="button" className="amap__back" onClick={() => setSelectedKey(null)} aria-label={t('actmap.map.backToTips')}>
                  <Icon name="arrow" size={18} />
                </button>
                <span className="amap__detail-emblem"><Icon name={visualFor(selected.key).icon} size={24} /></span>
                <div>
                  <h3 className="amap__panel-title" dir="auto">{selected.label}</h3>
                  <span className={`amap__chip amap__chip--${selected.tone}`}>{t(`actmap.status.${selected.tone}`)}</span>
                </div>
              </div>

              {selected.changed && (
                <div className={`amap__whatchanged amap__whatchanged--${selected.dir}`}>
                  <div className="amap__wc-head">
                    <span className={`amap__change-chip amap__change-chip--${selected.dir}`} aria-label={t(`actmap.change.${selected.dir}`)}>
                      <TrendIcon dir={selected.dir} size={13} />
                    </span>
                    <strong>{t('actmap.change.title')}</strong>
                  </div>
                  {whyByKey[selected.key]?.loading ? (
                    <p className="amap__wc-blurb amap__wc-blurb--loading"><span className="amap__wc-shimmer" /><span className="amap__wc-shimmer" /></p>
                  ) : whyByKey[selected.key]?.text ? (
                    <p className="amap__wc-blurb" dir="auto">{whyByKey[selected.key]?.text}</p>
                  ) : (
                    <p className="amap__wc-blurb" dir="auto">{t('actmap.change.fallback')}</p>
                  )}
                </div>
              )}

              <p className="amap__detail-meaning" dir="auto">{t(`sdash.lmap.d.${selected.key}.meaning`)}</p>

              <div className="amap__improve">
                <h4>{t('actmap.map.improveTitle')}</h4>
                <ul>
                  {/* State-aware tips from live signals; fall back to the static
                      per-domain tips when there's no activity evidence yet. */}
                  {(selected.improve && selected.improve.length
                    ? selected.improve.slice(0, 2).map((cause) => t(`actmap.improve.${cause}`))
                    : [t(`sdash.lmap.d.${selected.key}.tip1`), t(`sdash.lmap.d.${selected.key}.tip2`)]
                  ).map((tip, i) => (
                    <li key={i}><span className="amap__improve-mark" aria-hidden="true"><Icon name="spark" size={13} /></span><span dir="auto">{tip}</span></li>
                  ))}
                  <li><span className="amap__improve-mark amap__improve-mark--next" aria-hidden="true"><Icon name="arrow" size={13} /></span><span dir="auto">{t(`sdash.lmap.d.${selected.key}.next`)}</span></li>
                </ul>
              </div>

              <button type="button" className="amap__talk" onClick={() => setChatOpen(true)}>
                <Icon name="message" size={16} />
                <span>{t('sdash.lmap.d.talk')}</span>
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
