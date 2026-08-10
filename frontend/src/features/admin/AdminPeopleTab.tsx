/* People — one directory of every teacher and student, and the connections view.
 *
 * This is where the many-to-many becomes honest. Selecting a **teacher** answers
 * "which children can this person read?"; selecting a **student** answers "which
 * teachers can read this child, and what grants it?" — with the granting group
 * named on every row, because the grant is never a direct edge and a UI that
 * implies otherwise teaches the wrong model.
 *
 * Both directions revoke inline, and revocation lands on the next request: scope
 * is read from the database per call, never from the 12-hour session token.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { navigate } from '../../app/router'
import { EmptyState, Icon, Panel, StatusPill } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import {
  createUser, enrollLearners, getLearnerConnections, getTeacherConnections,
  grantAdmin, linkTeacher, revokeAdmin, unenrollLearner, unlinkTeacher,
  type CreatedUser, type LearnerConnections, type Person, type TeacherConnections,
} from '../../services/admin'
import type { AdminData } from './AdminConsolePage'
import { AdminSection, RefusalNotice, nameOf, useAdminMutation } from './AdminShared'

type RoleFilter = 'all' | 'teacher' | 'learner'

export function AdminPeopleTab({ data }: { data: AdminData }) {
  const { t } = useI18n()
  const [role, setRole] = useState<RoleFilter>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return data.people
      .filter((person) => role === 'all' || person.roles.includes(role))
      .filter((person) => !needle
        || person.user_id.toLowerCase().includes(needle)
        || (person.display_name ?? '').toLowerCase().includes(needle))
      // Alphabetical, never ranked — this is a directory, not a leaderboard.
      .sort((a, b) => (a.display_name ?? a.user_id).localeCompare(b.display_name ?? b.user_id))
  }, [data.people, role, query])

  const person = data.people.find((entry) => entry.user_id === selected) ?? null

  return (
    <div className="adm-tab">
      <div className="adm-people">
        <div className="adm-people__list">
          <div className="adm-filters">
            <div className="adm-filters__roles" role="group" aria-label={t('adm.people.filterRole')}>
              {(['all', 'teacher', 'learner'] as RoleFilter[]).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className={entry === role ? 'is-active' : ''}
                  aria-pressed={entry === role}
                  onClick={() => setRole(entry)}
                >
                  {t(`adm.people.role.${entry}`)}
                </button>
              ))}
            </div>
            <label className="adm-search">
              <Icon name="search" size={15} aria-hidden="true" />
              <span className="sp-sr-only">{t('adm.people.search')}</span>
              <input
                type="search"
                className="sp-input"
                value={query}
                placeholder={t('adm.people.search')}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>

          <p className="adm-muted">{t('adm.people.count', { count: rows.length })}</p>

          <ul className="adm-list adm-list--people">
            {rows.map((entry) => (
              <li key={entry.user_id}>
                <button
                  type="button"
                  className={`adm-personRow${entry.user_id === selected ? ' is-active' : ''}`}
                  onClick={() => setSelected(entry.user_id)}
                >
                  <span className="adm-personRow__name" dir="auto">
                    {entry.display_name || entry.user_id}
                  </span>
                  <span className="adm-personRow__meta">
                    {entry.roles.map((entryRole) => (
                      <StatusPill key={entryRole} tone={entryRole === 'teacher' ? 'strong' : 'neutral'}>
                        {t(`adm.role.${entryRole}`)}
                      </StatusPill>
                    ))}
                    <code className="adm-id">{entry.user_id}</code>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {!rows.length ? <EmptyState title={t('adm.people.none')} /> : null}

          <CreateAccountPanel onCreated={data.reload} />
        </div>

        <div className="adm-people__detail">
          {person
            ? <PersonDetail key={person.user_id} person={person} data={data} />
            : <Panel className="adm-panel"><EmptyState title={t('adm.people.pick')} /></Panel>}
        </div>
      </div>
    </div>
  )
}

/* ── detail: connections from both directions ─────────────────────────────── */

