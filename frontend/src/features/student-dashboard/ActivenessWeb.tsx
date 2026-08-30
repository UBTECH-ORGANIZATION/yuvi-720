import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { animate, stagger, svg } from 'animejs'
import { Icon } from '../../components/primitives'
import { useCompanion } from '../../providers/CompanionProvider'
import { useI18n } from '../../i18n/I18nProvider'
import { useMediaQuery } from '../../hooks/useResponsive'
import { getLearnerState, updateLearnerState } from '../../services/api'
import type { DashboardDTO } from '../../services/brain'
import './activeness-web.css'

type Competency = DashboardDTO['competencies'][number]
type HistorySnapshot = { at: string; positions: Record<string, number> }
type MapState = {
    positions?: Record<string, number>
    focus?: string | null
    history?: HistorySnapshot[]
}

interface ActivenessWebProps {
    competencies: Competency[]
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

const S = 440 // drawing space only — the rendered size comes from the CSS board
const C = S / 2
const MAXR = S * 0.34 // outer ring radius — emblems sit on these vertices
// Emblems and labels are DOM elements sized in `cqw`, so their footprint is a
// fixed share of the board. A label has to clear the dome it belongs to, and a
// label box is far wider than it is tall — so the near-horizontal axes need more
// room than the vertical ones. Without this, side labels land on their icons.
const LABEL_OUT_V = 44
const LABEL_OUT_H = 66
const labelOutFor = (ang: number) => LABEL_OUT_V + (LABEL_OUT_H - LABEL_OUT_V) * Math.abs(Math.cos(ang))
const LEVELS = 10 // web layers — finer rings make a small move readable as a move
const CHANGE_THRESHOLD = 4 // points of movement that count as a real change
const MAJOR_CHANGE = 10 // at/above this a change is drawn as a major one
const WINDOW_DAYS = 7 // "what changed" compares against ~this many days ago (rolling)
const DAY_MS = 86400000
const APPEND_GAP_MS = 20 * 60 * 60 * 1000 // ≈one history point per day
const BASELINE_WAIT_MS = 1200 // how long the intro waits for the stored baseline
const HISTORY_DEPTH = 24

// Every cause tag `app/brain/activeness.py` can emit. `t()` falls back to the raw
// key, so an unlisted tag would put `actmap.why.<tag>` on a child's screen.
const DRIVER_TAGS = new Set([
    'inconsistent', 'low_engagement', 'quits_on_fail', 'hint_reliance',
    'guessing', 'low_reflection', 'isolation',
])

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clampLevel = (v: number) => Math.max(0.08, Math.min(1, v / 100))
const polyPoints = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
const pct = (v: number) => (v / S) * 100

function TrendIcon({ dir }: { dir: 'up' | 'down' }) {
    return (
        <svg className="aweb__trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
    ovx: number // previous-visit data vertex (for the morph / trace start)
    ovy: number
    dir: 'up' | 'down'
    size: 'minor' | 'major'
    changed: boolean
}

/**
 * Activeness web (720 F4) — the learner's six activeness competencies as a
 * radar "level shape" in the dashboard hero. The shape reaches out along each
 * axis as far as that competency currently stands, and on load it morphs from
 * where the learner was about a week ago, tracing the movement with a green
 * (up) or red (down) arrow.
 *
 * Every value is projected from the brain (`GET /api/brain/{id}/dashboard`);
 * nothing here is generated. No numbers are shown to the learner.
 */
export function ActivenessWeb({ competencies }: ActivenessWebProps) {
    const { t } = useI18n()
    const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
    const { open: openCompanion, send: askCompanion } = useCompanion()

    const boardRef = useRef<HTMLDivElement>(null)
    const dataRef = useRef<SVGGElement>(null)
    const dataPolyRef = useRef<SVGPolygonElement>(null)
    const played = useRef(false)
    const persisted = useRef(false)
    const morphRaf = useRef(0)

    // `undefined` = still loading; `null` = no map state stored yet.
    const [stored, setStored] = useState<MapState | null | undefined>(undefined)
    // The intro waits for the baseline so the morph has somewhere to start, but it
    // must never wait forever: a stalled request would leave the card blank.
    const [baselineTimedOut, setBaselineTimedOut] = useState(false)

    useEffect(() => {
        let alive = true
        getLearnerState()
            .then((state) => { if (alive) setStored((state.activeness_map as MapState) ?? null) })
            .catch(() => { if (alive) setStored(null) })
        const timer = window.setTimeout(() => { if (alive) setBaselineTimedOut(true) }, BASELINE_WAIT_MS)
        return () => { alive = false; window.clearTimeout(timer) }
    }, [])

    // Rolling baseline: compare against the snapshot from ~WINDOW_DAYS ago (the
    // newest one at least that old), so a week's movement keeps showing across
    // visits. Before a full week of history exists, use the earliest snapshot so
    // movement still accumulates. Falls back to a bare `positions` blob (legacy).
    const nowMs = useMemo(() => Date.now(), [])
    const baseline = useMemo<Record<string, number> | null>(() => {
        if (!stored) return null
        const hist = stored.history ?? []
        if (hist.length) {
            const cutoff = nowMs - WINDOW_DAYS * DAY_MS
            const older = hist.filter((h) => Date.parse(h.at) <= cutoff)
            const ref = older.length ? older[older.length - 1] : hist[0]
            return ref.positions ?? null
        }
        return stored.positions ?? null
    }, [stored, nowMs])

    const axes = useMemo<Axis[]>(() => {
        const list = competencies.slice(0, 6)
        const n = list.length || 1
        return list.map((c, i) => {
            const ang = (-90 + (i * 360) / n) * (Math.PI / 180)
            const level = clampLevel(Number(c.value) || 0)
            // The server's own week-ago score wins over the stored snapshot: it
            // comes from the same engine as `drivers`, so an arrow drawn from it
            // always has a reason to show. The snapshot stays as the fallback
            // for a brain with no live signal yet, and still drives the morph.
            const rawLast = typeof c.priorValue === 'number' ? c.priorValue : baseline?.[c.key]
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
                ovx: C + Math.cos(ang) * oldLevel * MAXR,
                ovy: C + Math.sin(ang) * oldLevel * MAXR,
                dir: delta >= 0 ? 'up' : 'down',
                size: Math.abs(delta) >= MAJOR_CHANGE ? 'major' : 'minor',
                // A change only counts when it's backed by real activity, so the arrow
                // can never animate on seeded history the brain cannot explain.
                changed: (c.evidenceBacked ?? false) && last != null && Math.abs(delta) >= CHANGE_THRESHOLD,
            }
        })
    }, [competencies, baseline])

    const hasBaseline = axes.some((a) => a.last != null)
    const changedAxes = axes.filter((a) => a.changed)

    // The dip goes to the everyday companion, phrased as the learner's own
    // question. When we know which lesson drove it, the question says so —
    // otherwise Yuvi answers with generic hypotheses instead of their week.
    const askYuvi = (a: Axis) => {
        const lesson = driverFor(a)?.lesson
        openCompanion()
        const text = lesson
            ? t('actmap.ask.questionInLesson', { topic: a.label, lesson })
            : t('actmap.ask.question', { topic: a.label })
        void askCompanion(text).catch(() => undefined)
    }

    // Why the domain moved, named as something the learner actually did. Only a
    // driver pushing the same way as the movement can explain it — anything else
    // would pair "you finished what you started" with a dip.
    const driverFor = (a: Axis) =>
        (a.drivers ?? []).find((d) => d.dir === a.dir && DRIVER_TAGS.has(d.tag)) ?? null
    const whyFor = (a: Axis) => {
        const driver = driverFor(a)
        return driver ? t(`actmap.why.${driver.tag}.${driver.dir}`) : t('actmap.change.fallback')
    }

    // The single domain worth focusing on now — the lowest level (unless a domain
    // is already declining, which takes priority). Exactly one domain is promoted
    // so the eye lands on it immediately; the rest stay calm.
    const focusKey = useMemo<string | null>(() => {
        if (!axes.length) return null
        const declining = axes.filter((a) => a.changed && a.dir === 'down')
        const pool = declining.length ? declining : axes
        return pool.reduce((a, b) => (b.level < a.level ? b : a), pool[0]).key
    }, [axes])

    const rings = useMemo(
        () =>
            Array.from({ length: LEVELS }, (_, g) =>
                polyPoints(axes.map((a) => ({ x: C + Math.cos(a.ang) * ((g + 1) / LEVELS) * MAXR, y: C + Math.sin(a.ang) * ((g + 1) / LEVELS) * MAXR }))),
            ),
        [axes],
    )
    const dataPoly = useMemo(() => polyPoints(axes.map((a) => ({ x: a.vx, y: a.vy }))), [axes])
    const oldPoly = useMemo(() => polyPoints(axes.map((a) => ({ x: a.ovx, y: a.ovy }))), [axes])

    // Record this visit into the rolling history (≈one point per day) so the next
    // visit has something to morph from. Never resets the baseline: a new point is
    // appended only when the newest one is stale enough.
    useEffect(() => {
        if (stored === undefined || persisted.current || !competencies.length) return
        persisted.current = true
        const prior = stored?.history ?? []
        const lastAt = prior.length ? Date.parse(prior[prior.length - 1].at) : 0
        if (Date.now() - lastAt < APPEND_GAP_MS) return
        const positions: Record<string, number> = {}
        competencies.slice(0, 6).forEach((c) => { positions[c.key] = Math.round(Number(c.value) || 0) })
        const history = [...prior, { at: new Date().toISOString(), positions }].slice(-HISTORY_DEPTH)
        // Spread what is already stored: this write owns the snapshot + history only,
        // and must not drop the learner's focus, goal or onboarding flag.
        void updateLearnerState({
            activeness_map: { ...(stored ?? {}), positions, focus: stored?.focus ?? null, history },
        }).catch(() => undefined)
    }, [stored, competencies])

    // Hide the animated elements from the very first paint so they never flash at
    // full opacity and then get reset to 0 when the intro starts.
    useLayoutEffect(() => {
        if (reduceMotion) return
        boardRef.current
            ?.querySelectorAll<HTMLElement>('.aweb__emblem-inner, .aweb__label, .aweb__data-g')
            .forEach((el) => { el.style.opacity = '0' })
    }, [reduceMotion])

    // ── Intro + change animation ────────────────────────────────────────────────
    // Waits for the stored map state so the morph has its baseline to start from.
    useEffect(() => {
        if (stored === undefined && !baselineTimedOut) return
        if (played.current) return
        played.current = true
        const board = boardRef.current
        const dataG = dataRef.current

        if (reduceMotion) {
            if (dataG) dataG.style.transform = 'scale(1)'
            board?.querySelectorAll<HTMLElement>('.aweb__emblem-inner, .aweb__label, .aweb__data-g').forEach((el) => {
                el.style.opacity = '1'
                if (el.classList.contains('aweb__emblem-inner')) el.style.transform = 'scale(1)'
            })
            return
        }
        if (!board) return

        const ringEls = board.querySelectorAll<SVGPolygonElement>('.aweb__ring')
        if (ringEls.length) animate(svg.createDrawable(ringEls), { draw: ['0 0', '0 1'], duration: 820, delay: stagger(70), ease: 'inOutSine' })
        const inners = board.querySelectorAll<HTMLElement>('.aweb__emblem-inner')
        if (inners.length) animate(inners, { scale: [0, 1], opacity: [0, 1], duration: 640, delay: stagger(90, { start: 340 }), ease: 'outBack' })
        const labels = board.querySelectorAll<HTMLElement>('.aweb__label')
        if (labels.length) animate(labels, { opacity: [0, 1], duration: 560, delay: stagger(70, { start: 440 }), ease: 'outQuad' })

        if (!hasBaseline) {
            // First-ever visit — no deltas, just bloom the shape from the centre.
            if (dataG) animate(dataG, { scale: [0, 1], opacity: [0, 1], duration: 780, ease: 'outBack' })
            return
        }

        // Returning visit — morph the shape from its last-seen form to the current
        // one, sliding each dot out of its ghost so the movement is legible.
        if (dataG) { dataG.style.transform = 'scale(1)'; animate(dataG, { opacity: [0, 1], duration: 420, ease: 'outQuad' }) }
        const dots = Array.from(board.querySelectorAll<SVGCircleElement>('.aweb__dot'))
        const poly = dataPolyRef.current

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
    }, [stored, baselineTimedOut, reduceMotion])

    useEffect(() => () => cancelAnimationFrame(morphRaf.current), [])

    if (!axes.length) return null

    return (
        <figure className="aweb">
            <figcaption className="aweb__head">
                <h2 className="aweb__title">{t('actmap.title')}</h2>
                <p className="aweb__subtitle" dir="auto">{t('actmap.subtitle')}</p>
            </figcaption>

            <div className="aweb__stage">
                <div className="aweb__board" ref={boardRef}>
                    <svg className="aweb__svg" viewBox={`0 0 ${S} ${S}`} aria-hidden="true">
                        <defs>
                            <radialGradient id="aweb-fill" cx="50%" cy="50%" r="60%">
                                <stop className="aweb__fill-in" offset="0%" />
                                <stop className="aweb__fill-mid" offset="72%" />
                                <stop className="aweb__fill-out" offset="100%" />
                            </radialGradient>
                        </defs>

                        {rings.map((pts, g) => (
                            <polygon key={g} className="aweb__ring" points={pts} />
                        ))}
                        {axes.map((a) => (
                            <line
                                key={a.key}
                                className={`aweb__spoke${a.key === focusKey ? ' is-focus' : ''}`}
                                x1={C}
                                y1={C}
                                x2={a.ex}
                                y2={a.ey}
                            />
                        ))}

                        <g className="aweb__data-g" ref={dataRef} style={{ transformOrigin: `${C}px ${C}px`, transformBox: 'view-box' } as CSSProperties}>
                            <polygon className="aweb__data" ref={dataPolyRef} points={dataPoly} fill="url(#aweb-fill)" />
                            {axes.map((a) => (
                                <circle
                                    key={a.key}
                                    className={`aweb__dot${a.key === focusKey ? ' is-focus' : ''}${a.changed ? ` is-changed is-changed--${a.dir} is-changed--${a.size}` : ''}`}
                                    data-key={a.key}
                                    cx={a.vx}
                                    cy={a.vy}
                                    r={a.changed ? (a.size === 'major' ? 8 : 6.4) : a.key === focusKey ? 5.6 : 5}
                                    style={{ '--c': visualFor(a.key).color } as CSSProperties}
                                />
                            ))}
                        </g>

                    </svg>

                    {/* Emblems ON the outer vertices. */}
                    {axes.map((a) => (
                        <span
                            key={a.key}
                            className={`aweb__emblem aweb__emblem--${a.tone}${a.key === focusKey ? ' is-focus' : ''}`}
                            style={{ left: `${pct(a.ex)}%`, top: `${pct(a.ey)}%`, '--c': visualFor(a.key).color } as CSSProperties}
                            aria-hidden="true"
                        >
                            <span className="aweb__emblem-inner">
                                <span className="aweb__emblem-dome">
                                    <Icon name={visualFor(a.key).icon} size={14} />
                                    {a.changed && (
                                        <span className={`aweb__trend-badge aweb__trend-badge--${a.dir} aweb__trend-badge--${a.size}`}>
                                            <TrendIcon dir={a.dir} />
                                        </span>
                                    )}
                                </span>
                            </span>
                        </span>
                    ))}

                    {/* Domain names just outside each vertex — the backend's own labels. */}
                    {axes.map((a) => (
                        <span
                            key={a.key}
                            className={`aweb__label${a.key === focusKey ? ' is-focus' : ''}`}
                            style={{ left: `${pct(a.lx)}%`, top: `${pct(a.ly)}%`, '--c': visualFor(a.key).color } as CSSProperties}
                            dir="auto"
                        >
                            {a.label}
                            <span className="aweb__sr">
                                {` — ${a.key === focusKey ? t('sdash.lmap.d.focusNow') : t(`actmap.status.${a.tone}`)}`}
                                {a.changed ? `, ${t(`actmap.change.${a.dir}`)} — ${t(`actmap.change.${a.size}`)}` : ''}
                            </span>
                        </span>
                    ))}

                    {/* Why a domain moved, on hover or focus. It hangs off the emblem
                        — the dot is small and lives in an aria-hidden SVG, so the
                        affordance is a real button over the icon out here. */}
                    {changedAxes.map((a) => {
                        const moved = t(`actmap.change.moved.${a.dir}.${a.size}`)
                        const why = whyFor(a)
                        const lesson = driverFor(a)?.lesson
                        return (
                            <div
                                key={a.key}
                                className={`aweb__probe${a.key === focusKey ? ' is-focus' : ''}${a.ey < C ? ' is-below' : ''}`}
                                style={{
                                    left: `${pct(a.ex)}%`,
                                    top: `${pct(a.ey)}%`,
                                    '--c': visualFor(a.key).color,
                                    // Lean the bubble back towards the middle of the board so a
                                    // side domain's tooltip cannot hang off the card.
                                    '--aweb-tip-bias': `${(-50 - Math.cos(a.ang) * 22).toFixed(0)}%`,
                                } as CSSProperties}
                            >
                                <button
                                    type="button"
                                    className="aweb__probe-hit"
                                    aria-label={`${a.label} — ${moved}. ${why}${lesson ? ` ${t('actmap.why.inLesson', { lesson })}` : ''}`}
                                />
                                <span className="aweb__tip">
                                    <span className="aweb__tip-text" aria-hidden="true">
                                        <span className="aweb__tip-title" dir="auto">{a.label}</span>
                                        <span className="aweb__tip-move" dir="auto">{moved}</span>
                                        <span className="aweb__tip-why" dir="auto">{why}</span>
                                        {/* The lesson it came from, when the signal is lesson-shaped
                                            — "showing up regularly" belongs to no single lesson. */}
                                        {lesson && (
                                            <span className="aweb__tip-lesson" dir="auto">
                                                {t('actmap.why.inLesson', { lesson })}
                                            </span>
                                        )}
                                    </span>
                                    {/* Only on the way down: a dip is the moment a kid deserves
                                        more than one line, and Yuvi can walk through it. */}
                                    {a.dir === 'down' && (
                                        <button
                                            type="button"
                                            className="aweb__tip-ask"
                                            onClick={() => askYuvi(a)}
                                        >
                                            <Icon name="message" size={13} />
                                            <span>{t('actmap.ask.cta')}</span>
                                        </button>
                                    )}
                                </span>
                            </div>
                        )
                    })}
                </div>
            </div>

            {hasBaseline && changedAxes.length > 0 && (
                <p className="aweb__legend">
                    <span className="aweb__legend-count">{t('actmap.change.sinceLast', { count: changedAxes.length })}</span>
                    <span className="aweb__legend-key">{t('actmap.change.legendDot')}</span>
                </p>
            )}
        </figure>
    )
}
