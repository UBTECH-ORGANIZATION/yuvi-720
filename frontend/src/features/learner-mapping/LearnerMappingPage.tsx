import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { AppBar } from '../../components/AppBar'
import { navigate } from '../../app/router'
import { useI18n } from '../../i18n/I18nProvider'
import { useResponsive } from '../../hooks/useResponsive'
import { apiGet, apiPost, streamPost } from '../../services/api'
import type { ChatMessage, QuestionLocation, Questionnaire, QuestionnaireOptionQuestion } from './types'
import { YubiRobot3D, YUBI_INTRO_READY_DELAY_MS } from './YubiRobot3D'

type Screen = 'chat' | 'question' | 'complete'
type ChatMode = 'intro' | 'section' | 'summary'
type Answers = Record<number, number>

const studentName = 'יובל כהן'
const QUESTION_HANDOFF_CLEAR_MS = 600
const QUESTION_HANDOFF_MOVE_MS = 1180
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
  const { isPhone } = useResponsive()
  const [questionnaire, setQuestionnaire] = useState<Questionnaire | null>(null)
  const [screen, setScreen] = useState<Screen>('chat')
  const [chatMode, setChatMode] = useState<ChatMode>('intro')
  const [activeStep, setActiveStep] = useState(0)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [isTyping, setIsTyping] = useState(true)
  const [isSpeakingText, setIsSpeakingText] = useState(false)
  const [introHandoff, setIntroHandoff] = useState(false)
  const [questionEntryTransition, setQuestionEntryTransition] = useState(false)
  const [transitionYubi, setTransitionYubi] = useState<{ style: CSSProperties } | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Answers>({})
  const [lastSectionContext, setLastSectionContext] = useState('')
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [freeText, setFreeText] = useState('')
  const [isSendingFreeText, setIsSendingFreeText] = useState(false)
  const [isLastSection, setIsLastSection] = useState(false)
  const chatBodyRef = useRef<HTMLDivElement | null>(null)
  const chatSequenceRunRef = useRef(0)
  const transitionRunRef = useRef(0)

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

  useEffect(() => {
    if (isLoading) return
    apiGet<Questionnaire>(`/api/questionnaire?lang=${encodeURIComponent(language)}`)
      .then((nextQuestionnaire) => {
        setQuestionnaire(nextQuestionnaire)
        setScreen('chat')
        setChatMode('intro')
        setActiveStep(0)
        setCurrentIndex(0)
        setAnswers({})
        setIntroHandoff(false)
        setQuestionEntryTransition(false)
        setTransitionYubi(null)
        transitionRunRef.current += 1
      })
      .catch(() => setQuestionnaire(null))
  }, [language, isLoading])

  useEffect(() => {
    if (!questionnaire || isLoading) return
    const messages = [1, 2, 3, 4, 5, 6].map((index) => t(`intro.${index}`, { studentName }))
    void playChatSequence(messages, 'intro')
    return () => {
      chatSequenceRunRef.current += 1
    }
  }, [questionnaire, language, isLoading])

  useEffect(() => {
    chatBodyRef.current?.scrollTo({ top: chatBodyRef.current.scrollHeight })
  }, [chatMessages, isTyping])

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

  async function startQuestions() {
    if (!questionnaire || introHandoff) return
    chatSequenceRunRef.current += 1
    const runId = transitionRunRef.current + 1
    transitionRunRef.current = runId
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

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
    if (currentIndex === 0) return
    setCurrentIndex((index) => index - 1)
  }

  function navigateNext() {
    if (!currentQuestion || answers[currentQuestion.id] === undefined) return

    const currentPart = currentLocation.partIndex
    const nextIndex = currentIndex + 1

    if (nextIndex >= totalQuestions) {
      void showSectionSummary(currentPart, true)
      return
    }

    const nextPart = flattened.locations[nextIndex].partIndex
    setCurrentIndex(nextIndex)
    if (nextPart !== currentPart) {
      void showSectionSummary(currentPart, false)
    }
  }

  function chooseOption(questionId: number, optionIndex: number) {
    // Record the choice only — advancing is explicit via the approve button.
    setAnswers((previous) => ({ ...previous, [questionId]: optionIndex }))
  }

  async function showSectionSummary(partIndex: number, last: boolean, nextAnswers: Answers = answers) {
    const part = questionnaire?.parts[partIndex]
    if (!part) return

    setScreen('chat')
    setChatMode('summary')
    chatSequenceRunRef.current += 1
    setIsLastSection(last)
    setActiveStep(2)
    setChatMessages([])
    setIsTyping(true)

    const questionsAndAnswers = part.questions.map((question) => {
      const answerIndex = nextAnswers[question.id]
      return {
        question: question.text,
        answer: answerIndex === undefined ? '' : question.options[answerIndex] || ''
      }
    })

    setLastSectionContext(
      `${part.title} - ${questionsAndAnswers.map((pair) => `${pair.question}: ${pair.answer}`).join(' | ')}`
    )

    let summary = ''
    try {
      setIsTyping(false)
      setChatMessages([{ role: 'assistant', content: '' }])
      await streamPost(
        '/api/section-summary-stream',
        { part_title: part.title, questions_and_answers: questionsAndAnswers, student_name: studentName, language },
        (chunk) => {
          summary += chunk
          setChatMessages([{ role: 'assistant', content: summary }])
        }
      )
    } catch {
      summary = t('fallback.summary')
      setChatMessages([{ role: 'assistant', content: summary }])
    }

    setChatHistory((previous) => [...previous, { role: 'assistant', content: summary }])
  }

  function continueAfterSummary() {
    if (isLastSection) {
      void submitQuestionnaire()
      return
    }
    setScreen('question')
    setActiveStep(1)
  }

  async function sendFreeText() {
    const message = freeText.trim()
    if (!message) return

    setFreeText('')
    setIsSendingFreeText(true)
    setChatMessages((previous) => [...previous, { role: 'user', content: message }])
    const nextHistory: ChatMessage[] = [...chatHistory, { role: 'user', content: message }]
    setChatHistory(nextHistory)

    let reply = ''
    try {
      setChatMessages((previous) => [...previous, { role: 'assistant', content: '' }])
      await streamPost(
        '/api/mapping-chat-stream',
        { message, student_name: studentName, context: lastSectionContext, history: nextHistory, language },
        (chunk) => {
          reply += chunk
          setChatMessages((previous) => {
            const copy = [...previous]
            copy[copy.length - 1] = { role: 'assistant', content: reply }
            return copy
          })
        }
      )
    } catch {
      reply = t('fallback.chat')
      setChatMessages((previous) => [...previous, { role: 'assistant', content: reply }])
    } finally {
      setChatHistory((previous) => [...previous, { role: 'assistant', content: reply }])
      setIsSendingFreeText(false)
    }
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
    navigate('/results')
  }

  const progressPercent = totalQuestions ? Math.round(((currentIndex + 1) / totalQuestions) * 100) : 0
  const partTitle = cleanPartTitle(currentLocation?.partTitle || '')

  return (
    <>
      <AppBar studentName={studentName} studentSubtitle={t('app.studentSubtitle')} activeStep={activeStep} />
      <main className="stage" id="mainContent">
        {screen === 'chat' && (
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
                onStart={() => void startQuestions()}
                onSkip={() => void skipWithDefaults()}
              />
            ) : (
              <div className="intro-scene summary-scene">
                <div className="chat-side">
                  <YubiMark />
                  <div className="chat-presence">
                    <span className="presence-dot" />
                    <span className="presence-text">{isTyping ? t('chat.status.typing') : t('chat.status.online')}</span>
                  </div>
                  <div className="chat-body" ref={chatBodyRef}>
                    {chatMessages.map((message, index) => (
                      <ChatRow
                        key={`${message.role}-${index}`}
                        message={message}
                        showAvatar={message.role !== 'assistant' || chatMessages[index - 1]?.role !== 'assistant'}
                      />
                    ))}
                  </div>
                  <div className="chat-footer">
                    <div className="summary-footer">
                      <div className="free-text-row">
                        <input
                          className="sp-input sp-input--pill"
                          dir="auto"
                          value={freeText}
                          disabled={isSendingFreeText}
                          placeholder={t('chat.freeText.placeholder')}
                          onChange={(event) => setFreeText(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void sendFreeText()
                          }}
                        />
                        <button className="sp-btn sp-btn--gradient sp-btn--icon" disabled={isSendingFreeText} onClick={() => void sendFreeText()}>
                          <SendIcon />
                        </button>
                      </div>
                      <button className="sp-btn sp-btn--gradient sp-btn--pill" onClick={continueAfterSummary}>
                        <span>{isLastSection ? t('chat.action.showResults') : t('chat.action.nextSection')}</span>
                        <ChevronBackIcon />
                      </button>
                    </div>
                  </div>
                  <div className="trust-line">
                    <LockIcon />
                    <span>{t('chat.trust')}</span>
                  </div>
                </div>
                <YubiFloater label={t('robot.aria')} lightweight={isPhone} speaking={isTyping} />
              </div>
            )}
          </section>
        )}

        {screen === 'question' && currentQuestion && (
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
              canBack={currentIndex > 0}
              robotLabel={t('robot.aria')}
              approveLabel={t('question.confirm')}
              backLabel={t('question.prev')}
              microcopy={t('question.microcopy')}
              entryTransition={questionEntryTransition && currentIndex === 0}
              entryDelayMs={currentIndex === 0 ? QUESTION_HANDOFF_QUESTION_DELAY_MS : 0}
            />
          </section>
        )}

        {screen === 'complete' && (
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
    </>
  )
}

