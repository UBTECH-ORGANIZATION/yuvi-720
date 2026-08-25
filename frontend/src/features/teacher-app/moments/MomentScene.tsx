/* The album's "photos" (#450): one hand-authored SVG scene per moment kind.
 *
 * One visual language across all eleven: a flat pastel landscape in a 4:3
 * frame — soft sky band, a ground line, one focal object telling the kind's
 * story. Decorative only (`aria-hidden`); the sentence under the photo is the
 * accessible content. Colours leane on the token palette so the scenes sit in
 * both themes; each section carries its own sky so a flipped-to page reads as
 * a chapter, not a shuffle.
 */

import type { ReactNode } from 'react'

const SKY: Record<string, string> = {
  breakthroughs: 'var(--sp-primary-100, #ece9ff)',
  persistence: 'var(--sp-success-100)',
  goals: 'var(--sp-warn-100)',
  sensitive: 'var(--sp-danger-100)',
}
const INK = 'var(--sp-ink-700)'
const ACCENT: Record<string, string> = {
  breakthroughs: 'var(--sp-primary-600, #6c5ce7)',
  persistence: 'var(--sp-success-600)',
  goals: 'var(--sp-warn-600)',
  sensitive: 'var(--sp-danger-600)',
}

export const SECTION_OF_KIND: Record<string, keyof typeof SKY> = {
  breakthrough: 'breakthroughs',
  first_mastery: 'breakthroughs',
  hard_question_cracked: 'breakthroughs',
  recovery: 'persistence',
  comeback: 'persistence',
  sustained_effort: 'persistence',
  personal_best: 'persistence',
  goal_done: 'goals',
  wellbeing_shared: 'sensitive',
  misconception_resolved: 'sensitive',
  feelings_journey: 'sensitive',
}

function Scene({ kind, children }: { kind: string; children: ReactNode }) {
  const section = SECTION_OF_KIND[kind] ?? 'persistence'
  return (
    <svg
      className={`tch-momentScene tch-momentScene--${kind}`}
      viewBox="0 0 120 90"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="0" y="0" width="120" height="90" fill={SKY[section]} />
      {/* a low sun/moon disc gives every photo the same golden-hour light */}
      <circle cx="97" cy="20" r="9" fill="#fff" opacity="0.55" />
      <path d="M0 68 Q 30 62 60 68 T 120 68 V 90 H 0 Z" fill="#fff" opacity="0.5" />
      {children}
    </svg>
  )
}

const S = (kind: string) => ACCENT[SECTION_OF_KIND[kind] ?? 'persistence']

