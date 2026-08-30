import { useState, type FormEvent, type SVGProps } from 'react'
import { recordLoginIntent } from '../../app/router'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { BrandLogo } from '../../components/BrandLogo'
import { ThemeSwitcher } from '../../components/ThemeSwitcher'
import { UserMenu } from '../../components/UserMenu'
import { useI18n } from '../../i18n/I18nProvider'
import { apiPost } from '../../services/api'
import { AgentsDiagram } from './AgentsDiagram'
import { LandingYuviArtwork, LandingYuviJourney } from './LandingYuviJourney'
import { LoginDialog } from './LoginDialog'
import userMappingImage from '../../assets/user-mapping-image.webp'
import userAdaptiveImage from '../../assets/user-adaptive-image.webp'
import teacherInsightImage from '../../assets/teacher-insight-image.webp'

const FAQ_KEYS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']

/* Proof points shown under the hero. Each one is a real property of the
   platform (agent count, supported languages, xAPI reporting, no identifying
   data sent to the model) — no invented numbers. */
const METRIC_KEYS = ['agents', 'languages', 'support', 'privacy'] as const

/* The learner journey, end to end — the section the nav's "how it works" link
   pointed at but that never existed. */
const JOURNEY_KEYS = ['map', 'path', 'guide', 'insight'] as const

const AUDIENCE_KEYS = ['students', 'teachers', 'leaders'] as const

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

function TeacherDeskIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="7.5" r="3.2" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M3 20h18" />
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

function UsersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.6 19.5c0-3 2.4-5.2 5.4-5.2s5.4 2.2 5.4 5.2" />
      <path d="M16.4 5.2a3.2 3.2 0 0 1 0 6.1" />
      <path d="M17.6 14.6c1.8.7 2.9 2.3 2.9 4.4" />
    </Icon>
  )
}

function BuildingIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 20.5V6.2L12 3.5v17" />
      <path d="M12 9.4l7.5 2.3v8.8" />
      <path d="M2.6 20.5h18.8" />
      <path d="M7.4 9.2v.01M7.4 13v.01M7.4 16.8v.01M15.7 14.4v.01M15.7 17.6v.01" />
    </Icon>
  )
}

function ClipboardCheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M9 4.5h6a1.5 1.5 0 0 1 1.5 1.5v.4H7.5V6A1.5 1.5 0 0 1 9 4.5Z" />
      <path d="M16.5 6h1.9a1.6 1.6 0 0 1 1.6 1.6v11.3a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 18.9V7.6A1.6 1.6 0 0 1 5.6 6h1.9" />
      <path d="m9 13.6 2.1 2.1 4.2-4.4" />
    </Icon>
  )
}

function ActivityIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M2.8 12.4h4L9 7l3.4 10L15 12.4h6.2" />
    </Icon>
  )
}

function LockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="4.5" y="10.2" width="15" height="10.3" rx="2.4" />
      <path d="M8 10.2V7.8a4 4 0 0 1 8 0v2.4" />
      <path d="M12 14.2v2.6" />
    </Icon>
  )
}

function EyeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M2.6 12S6 6.4 12 6.4 21.4 12 21.4 12 18 17.6 12 17.6 2.6 12 2.6 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </Icon>
  )
}

function AccessibilityIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="4.8" r="1.8" />
      <path d="M4.8 8.6c2.3.9 4.7 1.4 7.2 1.4s4.9-.5 7.2-1.4" />
      <path d="M12 10v4.2" />
      <path d="m12 14.2-2.6 6M12 14.2l2.6 6" />
    </Icon>
  )
}

type ContactStatus = 'idle' | 'sending' | 'success' | 'error'

type LoginIntent = 'student' | 'teacher'

/* `initialDialog` lets the route guard render this page with sign-in already
   open, instead of navigating away and losing the URL the user asked for. */
