import { useEffect, useState } from 'react'
import { getAuthStatus, logout } from './api'
import { LanguageSwitcher, useI18n } from './i18n/I18nProvider'
import { LeadsDashboard } from './leads/LeadsDashboard'
import { SupportDashboard } from './support/SupportDashboard'
import type { AdminIdentity, AuthStatus } from './types'
import { CoachDebugTraceDashboard } from './usage/CoachDebugTraceDashboard'
import { UsageDashboard } from './usage/UsageDashboard'


type LoadState = 'loading' | 'ready' | 'error'
type Section = 'usage' | 'traces' | 'leads' | 'support'

function sectionFromHash(): Section {
  if (window.location.hash === '#leads') return 'leads'
  if (window.location.hash === '#support') return 'support'
  if (window.location.hash === '#traces') return 'traces'
  return 'usage'
}

export function App() {
  const { t } = useI18n()
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoadState('loading')
    getAuthStatus(controller.signal)
      .then((status) => {
        setAuth(status)
        setLoadState('ready')
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setLoadState('error')
      })
    return () => controller.abort()
  }, [reloadKey])

  if (loadState === 'loading') return <CenteredState message={t('auth.loading')} />
  if (loadState === 'error') {
    return (
      <LoginPage
        errorMessage={t('auth.error.generic')}
        oauthConfigured
        onRetry={() => setReloadKey((value) => value + 1)}
      />
    )
  }
  if (auth?.public_access) {
    return <AdminShell admin={null} onUnauthorized={() => setReloadKey((value) => value + 1)} />
  }
  if (!auth?.authenticated || !auth.admin) {
    return (
      <LoginPage
        errorMessage={authErrorMessage(t)}
        oauthConfigured={auth?.oauth_configured ?? false}
      />
    )
  }
  return (
    <AdminShell
      admin={auth.admin}
      onLogout={async () => {
        await logout()
        setAuth({
          authenticated: false,
          admin: null,
          oauth_configured: auth.oauth_configured,
          public_access: false,
        })
      }}
      onUnauthorized={() => setReloadKey((value) => value + 1)}
    />
  )
}

function authErrorMessage(t: (key: string) => string): string | null {
  const code = new URLSearchParams(window.location.search).get('auth_error')
  if (!code) return null
  const knownCodes = new Set(['forbidden', 'oauth', 'configuration'])
  return t(`auth.error.${knownCodes.has(code) ? code : 'generic'}`)
}

function LoginPage({
  errorMessage,
  oauthConfigured,
  onRetry,
}: {
  errorMessage: string | null
  oauthConfigured: boolean
  onRetry?: () => void
}) {
  const { t } = useI18n()
  return (
    <main className="login-page">
      <div className="login-language"><LanguageSwitcher /></div>
      <section className="login-card" aria-labelledby="login-title">
        <h1 id="login-title"><span aria-hidden="true">🔧</span> {t('auth.title')}</h1>
        <p className="login-subtitle">{t('auth.subtitle')}</p>
        {errorMessage ? <div className="notice notice--error" role="alert">{errorMessage}</div> : null}
        {!oauthConfigured ? <div className="notice" role="status">{t('auth.notConfigured')}</div> : null}
        {onRetry ? (
          <button className="login-btn" type="button" onClick={onRetry}>
            {t('usage.retry')}
          </button>
        ) : (
          <a
            className={`login-btn${oauthConfigured ? '' : ' login-btn--disabled'}`}
            href={oauthConfigured ? '/auth/login' : undefined}
            aria-disabled={!oauthConfigured}
          >
            <span aria-hidden="true">🔐</span>
            <span>{t('auth.signIn')}</span>
          </a>
        )}
      </section>
    </main>
  )
}

