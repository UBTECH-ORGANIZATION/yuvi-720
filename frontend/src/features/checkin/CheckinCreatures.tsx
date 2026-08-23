/* One hand-authored creature per valence family — inline SVG, nothing
 * generated at runtime (the yuvi-scenes rule). Each family owns a fixed
 * palette (gradient body, deeper fur strokes): a creature is a character, and
 * a character keeps its own colors. The dialog's tint panel warms or cools
 * around it.
 *
 * The SAME character acts out every word in its family — the body, palette
 * and feet never change; only the gesture does (arms, eyes, mouth, props).
 * The green one jumps for "excited" and puts hands on hips for "confident";
 * the red one clenches fists for "frustrated" and hugs itself for "lonely".
 * An unknown or missing word falls back to the family's default pose. */

import type { Valence } from './feelings'

type Palette = { light: string; dark: string; deep: string }

const PALETTES: Record<Valence, Palette> = {
  great: { light: '#8FE06E', dark: '#48B944', deep: '#2F8F3B' },
  good: { light: '#5ED4C0', dark: '#2BA893', deep: '#1E8274' },
  okay: { light: '#A5A8F0', dark: '#7376DE', deep: '#5658C0' },
  uneasy: { light: '#FBC56D', dark: '#F09A3E', deep: '#CE7A22' },
  upset: { light: '#F5867A', dark: '#E0544E', deep: '#BC3A3E' },
}

const PUPIL = '#2F2A3D'
const BLUSH = '#FF9DB0'
const TONGUE = '#FF8FA3'
const WATER = '#7EC8F5'

/* Every word gets its own idle motion — the same character moving the way
 * that feeling moves (`ck-fig--*` in checkin.css). The ground shadow stays
 * still; only the figure animates. */
const FEELING_MOTION: Record<string, string> = {
  proud: 'breathe', excited: 'hop', valued: 'sway', joyful: 'bounce', confident: 'wobble',
  calm: 'breathe', curious: 'wobble', hopeful: 'bounce', satisfied: 'sway', grateful: 'breathe',
  fine: 'breathe', tired: 'sink', bored: 'sway', indifferent: 'wobble', distracted: 'drift',
  worried: 'tremble', anxious: 'shake', confused: 'wobble', overwhelmed: 'shake', embarrassed: 'sink',
  frustrated: 'shake', angry: 'shake', sad: 'sink', lonely: 'sway', discouraged: 'sink',
}

function motionOf(feeling: string, fallback: string) {
  return FEELING_MOTION[feeling] ?? fallback
}

