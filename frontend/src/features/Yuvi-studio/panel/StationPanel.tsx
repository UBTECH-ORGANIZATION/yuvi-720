import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from '../../../components/primitives'

/**
 * The shell both stations share: head, nav, scrolling body, contextual bar and
 * a sticky foot. Anything a station wants to show has to fit one of those five
 * slots, which is what keeps the avatar panel and the room panel readable as
 * the same object.
 */
export function StationPanel({
  title, closeLabel, onClose, wallet, nav, context, footer, children,
}: {
  title: string
  closeLabel: string
  onClose: () => void
  wallet?: ReactNode
  nav?: ReactNode
  context?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  // Walking onto a station opens a panel the learner never clicked, so focus
  // has to follow them into it or the keyboard is left back on the stage.
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  useEffect(() => { headingRef.current?.focus() }, [])

  return (
    <aside className="ys-panel">
      <div className="ys-panel__head">
        <h1 className="ys-panel__title" ref={headingRef} tabIndex={-1}>{title}</h1>
        {wallet}
      </div>
      <button
        type="button"
        className="ys-panel__close"
        onClick={onClose}
        aria-label={closeLabel}
        title={closeLabel}
      >
        <Icon name="close" size={18} />
      </button>
      {nav}
      <div className="ys-panel__body">{children}</div>
      {context}
      {footer && <div className="ys-panel__foot">{footer}</div>}
    </aside>
  )
}
