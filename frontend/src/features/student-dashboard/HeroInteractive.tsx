import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'

/**
 * Interactive hero visual — a playable inline SVG that fills the whole visual
 * column (no framed card, no baked-in background) and lets the kid poke at the
 * actual topic of the next task: drag an angle arm, assemble a fraction, or
 * fly a comet on the generic scene. Numbers shown are instructional content
 * (degrees, fraction parts) — never grades.
 */

type SceneKind = 'angle' | 'fraction' | 'orbit'

export function heroSceneFor(title: string | null | undefined): SceneKind {
  const text = (title || '').toLowerCase()
  if (/זווית|זוויות|angle|زاوي/.test(text)) return 'angle'
  if (/שבר|שברים|fraction|كسر|كسور/.test(text)) return 'fraction'
  return 'orbit'
}

interface HeroInteractiveProps {
  title: string | null | undefined
}

export function HeroInteractive({ title }: HeroInteractiveProps) {
  const scene = useMemo(() => heroSceneFor(title), [title])
  if (scene === 'angle') return <AngleScene />
  if (scene === 'fraction') return <FractionScene />
  return <OrbitScene />
}

/* ── Shared: pointer → svg viewBox coordinates ─────────────────────────── */
function svgPoint(svg: SVGSVGElement, clientX: number, clientY: number) {
  const point = svg.createSVGPoint()
  point.x = clientX
  point.y = clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const mapped = point.matrixTransform(ctm.inverse())
  return { x: mapped.x, y: mapped.y }
}

/* ── Angle playground: drag the arm, watch the angle type change ───────── */
const ANGLE_COLORS: Record<string, string> = {
  acute: '#4cc9f0',
  right: '#25b984',
  obtuse: '#eaa32e',
  straight: '#9f7afe',
}

function angleKind(deg: number): keyof typeof ANGLE_COLORS {
  if (deg >= 178) return 'straight'
  if (Math.abs(deg - 90) <= 3) return 'right'
  if (deg < 90) return 'acute'
  return 'obtuse'
}

