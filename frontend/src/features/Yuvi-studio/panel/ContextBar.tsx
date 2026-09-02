import type { ReactNode } from 'react'

/**
 * The bar above the panel footer: what you are about to buy, or the prop you
 * have selected. Both used to be near-identical blocks with different markup.
 */
export function ContextBar({
  tag, title, note, aside, actions,
}: {
  tag: string
  title: string
  note?: string
  /** Price, swatches — whatever belongs beside the title. */
  aside?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="ys-ctx">
      <span className="ys-ctx__tag">{tag}</span>
      <div className="ys-ctx__info">
        <strong>{title}</strong>
        {aside}
        {note && <span className="ys-ctx__note">{note}</span>}
      </div>
      {actions && <div className="ys-ctx__actions">{actions}</div>}
    </div>
  )
}
