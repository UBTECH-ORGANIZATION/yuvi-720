import { useEffect, useRef, useState } from 'react'
import { navigate, useRoute } from '../app/router'
import { useI18n, type Language } from '../i18n/I18nProvider'
import { useAuth } from '../providers/AuthProvider'
import { useTheme } from '../providers/ThemeProvider'
import { ProfileAvatar } from '../features/badges/ProfileAvatar'

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
  /* Badge avatars are a learner thing. In the teacher/admin app the same menu
     drops both badge affordances — a teacher grading a class has no badge
     gallery to edit, and offering one was learner chrome leaking through. */
  const route = useRoute()
  const inTeacherApp = route.startsWith('/teacher') || route.startsWith('/admin')

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

  const goBadges = () => {
    setOpen(false)
    navigate('/badges')
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
        <ProfileAvatar className="user-avatar" fallback={initialsOf(user.display_name)} />
        <span className="user-menu__name" dir="auto">{user.display_name}</span>
        <svg className="user-menu__chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="user-menu__pop" role="menu">
          <div className="user-menu__head">
            {inTeacherApp ? (
              <ProfileAvatar className="user-menu__head-avatar" fallback={initialsOf(user.display_name)} />
            ) : (
              <button
                className="user-menu__avatar-edit"
                type="button"
                onClick={goBadges}
                aria-label={t('badges.menuEdit')}
                title={t('badges.menuEdit')}
              >
                <ProfileAvatar className="user-menu__head-avatar" fallback={initialsOf(user.display_name)} />
                <span className="user-menu__pencil" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path
                      d="M4 20h4L18.5 9.5a2.12 2.12 0 0 0-3-3L5 17v3z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </button>
            )}
            <div className="user-menu__head-meta">
              <span className="user-menu__head-name" dir="auto">{user.display_name}</span>
              <span className="user-menu__head-handle" dir="ltr">@{user.username}</span>
            </div>
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

          {!inTeacherApp ? (
            <button
              className="user-menu__row user-menu__row--link"
              type="button"
              role="menuitem"
              onClick={goBadges}
            >
              <span>{t('badges.menuTitle')}</span>
              <svg className="user-menu__row-chevron" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : null}

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
