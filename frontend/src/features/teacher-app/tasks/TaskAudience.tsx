/* Who a task is being built for — at the top of the builder, before anything
 * else is decided.
 *
 * The dashboard finds a specific weakness in specific children and then, until
 * now, opened a builder that knew only its own title: the children rode along
 * in the seed, pre-ticked the send dialog after generation, and never once
 * influenced what got WRITTEN. So the system diagnosed precisely and then asked
 * for a generic worksheet.
 *
 * This is the control that closes that. It sits FIRST because it is the
 * strongest input the generator gets — what these children actually got wrong
 * outranks the topic in the prompt — and a decision that shapes everything
 * below it cannot sit underneath everything below it.
 *
 * The list arrives filled from the finding and every child can be removed;
 * anyone else in the class can be added. A teacher who knows that Noa has since
 * got it, or that Ori should be in this too, is the authority here — the
 * detector is a starting point, not a verdict.
 *
 * What travels to the model is NOT this list. At generation the ids resolve
 * server-side into an anonymous shared brief (`tasks/audience.py`): the
 * mistakes these children repeat, the questions they missed, and how many share
 * each. No name and no id ever reaches a prompt.
 */

import { useMemo, useState } from 'react'
import { Icon } from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import { useTeacherRoster } from '../../../providers/TeacherRosterProvider'
import { StudentAvatar } from '../shared/StudentAvatar'

export function TaskAudience({
  value, onChange, subgroupLearnerIds, disabled = false,
}: {
  value: string[]
  onChange: (next: string[]) => void
  /** The class the picker may add from — the scope's roster. */
  subgroupLearnerIds?: string[] | null
  disabled?: boolean
}) {
  const { t } = useI18n()
  const { students, nameOf } = useTeacherRoster()
  const [adding, setAdding] = useState(false)

  /* Everyone in scope who is not already on the list. Sorted by name so the
     picker reads like the roster the teacher knows, not like insertion order. */
  const addable = useMemo(() => {
    const chosen = new Set(value)
    const allowed = subgroupLearnerIds?.length ? new Set(subgroupLearnerIds) : null
    return students
      .filter((row) => !chosen.has(row.learner_id))
      .filter((row) => !allowed || allowed.has(row.learner_id))
      .sort((a, b) => (a.display_name ?? '').localeCompare(b.display_name ?? '', 'he'))
  }, [students, value, subgroupLearnerIds])

  const remove = (learnerId: string) => onChange(value.filter((id) => id !== learnerId))
  const add = (learnerId: string) => {
    if (!learnerId) return
    onChange([...value, learnerId])
    setAdding(false)
  }

  return (
    <section className="tch-audience" aria-labelledby="tch-audience-title">
      <div className="tch-audience__head">
        <h3 className="tch-audience__title" id="tch-audience-title">
          {t('tch.tasks.audience.title')}
        </h3>
        <span className="tch-audience__count">
          {t('tch.tasks.audience.count', { count: value.length })}
        </span>
      </div>

      {/* Said plainly, because it is the surprising part: choosing children
          here changes the QUESTIONS, not just who receives them. */}
      <p className="tch-audience__hint">
        {value.length
          ? t('tch.tasks.audience.hint')
          : t('tch.tasks.audience.hintEmpty')}
      </p>

      <ul className="tch-audience__list">
        {value.map((learnerId) => (
          <li key={learnerId} className="tch-audience__chip">
            <StudentAvatar learnerId={learnerId} name={nameOf(learnerId)} size={22} />
            <span dir="auto">{nameOf(learnerId) ?? ''}</span>
            <button
              type="button"
              className="tch-audience__remove"
              disabled={disabled}
              aria-label={t('tch.tasks.audience.remove', {
                name: nameOf(learnerId) ?? '',
              })}
              onClick={() => remove(learnerId)}
            >
              <Icon name="close" size={12} aria-hidden />
            </button>
          </li>
        ))}

        {adding ? (
          <li className="tch-audience__chip tch-audience__chip--picker">
            {/* A native select: the list is a class, it is already sorted, and
                a custom combobox here would be a keyboard-navigation surface
                to maintain for no gain over the platform's own. */}
            <select
              className="sp-input tch-audience__select"
              autoFocus
              disabled={disabled}
              aria-label={t('tch.tasks.audience.add')}
              defaultValue=""
              onChange={(event) => add(event.target.value)}
              onBlur={() => setAdding(false)}
            >
              <option value="" disabled>{t('tch.tasks.audience.add')}</option>
              {addable.map((row) => (
                <option key={row.learner_id} value={row.learner_id}>
                  {row.display_name ?? row.learner_id}
                </option>
              ))}
            </select>
          </li>
        ) : addable.length ? (
          <li>
            <button
              type="button"
              className="sp-btn sp-btn--ghost sp-btn--sm"
              disabled={disabled}
              onClick={() => setAdding(true)}
            >
              <Icon name="plus" size={13} aria-hidden />
              {t('tch.tasks.audience.add')}
            </button>
          </li>
        ) : null}
      </ul>
    </section>
  )
}
