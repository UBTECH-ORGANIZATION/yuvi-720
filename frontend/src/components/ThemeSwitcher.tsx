import { useI18n } from '../i18n/I18nProvider'
import { useTheme } from '../providers/ThemeProvider'

export function ThemeSwitcher() {
  const { t } = useI18n()
  const { theme, toggleTheme } = useTheme()
  const nextThemeLabel = theme === 'dark' ? t('theme.useLight') : t('theme.useDark')

  return (
    <button
      className="yuvi-theme-switcher"
      type="button"
      role="switch"
      aria-checked={theme === 'dark'}
      aria-label={`${t('theme.switcherLabel')}: ${nextThemeLabel}`}
      title={nextThemeLabel}
      onClick={toggleTheme}
    >
      <span className="yuvi-theme-switcher__track" aria-hidden="true">
        <svg className="yuvi-theme-switcher__icon yuvi-theme-switcher__icon--sun" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
        <svg className="yuvi-theme-switcher__icon yuvi-theme-switcher__icon--moon" viewBox="0 0 24 24">
          <path d="M20 15.1A8.5 8.5 0 0 1 8.9 4a8.5 8.5 0 1 0 11.1 11.1Z" />
        </svg>
        <span className="yuvi-theme-switcher__thumb" />
      </span>
    </button>
  )
}