function Shell({ valence, motion, children }: {
  valence: Valence; motion: string; children: React.ReactNode
}) {
  const p = PALETTES[valence]
  return (
    <svg viewBox="0 0 120 110" width="150" height="138" aria-hidden="true"
         fill="none" strokeLinecap="round" strokeLinejoin="round">
      <defs>
        <linearGradient id={`ckg-${valence}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={p.light} />
          <stop offset="100%" stopColor={p.dark} />
        </linearGradient>
      </defs>
      <ellipse cx="60" cy="103" rx="27" ry="4.5" fill="rgba(15,23,42,0.14)" />
      <g className={`ck-fig ck-fig--${motion}`}>{children}</g>
    </svg>
  )
}

function Eye({ cx, cy, r = 8, px, py, pr = 4 }: {
  cx: number; cy: number; r?: number; px?: number; py?: number; pr?: number
}) {
  const pupilX = px ?? cx
  const pupilY = py ?? cy
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="#FFFFFF" />
      <circle cx={pupilX} cy={pupilY} r={pr} fill={PUPIL} />
      <circle cx={pupilX - pr * 0.4} cy={pupilY - pr * 0.4} r={pr * 0.32} fill="#FFFFFF" />
    </g>
  )
}

/* Closed content eyes — two soft ∩ arcs. */
function ClosedEyes({ y = 52 }: { y?: number }) {
  return <path stroke={PUPIL} strokeWidth="3"
               d={`M40 ${y} Q46 ${y - 6} 52 ${y} M68 ${y} Q74 ${y - 6} 80 ${y}`} />
}

/* Sleepy eyes — two ∪ arcs, lids down. */
function SleepyEyes({ y = 54 }: { y?: number }) {
  return <path stroke={PUPIL} strokeWidth="3"
               d={`M40 ${y} Q46 ${y + 5} 52 ${y} M68 ${y} Q74 ${y + 5} 80 ${y}`} />
}

function Blush({ cx, cy, big = false }: { cx: number; cy: number; big?: boolean }) {
  return <ellipse cx={cx} cy={cy} rx={big ? 8 : 5.5} ry={big ? 4.5 : 3.2}
                  fill={BLUSH} opacity={big ? 0.8 : 0.55} />
}

/* Crown fur — three tufts in the family's deep tone. */
function Tufts({ deep, y = 19 }: { deep: string; y?: number }) {
  const top = y - 12
  return (
    <g stroke={deep} strokeWidth="3">
      <path d={`M50 ${y} Q49 ${y - 8} 45 ${top + 2}`} />
      <path d={`M60 ${y - 3} Q60 ${y - 11} 57 ${top}`} />
      <path d={`M70 ${y} Q71 ${y - 8} 75 ${top + 2}`} />
    </g>
  )
}

const delayStyle = (delay?: number) =>
  delay ? { animationDelay: `${delay}s` } : undefined

function Heart({ x, y, s, delay }: { x: number; y: number; s: number; delay?: number }) {
  return (
    <path
      className="ck-p-float"
      style={delayStyle(delay)}
      d="M0 2 C -2 -1 -6 0 -4.5 3 C -3.5 5 0 7 0 7 C 0 7 3.5 5 4.5 3 C 6 0 2 -1 0 2 Z"
      transform={`translate(${x} ${y}) scale(${s})`}
      fill={TONGUE}
    />
  )
}

function Sparkle({ x, y, color, delay }: { x: number; y: number; color: string; delay?: number }) {
  return (
    <path className="ck-p-twinkle" style={delayStyle(delay)} stroke={color} strokeWidth="2.5"
          d={`M${x} ${y - 5} v10 M${x - 5} ${y} h10`} />
  )
}

function Drop({ x, y, s = 1, delay }: { x: number; y: number; s?: number; delay?: number }) {
  return (
    <path className="ck-p-drip" style={delayStyle(delay)} fill={WATER}
          d={`M${x} ${y} Q${x + 5 * s} ${y + 8 * s} ${x} ${y + 12 * s} Q${x - 5 * s} ${y + 8 * s} ${x} ${y} Z`} />
  )
}

function QMark({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g className="ck-p-wobble" stroke={color} strokeWidth="2.5" transform={`translate(${x} ${y})`}>
      <path d="M-4 -4 Q-4 -10 1 -10 Q6 -10 6 -5 Q6 -1 1 1 L1 4" />
      <circle cx="1" cy="9" r="1.6" fill={color} stroke="none" />
    </g>
  )
}

function Zzz({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g className="ck-p-zz" stroke={color} strokeWidth="2.5">
      <path d={`M${x} ${y} h7 l-7 7 h7`} />
      <path d={`M${x + 12} ${y - 10} h5 l-5 5 h5`} />
    </g>
  )
}

/* Arm — a thick stroke with a round hand at the end. */
function Arm({ d, hx, hy, dark, w = 8, hr = 6 }: {
  d: string; hx: number; hy: number; dark: string; w?: number; hr?: number
}) {
  return (
    <g>
      <path stroke={dark} strokeWidth={w} d={d} />
      <circle cx={hx} cy={hy} r={hr} fill={dark} />
    </g>
  )
}

function Feet({ lx, rx, y = 97, dark }: { lx: number; rx: number; y?: number; dark: string }) {
  return (
    <g>
      <ellipse cx={lx} cy={y} rx="8" ry="4.5" fill={dark} />
      <ellipse cx={rx} cy={y} rx="8" ry="4.5" fill={dark} />
    </g>
  )
}

/* ── great: the green celebrator ─────────────────────────────────────────── */

const GREAT_BODY =
  'M60 16 C 82 16 94 34 94 58 C 94 84 80 96 60 96 C 40 96 26 84 26 58 C 26 34 38 16 60 16 Z'

function Great({ feeling }: { feeling: string }) {
  const p = PALETTES.great
  const openMouth = (
    <g>
      <path fill="#4A2634" d="M42 62 Q60 66 78 62 Q74 82 60 82 Q46 82 42 62 Z" />
      <path fill={TONGUE} d="M50 73 Q60 81 70 73 Q60 77 50 73 Z" />
    </g>
  )
  const armsUp = (
    <g>
      <Arm d="M30 48 Q16 40 12 27" hx={12} hy={26} dark={p.dark} w={7} hr={5.5} />
      <Arm d="M90 48 Q104 40 108 27" hx={108} hy={26} dark={p.dark} w={7} hr={5.5} />
    </g>
  )
  const liftedBrows = <path stroke={PUPIL} strokeWidth="3" d="M37 35 Q45 30 52 33 M68 33 Q75 30 83 35" />

  let back: React.ReactNode = armsUp
  let front: React.ReactNode
  switch (feeling) {
    case 'excited':
      front = (
        <g>
          {liftedBrows}
          <Eye cx={46} cy={48} py={46} /><Eye cx={74} cy={48} py={46} />
          {openMouth}
          <Blush cx={34} cy={58} /><Blush cx={86} cy={58} />
          <g stroke={p.deep} strokeWidth="2.5">
            <path d="M14 60 h8 M12 68 h8 M98 60 h8 M100 68 h8" />
          </g>
          <Sparkle x={26} y={12} color={p.deep} />
          <Sparkle x={96} y={10} color={p.deep} />
        </g>
      )
      break
    case 'valued':
      back = null
      front = (
        <g>
          {liftedBrows}
          <Eye cx={46} cy={48} /><Eye cx={74} cy={48} />
          <path stroke={PUPIL} strokeWidth="3" d="M48 64 Q60 71 72 64" />
          <Arm d="M30 58 Q40 70 52 72" hx={52} hy={72} dark={p.dark} />
          <Arm d="M90 58 Q80 70 68 72" hx={68} hy={72} dark={p.dark} />
          <Blush cx={34} cy={58} /><Blush cx={86} cy={58} />
          <Heart x={20} y={38} s={1.1} />
          <Heart x={100} y={30} s={0.85} delay={0.9} />
        </g>
      )
      break
    case 'joyful':
      back = (
        <g>
          <Arm d="M28 52 Q14 48 8 41" hx={8} hy={40} dark={p.dark} w={7} hr={5.5} />
          <Arm d="M92 52 Q106 48 112 41" hx={112} hy={40} dark={p.dark} w={7} hr={5.5} />
        </g>
      )
      front = (
        <g>
          {liftedBrows}
          <Eye cx={46} cy={48} /><Eye cx={74} cy={48} />
          {openMouth}
          <Blush cx={34} cy={58} /><Blush cx={86} cy={58} />
          <g className="ck-p-twinkle">
            <circle cx="22" cy="18" r="2.2" fill={p.deep} />
            <circle cx="98" cy="14" r="2.2" fill={TONGUE} />
            <circle cx="16" cy="70" r="2.2" fill={WATER} />
            <circle cx="104" cy="62" r="2.2" fill={TONGUE} />
          </g>
        </g>
      )
      break
    case 'confident':
      back = null
      front = (
        <g>
          <path stroke={PUPIL} strokeWidth="3" d="M38 36 Q46 33 52 35 M68 32 Q76 29 84 33" />
          <Eye cx={46} cy={48} /><Eye cx={74} cy={48} />
          <path stroke={PUPIL} strokeWidth="3" d="M48 66 Q60 74 74 64" />
          <Arm d="M30 58 Q22 68 32 74" hx={33} hy={74} dark={p.dark} />
          <Arm d="M90 58 Q98 68 88 74" hx={87} hy={74} dark={p.dark} />
          <Blush cx={34} cy={58} /><Blush cx={86} cy={58} />
          <Sparkle x={100} y={44} color={p.deep} />
        </g>
      )
      break
    case 'proud':
    default:
      front = (
        <g>
          {liftedBrows}
          <Eye cx={46} cy={48} py={47} /><Eye cx={74} cy={48} py={47} />
          {openMouth}
          <Blush cx={34} cy={58} /><Blush cx={86} cy={58} />
          <Sparkle x={20} y={71} color={p.deep} />
          <Sparkle x={101} y={46} color={p.deep} />
          <circle cx="26" cy="14" r="2" fill={p.deep} />
          <circle cx="97" cy="60" r="2" fill={p.deep} />
        </g>
      )
  }
  return (
    <Shell valence="great" motion={motionOf(feeling, 'breathe')}>
      {back}
      <path fill="url(#ckg-great)" d={GREAT_BODY} />
      <Tufts deep={p.deep} />
      <Feet lx={46} rx={74} dark={p.dark} />
      {front}
    </Shell>
  )
}

/* ── good: the teal hugger ───────────────────────────────────────────────── */

const GOOD_BODY =
  'M60 18 C 78 18 90 34 92 58 C 94 82 80 96 60 96 C 40 96 26 82 28 58 C 30 34 42 18 60 18 Z'

function Good({ feeling }: { feeling: string }) {
  const p = PALETTES.good
  const sprout = (
    <g>
      <path stroke={p.deep} strokeWidth="2.5" d="M60 18 Q60 10 64 6" />
      <path fill={p.dark} d="M64 6 Q74 1 79 8 Q70 13 64 6 Z" />
      <path fill={p.dark} d="M62 8 Q54 4 51 9 Q57 13 62 8 Z" />
    </g>
  )
  const softSmile = <path stroke={PUPIL} strokeWidth="3" d="M52 62 Q60 69 68 62" />
  const clasp = (
    <g>
      <Arm d="M36 68 Q48 80 56 76" hx={56} hy={76} dark={p.dark} />
      <Arm d="M84 68 Q72 80 64 76" hx={64} hy={76} dark={p.dark} />
    </g>
  )

  let front: React.ReactNode
  switch (feeling) {
    case 'curious':
      front = (
        <g>
          <path stroke={PUPIL} strokeWidth="3" d="M66 42 Q74 38 82 43" />
          <Eye cx={46} cy={52} r={7.5} px={44} py={49} pr={3.5} />
          <Eye cx={74} cy={51} r={9} px={72} py={48} />
          <circle cx="58" cy="67" r="3" stroke={PUPIL} strokeWidth="2.5" />
          <Arm d="M34 66 Q44 80 54 72" hx={55} hy={72} dark={p.dark} />
          <Blush cx={36} cy={60} /><Blush cx={84} cy={60} />
          <QMark x={100} y={28} color={p.deep} />
        </g>
      )
      break
    case 'hopeful':
      front = (
        <g>
          <Eye cx={46} cy={50} py={47} /><Eye cx={74} cy={50} py={47} />
          {softSmile}
          {clasp}
          <Blush cx={36} cy={58} /><Blush cx={84} cy={58} />
          <Sparkle x={94} y={18} color={p.deep} />
          <circle cx="24" cy="26" r="2" fill={p.deep} />
        </g>
      )
      break
    case 'satisfied':
      front = (
        <g>
          <ClosedEyes />
          <path stroke={PUPIL} strokeWidth="3" d="M50 62 Q60 72 70 62" />
          <g className="ck-p-wave">
            <Arm d="M88 60 Q100 50 96 39" hx={96} hy={38} dark={p.dark} />
          </g>
          <Arm d="M32 66 Q44 78 56 74" hx={56} hy={74} dark={p.dark} />
          <Blush cx={36} cy={58} /><Blush cx={84} cy={58} />
          <Sparkle x={104} y={26} color={p.deep} />
        </g>
      )
      break
    case 'grateful':
      front = (
        <g>
          <ClosedEyes />
          {softSmile}
          {clasp}
          <Blush cx={36} cy={58} /><Blush cx={84} cy={58} />
          <Heart x={18} y={34} s={1.1} />
          <Heart x={102} y={26} s={0.8} delay={0.8} />
          <Heart x={98} y={44} s={0.6} delay={1.5} />
        </g>
      )
      break
    case 'calm':
    default:
      front = (
        <g>
          <ClosedEyes />
          {softSmile}
          <Arm d="M88 62 Q66 74 46 68" hx={46} hy={68} dark={p.dark} w={9} />
          <Arm d="M32 66 Q54 82 74 74" hx={74} hy={74} dark={p.dark} w={9} />
          <Blush cx={36} cy={58} /><Blush cx={84} cy={58} />
          <Heart x={18} y={34} s={1.1} />
          <Heart x={102} y={26} s={0.8} delay={1.1} />
        </g>
      )
  }
  return (
    <Shell valence="good" motion={motionOf(feeling, 'breathe')}>
      {sprout}
      <path fill="url(#ckg-good)" d={GOOD_BODY} />
      <Tufts deep={p.deep} y={22} />
      <Feet lx={48} rx={72} dark={p.dark} />
      {front}
    </Shell>
  )
}

/* ── okay: the purple pebble ─────────────────────────────────────────────── */

const OKAY_BODY =
  'M60 26 C 86 26 98 44 98 66 C 98 88 82 96 60 96 C 38 96 22 88 22 66 C 22 44 34 26 60 26 Z'

function Okay({ feeling }: { feeling: string }) {
  const p = PALETTES.okay
  const antenna = (droop: boolean) => (
    <g>
      <path stroke={p.deep} strokeWidth="2.5"
            d={droop ? 'M60 27 Q56 20 48 22' : 'M60 27 Q58 17 50 15'} />
      <circle cx={droop ? 47 : 50} cy={droop ? 23 : 14} r="3.5" fill={p.dark} />
    </g>
  )
  const hangArms = (
    <g>
      <Arm d="M26 68 Q21 78 26 88" hx={26} hy={88} dark={p.dark} w={7} hr={5} />
      <Arm d="M94 68 Q99 78 94 88" hx={94} hy={88} dark={p.dark} w={7} hr={5} />
    </g>
  )
  /* Half-closed lids: the body's own color sliding over the sclera. */
  const halfLidEyes = (
    <g>
      <Eye cx={46} cy={56} r={7.5} px={46} py={58} pr={3.5} />
      <Eye cx={74} cy={56} r={7.5} px={74} py={58} pr={3.5} />
      <path fill={p.dark} d="M38.5 55 A7.5 7.5 0 0 1 53.5 55 L38.5 55 Z" />
      <path fill={p.dark} d="M66.5 55 A7.5 7.5 0 0 1 81.5 55 L66.5 55 Z" />
      <path stroke={PUPIL} strokeWidth="2" d="M38.5 55 H53.5 M66.5 55 H81.5" />
    </g>
  )
  const flatMouth = <path stroke={PUPIL} strokeWidth="3" d="M50 76 L70 76" />

  let head: React.ReactNode = antenna(false)
  let front: React.ReactNode
  switch (feeling) {
    case 'tired':
      head = antenna(true)
      front = (
        <g>
          <SleepyEyes y={56} />
          <ellipse cx="60" cy="76" rx="4.5" ry="6" fill="#4A4470" />
          {hangArms}
          <Blush cx={34} cy={64} /><Blush cx={86} cy={64} />
          <Zzz x={96} y={24} color={p.deep} />
        </g>
      )
      break
    case 'bored':
      front = (
        <g>
          <Eye cx={46} cy={56} r={7.5} px={42.5} py={57} pr={3.5} />
          <Eye cx={74} cy={56} r={7.5} px={70.5} py={57} pr={3.5} />
          <path fill={p.dark} d="M38.5 54 A7.5 7.5 0 0 1 53.5 54 L38.5 54 Z" />
          <path fill={p.dark} d="M66.5 54 A7.5 7.5 0 0 1 81.5 54 L66.5 54 Z" />
          <path stroke={PUPIL} strokeWidth="2" d="M38.5 54 H53.5 M66.5 54 H81.5" />
          {flatMouth}
          {hangArms}
          <g fill={p.deep}>
            <circle cx="16" cy="46" r="1.8" /><circle cx="12" cy="52" r="1.8" />
            <circle cx="16" cy="58" r="1.8" />
          </g>
        </g>
      )
      break
    case 'indifferent':
      front = (
        <g>
          <path stroke={PUPIL} strokeWidth="2.5" d="M39 46 H53 M67 46 H81" />
          <Eye cx={46} cy={56} r={7.5} pr={3.5} />
          <Eye cx={74} cy={56} r={7.5} pr={3.5} />
          {flatMouth}
          <Arm d="M26 64 Q18 58 14 51" hx={14} hy={50} dark={p.dark} w={7} hr={5} />
          <Arm d="M94 64 Q102 58 106 51" hx={106} hy={50} dark={p.dark} w={7} hr={5} />
        </g>
      )
      break
    case 'distracted':
      head = antenna(true)
      front = (
        <g>
          <Eye cx={46} cy={56} r={7.5} px={49} py={53} pr={3.5} />
          <Eye cx={74} cy={56} r={7.5} px={77} py={53} pr={3.5} />
          <circle cx="60" cy="76" r="3" stroke={PUPIL} strokeWidth="2.5" />
          {hangArms}
          <Sparkle x={102} y={26} color={p.deep} />
          <circle cx="94" cy="16" r="2" fill={p.deep} />
        </g>
      )
      break
    case 'fine':
    default:
      front = (
        <g>
          {halfLidEyes}
          {flatMouth}
          {hangArms}
          <Blush cx={34} cy={64} /><Blush cx={86} cy={64} />
        </g>
      )
  }
  return (
    <Shell valence="okay" motion={motionOf(feeling, 'breathe')}>
      {head}
      <path fill="url(#ckg-okay)" d={OKAY_BODY} />
      <Tufts deep={p.deep} y={30} />
      <Feet lx={48} rx={72} dark={p.dark} />
      {front}
    </Shell>
  )
}

/* ── uneasy: the orange nail-biter ───────────────────────────────────────── */

const UNEASY_BODY =
  'M60 16 C 80 16 92 36 92 62 C 92 86 78 96 60 96 C 42 96 28 86 28 62 C 28 36 40 16 60 16 Z'

function Uneasy({ feeling }: { feeling: string }) {
  const p = PALETTES.uneasy
  const worriedBrows = <path stroke={PUPIL} strokeWidth="3" d="M39 39 Q47 33 53 34 M67 34 Q73 33 81 39" />
  const wavyMouth = <path stroke={PUPIL} strokeWidth="2.5" d="M52 68 Q56 66 60 68 Q64 70 68 68" />
  const wideEyes = (
    <g>
      <Eye cx={46} cy={50} r={9} px={48} py={53} pr={3} />
      <Eye cx={74} cy={50} r={9} px={72} py={53} pr={3} />
    </g>
  )

  let front: React.ReactNode
  switch (feeling) {
    case 'anxious':
      front = (
        <g>
          {worriedBrows}
          {wideEyes}
          {wavyMouth}
          <Arm d="M32 64 Q34 60 38 59" hx={38} hy={58} dark={p.dark} />
          <Arm d="M88 64 Q86 60 82 59" hx={82} hy={58} dark={p.dark} />
          <g stroke={p.deep} strokeWidth="2">
            <path d="M18 46 q-4 4 0 8 M22 58 q-4 4 0 8" />
            <path d="M102 46 q4 4 0 8 M98 58 q4 4 0 8" />
          </g>
          <Drop x={94} y={24} />
          <Drop x={26} y={28} s={0.8} delay={0.7} />
        </g>
      )
      break
    case 'confused':
      front = (
        <g>
          <path stroke={PUPIL} strokeWidth="3" d="M39 36 Q47 32 53 35 M67 38 Q73 36 81 38" />
          <Eye cx={46} cy={50} r={9} px={44} py={51} pr={3.5} />
          <Eye cx={74} cy={51} r={7} px={76} py={52} pr={3} />
          <path stroke={PUPIL} strokeWidth="2.5" d="M52 70 Q57 67 62 70 Q66 72 70 69" />
          <g className="ck-p-scratch">
            <Arm d="M88 58 Q96 36 78 22" hx={77} hy={21} dark={p.dark} />
          </g>
          <path stroke={p.deep} strokeWidth="1.5" d="M70 15 L73 12 M74 17 L77 14" />
          <QMark x={22} y={26} color={p.deep} />
          <Blush cx={36} cy={60} /><Blush cx={84} cy={60} />
        </g>
      )
      break
    case 'overwhelmed':
      front = (
        <g>
          {worriedBrows}
          {wideEyes}
          <path stroke={PUPIL} strokeWidth="2.5" d="M48 68 Q53 66 58 68 Q63 70 68 68 Q71 66 72 67" />
          <Arm d="M32 58 Q30 30 46 22" hx={47} hy={21} dark={p.dark} />
          <Arm d="M88 58 Q90 30 74 22" hx={73} hy={21} dark={p.dark} />
          <Drop x={96} y={30} />
          <Drop x={24} y={34} s={0.8} delay={0.5} />
          <Drop x={100} y={52} s={0.7} delay={1} />
        </g>
      )
      break
    case 'embarrassed':
      front = (
        <g>
          <path stroke={PUPIL} strokeWidth="3" d="M39 40 Q47 35 53 36 M67 36 Q73 35 81 40" />
          <Eye cx={46} cy={51} r={8} px={43} py={54} pr={3} />
          <Eye cx={74} cy={51} r={8} px={71} py={54} pr={3} />
          <path stroke={PUPIL} strokeWidth="2.5" d="M52 69 Q56 71 60 69 Q64 67 68 69" />
          <Arm d="M88 60 Q98 44 84 30" hx={83} hy={29} dark={p.dark} />
          <Blush cx={36} cy={60} big /><Blush cx={84} cy={60} big />
          <Drop x={26} y={26} s={0.7} />
        </g>
      )
      break
    case 'worried':
    default:
      front = (
        <g>
          {worriedBrows}
          {wideEyes}
          {wavyMouth}
          <Arm d="M32 62 Q40 76 48 70" hx={49} hy={69} dark={p.dark} />
          <Arm d="M88 62 Q80 76 72 70" hx={71} hy={69} dark={p.dark} />
          <path stroke={p.deep} strokeWidth="1.5" d="M46 66 L48 64 M52 67 L54 65 M68 67 L66 65 M74 66 L72 64" />
          <Drop x={96} y={24} />
          <Blush cx={36} cy={60} /><Blush cx={84} cy={60} />
        </g>
      )
  }
  return (
    <Shell valence="uneasy" motion={motionOf(feeling, 'tremble')}>
      <path fill="url(#ckg-uneasy)" d={UNEASY_BODY} />
      <Tufts deep={p.deep} />
      <Feet lx={50} rx={70} dark={p.dark} />
      {front}
    </Shell>
  )
}

/* ── upset: the red one under its own cloud ──────────────────────────────── */

const UPSET_BODY =
  'M60 28 C 84 28 96 46 96 68 C 96 90 80 98 60 98 C 40 98 24 90 24 68 C 24 46 36 28 60 28 Z'

function Upset({ feeling }: { feeling: string }) {
  const p = PALETTES.upset
  const cloud = (rain: boolean) => (
    <g>
      <g fill="#96A2B8">
        <circle cx="48" cy="9" r="6" />
        <circle cx="58" cy="6" r="7.5" />
        <circle cx="68" cy="9" r="6" />
        <rect x="42" y="8" width="32" height="7" rx="3.5" />
      </g>
      {rain && (
        <g className="ck-p-rain" stroke="#6FA8DC" strokeWidth="2.5">
          <path d="M47 19 L45 26" />
          <path d="M58 18 L56 26" />
          <path d="M69 19 L67 26" />
        </g>
      )}
    </g>
  )
  const angryBrows = <path stroke={PUPIL} strokeWidth="3.5" d="M42 44 L54 49 M78 44 L66 49" />
  const frown = <path stroke={PUPIL} strokeWidth="3.5" d="M48 80 Q60 72 72 80" />
  const droopArms = (
    <g>
      <Arm d="M28 72 Q22 82 28 92" hx={28} hy={92} dark={p.dark} hr={5.5} />
      <Arm d="M92 72 Q98 82 92 92" hx={92} hy={92} dark={p.dark} hr={5.5} />
    </g>
  )
  const openEyes = (
    <g>
      <Eye cx={47} cy={57} r={7.5} px={47} py={58} pr={3.5} />
      <Eye cx={73} cy={57} r={7.5} px={73} py={58} pr={3.5} />
    </g>
  )

  let sky: React.ReactNode = cloud(true)
  let front: React.ReactNode
  switch (feeling) {
    case 'angry':
      sky = (
        <g>
          {cloud(false)}
          <path className="ck-p-flash" fill="#F5C542" d="M60 15 L54 25 H59 L55 34 L64 23 H59 L63 15 Z" />
        </g>
      )
      front = (
        <g>
          <path stroke={PUPIL} strokeWidth="3.5" d="M40 42 L56 50 M80 42 L64 50" />
          {openEyes}
          <path stroke={PUPIL} strokeWidth="3" d="M46 78 l7 -4 l7 4 l7 -4 l7 4" />
          <Arm d="M30 74 Q26 82 30 88" hx={30} hy={89} dark={p.dark} hr={6.5} />
          <Arm d="M90 74 Q94 82 90 88" hx={90} hy={89} dark={p.dark} hr={6.5} />
          <g className="ck-p-rise" stroke="#C9CED8" strokeWidth="2.5">
            <path d="M18 40 q4 -4 8 0 M14 32 q4 -4 8 0" />
            <path d="M94 40 q4 -4 8 0 M98 32 q4 -4 8 0" />
          </g>
        </g>
      )
      break
    case 'sad':
      front = (
        <g>
          <path stroke={PUPIL} strokeWidth="3" d="M42 48 Q48 44 54 46 M78 48 Q72 44 66 46" />
          <Eye cx={47} cy={57} r={7.5} px={47} py={59.5} pr={3.5} />
          <Eye cx={73} cy={57} r={7.5} px={73} py={59.5} pr={3.5} />
          {frown}
          {droopArms}
          <Drop x={38} y={64} s={0.8} />
          <Drop x={82} y={64} s={0.8} delay={0.8} />
        </g>
      )
      break
    case 'lonely':
      front = (
        <g>
          <path stroke={PUPIL} strokeWidth="3" d="M42 48 Q48 44 54 46 M78 48 Q72 44 66 46" />
          <Eye cx={47} cy={57} r={7.5} px={44} py={59.5} pr={3.5} />
          <Eye cx={73} cy={57} r={7.5} px={70} py={59.5} pr={3.5} />
          <path stroke={PUPIL} strokeWidth="3" d="M52 70 Q60 66 68 70" />
          <Arm d="M86 72 Q66 82 48 78" hx={48} hy={78} dark={p.dark} w={9} />
          <Arm d="M34 76 Q54 90 72 84" hx={72} hy={84} dark={p.dark} w={9} />
          <Drop x={82} y={63} s={0.7} />
        </g>
      )
      break
    case 'discouraged':
      front = (
        <g>
          <SleepyEyes y={57} />
          <path stroke={PUPIL} strokeWidth="3" d="M50 81 Q60 77 70 81" />
          <Arm d="M28 72 L26 90" hx={26} hy={91} dark={p.dark} hr={5.5} />
          <Arm d="M92 72 L94 90" hx={94} hy={91} dark={p.dark} hr={5.5} />
          <g className="ck-p-rise" fill="#C9CED8">
            <circle cx="38" cy="70" r="1.5" /><circle cx="32" cy="66" r="2" />
            <circle cx="26" cy="61" r="2.5" />
          </g>
        </g>
      )
      break
    case 'frustrated':
    default:
      front = (
        <g>
          {angryBrows}
          {openEyes}
          {frown}
          <Arm d="M30 74 Q26 82 30 88" hx={30} hy={89} dark={p.dark} hr={6.5} />
          <Arm d="M90 74 Q94 82 90 88" hx={90} hy={89} dark={p.dark} hr={6.5} />
          <g className="ck-p-rise" stroke="#C9CED8" strokeWidth="2.5">
            <path d="M16 44 q4 -4 8 0" />
            <path d="M96 44 q4 -4 8 0" />
          </g>
        </g>
      )
  }
  return (
    <Shell valence="upset" motion={motionOf(feeling, 'shake')}>
      {sky}
      <path fill="url(#ckg-upset)" d={UPSET_BODY} />
      <Feet lx={48} rx={72} y={99} dark={p.dark} />
      {front}
    </Shell>
  )
}

export function CheckinCreature({ valence, feeling }: { valence: Valence; feeling?: string | null }) {
  const word = feeling ?? ''
  switch (valence) {
    case 'great': return <Great feeling={word} />
    case 'good': return <Good feeling={word} />
    case 'okay': return <Okay feeling={word} />
    case 'uneasy': return <Uneasy feeling={word} />
    case 'upset': return <Upset feeling={word} />
  }
}