function ChatRow({ message, showAvatar = true }: { message: ChatMessage; showAvatar?: boolean }) {
  if (message.role === 'user') {
    return <div className="chat-row user"><div className="chat-bubble user">{message.content}</div></div>
  }
  return (
    <div className={`chat-row bot${showAvatar ? '' : ' grouped'}`}>
      {showAvatar ? <BotAvatar /> : <span className="bot-avatar-spacer" aria-hidden="true" />}
      <div className="chat-bubble bot">{message.content}</div>
    </div>
  )
}

function BotAvatar() {
  return <div className="bot-avatar"><YubiFaceIcon /></div>
}

function YubiMark() {
  return (
    <div className="yubi-mark">
      <span className="yubi-word">יובי</span>
      <svg className="yubi-swoosh" viewBox="0 0 120 14" preserveAspectRatio="none" aria-hidden="true">
        <path d="M4 9 Q40 2 116 7" stroke="url(#sw)" strokeWidth="4" fill="none" strokeLinecap="round" />
        <defs><linearGradient id="sw" x1="0" x2="1"><stop offset="0" stopColor="#6F5BFF" /><stop offset="1" stopColor="#4CC9F0" /></linearGradient></defs>
      </svg>
    </div>
  )
}

function YubiFloater({
  label,
  lightweight,
  speaking,
  followPointer = Boolean(speaking),
}: {
  label: string
  lightweight?: boolean
  speaking?: boolean
  followPointer?: boolean
}) {
  // Card-less, free-floating companion: a transparent canvas that drifts over
  // the scene (CSS) while the robot idles/talks inside (WebGL). On phones we
  // skip mounting Three.js and show a light SVG mark instead — no WebGL cost.
  return (
    <div className={`yubi-floater${speaking ? ' is-speaking' : ''}`}>
      {lightweight ? (
        <div className="robot-lite" role="img" aria-label={label}><YubiFaceIcon /></div>
      ) : (
        <YubiRobot3D label={label} speaking={speaking} followPointer={followPointer} presenting />
      )}
    </div>
  )
}

