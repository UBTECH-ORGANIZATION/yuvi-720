import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  createCoachConversation,
  coachSurfaceForPath,
  deleteCoachConversation,
  listCoachConversations,
  listCoachMessages,
  streamCoach,
  streamCoachSupport,
  streamProactive,
  subscribeTriggers,
  type CoachConversation,
  type CoachHistoryMessage,
  type CoachVisual,
  type CoachSupportMode,
} from '../services/agents'
import { useI18n } from '../i18n/I18nProvider'
import { useRoute } from '../app/router'

/* CompanionProvider — owns Yuvi's live state and paginated server history (F3).
   The prompt window and full transcript remain in Mongo/Cosmos; no localStorage. */

export interface CoachMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  textAfter?: string
  visual?: CoachVisual
  isVisualizing?: boolean
  isComplete: boolean
  createdAt?: string
}

export type CompanionActivity = 'idle' | 'thinking' | 'speaking'

interface CompanionContextValue {
  isOpen: boolean
  isOpening: boolean
  isClosing: boolean
  panelWidth: number
  setPanelWidth: (width: number) => void
  open: () => void
  finishOpening: () => void
  close: () => void
  toggle: () => void
  messages: CoachMessage[]
  conversations: CoachConversation[]
  activeConversationId: string | null
  isStreaming: boolean
  activeAssistantId: string | null
  activity: CompanionActivity
  unreadCount: number
  preview: string | null
  disclosure: string | null
  isLoadingConversations: boolean
  isLoadingMessages: boolean
  hasMoreConversations: boolean
  hasMoreMessages: boolean
  historyError: boolean
  canStartNewConversation: boolean
  send: (text: string) => Promise<void>
  requestSupport: (support: CoachSupportMode) => Promise<void>
  selectConversation: (conversationId: string) => Promise<void>
  startNewConversation: () => Promise<void>
  deleteConversation: (conversationId: string) => Promise<boolean>
  loadMoreConversations: () => Promise<void>
  loadMoreMessages: () => Promise<void>
  reloadHistory: () => Promise<void>
}

const CompanionContext = createContext<CompanionContextValue | null>(null)
// CSS completes the flight/pull/dock sequence in 1.45s. Keep the travelling
// Yuvi mounted for one final painted frame before handing off to the header.
const COMPANION_OPENING_MS = 1500
// The return flight and panel exit run together for 1.45s. Keep both surfaces
// mounted through the final frame so Yuvi reaches the restored orbit cleanly.
const COMPANION_CLOSING_MS = 1500

function historyMessage(message: CoachHistoryMessage): CoachMessage {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    textAfter: message.text_after || undefined,
    visual: message.visual,
    isComplete: true,
    createdAt: message.at,
  }
}

function mergeUnique<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map((item) => item.id))
  return [...current, ...incoming.filter((item) => !seen.has(item.id))]
}

