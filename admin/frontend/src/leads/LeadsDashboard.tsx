import { useCallback, useEffect, useMemo, useState, type DragEvent, type FormEvent } from 'react'
import { ApiError, getLeads, leadsExportUrl, updateLead } from '../api'
import { useI18n } from '../i18n/I18nProvider'
import type { Lead, LeadBoard, LeadFilters, LeadStatus } from '../types'

const DAY_OPTIONS = [7, 30, 90, 365]
type ViewMode = 'table' | 'kanban'

export function LeadsDashboard({ onUnauthorized }: { onUnauthorized: () => void }) {
  const { t, language } = useI18n()
  const [days, setDays] = useState<number | ''>('')
  const [status, setStatus] = useState<LeadStatus | ''>('')
  const [source, setSource] = useState('')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<LeadFilters>({})
  const [view, setView] = useState<ViewMode>('table')
  const [board, setBoard] = useState<LeadBoard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [requestKey, setRequestKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(false)
    getLeads(filters, controller.signal)
      .then(setBoard)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        if (reason instanceof ApiError && reason.status === 401) {
          onUnauthorized()
          return
        }
        setError(true)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [filters, onUnauthorized, requestKey])

  const statuses = board?.statuses ?? []
  const selected = useMemo(
    () => board?.leads.find((lead) => lead.lead_id === selectedId) ?? null,
    [board, selectedId],
  )

  const applyLead = useCallback((lead: Lead) => {
    setBoard((current) => {
      if (!current) return current
      const leads = current.leads.map((item) => (item.lead_id === lead.lead_id ? lead : item))
      const counts: Record<string, number> = {}
      for (const value of current.statuses) counts[value] = 0
      for (const item of leads) counts[item.status] = (counts[item.status] ?? 0) + 1
      return { ...current, leads, counts_by_status: counts }
    })
  }, [])

  const save = useCallback(
    async (leadId: string, changes: { status?: LeadStatus; notes?: string }) => {
      setSaveError(false)
      try {
        applyLead(await updateLead(leadId, changes))
      } catch (reason: unknown) {
        if (reason instanceof ApiError && reason.status === 401) {
          onUnauthorized()
          return
        }
        setSaveError(true)
      }
    },
    [applyLead, onUnauthorized],
  )

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFilters({
      days: days === '' ? undefined : days,
      status: status || undefined,
      source: source || undefined,
      search: search.trim() || undefined,
    })
  }
  const clear = () => {
    setDays('')
    setStatus('')
    setSource('')
    setSearch('')
    setFilters({})
  }

  return (
    <main className="leads-page" id="leads" aria-busy={loading}>
      <header className="page-heading">
        <div>
          <p className="eyebrow">{t('nav.growth')}</p>
          <h1>{t('leads.title')}</h1>
          <p>{t('leads.subtitle')}</p>
        </div>
        {board ? <span className="live-pill"><i aria-hidden="true" />{t('leads.count', { count: board.total })}</span> : null}
      </header>

      <form className="toolbar-panel" onSubmit={submit}>
        <label>
          <span>{t('leads.period')}</span>
          <select value={days} onChange={(event) => setDays(event.target.value === '' ? '' : Number(event.target.value))}>
            <option value="">{t('leads.allTime')}</option>
            {DAY_OPTIONS.map((option) => (
              <option key={option} value={option}>{t('usage.days', { count: option })}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('leads.status')}</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as LeadStatus | '')}>
            <option value="">{t('leads.allStatuses')}</option>
            {statuses.map((value) => (
              <option key={value} value={value}>{t(`leads.status.${value}`)}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('leads.source')}</span>
          <select value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="">{t('leads.allSources')}</option>
            {(board?.sources ?? []).map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('leads.search')}</span>
          <input dir="auto" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('leads.searchPlaceholder')} />
        </label>
        <div className="filter-actions">
          <button className="button button--primary" type="submit">{t('usage.applyFilters')}</button>
          <button className="button button--quiet" type="button" onClick={clear}>{t('usage.clearFilters')}</button>
        </div>
      </form>

      <div className="leads-toolbar">
        <div className="view-switch" role="group" aria-label={t('leads.view')}>
          <button
            type="button"
            className={`button button--small${view === 'table' ? ' button--primary' : ' button--quiet'}`}
            aria-pressed={view === 'table'}
            onClick={() => setView('table')}
          >
            {t('leads.view.table')}
          </button>
          <button
            type="button"
            className={`button button--small${view === 'kanban' ? ' button--primary' : ' button--quiet'}`}
            aria-pressed={view === 'kanban'}
            onClick={() => setView('kanban')}
          >
            {t('leads.view.kanban')}
          </button>
        </div>
        <a className="button button--quiet button--small" href={leadsExportUrl(filters)} download>
          {t('leads.export')}
        </a>
      </div>

      <div className="privacy-strip" role="note">
        <span aria-hidden="true">◈</span>
        <p>{t('leads.privacyNote')}</p>
      </div>

      {saveError ? <div className="notice notice--error" role="alert">{t('leads.saveError')}</div> : null}

      {error ? (
        <section className="panel error-state" role="alert">
          <p>{t('leads.error')}</p>
          <button className="button button--primary button--small" type="button" onClick={() => setRequestKey((value) => value + 1)}>
            {t('usage.retry')}
          </button>
        </section>
      ) : null}

      {loading && !board ? <p className="empty-state">{t('leads.loading')}</p> : null}

      {board && !error ? (
        board.leads.length === 0 ? (
          <section className="panel"><p className="empty-state">{t('leads.empty')}</p></section>
        ) : view === 'table' ? (
          <LeadTable leads={board.leads} language={language} onOpen={setSelectedId} />
        ) : (
          <LeadKanban board={board} onOpen={setSelectedId} onMove={(leadId, next) => void save(leadId, { status: next })} />
        )
      ) : null}

      {selected ? (
        <LeadDetail
          lead={selected}
          statuses={statuses}
          language={language}
          onClose={() => setSelectedId(null)}
          onSave={(changes) => void save(selected.lead_id, changes)}
        />
      ) : null}
    </main>
  )
}

