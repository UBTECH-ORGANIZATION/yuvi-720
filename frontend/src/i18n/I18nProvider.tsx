import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { getLearnerState, updateLearnerState } from '../services/api'
import heMessages from '../../../locales/he.json'
import enMessages from '../../../locales/en.json'
import arMessages from '../../../locales/ar.json'

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
const bundledMessages: Record<Language, Messages> = {
  he: heMessages,
  en: enMessages,
  ar: arMessages
}
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
  const [messagesByLanguage, setMessagesByLanguage] = useState<Record<Language, Messages>>(bundledMessages)
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
    // Signed-out visitors can still switch language on the landing page; the
    // write just 401s and the choice stays local until they sign in.
    if (loadedPreference) void updateLearnerState({ language }).catch(() => undefined)
    setIsLoading(true)

    fetch(`/locales/${language}.json`, { signal: timeout.signal, cache: 'no-store' })
      .then((response) => response.json() as Promise<Messages>)
      .then((nextMessages) => {
        if (active) {
          setMessagesByLanguage((current) => ({
            ...current,
            // The Vite bundle is the versioned source of truth. Merge any
            // runtime locale response over it so a stale static-server copy
            // can never remove new keys and expose raw identifiers in the UI.
            [language]: { ...bundledMessages[language], ...nextMessages }
          }))
        }
      })
      .catch(() => {
        // Keep the bundled locale so the UI never exposes raw translation keys.
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
    const template = messagesByLanguage[language][key]
      || bundledMessages[language][key]
      || bundledMessages.he[key]
      || key
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