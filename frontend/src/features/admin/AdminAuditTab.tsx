/* Activity log — append-only, newest first.
 *
 * "Who gave this teacher access to this child, and when" must always be
 * answerable. That is not a nice-to-have for a system holding minors' data, so
 * the log is a tab rather than a debugging endpoint, and every row can be opened
 * to its literal before/after documents — the same explainability discipline the
 * teacher app applies to attention flags.
 */

import { useEffect, useState } from 'react'
import { EmptyState, Icon, Panel } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { listAudit, type AuditEntry, type Person } from '../../services/admin'
import type { AdminData } from './AdminConsolePage'
import { AdminSection, nameOf } from './AdminShared'

export function AdminAuditTab({ data }: { data: AdminData }) {
  const { t } = useI18n()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [actorId, setActorId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    setIsLoading(true)
    listAudit({
      actor_id: actorId || undefined,
      target_id: targetId.trim() || undefined,
      limit: 200,
    })
      .then((result) => { if (active) setEntries(result.entries ?? []) })
      .catch(() => { if (active) setEntries([]) })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [actorId, targetId])

  const actors = [...new Set(entries.map((entry) => entry.actor_id))]

  return (
    <div className="adm-tab">
      <AdminSection title={t('adm.audit.title')} hint={t('adm.audit.hint')}>
        <div className="adm-filters">
          <label className="adm-search">
            <span className="sp-sr-only">{t('adm.audit.byActor')}</span>
            <select className="sp-input" value={actorId}
                    onChange={(event) => setActorId(event.target.value)}
                    aria-label={t('adm.audit.byActor')}>
              <option value="">{t('adm.audit.allActors')}</option>
              {actors.map((entry) => (
                <option key={entry} value={entry}>{nameOf(data.people, entry)}</option>
              ))}
            </select>
          </label>
          <label className="adm-search">
            <Icon name="search" size={15} aria-hidden="true" />
            <span className="sp-sr-only">{t('adm.audit.byTarget')}</span>
            <input
              type="search"
              className="sp-input"
              value={targetId}
              placeholder={t('adm.audit.byTarget')}
              onChange={(event) => setTargetId(event.target.value)}
            />
          </label>
        </div>

        {isLoading ? <p className="adm-muted">{t('adm.loading')}</p> : null}

        {entries.length ? (
          <ul className="adm-audit">
            {entries.map((entry) => (
              <AuditRow key={entry._id} entry={entry} people={data.people} />
            ))}
          </ul>
        ) : (
          !isLoading ? <EmptyState title={t('adm.audit.none')} /> : null
        )}
      </AdminSection>
    </div>
  )
}

/** Also rendered on Overview's "recent changes", so it lives here with the tab
 *  that owns the audit vocabulary rather than being duplicated. */
export function AuditRow({ entry, people }: { entry: AuditEntry; people: Person[] }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const actionKey = `adm.audit.action.${entry.action}`
  const action = t(actionKey)

  return (
    <li className="adm-auditRow">
      <div className="adm-auditRow__head">
        <span className="adm-auditRow__action" dir="auto">
          {/* New backend actions must not surface as a raw key. */}
          {action === actionKey ? entry.action : action}
        </span>
        <span className="adm-auditRow__who" dir="auto">
          {t('adm.audit.by', { actor: nameOf(people, entry.actor_id) })}
        </span>
        <time className="adm-auditRow__at" dateTime={entry.at}>
          {new Date(entry.at).toLocaleString()}
        </time>
      </div>
      <div className="adm-auditRow__target">
        <code className="adm-id">{entry.target_type}</code>
        <span dir="auto">{entry.target_id}</span>
      </div>
      {entry.before || entry.after ? (
        <>
          <button
            type="button"
            className="adm-auditRow__toggle"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <Icon name={open ? 'chevronUp' : 'chevronLeft'} size={13} aria-hidden="true" />
            {t('adm.audit.diff')}
          </button>
          {open ? (
            <Panel className="adm-auditRow__diff">
              <div>
                <h4>{t('adm.audit.before')}</h4>
                <pre>{JSON.stringify(entry.before, null, 2) ?? '—'}</pre>
              </div>
              <div>
                <h4>{t('adm.audit.after')}</h4>
                <pre>{JSON.stringify(entry.after, null, 2) ?? '—'}</pre>
              </div>
            </Panel>
          ) : null}
        </>
      ) : null}
    </li>
  )
}
