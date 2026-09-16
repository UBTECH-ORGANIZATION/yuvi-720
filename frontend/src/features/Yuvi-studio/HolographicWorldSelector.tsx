import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { RoomLayoutId } from './RoomLayouts'
import { WORLD_HOLOGRAM_FRAME, WORLD_HOLOGRAM_FRAMES, WORLD_HOLOGRAM_IDS, worldHologramLock, worldHologramPad, worldHologramStrip } from './worldHologramStrips'

/* The world picker of the Room panel: four holographic projections, one per
   world, turning slowly on their pads.

   They used to be live three.js scenes on a second WebGLRenderer with its own
   animation loop, re-rendered through four scissored viewports every frame
   for as long as the panel was open. The studio keeps one WebGL context per
   page (the room's), so the projections are now baked: each world's full turn
   is a WebP sprite strip (`worldHologramStrips.ts`, produced by
   `scripts/render-world-holograms.mjs`) and the spin is a CSS `steps()`
   animation over the strip. Two copies of the strip, one frame apart,
   cross-fade over each step, so 7.5° per frame reads as one slow rotation.
   Hover speeds the turn and grows the projection; a pick pulses it and fades
   the others, as before; the padlock is an overlay on a locked world. */

interface HolographicWorldSelectorProps {
  compact?: boolean
  open: boolean
  busy: boolean
  activeLayoutId: RoomLayoutId
  labels: Record<RoomLayoutId, string>
  lockedIds: RoomLayoutId[]
  lockedLabel: string
  currentLabel: string
  onSelect: (layoutId: RoomLayoutId) => void
}

const WORLD_IDS = WORLD_HOLOGRAM_IDS

// The frame box and the step count come from the strip module, so a re-bake
// with another frame size or count cannot drift from what the CSS steps over.
const frameStyle: CSSProperties = {
  aspectRatio: `${WORLD_HOLOGRAM_FRAME.width} / ${WORLD_HOLOGRAM_FRAME.height}`,
  '--ys-frames': WORLD_HOLOGRAM_FRAMES,
} as CSSProperties

export function HolographicWorldSelector({ compact = false, open, busy, activeLayoutId, labels, lockedIds, lockedLabel, currentLabel, onSelect }: HolographicWorldSelectorProps) {
  const [selectedId, setSelectedId] = useState<RoomLayoutId | null>(null)
  const selectRef = useRef(onSelect)
  const timerRef = useRef<number | null>(null)
  const pad = worldHologramPad()
  const lock = worldHologramLock()

  useEffect(() => { selectRef.current = onSelect }, [onSelect])
  useEffect(() => {
    if (!open) setSelectedId(null)
  }, [open])
  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current) }, [])

  const requestSelection = (id: RoomLayoutId) => {
    if (!open || busy || selectedId) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    setSelectedId(id)
    // The pick lands after the pulse, as the live projection did.
    timerRef.current = window.setTimeout(() => selectRef.current(id), reduceMotion ? 120 : 460)
  }

  return <div className={`ys-world-projection${open ? ' is-open' : ''}${compact ? ' is-compact' : ''}`} aria-hidden={!open}>
    <div className="ys-world-projection__targets">
      {WORLD_IDS.map((id, index) => {
        const strip = worldHologramStrip(id)
        const locked = lockedIds.includes(id)
        return (
          <button
            key={id}
            type="button"
            className={selectedId === id ? 'is-selected' : selectedId ? 'is-dimmed' : undefined}
            style={{ '--ys-world-index': index } as CSSProperties}
            aria-label={`${labels[id]}${locked ? `, ${lockedLabel}` : ''}`}
            aria-current={activeLayoutId === id ? 'true' : undefined}
            aria-pressed={selectedId === id}
            disabled={!open || busy}
            onClick={() => requestSelection(id)}
          >
            <span className="ys-world-card__hologram" aria-hidden="true">
              {strip && (
                <span className="ys-world-card__frame" style={frameStyle}>
                  {pad && <span className="ys-world-card__pad" style={{ backgroundImage: `url(${pad})` }} />}
                  <span className="ys-world-card__strip" style={{ backgroundImage: `url(${strip})` }} />
                  <span className="ys-world-card__strip ys-world-card__strip--next" style={{ backgroundImage: `url(${strip})` }} />
                  {locked && lock && <span className="ys-world-card__lock" style={{ backgroundImage: `url(${lock})` }} />}
                </span>
              )}
            </span>
            <span className="ys-world-card__state">
              {activeLayoutId === id ? currentLabel : lockedIds.includes(id) ? lockedLabel : ''}
            </span>
            <span className="ys-world-card__name">{labels[id]}</span>
          </button>
        )
      })}
    </div>
  </div>
}
