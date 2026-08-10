import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { ApiError, getSupportTickets, supportExportUrl, updateSupportTicket } from '../api'
import { useI18n } from '../i18n/I18nProvider'
import { SupportChatConsole } from './SupportChatConsole'
import type {
  SupportBoard,
  SupportFilters,
  SupportTicket,
  TicketCategory,
  TicketReporterType,
  TicketSeverity,
  TicketStatus,
} from '../types'

const DAY_OPTIONS = [7, 30, 90, 365]
const CATEGORIES: TicketCategory[] = ['bug', 'content', 'access', 'performance', 'other']
const SEVERITIES: TicketSeverity[] = ['blocking', 'high', 'normal', 'low']
const REPORTER_TYPES: TicketReporterType[] = ['learner', 'teacher', 'guest']
const CONTEXT_FIELDS = ['route', 'user_agent', 'viewport', 'language', 'theme', 'app_version', 'occurred_at']

export function SupportDashboard({ onUnauthorized }: { onUnauthorized: () => void }) {
  const { t, language } = useI18n()
  const [days, setDays] = useState<number | ''>('')
  const [status, setStatus] = useState<TicketStatus | ''>('')
  const [severity, setSeverity] = useState<TicketSeverity | ''>('')
  const [category, setCategory] = useState<TicketCategory | ''>('')
  const [reporterType, setReporterType] = useState<TicketReporterType | ''>('')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<SupportFilters>({})
  const [board, setBoard] = useState<SupportBoard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [requestKey, setRequestKey] = useState(0)
  const [view, setView] = useState<'tickets' | 'chat'>('tickets')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(false)
    getSupportTickets(filters, controller.signal)
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
    () => board?.tickets.find((ticket) => ticket.ticket_id === selectedId) ?? null,
    [board, selectedId],
  )

  const applyTicket = useCallback((ticket: SupportTicket) => {
    setBoard((current) => {
      if (!current) return current
      const tickets = current.tickets.map((item) =>
        item.ticket_id === ticket.ticket_id ? ticket : item,
      )
      const counts: Record<string, number> = {}
      for (const value of current.statuses) counts[value] = 0
      for (const item of tickets) counts[item.status] = (counts[item.status] ?? 0) + 1
      return { ...current, tickets, counts_by_status: counts }
    })
  }, [])

  const save = useCallback(
    async (ticketId: string, changes: { status?: TicketStatus; admin_notes?: string }) => {
      setSaveError(false)
      try {
        applyTicket(await updateSupportTicket(ticketId, changes))
      } catch (reason: unknown) {
        if (reason instanceof ApiError && reason.status === 401) {
          onUnauthorized()
          return
        }
        setSaveError(true)
      }
    },
    [applyTicket, onUnauthorized],
  )

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFilters({
      days: days === '' ? undefined : days,
      status: status || undefined,
      severity: severity || undefined,
      category: category || undefined,
      reporterType: reporterType || undefined,
      search: search.trim() || undefined,
    })
  }
  const clear = () => {
    setDays('')
    setStatus('')
    setSeverity('')
    setCategory('')
    setReporterType('')
    setSearch('')
    setFilters({})
  }

  return (
    <main className="leads-page" id="support" aria-busy={loading}>
      <header className="page-heading">
        <div>
          <p className="eyebrow">{t('nav.support')}</p>
          <h1>{t('support.title')}</h1>
          <p>{t('support.subtitle')}</p>
        </div>
        {board ? (
          <span className="live-pill">
            <i aria-hidden="true" />
            {t('support.count', { count: board.total })}
          </span>
        ) : null}
      </header>

      <div className="view-switch" role="group" aria-label={t('support.viewLabel')}>
        <button
          type="button"
          className={`button button--small${view === 'tickets' ? ' button--primary' : ' button--quiet'}`}
          aria-pressed={view === 'tickets'}
          onClick={() => setView('tickets')}
        >
          {t('support.view.tickets')}
        </button>
        <button
          type="button"
          className={`button button--small${view === 'chat' ? ' button--primary' : ' button--quiet'}`}
          aria-pressed={view === 'chat'}
          onClick={() => setView('chat')}
        >
          {t('support.view.chat')}
        </button>
      </div>

      {view === 'chat' ? <SupportChatConsole onUnauthorized={onUnauthorized} /> : (
       <>
      <form className="toolbar-panel" onSubmit={submit}>
        <label>
          <span>{t('leads.period')}</span>
          <select
            value={days}
            onChange={(event) => setDays(event.target.value === '' ? '' : Number(event.target.value))}
          >
            <option value="">{t('leads.allTime')}</option>
            {DAY_OPTIONS.map((option) => (
              <option key={option} value={option}>{t('usage.days', { count: option })}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('support.status')}</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as TicketStatus | '')}>
            <option value="">{t('support.allStatuses')}</option>
            {statuses.map((value) => (
              <option key={value} value={value}>{t(`support.status.${value}`)}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('support.severity')}</span>
          <select value={severity} onChange={(event) => setSeverity(event.target.value as TicketSeverity | '')}>
            <option value="">{t('support.allSeverities')}</option>
            {SEVERITIES.map((value) => (
              <option key={value} value={value}>{t(`support.severity.${value}`)}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('support.category')}</span>
          <select value={category} onChange={(event) => setCategory(event.target.value as TicketCategory | '')}>
            <option value="">{t('support.allCategories')}</option>
            {CATEGORIES.map((value) => (
              <option key={value} value={value}>{t(`support.category.${value}`)}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('support.reporter')}</span>
          <select
            value={reporterType}
            onChange={(event) => setReporterType(event.target.value as TicketReporterType | '')}
          >
            <option value="">{t('support.allReporters')}</option>
            {REPORTER_TYPES.map((value) => (
              <option key={value} value={value}>{t(`support.reporter.${value}`)}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('leads.search')}</span>
          <input
            dir="auto"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('support.searchPlaceholder')}
          />
        </label>
        <div className="filter-actions">
          <button className="button button--primary" type="submit">{t('usage.applyFilters')}</button>
          <button className="button button--quiet" type="button" onClick={clear}>{t('usage.clearFilters')}</button>
        </div>
      </form>

      <div className="leads-toolbar">
        <div className="status-summary" role="group" aria-label={t('support.status')}>
          {statuses.map((value) => (
            <span key={value} className={`lead-status lead-status--${value}`}>
              {t(`support.status.${value}`)} · {board?.counts_by_status[value] ?? 0}
            </span>
          ))}
        </div>
        <a className="button button--quiet button--small" href={supportExportUrl(filters)} download>
          {t('support.export')}
        </a>
      </div>

      <div className="privacy-strip" role="note">
        <span aria-hidden="true">◈</span>
        <p>{t('support.privacyNote')}</p>
      </div>

      {saveError ? <div className="notice notice--error" role="alert">{t('support.saveError')}</div> : null}

      {error ? (
        <section className="panel error-state" role="alert">
          <p>{t('support.error')}</p>
          <button
            className="button button--primary button--small"
            type="button"
            onClick={() => setRequestKey((value) => value + 1)}
          >
            {t('usage.retry')}
          </button>
        </section>
      ) : null}

      {loading && !board ? <p className="empty-state">{t('support.loading')}</p> : null}

      {board && !error ? (
        board.tickets.length === 0 ? (
          <section className="panel"><p className="empty-state">{t('support.empty')}</p></section>
        ) : (
          <TicketTable tickets={board.tickets} language={language} onOpen={setSelectedId} />
        )
      ) : null}

      {selected ? (
        <TicketDetail
          ticket={selected}
          statuses={statuses}
          language={language}
          onClose={() => setSelectedId(null)}
          onSave={(changes) => void save(selected.ticket_id, changes)}
        />
      ) : null}
       </>
      )}
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

function TicketTable({
  tickets,
  language,
  onOpen,
}: {
  tickets: SupportTicket[]
  language: string
  onOpen: (ticketId: string) => void
}) {
  const { t } = useI18n()
  return (
    <section className="panel">
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('support.field.createdAt')}</th>
              <th>{t('support.field.severity')}</th>
              <th>{t('support.field.title')}</th>
              <th>{t('support.field.category')}</th>
              <th>{t('support.field.reporter')}</th>
              <th>{t('support.status')}</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => (
              <tr key={ticket.ticket_id} onClick={() => onOpen(ticket.ticket_id)} tabIndex={0}>
                <td>{formatDate(ticket.created_at, language)}</td>
                <td>
                  <span className={`severity-tag severity-tag--${ticket.severity}`}>
                    {t(`support.severity.${ticket.severity}`)}
                  </span>
                </td>
                <td dir="auto">{ticket.title}</td>
                <td>{t(`support.category.${ticket.category}`)}</td>
                <td dir="auto">
                  {t(`support.reporter.${ticket.reporter_type}`)}
                  {ticket.reporter_name ? ` · ${ticket.reporter_name}` : ''}
                </td>
                <td>
                  <span className={`lead-status lead-status--${ticket.status}`}>
                    {t(`support.status.${ticket.status}`)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function TicketDetail({
  ticket,
  statuses,
  language,
  onClose,
  onSave,
}: {
  ticket: SupportTicket
  statuses: TicketStatus[]
  language: string
  onClose: () => void
  onSave: (changes: { status?: TicketStatus; admin_notes?: string }) => void
}) {
  const { t } = useI18n()
  const [notes, setNotes] = useState(ticket.admin_notes ?? '')

  useEffect(() => setNotes(ticket.admin_notes ?? ''), [ticket.ticket_id, ticket.admin_notes])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const context = CONTEXT_FIELDS.map((key) => [key, ticket.context?.[key]] as const).filter(
    (entry): entry is readonly [string, string] => Boolean(entry[1]),
  )

  return (
    <aside className="lead-detail" role="dialog" aria-modal="false" aria-label={t('support.detailTitle')}>
      <header>
        <div>
          <h2 dir="auto">{ticket.title}</h2>
          <p dir="auto">
            {t(`support.reporter.${ticket.reporter_type}`)}
            {ticket.reporter_name ? ` · ${ticket.reporter_name}` : ''}
          </p>
        </div>
        <button className="button button--quiet button--small" type="button" onClick={onClose}>
          {t('leads.close')}
        </button>
      </header>

      <dl className="lead-detail__fields">
        <Field label={t('support.field.createdAt')} value={formatDate(ticket.created_at, language, 'long')} />
        <Field label={t('support.field.severity')} value={t(`support.severity.${ticket.severity}`)} />
        <Field label={t('support.field.category')} value={t(`support.category.${ticket.category}`)} />
        <Field label={t('support.field.source')} value={t(`support.source.${ticket.source}`)} />
        <Field label={t('support.field.reporterId')} value={ticket.reporter_id ?? '—'} dir="ltr" />
        <Field label={t('support.field.contactEmail')} value={ticket.contact_email} dir="ltr" />
        <Field label={t('support.field.description')} value={ticket.description} />
        <Field label={t('support.field.updatedBy')} value={ticket.updated_by ?? '—'} dir="ltr" />
      </dl>

      {context.length > 0 ? (
        <dl className="lead-detail__fields">
          {context.map(([key, value]) => (
            <Field key={key} label={t(`support.context.${key}`)} value={value} dir="ltr" />
          ))}
        </dl>
      ) : null}

      {ticket.attachments.length > 0 ? (
        <div className="lead-detail__control">
          <span>{t('support.attachments')}</span>
          <ul className="support-attachments">
            {ticket.attachments.map((item) => (
              <li key={item.blob_name}>
                <a
                  href={`/api/support/attachments/${item.blob_name}`}
                  download
                  dir="ltr"
                >
                  {item.blob_name?.split('/')[1]}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <label className="lead-detail__control">
        <span>{t('support.status')}</span>
        <select
          value={ticket.status}
          onChange={(event) => onSave({ status: event.target.value as TicketStatus })}
        >
          {statuses.map((value) => (
            <option key={value} value={value}>{t(`support.status.${value}`)}</option>
          ))}
        </select>
      </label>

      <label className="lead-detail__control">
        <span>{t('support.notes')}</span>
        <textarea
          dir="auto"
          rows={4}
          value={notes}
          maxLength={4000}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      <button
        className="button button--primary button--small"
        type="button"
        disabled={notes === (ticket.admin_notes ?? '')}
        onClick={() => onSave({ admin_notes: notes })}
      >
        {t('support.saveNotes')}
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