const SCENES: Record<string, () => ReactNode> = {
  /* a summit, a planted flag, a burst — the wall came down */
  breakthrough: () => (
    <g>
      <path d="M18 78 L 52 30 L 74 56 L 90 42 L 112 78 Z" fill={S('breakthrough')} opacity="0.75" />
      <path d="M45 40 L 52 30 L 59 40 Z" fill="#fff" opacity="0.85" />
      <line x1="52" y1="30" x2="52" y2="16" stroke={INK} strokeWidth="1.6" />
      <path d="M52 16 l 10 3.5 l -10 3.5 Z" fill={S('breakthrough')} />
      {[[38, 16], [64, 12], [72, 22]].map(([x, y]) => (
        <path key={`${x}`} d={`M${x} ${y} l1.6 3 3 1.6 -3 1.6 -1.6 3 -1.6 -3 -3 -1.6 3 -1.6 Z`} fill="#fff" />
      ))}
    </g>
  ),
  /* one first star, held up on a little pedestal */
  first_mastery: () => (
    <g>
      <rect x="48" y="58" width="24" height="20" rx="3" fill={S('first_mastery')} opacity="0.55" />
      <rect x="42" y="74" width="36" height="6" rx="3" fill={S('first_mastery')} opacity="0.75" />
      <path d="M60 24 l5 10.5 11.5 1.5 -8.4 8 2 11.4 -10.1 -5.5 -10.1 5.5 2 -11.4 -8.4 -8 11.5 -1.5 Z"
            fill="#fff" stroke={S('first_mastery')} strokeWidth="1.6" />
    </g>
  ),
  /* the boulder everyone was stuck on, cracked, light escaping */
  hard_question_cracked: () => (
    <g>
      <path d="M34 78 Q 30 48 52 42 Q 78 36 86 56 Q 92 78 78 78 Z" fill={S('hard_question_cracked')} opacity="0.7" />
      <path d="M58 42 L 54 54 L 62 60 L 56 72" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      {[[52, 30], [66, 26], [76, 34]].map(([x, y]) => (
        <line key={`${x}`} x1="58" y1="44" x2={x} y2={y} stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      ))}
    </g>
  ),
  /* sun coming out from behind the rain cloud */
  recovery: () => (
    <g>
      <circle cx="66" cy="40" r="14" fill={S('recovery')} opacity="0.85" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
        <line key={deg} x1={66 + 18 * Math.cos((deg * Math.PI) / 180)}
              y1={40 + 18 * Math.sin((deg * Math.PI) / 180)}
              x2={66 + 23 * Math.cos((deg * Math.PI) / 180)}
              y2={40 + 23 * Math.sin((deg * Math.PI) / 180)}
              stroke={S('recovery')} strokeWidth="2" strokeLinecap="round" />
      ))}
      <path d="M28 52 a8 8 0 0 1 2 -15.7 a10 10 0 0 1 19 -2 a7 7 0 0 1 3 13.7 Z" fill="#fff" />
      {[34, 42].map((x) => (
        <line key={x} x1={x} y1="56" x2={x - 3} y2="63" stroke={INK} strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
      ))}
    </g>
  ),
  /* the path that dips and climbs back higher than it started */
  comeback: () => (
    <g>
      <path d="M14 40 C 34 40 34 68 54 68 C 76 68 74 26 100 26"
            stroke={S('comeback')} strokeWidth="3.5" fill="none" strokeLinecap="round" />
      <path d="M100 26 l -8 -3 M 100 26 l -4 8" stroke={S('comeback')} strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="14" cy="40" r="3.5" fill={INK} opacity="0.6" />
    </g>
  ),
  /* a stone cairn — patience, stacked */
  sustained_effort: () => (
    <g>
      {[[60, 74, 17, 8], [60, 60, 13, 7], [60, 48, 10, 6], [60, 38, 6.5, 5]].map(([cx, cy, rx, ry]) => (
        <ellipse key={cy} cx={cx} cy={cy} rx={rx} ry={ry}
                 fill={S('sustained_effort')} opacity={0.5 + (74 - Number(cy)) * 0.008} />
      ))}
      <path d="M60 28 q 3 -5 8 -5" stroke={S('sustained_effort')} strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </g>
  ),
  /* their own kite, higher than their own yesterday */
  personal_best: () => (
    <g>
      <path d="M30 76 C 44 66 54 52 66 34" stroke={INK} strokeWidth="1.3" fill="none"
            strokeDasharray="3 3" opacity="0.6" />
      <path d="M66 18 L 80 30 L 66 44 L 54 30 Z" fill={S('personal_best')} opacity="0.85" />
      <line x1="66" y1="18" x2="66" y2="44" stroke="#fff" strokeWidth="1.4" />
      <line x1="54" y1="30" x2="80" y2="30" stroke="#fff" strokeWidth="1.4" />
      {[[62, 52], [70, 58]].map(([x, y]) => (
        <path key={`${x}`} d={`M${x} ${y} q 4 2 0 5`} stroke={S('personal_best')} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      ))}
    </g>
  ),
  /* an arrow home in the target, flag up */
  goal_done: () => (
    <g>
      {[16, 11.5, 7].map((r, index) => (
        <circle key={r} cx="58" cy="52" r={r}
                fill={index % 2 ? '#fff' : S('goal_done')} opacity={index % 2 ? 0.9 : 0.75} />
      ))}
      <circle cx="58" cy="52" r="3" fill={INK} opacity="0.7" />
      <line x1="58" y1="52" x2="82" y2="28" stroke={INK} strokeWidth="2" strokeLinecap="round" opacity="0.75" />
      <path d="M82 28 l 2 -8 l 4 7 Z M82 28 l 8 -2 l -7 -4 Z" fill={INK} opacity="0.75" />
    </g>
  ),
  /* two bubbles leaning together, a heart passed between */
  wellbeing_shared: () => (
    <g>
      <path d="M22 36 q0 -12 14 -12 h8 q14 0 14 12 q0 12 -14 12 h-4 l-7 8 v-8 q-11 -1 -11 -12 Z"
            fill="#fff" opacity="0.95" />
      <path d="M64 50 q0 -10 12 -10 h7 q12 0 12 10 q0 10 -12 10 q0 0 -3 0 l 6 7 -11 -7 q-11 0 -11 -10 Z"
            fill={S('wellbeing_shared')} opacity="0.5" />
      <path d="M42 34 c -1.6 -3.4 -6.4 -2.4 -6.4 1 c 0 2.6 3.4 4.6 6.4 6.6 c 3 -2 6.4 -4 6.4 -6.6 c 0 -3.4 -4.8 -4.4 -6.4 -1 Z"
            fill={S('wellbeing_shared')} />
    </g>
  ),
  /* the tangle combed out into a straight line */
  misconception_resolved: () => (
    <g>
      <path d="M16 52 c 8 -14 14 10 22 -2 c 6 -9 10 9 16 2 c 5 -6 8 2 14 0 L 104 52"
            stroke={S('misconception_resolved')} strokeWidth="3" fill="none" strokeLinecap="round"
            opacity="0.45" />
      <path d="M16 66 H 104" stroke={S('misconception_resolved')} strokeWidth="3" strokeLinecap="round" />
      <circle cx="104" cy="66" r="3.4" fill={S('misconception_resolved')} />
    </g>
  ),
  /* a day walked from the rain to the light — and they kept walking */
  feelings_journey: () => (
    <g>
      <path d="M14 36 a7 7 0 0 1 2 -13.7 a9 9 0 0 1 17 -1.6 a6 6 0 0 1 2.4 11.6 Z" fill={INK} opacity="0.35" />
      {[20, 27, 34].map((x) => (
        <line key={x} x1={x} y1="40" x2={x - 2.5} y2="46" stroke={INK} strokeWidth="1.4" strokeLinecap="round" opacity="0.4" />
      ))}
      <circle cx="96" cy="28" r="10" fill={S('feelings_journey')} opacity="0.8" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
        <line key={deg} x1={96 + 13 * Math.cos((deg * Math.PI) / 180)}
              y1={28 + 13 * Math.sin((deg * Math.PI) / 180)}
              x2={96 + 17 * Math.cos((deg * Math.PI) / 180)}
              y2={28 + 17 * Math.sin((deg * Math.PI) / 180)}
              stroke={S('feelings_journey')} strokeWidth="1.6" strokeLinecap="round" opacity="0.8" />
      ))}
      <path d="M18 76 C 44 72 76 72 102 62" stroke={S('feelings_journey')} strokeWidth="2.6"
            fill="none" strokeLinecap="round" strokeDasharray="0.1 7" />
    </g>
  ),
}

export function MomentScene({ kind }: { kind: string }) {
  const draw = SCENES[kind] ?? SCENES.sustained_effort
  return <Scene kind={kind}>{draw()}</Scene>
}
