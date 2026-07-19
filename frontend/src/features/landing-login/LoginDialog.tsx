import { useEffect, useState, type FormEvent } from 'react'
import { Modal } from '../../components/primitives/Modal'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth, type AuthUser } from '../../providers/AuthProvider'
import { YubiRobot3D } from '../learner-mapping/YubiRobot3D'

/* Sign-in dialog. Opens in place over the landing page so a deep link the user
   was sent to is still there behind them once they authenticate. */

const HELLO_KEYS = ['auth.dialog.hello.1', 'auth.dialog.hello.2', 'auth.dialog.hello.3']
const HELLO_INTERVAL_MS = 3600

interface LoginDialogProps {
  open: boolean
  onClose: () => void
  onSuccess: (user: AuthUser) => void
}

export function LoginDialog({ open, onClose, onSuccess }: LoginDialogProps) {
  const { t, direction } = useI18n()
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [helloIndex, setHelloIndex] = useState(0)

  // Yubi cycles through a few greetings while the learner signs in.
  useEffect(() => {
    if (!open) {
      setHelloIndex(0)
      return
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const handle = window.setInterval(
      () => setHelloIndex((i) => (i + 1) % HELLO_KEYS.length),
      HELLO_INTERVAL_MS
    )
    return () => window.clearInterval(handle)
  }, [open])

  const close = () => {
    setError(null)
    setPassword('')
    setPending(false)
    onClose()
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    if (!username.trim() || !password) {
      setError(t('auth.error.required'))
      return
    }
    setPending(true)
    setError(null)
    try {
      const user = await login(username.trim(), password)
      setPassword('')
      onSuccess(user)
    } catch {
      // The backend never distinguishes unknown-user from wrong-password, so
      // neither does this message.
      setError(t('auth.error.invalid'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal open={open} onClose={close} titleId="auth-dialog-title" className="auth-dialog" overlay={false}>
      {/* The scene and the login card fly to centre as two separate slabs, then
          weld into one panel. The landing's own artwork and pilot Yubi are
          hidden while this is open, so there is never a second Yubi on screen.
          The scene is full-bleed CSS — no framed illustration inside a frame. */}
      <div className="auth-forge__art">
        <div className="auth-forge__sky" aria-hidden="true">
          <span className="auth-forge__orbit auth-forge__orbit--a" />
          <span className="auth-forge__orbit auth-forge__orbit--b" />
          <span className="auth-forge__orbit auth-forge__orbit--c" />
          <span className="auth-forge__glow" />
          {Array.from({ length: 9 }, (_, i) => (
            <span className={`auth-forge__mote auth-forge__mote--${i + 1}`} key={i} />
          ))}
        </div>

        <p className="auth-forge__bubble" dir={direction} key={helloIndex} aria-live="polite">
          {t(HELLO_KEYS[helloIndex])}
        </p>

        <div className="auth-forge__robot">
          <YubiRobot3D label={t('auth.dialog.robotAria')} speaking followPointer presenting={false} />
        </div>
        <span className="auth-forge__seam" aria-hidden="true" />
      </div>

      <div className="auth-forge__card" dir={direction}>
      <h2 className="sp-modal__title" id="auth-dialog-title">{t('auth.dialog.title')}</h2>
      <p className="sp-modal__subtitle">{t('auth.dialog.subtitle')}</p>

      <form className="sp-modal__form" onSubmit={onSubmit}>
        <div className="sp-modal__field">
          <label className="sp-modal__label" htmlFor="auth-username">{t('auth.field.username')}</label>
          <input
            id="auth-username"
            className="sp-input"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            /* auto: the localized placeholder reads in the locale's direction,
               while a typed Latin credential flips to LTR on its own. */
            dir="auto"
            value={username}
            disabled={pending}
            placeholder={t('auth.field.usernamePlaceholder')}
            onChange={(event) => setUsername(event.target.value)}
          />
        </div>

        <div className="sp-modal__field">
          <label className="sp-modal__label" htmlFor="auth-password">{t('auth.field.password')}</label>
          <input
            id="auth-password"
            className="sp-input"
            type="password"
            autoComplete="current-password"
            dir="auto"
            value={password}
            disabled={pending}
            placeholder={t('auth.field.passwordPlaceholder')}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {error ? <p className="sp-modal__error" role="alert">{error}</p> : null}

        <div className="sp-modal__actions">
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--pill" onClick={close} disabled={pending}>
            {t('auth.action.cancel')}
          </button>
          <button type="submit" className="sp-btn sp-btn--gradient sp-btn--pill" disabled={pending}>
            {pending ? t('auth.action.submitting') : t('auth.action.submit')}
          </button>
        </div>
      </form>
      </div>
    </Modal>
  )
}