export function CompanionProvider({ children }: { children: ReactNode }) {
  const { language } = useI18n()
  const pathname = useRoute()
  const surface = useMemo(() => coachSurfaceForPath(pathname), [pathname])
  const activityScoped = surface.screen === 'learning_lesson'
    && Boolean(surface.unit_id && surface.component_id)
  const [isOpen, setIsOpen] = useState(false)
  const [isOpening, setIsOpening] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [panelWidth, setPanelWidth] = useState(430)
  const [messages, setMessages] = useState<CoachMessage[]>([])
  const [conversations, setConversations] = useState<CoachConversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [conversationCursor, setConversationCursor] = useState<string | null>(null)
  const [messageCursor, setMessageCursor] = useState<string | null>(null)
  const [hasMoreConversations, setHasMoreConversations] = useState(false)
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [isLoadingConversations, setIsLoadingConversations] = useState(true)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [historyError, setHistoryError] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null)
  const [activity, setActivity] = useState<CompanionActivity>('idle')
  const [unreadCount, setUnreadCount] = useState(0)
  const [disclosure, setDisclosure] = useState<string | null>(null)
  const counter = useRef(0)
  const messageRequest = useRef(0)
  const conversationLoading = useRef(false)
  const messageLoading = useRef(false)
  const liveTurnInProgress = useRef(false)
  const isOpenRef = useRef(false)
  const isClosingRef = useRef(false)
  const openingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const nextId = () => `live-${Date.now()}-${counter.current++}`

  const finishOpening = useCallback(() => {
    if (openingTimer.current) clearTimeout(openingTimer.current)
    openingTimer.current = null
    setIsOpening(false)
  }, [])

  const open = useCallback(() => {
    setUnreadCount(0)
    if (isOpenRef.current) return
    isOpenRef.current = true
    if (openingTimer.current) clearTimeout(openingTimer.current)
    if (closingTimer.current) clearTimeout(closingTimer.current)
    closingTimer.current = null
    isClosingRef.current = false
    setIsClosing(false)
    const shouldAnimate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setIsOpening(shouldAnimate)
    setIsOpen(true)
    if (shouldAnimate) {
      openingTimer.current = setTimeout(finishOpening, COMPANION_OPENING_MS)
    }
  }, [finishOpening])

  const close = useCallback(() => {
    if (!isOpenRef.current || isClosingRef.current) return
    if (openingTimer.current) clearTimeout(openingTimer.current)
    openingTimer.current = null
    setIsOpening(false)
    const shouldAnimate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!shouldAnimate) {
      isOpenRef.current = false
      setIsOpen(false)
      return
    }
    isClosingRef.current = true
    setIsClosing(true)
    closingTimer.current = setTimeout(() => {
      closingTimer.current = null
      isClosingRef.current = false
      isOpenRef.current = false
      setIsClosing(false)
      setIsOpen(false)
    }, COMPANION_CLOSING_MS)
  }, [])

  const toggle = useCallback(() => {
    if (isOpenRef.current) close()
    else open()
  }, [close, open])

  useEffect(() => () => {
    if (openingTimer.current) clearTimeout(openingTimer.current)
    if (closingTimer.current) clearTimeout(closingTimer.current)
  }, [])

  useEffect(() => {
    if (pathname.startsWith('/learning/lesson')) open()
  }, [open, pathname])

  const selectConversation = useCallback(async (conversationId: string) => {
    const request = ++messageRequest.current
    setActiveConversationId(conversationId)
    setMessages([])
    setMessageCursor(null)
    setHasMoreMessages(false)
    setIsLoadingMessages(true)
    setHistoryError(false)
    messageLoading.current = true
    try {
      const page = await listCoachMessages(conversationId)
      if (messageRequest.current !== request) return
      setMessages(page.messages.map(historyMessage))
      setMessageCursor(page.next_cursor)
      setHasMoreMessages(page.has_more)
    } catch {
      if (messageRequest.current === request) setHistoryError(true)
    } finally {
      if (messageRequest.current === request) {
        messageLoading.current = false
        setIsLoadingMessages(false)
      }
    }
  }, [])

  const reloadHistory = useCallback(async () => {
    if (conversationLoading.current) return
    conversationLoading.current = true
    setIsLoadingConversations(true)
    setHistoryError(false)
    try {
      const page = await listCoachConversations()
      setConversations(page.conversations)
      setConversationCursor(page.next_cursor)
      setHasMoreConversations(page.has_more)
    } catch {
      setHistoryError(true)
    } finally {
      conversationLoading.current = false
      setIsLoadingConversations(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    conversationLoading.current = true
    setIsLoadingConversations(true)
    const initialize = async () => {
      const activityConversation = activityScoped
        ? await createCoachConversation(surface)
        : null
      const page = await listCoachConversations()
      return { activityConversation, page }
    }
    initialize()
      .then(async ({ activityConversation, page }) => {
        if (!active) return
        const nextConversations = activityConversation
          && !page.conversations.some((item) => item.id === activityConversation.id)
          ? [activityConversation, ...page.conversations]
          : page.conversations
        setConversations(nextConversations)
        setConversationCursor(page.next_cursor)
        setHasMoreConversations(page.has_more)
        const target = activityConversation || page.conversations[0]
        if (target && !liveTurnInProgress.current) {
          await selectConversation(target.id)
        } else if (!liveTurnInProgress.current) {
          setActiveConversationId('default')
        }
      })
      .catch(() => {
        if (active) {
          if (!liveTurnInProgress.current) setActiveConversationId('default')
          setHistoryError(true)
        }
      })
      .finally(() => {
        conversationLoading.current = false
        if (active) setIsLoadingConversations(false)
      })
    return () => {
      active = false
      messageRequest.current += 1
    }
  }, [activityScoped, pathname, selectConversation, surface])

  const loadMoreConversations = useCallback(async () => {
    if (!hasMoreConversations || !conversationCursor || conversationLoading.current) return
    conversationLoading.current = true
    setIsLoadingConversations(true)
    try {
      const page = await listCoachConversations(conversationCursor)
      setConversations((current) => mergeUnique(current, page.conversations))
      setConversationCursor(page.next_cursor)
      setHasMoreConversations(page.has_more)
    } catch {
      setHistoryError(true)
    } finally {
      conversationLoading.current = false
      setIsLoadingConversations(false)
    }
  }, [conversationCursor, hasMoreConversations])

  const loadMoreMessages = useCallback(async () => {
    if (!activeConversationId || !hasMoreMessages || !messageCursor || messageLoading.current) return
    messageLoading.current = true
    setIsLoadingMessages(true)
    try {
      const page = await listCoachMessages(activeConversationId, messageCursor)
      setMessages((current) => {
        const existing = new Set(current.map((message) => message.id))
        return [
          ...page.messages.map(historyMessage).filter((message) => !existing.has(message.id)),
          ...current,
        ]
      })
      setMessageCursor(page.next_cursor)
      setHasMoreMessages(page.has_more)
    } catch {
      setHistoryError(true)
    } finally {
      messageLoading.current = false
      setIsLoadingMessages(false)
    }
  }, [activeConversationId, hasMoreMessages, messageCursor])

  const startNewConversation = useCallback(async () => {
    if (isStreaming) return
    setHistoryError(false)
    try {
      if (activityScoped) {
        const conversation = await createCoachConversation(surface)
        setConversations((current) => [
          conversation,
          ...current.filter((item) => item.id !== conversation.id),
        ])
        await selectConversation(conversation.id)
        return
      }
      const existingEmpty = conversations.find((item) => item.message_count === 0)
      if (existingEmpty) {
        await selectConversation(existingEmpty.id)
        return
      }
      const conversation = await createCoachConversation(surface)
      setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)])
      await selectConversation(conversation.id)
    } catch {
      setHistoryError(true)
    }
  }, [activityScoped, conversations, isStreaming, selectConversation, surface])

  const deleteConversation = useCallback(async (conversationId: string) => {
    if (isStreaming) return false
    setHistoryError(false)
    try {
      await deleteCoachConversation(conversationId)
      const remaining = conversations.filter((item) => item.id !== conversationId)
      setConversations(remaining)
      if (activeConversationId === conversationId) {
        messageRequest.current += 1
        setMessages([])
        setMessageCursor(null)
        setHasMoreMessages(false)
        if (remaining[0]) {
          await selectConversation(remaining[0].id)
        } else {
          const conversation = await createCoachConversation(surface)
          setConversations([conversation])
          await selectConversation(conversation.id)
        }
      }
      return true
    } catch {
      setHistoryError(true)
      return false
    }
  }, [activeConversationId, conversations, isStreaming, selectConversation, surface])

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || isStreaming) return
      liveTurnInProgress.current = true

      let conversationId = activeConversationId
      if (!conversationId) {
        try {
          const conversation = await createCoachConversation(surface)
          conversationId = conversation.id
          setActiveConversationId(conversation.id)
          setConversations((current) => [conversation, ...current])
        } catch {
          setHistoryError(true)
          liveTurnInProgress.current = false
          return
        }
      }

      // A learner may send immediately while the selected thread is still
      // loading. Invalidate that older read before adding the live turn so its
      // eventual response cannot replace the optimistic user/assistant rows.
      messageRequest.current += 1
      messageLoading.current = false
      setIsLoadingMessages(false)

      const assistantId = nextId()
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'user', text: trimmed, isComplete: true },
        { id: assistantId, role: 'assistant', text: '', isComplete: false },
      ])
      setIsStreaming(true)
      setActiveAssistantId(assistantId)
      setActivity('thinking')

      try {
        await streamCoach(trimmed, language, {
          onDisclosure: (value) => setDisclosure(value),
          onPhase: setActivity,
          onText: (chunk) =>
            setMessages((prev) =>
              prev.map((message) => (
                message.id === assistantId ? { ...message, text: message.text + chunk } : message
              ))
            ),
          onVisualStatus: ({ textBefore, textAfter }) =>
            setMessages((prev) =>
              prev.map((message) => (
                message.id === assistantId
                  ? { ...message, text: textBefore, textAfter, isVisualizing: true }
                  : message
              ))
            ),
          onVisual: (visual) =>
            setMessages((prev) =>
              prev.map((message) => (
                message.id === assistantId ? { ...message, visual, isVisualizing: false } : message
              ))
            ),
        }, conversationId, surface)
      } catch {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId && !message.text
              ? { ...message, text: '…', isVisualizing: false }
              : message.id === assistantId
                ? { ...message, isVisualizing: false }
                : message
          )
        )
      } finally {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId ? { ...message, isComplete: true } : message
          )
        )
        setIsStreaming(false)
        setActiveAssistantId(null)
        setActivity('idle')
        await reloadHistory()
        liveTurnInProgress.current = false
        window.dispatchEvent(new CustomEvent('yuvilab:brain-updated'))
      }
    },
    [activeConversationId, isStreaming, language, reloadHistory, surface]
  )

  const requestSupport = useCallback(async (support: CoachSupportMode) => {
    if (isStreaming) return
    liveTurnInProgress.current = true
    let conversationId = activeConversationId
    if (!conversationId) {
      try {
        const conversation = await createCoachConversation(surface)
        conversationId = conversation.id
        setActiveConversationId(conversation.id)
        setConversations((current) => [conversation, ...current])
      } catch {
        setHistoryError(true)
        liveTurnInProgress.current = false
        return
      }
    }
    messageRequest.current += 1
    const assistantId = nextId()
    setMessages((current) => [
      ...current,
      { id: assistantId, role: 'assistant', text: '', isComplete: false },
    ])
    setIsStreaming(true)
    setActiveAssistantId(assistantId)
    setActivity('thinking')
    try {
      await streamCoachSupport(support, language, {
        onDisclosure: setDisclosure,
        onPhase: setActivity,
        onText: (chunk) => setMessages((current) => current.map((message) => (
          message.id === assistantId ? { ...message, text: message.text + chunk } : message
        ))),
      }, conversationId, surface)
    } catch {
      setMessages((current) => current.map((message) => (
        message.id === assistantId && !message.text ? { ...message, text: '…' } : message
      )))
    } finally {
      setMessages((current) => current.map((message) => (
        message.id === assistantId ? { ...message, isComplete: true } : message
      )))
      setIsStreaming(false)
      setActiveAssistantId(null)
      setActivity('idle')
      await reloadHistory()
      liveTurnInProgress.current = false
    }
  }, [activeConversationId, isStreaming, language, reloadHistory, surface])

  // Proactive nudges stream into the active thread without taking control of
  // the screen. Only the learner-visible assistant message enters history.
  const lastProactive = useRef(0)
  const receiveProactive = useCallback(
    async (trigger: string) => {
      const now = Date.now()
      if (isStreaming || now - lastProactive.current < 15000) return
      lastProactive.current = now
      if (!isOpen) setUnreadCount((count) => count + 1)
      let conversationId = activeConversationId
      if (!conversationId) {
        try {
          const conversation = await createCoachConversation(surface)
          conversationId = conversation.id
          setActiveConversationId(conversation.id)
          setConversations((current) => [
            conversation,
            ...current.filter((item) => item.id !== conversation.id),
          ])
        } catch {
          return
        }
      }
      const assistantId = nextId()
      setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', text: '', isComplete: false }])
      setIsStreaming(true)
      setActiveAssistantId(assistantId)
      setActivity('thinking')
      try {
        await streamProactive(trigger, language, {
          onDisclosure: (value) => setDisclosure(value),
          onPhase: setActivity,
          onText: (chunk) =>
            setMessages((prev) =>
              prev.map((message) => (
                message.id === assistantId ? { ...message, text: message.text + chunk } : message
              ))
            ),
        }, conversationId, surface)
      } catch {
        /* Proactivity must never disrupt the learner. */
      } finally {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId ? { ...message, isComplete: true } : message
          )
        )
        setIsStreaming(false)
        setActiveAssistantId(null)
        setActivity('idle')
        await reloadHistory()
        window.dispatchEvent(new CustomEvent('yuvilab:brain-updated'))
      }
    },
    [activeConversationId, isOpen, isStreaming, language, reloadHistory, surface]
  )

  useEffect(() => {
    const close = subscribeTriggers((trigger) => {
      if (['misconception', 'slow_progress', 'idle', 'success', 'rapid_guessing', 'wheel_spinning'].includes(trigger.type)) {
        void receiveProactive(trigger.type)
      }
    })
    return close
  }, [receiveProactive])

  return (
    <CompanionContext.Provider
      value={{
        isOpen,
        isOpening,
        isClosing,
        panelWidth,
        setPanelWidth,
        open,
        finishOpening,
        close,
        toggle,
        messages,
        conversations,
        activeConversationId,
        isStreaming,
        activeAssistantId,
        activity,
        unreadCount,
        preview: [...messages].reverse().find((message) => message.role === 'assistant' && message.text)?.text || null,
        disclosure,
        isLoadingConversations,
        isLoadingMessages,
        hasMoreConversations,
        hasMoreMessages,
        historyError,
        canStartNewConversation: !activityScoped
          && !isLoadingConversations
          && !conversations.some((conversation) => conversation.message_count === 0),
        send,
        requestSupport,
        selectConversation,
        startNewConversation,
        deleteConversation,
        loadMoreConversations,
        loadMoreMessages,
        reloadHistory,
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