function formatDate(value: string | null, language: string, style: 'short' | 'long' = 'short'): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(language, {
    dateStyle: style === 'short' ? 'short' : 'medium',
    timeStyle: 'short',
  }).format(date)
}

function LeadTable({
  leads,
  language,
  onOpen,
}: {
  leads: Lead[]
  language: string
  onOpen: (leadId: string) => void
}) {
  const { t } = useI18n()
  return (
    <section className="panel table-panel">
      <header><h2>{t('leads.tableTitle')}</h2><span>{leads.length}</span></header>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('leads.field.createdAt')}</th>
              <th>{t('leads.field.fullName')}</th>
              <th>{t('leads.field.organization')}</th>
              <th>{t('leads.field.city')}</th>
              <th>{t('leads.field.phone')}</th>
              <th>{t('leads.field.email')}</th>
              <th>{t('leads.status')}</th>
              <th>{t('leads.details')}</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.lead_id}>
                <td>{formatDate(lead.created_at, language)}</td>
                <td dir="auto"><strong>{lead.full_name}</strong><small>{lead.role}</small></td>
                <td dir="auto">{lead.organization}</td>
                <td dir="auto">{lead.city}</td>
                <td dir="ltr">{lead.phone}</td>
                <td dir="ltr">{lead.email}</td>
                <td><span className={`lead-status lead-status--${lead.status}`}>{t(`leads.status.${lead.status}`)}</span></td>
                <td>
                  <button className="button button--quiet button--small" type="button" onClick={() => onOpen(lead.lead_id)}>
                    {t('leads.open')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function LeadKanban({
  board,
  onOpen,
  onMove,
}: {
  board: LeadBoard
  onOpen: (leadId: string) => void
  onMove: (leadId: string, status: LeadStatus) => void
}) {
  const { t, language } = useI18n()
  const [dragOver, setDragOver] = useState<LeadStatus | null>(null)

  const drop = (event: DragEvent<HTMLElement>, status: LeadStatus) => {
    event.preventDefault()
    setDragOver(null)
    const leadId = event.dataTransfer.getData('text/plain')
    if (!leadId) return
    const lead = board.leads.find((item) => item.lead_id === leadId)
    if (lead && lead.status !== status) onMove(leadId, status)
  }

  return (
    <div className="kanban" role="list">
      {board.statuses.map((status) => {
        const columnLeads = board.leads.filter((lead) => lead.status === status)
        return (
          <section
            key={status}
            role="listitem"
            className={`kanban-column${dragOver === status ? ' kanban-column--over' : ''}`}
            aria-label={t(`leads.status.${status}`)}
            onDragOver={(event) => {
              event.preventDefault()
              setDragOver(status)
            }}
            onDragLeave={() => setDragOver((current) => (current === status ? null : current))}
            onDrop={(event) => drop(event, status)}
          >
            <header className={`kanban-column__head kanban-column__head--${status}`}>
              <h2>{t(`leads.status.${status}`)}</h2>
              <span>{columnLeads.length}</span>
            </header>
            <div className="kanban-column__body">
              {columnLeads.map((lead) => (
                <article
                  key={lead.lead_id}
                  className="lead-card"
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData('text/plain', lead.lead_id)}
                >
                  <button className="lead-card__open" type="button" onClick={() => onOpen(lead.lead_id)}>
                    <strong dir="auto">{lead.full_name}</strong>
                    <span dir="auto">{lead.organization}</span>
                  </button>
                  <p dir="auto" className="lead-card__meta">{lead.role}{lead.city ? ` · ${lead.city}` : ''}</p>
                  <p className="lead-card__date">{formatDate(lead.created_at, language)}</p>
                  <label className="lead-card__move">
                    <span className="visually-hidden">{t('leads.moveTo')}</span>
                    <select value={lead.status} onChange={(event) => onMove(lead.lead_id, event.target.value as LeadStatus)}>
                      {board.statuses.map((value) => (
                        <option key={value} value={value}>{t(`leads.status.${value}`)}</option>
                      ))}
                    </select>
                  </label>
                </article>
              ))}
              {columnLeads.length === 0 ? <p className="kanban-column__empty">{t('leads.columnEmpty')}</p> : null}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function LeadDetail({
  lead,
  statuses,
  language,
  onClose,
  onSave,
}: {
  lead: Lead
  statuses: LeadStatus[]
  language: string
  onClose: () => void
  onSave: (changes: { status?: LeadStatus; notes?: string }) => void
}) {
  const { t } = useI18n()
  const [notes, setNotes] = useState(lead.notes ?? '')

  useEffect(() => setNotes(lead.notes ?? ''), [lead.lead_id, lead.notes])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <aside className="lead-detail" role="dialog" aria-modal="false" aria-label={t('leads.detailTitle')}>
      <header>
        <div>
          <h2 dir="auto">{lead.full_name}</h2>
          <p dir="auto">{lead.role} · {lead.organization}</p>
        </div>
        <button className="button button--quiet button--small" type="button" onClick={onClose}>{t('leads.close')}</button>
      </header>

      <dl className="lead-detail__fields">
        <Field label={t('leads.field.createdAt')} value={formatDate(lead.created_at, language, 'long')} />
        <Field label={t('leads.field.city')} value={lead.city} />
        <Field label={t('leads.field.phone')} value={lead.phone} dir="ltr" />
        <Field label={t('leads.field.email')} value={lead.email} dir="ltr" />
        <Field label={t('leads.field.grades')} value={lead.grades} />
        <Field label={t('leads.field.source')} value={lead.source} />
        <Field label={t('leads.field.message')} value={lead.message} />
        <Field label={t('leads.field.updatedBy')} value={lead.updated_by ?? '—'} dir="ltr" />
      </dl>

      <label className="lead-detail__control">
        <span>{t('leads.status')}</span>
        <select value={lead.status} onChange={(event) => onSave({ status: event.target.value as LeadStatus })}>
          {statuses.map((value) => (
            <option key={value} value={value}>{t(`leads.status.${value}`)}</option>
          ))}
        </select>
      </label>

      <label className="lead-detail__control">
        <span>{t('leads.notes')}</span>
        <textarea dir="auto" rows={4} value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <button
        className="button button--primary button--small"
        type="button"
        disabled={notes === (lead.notes ?? '')}
        onClick={() => onSave({ notes })}
      >
        {t('leads.saveNotes')}
      </button>
    </aside>
  )
}

function Field({ label, value, dir = 'auto' }: { label: string; value: string; dir?: 'auto' | 'ltr' }) {
  return (
    <div className="lead-detail__field">
      <dt>{label}</dt>
      <dd dir={dir}>{value || '—'}</dd>
    </div>
  )
}
