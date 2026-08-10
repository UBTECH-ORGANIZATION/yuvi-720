/* Overview — counts, and the two things that otherwise go unnoticed.
 *
 * A learner enrolled in no group is invisible to every teacher; a group with no
 * teacher means a whole class nobody is watching. Neither raises an error
 * anywhere else in the product — they are simply absences, and absences are not
 * events. So they get the top of this screen, above the counts, with the fix
 * inline: pick a group and enroll, pick a teacher and link.
 */

import { useEffect, useState } from 'react'
import { navigate } from '../../app/router'
import { Card, EmptyState, Panel } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import {
  enrollLearners, getOverview, linkTeacher, type AdminOverview,
} from '../../services/admin'
import { AuditRow } from './AdminAuditTab'
import type { AdminData } from './AdminConsolePage'
import { AdminSection, RefusalNotice, useAdminMutation } from './AdminShared'

const COUNT_KEYS = ['schools', 'groups', 'teachers', 'students', 'active_links', 'enrollments'] as const

export function AdminOverviewTab({ data }: { data: AdminData }) {
  const { t } = useI18n()
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [nonce, setNonce] = useState(0)

  // Fetched here rather than in the shell: it is a derived report, and it has to
  // be recomputed after a fix applied on this very screen.
  useEffect(() => {
    let active = true
    getOverview().then((result) => { if (active) setOverview(result) }).catch(() => {})
    return () => { active = false }
  }, [nonce])

  const refresh = () => { setNonce((value) => value + 1); data.reload() }
  const mutation = useAdminMutation(refresh)

  const teachers = data.people.filter((person) => person.roles.includes('teacher'))
  const activeGroups = data.org.groups.filter((group) => group.active !== false)

  if (!overview) return <Panel className="adm-panel">{t('adm.loading')}</Panel>

  return (
    <div className="adm-tab">
      <RefusalNotice code={mutation.code} retry={mutation.retry} onDismiss={mutation.clear} />

      <AdminSection title={t('adm.overview.gaps')} hint={t('adm.overview.gaps.hint')}>
        <div className="adm-gapGrid">
          <Panel className="adm-panel adm-panel--warn">
            <h3>{t('adm.overview.unassigned', { count: overview.unassigned_learners.length })}</h3>
            <p className="adm-panel__hint">{t('adm.overview.unassigned.hint')}</p>
            {overview.unassigned_learners.length ? (
              <ul className="adm-list">
                {overview.unassigned_learners.map((learner) => (
                  <li key={learner.learner_id} className="adm-list__row">
                    <span dir="auto">
                      <strong>{learner.display_name || learner.learner_id}</strong>
                      <code className="adm-id">{learner.learner_id}</code>
                    </span>
                    <GroupPicker
                      groups={activeGroups.map((group) => ({ id: group._id, name: group.name }))}
                      actionLabel={t('adm.action.enroll')}
                      busy={mutation.busy}
                      onPick={(groupId) =>
                        mutation.run(() => enrollLearners(groupId, [learner.learner_id]))}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="check" title={t('adm.overview.unassigned.none')} />
            )}
          </Panel>

          <Panel className="adm-panel adm-panel--warn">
            <h3>{t('adm.overview.teacherless', { count: overview.teacherless_groups.length })}</h3>
            <p className="adm-panel__hint">{t('adm.overview.teacherless.hint')}</p>
            {overview.teacherless_groups.length ? (
              <ul className="adm-list">
                {overview.teacherless_groups.map((group) => (
                  <li key={group.id} className="adm-list__row">
                    <span dir="auto">
                      <strong>{group.name || group.id}</strong>
                      <code className="adm-id">{group.id}</code>
                    </span>
                    <GroupPicker
                      groups={teachers.map((person) => ({
                        id: person.user_id, name: person.display_name || person.user_id,
                      }))}
                      actionLabel={t('adm.action.link')}
                      busy={mutation.busy}
                      onPick={(teacherId) => mutation.run(() => linkTeacher(teacherId, group.id))}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="check" title={t('adm.overview.teacherless.none')} />
            )}
          </Panel>
        </div>
      </AdminSection>

      <AdminSection title={t('adm.overview.counts')}>
        <div className="adm-counts">
          {COUNT_KEYS.map((key) => (
            <Card key={key} className="adm-count">
              <span className="adm-count__label">{t(`adm.count.${key}`)}</span>
              <strong className="adm-count__value">{overview.counts[key]}</strong>
            </Card>
          ))}
        </div>
      </AdminSection>

      <AdminSection
        title={t('adm.overview.recent')}
        action={
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                  onClick={() => navigate('/admin?tab=audit')}>
            {t('adm.overview.recent.all')}
          </button>
        }
      >
        {overview.recent_changes.length ? (
          <ul className="adm-audit">
            {overview.recent_changes.map((entry) => (
              <AuditRow key={entry._id} entry={entry} people={data.people} />
            ))}
          </ul>
        ) : (
          <EmptyState title={t('adm.audit.none')} />
        )}
      </AdminSection>
    </div>
  )
}

/** Select + confirm button. Deliberately two steps: a one-click dropdown that
 *  mutates on change makes accidental membership changes trivially easy. */
function GroupPicker({ groups, actionLabel, busy, onPick }: {
  groups: { id: string; name: string | null }[]
  actionLabel: string
  busy: boolean
  onPick: (id: string) => void
}) {
  const { t } = useI18n()
  const [selected, setSelected] = useState('')
  if (!groups.length) return <span className="adm-muted">{t('adm.picker.empty')}</span>
  return (
    <span className="adm-picker">
      <select
        className="sp-input"
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
        aria-label={actionLabel}
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
        onClick={() => onPick(selected)}
      >
        {actionLabel}
      </button>
    </span>
  )
}
