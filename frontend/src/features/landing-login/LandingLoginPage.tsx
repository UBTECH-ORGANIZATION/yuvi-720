import { useState, type FormEvent, type SVGProps } from 'react'
import { navigate } from '../../app/router'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { useI18n } from '../../i18n/I18nProvider'
import { apiPost } from '../../services/api'
import { AgentsDiagram } from './AgentsDiagram'
import { LandingYubiArtwork, LandingYubiHeroRobot, LandingYubiJourney } from './LandingYubiJourney'

const FAQ_KEYS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']

function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

function GraduationCapIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 3 2 8l10 5 10-5-10-5Z" />
      <path d="M6 10.5V16c0 1.4 2.7 3 6 3s6-1.6 6-3v-5.5" />
      <path d="M22 8v6" />
    </Icon>
  )
}

function UserCheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M3.5 20c0-3.3 2.7-5.6 5.5-5.6s5.5 2.3 5.5 5.6" />
      <path d="m16.5 12.5 2 2 3.5-3.8" />
    </Icon>
  )
}

function ShieldIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 3.2 4.5 6v5.4c0 4.4 3.1 7.7 7.5 9.4 4.4-1.7 7.5-5 7.5-9.4V6L12 3.2Z" />
      <path d="m9 12 2 2 4-4.2" />
    </Icon>
  )
}

function CompassIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="m14.8 9.2-1.7 4.9-4.9 1.7 1.7-4.9 4.9-1.7Z" />
    </Icon>
  )
}

function LayersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="m12 3.5 8 4.3-8 4.3-8-4.3 8-4.3Z" />
      <path d="m4 12.2 8 4.3 8-4.3" />
      <path d="m4 16.5 8 4.3 8-4.3" />
    </Icon>
  )
}

function InsightsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 20V10.5" />
      <path d="M11 20V5" />
      <path d="M18 20v-7.5" />
      <path d="M2.5 20.5h19" />
    </Icon>
  )
}

function GlobeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M3.4 12h17.2" />
      <path d="M12 3.4c2.4 2.3 3.7 5.3 3.7 8.6s-1.3 6.3-3.7 8.6c-2.4-2.3-3.7-5.3-3.7-8.6S9.6 5.7 12 3.4Z" />
    </Icon>
  )
}

function SparkleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 3v4" />
      <path d="M12 17v4" />
      <path d="M3 12h4" />
      <path d="M17 12h4" />
      <path d="m5.6 5.6 2.6 2.6" />
      <path d="m15.8 15.8 2.6 2.6" />
      <path d="m18.4 5.6-2.6 2.6" />
      <path d="m8.2 15.8-2.6 2.6" />
    </Icon>
  )
}

function ChevronDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="m5 8.5 7 7 7-7" />
    </Icon>
  )
}

function MailIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2.4" />
      <path d="m4 7 8 6 8-6" />
    </Icon>
  )
}

type ContactStatus = 'idle' | 'sending' | 'success' | 'error'

