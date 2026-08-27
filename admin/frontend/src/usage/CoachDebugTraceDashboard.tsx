import { useState, type FormEvent } from 'react'
import { ApiError, getCoachDebugTrace } from '../api'
import { useI18n } from '../i18n/I18nProvider'
import type { CoachDebugTrace } from '../types'

export function CoachDebugTraceDashboard({ onUnauthorized }: { onUnauthorized: () => void }) {
  const { language, t } = useI18n()
  const [exchangeId, setExchangeId] = useState('')
  const [trace, setTrace] = useState<CoachDebugTrace | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'not_found' | 'error'>('idle')

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = exchangeId.trim()
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(value)) {
      setTrace(null)
      setState('not_found')
      return
    }
    setState('loading')
    setTrace(null)
    getCoachDebugTrace(value)
      .then((result) => {
        setTrace(result)
        setState('idle')
      })
      .catch((reason: unknown) => {
        if (reason instanceof ApiError && reason.status === 401) {
          onUnauthorized()
          return
        }
        setState(reason instanceof ApiError && reason.status === 404 ? 'not_found' : 'error')
      })
  }

  return (
    <main className="usage-page" id="coach-traces" aria-busy={state === 'loading'}>
      <header className="page-heading">
        <div>
          <p className="eyebrow">{t('nav.operations')}</p>
          <h1>{t('trace.title')}</h1>
          <p>{t('trace.subtitle')}</p>
        </div>
      </header>
      <form className="toolbar-panel trace-toolbar" onSubmit={submit}>
        <label>
          <span>{t('trace.exchangeId')}</span>
          <input value={exchangeId} onChange={(event) => setExchangeId(event.target.value)} placeholder={t('trace.exchangeIdPlaceholder')} dir="ltr" />
        </label>
        <div className="filter-actions">
          <button className="button button--primary" type="submit" disabled={state === 'loading'}>{t('trace.search')}</button>
        </div>
      </form>
      <div className="privacy-strip" role="note"><span aria-hidden="true">◈</span><p>{t('trace.privacyNote')}</p></div>
      {state === 'loading' ? <section className="panel loading-state" role="status"><span className="spinner" aria-hidden="true" /><p>{t('trace.loading')}</p></section> : null}
      {state === 'not_found' ? <section className="panel error-state" role="status"><p>{t('trace.notFound')}</p></section> : null}
      {state === 'error' ? <section className="panel error-state" role="alert"><p>{t('trace.error')}</p></section> : null}
      {trace ? <TraceResult trace={trace} language={language} /> : null}
    </main>
  )
}

function TraceResult({ trace, language }: { trace: CoachDebugTrace; language: string }) {
  const { t } = useI18n()
  const createdAt = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(trace.created_at))
  return (
    <section className="panel table-panel trace-result">
      <header><div><h2>{t('trace.steps')}</h2><p>{t('trace.createdAt', { value: createdAt })}</p></div><span>{trace.steps.length}</span></header>
      {trace.steps.length ? <ol className="trace-steps">{trace.steps.map((step, index) => <li key={`${step.name}-${index}`}><code dir="ltr">{step.name}</code><span className={`status status--${step.status}`}>{t(`trace.source.${step.source}`)} · {t(`trace.status.${step.status}`)}</span></li>)}</ol> : <p className="empty-state">{t('trace.empty')}</p>}
    </section>
  )
}