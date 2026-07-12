import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { AppBar } from '../../components/AppBar'
import { navigate } from '../../app/router'
import { useI18n } from '../../i18n/I18nProvider'
import { useResponsive } from '../../hooks/useResponsive'
import { apiGet, apiPatch, apiPost } from '../../services/api'
import { CURRENT_LEARNER_ID } from '../../services/xapi'
import type { ChatMessage, QuestionLocation, Questionnaire, QuestionnaireOptionQuestion } from './types'
import { YubiRobot3D, YUBI_INTRO_READY_DELAY_MS } from './YubiRobot3D'
import { PHASE_REWARDS, getAsset } from '../yubi-studio/yubiAssets'
import { useStudioTransition } from '../yubi-studio/StudioTransitionProvider'
import { Toast } from '../../components/Toast'

type Screen = 'chat' | 'question' | 'complete'
type ChatMode = 'intro' | 'section' | 'summary'
type Answers = Record<number, number>
type ReflectionPhase = 'entering' | 'thinking' | 'speaking' | 'awaiting' | 'celebrating' | 'returning'

type SummarySnapshot = {
  partIndex: number
  title: string
  qa: { question: string; answer: string }[]
  context: string
  isLast: boolean
  resolved: boolean
  messages: ChatMessage[]
  questions?: ReflectQuestion[]
  reflectIndex?: number
  choices?: ReflectChoice[]
  profile?: string
}

type ReflectOption = { label: string; signal: string }
type ReflectQuestion = { prompt: string; options: ReflectOption[] }
type ReflectChoice = { question: string; choice: string; signal: string }

type MappingProgress = {
  screen: Screen
  chatMode: ChatMode
  activeStep: number
  currentIndex: number
  answers: Answers
  summary: SummarySnapshot | null
  completed: boolean
}

const studentName = 'יובל כהן'
const QUESTION_HANDOFF_CLEAR_MS = 600
const QUESTION_HANDOFF_MOVE_MS = 1180
const REFLECTION_HANDOFF_MOVE_MS = 900
const REFLECTION_THINK_MS = 1300
const REFLECTION_BETWEEN_MESSAGES_MS = 520
const REFLECTION_CELEBRATE_MS = 2350
const REFLECTION_SPEECH_MAX_MS = 1250
const REFLECTION_BLACK_HOLE_MS = 540
// Option-label fade duration once Yubi lands (matches the .q-node opacity
// transition in learner-mapping.css).
const QUESTION_HANDOFF_LABEL_FADE_MS = 500
// Sequence reads land → labels fade in → 1s beat → first question types.
// The typing delay must fully cover the flight and the label fade, then wait an
// extra second so the question only begins after the labels have settled.
const QUESTION_HANDOFF_QUESTION_DELAY_MS =
  QUESTION_HANDOFF_MOVE_MS + QUESTION_HANDOFF_LABEL_FADE_MS + 1000

