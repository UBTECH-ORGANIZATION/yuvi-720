/* The three band marks (#450, v3): green steady · orange midway · red needs me.
 *
 * v3 dropped the faces (the teacher found judgement-faces wrong on children's
 * rows) for status GLYPHS on a gradient coin:
 *
 *   green  ✓  a check — settled, holding
 *   orange 〜 a wave — wobbling, midway
 *   red    !  an exclamation — needs me today
 *
 * Never colour alone: each band has its own glyph, so the three read apart in
 * grayscale and for colour-blind teachers. Decorative — the accessible text
 * is always the band label or student name beside the mark. (Kept deliberately
 * distinct from the check-in `ValenceFaces`, which render a child's own
 * self-report.)
 */

export type Band = 'red' | 'orange' | 'green'

/* Fixed illustrative gradients (like MomentScene's palette, not theme tokens):
   a saturated coin reads on both themes, and the glyph is white on the 600s. */
const TOP: Record<Band, string> = {
  green: '#3ecf96', orange: '#f2b53c', red: '#f0705e',
}
const BOTTOM: Record<Band, string> = {
  green: '#149467', orange: '#cf8a10', red: '#cf4130',
}

export function BandFace({ band, size = 28 }: { band: Band; size?: number }) {
  const gradientId = `tchBand-${band}`
  return (
    <svg
      className={`tch-bandFace tch-bandFace--${band}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={TOP[band]} />
          <stop offset="1" stopColor={BOTTOM[band]} />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill={`url(#${gradientId})`} />
      {/* a soft top-light so the coin has volume */}
      <ellipse cx="16" cy="9" rx="10.5" ry="5.5" fill="#ffffff" opacity="0.18" />
      <circle cx="16" cy="16" r="15" fill="none" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1" />
      {band === 'green' && (
        <path
          d="M9.5 16.5 L14 21 L22.5 11.5"
          fill="none" stroke="#ffffff" strokeWidth="3.4"
          strokeLinecap="round" strokeLinejoin="round"
        />
      )}
      {band === 'orange' && (
        <path
          d="M8 16 q 4 -5.5 8 0 t 8 0"
          fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round"
        />
      )}
      {band === 'red' && (
        <g fill="#ffffff" stroke="none">
          <rect x="14.1" y="7.5" width="3.8" height="11.5" rx="1.9" />
          <circle cx="16" cy="23.5" r="2.3" />
        </g>
      )}
    </svg>
  )
}
