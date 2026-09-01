/* The class's named slices, as one compact row of chips above the roster.
 *
 * These were full cards carrying a names preview each — a whole band of the
 * screen spent restating what the dialog already holds. A chip carries what a
 * glance needs: the name, the size, and the two actions; the full roster of a
 * group lives in its edit dialog.
 *
 * The chip is still the SCOPE control — selecting one narrows every number and
 * every row below it. "Everyone" is a chip too, and the first one, so the
 * default is a thing the teacher chose rather than an absence of choice.
 */

import { Hint, Icon, Skeleton } from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import type { Subgroup } from '../../../services/teacher'

interface Props {
  total: number
  subgroups: Subgroup[]
  /** The selected sub-group's id, or null for the whole class. */
  selected: string | null
  /** Learner id → name, for the who-is-in-it tooltip. */
  nameOf: (learnerId: string) => string
  onSelect: (subgroupId: string | null) => void
  onEdit: (subgroup: Subgroup) => void
  onDelete: (subgroup: Subgroup) => void
  onCreate: () => void
  busy: boolean
}

export function SubgroupBar({
  total, subgroups, selected, nameOf, onSelect, onEdit, onDelete, onCreate, busy,
}: Props) {
  const { t } = useI18n()

  return (
    <section className="tch-subgroups" aria-label={t('tch.subgroups.switcher')}>
      <button
        type="button"
        className={`tch-subgroup${selected === null ? ' is-active' : ''}`}
        aria-pressed={selected === null}
        onClick={() => onSelect(null)}
      >
        <span className="tch-subgroup__name">{t('tch.subgroups.wholeClass')}</span>
        {/* The size is the one thing here the fetch still owes — a grey pip
            until it lands, never a confident 0. */}
        <span className="tch-subgroup__count">
          {busy ? <Skeleton w={14} h={11} r={999} /> : total}
        </span>
      </button>

      {subgroups.map((subgroup) => (
        <div
          key={subgroup.id}
          className={`tch-subgroup tch-subgroup--named${
            selected === subgroup.id ? ' is-active' : ''}`}
        >
          {/* The chip selects; the two actions sit outside that button,
              because a button inside a button is not a thing a browser honours
              and "edit" must not also change what the page is showing.
              WHO is in the group rides the hover — the names preview that used
              to make each of these a full card. */}
          <Hint text={(
            <span dir="auto">
              {subgroup.learner_ids.map(nameOf).join(' · ')}
            </span>
          )}>
            <button
              type="button"
              className="tch-subgroup__pick"
              aria-pressed={selected === subgroup.id}
              onClick={() => onSelect(subgroup.id)}
            >
              <span className="tch-subgroup__name" dir="auto">{subgroup.name}</span>
              <span className="tch-subgroup__count">
                {subgroup.size}
                {/* Drawn as six, now five: say which and why, rather than letting
                    the teacher wonder whether the count is broken. */}
                {subgroup.dropped.length ? (
                  <span className="tch-subgroup__dropped"
                        title={t('tch.subgroups.droppedHint', { count: subgroup.dropped.length })}>
                    −{subgroup.dropped.length}
                  </span>
                ) : null}
              </span>
            </button>
          </Hint>

          <button type="button" className="tch-subgroup__action"
                  aria-label={t('tch.subgroups.edit', { name: subgroup.name })}
                  title={t('tch.subgroups.edit', { name: subgroup.name })}
                  onClick={() => onEdit(subgroup)}>
            <Icon name="wand" size={13} />
          </button>
          <button type="button" className="tch-subgroup__action tch-subgroup__action--danger"
                  aria-label={t('tch.subgroups.deleteNamed', { name: subgroup.name })}
                  title={t('tch.subgroups.deleteNamed', { name: subgroup.name })}
                  onClick={() => onDelete(subgroup)}>
            <Icon name="trash" size={13} />
          </button>
        </div>
      ))}

      {/* Last, and always present — including when there are no groups at all,
          which is the moment a teacher most needs to be told this exists. */}
      <button type="button" className="tch-subgroup tch-subgroup--new" onClick={onCreate}>
        <Icon name="plus" size={14} aria-hidden />
        <span className="tch-subgroup__name">{t('tch.subgroups.create')}</span>
      </button>
    </section>
  )
}
