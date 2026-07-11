import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ApiError, getUsageSummary } from '../api'
import { useI18n } from '../i18n/I18nProvider'
import type { UsageBucket, UsageFilters, UsageSummary } from '../types'

const DAY_OPTIONS = [7, 30, 90]
const KNOWN_STATUSES = new Set(['completed', 'failed', 'cancelled', 'unavailable'])

function compact(value: number, language: string): string {
  return new Intl.NumberFormat(language, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

function money(value: number | null, language: string, unknown: string): string {
  if (value === null) return unknown
  return new Intl.NumberFormat(language, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  }).format(value)
}

export function UsagePage({ onUnauthorized }: { onUnauthorized: () => void }) {
  const { t } = useI18n()
  const [days, setDays] = useState(30)
  const [actorId, setActorId] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [filters, setFilters] = useState<UsageFilters>({ days: 30 })
  const [data, setData] = useState<UsageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [requestKey, setRequestKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(false)
    getUsageSummary(filters, controller.signal)
      .then(setData)
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

  const endpoints = useMemo(() => data?.by_endpoint.map((item) => item.key) ?? [], [data])
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFilters({
      days,
      actorId: actorId.trim() || undefined,
      endpoint: endpoint.trim() || undefined,
    })
  }
  const clear = () => {
    setDays(30)
    setActorId('')
    setEndpoint('')
    setFilters({ days: 30 })
  }

  return (
    <main className="usage-page" id="usage" aria-busy={loading}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('nav.operations')}</p>
          <h1>{t('usage.title')}</h1>
          <p>{t('usage.subtitle')}</p>
        </div>
      </div>
      <div className="notice notice--privacy" role="note">{t('usage.privacyNote')}</div>

      <form className="panel filters" onSubmit={submit}>
        <label>
          <span>{t('usage.period')}</span>
          <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
            {DAY_OPTIONS.map((option) => (
              <option key={option} value={option}>{t('usage.days', { count: option })}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('usage.actorFilter')}</span>
          <input
            dir="auto"
            value={actorId}
            onChange={(event) => setActorId(event.target.value)}
            placeholder={t('usage.actorPlaceholder')}
          />
        </label>
        <label>
          <span>{t('usage.endpointFilter')}</span>
          <input
            dir="auto"
            list="usage-endpoints"
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
            placeholder={t('usage.endpointPlaceholder')}
          />
          <datalist id="usage-endpoints">
            {endpoints.map((value) => <option key={value} value={value} />)}
          </datalist>
        </label>
        <div className="filter-actions">
          <button className="button button--primary" type="submit">{t('usage.applyFilters')}</button>
          <button className="button button--quiet" type="button" onClick={clear}>{t('usage.clearFilters')}</button>
        </div>
      </form>

      {loading && !data ? <LoadingPanel /> : null}
      {error ? (
        <section className="panel error-state" role="alert">
          <p>{t('usage.error')}</p>
          <button className="button button--primary button--small" type="button" onClick={() => setRequestKey((value) => value + 1)}>
            {t('usage.retry')}
          </button>
        </section>
      ) : null}
      {data ? <UsageContent data={data} /> : null}
    </main>
  )
}

function LoadingPanel() {
  const { t } = useI18n()
  return (
    <section className="panel loading-state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <p>{t('usage.loading')}</p>
    </section>
  )
}

function UsageContent({ data }: { data: UsageSummary }) {
  const { t, language } = useI18n()
  const totals = data.totals
  const cards = [
    { value: compact(totals.requests, language), label: t('usage.requests') },
    { value: compact(totals.total_tokens, language), label: t('usage.tokens') },
    { value: compact(totals.characters, language), label: t('usage.characters') },
    { value: money(totals.cost_usd, language, t('usage.unconfigured')), label: t('usage.cost') },
  ]
  return (
    <div className="usage-results">
      <div className="metric-grid">
        {cards.map((card) => (
          <article className="metric-card" key={card.label}>
            <strong>{card.value}</strong>
            <span>{card.label}</span>
          </article>
        ))}
      </div>
      {totals.unpriced_requests > 0 ? (
        <p className="pricing-note">{t('usage.unpricedNotice', { count: totals.unpriced_requests })}</p>
      ) : null}
      <div className="table-grid">
        <UsageTable title={t('usage.byActor')} rows={data.by_actor} />
        <UsageTable title={t('usage.byEndpoint')} rows={data.by_endpoint} />
      </div>
      <UsageTable title={t('usage.byOperation')} rows={data.by_operation} />
      <section className="panel table-panel">
        <h2>{t('usage.recent')}</h2>
        {data.recent.length === 0 ? <p className="empty-state">{t('usage.empty')}</p> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('usage.time')}</th>
                  <th>{t('usage.actor')}</th>
                  <th>{t('usage.operation')}</th>
                  <th>{t('usage.meter')}</th>
                  <th>{t('usage.status')}</th>
                  <th>{t('usage.latency')}</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((event) => {
                  const status = KNOWN_STATUSES.has(event.status) ? event.status : 'unknown'
                  return (
                    <tr key={event.event_id}>
                      <td>{new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(event.started_at))}</td>
                      <td dir="auto">{event.actor_id}</td>
                      <td dir="auto"><strong>{event.operation}</strong><small>{event.endpoint}</small></td>
                      <td>{event.meter === 'tokens' ? compact(event.total_tokens ?? 0, language) : compact(event.quantity ?? 0, language)}</td>
                      <td><span className={`status status--${status}`}>{t(`usage.status.${status}`)}</span></td>
                      <td>{t('usage.ms', { count: event.latency_ms })}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function UsageTable({ title, rows }: { title: string; rows: UsageBucket[] }) {
  const { t, language } = useI18n()
  return (
    <section className="panel table-panel">
      <h2>{title}</h2>
      {rows.length === 0 ? <p className="empty-state">{t('usage.empty')}</p> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('usage.dimension')}</th>
                <th>{t('usage.requests')}</th>
                <th>{t('usage.tokens')}</th>
                <th>{t('usage.characters')}</th>
                <th>{t('usage.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td dir="auto">{row.key}</td>
                  <td>{compact(row.requests, language)}</td>
                  <td>{compact(row.total_tokens, language)}</td>
                  <td>{compact(row.characters, language)}</td>
                  <td>{money(row.cost_usd, language, t('usage.unconfigured'))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
