/* Making a sub-group, and amending one, in a dialog.
 *
 * This used to be a MODE on the roster: pressing a button turned the table into
 * a checkbox grid, a strip appeared at the top, and naming the result opened a
 * second dialog afterwards. Three problems with that, all of which a teacher
 * hit:
 *
 *   the roster stopped being a roster while you were choosing, so you could not
 *   read the thing you were choosing FROM — the status column, the last-seen
 *   column, the reason a child is flagged, which is exactly what you pick on;
 *
 *   the name was asked for last, in a separate dialog, after the work;
 *
 *   and creating was reachable from one of the two views only.
 *
 * One dialog, everything in it, from anywhere. Same component for creating and
 * for editing membership — they differ by what is already ticked and by which
 * call they end in, and having two of these is how the two drift apart.
 *
 * The name is optional. A teacher drawing "the six who are stuck on fractions"
 * is thinking about the six, not about what to call them, and a required field
 * in front of that is a toll gate — so an unnamed group gets a default that
 * says what it is.
 */

import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../../../components/primitives'
import { Modal } from '../../../components/primitives/Modal'
import { useI18n } from '../../../i18n/I18nProvider'
import type { Subgroup } from '../../../services/teacher'
import { StudentAvatar } from '../shared/StudentAvatar'

export interface SubgroupDraft {
  name: string
  learnerIds: string[]
}

interface Props {
  open: boolean
  /** Null when creating; the group being amended otherwise. */
  editing: Subgroup | null
  /** Everyone in THIS class — never the teacher's whole roster. */
  roster: { id: string; name: string }[]
  busy?: boolean
  error?: string
  onClose: () => void
  onSave: (draft: SubgroupDraft) => void
}

export function SubgroupDialog({
  open, editing, roster, busy, error, onClose, onSave,
}: Props) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')

  /* Reopening starts from what this dialog is FOR: an edit starts from the
     group's current membership, a create starts empty. A selection left over
     from the last time is a selection nobody made for this one. */
  useEffect(() => {
    if (!open) return
    setName(editing?.name ?? '')
    setPicked(new Set(editing?.learner_ids ?? []))
    setQuery('')
  }, [open, editing])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? roster.filter((row) => row.name.toLowerCase().includes(needle)) : roster
  }, [roster, query])

  const toggle = (id: string) => setPicked((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const allShown = shown.length > 0 && shown.every((row) => picked.has(row.id))

  return (
    <Modal open={open} onClose={onClose} titleId="tch-subgroup-title"
           className="tch-subgroupDialog" dismissible={false}>
      <h2 id="tch-subgroup-title" className="tch-builder__modalTitle" dir="auto">
        {editing ? t('tch.subgroups.editTitle', { name: editing.name })
          : t('tch.subgroups.createTitle')}
      </h2>

      <div className="tch-subgroupDialog__body">
        <label className="tch-builder__field">
          <span>{t('tch.subgroups.nameOptional')}</span>
          <input className="sp-input" value={name} dir="auto"
                 placeholder={t('tch.subgroups.namePlaceholder')}
                 onChange={(event) => setName(event.target.value)} />
        </label>

        <div className="tch-builder__field">
          <div className="tch-launch__head">
            <label htmlFor="tch-subgroup-search">
              {t('tch.subgroups.pickedCount', { count: picked.size })}
            </label>
            <button type="button" className="tch-builder__discard"
                    onClick={() => setPicked((current) => {
                      const next = new Set(current)
                      for (const row of shown) {
                        if (allShown) next.delete(row.id)
                        else next.add(row.id)
                      }
                      return next
                    })}>
              {allShown ? t('tch.tasks.launchClear') : t('tch.tasks.launchAll')}
            </button>
          </div>
          <input id="tch-subgroup-search" className="sp-input" value={query} dir="auto"
                 placeholder={t('tch.tasks.launchSearch')}
                 onChange={(event) => setQuery(event.target.value)} />
          <ul className="tch-launch__list">
            {shown.map((row) => (
              <li key={row.id}>
                <label className="tch-launch__row">
                  <input type="checkbox" checked={picked.has(row.id)}
                         onChange={() => toggle(row.id)} />
                  <StudentAvatar learnerId={row.id} name={row.name} size={26} />
                  <span dir="auto">{row.name}</span>
                </label>
              </li>
            ))}
            {shown.length === 0 ? (
              <li className="tch-builder__hint">{t('tch.tasks.launchNoMatch')}</li>
            ) : null}
          </ul>
        </div>
      </div>

      {error ? <p className="tch-builder__failed" role="alert" dir="auto">{error}</p> : null}

      <div className="tch-builder__actions">
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={onClose}>
          {t('tch.subgroups.cancel')}
        </button>
        <button type="button" className="sp-btn sp-btn--sm"
                disabled={picked.size === 0 || busy}
                onClick={() => onSave({ name: name.trim(), learnerIds: [...picked] })}>
          <Icon name="users" size={15} />
          {busy ? t('tch.tasks.working') : t('tch.subgroups.save')}
        </button>
      </div>
    </Modal>
  )
}
