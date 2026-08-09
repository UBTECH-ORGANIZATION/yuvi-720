import { useRef } from 'react'
import { Icon } from '../../../components/primitives'

export interface SegmentedItem<T extends string> {
  id: T
  label: string
  icon: string
}

/**
 * The one navigation control in the studio: an icon over a label, so a row of
 * categories stops reading as a row of identical pills. Arrow keys move between
 * tabs and follow writing direction, which matters in Hebrew and Arabic.
 */
export function SegmentedNav<T extends string>({
  label, items, value, onChange,
}: {
  label: string
  items: SegmentedItem<T>[]
  value: T
  onChange: (id: T) => void
}) {
  const listRef = useRef<HTMLDivElement | null>(null)

  const step = (delta: number) => {
    const index = items.findIndex((item) => item.id === value)
    const next = items[(index + delta + items.length) % items.length]
    if (next) onChange(next.id)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const rtl = listRef.current ? getComputedStyle(listRef.current).direction === 'rtl' : false
    const forward = event.key === (rtl ? 'ArrowLeft' : 'ArrowRight')
    step(forward ? 1 : -1)
  }

  return (
    <div ref={listRef} className="ys-panel__nav" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {items.map((item) => {
        const active = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={`ys-seg${active ? ' is-active' : ''}`}
            onClick={() => onChange(item.id)}
          >
            <Icon name={item.icon} size={20} />
            <span>{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}
