import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { streamCoach, streamProactive, subscribeTriggers } from '../services/agents'
import { useI18n } from '../i18n/I18nProvider'

/* CompanionProvider — owns the floating Coach's chat state (F3). Streams over
   SSE, keeps the AI-use disclosure, and never touches localStorage. Working
   memory (continuity across sessions) lives server-side in `agent_sessions`. */

export interface CoachMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
}

interface CompanionContextValue {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
  messages: CoachMessage[]
  isStreaming: boolean
  disclosure: string | null
  send: (text: string) => Promise<void>
}

const CompanionContext = createContext<CompanionContextValue | null>(null)

export function CompanionProvider({ children }: { children: ReactNode }) {
  const { language } = useI18n()
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<CoachMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [disclosure, setDisclosure] = useState<string | null>(null)
  const counter = useRef(0)

  const nextId = () => `m${counter.current++}`

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || isStreaming) return

      const assistantId = nextId()
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'user', text: trimmed },
        { id: assistantId, role: 'assistant', text: '' },
      ])
      setIsStreaming(true)

      try {
        await streamCoach(trimmed, language, {
          onDisclosure: (d) => setDisclosure(d),
          onText: (chunk) =>
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + chunk } : m))
            ),
        })
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId && !m.text ? { ...m, text: '…' } : m
          )
        )
      } finally {
        setIsStreaming(false)
      }
    },
    [language, isStreaming]
  )

  // Proactive nudges (F3.5): open the companion and stream a trigger-driven
  // message. Debounced so a burst of triggers doesn't stack nudges.
  const lastProactive = useRef(0)
  const receiveProactive = useCallback(
    async (trigger: string) => {
      const now = Date.now()
      if (isStreaming || now - lastProactive.current < 15000) return
      lastProactive.current = now
      setIsOpen(true)
      const assistantId = nextId()
      setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', text: '' }])
      setIsStreaming(true)
      try {
        await streamProactive(trigger, language, {
          onDisclosure: (d) => setDisclosure(d),
          onText: (chunk) =>
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + chunk } : m))
            ),
        })
      } catch {
        /* silent — proactivity must never disrupt the learner */
      } finally {
        setIsStreaming(false)
      }
    },
    [language, isStreaming]
  )

  // Subscribe to the proactive trigger channel for the whole session.
  useEffect(() => {
    const close = subscribeTriggers((t) => {
      if (t.type === 'misconception' || t.type === 'idle' || t.type === 'success') {
        void receiveProactive(t.type)
      }
    })
    return close
  }, [receiveProactive])

  return (
    <CompanionContext.Provider
      value={{
        isOpen,
        open: () => setIsOpen(true),
        close: () => setIsOpen(false),
        toggle: () => setIsOpen((v) => !v),
        messages,
        isStreaming,
        disclosure,
        send,
      }}
    >
      {children}
    </CompanionContext.Provider>
  )
}

export function useCompanion() {
  const value = useContext(CompanionContext)
  if (!value) throw new Error('useCompanion must be used inside CompanionProvider')
  return value
}
