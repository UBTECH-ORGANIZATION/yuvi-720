import { useEffect, useState } from 'react'
import { getAuthStatus, logout } from './api'
import { LanguageSwitcher, useI18n } from './i18n/I18nProvider'
import type { AdminIdentity, AuthStatus } from './types'
import { UsagePage } from './usage/UsagePage'


type LoadState = 'loading' | 'ready' | 'error'

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
        <BrandMark />
        <p className="eyebrow">{t('app.admin')}</p>
        <h1 id="login-title">{t('auth.title')}</h1>
        <p className="login-subtitle">{t('auth.subtitle')}</p>
        {errorMessage ? <div className="notice notice--error" role="alert">{errorMessage}</div> : null}
        {!oauthConfigured ? <div className="notice" role="status">{t('auth.notConfigured')}</div> : null}
        {onRetry ? (
          <button className="button button--primary" type="button" onClick={onRetry}>
            {t('usage.retry')}
          </button>
        ) : (
          <a
            className={`button button--primary${oauthConfigured ? '' : ' button--disabled'}`}
            href={oauthConfigured ? '/auth/login' : undefined}
            aria-disabled={!oauthConfigured}
          >
            {t('auth.signIn')}
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
  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <BrandMark compact />
          <div>
            <strong>{t('app.brand')}</strong>
            <span>{t('app.admin')}</span>
          </div>
        </div>
        <nav aria-label={t('nav.operations')}>
          <p className="nav-label">{t('nav.operations')}</p>
          <a className="nav-item nav-item--active" href="#usage" aria-current="page">
            <UsageIcon />
            <span>{t('nav.aiUsage')}</span>
          </a>
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
        <UsagePage onUnauthorized={onUnauthorized} />
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
