import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { getLearnerState, updateLearnerState } from '../services/api'

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

function timeoutSignal(ms: number) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), ms)
  return {
    signal: controller.signal,
    cancel: () => window.clearTimeout(timeoutId)
  }
}

function applyDocumentLanguage(language: Language) {
  const direction = rtlLanguages.has(language) ? 'rtl' : 'ltr'
  document.documentElement.lang = language
  document.documentElement.dir = direction
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('he')
  const [messages, setMessages] = useState<Messages>({})
  const [isLoading, setIsLoading] = useState(true)
  const [loadedPreference, setLoadedPreference] = useState(false)

  useEffect(() => {
    let active = true
    const timeout = timeoutSignal(5000)
    getLearnerState(timeout.signal)
      .then((state) => {
        if (!active) return
        if (state.language && supportedLanguages.includes(state.language)) {
          setLanguageState(state.language)
        }
      })
      .catch(() => {
        // Keep Hebrew as the safe default if state cannot be loaded.
      })
      .finally(() => {
        timeout.cancel()
        if (active) setLoadedPreference(true)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    const timeout = timeoutSignal(5000)
    applyDocumentLanguage(language)
    if (loadedPreference) void updateLearnerState({ language })
    setIsLoading(true)

    fetch(`/locales/${language}.json`, { signal: timeout.signal })
      .then((response) => response.json() as Promise<Messages>)
      .then((nextMessages) => {
        if (active) setMessages(nextMessages)
      })
      .catch(() => {
        if (active) setMessages({})
      })
      .finally(() => {
        timeout.cancel()
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [language, loadedPreference])

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