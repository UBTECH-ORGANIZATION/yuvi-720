import { useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../providers/AuthProvider'

/* The ministry sign-in door.

   Connection guidelines §5.2.ה require the ministry's own owl icon on the home
   page. That artwork is issued by the ministry and is not in this repository —
   drop the official file at `frontend/public/moe/owl.svg` and it appears here.
   Until it does, the button renders text-only rather than with an invented
   emblem: a lookalike ministry mark would be worse than none. */

const OWL_SRC = '/moe/owl.svg'

interface Props {
  returnTo?: string
  variant?: 'primary' | 'inline'
}

export function MoeSignInButton({ returnTo, variant = 'primary' }: Props) {
  const { t } = useI18n()
  const { authMethods, signInWithMoe } = useAuth()
  const [hasOwl, setHasOwl] = useState(true)

  if (!authMethods.moe) return null

  return (
    <button
      type="button"
      className={`moe-signin moe-signin--${variant}`}
      onClick={() => signInWithMoe(returnTo)}
    >
      {hasOwl ? (
        <img
          className="moe-signin__mark"
          src={OWL_SRC}
          alt=""
          aria-hidden="true"
          onError={() => setHasOwl(false)}
        />
      ) : null}
      <span className="moe-signin__label">{t('auth.moe.signIn')}</span>
    </button>
  )
}
