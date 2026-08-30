import { useState } from 'react'
import { Icon } from '../../../components/primitives'

/**
 * One step of the room-design walkthrough, already resolved to text by the
 * caller. The card knows nothing about the room — it only knows how to present
 * a step — so the step machine stays in one place next to the state it drives.
 */
export interface TutorialStepView {
  /** Stable id, so React remounts the card (and its animation) per step. */
  id: string
  icon: string
  title: string
  /** "Step 2 of 3", or "done". */
  status: string
  statusState: 'active' | 'done'
  /** The three answers, in the order a learner asks them. */
  what: string
  why: string
  how: string
  /** The one extra detail, hidden behind the expander. */
  tip: string
  primary: { label: string; icon: string; onClick: () => void; disabled?: boolean }
  secondary?: { label: string; icon: string; onClick: () => void }
}

export function StudioTutorial({
  step, headings, moreLabel, closeLabel, onClose,
}: {
  step: TutorialStepView
  /** The three fixed questions, so only the answers change between steps. */
  headings: { what: string; why: string; how: string }
  moreLabel: string
  closeLabel: string
  onClose: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <aside className="ys-tut" role="dialog" aria-label={step.title}>
      <button type="button" className="ys-tut__close" onClick={onClose} aria-label={closeLabel}>
        <Icon name="close" size={15} />
      </button>

      <div className="ys-tut__hero">
        <div className="ys-tut__gem">
          <Icon name={step.icon} size={26} />
        </div>
        <div>
          <h2>{step.title}</h2>
          <span className="ys-tut__chip" data-state={step.statusState}>
            <Icon name={step.statusState === 'done' ? 'check' : 'clock'} size={12} />
            {step.status}
          </span>
        </div>
      </div>

      <ul className="ys-tut__qa">
        <li>
          <i><Icon name="message" size={15} /></i>
          <div><h3>{headings.what}</h3><p>{step.what}</p></div>
        </li>
        <li>
          <i><Icon name="check" size={15} /></i>
          <div><h3>{headings.why}</h3><p>{step.why}</p></div>
        </li>
        <li>
          <i><Icon name="click" size={15} /></i>
          <div><h3>{headings.how}</h3><p>{step.how}</p></div>
        </li>
      </ul>

      <div className="ys-tut__actions">
        <button
          type="button"
          className="ys-tut__cta"
          onClick={step.primary.onClick}
          disabled={step.primary.disabled}
          data-on={step.statusState === 'done' ? 'true' : 'false'}
        >
          <Icon name={step.primary.icon} size={16} />
          {step.primary.label}
        </button>
        {step.secondary && (
          <button type="button" className="ys-tut__ghost" onClick={step.secondary.onClick}>
            <Icon name={step.secondary.icon} size={15} />
            {step.secondary.label}
          </button>
        )}
      </div>

      <button
        type="button"
        className="ys-tut__expander"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {moreLabel}
        <Icon name="arrow" size={14} />
      </button>
      {expanded && <p className="ys-tut__more">{step.tip}</p>}
    </aside>
  )
}
