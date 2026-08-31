import { useEffect, useRef } from 'react'
import { Icon } from '../../../components/primitives'

export interface PropMenuState {
  uid: string
  /** Viewport coordinates of the pointer that opened the menu. */
  x: number
  y: number
  /** Which side of the pointer has room for the menu. */
  side: 'left' | 'right'
}

/**
 * The Sims-style prop menu: right-click a piece of furniture and its actions
 * appear over it, so the room itself is the interface rather than a side list.
 */
export function PropMenu({
  at, label, colors = [], primaryAction, onMove, onRotate, onRemove, onTint, onMoreColors, onClose, onHoverStart, onHoverEnd, t,
}: {
  at: PropMenuState
  label: string
  colors?: string[]
  primaryAction?: { label: string; icon: string; onClick: () => void }
  onMove?: () => void
  /** Stations turn too, but they are part of the room and cannot be removed. */
  onRotate?: () => void
  onRemove?: () => void
  onTint?: (hex: string) => void
  onMoreColors?: () => void
  onClose: () => void
  onHoverStart?: () => void
  onHoverEnd?: () => void
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
      className={`ys-propmenu ys-propmenu--${at.side}`}
      role="menu"
      aria-label={label}
      // A projected 3D point, so these stay physical however the page reads.
      style={{ left: `${at.x}px`, top: `${at.y}px` }}
      onContextMenu={(event) => event.preventDefault()}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
    >
      <span className="ys-propmenu__title">{label}</span>
      {primaryAction && (
        <button type="button" role="menuitem" className="ys-propmenu__item" onClick={primaryAction.onClick}>
          <Icon name={primaryAction.icon} size={15} />
          <span>{primaryAction.label}</span>
        </button>
      )}
      {onMove && (
        <button type="button" role="menuitem" className="ys-propmenu__item" onClick={onMove}>
          <Icon name="expand" size={15} />
          <span>{t('YuviStudio.room.move')}</span>
        </button>
      )}
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
      {onTint && colors.length > 0 && (
        <div className="ys-propmenu__colors" role="group" aria-label={t('YuviStudio.room.colors')}>
          {colors.map((hex) => (
            <button
              key={hex}
              type="button"
              className="ys-propmenu__swatch"
              style={{ background: hex }}
              aria-label={hex}
              onClick={() => onTint(hex)}
            />
          ))}
          {onMoreColors && (
            <button type="button" className="ys-propmenu__more-colors" onClick={onMoreColors}>
              <Icon name="palette" size={15} />
              <span>{t('YuviStudio.room.moreColors')}</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
