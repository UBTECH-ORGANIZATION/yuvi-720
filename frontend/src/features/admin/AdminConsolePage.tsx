/* Admin console (F8, plan A9b) — the control plane.
 *
 * One route, four tabs. The admin does NOT get a parallel dashboard: they use
 * the ordinary teacher app with the group switcher unlocked to every group
 * (`org.groups_for_teacher` already returns all groups for an admin), which is
 * what satisfies "למנהל צריכה להיות גישה להצגת כל התלמידים וקבוצות הלימוד
 * בדשבורד" without a second implementation to drift.
 *
 * What lives here instead is authority: who exists, who is connected to whom,
 * and the audit trail proving who changed it. Connections are editable from all
 * three directions — from a group, from a teacher, from a student — because
 * "which children can this teacher read?" and "which teachers can read this
 * child?" are both questions a data-protection review asks, and each needs to
 * be one click.
 *
 * The org snapshot and people directory are fetched once here and passed down:
 * every tab needs at least one of them, and a mutation in one tab must be
 * visible in the next without a reload.
 */

import { useCallback, useEffect, useState } from 'react'
import { navigate, useRoute } from '../../app/router'
import { ErrorState, Icon, LoadingState } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { getOrg, listPeople, type OrgSnapshot, type Person } from '../../services/admin'
import { AdminAuditTab } from './AdminAuditTab'
import { AdminGroupsTab } from './AdminGroupsTab'
import { AdminOverviewTab } from './AdminOverviewTab'
import { AdminPeopleTab } from './AdminPeopleTab'
import './admin-console.css'

const TABS = ['overview', 'people', 'groups', 'audit'] as const
export type AdminTab = (typeof TABS)[number]

const TAB_ICON: Record<AdminTab, 'pulse' | 'users' | 'teacher' | 'clock'> = {
  overview: 'pulse',
  people: 'users',
  groups: 'teacher',
  audit: 'clock',
}

/** Shared by every tab: the org graph, the directory, and a way to say "I
 *  changed something, refetch". */
export interface AdminData {
  org: OrgSnapshot
  people: Person[]
  reload: () => void
  isRefreshing: boolean
}

function tabFromRoute(route: string): AdminTab {
  const value = new URLSearchParams(route.split('?')[1] ?? '').get('tab')
  return (TABS as readonly string[]).includes(value ?? '') ? (value as AdminTab) : 'overview'
}

export function AdminConsolePage() {
  const { t } = useI18n()
  const route = useRoute()
  const tab = tabFromRoute(route)

  const [org, setOrg] = useState<OrgSnapshot | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState(false)
  // Bumped by `reload()`; the fetch effect keys off it so any tab can force a
  // refresh after a mutation without owning the fetch itself.
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((value) => value + 1), [])

  useEffect(() => {
    let active = true
    if (nonce > 0) setIsRefreshing(true)
    setError(false)
    Promise.all([getOrg(), listPeople()])
      .then(([orgResult, peopleResult]) => {
        if (!active) return
        setOrg(orgResult)
        setPeople(peopleResult.people ?? [])
      })
      .catch(() => { if (active) setError(true) })
      .finally(() => {
        if (!active) return
        setIsLoading(false)
        setIsRefreshing(false)
      })
    return () => { active = false }
  }, [nonce])

  if (isLoading) return <LoadingState title={t('adm.loading')} />
  // A non-admin reaching the console gets a 403 from every endpoint. Say what
  // the problem is rather than showing an empty console that looks broken.
  if (error || !org) return <ErrorState title={t('adm.error')} body={t('adm.error.body')} />

  const data: AdminData = { org, people, reload, isRefreshing }

  return (
    <div className="adm">
      <header className="adm__head">
        <div>
          <h1>{t('adm.title')}</h1>
          <p className="adm__subtitle">{t('adm.subtitle')}</p>
        </div>
        {isRefreshing ? <span className="adm__refreshing">{t('adm.refreshing')}</span> : null}
      </header>

      <nav className="adm__tabs" aria-label={t('adm.tabs.label')}>
        {TABS.map((entry) => (
          <button
            key={entry}
            type="button"
            className={entry === tab ? 'is-active' : ''}
            aria-current={entry === tab ? 'page' : undefined}
            onClick={() => navigate(`/admin?tab=${entry}`)}
          >
            <Icon name={TAB_ICON[entry]} size={15} aria-hidden="true" />
            <span>{t(`adm.tab.${entry}`)}</span>
          </button>
        ))}
      </nav>

      {tab === 'overview' ? <AdminOverviewTab data={data} /> : null}
      {tab === 'people' ? <AdminPeopleTab data={data} /> : null}
      {tab === 'groups' ? <AdminGroupsTab data={data} /> : null}
      {tab === 'audit' ? <AdminAuditTab data={data} /> : null}
    </div>
  )
}
