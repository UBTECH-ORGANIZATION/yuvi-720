import { useEffect, useRef } from 'react'
import { Icon } from '../../../components/primitives'

export interface PropMenuState {
  uid: string
  /** Viewport coordinates of the point just above the prop. */
  x: number
  y: number
}

/**
 * The Sims-style prop menu: right-click a piece of furniture and its actions
 * appear over it, so the room itself is the interface rather than a side list.
 */
export function PropMenu({
  at, label, onMove, onRotate, onRemove, onClose, t,
}: {
  at: PropMenuState
  label: string
  onMove: () => void
  /** Stations only move — they have no meaningful rotation and cannot be removed. */
  onRotate?: () => void
  onRemove?: () => void
  onClose: () => void
  t: (key: string) => string
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    // Capture: the 3D canvas stops propagation of its own pointer handling.
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="ys-propmenu"
      role="menu"
      aria-label={label}
      // A projected 3D point, so these stay physical however the page reads.
      style={{ left: `${at.x}px`, top: `${at.y}px` }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span className="ys-propmenu__title">{label}</span>
      <button type="button" role="menuitem" className="ys-propmenu__item" onClick={onMove}>
        <Icon name="expand" size={15} />
        <span>{t('YuviStudio.room.move')}</span>
      </button>
      {onRotate && (
        <button type="button" role="menuitem" className="ys-propmenu__item" onClick={onRotate}>
          <Icon name="reflect" size={15} />
          <span>{t('YuviStudio.room.rotate')}</span>
        </button>
      )}
      {onRemove && (
        <button type="button" role="menuitem" className="ys-propmenu__item is-danger" onClick={onRemove}>
          <Icon name="trash" size={15} />
          <span>{t('YuviStudio.room.remove')}</span>
        </button>
      )}
    </div>
  )
}
