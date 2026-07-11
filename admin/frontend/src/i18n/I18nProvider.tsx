import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import heMessages from '../locales/he.json'
import enMessages from '../locales/en.json'
import arMessages from '../locales/ar.json'

export type Language = 'he' | 'en' | 'ar'
type Messages = Record<string, string>

interface I18nValue {
  language: Language
  direction: 'rtl' | 'ltr'
  setLanguage: (language: Language) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

const messages: Record<Language, Messages> = {
  he: heMessages,
  en: enMessages,
  ar: arMessages,
}
const rtlLanguages = new Set<Language>(['he', 'ar'])
const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>('he')
  const direction = rtlLanguages.has(language) ? 'rtl' : 'ltr'
  const t = useMemo(() => (
    key: string,
    params: Record<string, string | number> = {},
  ) => {
    const template = messages[language][key] ?? messages.he[key] ?? key
    return Object.entries(params).reduce(
      (text, [paramKey, value]) => text.split(`{${paramKey}}`).join(String(value)),
      template,
    )
  }, [language])

  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dir = direction
    document.title = t('app.documentTitle')
  }, [direction, language, t])

  return (
    <I18nContext.Provider value={{ language, direction, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used within I18nProvider')
  return value
}

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n()
  const options: Language[] = ['he', 'ar', 'en']
  return (
    <label className="language-control">
      <span className="sr-only">{t('language.label')}</span>
      <select
        aria-label={t('language.label')}
        value={language}
        onChange={(event) => setLanguage(event.target.value as Language)}
      >
        {options.map((option) => (
          <option key={option} value={option}>{t(`language.${option}`)}</option>
        ))}
      </select>
    </label>
  )
}
