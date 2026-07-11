import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ApiError, getUsageSummary } from '../api'
import { MetricCard } from '../components/MetricCard'
import { ActivityChart, DistributionChart, RankingChart } from '../components/UsageCharts'
import { useI18n } from '../i18n/I18nProvider'
import type { PricingRate, UsageBucket, UsageFilters, UsageSummary } from '../types'

const DAY_OPTIONS = [1, 7, 30, 90]
const KNOWN_STATUSES = new Set(['completed', 'failed', 'cancelled', 'unavailable'])

function compact(value: number, language: string): string {
  return new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function money(value: number | null, language: string, unknown: string): string {
  if (value === null) return unknown
  return new Intl.NumberFormat(language, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value < 0.01 ? 4 : 2,
    maximumFractionDigits: 6,
  }).format(value)
}

function percent(value: number, language: string): string {
  return new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 1 }).format(value)
}

export function UsageDashboard({ onUnauthorized }: { onUnauthorized: () => void }) {
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
      <header className="page-heading">
        <div>
          <p className="eyebrow">{t('nav.operations')}</p>
          <h1>{t('usage.title')}</h1>
          <p>{t('usage.subtitle')}</p>
        </div>
        {data ? <span className="live-pill"><i aria-hidden="true" />{t('usage.liveData')}</span> : null}
      </header>

      <form className="toolbar-panel" onSubmit={submit}>
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
          <input dir="auto" value={actorId} onChange={(event) => setActorId(event.target.value)} placeholder={t('usage.actorPlaceholder')} />
        </label>
        <label>
          <span>{t('usage.endpointFilter')}</span>
          <input dir="auto" list="usage-endpoints" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder={t('usage.endpointPlaceholder')} />
          <datalist id="usage-endpoints">{endpoints.map((value) => <option key={value} value={value} />)}</datalist>
        </label>
        <div className="filter-actions">
          <button className="button button--primary" type="submit">{t('usage.applyFilters')}</button>
          <button className="button button--quiet" type="button" onClick={clear}>{t('usage.clearFilters')}</button>
        </div>
      </form>

      <div className="privacy-strip" role="note">
        <span aria-hidden="true">◈</span>
        <p>{t('usage.privacyNote')}</p>
      </div>

      {loading && !data ? <LoadingPanel /> : null}
      {error ? (
        <section className="panel error-state" role="alert">
          <p>{t('usage.error')}</p>
          <button className="button button--primary button--small" type="button" onClick={() => setRequestKey((value) => value + 1)}>{t('usage.retry')}</button>
        </section>
      ) : null}
      {data ? <UsageContent data={data} /> : null}
    </main>
  )
}

function LoadingPanel() {
  const { t } = useI18n()
  return <section className="panel loading-state" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" /><p>{t('usage.loading')}</p></section>
}

function UsageContent({ data }: { data: UsageSummary }) {
  const { t, language } = useI18n()
  const totals = data.totals
  const daily = data.daily
  const exactRate = totals.requests > 0 ? (totals.exact_usage_events ?? 0) / totals.requests : 0
  const successRate = totals.requests > 0 ? totals.completed / totals.requests : 0
  const displayedCost = totals.requests === 0 ? 0 : totals.cost_usd
  const metricCards = [
    { icon: '↻', value: compact(totals.requests, language), label: t('usage.requests'), detail: percent(successRate, language) + ' ' + t('usage.successful'), tone: 'indigo' as const, sparkline: daily.map((row) => row.requests) },
    { icon: '◆', value: compact(totals.total_tokens, language), label: t('usage.tokens'), detail: percent(exactRate, language) + ' ' + t('usage.exactMetering'), tone: 'cyan' as const, sparkline: daily.map((row) => row.total_tokens) },
    { icon: '↓', value: compact(totals.input_tokens, language), label: t('usage.inputTokens'), tone: 'emerald' as const, sparkline: daily.map((row) => row.input_tokens) },
    { icon: '↑', value: compact(totals.output_tokens, language), label: t('usage.outputTokens'), tone: 'violet' as const, sparkline: daily.map((row) => row.output_tokens) },
    { icon: '$', value: money(displayedCost, language, t('usage.pendingPricing')), label: t('usage.cost'), detail: totals.unpriced_requests ? t('usage.unpricedShort', { count: totals.unpriced_requests }) : t('usage.allPriced'), tone: 'amber' as const, sparkline: daily.map((row) => row.cost_usd ?? 0) },
    { icon: '✓', value: compact(totals.completed, language), label: t('usage.completed'), detail: compact(totals.failed, language) + ' ' + t('usage.failed'), tone: 'rose' as const, sparkline: daily.map((row) => row.completed) },
  ]
  const modelRows = data.by_deployment.filter((row) => row.key !== 'unknown')
  const operationRows = data.by_operation.slice(0, 7)

  return (
    <div className="usage-results">
      <section className="metric-grid" aria-label={t('usage.summary')}>
        {metricCards.map((card) => <MetricCard key={card.label} {...card} />)}
      </section>

      {totals.unpriced_requests > 0 ? (
        <div className="pricing-warning" role="status"><span aria-hidden="true">!</span><p>{t('usage.unpricedNotice', { count: totals.unpriced_requests })}</p></div>
      ) : null}

      <div className="chart-grid chart-grid--wide">
        <ChartPanel title={t('usage.dailyActivity')} subtitle={t('usage.dailyActivityHint')}>
          {daily.length ? (
            <ActivityChart
              labels={daily.map((row) => new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' }).format(new Date(`${row.key}T00:00:00Z`)))}
              requests={daily.map((row) => row.requests)}
              tokens={daily.map((row) => row.total_tokens)}
              requestsLabel={t('usage.requests')}
              tokensLabel={t('usage.tokens')}
              ariaLabel={t('usage.dailyActivity')}
            />
          ) : <EmptyState />}
        </ChartPanel>
        <ChartPanel title={t('usage.modelDistribution')} subtitle={t('usage.modelDistributionHint')}>
          {modelRows.length ? <DistributionChart labels={modelRows.map((row) => row.key)} values={modelRows.map((row) => row.total_tokens)} ariaLabel={t('usage.modelDistribution')} /> : <EmptyState />}
        </ChartPanel>
      </div>

      <div className="chart-grid chart-grid--balanced">
        <ChartPanel title={t('usage.topOperations')} subtitle={t('usage.topOperationsHint')}>
          {operationRows.length ? <RankingChart labels={operationRows.map((row) => row.key)} values={operationRows.map((row) => row.total_tokens)} ariaLabel={t('usage.topOperations')} /> : <EmptyState />}
        </ChartPanel>
        <PricingPanel pricing={data.pricing} />
      </div>

      <div className="table-grid">
        <UsageTable title={t('usage.byModel')} rows={modelRows} />
        <UsageTable title={t('usage.byFeature')} rows={data.by_feature} />
        <UsageTable title={t('usage.byEndpoint')} rows={data.by_endpoint} />
        <UsageTable title={t('usage.byActor')} rows={data.by_actor} />
      </div>

      <RecentRequests data={data} />
    </div>
  )
}

function ChartPanel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="panel chart-panel"><header><div><h2>{title}</h2><p>{subtitle}</p></div></header>{children}</section>
}

function PricingPanel({ pricing }: { pricing: PricingRate[] }) {
  const { t, language } = useI18n()
  return (
    <section className="panel pricing-panel">
      <header><div><h2>{t('usage.pricingTitle')}</h2><p>{t('usage.pricingSubtitle')}</p></div><span className="price-unit">USD / 1M</span></header>
      {pricing.length === 0 ? <EmptyState /> : (
        <div className="pricing-list">
          {pricing.map((rate) => (
            <article className="pricing-row" key={rate.pricing_id}>
              <div className="pricing-row__model"><strong dir="auto">{rate.display_name}</strong><small>{rate.price_scope}</small></div>
              <Price label={t('usage.priceInput')} value={rate.input_usd_per_unit} language={language} />
              <Price label={t('usage.priceCached')} value={rate.cached_input_usd_per_unit} language={language} />
              <Price label={t('usage.priceOutput')} value={rate.output_usd_per_unit} language={language} />
            </article>
          ))}
        </div>
      )}
      {pricing[0] ? (
        <footer className="pricing-source">
          <span>{t('usage.pricingEffective', { date: new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(pricing[0].effective_from)) })}</span>
          <a href={pricing[0].source_url} target="_blank" rel="noreferrer">{t('usage.pricingSource')} ↗</a>
        </footer>
      ) : null}
    </section>
  )
}

