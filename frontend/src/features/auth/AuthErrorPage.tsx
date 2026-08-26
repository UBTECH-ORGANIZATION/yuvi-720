import { navigate, useRoute } from '../../app/router'
import { useI18n } from '../../i18n/I18nProvider'
import { MoeSignInButton } from './MoeSignInButton'

/* Where a failed ministry sign-in lands.

   `no_role` is the case the ministry test appendix (§11.4.3) names explicitly:
   the person authenticated correctly but holds no role in this product, and
   must be told so in plain words with a way to get help — not shown a 403.

   Reason codes are opaque by design. The backend never forwards the ministry's
   own error text, because it can name the account it was about. */

const REASONS = [
  'no_role',
  'expired',
  'not_configured',
  'provider_unavailable',
  'provider_error',
  'missing_identity',
  'invalid_request',
] as const

type Reason = (typeof REASONS)[number] | 'failed'

function reasonFrom(route: string): Reason {
  const query = route.split('?')[1] ?? ''
  const value = new URLSearchParams(query).get('reason') ?? ''
  return (REASONS as readonly string[]).includes(value) ? (value as Reason) : 'failed'
}

export function AuthErrorPage() {
  const { t, direction } = useI18n()
  const reason = reasonFrom(useRoute())
  const isPermission = reason === 'no_role'

  return (
    <main className="sp-auth-error" id="mainContent" dir={direction}>
      <div className="sp-auth-error__card">
        <h1 className="sp-auth-error__title">
          {t(isPermission ? 'auth.unauthorized.title' : 'auth.moe.error.title')}
        </h1>
        <p className="sp-auth-error__body">{t(`auth.moe.error.${reason}`)}</p>

        {isPermission ? (
          <p className="sp-auth-error__body">{t('auth.unauthorized.contact')}</p>
        ) : null}

        <div className="sp-auth-error__actions">
          {/* Retrying is only meaningful when the failure was transient — an
              account with no role would just loop through the ministry. */}
          {isPermission ? null : <MoeSignInButton returnTo="/" variant="inline" />}
          <button
            type="button"
            className="sp-btn sp-btn--ghost sp-btn--pill"
            onClick={() => navigate('/')}
          >
            {t('auth.moe.error.home')}
          </button>
          <a className="sp-auth-error__support" href="/report">
            {t('support.public.link')}
          </a>
        </div>
      </div>
    </main>
  )
}