function IntroNarrative({
  messages, isTyping, startLabel, skipLabel, trustLabel, robotLabel, lightweight,
  isSpeakingText, canStart, isHandoff, onStart, onSkip,
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
}) {
  const activeIndex = Math.max(0, messages.length - 1)
  const showActions = !isTyping && messages.length > 0

  return (
    <div className={`intro-stage${isTyping ? ' is-narrating' : ' is-ready'}${isHandoff ? ' is-handoff' : ''}`}>
      <div className="intro-robot-zone" aria-hidden="true">
        <div className="intro-stage-orbit" />
        <YubiFloater label={robotLabel} lightweight={lightweight} speaking={isSpeakingText} followPointer={showActions && !isHandoff} />
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
  robotLabel, approveLabel, backLabel, microcopy, entryTransition, entryDelayMs,
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
            <YubiRobot3D label={robotLabel} pointAt={pointAt} speaking={isQuestionTyping} followPointer={!entryTransition} />
          </div>
          {question.options.map((option, index) => {
            const a = angleFor(index)
            const x = 50 + 47 * Math.cos(a)
            const y = 50 + 47 * Math.sin(a)
            const chosen = selected === index
            const label = splitLeadingEmoji(option).label
            return (
              <button
                key={index}
                type="button"
                role="radio"
                aria-checked={chosen}
                className={`q-node${chosen ? ' chosen' : ''}${label.length > 16 ? ' q-node--wide' : ''}`}
                style={{ left: `${x}%`, top: `${y}%` }}
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

// Circular selector drawn around the ring: drag anywhere on the dial (or over
// Yubi) to sweep the handle around, and the nearest option is chosen; the arc
// fills up to the current pick. Options remain directly clickable too.
function CircularDial({ count, value, radius, onPick }: { count: number; value?: number; radius: number; onPick: (index: number) => void }) {
  const ref = useRef<SVGSVGElement | null>(null)
  const dragging = useRef(false)
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
      onPointerDown={(event) => { dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); pickFrom(event.clientX, event.clientY) }}
      onPointerMove={(event) => { if (dragging.current) pickFrom(event.clientX, event.clientY) }}
      onPointerUp={(event) => { dragging.current = false; event.currentTarget.releasePointerCapture(event.pointerId) }}
      onPointerCancel={() => { dragging.current = false }}
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

function SendIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
}

function LockIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
}

function CheckIcon() {
  return <svg viewBox="0 0 80 80" width="72" height="72" aria-hidden="true"><circle cx="40" cy="40" r="36" fill="#F5F2FF" stroke="#6F5BFF" strokeWidth="2.5" /><path d="M24 40 L35 51 L56 30" fill="none" stroke="#6F5BFF" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg>
}