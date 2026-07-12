import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LanguageSwitcher } from './LanguageSwitcher'
import { Stepper } from './Stepper'
import { useI18n } from '../i18n/I18nProvider'
import { BrandLogo } from './BrandLogo'
import { ThemeSwitcher } from './ThemeSwitcher'

interface AppBarProps {
  studentName: string
  studentSubtitle: string
  activeStep?: number
  center?: ReactNode
}

export function AppBar({ studentName, studentSubtitle, activeStep, center }: AppBarProps) {
  const { t } = useI18n()
  const [isNavigationOpen, setIsNavigationOpen] = useState(false)
  const [isCompact, setIsCompact] = useState(false)
  const appBarRef = useRef<HTMLElement>(null)
  const hasNavigation = typeof activeStep !== 'number' && Boolean(center)
  const initials = studentName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)

  useEffect(() => {
    const appBar = appBarRef.current
    if (!appBar || !hasNavigation) {
      setIsCompact(false)
      return
    }

    const observer = new ResizeObserver(([entry]) => {
      setIsCompact(entry.contentRect.width < 1200)
    })
    observer.observe(appBar)
    return () => observer.disconnect()
  }, [hasNavigation])

  useEffect(() => {
    if (!isCompact) setIsNavigationOpen(false)
  }, [isCompact])

  useEffect(() => {
    if (!isNavigationOpen) return

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsNavigationOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isNavigationOpen])

  return (
    <header ref={appBarRef} className={`app-bar${isCompact ? ' is-compact' : ''}`}>
      <div className="app-bar-left">
        <div className="app-bar-brand" aria-label={t('app.brand')}>
          <BrandLogo />
        </div>
        <LanguageSwitcher />
        <ThemeSwitcher />
      </div>
      {typeof activeStep === 'number' && (
        <div className="app-bar-steps app-bar-steps--progress">
          <Stepper activeStep={activeStep} />
        </div>
      )}
      {typeof activeStep !== 'number' && center && (
        <div className="app-bar-steps app-bar-steps--navigation">{center}</div>
      )}
      {hasNavigation && (
        <button
          className="app-bar-menu-toggle"
          type="button"
          aria-expanded={isNavigationOpen}
          aria-controls="app-bar-compact-navigation"
          aria-label={isNavigationOpen ? t('app.navigation.close') : t('app.navigation.open')}
          title={isNavigationOpen ? t('app.navigation.close') : t('app.navigation.open')}
          onClick={() => setIsNavigationOpen((open) => !open)}
        >
          <span aria-hidden="true" />
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </button>
      )}
      <div className="app-bar-user">
        <div className="user-meta">
          <span className="user-name">{studentName}</span>
          <span className="user-sub">{studentSubtitle}</span>
        </div>
        <div className="user-avatar">{initials}</div>
      </div>
      {hasNavigation && (
        <>
          <button
            className={`app-bar-menu-backdrop${isNavigationOpen ? ' is-open' : ''}`}
            type="button"
            aria-label={t('app.navigation.close')}
            aria-hidden={!isNavigationOpen}
            tabIndex={isNavigationOpen ? 0 : -1}
            onClick={() => setIsNavigationOpen(false)}
          />
          <div
            id="app-bar-compact-navigation"
            className={`app-bar-menu${isNavigationOpen ? ' is-open' : ''}`}
            aria-hidden={!isNavigationOpen}
            onClick={(event) => {
              if (event.target instanceof Element && event.target.closest('a, button')) {
                setIsNavigationOpen(false)
              }
            }}
          >
            {center}
          </div>
        </>
      )}
    </header>
  )
}