export function LearnerMappingPage() {
  const { language, isLoading, t } = useI18n()
  const studioTransition = useStudioTransition()
  const { isPhone } = useResponsive()
  const [questionnaire, setQuestionnaire] = useState<Questionnaire | null>(null)
  const [screen, setScreen] = useState<Screen>('chat')
  const [chatMode, setChatMode] = useState<ChatMode>('intro')
  const [activeStep, setActiveStep] = useState(0)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [isTyping, setIsTyping] = useState(true)
  const [isSpeakingText, setIsSpeakingText] = useState(false)
  const [introHandoff, setIntroHandoff] = useState(false)
  const [showIntegrityDialog, setShowIntegrityDialog] = useState(false)
  const [questionEntryTransition, setQuestionEntryTransition] = useState(false)
  const [transitionYubi, setTransitionYubi] = useState<{ style: CSSProperties } | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Answers>({})
  const [lastSectionContext, setLastSectionContext] = useState('')
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [reflectQuestions, setReflectQuestions] = useState<ReflectQuestion[]>([])
  const [reflectIndex, setReflectIndex] = useState(-1)
  const [reflectChoices, setReflectChoices] = useState<ReflectChoice[]>([])
  const [reflectProfile, setReflectProfile] = useState('neutral')
  const [isLastSection, setIsLastSection] = useState(false)
  const [summaryPartIndex, setSummaryPartIndex] = useState(0)
  const [summaryTitle, setSummaryTitle] = useState('')
  const [summaryQa, setSummaryQa] = useState<{ question: string; answer: string }[]>([])
  const [sectionResolved, setSectionResolved] = useState(false)
  const [reflectionPhase, setReflectionPhase] = useState<ReflectionPhase>('thinking')
  const [reflectionText, setReflectionText] = useState('')
  const [booting, setBooting] = useState(true)
  // Phase reward: the asset just unlocked by completing a section (toast).
  const [rewardAssetId, setRewardAssetId] = useState<string | null>(null)
  // Already-earned unlocks, loaded once so a reward isn't re-announced on resume.
  const unlockedRef = useRef<Set<string>>(new Set())
  const chatSequenceRunRef = useRef(0)
  const transitionRunRef = useRef(0)
  const hydratedRef = useRef(false)
  const skipIntroRef = useRef(false)
  // Mirrors the live transcript so the debounced autosave can persist the real
  // messages without re-running on every typed character.
  const chatMessagesRef = useRef<ChatMessage[]>([])

  const flattened = useMemo(() => {
    const questions: QuestionnaireOptionQuestion[] = []
    const locations: QuestionLocation[] = []
    questionnaire?.parts.forEach((part, partIndex) => {
      part.questions.forEach((question) => {
        questions.push(question)
        locations.push({ partIndex, partTitle: part.title })
      })
    })
    return { questions, locations }
  }, [questionnaire])

  const currentQuestion = flattened.questions[currentIndex]
  const currentLocation = flattened.locations[currentIndex]
  const totalQuestions = flattened.questions.length
  // First question index of the current phase — the back-navigation floor so a
  // previous (already-summarized) phase can't be re-entered and re-triggered.
  const currentPartStartIndex = currentLocation
    ? flattened.locations.findIndex((l) => l.partIndex === currentLocation.partIndex)
    : 0

  useEffect(() => {
    if (isLoading) return
    let cancelled = false
    // Capture the first-load decision synchronously, BEFORE any await. Under
    // React.StrictMode the effect runs twice in dev; if we derived this after
    // an await (or flipped hydratedRef early) the cancelled first run would
    // claim hydration and the second run would skip the resume branch — the
    // saved mapping_progress would then never be applied on reload.
    const isFirstLoad = !hydratedRef.current
    // Only show the boot spinner during the very first hydration. Later runs
    // (e.g. a language switch) refetch the localized questionnaire silently so
    // the screen doesn't flash a second loading cycle.
    if (isFirstLoad) setBooting(true)
    void (async () => {
      let nextQuestionnaire: Questionnaire | null = null
      try {
        nextQuestionnaire = await apiGet<Questionnaire>(`/api/questionnaire?lang=${encodeURIComponent(language)}`)
      } catch {
        if (!cancelled) {
          setQuestionnaire(null)
          setBooting(false)
        }
        return
      }
      if (cancelled || !nextQuestionnaire) return

      // Subsequent runs (e.g. a language switch) only refresh the localized
      // questionnaire — they must never reset the learner to the intro scene.
      if (!isFirstLoad) {
        setQuestionnaire(nextQuestionnaire)
        setBooting(false)
        return
      }

      // Resume exactly where the learner left off — MongoDB-backed state, not
      // localStorage (720: learner progress must live in backend state).
      try {
        const state = await apiGet<{ mapping_progress?: MappingProgress | null }>(
          `/api/learner-state?learner_id=${encodeURIComponent(CURRENT_LEARNER_ID)}`
        )
        if (cancelled) return
        const progress = state?.mapping_progress
        if (progress && !progress.completed && progress.screen && progress.screen !== 'complete') {
          skipIntroRef.current = true
          setQuestionnaire(nextQuestionnaire)
          restoreProgress(progress)
          hydratedRef.current = true
          setBooting(false)
          return
        }
      } catch {
        // Fall through to a fresh intro if state cannot be read.
      }
      if (cancelled) return

      skipIntroRef.current = false
      setQuestionnaire(nextQuestionnaire)
      setScreen('chat')
      setChatMode('intro')
      setActiveStep(0)
      setCurrentIndex(0)
      setAnswers({})
      setSectionResolved(false)
      setShowIntegrityDialog(false)
      setIntroHandoff(false)
      setQuestionEntryTransition(false)
      setTransitionYubi(null)
      setReflectionPhase('thinking')
      setReflectionText('')
      transitionRunRef.current += 1
      // Mark hydration complete only after the fresh intro is applied, so a
      // cancelled StrictMode run never blocks the surviving run's resume.
      hydratedRef.current = true
      setBooting(false)
    })()
    return () => {
      cancelled = true
    }
  }, [language, isLoading])

  function restoreProgress(progress: MappingProgress) {
    setActiveStep(progress.activeStep ?? 1)
    setAnswers(progress.answers || {})
    setCurrentIndex(progress.currentIndex || 0)
    setIntroHandoff(false)
    setQuestionEntryTransition(false)
    setTransitionYubi(null)
    if (progress.screen === 'chat' && progress.chatMode === 'summary' && progress.summary) {
      const snapshot = progress.summary
      setScreen('chat')
      setChatMode('summary')
      setSummaryPartIndex(snapshot.partIndex)
      setSummaryTitle(snapshot.title)
      setSummaryQa(snapshot.qa || [])
      setLastSectionContext(snapshot.context || '')
      setIsLastSection(snapshot.isLast)
      setSectionResolved(snapshot.resolved)
      setReflectQuestions(snapshot.questions || [])
      setReflectIndex(snapshot.reflectIndex ?? -1)
      setReflectChoices(snapshot.choices || [])
      setReflectProfile(snapshot.profile || 'neutral')
      setChatMessages(snapshot.messages || [])
      setChatHistory(snapshot.messages || [])
      setIsTyping(false)
      setIsSpeakingText(false)
      const latestAssistant = [...(snapshot.messages || [])].reverse().find((message) => message.role === 'assistant')
      const activePrompt = snapshot.questions?.[snapshot.reflectIndex ?? -1]?.prompt
      setReflectionText(snapshot.resolved ? latestAssistant?.content || '' : activePrompt || latestAssistant?.content || '')
      setReflectionPhase(snapshot.resolved ? 'celebrating' : 'awaiting')
    } else {
      setScreen('question')
      setChatMode('section')
      setSectionResolved(false)
    }
  }

  useEffect(() => {
    if (!questionnaire || isLoading || booting) return
    if (skipIntroRef.current) return
    const messages = [1, 2, 3, 4, 5, 6].map((index) => t(`intro.${index}`, { studentName }))
    void playChatSequence(messages, 'intro')
    return () => {
      chatSequenceRunRef.current += 1
    }
  }, [questionnaire, language, isLoading, booting])

  function persistMappingProgress(progress: MappingProgress) {
    void apiPatch('/api/learner-state', {
      learner_id: CURRENT_LEARNER_ID,
      mapping_progress: progress,
    }).catch(() => {})
  }

  // Load already-earned Yubi unlocks once so completing a section that was
  // already rewarded (e.g. after a resume) doesn't re-announce the prize.
  useEffect(() => {
    void apiGet<{ avatar_unlocks?: string[] }>(
      `/api/learner-state?learner_id=${encodeURIComponent(CURRENT_LEARNER_ID)}`
    )
      .then((state) => {
        unlockedRef.current = new Set(Array.isArray(state?.avatar_unlocks) ? state.avatar_unlocks : [])
      })
      .catch(() => {})
  }, [])

  // Reward the learner with a store item when they finish a mapping section.
  // The unlock is progress-derived (only granted on real completion) and
  // persisted; the studio reads it to open the matching item.
  function grantPhaseReward(partIndex: number) {
    const assetId = PHASE_REWARDS[partIndex]
    if (!assetId || unlockedRef.current.has(assetId)) return
    unlockedRef.current.add(assetId)
    void apiPatch('/api/learner-state', {
      learner_id: CURRENT_LEARNER_ID,
      avatar_unlocks: Array.from(unlockedRef.current),
    }).catch(() => {})
    setRewardAssetId(assetId)
  }

  // Persist question/location progress (debounced) so a refresh resumes the
  // learner at the exact spot. Chat transcript snapshots are saved explicitly
  // only after a message finishes typing, not during every character.
  useEffect(() => {
    if (!questionnaire || !hydratedRef.current) return
    const inQuestion = screen === 'question'
    const inSummary = screen === 'chat' && chatMode === 'summary'
    if (!inQuestion && !inSummary) return
    const handle = window.setTimeout(() => {
      const progress: MappingProgress = {
        screen,
        chatMode,
        activeStep,
        currentIndex,
        answers,
        summary: inSummary
          ? {
              partIndex: summaryPartIndex,
              title: summaryTitle,
              qa: summaryQa,
              context: lastSectionContext,
              isLast: isLastSection,
              resolved: sectionResolved,
              messages: chatMessagesRef.current,
              questions: reflectQuestions,
              reflectIndex,
              choices: reflectChoices,
              profile: reflectProfile,
            }
          : null,
        completed: false,
      }
      persistMappingProgress(progress)
    }, 500)
    return () => window.clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionnaire, screen, chatMode, activeStep, currentIndex, answers,
      sectionResolved, summaryPartIndex, summaryTitle, summaryQa, lastSectionContext, isLastSection,
      reflectQuestions, reflectIndex, reflectChoices])

  useEffect(() => {
    chatMessagesRef.current = chatMessages
  }, [chatMessages, isTyping])

  // A resolved reflection always moves on automatically. Keeping this in an
  // effect also makes a refreshed, already-resolved checkpoint continue rather
  // than restoring a dead-end "next" button.
  useEffect(() => {
    if (screen !== 'chat' || chatMode !== 'summary' || !sectionResolved || reflectionPhase !== 'celebrating') return
    const runId = transitionRunRef.current
    const handle = window.setTimeout(() => {
      if (transitionRunRef.current !== runId) return
      void finishReflectionStage()
    }, REFLECTION_CELEBRATE_MS)
    return () => window.clearTimeout(handle)
  }, [screen, chatMode, sectionResolved, reflectionPhase])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (screen !== 'question') return
      const isRtl = document.documentElement.dir !== 'ltr'
      if ((isRtl && event.key === 'ArrowLeft') || (!isRtl && event.key === 'ArrowRight')) navigateNext()
      if ((isRtl && event.key === 'ArrowRight') || (!isRtl && event.key === 'ArrowLeft')) navigatePrev()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  async function playChatSequence(messages: string[], mode: ChatMode) {
    const runId = chatSequenceRunRef.current + 1
    chatSequenceRunRef.current = runId
    setChatMode(mode)
    setChatMessages([])
    setIsTyping(true)
    setIsSpeakingText(false)

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const sequenceStartedAt = Date.now()
    const introPauseBeforeIndex = mode === 'intro' && !reducedMotion ? 2 : -1

    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i]
      if (i === introPauseBeforeIndex) {
        const remainingIntroDelay = YUBI_INTRO_READY_DELAY_MS - (Date.now() - sequenceStartedAt)
        if (remainingIntroDelay > 0) await wait(remainingIntroDelay)
        if (chatSequenceRunRef.current !== runId) return
      } else if (i > 0) {
        await wait(reducedMotion ? 120 : 340)
        if (chatSequenceRunRef.current !== runId) return
      }
      // Open an empty bubble, then reveal it character-by-character (no dots).
      setChatMessages((previous) => [...previous, { role: 'assistant', content: '' }])
      if (reducedMotion) {
        setChatMessages((previous) => {
          const copy = [...previous]
          copy[copy.length - 1] = { role: 'assistant', content: message }
          return copy
        })
        continue
      }
      setIsSpeakingText(true)
      const revealed = await typeIntoLastMessage(runId, message)
      if (chatSequenceRunRef.current !== runId) return
      setIsSpeakingText(false)
      if (!revealed) return
    }

    if (chatSequenceRunRef.current !== runId) return
    setIsSpeakingText(false)
    setIsTyping(false)
  }

  // Reveals `text` into the most recent bubble one character at a time so the
  // message appears to be typed smoothly. Returns false if the run was superseded.
  async function typeIntoLastMessage(runId: number, text: string): Promise<boolean> {
    const chars = Array.from(text)
    let output = ''
    for (const char of chars) {
      output += char
      const snapshot = output
      setChatMessages((previous) => {
        const copy = [...previous]
        copy[copy.length - 1] = { role: 'assistant', content: snapshot }
        return copy
      })
      // Slightly longer pause after sentence punctuation for a natural cadence.
      const pause = /[.!?…,\n]/.test(char) ? 55 : 16
      await wait(pause)
      if (chatSequenceRunRef.current !== runId) return false
    }
    return true
  }

  // Types the currently active mouth-origin card while retaining the full
  // transcript in the backend checkpoint. The learner only sees one active
  // message, so the reflection stays focused and does not become a chat log.
  async function speakReflection(text: string) {
    const runId = chatSequenceRunRef.current + 1
    chatSequenceRunRef.current = runId
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    setReflectionText('')
    setReflectionPhase('speaking')
    setIsSpeakingText(!reducedMotion)
    setIsTyping(false)
    setChatMessages((previous) => {
      const next = [...previous, { role: 'assistant' as const, content: '' }]
      chatMessagesRef.current = next
      return next
    })

    if (reducedMotion) {
      setReflectionText(text)
      setChatMessages((previous) => {
        const copy = [...previous]
        copy[copy.length - 1] = { role: 'assistant', content: text }
        chatMessagesRef.current = copy
        return copy
      })
      setIsSpeakingText(false)
      return true
    }

    const characters = Array.from(text)
    const punctuationCount = characters.filter((char) => /[.!?…,\n]/.test(char)).length
    const weightedLength = Math.max(1, characters.length + punctuationCount * 2)
    const characterPause = Math.min(14, REFLECTION_SPEECH_MAX_MS / weightedLength)
    let output = ''
    for (const char of characters) {
      if (chatSequenceRunRef.current !== runId) return false
      output += char
      const snapshot = output
      setReflectionText(snapshot)
      setChatMessages((previous) => {
        const copy = [...previous]
        copy[copy.length - 1] = { role: 'assistant', content: snapshot }
        chatMessagesRef.current = copy
        return copy
      })
      await wait(/[.!?…,\n]/.test(char) ? characterPause * 3 : characterPause)
    }
    if (chatSequenceRunRef.current !== runId) return false
    setIsSpeakingText(false)
    return true
  }

  async function enterReflectionStage() {
    const runId = transitionRunRef.current + 1
    transitionRunRef.current = runId
    const reducedMotion =
      isPhone ||
      (typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
    const ringEl = document.querySelector('.q-ring-center') as HTMLElement | null
    const fromRect = ringEl?.getBoundingClientRect()

    setReflectionPhase('entering')
    if (!reducedMotion && fromRect && fromRect.width > 0) {
      setTransitionYubi({
        style: {
          left: fromRect.left,
          top: fromRect.top,
          width: fromRect.width,
          height: fromRect.height,
          transform: 'translate(0px, 0px) scale(1)',
          transition: 'none',
        },
      })
    }
    setScreen('chat')
    setChatMode('summary')
    setActiveStep(2)

    if (reducedMotion) {
      setReflectionPhase('thinking')
      return true
    }
    await wait(40)
    if (transitionRunRef.current !== runId) return false
    const stageEl = document.querySelector('.reflection-yubi-anchor') as HTMLElement | null
    const toRect = stageEl?.getBoundingClientRect()
    if (fromRect && fromRect.width > 0 && toRect && toRect.width > 0) {
      const dx = (toRect.left + toRect.width / 2) - (fromRect.left + fromRect.width / 2)
      const dy = (toRect.top + toRect.height / 2) - (fromRect.top + fromRect.height / 2)
      const scale = toRect.width / fromRect.width
      setTransitionYubi({
        style: {
          left: fromRect.left,
          top: fromRect.top,
          width: fromRect.width,
          height: fromRect.height,
          transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
          transition: `transform ${REFLECTION_HANDOFF_MOVE_MS}ms cubic-bezier(.2,.86,.18,1)`,
        },
      })
    }
    await wait(REFLECTION_HANDOFF_MOVE_MS)
    if (transitionRunRef.current !== runId) return false
    setTransitionYubi(null)
    setReflectionPhase('thinking')
    return true
  }

  async function finishReflectionStage() {
    if (isLastSection) {
      await submitQuestionnaire()
      return
    }

    const runId = transitionRunRef.current + 1
    transitionRunRef.current = runId
    const reducedMotion =
      isPhone ||
      (typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
    const stageEl = document.querySelector('.reflection-yubi-anchor') as HTMLElement | null
    const fromRect = stageEl?.getBoundingClientRect()
    setReflectionPhase('returning')

    if (!reducedMotion && fromRect && fromRect.width > 0) {
      setTransitionYubi({
        style: {
          left: fromRect.left,
          top: fromRect.top,
          width: fromRect.width,
          height: fromRect.height,
          transform: 'translate(0px, 0px) scale(1)',
          transition: 'none',
        },
      })
    }

    // Let the purple reflection world spiral into its center before replacing
    // it with the questionnaire. The separate transition Yubi remains visible
    // above the collapsing field and then flies back into the answer ring.
    if (!reducedMotion) {
      await wait(REFLECTION_BLACK_HOLE_MS)
      if (transitionRunRef.current !== runId) return
    }

    setScreen('question')
    setChatMode('section')
    setActiveStep(1)
    setQuestionEntryTransition(!reducedMotion)
    setSectionResolved(false)
    persistMappingProgress({
      screen: 'question',
      chatMode: 'section',
      activeStep: 1,
      currentIndex,
      answers,
      summary: null,
      completed: false,
    })
    if (reducedMotion) {
      setTransitionYubi(null)
      return
    }

    await wait(40)
    if (transitionRunRef.current !== runId) return
    const ringEl = document.querySelector('.q-ring-center') as HTMLElement | null
    const toRect = ringEl?.getBoundingClientRect()
    if (fromRect && fromRect.width > 0 && toRect && toRect.width > 0) {
      const dx = (toRect.left + toRect.width / 2) - (fromRect.left + fromRect.width / 2)
      const dy = (toRect.top + toRect.height / 2) - (fromRect.top + fromRect.height / 2)
      const scale = toRect.width / fromRect.width
      setTransitionYubi({
        style: {
          left: fromRect.left,
          top: fromRect.top,
          width: fromRect.width,
          height: fromRect.height,
          transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
          transition: `transform ${REFLECTION_HANDOFF_MOVE_MS}ms cubic-bezier(.2,.86,.18,1)`,
        },
      })
    }
    await wait(REFLECTION_HANDOFF_MOVE_MS)
    if (transitionRunRef.current !== runId) return
    setTransitionYubi(null)
    setQuestionEntryTransition(false)
  }

  async function startQuestions() {
    if (!questionnaire || introHandoff) return
    setShowIntegrityDialog(false)
    chatSequenceRunRef.current += 1
    const runId = transitionRunRef.current + 1
    transitionRunRef.current = runId
    const reducedMotion =
      isPhone ||
      (typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

    setCurrentIndex(0)

    if (reducedMotion) {
      setScreen('question')
      setActiveStep(1)
      return
    }

    // Measure where Yubi currently stands, then float a single persistent Yubi
    // overlay onto that exact spot so it survives the intro→question screen swap
    // (the per-screen WebGL robots would otherwise unmount and "disappear").
    const introEl = document.querySelector('.intro-robot-zone .yubi-floater') as HTMLElement | null
    const fromRect = introEl?.getBoundingClientRect()
    if (fromRect && fromRect.width > 0) {
      setTransitionYubi({
        style: {
          left: fromRect.left,
          top: fromRect.top,
          width: fromRect.width,
          height: fromRect.height,
          transform: 'translate(0px, 0px) scale(1)',
          transition: 'none',
        },
      })
    }

    // Intro copy fades out while Yubi stays put; the overlay warms up its first
    // frames behind the identical intro robot so the swap has no blank flash.
    setIntroHandoff(true)
    await wait(QUESTION_HANDOFF_CLEAR_MS)
    if (transitionRunRef.current !== runId) return

    // Question surfaces appear (its own ring robot stays hidden for now).
    setScreen('question')
    setActiveStep(1)
    setQuestionEntryTransition(true)
    setIntroHandoff(false)

    // Once the ring exists, shrink + glide the overlay Yubi into its center.
    await wait(30)
    if (transitionRunRef.current !== runId) return
    const ringEl = document.querySelector('.q-ring-center') as HTMLElement | null
    const toRect = ringEl?.getBoundingClientRect()
    if (fromRect && fromRect.width > 0 && toRect && toRect.width > 0) {
      const dx = (toRect.left + toRect.width / 2) - (fromRect.left + fromRect.width / 2)
      const dy = (toRect.top + toRect.height / 2) - (fromRect.top + fromRect.height / 2)
      const scale = toRect.width / fromRect.width
      setTransitionYubi({
        style: {
          left: fromRect.left,
          top: fromRect.top,
          width: fromRect.width,
          height: fromRect.height,
          transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
          transition: `transform ${QUESTION_HANDOFF_MOVE_MS}ms cubic-bezier(.2,.86,.18,1)`,
        },
      })
    }

    await wait(QUESTION_HANDOFF_MOVE_MS)
    if (transitionRunRef.current !== runId) return

    // Hand off to the real ring robot (identical pose → no visible pop), then
    // the first question begins typing (its own entry delay covers the glide).
    setQuestionEntryTransition(false)
    setTransitionYubi(null)
  }

  function navigatePrev() {
    // Only navigate back WITHIN the current phase. Crossing back into a previous
    // (already-summarized) phase would re-trigger its mid-phase summary/chat, so
    // the first question of the current phase is the back-navigation floor.
    if (currentIndex <= currentPartStartIndex) return
    setCurrentIndex((index) => index - 1)
  }

  function navigateNext() {
    if (!currentQuestion || answers[currentQuestion.id] === undefined) return

    const currentPart = currentLocation.partIndex
    const nextIndex = currentIndex + 1
    const answersSnapshot = { ...answers }

    if (nextIndex >= totalQuestions) {
      void showSectionSummary(currentPart, true, answersSnapshot, currentIndex)
      return
    }

    const nextPart = flattened.locations[nextIndex].partIndex
    setCurrentIndex(nextIndex)
    if (nextPart !== currentPart) {
      void showSectionSummary(currentPart, false, answersSnapshot, nextIndex)
    }
  }

  function chooseOption(questionId: number, optionIndex: number) {
    // Record the choice only — advancing is explicit via the approve button.
    setAnswers((previous) => ({ ...previous, [questionId]: optionIndex }))
  }

  async function showSectionSummary(
    partIndex: number,
    last: boolean,
    nextAnswers: Answers = answers,
    resumeIndex: number = currentIndex,
  ) {
    const part = questionnaire?.parts[partIndex]
    if (!part) return

    chatSequenceRunRef.current += 1
    setIsLastSection(last)
    setSectionResolved(false)
    setActiveStep(2)
    setChatMessages([])
    setReflectQuestions([])
    setReflectIndex(-1)
    setReflectChoices([])
    setIsTyping(true)
    setReflectionText('')

    const entered = await enterReflectionStage()
    if (!entered) return

    const questionsAndAnswers = part.questions.map((question) => {
      const answerIndex = nextAnswers[question.id]
      return {
        question: question.text,
        answer: answerIndex === undefined ? '' : question.options[answerIndex] || ''
      }
    })

    setSummaryPartIndex(partIndex)
    setSummaryTitle(part.title)
    setSummaryQa(questionsAndAnswers)
    // Completing this section earns a Yubi store item (if that part maps to one).
    grantPhaseReward(partIndex)
    setLastSectionContext(
      `${part.title} - ${questionsAndAnswers.map((pair) => `${pair.question}: ${pair.answer}`).join(' | ')}`
    )

    // New reflection: a short opener + up to 3 tap-to-answer questions about the
    // most extreme answers (no free text). Deterministic engine — text comes from
    // locale keys we resolve here; the opener names the top strength/difficulty
    // themes for a deeper, grounded first message.
    type ThemeRef = { key: string; subject?: string }
    type ApiQuestion = { prompt_key: string; params?: { subject?: string }; options: { key: string; signal: string }[] }
    const resolveTheme = (ref?: ThemeRef) =>
      ref ? (ref.subject ? t(ref.key, { subject: t(ref.subject) }) : t(ref.key)) : ''
    let opener = ''
    let profile = 'neutral'
    let questions: ReflectQuestion[] = []
    try {
      const [response] = await Promise.all([
        apiPost<{
        opener_key: string
        opener_params?: { strength?: ThemeRef; difficulty?: ThemeRef }
        profile?: string
        questions: ApiQuestion[]
      }>('/api/section-reflect', {
        part_id: part.id,
        questions_and_answers: questionsAndAnswers,
        language,
        }),
        wait(REFLECTION_THINK_MS),
      ])
      profile = response.profile || 'neutral'
      const openerParams: Record<string, string> = {}
      if (response.opener_params?.strength) openerParams.strength = resolveTheme(response.opener_params.strength)
      if (response.opener_params?.difficulty) openerParams.difficulty = resolveTheme(response.opener_params.difficulty)
      opener = response.opener_key ? t(response.opener_key, openerParams) : t('fallback.summary')
      questions = (Array.isArray(response.questions) ? response.questions : []).map((q) => ({
        prompt: q.params?.subject ? t(q.prompt_key, { subject: t(q.params.subject) }) : t(q.prompt_key),
        options: (q.options || []).map((o) => ({ label: t(o.key), signal: o.signal })),
      }))
    } catch {
      opener = t('fallback.summary')
    }
    setReflectProfile(profile)

    setChatHistory((previous) => [...previous, { role: 'assistant', content: opener }])
    if (!await speakReflection(opener)) return

    let resolved = false
    if (questions.length > 0) {
      setReflectQuestions(questions)
      setReflectIndex(0)
      await wait(REFLECTION_BETWEEN_MESSAGES_MS)
      setReflectionText('')
      setReflectionPhase('thinking')
      await wait(REFLECTION_THINK_MS)
      if (!await speakReflection(questions[0].prompt)) return
      setReflectionPhase('awaiting')
      setChatHistory((previous) => [...previous, { role: 'assistant', content: questions[0].prompt }])
    } else {
      // Nothing notable to clarify — close warmly and supportively.
      resolved = true
      setSectionResolved(true)
      const closing = t(`reflect.close.${profile}.${last ? 'results' : 'next'}`)
      await wait(REFLECTION_BETWEEN_MESSAGES_MS)
      setReflectionText('')
      setReflectionPhase('thinking')
      await wait(REFLECTION_THINK_MS)
      if (!await speakReflection(closing)) return
      setChatHistory((previous) => [...previous, { role: 'assistant', content: closing }])
      setReflectionPhase('celebrating')
    }

    persistMappingProgress({
      screen: 'chat',
      chatMode: 'summary',
      activeStep: 2,
      currentIndex: resumeIndex,
      answers: nextAnswers,
      summary: {
        partIndex,
        title: part.title,
        qa: questionsAndAnswers,
        context: `${part.title} - ${questionsAndAnswers.map((pair) => `${pair.question}: ${pair.answer}`).join(' | ')}`,
        isLast: last,
        resolved,
        messages: chatMessagesRef.current,
        questions,
        reflectIndex: questions.length > 0 ? 0 : -1,
        choices: [],
        profile,
      },
      completed: false,
    })
  }

  // Learner taps one of the (≤4) grounded options for the active reflection
  // question. Records the pick, advances to the next question, and on the last
  // one silently consolidates the picks into the brain, then closes warmly.
  async function pickReflectOption(option: ReflectOption) {
    const active = reflectQuestions[reflectIndex]
    if (!active || sectionResolved || isSpeakingText || reflectionPhase !== 'awaiting') return

    setChatMessages((previous) => {
      const next = [...previous, { role: 'user' as const, content: option.label }]
      chatMessagesRef.current = next
      return next
    })
    setChatHistory((previous) => [...previous, { role: 'user', content: option.label }])
    const nextChoices = [...reflectChoices, { question: active.prompt, choice: option.label, signal: option.signal }]
    setReflectChoices(nextChoices)
    setReflectionText('')
    setReflectionPhase('thinking')
    await wait(REFLECTION_THINK_MS)

    const nextIndex = reflectIndex + 1
    if (nextIndex < reflectQuestions.length) {
      setReflectIndex(nextIndex)
      if (!await speakReflection(reflectQuestions[nextIndex].prompt)) return
      setReflectionPhase('awaiting')
      setChatHistory((previous) => [...previous, { role: 'assistant', content: reflectQuestions[nextIndex].prompt }])
      persistMappingProgress({
        screen: 'chat', chatMode: 'summary', activeStep: 2, currentIndex, answers,
        summary: {
          partIndex: summaryPartIndex, title: summaryTitle, qa: summaryQa,
          context: lastSectionContext, isLast: isLastSection, resolved: false,
          messages: chatMessagesRef.current, questions: reflectQuestions,
          reflectIndex: nextIndex, choices: nextChoices, profile: reflectProfile,
        },
        completed: false,
      })
      return
    }

    // Last question answered — consolidate picks (non-blocking) and close.
    setReflectIndex(reflectQuestions.length)
    void apiPost('/api/section-reflect/capture', {
      learner_id: CURRENT_LEARNER_ID,
      phase_title: summaryTitle,
      language,
      choices: nextChoices.map((c) => ({ label: c.choice, signal: c.signal })),
    }).catch(() => {})
    setSectionResolved(true)
    const closing = t(`reflect.close.${reflectProfile}.${isLastSection ? 'results' : 'next'}`)
    if (!await speakReflection(closing)) return
    setChatHistory((previous) => [...previous, { role: 'assistant', content: closing }])
    persistMappingProgress({
      screen: 'chat', chatMode: 'summary', activeStep: 2, currentIndex, answers,
      summary: {
        partIndex: summaryPartIndex, title: summaryTitle, qa: summaryQa,
        context: lastSectionContext, isLast: isLastSection, resolved: true,
        messages: chatMessagesRef.current, questions: reflectQuestions,
        reflectIndex: reflectQuestions.length, choices: nextChoices, profile: reflectProfile,
      },
      completed: false,
    })
    setReflectionPhase('celebrating')
  }

  async function submitQuestionnaire() {
    setScreen('complete')
    setActiveStep(3)
    try {
      // language localizes the Onboarding agent's profile labels; the learner's
      // free-text chat lines feed interest extraction (only what they stated).
      const freeTextLines = chatHistory.filter((m) => m.role === 'user').map((m) => m.content)
      await apiPost('/api/submit', {
        student_name: studentName,
        answers,
        language,
        free_text: freeTextLines.join('\n')
      })
    } catch {
      // Keep the student moving; results will show a no-data state if persistence fails.
    }
    // Mapping is done — clear the resume checkpoint so the next visit starts fresh.
    void apiPatch('/api/learner-state', {
      learner_id: CURRENT_LEARNER_ID,
      mapping_progress: { completed: true },
    }).catch(() => {})
  }

  // Demo shortcut: fill every question with a neutral default and jump to results.
  async function skipWithDefaults() {
    if (!flattened.questions.length) return
    const filled: Answers = {}
    flattened.questions.forEach((question) => {
      const optionCount = question.options?.length ?? 2
      filled[question.id] = Math.floor((optionCount - 1) / 2)
    })
    setAnswers(filled)
    setScreen('complete')
    setActiveStep(3)
    try {
      await apiPost('/api/submit', {
        student_name: studentName,
        answers: filled,
        language
      })
    } catch {
      // Results page will show a no-data state if persistence fails.
    }
    void apiPatch('/api/learner-state', {
      learner_id: CURRENT_LEARNER_ID,
      mapping_progress: { completed: true },
    }).catch(() => {})
    navigate('/results')
  }

  const progressPercent = totalQuestions ? Math.round(((currentIndex + 1) / totalQuestions) * 100) : 0
  const partTitle = cleanPartTitle(currentLocation?.partTitle || '')

  return (
    <div className="learner-mapping-page">
      <AppBar studentName={studentName} studentSubtitle={t('app.studentSubtitle')} activeStep={activeStep} />
      {rewardAssetId && (() => {
        const asset = getAsset(rewardAssetId)
        if (!asset) return null
        return (
          <Toast
            variant="reward"
            icon="🎉"
            title={t('yubiStudio.reward.title')}
            body={t('yubiStudio.reward.body', { item: t(asset.labelKey) })}
            actionLabel={t('yubiStudio.reward.cta')}
            onAction={() => navigate('/yuvi-studio')}
            onDismiss={() => setRewardAssetId(null)}
            dismissLabel={t('yubiStudio.reward.dismiss')}
          />
        )
      })()}
      <main className="stage" id="mainContent">
        {booting && (
          <section className="screen active">
            <MappingBoot label={t('app.loading')} />
          </section>
        )}
        {!booting && screen === 'chat' && (
          <section className="screen active">
            {chatMode === 'intro' ? (
              <IntroNarrative
                messages={chatMessages}
                isTyping={isTyping}
                startLabel={t('chat.action.start')}
                skipLabel={t('chat.action.skip')}
                trustLabel={t('chat.trust')}
                robotLabel={t('robot.aria')}
                lightweight={isPhone}
                isSpeakingText={isSpeakingText}
                canStart={Boolean(questionnaire)}
                isHandoff={introHandoff}
                onStart={() => setShowIntegrityDialog(true)}
                onSkip={() => void skipWithDefaults()}
                editTooltip={t('yubiStudio.launcher')}
                onEdit={(el) => (studioTransition ? studioTransition.openStudio(el) : navigate('/yuvi-studio'))}
              />
            ) : (
              <ReflectionStage
                phase={reflectionPhase}
                sectionLabel={t('reflect.header')}
                sectionTitle={cleanPartTitle(summaryTitle)}
                text={reflectionText}
                options={
                  !sectionResolved && reflectIndex >= 0 && reflectIndex < reflectQuestions.length
                    ? reflectQuestions[reflectIndex].options
                    : []
                }
                pickLabel={t('chat.reflect.pickAria')}
                thinkingLabel={t('chat.status.thinking')}
                robotLabel={t('robot.aria')}
                lightweight={isPhone}
                speaking={isSpeakingText}
                onPick={(option) => void pickReflectOption(option)}
                editTooltip={t('yubiStudio.launcher')}
                onEdit={(el) => (studioTransition ? studioTransition.openStudio(el) : navigate('/yuvi-studio'))}
              />
            )}
          </section>
        )}

        {!booting && screen === 'question' && currentQuestion && (
          <section className="screen active">
            <QuestionArena
              question={currentQuestion}
              partTitle={partTitle}
              progressPercent={progressPercent}
              questionLabel={t('question.count', {
                question: currentIndex + 1,
                totalQuestions
              })}
              parts={questionnaire?.parts.map((part) => cleanPartTitle(part.title)) ?? []}
              currentPartIndex={currentLocation?.partIndex ?? 0}
              selected={answers[currentQuestion.id]}
              onChoose={(index) => chooseOption(currentQuestion.id, index)}
              onApprove={navigateNext}
              onBack={navigatePrev}
              canBack={currentIndex > currentPartStartIndex}
              robotLabel={t('robot.aria')}
              approveLabel={t('question.confirm')}
              backLabel={t('question.prev')}
              microcopy={t('question.microcopy')}
              entryTransition={questionEntryTransition}
              entryDelayMs={questionEntryTransition ? QUESTION_HANDOFF_QUESTION_DELAY_MS : 0}
              editTooltip={t('yubiStudio.launcher')}
              onEdit={(el) => (studioTransition ? studioTransition.openStudio(el) : navigate('/yuvi-studio'))}
            />
          </section>
        )}

        {!booting && screen === 'complete' && (
          <section className="screen active">
            <div className="complete-card">
              <div className="complete-icon-svg"><CheckIcon /></div>
              <h2 className="complete-title">{t('complete.title', { studentName })}</h2>
              <p className="complete-subtitle">{t('complete.subtitle')}</p>
              <button className="sp-btn sp-btn--gradient sp-btn--pill complete-cta" onClick={() => navigate('/results')}>
                {t('complete.cta')}
              </button>
            </div>
          </section>
        )}
      </main>
      {transitionYubi && !isPhone && (
        <div className="yubi-transition-layer" style={transitionYubi.style} aria-hidden="true">
          <YubiRobot3D label={t('robot.aria')} speaking={false} followPointer={false} presenting={false} />
        </div>
      )}
      {showIntegrityDialog && (
        <IntegrityDialog
          title={t('integrityDialog.title')}
          body={t('integrityDialog.body')}
          scope={t('integrityDialog.scope', {
            questions: totalQuestions,
            parts: questionnaire?.parts.length ?? 0,
          })}
          respect={t('integrityDialog.respect')}
          ai={t('integrityDialog.ai')}
          actionLabel={t('integrityDialog.action')}
          onConfirm={() => void startQuestions()}
        />
      )}
    </div>
  )
}

function IntegrityDialog({
  title,
  body,
  scope,
  respect,
  ai,
  actionLabel,
  onConfirm,
}: {
  title: string
  body: string
  scope: string
  respect: string
  ai: string
  actionLabel: string
  onConfirm: () => void
}) {
  return (
    <div className="integrity-dialog-backdrop" role="presentation">
      <section
        className="integrity-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="integrity-dialog-title"
      >
        <div className="integrity-dialog-icon" aria-hidden="true"><LockIcon /></div>
        <h2 id="integrity-dialog-title">{title}</h2>
        <p>{body}</p>
        <p className="integrity-dialog-scope">{scope}</p>
        <div className="integrity-dialog-points">
          <p>{respect}</p>
          <p>{ai}</p>
        </div>
        <button className="sp-btn sp-btn--gradient sp-btn--pill" type="button" onClick={onConfirm} autoFocus>
          <span>{actionLabel}</span>
          <ChevronBackIcon />
        </button>
      </section>
    </div>
  )
}

function MappingBoot({ label }: { label: string }) {
  // Neutral loading state shown while we fetch the questionnaire + resume point,
  // so the intro never flashes before we know where to place the learner.
  return (
    <div className="mapping-boot" role="status" aria-live="polite" aria-label={label}>
      <span className="mapping-boot-spinner" aria-hidden="true" />
    </div>
  )
}

function ReflectionStage({
  phase,
  sectionLabel,
  sectionTitle,
  text,
  options,
  pickLabel,
  thinkingLabel,
  robotLabel,
  lightweight,
  speaking,
  onPick,
  editTooltip,
  onEdit,
}: {
  phase: ReflectionPhase
  sectionLabel: string
  sectionTitle: string
  text: string
  options: ReflectOption[]
  pickLabel: string
  thinkingLabel: string
  robotLabel: string
  lightweight: boolean
  speaking: boolean
  onPick: (option: ReflectOption) => void
  editTooltip: string
  onEdit: (sourceEl: HTMLElement) => void
}) {
  const isThinking = phase === 'thinking'
  const isCelebrating = phase === 'celebrating'
  const showCard = Boolean(text) && phase !== 'thinking' && phase !== 'entering' && phase !== 'returning'
  const showOptions = phase === 'awaiting' && options.length > 0

  return (
    <div className={`reflection-stage is-${phase}`}>
      <header className="reflection-phase-header">
        <span>{sectionLabel}</span>
        <h1 dir="auto">{sectionTitle}</h1>
      </header>

      <div className="reflection-spark-field" aria-hidden="true">
        {Array.from({ length: 24 }, (_, index) => (
          <i
            key={index}
            style={{
              '--spark-x': `${(index * 37 + 11) % 94 + 3}%`,
              '--spark-y': `${(index * 53 + 7) % 84 + 8}%`,
              '--spark-size': `${2 + (index % 3)}px`,
              '--spark-delay': `${-((index * 0.71) % 6.4)}s`,
              '--spark-duration': `${3.2 + (index % 6) * 0.62}s`,
            } as CSSProperties}
          />
        ))}
      </div>

      {isThinking && (
        <div className="reflection-thinking" role="status" aria-live="polite">
          <span className="reflection-thinking-dot reflection-thinking-dot--one" aria-hidden="true" />
          <span className="reflection-thinking-dot reflection-thinking-dot--two" aria-hidden="true" />
          <span className="reflection-thinking-dot reflection-thinking-dot--three" aria-hidden="true" />
          <strong>{thinkingLabel}</strong>
        </div>
      )}

      <div className={`reflection-speech${showCard ? ' is-visible' : ''}`} aria-live="polite">
        <p dir="auto">{text}</p>
        {showOptions && (
          <div className="reflection-speech-options" role="group" aria-label={pickLabel}>
            {options.map((option, index) => (
              <button
                type="button"
                className="reflection-speech-option"
                dir="auto"
                key={`${option.signal}-${index}`}
                onClick={() => onPick(option)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {isCelebrating && (
        <div className="reflection-celebration" aria-hidden="true">
          {Array.from({ length: 14 }, (_, index) => <i key={index} style={{ '--confetti-index': index } as CSSProperties} />)}
        </div>
      )}

      <div className="reflection-yubi-anchor">
        <YubiFloater
          label={robotLabel}
          lightweight={lightweight}
          speaking={speaking}
          thinking={isThinking}
          celebrating={isCelebrating}
          followPointer={false}
          presenting={false}
          editable={phase === 'awaiting'}
          editTooltip={editTooltip}
          onEdit={onEdit}
        />
      </div>
    </div>
  )
}

function YubiFloater({
  label,
  lightweight,
  speaking,
  thinking = false,
  celebrating = false,
  followPointer = Boolean(speaking),
  presenting = true,
  editable = false,
  editTooltip = '',
  onEdit,
}: {
  label: string
  lightweight?: boolean
  speaking?: boolean
  thinking?: boolean
  celebrating?: boolean
  followPointer?: boolean
  presenting?: boolean
  editable?: boolean
  editTooltip?: string
  onEdit?: (sourceEl: HTMLElement) => void
}) {
  // Card-less, free-floating companion: a transparent canvas that drifts over
  // the scene (CSS) while the robot idles/talks inside (WebGL). On phones we
  // skip mounting Three.js and show a light SVG mark instead — no WebGL cost.
  return (
    <div className={`yubi-floater${speaking ? ' is-speaking' : ''}${thinking ? ' is-thinking' : ''}${celebrating ? ' is-celebrating' : ''}`}>
      {lightweight ? (
        <div className="robot-lite" role="img" aria-label={label}><YubiFaceIcon /></div>
      ) : (
        <YubiRobot3D
          label={label}
          speaking={speaking}
          thinking={thinking}
          celebrating={celebrating}
          followPointer={followPointer}
          presenting={presenting}
          editable={editable}
          editTooltip={editTooltip}
          onEdit={onEdit}
        />
      )}
    </div>
  )
}

function IntroNarrative({
  messages, isTyping, startLabel, skipLabel, trustLabel, robotLabel, lightweight,
  isSpeakingText, canStart, isHandoff, onStart, onSkip, editTooltip, onEdit,
}: {
  messages: ChatMessage[]
  isTyping: boolean
  startLabel: string
  skipLabel: string
  trustLabel: string
  robotLabel: string
  lightweight: boolean
  isSpeakingText: boolean
  canStart: boolean
  isHandoff: boolean
  onStart: () => void
  onSkip: () => void
  editTooltip: string
  onEdit: (sourceEl: HTMLElement) => void
}) {
  const activeIndex = Math.max(0, messages.length - 1)
  const showActions = !isTyping && messages.length > 0

  return (
    <div className={`intro-stage${isTyping ? ' is-narrating' : ' is-ready'}${isHandoff ? ' is-handoff' : ''}`}>
      <div className="intro-robot-zone" aria-hidden="true">
        <div className="intro-stage-orbit" />
        <YubiFloater
          label={robotLabel}
          lightweight={lightweight}
          speaking={isSpeakingText}
          followPointer={showActions && !isHandoff}
          editable={showActions && !isHandoff}
          editTooltip={editTooltip}
          onEdit={onEdit}
        />
      </div>
      <div className="intro-script" aria-live="polite">
        <div className="intro-lines">
          {messages.map((message, index) => {
            const isActive = index === activeIndex
            return (
              <p
                className={`intro-line intro-line-${index + 1}${isActive ? ' active' : ' done'}${isActive && isTyping ? ' is-typing' : ''}`}
                dir="auto"
                key={index}
              >
                {message.content}
              </p>
            )
          })}
        </div>
        {showActions && (
          <div className="intro-reveal">
            <div className="intro-stage-actions">
              <button className="sp-btn sp-btn--gradient sp-btn--pill" onClick={onStart} disabled={!canStart}>
                <span>{startLabel}</span>
                <ChevronBackIcon />
              </button>
              <button className="sp-btn sp-btn--ghost sp-btn--pill sp-btn--sm" onClick={onSkip} disabled={!canStart}>
                {skipLabel}
              </button>
            </div>
            <div className="trust-line intro-trust">
              <LockIcon />
              <span>{trustLabel}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function QuestionArena({
  question, partTitle, progressPercent, questionLabel, parts, currentPartIndex,
  selected, onChoose, onApprove, onBack, canBack,
  robotLabel, approveLabel, backLabel, microcopy, entryTransition, entryDelayMs, editTooltip, onEdit,
}: {
  question: QuestionnaireOptionQuestion
  partTitle: string
  progressPercent: number
  questionLabel: string
  parts: string[]
  currentPartIndex: number
  selected?: number
  onChoose: (index: number) => void
  onApprove: () => void
  onBack: () => void
  canBack: boolean
  robotLabel: string
  approveLabel: string
  backLabel: string
  microcopy: string
  entryTransition: boolean
  entryDelayMs: number
  editTooltip: string
  onEdit: (sourceEl: HTMLElement) => void
}) {
  const count = question.options.length
  const hasSelection = selected !== undefined && selected >= 0
  const [typedQuestion, setTypedQuestion] = useState('')
  const [isQuestionTyping, setIsQuestionTyping] = useState(false)

  useEffect(() => {
    let cancelled = false
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    async function typeQuestion() {
      if (reducedMotion) {
        setTypedQuestion(question.text)
        setIsQuestionTyping(false)
        return
      }

      setTypedQuestion('')
      setIsQuestionTyping(false)
      if (entryDelayMs > 0) {
        await wait(entryDelayMs)
        if (cancelled) return
      }
      setIsQuestionTyping(true)
      let nextText = ''
      for (const char of Array.from(question.text)) {
        if (cancelled) return
        nextText += char
        setTypedQuestion(nextText)
        await wait(['.', '!', '?', '…', ',', '\n'].includes(char) ? 48 : 14)
      }
      if (!cancelled) setIsQuestionTyping(false)
    }

    void typeQuestion()
    return () => {
      cancelled = true
    }
  }, [entryDelayMs, question.id, question.text])

  // Options ring around Yubi (screen coords, +y down). The LEAST option (last
  // index) sits at the bottom; values ascend going up the left side.
  const slotAngle = (slot: number) => Math.PI / 2 + (slot / count) * Math.PI * 2
  const angleFor = (i: number) => slotAngle(count - 1 - i)

  // Direction Yubi should gaze toward = the selected option's spot on the ring.
  const pointAt = hasSelection
    ? { x: Math.cos(angleFor(selected as number)), y: Math.sin(angleFor(selected as number)) }
    : null

  const nudge = (delta: number) => {
    const base = hasSelection ? (selected as number) : 0
    onChoose(Math.min(count - 1, Math.max(0, base + delta)))
  }

  return (
    <div className={`q-layout${entryTransition ? ' is-entering' : ''}`}>
      <aside className="q-side">
        <h3 className="q-side-title">{partTitle}</h3>
        <ol className="q-parts">
          {parts.map((name, i) => (
            <li key={i} className={`q-part${i === currentPartIndex ? ' current' : i < currentPartIndex ? ' done' : ''}`}>
              <span className="q-part-dot">{i < currentPartIndex ? <CheckIcon /> : i + 1}</span>
              <span className="q-part-name">{name}</span>
            </li>
          ))}
        </ol>
        <div className="q-side-progress">
          <div className="q-progress-track"><div className="q-progress-fill" style={{ width: `${progressPercent}%` }} /></div>
          <span className="q-progress-label">{questionLabel}</span>
        </div>
      </aside>

      <section className="q-arena">
        <div className="q-arena-mini">
          <span className="sp-chip question-part-badge">{partTitle}</span>
          <div className="q-progress-track"><div className="q-progress-fill" style={{ width: `${progressPercent}%` }} /></div>
        </div>
        <h2 className={`q-arena-question${isQuestionTyping ? ' is-typing' : ''}`} dir="auto" aria-busy={isQuestionTyping}>
          <span>{typedQuestion}</span>
          {isQuestionTyping && <span className="q-question-caret" aria-hidden="true" />}
        </h2>

        <div
          className="q-ring"
          role="radiogroup"
          aria-label={question.text}
          onWheel={(event) => { event.preventDefault(); nudge(event.deltaY > 0 ? 1 : -1) }}
        >
          <div className="q-ring-halo" aria-hidden="true" />
          <CircularDial count={count} value={selected} radius={33} onPick={onChoose} />
          <div className="q-ring-center">
            <YubiRobot3D
              label={robotLabel}
              pointAt={pointAt}
              speaking={isQuestionTyping}
              followPointer={!entryTransition}
              editable
              editTooltip={editTooltip}
              onEdit={onEdit}
            />
          </div>
          {question.options.map((option, index) => {
            const a = angleFor(index)
            const x = 50 + 44 * Math.cos(a)
            const y = 50 + 44 * Math.sin(a)
            const chosen = selected === index
            const label = splitLeadingEmoji(option).label
            const labelCharacterCount = Array.from(label.trim()).length
            // Keep concise answers compact while giving longer localized labels
            // enough room to wrap naturally. Bounds preserve the ring layout.
            const labelWidth = Math.round(Math.min(205, Math.max(116, 76 + labelCharacterCount * 6.4)))
            // Longer labels receive extra translation in addition to the fixed
            // radial clearance applied to every option below.
            const cos = Math.cos(a)
            const sin = Math.sin(a)
            const outward = Math.min(1, Math.max(0, (label.length - 8) / 14))
            const xStrength = Math.min(1, Math.max(0, (Math.abs(cos) - 0.25) / 0.75))
            const yStrength = Math.min(1, Math.max(0, (Math.abs(sin) - 0.25) / 0.75))
            const tx = `${-50 + Math.sign(cos) * 26 * outward * xStrength}%`
            const verticalOffsetScale = sin > 0 ? 0.25 : 1
            const ty = `${-50 + Math.sign(sin) * 26 * outward * yStrength * verticalOffsetScale}%`
            // Wide side labels need a larger radial gap than the compact labels
            // near the top and bottom. This keeps every card visibly detached
            // from the dial without pushing the bottom card into the actions.
            const radialGap = 18 + Math.abs(cos) * 30 - Math.max(0, sin) * 12
            const nodeStyle = {
              left: `${x}%`,
              top: `${y}%`,
              width: `${labelWidth}px`,
              '--q-tx': tx,
              '--q-ty': ty,
              '--q-radial-x': `${cos * radialGap}px`,
              '--q-radial-y': `${sin * radialGap}px`,
            } as CSSProperties
            return (
              <button
                key={index}
                type="button"
                role="radio"
                aria-checked={chosen}
                className={`q-node${chosen ? ' chosen' : ''}`}
                style={nodeStyle}
                onClick={() => onChoose(index)}
              >
                {label}
              </button>
            )
          })}
        </div>

        <div className="q-actions">
          {canBack && (
            <button className="sp-btn sp-btn--ghost sp-btn--pill sp-btn--sm" onClick={onBack}>{backLabel}</button>
          )}
          <button className="sp-btn sp-btn--gradient sp-btn--pill" disabled={!hasSelection} onClick={onApprove}>
            <span>{approveLabel}</span>
            <ChevronBackIcon />
          </button>
        </div>
        <p className="q-microcopy">{microcopy}</p>
      </section>
    </div>
  )
}

// Circular selector drawn around the ring: tap anywhere on the dial and the
// nearest option is chosen; the arc fills up to the current pick. There is no
// drag/sweep — a single click selects. Options remain directly clickable too.
function CircularDial({ count, value, radius, onPick }: { count: number; value?: number; radius: number; onPick: (index: number) => void }) {
  const ref = useRef<SVGSVGElement | null>(null)
  const slotAngle = (slot: number) => Math.PI / 2 + (slot / count) * Math.PI * 2
  const angleFor = (i: number) => slotAngle(count - 1 - i)
  const polar = (ang: number) => [50 + radius * Math.cos(ang), 50 + radius * Math.sin(ang)] as const

  const pickFrom = (clientX: number, clientY: number) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const dist = Math.hypot(clientX - cx, clientY - cy)
    if (dist < rect.width * 0.14) return // ignore taps on Yubi himself
    const ang = Math.atan2(clientY - cy, clientX - cx)
    let rel = ang - Math.PI / 2
    rel = ((rel % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
    const slot = Math.round((rel / (Math.PI * 2)) * count) % count
    onPick((count - 1 - slot + count) % count)
  }

  const hasValue = value !== undefined && value >= 0
  const sel = hasValue ? (value as number) : 0
  const [tx, ty] = polar(angleFor(sel))
  const a0 = slotAngle(0)
  let delta = angleFor(sel) - a0
  if (delta < 0) delta += Math.PI * 2
  const [x0, y0] = polar(a0)
  const large = delta > Math.PI ? 1 : 0
  const arc = hasValue && delta > 0.001 ? `M ${x0} ${y0} A ${radius} ${radius} 0 ${large} 1 ${tx} ${ty}` : ''

  return (
    <svg
      className="q-dial"
      viewBox="0 0 100 100"
      ref={ref}
      onClick={(event) => pickFrom(event.clientX, event.clientY)}
    >
      <circle className="q-dial-track" cx="50" cy="50" r={radius} />
      {arc && <path className="q-dial-fill" d={arc} />}
      {hasValue && <circle className="q-dial-thumb" cx={tx} cy={ty} r="3.4" />}
    </svg>
  )
}function splitLeadingEmoji(value: string) {
  const match = value.match(/^([\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}])\s*/u)
  return match ? { emoji: match[1], label: value.slice(match[0].length) } : { emoji: '', label: value }
}

function cleanPartTitle(title: string) {
  return title.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim()
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function YubiFaceIcon() {
  return (
    <svg viewBox="0 0 36 36" width="32" height="32" fill="none" aria-hidden="true">
      <rect x="8" y="12" width="20" height="16" rx="4" fill="#7c5cff" />
      <rect x="12" y="16" width="4" height="4" rx="1.5" fill="#fff" />
      <rect x="20" y="16" width="4" height="4" rx="1.5" fill="#fff" />
      <rect x="15" y="22" width="6" height="2" rx="1" fill="#c4b5fd" />
      <rect x="14" y="6" width="8" height="6" rx="2" fill="#9f7afe" />
      <rect x="17" y="3" width="2" height="4" rx="1" fill="#c4b5fd" />
      <circle cx="18" cy="2" r="2" fill="#22d3ee" />
      <rect x="4" y="16" width="4" height="8" rx="2" fill="#9f7afe" />
      <rect x="28" y="16" width="4" height="8" rx="2" fill="#9f7afe" />
    </svg>
  )
}

function ChevronBackIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
}

function LockIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
}

function CheckIcon() {
  return <svg viewBox="0 0 80 80" width="72" height="72" aria-hidden="true"><circle cx="40" cy="40" r="36" fill="#F5F2FF" stroke="#6F5BFF" strokeWidth="2.5" /><path d="M24 40 L35 51 L56 30" fill="none" stroke="#6F5BFF" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg>
}