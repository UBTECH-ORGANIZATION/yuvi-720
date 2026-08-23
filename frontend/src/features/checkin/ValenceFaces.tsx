/* Five valence faces — stroke-only inline SVG in `currentColor` (emoji are
 * banned by the design system). Each face differs only in brow and mouth:
 * the geometry IS the feeling, no color semantics needed at this layer. */

import type { Valence } from './feelings'

const FACE_PATHS: Record<Valence, { mouth: string; brows?: string; extras?: string }> = {
  great: {
    // Wide open smile + lifted brows.
    mouth: 'M10 18 Q16 25 22 18',
    brows: 'M9 9.5 Q11.5 7.5 14 9 M18 9 Q20.5 7.5 23 9.5',
  },
  good: {
    mouth: 'M11 19 Q16 23 21 19',
  },
  okay: {
    mouth: 'M11 20 L21 20',
  },
  uneasy: {
    // A wavering mouth.
    mouth: 'M11 20 Q13.5 18.5 16 20 Q18.5 21.5 21 20',
    brows: 'M9 10 Q11.5 8.8 14 10.2 M18 10.2 Q20.5 8.8 23 10',
  },
  upset: {
    mouth: 'M11 21.5 Q16 17.5 21 21.5',
    brows: 'M9.5 9 L14 11 M22.5 9 L18 11',
  },
}

/* The "not answered yet" face — dashed outline, eyes only. Deliberately NOT
 * one of the five valences: an empty cell must never look like a feeling. */
export function NoFeelingFace({ size = 22 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="16" cy="16" r="13.5" strokeDasharray="4 4.6" />
      <circle cx="11.5" cy="13.5" r="0.6" fill="currentColor" />
      <circle cx="20.5" cy="13.5" r="0.6" fill="currentColor" />
    </svg>
  )
}

export function ValenceFace({ valence, size = 34 }: { valence: Valence; size?: number }) {
  const face = FACE_PATHS[valence]
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="16" cy="16" r="13.5" />
      <circle cx="11.5" cy="13.5" r="0.6" fill="currentColor" />
      <circle cx="20.5" cy="13.5" r="0.6" fill="currentColor" />
      <path d={face.mouth} />
      {face.brows && <path d={face.brows} />}
    </svg>
  )
}
