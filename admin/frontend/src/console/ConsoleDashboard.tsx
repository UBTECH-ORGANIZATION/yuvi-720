/* Organisation console — the control plane, hosted in the admin service.
 *
 * One page, five tabs. What lives here is authority: who exists, who is
 * connected to whom, and the audit trail proving who changed it. Connections
 * are editable from all three directions — from a group, from a teacher, from a
 * student — because "which children can this teacher read?" and "which
 * teachers can read this child?" are both questions a data-protection review
 * asks, and each needs to be one click.
 *
 * The org snapshot and people directory are fetched once here and passed down:
 * every tab needs at least one of them, and a mutation in one tab must be
 * visible in the next without a reload.
 *
 * The shell picks the tab from the location hash (`#org-people`); this page
 * only renders the tab it is told and asks the shell to switch.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError } from '../api'
import { useI18n } from '../i18n/I18nProvider'
import { getOrg, listPeople, type OrgSnapshot, type Person } from './api'
import { AuditTab } from './AuditTab'
import { GamesTab } from './GamesTab'
import { GroupsTab } from './GroupsTab'
import { OverviewTab } from './OverviewTab'
import { PeopleTab } from './PeopleTab'
import { ErrorState, Icon, LoadingState, type IconName } from './primitives'
import { CONSOLE_TABS, ConsoleContext, consoleTabHash, type ConsoleTab } from './shared'
import './console.css'

const TAB_ICON: Record<ConsoleTab, IconName> = {
  overview: 'pulse',
  people: 'users',
  groups: 'teacher',
  games: 'gamepad',
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

export function ConsoleDashboard({ tab, onUnauthorized }: {
  tab: ConsoleTab
  onUnauthorized: () => void
}) {
  const { t } = useI18n()

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
      .catch((reason: unknown) => {
        if (!active) return
        if (reason instanceof ApiError && reason.status === 401) {
          onUnauthorized()
          return
        }
        setError(true)
      })
      .finally(() => {
        if (!active) return
        setIsLoading(false)
        setIsRefreshing(false)
      })
    return () => { active = false }
  }, [nonce, onUnauthorized])

  const shell = useMemo(() => ({
    goToTab: (next: ConsoleTab) => { window.location.hash = consoleTabHash(next) },
    onUnauthorized,
  }), [onUnauthorized])

  if (isLoading) {
    return (
      <main className="adm" aria-busy="true">
        <LoadingState title={t('adm.loading')} />
      </main>
    )
  }
  // A non-admin reaching the console gets a 403 from every endpoint. Say what
  // the problem is rather than showing an empty console that looks broken.
  if (error || !org) {
    return (
      <main className="adm">
        <ErrorState title={t('adm.error')} body={t('adm.error.body')} />
      </main>
    )
  }

  const data: AdminData = { org, people, reload, isRefreshing }

  return (
    <ConsoleContext.Provider value={shell}>
      <main className="adm" aria-busy={isRefreshing}>
        <header className="page-heading adm__head">
          <div>
            <h1>{t('adm.title')}</h1>
            <p>{t('adm.subtitle')}</p>
          </div>
          {isRefreshing ? <span className="adm__refreshing">{t('adm.refreshing')}</span> : null}
        </header>

        <nav className="adm__tabs" aria-label={t('adm.tabs.label')}>
          {CONSOLE_TABS.map((entry) => (
            <a
              key={entry}
              href={consoleTabHash(entry)}
              className={entry === tab ? 'is-active' : ''}
              aria-current={entry === tab ? 'page' : undefined}
            >
              <Icon name={TAB_ICON[entry]} size={15} />
              <span>{t(`adm.tab.${entry}`)}</span>
            </a>
          ))}
        </nav>

        {tab === 'overview' ? <OverviewTab data={data} /> : null}
        {tab === 'people' ? <PeopleTab data={data} /> : null}
        {tab === 'groups' ? <GroupsTab data={data} /> : null}
        {tab === 'games' ? <GamesTab data={data} /> : null}
        {tab === 'audit' ? <AuditTab data={data} /> : null}
      </main>
    </ConsoleContext.Provider>
  )
}
