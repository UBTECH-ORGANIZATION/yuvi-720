import { useI18n } from '../i18n/I18nProvider'
import { useTheme, type ThemePreference } from '../providers/ThemeProvider'

const options: Array<{ value: ThemePreference; labelKey: string }> = [
  { value: 'light', labelKey: 'theme.optionLight' },
  { value: 'dark', labelKey: 'theme.optionDark' }
]

export function ThemeSwitcher() {
  const { t } = useI18n()
  const { preference, theme, setPreference } = useTheme()

  // 'system' is still a valid persisted value, but no longer offered as a
  // choice — show it as its resolved concrete theme so the select stays valid.
  const selectValue: ThemePreference = preference === 'system' ? theme : preference

  return (
    <label className="yuvi-theme-switcher">
      <span>{t('theme.switcherLabel')}</span>
      <select
        value={selectValue}
        onChange={(event) => setPreference(event.target.value as ThemePreference)}
        aria-label={t('theme.switcherLabel')}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {t(option.labelKey)}
          </option>
        ))}
      </select>
    </label>
  )
}
