import { useI18n, type Language } from '../i18n/I18nProvider'

const languages: Array<{ value: Language; label: string }> = [
  { value: 'he', label: 'עברית' },
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'العربية' }
]

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n()

  return (
    <label className="yuvi-language-switcher yuvi-language-switcher-inline">
      <span>{t('language.switcherLabel')}</span>
      <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
        {languages.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}