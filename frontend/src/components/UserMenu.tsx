import { useEffect, useRef, useState } from 'react'
import { navigate } from '../app/router'
import { useI18n, type Language } from '../i18n/I18nProvider'
import { useAuth } from '../providers/AuthProvider'
import { useTheme } from '../providers/ThemeProvider'

/* The avatar is the account surface: who you are, plus the preferences that
   belong to you (language, light/dark) and sign-out. Those settings live on the
   user document, so putting them behind the avatar is where people look for
   them — and it keeps the bar itself uncluttered. */

const LANGUAGES: Array<{ value: Language; label: string }> = [
  { value: 'he', label: 'עברית' },
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'العربية' }
]

function initialsOf(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export function UserMenu() {
  const { t, language, setLanguage } = useI18n()
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (!user) return null

  const onLogout = async () => {
    setOpen(false)
    await logout()
    navigate('/')
  }

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        className="user-menu__trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('auth.menu.open')}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="user-avatar" aria-hidden="true">{initialsOf(user.display_name)}</span>
        <span className="user-menu__name" dir="auto">{user.display_name}</span>
        <svg className="user-menu__chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="user-menu__pop" role="menu">
          <div className="user-menu__head">
            <span className="user-menu__head-name" dir="auto">{user.display_name}</span>
            <span className="user-menu__head-handle" dir="ltr">@{user.username}</span>
          </div>

          <div className="user-menu__group">
            <span className="user-menu__label">{t('language.switcherLabel')}</span>
            <div className="user-menu__choices">
              {LANGUAGES.map((option) => (
                <button
                  className={`user-menu__choice${language === option.value ? ' is-active' : ''}`}
                  type="button"
                  role="menuitemradio"
                  aria-checked={language === option.value}
                  key={option.value}
                  onClick={() => setLanguage(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="user-menu__group">
            <span className="user-menu__label">{t('theme.switcherLabel')}</span>
            <button
              className="user-menu__row"
              type="button"
              role="menuitemcheckbox"
              aria-checked={theme === 'dark'}
              onClick={toggleTheme}
            >
              <span>{theme === 'dark' ? t('theme.useLight') : t('theme.useDark')}</span>
              <span className={`user-menu__switch${theme === 'dark' ? ' is-on' : ''}`} aria-hidden="true" />
            </button>
          </div>

          <button
            className="user-menu__row user-menu__row--danger"
            type="button"
            role="menuitem"
            onClick={() => void onLogout()}
          >
            {t('auth.action.logout')}
          </button>
        </div>
      )}
    </div>
  )
}