export function LandingLoginPage() {
  const { t, language } = useI18n()
  const [openFaq, setOpenFaq] = useState<string | null>(FAQ_KEYS[0])
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactMessage, setContactMessage] = useState('')
  const [contactStatus, setContactStatus] = useState<ContactStatus>('idle')

  async function submitContactForm(event: FormEvent) {
    event.preventDefault()
    if (contactStatus === 'sending') return

    setContactStatus('sending')
    try {
      await apiPost('/api/contact', {
        name: contactName.trim(),
        email: contactEmail.trim(),
        message: contactMessage.trim(),
        language
      })
      setContactStatus('success')
      setContactName('')
      setContactEmail('')
      setContactMessage('')
    } catch {
      setContactStatus('error')
    }
  }

  return (
    <main className="landing720" id="mainContent">
      <LandingYubiJourney />
      <header className="landing720-header">
        <div className="landing720-brand">
          <img src="/shared/brand/yuvispark.png" alt="" />
          <span className="landing720-brand-name">Yuvi Spark</span>
        </div>

        <nav className="landing720-nav" aria-label={t('landing.nav.aria')}>
          <a href="#about">{t('landing.nav.about')}</a>
          <a href="#how">{t('landing.nav.how')}</a>
          <a href="#faq">{t('landing.nav.faq')}</a>
          <a href="#contact">{t('landing.nav.contact')}</a>
        </nav>

        <div className="landing720-lang-wrap">
          <LanguageSwitcher />
        </div>
      </header>

      <section className="landing720-hero" id="about" data-yubi-stop="hero" data-yubi-reveal>
        <article className="landing720-copy">
          <span className="landing720-eyebrow">
            <SparkleIcon width={16} height={16} />
            {t('landing.brand.project')}
          </span>
          <h1>
            {t('landing.hero.titlePrefix')} <span className="landing720-accent">{t('landing.hero.titleAccent')}</span>{' '}
            {t('landing.hero.titleSuffix')}
          </h1>
          <p className="landing720-subtitle">{t('landing.hero.subtitle')}</p>
          <p className="landing720-note">{t('landing.hero.note')}</p>

          <aside className="landing720-login">
            <h2>{t('landing.login.title')}</h2>
            <p>{t('landing.login.subtitle')}</p>

            <button className="landing720-login-btn student" onClick={() => navigate('/learner-mapping')}>
              <GraduationCapIcon />
              <span>{t('landing.login.student')}</span>
            </button>

            <button className="landing720-login-btn teacher" onClick={() => navigate('/teacher-view')}>
              <UserCheckIcon />
              <span>{t('landing.login.teacher')}</span>
            </button>

            <button className="landing720-login-btn secure" onClick={() => navigate('/student-dashboard')}>
              <ShieldIcon />
              <span>{t('landing.login.secure')}</span>
            </button>
          </aside>
        </article>

        <div className="landing720-hero-visual" aria-hidden="true">
          <LandingYubiArtwork />
          <LandingYubiHeroRobot />
        </div>
      </section>

      <div className="landing720-yubi-stop landing720-yubi-stop--hub" data-yubi-stop="hub" data-yubi-reveal>
        <AgentsDiagram />
      </div>

      <section className="landing720-feature-grid" data-yubi-stop="features" data-yubi-reveal>
        <article className="landing720-feature-card">
          <span className="landing720-feature-icon icon-purple">
            <CompassIcon />
          </span>
          <h3>{t('landing.features.profile.title')}</h3>
          <p>{t('landing.features.profile.desc')}</p>
        </article>
        <article className="landing720-feature-card">
          <span className="landing720-feature-icon icon-blue">
            <LayersIcon />
          </span>
          <h3>{t('landing.features.adaptive.title')}</h3>
          <p>{t('landing.features.adaptive.desc')}</p>
        </article>
        <article className="landing720-feature-card">
          <span className="landing720-feature-icon icon-teal">
            <InsightsIcon />
          </span>
          <h3>{t('landing.features.analytics.title')}</h3>
          <p>{t('landing.features.analytics.desc')}</p>
        </article>
      </section>

      <section className="landing720-faq" id="faq" data-yubi-stop="faq" data-yubi-reveal>
        <div className="landing720-faq-head">
          <h2>{t('landing.faq.title')}</h2>
          <p>{t('landing.faq.subtitle')}</p>
        </div>

        <div className="landing720-faq-list">
          {FAQ_KEYS.map((key) => {
            const isOpen = openFaq === key
            return (
              <div className={`landing720-faq-item ${isOpen ? 'open' : ''}`} key={key}>
                <button
                  className="landing720-faq-question"
                  aria-expanded={isOpen}
                  onClick={() => setOpenFaq(isOpen ? null : key)}
                >
                  <span>{t(`landing.faq.${key}.q`)}</span>
                  <ChevronDownIcon className="landing720-faq-chevron" />
                </button>
                {isOpen && <p className="landing720-faq-answer">{t(`landing.faq.${key}.a`)}</p>}
              </div>
            )
          })}
        </div>
      </section>

      <section className="landing720-contact" id="contact" data-yubi-stop="contact" data-yubi-reveal>
        <div className="landing720-contact-head">
          <span className="landing720-feature-icon icon-purple">
            <MailIcon />
          </span>
          <h2>{t('landing.contact.title')}</h2>
          <p>{t('landing.contact.subtitle')}</p>
        </div>

        <form className="landing720-contact-form" onSubmit={(event) => void submitContactForm(event)}>
          <label className="landing720-contact-field">
            <span>{t('landing.contact.nameLabel')}</span>
            <input
              type="text"
              required
              value={contactName}
              onChange={(event) => setContactName(event.target.value)}
              placeholder={t('landing.contact.namePlaceholder')}
            />
          </label>

          <label className="landing720-contact-field">
            <span>{t('landing.contact.emailLabel')}</span>
            <input
              type="email"
              required
              value={contactEmail}
              onChange={(event) => setContactEmail(event.target.value)}
              placeholder={t('landing.contact.emailPlaceholder')}
              dir="ltr"
            />
          </label>

          <label className="landing720-contact-field">
            <span>{t('landing.contact.messageLabel')}</span>
            <textarea
              required
              rows={4}
              value={contactMessage}
              onChange={(event) => setContactMessage(event.target.value)}
              placeholder={t('landing.contact.messagePlaceholder')}
            />
          </label>

          <button className="landing720-contact-submit" type="submit" disabled={contactStatus === 'sending'}>
            {contactStatus === 'sending' ? t('landing.contact.sending') : t('landing.contact.submit')}
          </button>

          {contactStatus === 'success' && (
            <p className="landing720-contact-status success">{t('landing.contact.success')}</p>
          )}
          {contactStatus === 'error' && (
            <p className="landing720-contact-status error">{t('landing.contact.error')}</p>
          )}
        </form>
      </section>

      <section className="landing720-trust" data-yubi-stop="exit" data-yubi-reveal>
        <span>
          <UserCheckIcon width={17} height={17} />
          {t('landing.pills.studentsTeachers')}
        </span>
        <span>
          <CompassIcon width={17} height={17} />
          {t('landing.pills.personalized')}
        </span>
        <span>
          <GlobeIcon width={17} height={17} />
          {t('landing.pills.languages')}
        </span>
      </section>
    </main>
  )
}
