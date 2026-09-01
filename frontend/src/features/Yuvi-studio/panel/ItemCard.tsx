import { Icon } from '../../../components/primitives'

/**
 * Every pickable thing in the studio — avatar gear, room props, the "none"
 * option — is this card. One shape, one selected state, one badge slot.
 */
export function ItemCard({
  label, thumb, dot, none, selected, previewing, highlighted, locked, isNew, price, tip, disabled, onClick,
}: {
  label: string
  /** Rendered image for avatar gear or room props. */
  thumb?: string
  /** Flat-colour fallback when a rendered thumbnail is unavailable. */
  dot?: string
  none?: boolean
  selected?: boolean
  previewing?: boolean
  highlighted?: boolean
  locked?: boolean
  isNew?: boolean
  price?: number | null
  tip?: string
  disabled?: boolean
  onClick: () => void
}) {
  const buyable = Boolean(locked) && typeof price === 'number'
  const classes = [
    'ys-card',
    dot && !thumb ? 'ys-card--dot' : '',
    selected ? 'is-selected' : '',
    previewing ? 'is-previewing' : '',
    highlighted ? 'is-highlighted' : '',
    locked ? 'is-locked' : '',
    buyable ? 'is-buyable' : '',
  ].filter(Boolean).join(' ')

  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      aria-pressed={selected}
      disabled={disabled ?? (Boolean(locked) && !buyable && !tip)}
    >
      <span className="ys-card__media">
        {none || (!thumb && !dot)
          ? <span className="ys-card__none" />
          : thumb
            ? <img src={thumb} alt="" />
            : <span className="ys-card__dot" style={{ background: dot }} />}
      </span>
      <span className="ys-card__label">{label}</span>
      {selected && (
        <span className="ys-card__badge ys-card__badge--check" aria-hidden><Icon name="check" size={12} /></span>
      )}
      {!selected && buyable && (
        <span className="ys-card__badge" aria-hidden><Icon name="spark" size={12} />{price}</span>
      )}
      {!selected && locked && !buyable && (
        <span className="ys-card__badge ys-card__badge--lock" aria-hidden><Icon name="lock" size={12} /></span>
      )}
      {isNew && !locked && !selected && <span className="ys-card__new" aria-hidden />}
      {locked && !buyable && tip && <span className="ys-card__tip" role="tooltip">{tip}</span>}
    </button>
  )
}
