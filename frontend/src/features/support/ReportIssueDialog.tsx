import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { useTheme } from '../../providers/ThemeProvider'
import {
  collectReportContext,
  listMyReports,
  submitReport,
  type SupportTicket,
  type TicketCategory,
  type TicketSeverity,
} from '../../services/support'
import './report-issue.css'

const OPEN_EVENT = 'yuvilab:report-issue'
const CATEGORIES: TicketCategory[] = ['bug', 'content', 'access', 'performance', 'other']
const SEVERITIES: TicketSeverity[] = ['low', 'normal', 'high', 'blocking']

/** Opens the global report dialog from anywhere without another provider. */
export function openReportIssue() {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT))
}

type Phase = 'form' | 'sending' | 'sent'

export function ReportIssueDialog() {
  const { t, direction, language } = useI18n()
  const { theme } = useTheme()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('form')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<TicketCategory>('bug')
  const [severity, setSeverity] = useState<TicketSeverity>('normal')
  const [error, setError] = useState(false)
  const [history, setHistory] = useState<SupportTicket[] | null>(null)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    const onOpen = () => {
      setPhase('form')
      setError(false)
      setTitle('')
      setDescription('')
      setCategory('bug')
      setSeverity('normal')
      setHistory(null)
      setOpen(true)
    }
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, close])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    listMyReports()
      .then((result) => {
        if (!cancelled) setHistory(result.tickets)
      })
      .catch(() => {
        if (!cancelled) setHistory([])
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const canSubmit = useMemo(
    () => title.trim().length > 0 && description.trim().length > 0 && phase === 'form',
    [title, description, phase],
  )

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) return
    setPhase('sending')
    setError(false)
    try {
      await submitReport(
        { title: title.trim(), description: description.trim(), category, severity },
        collectReportContext(language, theme),
      )
      setPhase('sent')
    } catch {
      setPhase('form')
      setError(true)
    }
  }

  if (!open) return null

  return (
    <div className="sp-report" role="presentation" onClick={close}>
      <div
        className="sp-report__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sp-report-title"
        dir={direction}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sp-report__head">
          <h2 id="sp-report-title">{t('support.report.title')}</h2>
          <button className="sp-report__close" type="button" onClick={close} aria-label={t('support.report.close')}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {phase === 'sent' ? (
          <div className="sp-report__done" role="status">
            <p className="sp-report__done-title">{t('support.report.thanksTitle')}</p>
            <p>{t('support.report.thanksBody')}</p>
            <button className="sp-report__submit" type="button" onClick={close}>
              {t('support.report.close')}
            </button>
          </div>
        ) : (
          <form className="sp-report__form" onSubmit={(event) => void submit(event)}>
            <p className="sp-report__intro">{t('support.report.intro')}</p>

            <label className="sp-report__field">
              <span>{t('support.report.subject')}</span>
              <input
                dir="auto"
                value={title}
                maxLength={160}
                required
                placeholder={t('support.report.subjectPlaceholder')}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>

            <label className="sp-report__field">
              <span>{t('support.report.description')}</span>
              <textarea
                dir="auto"
                rows={5}
                value={description}
                maxLength={4000}
                required
                placeholder={t('support.report.descriptionPlaceholder')}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>

            <div className="sp-report__row">
              <label className="sp-report__field">
                <span>{t('support.report.category')}</span>
                <select value={category} onChange={(event) => setCategory(event.target.value as TicketCategory)}>
                  {CATEGORIES.map((value) => (
                    <option key={value} value={value}>{t(`support.category.${value}`)}</option>
                  ))}
                </select>
              </label>
              <label className="sp-report__field">
                <span>{t('support.report.severity')}</span>
                <select value={severity} onChange={(event) => setSeverity(event.target.value as TicketSeverity)}>
                  {SEVERITIES.map((value) => (
                    <option key={value} value={value}>{t(`support.severity.${value}`)}</option>
                  ))}
                </select>
              </label>
            </div>

            <p className="sp-report__note" role="note">{t('support.report.privacy')}</p>

            {error ? <p className="sp-report__error" role="alert">{t('support.report.error')}</p> : null}

            <button className="sp-report__submit" type="submit" disabled={!canSubmit}>
              {phase === 'sending' ? t('support.report.sending') : t('support.report.send')}
            </button>
          </form>
        )}

        {history && history.length > 0 ? (
          <section className="sp-report__history">
            <h3>{t('support.report.historyTitle')}</h3>
            <ul>
              {history.slice(0, 5).map((ticket) => (
                <li key={ticket.id}>
                  <span dir="auto">{ticket.title}</span>
                  <span className={`sp-report__status sp-report__status--${ticket.status}`}>
                    {t(`support.status.${ticket.status}`)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  )
}