function AngleScene() {
  const { t } = useI18n()
  const svgRef = useRef<SVGSVGElement>(null)
  const [deg, setDeg] = useState(52)
  const dragging = useRef(false)

  /* Vertex centered and arm sized so the handle stays inside the viewBox for
     the whole 4°-180° range (tip_y ≥ 26 at 90°, tip_x ≥ 24 at 180°). */
  const cx = 200
  const cy = 212
  const armLength = 168
  const rad = (deg * Math.PI) / 180
  const armX = cx + armLength * Math.cos(rad)
  const armY = cy - armLength * Math.sin(rad)
  const kind = angleKind(deg)
  const color = ANGLE_COLORS[kind]

  const arcRadius = 56
  const arcX = cx + arcRadius * Math.cos(rad)
  const arcY = cy - arcRadius * Math.sin(rad)
  const largeArc = deg > 180 ? 1 : 0

  const updateFromPointer = (event: ReactPointerEvent) => {
    const svg = svgRef.current
    if (!svg) return
    const { x, y } = svgPoint(svg, event.clientX, event.clientY)
    const next = (Math.atan2(cy - y, x - cx) * 180) / Math.PI
    setDeg(Math.min(180, Math.max(4, Math.round(next))))
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      setDeg((d) => Math.min(180, d + 2))
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      setDeg((d) => Math.max(4, d - 2))
    }
  }

  return (
    <div className="sd-hero-viz" data-scene="angle">
      <svg
        ref={svgRef}
        viewBox="0 0 400 296"
        role="application"
        aria-label={t('sdash.viz.angle.aria')}
        onPointerMove={(e) => dragging.current && updateFromPointer(e)}
        onPointerUp={() => { dragging.current = false }}
        onPointerLeave={() => { dragging.current = false }}
      >
        <defs>
          <linearGradient id="sd-viz-arm" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={color} />
            <stop offset="1" stopColor="#6f5bff" />
          </linearGradient>
        </defs>

        {/* soft floor grid — kept minimal so the angle stays the focus */}
        {[1, 2].map((i) => (
          <line key={i} x1={20} y1={68 + i * 47} x2={380} y2={68 + i * 47} className="sd-viz-grid" />
        ))}

        {/* angle fill wedge */}
        <path
          d={`M ${cx} ${cy} L ${cx + arcRadius + 26} ${cy} A ${arcRadius + 26} ${arcRadius + 26} 0 ${largeArc} 0 ${cx + (arcRadius + 26) * Math.cos(rad)} ${cy - (arcRadius + 26) * Math.sin(rad)} Z`}
          fill={color}
          opacity="0.14"
        />
        {/* arc */}
        <path
          d={`M ${cx + arcRadius} ${cy} A ${arcRadius} ${arcRadius} 0 ${largeArc} 0 ${arcX} ${arcY}`}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
        />
        {/* right-angle marker */}
        {kind === 'right' && (
          <path
            d={`M ${cx + 30} ${cy} L ${cx + 30} ${cy - 30} L ${cx} ${cy - 30}`}
            fill="none"
            stroke={color}
            strokeWidth="3.5"
          />
        )}

        {/* fixed base ray */}
        <line x1={cx} y1={cy} x2={cx + armLength} y2={cy} className="sd-viz-ray" />
        {/* movable arm */}
        <line x1={cx} y1={cy} x2={armX} y2={armY} stroke="url(#sd-viz-arm)" strokeWidth="7" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="9" className="sd-viz-vertex" />

        {/* drag handle */}
        <g
          className="sd-viz-handle"
          tabIndex={0}
          role="slider"
          aria-label={t('sdash.viz.angle.handle')}
          aria-valuemin={4}
          aria-valuemax={180}
          aria-valuenow={deg}
          onPointerDown={(e) => {
            dragging.current = true
            e.currentTarget.setPointerCapture?.(e.pointerId)
            updateFromPointer(e)
          }}
          onKeyDown={onKeyDown}
        >
          <circle cx={armX} cy={armY} r="22" fill="transparent" />
          <circle cx={armX} cy={armY} r="12" fill={color} className="sd-viz-handle__dot" />
          <circle cx={armX} cy={armY} r="12" fill="none" stroke="#fff" strokeWidth="2.5" opacity="0.85" />
        </g>

        {/* live readout — in the free band below the base ray, where the arm
            can never travel (deg is clamped ≥ 4°), so it never blocks the drag */}
        <g className="sd-viz-readout" transform={`translate(${cx}, 262)`}>
          <text className="sd-viz-readout__value" textAnchor="middle">{deg}°</text>
          <text className="sd-viz-readout__label" textAnchor="middle" y="20" fill={color}>
            {t(`sdash.viz.angle.${kind}`)}
          </text>
        </g>
      </svg>
      <p className="sd-hero-viz__hint"><Icon name="click" size={15} />{t('sdash.viz.angle.hint')}</p>
    </div>
  )
}