export function LandingLoginPage({ initialDialog }: { initialDialog?: LoginIntent } = {}) {
  const { t, language } = useI18n()
  const [loginIntent, setLoginIntent] = useState<LoginIntent | null>(initialDialog ?? null)
  const [openFaq, setOpenFaq] = useState<string | null>(FAQ_KEYS[0])
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactMessage, setContactMessage] = useState('')
  const [contactStatus, setContactStatus] = useState<ContactStatus>('idle')

  const onLoginSuccess = () => {
    /* Record which door was used and stop — App's landing-route effect does the
       actual navigation once the user state has committed. This page used to
       navigate here itself, but navigate()'s synthetic popstate flushes at
       discrete-event priority, so the URL changed one render before `user`
       did — and the auth guard read that frame as a signed-out visit to a
       protected page and bounced the login back to the landing. */
    if (loginIntent) recordLoginIntent(loginIntent)
    setLoginIntent(null)
  }

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
    <main className={`landing720${loginIntent ? ' is-auth-open' : ''}`} id="mainContent">
      <LandingYuviJourney />
      <header className="landing720-header">
        <div className="landing720-brand">
          <BrandLogo />
        </div>

        <nav className="landing720-nav" aria-label={t('landing.nav.aria')}>
          <a href="#about">{t('landing.nav.about')}</a>
          <a href="#how">{t('landing.nav.how')}</a>
          <a href="#standards">{t('landing.nav.standards')}</a>
          <a href="#faq">{t('landing.nav.faq')}</a>
          <a href="#contact">{t('landing.nav.contact')}</a>
        </nav>

        <div className="landing720-lang-wrap">
          <ThemeSwitcher />
          <LanguageSwitcher />
          <UserMenu />
        </div>
      </header>

      <section className="landing720-hero" id="about" data-Yuvi-stop="hero" data-Yuvi-reveal>
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

          {/* Only visitors ever see this page — App redirects a signed-in user
              into the product — so signing in is the call to action. Two doors,
              because a teacher landing here needs their own way in: the copy
              key existed from the start but nothing rendered it, so the teacher
              lane was only reachable by deep-linking while signed out. */}
          <aside className="landing720-login">
            <button className="landing720-login-btn student" onClick={() => setLoginIntent('student')}>
              <GraduationCapIcon />
              <span>{t('landing.login.student')}</span>
            </button>
            <button
              className="landing720-login-btn teacher"
              onClick={() => setLoginIntent('teacher')}
            >
              <TeacherDeskIcon />
              <span>{t('landing.login.teacher')}</span>
            </button>
          </aside>
        </article>

        <div className="landing720-hero-visual" aria-hidden="true">
          <LandingYuviArtwork />
        </div>
      </section>

      <section className="landing720-metrics" aria-label={t('landing.metrics.aria')} data-Yuvi-reveal>
        {METRIC_KEYS.map((key) => (
          <article className="landing720-metric" key={key}>
            <strong>{t(`landing.metrics.${key}.value`)}</strong>
            <span>{t(`landing.metrics.${key}.label`)}</span>
          </article>
        ))}
      </section>

      <div className="landing720-Yuvi-stop landing720-Yuvi-stop--hub" data-Yuvi-stop="hub" data-Yuvi-reveal>
        <AgentsDiagram />
      </div>

      <section className="landing720-journey" id="how" data-Yuvi-stop="journey" data-Yuvi-reveal>
        <header className="landing720-section-head">
          <span className="landing720-eyebrow">{t('landing.journey.eyebrow')}</span>
          <h2>{t('landing.journey.title')}</h2>
          <p>{t('landing.journey.subtitle')}</p>
        </header>

        <ol className="landing720-journey-track">
          {JOURNEY_KEYS.map((key, index) => (
            <li className="landing720-journey-step" key={key}>
              <span className="landing720-journey-step__num">{index + 1}</span>
              <h3>{t(`landing.journey.${key}.title`)}</h3>
              <p>{t(`landing.journey.${key}.desc`)}</p>
              <span className="landing720-journey-step__meta">{t(`landing.journey.${key}.meta`)}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing720-feature-rows" data-Yuvi-stop="features" data-Yuvi-reveal>
        <header className="landing720-feature-rows__head">
          <span className="landing720-eyebrow">{t('landing.features.sectionEyebrow')}</span>
          <h2>{t('landing.features.sectionTitle')}</h2>
          <p>{t('landing.features.sectionSubtitle')}</p>
        </header>

        <article className="landing720-feature-row">
          <div className="landing720-feature-row__media">
            <img src={userMappingImage} alt={t('landing.features.profile.title')} loading="lazy" />
          </div>
          <div className="landing720-feature-row__text">
            <span className="landing720-feature-icon icon-purple">
              <CompassIcon />
            </span>
            <h3>{t('landing.features.profile.title')}</h3>
            <p>{t('landing.features.profile.desc')}</p>
            <ul className="landing720-feature-row__points">
              <li>{t('landing.features.profile.point1')}</li>
              <li>{t('landing.features.profile.point2')}</li>
              <li>{t('landing.features.profile.point3')}</li>
            </ul>
          </div>
        </article>

        <article className="landing720-feature-row is-reversed">
          <div className="landing720-feature-row__media">
            <img src={userAdaptiveImage} alt={t('landing.features.adaptive.title')} loading="lazy" />
          </div>
          <div className="landing720-feature-row__text">
            <span className="landing720-feature-icon icon-blue">
              <LayersIcon />
            </span>
            <h3>{t('landing.features.adaptive.title')}</h3>
            <p>{t('landing.features.adaptive.desc')}</p>
            <ul className="landing720-feature-row__points">
              <li>{t('landing.features.adaptive.point1')}</li>
              <li>{t('landing.features.adaptive.point2')}</li>
              <li>{t('landing.features.adaptive.point3')}</li>
            </ul>
          </div>
        </article>

        <article className="landing720-feature-row">
          <div className="landing720-feature-row__media">
            <img src={teacherInsightImage} alt={t('landing.features.analytics.title')} loading="lazy" />
          </div>
          <div className="landing720-feature-row__text">
            <span className="landing720-feature-icon icon-teal">
              <InsightsIcon />
            </span>
            <h3>{t('landing.features.analytics.title')}</h3>
            <p>{t('landing.features.analytics.desc')}</p>
            <ul className="landing720-feature-row__points">
              <li>{t('landing.features.analytics.point1')}</li>
              <li>{t('landing.features.analytics.point2')}</li>
              <li>{t('landing.features.analytics.point3')}</li>
            </ul>
          </div>
        </article>
      </section>

      <section className="landing720-audience" id="audience" data-Yuvi-stop="audience" data-Yuvi-reveal>
        <header className="landing720-section-head">
          <span className="landing720-eyebrow">{t('landing.audience.eyebrow')}</span>
          <h2>{t('landing.audience.title')}</h2>
          <p>{t('landing.audience.subtitle')}</p>
        </header>

        <div className="landing720-audience-grid">
          {AUDIENCE_KEYS.map((key) => {
            const AudienceIcon =
              key === 'students' ? GraduationCapIcon : key === 'teachers' ? UsersIcon : BuildingIcon
            const tone = key === 'students' ? 'icon-purple' : key === 'teachers' ? 'icon-teal' : 'icon-blue'
            return (
              <article className="landing720-audience-card" key={key}>
                <span className={`landing720-feature-icon ${tone}`}>
                  <AudienceIcon />
                </span>
                <h3>{t(`landing.audience.${key}.title`)}</h3>
                <p>{t(`landing.audience.${key}.desc`)}</p>
                <ul>
                  <li>{t(`landing.audience.${key}.point1`)}</li>
                  <li>{t(`landing.audience.${key}.point2`)}</li>
                  <li>{t(`landing.audience.${key}.point3`)}</li>
                </ul>
              </article>
            )
          })}
        </div>
      </section>

      <section className="landing720-standards" id="standards" data-Yuvi-reveal>
        <header className="landing720-section-head">
          <span className="landing720-eyebrow">{t('landing.standards.eyebrow')}</span>
          <h2>{t('landing.standards.title')}</h2>
          <p>{t('landing.standards.subtitle')}</p>
        </header>

        <div className="landing720-standards-grid">
          {[
            { key: 'program', Glyph: ClipboardCheckIcon },
            { key: 'progress', Glyph: ActivityIcon },
            { key: 'privacy', Glyph: LockIcon },
            { key: 'explain', Glyph: EyeIcon },
            { key: 'access', Glyph: AccessibilityIcon },
            { key: 'safety', Glyph: ShieldIcon }
          ].map(({ key, Glyph }) => (
            <article className="landing720-standard" key={key}>
              <span className="landing720-standard__icon">
                <Glyph width={20} height={20} />
              </span>
              <div>
                <h3>{t(`landing.standards.${key}.title`)}</h3>
                <p>{t(`landing.standards.${key}.desc`)}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="landing720-faq" id="faq" data-Yuvi-stop="faq" data-Yuvi-reveal>
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

      <section className="landing720-contact" id="contact" data-Yuvi-stop="contact" data-Yuvi-reveal>
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

      <section className="landing720-trust" data-Yuvi-stop="exit" data-Yuvi-reveal>
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

      <footer className="landing720-footer">
        <div className="landing720-footer__main">
          <div className="landing720-footer__brand">
            <BrandLogo />
            <p>{t('landing.footer.tagline')}</p>
          </div>

          <nav className="landing720-footer__links" aria-label={t('landing.footer.navAria')}>
            <div>
              <h4>{t('landing.footer.platform')}</h4>
              <a href="#about">{t('landing.nav.about')}</a>
              <a href="#how">{t('landing.nav.how')}</a>
              <a href="#audience">{t('landing.audience.eyebrow')}</a>
            </div>
            <div>
              <h4>{t('landing.footer.trust')}</h4>
              <a href="#standards">{t('landing.standards.eyebrow')}</a>
              <a href="#faq">{t('landing.nav.faq')}</a>
            </div>
            <div>
              <h4>{t('landing.footer.contactHead')}</h4>
              <a href="#contact">{t('landing.nav.contact')}</a>
              <a href="/report">{t('support.public.link')}</a>
            </div>
          </nav>
        </div>

        <div className="landing720-footer__bottom">
          <span>{t('landing.footer.rights').replace('{year}', String(new Date().getFullYear()))}</span>
          <span>{t('landing.footer.note')}</span>
        </div>
      </footer>

      <LoginDialog
        open={loginIntent !== null}
        onClose={() => setLoginIntent(null)}
        onSuccess={onLoginSuccess}
      />
    </main>
  )
}
