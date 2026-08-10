/* Groups — the third direction on the same connections, plus roster import.
 *
 * A group's two membership lists sit side by side because that is how a school
 * secretary thinks about a class: these teachers, those students. Add and remove
 * on either side.
 *
 * Groups are **archived, never deleted**. The LRS statements and mentoring
 * records that point at a group must stay resolvable after the school year ends,
 * so the destructive-looking action is a state change and the UI says so.
 */

import { useMemo, useState } from 'react'
import { EmptyState, Icon, Panel, StatusPill } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import {
  archiveGroup, enrollLearners, importRoster, linkTeacher, saveGroup,
  unenrollLearner, unlinkTeacher, type ImportResult,
} from '../../services/admin'
import type { AdminData } from './AdminConsolePage'
import { AdminSection, RefusalNotice, nameOf, useAdminMutation } from './AdminShared'

export function AdminGroupsTab({ data }: { data: AdminData }) {
  const { t } = useI18n()
  const [selected, setSelected] = useState<string | null>(data.org.groups[0]?._id ?? null)
  const mutation = useAdminMutation(data.reload)

  const group = data.org.groups.find((entry) => entry._id === selected) ?? null

  const members = useMemo(() => {
    if (!group) return { teachers: [] as string[], learners: [] as string[] }
    return {
      teachers: data.org.teacher_links
        .filter((link) => link.group_id === group._id)
        .map((link) => link.teacher_id),
      learners: data.org.enrollments
        .filter((row) => row.group_id === group._id)
        .map((row) => row.learner_id),
    }
  }, [group, data.org])

  const teacherPool = data.people.filter((person) => person.roles.includes('teacher'))
  const learnerPool = data.people.filter((person) => person.roles.includes('learner'))

  return (
    <div className="adm-tab">
      <div className="adm-groups">
        <div className="adm-groups__list">
          <AdminSection title={t('adm.groups.title')}>
            <ul className="adm-list adm-list--people">
              {data.org.groups.map((entry) => (
                <li key={entry._id}>
                  <button
                    type="button"
                    className={`adm-personRow${entry._id === selected ? ' is-active' : ''}`}
                    onClick={() => setSelected(entry._id)}
                  >
                    <span className="adm-personRow__name" dir="auto">{entry.name || entry._id}</span>
                    <span className="adm-personRow__meta">
                      {entry.active === false
                        ? <StatusPill tone="neutral">{t('adm.groups.archived')}</StatusPill>
                        : null}
                      <code className="adm-id">{entry._id}</code>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {!data.org.groups.length ? <EmptyState title={t('adm.groups.none')} /> : null}
          </AdminSection>

          <CreateGroupPanel data={data} />
          <RosterImportPanel onCommitted={data.reload} />
        </div>

        <div className="adm-groups__detail">
          {group ? (
            <Panel className="adm-panel adm-detail">
              <header className="adm-detail__head">
                <div>
                  <h2 dir="auto">{group.name || group._id}</h2>
                  <code className="adm-id">{group._id}</code>
                </div>
                <button
                  type="button"
                  className="sp-btn sp-btn--sm adm-btn--danger"
                  disabled={mutation.busy || group.active === false}
                  onClick={() => mutation.run(() => archiveGroup(group._id))}
                >
                  {group.active === false ? t('adm.groups.archived') : t('adm.action.archive')}
                </button>
              </header>
              <p className="adm-muted">{t('adm.groups.archiveHint')}</p>

              <RefusalNotice code={mutation.code} retry={mutation.retry} onDismiss={mutation.clear} />

              <div className="adm-membership">
                <MembershipColumn
                  title={t('adm.groups.teachers', { count: members.teachers.length })}
                  memberIds={members.teachers}
                  people={data.people}
                  pool={teacherPool.filter((person) => !members.teachers.includes(person.user_id))}
                  addLabel={t('adm.action.link')}
                  removeLabel={t('adm.action.unlink')}
                  busy={mutation.busy}
                  onAdd={(userId) => mutation.run(() => linkTeacher(userId, group._id))}
                  onRemove={(userId) => mutation.run((confirm) =>
                    unlinkTeacher(userId, group._id, confirm))}
                />
                <MembershipColumn
                  title={t('adm.groups.students', { count: members.learners.length })}
                  memberIds={members.learners}
                  people={data.people}
                  pool={learnerPool.filter((person) => !members.learners.includes(person.user_id))}
                  addLabel={t('adm.action.enroll')}
                  removeLabel={t('adm.action.unenroll')}
                  busy={mutation.busy}
                  onAdd={(userId) => mutation.run(() => enrollLearners(group._id, [userId]))}
                  onRemove={(userId) => mutation.run(() => unenrollLearner(userId, group._id))}
                />
              </div>
            </Panel>
          ) : (
            <Panel className="adm-panel"><EmptyState title={t('adm.groups.pick')} /></Panel>
          )}
        </div>
      </div>
    </div>
  )
}

function MembershipColumn({
  title, memberIds, people, pool, addLabel, removeLabel, busy, onAdd, onRemove,
}: {
  title: string
  memberIds: string[]
  people: AdminData['people']
  pool: AdminData['people']
  addLabel: string
  removeLabel: string
  busy: boolean
  onAdd: (userId: string) => void
  onRemove: (userId: string) => void
}) {
  const { t } = useI18n()
  const [selected, setSelected] = useState('')

  return (
    <div className="adm-membership__col">
      <h3>{title}</h3>
      {memberIds.length ? (
        <ul className="adm-list">
          {memberIds.map((userId) => (
            <li key={userId} className="adm-list__row">
              <span dir="auto">
                <strong>{nameOf(people, userId)}</strong>
                <code className="adm-id">{userId}</code>
              </span>
              <button
                type="button"
                className="sp-btn sp-btn--ghost sp-btn--sm adm-btn--danger"
                disabled={busy}
                onClick={() => onRemove(userId)}
              >
                {removeLabel}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={t('adm.groups.empty')} />
      )}

      {pool.length ? (
        <div className="adm-picker adm-picker--block">
          <select
            className="sp-input"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            aria-label={addLabel}
          >
            <option value="">{t('adm.picker.choose')}</option>
            {pool.map((person) => (
              <option key={person.user_id} value={person.user_id}>
                {person.display_name || person.user_id}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="sp-btn sp-btn--sm"
            disabled={!selected || busy}
            onClick={() => { onAdd(selected); setSelected('') }}
          >
            {addLabel}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function CreateGroupPanel({ data }: { data: AdminData }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [schoolId, setSchoolId] = useState(data.org.schools[0]?._id ?? '')
  const [subject, setSubject] = useState('')
  const mutation = useAdminMutation(data.reload)

  return (
    <Panel className="adm-panel adm-create">
      <button type="button" className="adm-create__toggle" aria-expanded={open}
              onClick={() => setOpen((value) => !value)}>
        <Icon name={open ? 'chevronUp' : 'plus'} size={15} aria-hidden="true" />
        {t('adm.groups.create')}
      </button>
      {open ? (
        <div className="adm-create__form">
          <RefusalNotice code={mutation.code} retry={mutation.retry} onDismiss={mutation.clear} />
          <label>
            <span>{t('adm.groups.field.id')}</span>
            <input className="sp-input" value={id} onChange={(event) => setId(event.target.value)} />
          </label>
          <label>
            <span>{t('adm.groups.field.name')}</span>
            <input className="sp-input" value={name} dir="auto"
                   onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            <span>{t('adm.groups.field.school')}</span>
            <select className="sp-input" value={schoolId}
                    onChange={(event) => setSchoolId(event.target.value)}>
              {data.org.schools.map((school) => (
                <option key={school._id} value={school._id}>{school.name || school._id}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('adm.groups.field.subject')}</span>
            <input className="sp-input" value={subject}
                   onChange={(event) => setSubject(event.target.value)} />
          </label>
          <button
            type="button"
            className="sp-btn sp-btn--sm"
            disabled={!id.trim() || !schoolId || mutation.busy}
            onClick={() => mutation.run(async () => {
              const result = await saveGroup({
                id: id.trim(), school_id: schoolId,
                name: name.trim() || id.trim(), subject: subject.trim() || undefined,
              })
              setId(''); setName(''); setSubject('')
              return result
            })}
          >
            {t('adm.groups.create')}
          </button>
        </div>
      ) : null}
    </Panel>
  )
}

/** Preview then commit. A roster import is the most destructive operation an
 *  admin can run; it should never be the first time they learn what it will do. */
function RosterImportPanel({ onCommitted }: { onCommitted: () => void }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState('')
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [parseError, setParseError] = useState(false)
  const mutation = useAdminMutation(() => {})

  const parsed = () => {
    try {
      setParseError(false)
      return JSON.parse(raw) as unknown
    } catch {
      setParseError(true)
      return null
    }
  }

  return (
    <Panel className="adm-panel adm-create">
      <button type="button" className="adm-create__toggle" aria-expanded={open}
              onClick={() => setOpen((value) => !value)}>
        <Icon name={open ? 'chevronUp' : 'plus'} size={15} aria-hidden="true" />
        {t('adm.import.title')}
      </button>
      {open ? (
        <div className="adm-create__form">
          <p className="adm-muted">{t('adm.import.hint')}</p>
          <RefusalNotice code={mutation.code} retry={mutation.retry} onDismiss={mutation.clear} />
          <textarea
            className="sp-input adm-import__input"
            rows={6}
            value={raw}
            spellCheck={false}
            placeholder='{"schools": [], "groups": [], "teacher_links": [], "enrollments": []}'
            onChange={(event) => { setRaw(event.target.value); setPreview(null) }}
          />
          {parseError ? <p className="adm-refusal" role="alert">{t('adm.import.badJson')}</p> : null}

          <div className="adm-import__actions">
            <button
              type="button"
              className="sp-btn sp-btn--sm"
              disabled={!raw.trim() || mutation.busy}
              onClick={() => {
                const roster = parsed()
                if (!roster) return
                mutation.run(async () => {
                  const result = await importRoster(roster, false)
                  setPreview(result)
                  return result
                })
              }}
            >
              {t('adm.import.preview')}
            </button>
            <button
              type="button"
              className="sp-btn sp-btn--sm adm-btn--danger"
              disabled={!preview || mutation.busy}
              onClick={() => {
                const roster = parsed()
                if (!roster) return
                mutation.run(async () => {
                  const result = await importRoster(roster, true)
                  setPreview(result)
                  onCommitted()
                  return result
                })
              }}
            >
              {t('adm.import.commit')}
            </button>
          </div>

          {preview ? (
            <div className="adm-import__diff" role="status">
              <p>
                {preview.committed ? t('adm.import.committed') : t('adm.import.previewed')}
                {' · '}
                {t('adm.import.counts', {
                  added: preview.diff.added.length,
                  updated: preview.diff.updated.length,
                  unchanged: preview.diff.unchanged.length,
                })}
              </p>
              <ul className="adm-list">
                {[...preview.diff.added, ...preview.diff.updated].slice(0, 20).map((entry) => (
                  <li key={`${entry.kind}:${entry.id}`} className="adm-list__row">
                    <span><code className="adm-id">{entry.kind}</code> {entry.id}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Panel>
  )
}
