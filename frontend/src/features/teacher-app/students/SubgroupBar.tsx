/* The class's named slices, as cards at the top of the roster.
 *
 * This was a row of chips with a caret menu hidden on each. Chips said "filter"
 * and the menu said nothing at all until it was opened, so a teacher looking for
 * "where do I edit my groups" found a subtitle. Cards say "these are objects you
 * own": each carries its size, who is in it, and its two actions in the open.
 *
 * The card is still the SCOPE control — selecting one narrows every number and
 * every row below it. One object doing both jobs rather than a filter bar and a
 * management panel that would each have to be kept in step with the other.
 *
 * "Everyone" is a card too, and the first one, so the default is a thing the
 * teacher chose rather than an absence of choice.
 */

import { Icon } from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import type { Subgroup } from '../../../services/teacher'

interface Props {
  total: number
  subgroups: Subgroup[]
  /** The selected sub-group's id, or null for the whole class. */
  selected: string | null
  /** Learner id → name, for the members line. */
  nameOf: (learnerId: string) => string
  onSelect: (subgroupId: string | null) => void
  onEdit: (subgroup: Subgroup) => void
  onDelete: (subgroup: Subgroup) => void
  onCreate: () => void
  busy: boolean
}

/** How many names fit on a card before it stops being a glance. */
const NAMES_SHOWN = 4

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
        <span className="tch-subgroup__count">
          {t('tch.subgroups.members', { count: busy ? 0 : total })}
        </span>
      </button>

      {subgroups.map((subgroup) => (
        <div
          key={subgroup.id}
          className={`tch-subgroup tch-subgroup--named${
            selected === subgroup.id ? ' is-active' : ''}`}
        >
          {/* The whole card selects; the two actions sit outside that button,
              because a button inside a button is not a thing a browser honours
              and "edit" must not also change what the page is showing. */}
          <button
            type="button"
            className="tch-subgroup__pick"
            aria-pressed={selected === subgroup.id}
            onClick={() => onSelect(subgroup.id)}
          >
            <span className="tch-subgroup__name" dir="auto">{subgroup.name}</span>
            <span className="tch-subgroup__count">
              {t('tch.subgroups.members', { count: subgroup.size })}
              {/* Drawn as six, now five: say which and why, rather than letting
                  the teacher wonder whether the count is broken. */}
              {subgroup.dropped.length ? (
                <span className="tch-subgroup__dropped"
                      title={t('tch.subgroups.droppedHint', { count: subgroup.dropped.length })}>
                  −{subgroup.dropped.length}
                </span>
              ) : null}
            </span>
            <span className="tch-subgroup__who" dir="auto">
              {subgroup.learner_ids.slice(0, NAMES_SHOWN).map(nameOf).join(' · ')}
              {subgroup.learner_ids.length > NAMES_SHOWN
                ? ` +${subgroup.learner_ids.length - NAMES_SHOWN}` : ''}
            </span>
          </button>

          <div className="tch-subgroup__actions">
            <button type="button" className="tch-subgroup__action"
                    aria-label={t('tch.subgroups.edit', { name: subgroup.name })}
                    title={t('tch.subgroups.edit', { name: subgroup.name })}
                    onClick={() => onEdit(subgroup)}>
              <Icon name="wand" size={14} />
            </button>
            <button type="button" className="tch-subgroup__action tch-subgroup__action--danger"
                    aria-label={t('tch.subgroups.deleteNamed', { name: subgroup.name })}
                    title={t('tch.subgroups.deleteNamed', { name: subgroup.name })}
                    onClick={() => onDelete(subgroup)}>
              <Icon name="trash" size={14} />
            </button>
          </div>
        </div>
      ))}

      {/* Last, and always present — including when there are no groups at all,
          which is the moment a teacher most needs to be told this exists. */}
      <button type="button" className="tch-subgroup tch-subgroup--new" onClick={onCreate}>
        <Icon name="plus" size={16} aria-hidden />
        <span className="tch-subgroup__name">{t('tch.subgroups.create')}</span>
      </button>
    </section>
  )
}
