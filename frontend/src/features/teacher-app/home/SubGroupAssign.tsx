/* Sub-group goal assignment — the actionable half of the learning-gaps panel.
 *
 * A gap tells the teacher "7 of 12 are stuck on fractions". Nice-to-have §4 asks
 * for splitting into sub-groups; this is that, made concrete: assign one goal to
 * exactly those 7 in a click.
 *
 * Two rules are load-bearing here:
 *
 *   The sub-group is a *selection*, never a ranking. The learners arrive in
 *   roster order, unnumbered and unscored, and there is no metric beside a name.
 *   `learning_gaps` deliberately exposes `learner_ids` for acting on, not for
 *   display order (see group_analytics.learning_gaps).
 *
 *   The teacher writes the goal. The gap pre-fills a title because retyping the
 *   objective is friction, but every field is editable before anything is
 *   assigned — consistent with "the AI drafts, the teacher decides".
 */

import { useMemo, useState } from 'react'
import { Icon } from '../../../components/primitives/Icon'
import { useI18n } from '../../../i18n/I18nProvider'
import { assignGroupGoal } from '../../../services/teacher'

interface Props {
  /** The sub-group to act on. Comes from `learning_gaps.learner_ids` or from a
   *  brief action — either way it is computed from evidence, never chosen by a
   *  model and never ordered by anything the teacher could read as a ranking. */
  candidates: string[]
  /** Stable id for the form's label/input pairs. */
  id: string
  /** What the goal is called before the teacher edits it. */
  defaultTitle: string
  /** Label on the disclosure summary. */
  openLabel?: string
  groupId: string
  /** Roster names, so the teacher picks people rather than opaque ids. */
  names: Map<string, string | null>
  /** Rendered open, for a surface that has already committed the space. */
  defaultOpen?: boolean
}

type Outcome =
  | { kind: 'assigned'; count: number; skipped: number }
  | { kind: 'error' }

/** A week out, matching the default the learner-side goal composer uses. */
function defaultDeadline(): string {
  const date = new Date()
  date.setDate(date.getDate() + 7)
  return date.toISOString().slice(0, 10)
}

export function SubGroupAssign({
  candidates, id, defaultTitle, openLabel, groupId, names, defaultOpen,
}: Props) {
  const { t, language } = useI18n()

  const [selected, setSelected] = useState<Set<string>>(() => new Set(candidates))
  const [title, setTitle] = useState(defaultTitle)
  const [nextSteps, setNextSteps] = useState('')
  const [deadline, setDeadline] = useState(defaultDeadline)
  const [isBusy, setIsBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const rows = useMemo(
    () => candidates.map((id) => ({ id, name: names.get(id) ?? id })),
    [candidates, names]
  )

  if (!candidates.length) return null

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function assign() {
    if (!selected.size || isBusy) return
    setIsBusy(true)
    setOutcome(null)
    try {
      const result = await assignGroupGoal(
        groupId,
        [...selected],
        { title: title.trim(), next_steps: nextSteps.trim(), deadline },
        language
      )
      setOutcome({
        kind: 'assigned',
        count: result.assigned.length,
        skipped: result.skipped.length,
      })
    } catch {
      setOutcome({ kind: 'error' })
    } finally {
      setIsBusy(false)
    }
  }

  const titleId = `subgroup-title-${id}`
  const stepsId = `subgroup-steps-${id}`
  const deadlineId = `subgroup-deadline-${id}`

  return (
    <details className="tch-subgroup" open={defaultOpen}>
      <summary className="tch-subgroup__summary">
        <Icon name="wand" size={16} aria-hidden />
        {openLabel ?? t('tch.subgroup.open', { count: candidates.length })}
      </summary>

      <div className="tch-subgroup__body">
        {/* Selection as toggle chips: a tap adds or removes a name, and the
            pressed state is the checkmark — no checkbox furniture. */}
        <div className="tch-subgroup__people">
          <span className="tch-subgroup__peopleLabel">{t('tch.subgroup.who')}</span>
          <ul>
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className={`tch-chip${selected.has(row.id) ? ' is-on' : ''}`}
                  aria-pressed={selected.has(row.id)}
                  onClick={() => toggle(row.id)}
                >
                  {selected.has(row.id) ? <Icon name="check" size={12} aria-hidden /> : null}
                  <span dir="auto">{row.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="tch-subgroup__grid">
          <div className="tch-subgroup__field tch-subgroup__field--wide">
            <label htmlFor={titleId}>{t('tch.subgroup.goalTitle')}</label>
            <input
              id={titleId}
              className="sp-input"
              value={title}
              dir="auto"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="tch-subgroup__field tch-subgroup__field--wide">
            <label htmlFor={stepsId}>{t('tch.subgroup.nextSteps')}</label>
            <textarea
              id={stepsId}
              className="sp-input"
              value={nextSteps}
              dir="auto"
              rows={2}
              placeholder={t('tch.subgroup.nextStepsHint')}
              onChange={(event) => setNextSteps(event.target.value)}
            />
          </div>

          <div className="tch-subgroup__field">
            <label htmlFor={deadlineId}>{t('tch.subgroup.deadline')}</label>
            <input
              id={deadlineId}
              className="sp-input"
              type="date"
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
            />
          </div>
        </div>

        <div className="tch-subgroup__actions">
          <button
            type="button"
            className="sp-btn sp-btn--primary sp-btn--sm"
            disabled={!selected.size || !title.trim() || isBusy}
            onClick={assign}
          >
            {isBusy
              ? t('tch.subgroup.assigning')
              : t('tch.subgroup.assign', { count: selected.size })}
          </button>
        </div>

        {outcome ? (
          <p
            className={`tch-subgroup__outcome tch-subgroup__outcome--${
              outcome.kind === 'assigned' ? 'ok' : 'error'
            }`}
            role="status"
          >
            {outcome.kind === 'error'
              ? t('tch.subgroup.failed')
              : outcome.skipped
                ? t('tch.subgroup.assignedWithSkips', {
                    count: outcome.count, skipped: outcome.skipped,
                  })
                : t('tch.subgroup.assigned', { count: outcome.count })}
          </p>
        ) : null}
      </div>
    </details>
  )
}