function AdminShell({
  admin,
  onLogout,
  onUnauthorized,
}: {
  admin: AdminIdentity | null
  onLogout?: () => Promise<void>
  onUnauthorized: () => void
}) {
  const { t } = useI18n()
  const [loggingOut, setLoggingOut] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  // Leads and support tickets carry contact details, so they exist only for a
  // signed-in administrator.
  const canSeeLeads = admin !== null
  const [section, setSection] = useState<Section>(sectionFromHash)
  const activeSection: Section = canSeeLeads ? section : 'usage'

  useEffect(() => {
    const onHashChange = () => setSection(sectionFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return (
    <div className="admin-shell">
      <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
        <div className="sidebar-brand">
          <BrandMark compact />
          <div>
            <strong>{t('app.brand')}</strong>
            <span>{t('app.admin')}</span>
          </div>
        </div>
        <button
          className="sidebar-toggle"
          type="button"
          aria-expanded={!collapsed}
          title={t(collapsed ? 'nav.expand' : 'nav.collapse')}
          onClick={() => setCollapsed((value) => !value)}
        >
          <ChevronIcon />
          <span>{t('nav.collapse')}</span>
        </button>
        <nav aria-label={t('nav.operations')}>
          <p className="nav-label">{t('nav.operations')}</p>
          <a
            className={`nav-item${activeSection === 'usage' ? ' nav-item--active' : ''}`}
            href="#usage"
            title={t('nav.aiUsage')}
            aria-current={activeSection === 'usage' ? 'page' : undefined}
            onClick={() => setSection('usage')}
          >
            <UsageIcon />
            <span>{t('nav.aiUsage')}</span>
          </a>
          {admin ? <a
            className={`nav-item${activeSection === 'traces' ? ' nav-item--active' : ''}`}
            href="#traces"
            title={t('nav.coachTraces')}
            aria-current={activeSection === 'traces' ? 'page' : undefined}
            onClick={() => setSection('traces')}
          >
            <TraceIcon />
            <span>{t('nav.coachTraces')}</span>
          </a> : null}
          {canSeeLeads ? (
            <>
              <p className="nav-label">{t('nav.growth')}</p>
              <a
                className={`nav-item${activeSection === 'leads' ? ' nav-item--active' : ''}`}
                href="#leads"
                title={t('nav.leads')}
                aria-current={activeSection === 'leads' ? 'page' : undefined}
                onClick={() => setSection('leads')}
              >
                <LeadsIcon />
                <span>{t('nav.leads')}</span>
              </a>
              <p className="nav-label">{t('nav.support')}</p>
              <a
                className={`nav-item${activeSection === 'support' ? ' nav-item--active' : ''}`}
                href="#support"
                title={t('nav.tickets')}
                aria-current={activeSection === 'support' ? 'page' : undefined}
                onClick={() => setSection('support')}
              >
                <SupportIcon />
                <span>{t('nav.tickets')}</span>
              </a>
            </>
          ) : null}
        </nav>
      </aside>
      <div className="admin-workspace">
        <header className="topbar">
          <LanguageSwitcher />
          {admin && onLogout ? (
            <div className="admin-identity">
              <div>
                <span>{t('shell.signedInAs')}</span>
                <strong dir="auto">{admin.name || admin.email}</strong>
              </div>
              <button
                className="button button--quiet button--small"
                type="button"
                disabled={loggingOut}
                onClick={() => {
                  setLoggingOut(true)
                  void onLogout().finally(() => setLoggingOut(false))
                }}
              >
                {t('shell.logout')}
              </button>
            </div>
          ) : <span className="public-access-badge">{t('shell.publicAccess')}</span>}
        </header>
        {activeSection === 'leads' ? <LeadsDashboard onUnauthorized={onUnauthorized} /> : null}
        {activeSection === 'support' ? <SupportDashboard onUnauthorized={onUnauthorized} /> : null}
        {activeSection === 'traces' && admin ? <CoachDebugTraceDashboard onUnauthorized={onUnauthorized} /> : null}
        {activeSection === 'usage' ? <UsageDashboard onUnauthorized={onUnauthorized} /> : null}
      </div>
    </div>
  )
}

function CenteredState({ message }: { message: string }) {
  return (
    <main className="centered-state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <p>{message}</p>
    </main>
  )
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return <span className={`brand-mark${compact ? ' brand-mark--compact' : ''}`} aria-hidden="true">Y</span>
}

function UsageIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
    </svg>
  )
}

function TraceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4h14M5 20h14M7 4v5l3 3-3 3v5M17 4v5l-3 3 3 3v5" />
    </svg>
  )
}

function LeadsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5h16v14H4zM4 10h16M10 10v9" />
    </svg>
  )
}

function SupportIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3a9 9 0 00-9 9v4a2 2 0 002 2h2v-6H5v-.5a7 7 0 0114 0V15h-2v6h2a2 2 0 002-2v-7a9 9 0 00-9-9z" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  )
}
