/* The dim-everything-but-this layer.
 *
 * The cutout is an SVG `<mask>`, not the usual `box-shadow: 0 0 0 9999px` trick.
 * Two concrete reasons, both of which bite in this app: our panels use several
 * different `--sp-radius-*` values and a box-shadow ring can only ever have one
 * uniform radius (it visibly clips the corners of a rounded card), and a mask
 * rect animates — `top`/`left`/`width`/`height` transition smoothly as the tour
 * moves from panel to panel, which a spread shadow cannot do.
 *
 * Clicks: the overlay swallows them by default, so a teacher cannot wander off
 * mid-tour into a half-explained screen. A step marked `interactive` lets them
 * through to the target only.
 */

import type { TargetRect } from './useTargetRect'
import './tour.css'

interface Props {
  rect: TargetRect | null
  padding: number
  interactive: boolean
  reducedMotion: boolean
  onDismiss: () => void
}

/** Matches `--sp-radius-lg`; the cutout hugs the card rather than boxing it. */
const CUTOUT_RADIUS = 16

export function SpotlightOverlay(
  { rect, padding, interactive, reducedMotion, onDismiss }: Props
) {
  const box = rect
    ? {
        x: Math.max(0, rect.left - padding),
        y: Math.max(0, rect.top - padding),
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
      }
    : null

  return (
    <div
      className={`sp-tour__overlay${reducedMotion ? ' is-still' : ''}`}
      // Decorative: the step card carries the accessible name and the focus.
      aria-hidden="true"
      onClick={onDismiss}
      style={interactive && box ? { pointerEvents: 'none' } : undefined}
    >
      <svg className="sp-tour__scrim" width="100%" height="100%" preserveAspectRatio="none">
        <defs>
          <mask id="sp-tour-cutout">
            {/* White keeps the scrim, black punches the hole through it. */}
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {box ? (
              <rect
                className="sp-tour__hole"
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
                rx={CUTOUT_RADIUS}
                ry={CUTOUT_RADIUS}
                fill="black"
              />
            ) : null}
          </mask>
        </defs>
        <rect
          x="0" y="0" width="100%" height="100%"
          fill="var(--sp-tour-scrim)"
          mask="url(#sp-tour-cutout)"
        />
      </svg>

      {/* The halo is a separate element so it can pulse without the mask having
          to re-render, and so it is trivially droppable under reduced motion. */}
      {box ? (
        <div
          className="sp-tour__halo"
          style={{
            top: box.y, left: box.x, width: box.width, height: box.height,
            borderRadius: CUTOUT_RADIUS,
          }}
        />
      ) : null}
    </div>
  )
}
