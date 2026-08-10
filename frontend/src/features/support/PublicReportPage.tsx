import { useState, type FormEvent } from 'react'
import { navigate } from '../../app/router'
import { useI18n } from '../../i18n/I18nProvider'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import type { TicketCategory } from '../../services/support'
import './public-report.css'

/* Reachable without signing in, for someone locked out of the product. It never
   touches learner state: the only identity here is an optional reply address. */
const CATEGORIES: TicketCategory[] = ['access', 'bug', 'content', 'performance', 'other']

export function PublicReportPage() {
  const { t, direction } = useI18n()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<TicketCategory>('access')
  const [reporterName, setReporterName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [company, setCompany] = useState('')
  const [phase, setPhase] = useState<'form' | 'sending' | 'sent'>('form')
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!title.trim() || !description.trim() || phase === 'sending') return
    setPhase('sending')
    setError(null)
    try {
      const response = await fetch('/api/support/public/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          category,
          severity: 'normal',
          reporter_name: reporterName.trim(),
          contact_email: contactEmail.trim(),
          company,
        }),
      })
      if (response.status === 429) {
        setPhase('form')
        setError('support.public.throttled')
        return
      }
      if (response.status === 422) {
        setPhase('form')
        setError('support.public.invalidEmail')
        return
      }
      if (!response.ok) {
        setPhase('form')
        setError('support.report.error')
        return
      }
      setPhase('sent')
    } catch {
      setPhase('form')
      setError('support.report.error')
    }
  }

  return (
    <main className="sp-public" dir={direction}>
      <div className="sp-public__bar">
        <button className="sp-public__home" type="button" onClick={() => navigate('/')}>
          {t('support.public.backHome')}
        </button>
        <LanguageSwitcher />
      </div>

      <section className="sp-public__card">
        <h1>{t('support.public.title')}</h1>

        {phase === 'sent' ? (
          <div className="sp-public__done" role="status">
            <p className="sp-public__done-title">{t('support.report.thanksTitle')}</p>
            <p>{t('support.public.thanksBody')}</p>
          </div>
        ) : (
          <form className="sp-public__form" onSubmit={(event) => void submit(event)}>
            <p className="sp-public__intro">{t('support.public.intro')}</p>

            <label>
              <span>{t('support.report.subject')}</span>
              <input
                dir="auto"
                value={title}
                maxLength={160}
                required
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>

            <label>
              <span>{t('support.report.description')}</span>
              <textarea
                dir="auto"
                rows={5}
                value={description}
                maxLength={4000}
                required
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>

            <label>
              <span>{t('support.report.category')}</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as TicketCategory)}
              >
                {CATEGORIES.map((value) => (
                  <option key={value} value={value}>{t(`support.category.${value}`)}</option>
                ))}
              </select>
            </label>

            <div className="sp-public__row">
              <label>
                <span>{t('support.public.name')}</span>
                <input
                  dir="auto"
                  value={reporterName}
                  maxLength={120}
                  onChange={(event) => setReporterName(event.target.value)}
                />
              </label>
              <label>
                <span>{t('support.public.email')}</span>
                <input
                  dir="ltr"
                  type="email"
                  value={contactEmail}
                  maxLength={200}
                  onChange={(event) => setContactEmail(event.target.value)}
                />
              </label>
            </div>

            {/* Honeypot: hidden from people, irresistible to bots. */}
            <label className="sp-public__trap" aria-hidden="true">
              <span>Company</span>
              <input
                tabIndex={-1}
                autoComplete="off"
                value={company}
                onChange={(event) => setCompany(event.target.value)}
              />
            </label>

            <p className="sp-public__note" role="note">{t('support.public.privacy')}</p>

            {error ? <p className="sp-public__error" role="alert">{t(error)}</p> : null}

            <button
              className="sp-public__submit"
              type="submit"
              disabled={!title.trim() || !description.trim() || phase === 'sending'}
            >
              {phase === 'sending' ? t('support.report.sending') : t('support.report.send')}
            </button>
          </form>
        )}
      </section>
    </main>
  )
}
