import { useEffect, useRef, useState } from 'react'
import { navigate, useRoute } from '../app/router'
import { useI18n, type Language } from '../i18n/I18nProvider'
import { useAuth } from '../providers/AuthProvider'
import { useTheme } from '../providers/ThemeProvider'
import { useProgression } from '../providers/ProgressionProvider'
import { useTour } from './tour/TourProvider'
import { LEARNER_TOUR_ID, canTakeLearnerTour } from './tour/steps/learnerTour'
import { XpAwardPopup } from './XpAwardPopup'

/* The avatar is the account surface: who you are, plus the preferences that
   belong to you (language, light/dark) and sign-out. Those settings live on the
   user document, so putting them behind the avatar is where people look for
   them — and it keeps the bar itself uncluttered. */

/** The standalone admin service; opened in a new tab, it is its own app. */
const ADMIN_CONSOLE_URL = 'https://admin.spark.yuvilab.ai'

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
  const { status: progression, applyAward } = useProgression()
  const { startTour } = useTour()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const route = useRoute()
  const inTeacherApp = route.startsWith('/teacher')
  /* The admin console is not a Spark page any more: it is the standalone admin
     service. The role here only decides whether to show the door — the service
     re-checks the live grant on its own. */
  const isAdmin = Boolean(user?.roles.includes('admin'))
  /* The XP chip is learner chrome: the teacher app keeps the plain avatar. */
  const showProgression = !inTeacherApp && progression !== null
  const xpMaximum = progression?.xpToNext ?? Math.max(1, progression?.currentLevelXp ?? 1)
  const xpNow = progression?.currentLevelXp ?? 0
  const progressPercent = Math.max(0, Math.min(100, (progression?.progress ?? 0) * 100))
  const progressText = progression?.nextLevel
    ? t('progression.tooltip', {
        remaining: String(Math.max(0, (progression.xpToNext ?? 0) - xpNow)),
        nextLevel: String(progression.nextLevel),
        current: String(xpNow),
        required: String(progression.xpToNext ?? 0)
      })
    : t('progression.maxLevel')

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

  const replayTour = () => {
    setOpen(false)
    // The tour's first step carries its own route, so this works from any screen.
    startTour(LEARNER_TOUR_ID)
  }

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        className={`user-menu__trigger${showProgression ? ' user-menu__trigger--progression' : ''}`}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={showProgression && progression
          ? t('progression.accountAria', {
              name: user.display_name,
              level: String(progression.level)
            })
          : t('auth.menu.open')}
        data-tour="learner.profileMenu"
        onClick={() => setOpen((value) => !value)}
      >
        {showProgression && progression ? (
          <>
            <span className="user-menu__medal" aria-hidden="true">
              <span>{t('progression.level')}</span>
              <strong>{progression.level}</strong>
            </span>
            <span className="user-menu__identity">
              <span className="user-menu__name" dir="auto">{user.display_name}</span>
              <span className="user-menu__xp" dir="ltr">
                {progression.nextLevel
                  ? t('progression.ratio', { current: String(xpNow), required: String(progression.xpToNext ?? 0) })
                  : t('progression.maxLevel')}
              </span>
            </span>
          </>
        ) : (
          <>
            <span className="user-avatar">{initialsOf(user.display_name)}</span>
            <span className="user-menu__name" dir="auto">{user.display_name}</span>
          </>
        )}
        <svg className="user-menu__chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        {showProgression && progression ? (
          <>
            <span
              className="user-menu__progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={xpMaximum}
              aria-valuenow={xpNow}
              aria-valuetext={progressText}
            >
              <span style={{ inlineSize: `${progressPercent}%` }} />
            </span>
            <span className="user-menu__progress-tip" role="tooltip">{progressText}</span>
          </>
        ) : null}
      </button>

      {showProgression ? <XpAwardPopup paused={open} /> : null}

      {open && (
        <div className="user-menu__pop" role="menu">
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

          {/* The way back into the tour. Behind the avatar rather than on the
              dashboard because a child who feels lost is rarely on the screen
              the tour starts from — and it is a setting about them, which is
              what this menu already is. */}
          {!inTeacherApp && canTakeLearnerTour(user.roles) ? (
            <button
              className="user-menu__row user-menu__row--link"
              type="button"
              role="menuitem"
              onClick={replayTour}
            >
              <span>{t('tour.learner.replay')}</span>
              <svg className="user-menu__row-chevron" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : null}

          {isAdmin ? (
            <a
              className="user-menu__row user-menu__row--link"
              role="menuitem"
              href={ADMIN_CONSOLE_URL}
              target="_blank"
              rel="noopener"
              onClick={() => setOpen(false)}
            >
              <span>{t('tch.nav.admin')}</span>
              <svg className="user-menu__row-chevron" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          ) : null}

          <button
            className="user-menu__row user-menu__row--link"
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              navigate('/support')
            }}
          >
            <span>{t('supportWidget.menuTitle')}</span>
            <svg className="user-menu__row-chevron" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

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