function PersonDetail({ person, data }: { person: Person; data: AdminData }) {
  const { t } = useI18n()
  const [teacherConnections, setTeacherConnections] = useState<TeacherConnections | null>(null)
  const [learnerConnections, setLearnerConnections] = useState<LearnerConnections | null>(null)
  const [nonce, setNonce] = useState(0)

  const isTeacher = person.roles.includes('teacher')
  const isLearner = person.roles.includes('learner')

  const refresh = useCallback(() => { setNonce((value) => value + 1); data.reload() }, [data])
  const mutation = useAdminMutation(refresh)

  useEffect(() => {
    let active = true
    if (isTeacher) {
      getTeacherConnections(person.user_id)
        .then((result) => { if (active) setTeacherConnections(result) }).catch(() => {})
    }
    if (isLearner) {
      getLearnerConnections(person.user_id)
        .then((result) => { if (active) setLearnerConnections(result) }).catch(() => {})
    }
    return () => { active = false }
  }, [person.user_id, isTeacher, isLearner, nonce])

  const activeGroups = data.org.groups.filter((group) => group.active !== false)
  const linkedGroupIds = new Set((teacherConnections?.groups ?? []).map((group) => group._id))
  const enrolledGroupIds = new Set(
    (learnerConnections?.granted_via ?? []).map((grant) => grant.group_id)
  )
  // A learner in a teacherless group has no grants, so `granted_via` cannot be
  // the source of truth for what they are enrolled in.
  const enrolledFromOrg = data.org.enrollments
    .filter((row) => row.learner_id === person.user_id)
    .map((row) => row.group_id)
  enrolledFromOrg.forEach((groupId) => enrolledGroupIds.add(groupId))

  return (
    <Panel className="adm-panel adm-detail">
      <header className="adm-detail__head">
        <div>
          <h2 dir="auto">{person.display_name || person.user_id}</h2>
          <code className="adm-id">{person.user_id}</code>
        </div>
        <div className="adm-detail__roles">
          {person.roles.map((entryRole) => (
            <StatusPill key={entryRole} tone={entryRole === 'teacher' ? 'strong' : 'neutral'}>
              {t(`adm.role.${entryRole}`)}
            </StatusPill>
          ))}
          {teacherConnections?.is_admin ? (
            <StatusPill tone="support">{t('adm.role.admin')}</StatusPill>
          ) : null}
        </div>
      </header>

      <RefusalNotice code={mutation.code} retry={mutation.retry} onDismiss={mutation.clear} />

      {isTeacher ? (
        <AdminSection
          title={t('adm.detail.teaches')}
          hint={t('adm.detail.teaches.hint', {
            count: teacherConnections?.reachable_count ?? 0,
          })}
          action={
            <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                    onClick={() => navigate('/teacher')}>
              {t('adm.detail.openDashboard')}
            </button>
          }
        >
          {teacherConnections?.groups.length ? (
            <ul className="adm-list">
              {teacherConnections.groups.map((group) => (
                <li key={group._id} className="adm-list__row">
                  <span dir="auto">
                    <strong>{group.name || group._id}</strong>
                    <code className="adm-id">{group._id}</code>
                  </span>
                  <button
                    type="button"
                    className="sp-btn sp-btn--sm adm-btn--danger"
                    disabled={mutation.busy}
                    onClick={() => mutation.run((confirm) =>
                      unlinkTeacher(person.user_id, group._id, confirm))}
                  >
                    {t('adm.action.unlink')}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={t('adm.detail.teaches.none')} />
          )}

          <AddToGroup
            groups={activeGroups
              .filter((group) => !linkedGroupIds.has(group._id))
              .map((group) => ({ id: group._id, name: group.name }))}
            label={t('adm.action.link')}
            busy={mutation.busy}
            onPick={(groupId) => mutation.run(() => linkTeacher(person.user_id, groupId))}
          />

          <div className="adm-adminGrant">
            {teacherConnections?.is_admin ? (
              <button
                type="button"
                className="sp-btn sp-btn--sm adm-btn--danger"
                disabled={mutation.busy}
                onClick={() => mutation.run(() => revokeAdmin(person.user_id))}
              >
                {t('adm.action.revokeAdmin')}
              </button>
            ) : (
              <button
                type="button"
                className="sp-btn sp-btn--sm"
                disabled={mutation.busy}
                onClick={() => mutation.run(() => grantAdmin(person.user_id))}
              >
                {t('adm.action.grantAdmin')}
              </button>
            )}
            <p className="adm-muted">{t('adm.detail.adminHint')}</p>
          </div>
        </AdminSection>
      ) : null}

      {isLearner ? (
        <AdminSection title={t('adm.detail.readBy')} hint={t('adm.detail.readBy.hint')}>
          {learnerConnections?.granted_via.length ? (
            <ul className="adm-list">
              {learnerConnections.granted_via.map((grant) => (
                <li key={`${grant.teacher_id}:${grant.group_id}`} className="adm-list__row">
                  <span dir="auto">
                    <strong>{nameOf(data.people, grant.teacher_id)}</strong>
                    {/* The granting group, always named: access is never direct. */}
                    <span className="adm-muted">
                      {' '}{t('adm.detail.via', { group: grant.group_name || grant.group_id })}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="sp-btn sp-btn--sm adm-btn--danger"
                    disabled={mutation.busy}
                    onClick={() => mutation.run(() =>
                      unenrollLearner(person.user_id, grant.group_id))}
                  >
                    {t('adm.action.unenroll')}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={t('adm.detail.readBy.none')} body={t('adm.detail.readBy.noneBody')} />
          )}

          <AddToGroup
            groups={activeGroups
              .filter((group) => !enrolledGroupIds.has(group._id))
              .map((group) => ({ id: group._id, name: group.name }))}
            label={t('adm.action.enroll')}
            busy={mutation.busy}
            onPick={(groupId) => mutation.run(() => enrollLearners(groupId, [person.user_id]))}
          />
        </AdminSection>
      ) : null}
    </Panel>
  )
}

function AddToGroup({ groups, label, busy, onPick }: {
  groups: { id: string; name: string | null }[]
  label: string
  busy: boolean
  onPick: (groupId: string) => void
}) {
  const { t } = useI18n()
  const [selected, setSelected] = useState('')
  if (!groups.length) return null
  return (
    <div className="adm-picker adm-picker--block">
      <select
        className="sp-input"
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
        aria-label={label}
      >
        <option value="">{t('adm.picker.choose')}</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>{group.name || group.id}</option>
        ))}
      </select>
      <button
        type="button"
        className="sp-btn sp-btn--sm"
        disabled={!selected || busy}
        onClick={() => { onPick(selected); setSelected('') }}
      >
        {label}
      </button>
    </div>
  )
}

/* ── account provisioning ─────────────────────────────────────────────────── */

/** Admin-provisioned, never self-signup. The temp password is shown once and the
 *  account carries `must_change_password`, so the generated secret cannot quietly
 *  become a permanent one. */
function CreateAccountPanel({ onCreated }: { onCreated: () => void }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [roles, setRoles] = useState<string[]>(['learner'])
  const [created, setCreated] = useState<CreatedUser | null>(null)
  const mutation = useAdminMutation(onCreated)

  const toggleRole = (role: string) => setRoles((current) =>
    current.includes(role) ? current.filter((entry) => entry !== role) : [...current, role])

  const submit = () => {
    setCreated(null)
    mutation.run(async () => {
      const result = await createUser({
        username: username.trim(),
        display_name: displayName.trim() || undefined,
        roles,
      })
      setCreated(result)
      setUsername(''); setDisplayName('')
      return result
    })
  }

  return (
    <Panel className="adm-panel adm-create">
      <button
        type="button"
        className="adm-create__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={open ? 'chevronUp' : 'plus'} size={15} aria-hidden="true" />
        {t('adm.create.title')}
      </button>

      {open ? (
        <div className="adm-create__form">
          <RefusalNotice code={mutation.code} retry={mutation.retry} onDismiss={mutation.clear} />
          <label>
            <span>{t('adm.create.username')}</span>
            <input className="sp-input" value={username}
                   onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label>
            <span>{t('adm.create.displayName')}</span>
            <input className="sp-input" value={displayName} dir="auto"
                   onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <div className="adm-create__roles" role="group" aria-label={t('adm.create.roles')}>
            {['learner', 'teacher'].map((role) => (
              <label key={role} className="adm-checkbox">
                <input type="checkbox" checked={roles.includes(role)}
                       onChange={() => toggleRole(role)} />
                <span>{t(`adm.role.${role}`)}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            className="sp-btn sp-btn--sm"
            disabled={!username.trim() || !roles.length || mutation.busy}
            onClick={submit}
          >
            {t('adm.create.submit')}
          </button>

          {created ? (
            <div className="adm-create__result" role="status">
              <p>{t('adm.create.done', { name: created.user.display_name || created.user.user_id })}</p>
              <p className="adm-create__password">
                {t('adm.create.tempPassword')}: <code>{created.temp_password}</code>
              </p>
              <p className="adm-muted">{t('adm.create.onceOnly')}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </Panel>
  )
}
