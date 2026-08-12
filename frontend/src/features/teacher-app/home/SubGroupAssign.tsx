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
 *
 * It is a centred dialog rather than a `<details>` that expands in place. The
 * earlier reasoning — that choosing people and editing a goal is a task, not a
 * confirmation, and so belongs in the page — was right about the weight of the
 * work and wrong about where it goes: expanded inline inside the gaps list it
 * nested a chip grid, three fields and two buttons in a row that was already a
 * sentence plus a disclosure, and the teacher lost the list they were reading.
 * A task deserves the whole screen's attention, which is what a dialog is for.
 */

import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../../../components/primitives/Icon'
import { Modal } from '../../../components/primitives/Modal'
import { useI18n } from '../../../i18n/I18nProvider'
import { assignGroupGoal } from '../../../services/teacher'
import { countKey } from '../shared/countLabel'

interface Props {
  /** The sub-group to act on. Comes from `learning_gaps.learner_ids` or from a
   *  brief action — either way it is computed from evidence, never chosen by a
   *  model and never ordered by anything the teacher could read as a ranking. */
  candidates: string[]
  /** Stable id for the form's label/input pairs. */
  id: string
  /** What the goal is called before the teacher edits it. */
  defaultTitle: string
  groupId: string
  /** Roster names, so the teacher picks people rather than opaque ids. */
  names: Map<string, string | null>
  open: boolean
  onClose: () => void
}

type Outcome =
  | { kind: 'assigned'; count: number; skipped: number; first: string }
  | { kind: 'error' }

/** A week out, matching the default the learner-side goal composer uses. */
function defaultDeadline(): string {
  const date = new Date()
  date.setDate(date.getDate() + 7)
  return date.toISOString().slice(0, 10)
}

export function SubGroupAssign({
  candidates, id, defaultTitle, groupId, names, open, onClose,
}: Props) {
  const { t, language } = useI18n()

  const [selected, setSelected] = useState<Set<string>>(() => new Set(candidates))
  const [title, setTitle] = useState(defaultTitle)
  const [nextSteps, setNextSteps] = useState('')
  const [deadline, setDeadline] = useState(defaultDeadline)
  const [isBusy, setIsBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  /* Reopening with a different gap must not show the previous gap's title and
     the previous gap's people. The dialog unmounts its Modal but this
     component stays mounted at the call site, so state has to be reset here. */
  useEffect(() => {
    if (!open) return
    setSelected(new Set(candidates))
    setTitle(defaultTitle)
    setNextSteps('')
    setDeadline(defaultDeadline())
    setOutcome(null)
  }, [open, candidates, defaultTitle])

  const rows = useMemo(
    () => candidates.map((learnerId) => ({
      id: learnerId, name: names.get(learnerId) ?? learnerId,
    })),
    [candidates, names]
  )

  if (!candidates.length) return null

  function toggle(learnerId: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(learnerId)) next.delete(learnerId)
      else next.add(learnerId)
      return next
    })
  }

  const nameOfFirst = (ids: string[]) =>
    names.get(ids[0] ?? '') ?? ids[0] ?? ''

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
        first: nameOfFirst(result.assigned),
      })
    } catch {
      setOutcome({ kind: 'error' })
    } finally {
      setIsBusy(false)
    }
  }

  const headingId = `subgroup-heading-${id}`
  const titleId = `subgroup-title-${id}`
  const stepsId = `subgroup-steps-${id}`
  const deadlineId = `subgroup-deadline-${id}`

  return (
    <Modal open={open} onClose={onClose} titleId={headingId} className="tch-subgroup__modal">
      <h2 id={headingId} className="tch-subgroup__heading" dir="auto">
        {t('tch.subgroup.dialogTitle')}
      </h2>

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

        {/* Keeping this selection as a named sub-group used to be a second
            button here. Sub-groups have their own screen now — created, named,
            re-membered and archived on the roster — and offering a half-version
            of that inside a goal dialog meant two ways to make one thing, one
            of which could not edit what it made. */}

        {outcome ? (
          <p
            className={`tch-subgroup__outcome tch-subgroup__outcome--${
              outcome.kind === 'error' ? 'error' : 'ok'
            }`}
            role="status"
          >
            {outcome.kind === 'error'
              ? t('tch.subgroup.failed')
              : outcome.skipped
                ? t(countKey('tch.subgroup.assignedWithSkips', outcome.count), {
                    count: outcome.count, skipped: outcome.skipped, name: outcome.first,
                  })
                : t(countKey('tch.subgroup.assigned', outcome.count), {
                    count: outcome.count, name: outcome.first,
                  })}
          </p>
        ) : null}
      </div>

      <div className="tch-subgroup__actions">
        <button
          type="button"
          className="sp-btn sp-btn--primary sp-btn--sm"
          disabled={!selected.size || !title.trim() || isBusy}
          onClick={() => void assign()}
        >
          {isBusy
            ? t('tch.subgroup.assigning')
            : t(countKey('tch.subgroup.assign', selected.size), {
                count: selected.size, name: nameOfFirst([...selected]),
              })}
        </button>

        <span className="tch-subgroup__spacer" />
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={onClose}>
          {t('tch.subgroup.close')}
        </button>
      </div>
    </Modal>
  )
}