function Price({ label, value, language }: { label: string; value: number | null; language: string }) {
  return <div className="price-cell"><span>{label}</span><strong>{value === null ? '—' : new Intl.NumberFormat(language, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}</strong></div>
}

function EmptyState() {
  const { t } = useI18n()
  return <p className="empty-state">{t('usage.empty')}</p>
}

function UsageTable({ title, rows }: { title: string; rows: UsageBucket[] }) {
  const { t, language } = useI18n()
  return (
    <section className="panel table-panel">
      <header><h2>{title}</h2><span>{rows.length}</span></header>
      {rows.length === 0 ? <EmptyState /> : (
        <div className="table-wrap"><table><thead><tr><th>{t('usage.dimension')}</th><th>{t('usage.requests')}</th><th>{t('usage.tokens')}</th><th>{t('usage.cost')}</th></tr></thead><tbody>
          {rows.slice(0, 10).map((row) => <tr key={row.key}><td dir="auto"><strong>{row.key}</strong></td><td>{compact(row.requests, language)}</td><td>{compact(row.total_tokens, language)}</td><td>{money(row.cost_usd, language, '—')}</td></tr>)}
        </tbody></table></div>
      )}
    </section>
  )
}

function RecentRequests({ data }: { data: UsageSummary }) {
  const { t, language } = useI18n()
  return (
    <section className="panel table-panel recent-panel">
      <header><div><h2>{t('usage.recent')}</h2><p>{t('usage.recentHint')}</p></div><span>{data.recent.length}</span></header>
      {data.recent.length === 0 ? <EmptyState /> : (
        <div className="table-wrap"><table><thead><tr><th>{t('usage.time')}</th><th>{t('usage.operation')}</th><th>{t('usage.model')}</th><th>{t('usage.actor')}</th><th>{t('usage.tokens')}</th><th>{t('usage.cost')}</th><th>{t('usage.status')}</th><th>{t('usage.latency')}</th></tr></thead><tbody>
          {data.recent.map((event) => {
            const status = KNOWN_STATUSES.has(event.status) ? event.status : 'unknown'
            return <tr key={event.event_id}>
              <td>{new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(event.started_at))}</td>
              <td dir="auto"><strong>{event.operation}</strong><small>{event.endpoint}</small></td>
              <td><code>{event.deployment}</code></td>
              <td dir="auto">{event.actor_id}</td>
              <td>{event.meter === 'tokens' ? compact(event.total_tokens ?? 0, language) : compact(event.quantity ?? 0, language)}</td>
              <td>{money(event.cost_usd, language, '—')}</td>
              <td><span className={`status status--${status}`}>{t(`usage.status.${status}`)}</span></td>
              <td>{t('usage.ms', { count: event.latency_ms })}</td>
            </tr>
          })}
        </tbody></table></div>
      )}
    </section>
  )
}