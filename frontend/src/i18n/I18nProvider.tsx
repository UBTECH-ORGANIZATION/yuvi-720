import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

type Language = 'he' | 'en' | 'ar'
type Direction = 'rtl' | 'ltr'
type Messages = Record<string, string>

interface I18nContextValue {
  language: Language
  direction: Direction
  isLoading: boolean
  setLanguage: (language: Language) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

const supportedLanguages: Language[] = ['he', 'en', 'ar']
const rtlLanguages = new Set<Language>(['he', 'ar'])
const I18nContext = createContext<I18nContextValue | null>(null)

function getInitialLanguage(): Language {
  const stored = localStorage.getItem('yuvi-language') as Language | null
  return stored && supportedLanguages.includes(stored) ? stored : 'he'
}

function applyDocumentLanguage(language: Language) {
  const direction = rtlLanguages.has(language) ? 'rtl' : 'ltr'
  document.documentElement.lang = language
  document.documentElement.dir = direction
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage)
  const [messages, setMessages] = useState<Messages>({})
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    applyDocumentLanguage(language)
    localStorage.setItem('yuvi-language', language)
    setIsLoading(true)

    fetch(`/locales/${language}.json`)
      .then((response) => response.json() as Promise<Messages>)
      .then((nextMessages) => {
        if (active) setMessages(nextMessages)
      })
      .catch(() => {
        if (active) setMessages({})
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [language])

  const setLanguage = (nextLanguage: Language) => {
    setLanguageState(nextLanguage)
  }

  const t = (key: string, params: Record<string, string | number> = {}) => {
    const template = messages[key] || key
    return Object.entries(params).reduce(
      (text, [paramKey, value]) => text.split(`{${paramKey}}`).join(String(value)),
      template
    )
  }

  return (
    <I18nContext.Provider
      value={{
        language,
        direction: rtlLanguages.has(language) ? 'rtl' : 'ltr',
        isLoading,
        setLanguage,
        t
      }}
    >
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside I18nProvider')
  return value
}

export type { Language }