/* ── Fraction playground: light up slices, read the fraction ───────────── */
function FractionScene() {
  const { t } = useI18n()
  const total = 8
  const [selected, setSelected] = useState<boolean[]>(() => {
    const initial = new Array(total).fill(false)
    initial[0] = true
    initial[1] = true
    initial[2] = true
    return initial
  })
  const count = selected.filter(Boolean).length

  const cx = 150
  const cy = 130
  const r = 92

  const slicePath = (index: number) => {
    const a0 = (index / total) * Math.PI * 2 - Math.PI / 2
    const a1 = ((index + 1) / total) * Math.PI * 2 - Math.PI / 2
    const x0 = cx + r * Math.cos(a0)
    const y0 = cy + r * Math.sin(a0)
    const x1 = cx + r * Math.cos(a1)
    const y1 = cy + r * Math.sin(a1)
    return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1} Z`
  }

  const toggle = (index: number) => {
    setSelected((prev) => prev.map((v, i) => (i === index ? !v : v)))
  }

  return (
    <div className="sd-hero-viz" data-scene="fraction">
      <svg viewBox="0 0 400 260" role="application" aria-label={t('sdash.viz.fraction.aria')}>
        <circle cx={cx} cy={cy} r={r + 6} className="sd-viz-plate" />
        {selected.map((on, i) => (
          <path
            key={i}
            d={slicePath(i)}
            className={`sd-viz-slice${on ? ' is-on' : ''}`}
            role="checkbox"
            aria-checked={on}
            aria-label={t('sdash.viz.fraction.slice', { index: i + 1 })}
            tabIndex={0}
            onClick={() => toggle(i)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                toggle(i)
              }
            }}
          />
        ))}
        <g className="sd-viz-readout" transform="translate(322, 96)">
          <text className="sd-viz-readout__value" textAnchor="middle">{count}</text>
          <line x1="-24" y1="12" x2="24" y2="12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <text className="sd-viz-readout__value" textAnchor="middle" y="42">{total}</text>
        </g>
      </svg>
      <p className="sd-hero-viz__hint"><Icon name="click" size={15} />{t('sdash.viz.fraction.hint')}</p>
    </div>
  )
}

/* ── Generic scene: fly the comet around the learning star ─────────────── */
function OrbitScene() {
  const { t } = useI18n()
  const svgRef = useRef<SVGSVGElement>(null)
  const [angle, setAngle] = useState(35)
  const dragging = useRef(false)

  const cx = 200
  const cy = 132
  const rx = 150
  const ry = 78
  const rad = (angle * Math.PI) / 180
  const px = cx + rx * Math.cos(rad)
  const py = cy + ry * Math.sin(rad)

  const updateFromPointer = (event: ReactPointerEvent) => {
    const svg = svgRef.current
    if (!svg) return
    const { x, y } = svgPoint(svg, event.clientX, event.clientY)
    setAngle((Math.atan2((y - cy) / ry, (x - cx) / rx) * 180) / Math.PI)
  }

  return (
    <div className="sd-hero-viz" data-scene="orbit">
      <svg
        ref={svgRef}
        viewBox="0 0 400 260"
        role="application"
        aria-label={t('sdash.viz.orbit.aria')}
        onPointerMove={(e) => dragging.current && updateFromPointer(e)}
        onPointerUp={() => { dragging.current = false }}
        onPointerLeave={() => { dragging.current = false }}
      >
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} className="sd-viz-orbit-path" />
        <ellipse cx={cx} cy={cy} rx={rx - 44} ry={ry - 26} className="sd-viz-orbit-path sd-viz-orbit-path--inner" />
        <circle cx={cx} cy={cy} r="30" className="sd-viz-star" />
        <circle cx={cx} cy={cy} r="12" className="sd-viz-star__core" />
        <g
          className="sd-viz-handle"
          tabIndex={0}
          role="slider"
          aria-label={t('sdash.viz.orbit.handle')}
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={Math.round(((angle % 360) + 360) % 360)}
          onPointerDown={(e) => {
            dragging.current = true
            e.currentTarget.setPointerCapture?.(e.pointerId)
            updateFromPointer(e)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); setAngle((a) => a - 6) }
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); setAngle((a) => a + 6) }
          }}
        >
          <circle cx={px} cy={py} r="22" fill="transparent" />
          <circle cx={px} cy={py} r="11" className="sd-viz-comet" />
          <circle cx={px} cy={py} r="11" fill="none" stroke="#fff" strokeWidth="2" opacity="0.8" />
        </g>
      </svg>
      <p className="sd-hero-viz__hint"><Icon name="click" size={15} />{t('sdash.viz.orbit.hint')}</p>
    </div>
  )
}
