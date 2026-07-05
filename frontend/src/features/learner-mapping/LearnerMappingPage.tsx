import { useEffect, useMemo, useRef, useState } from 'react'
import { AppBar } from '../../components/AppBar'
import { Stepper } from '../../components/Stepper'
import { navigate } from '../../app/router'
import { useI18n } from '../../i18n/I18nProvider'
import { apiGet, apiPost, streamPost } from '../../services/api'
import type { ChatMessage, QuestionLocation, Questionnaire, QuestionnaireOptionQuestion } from './types'

type Screen = 'chat' | 'question' | 'complete'
type ChatMode = 'intro' | 'section' | 'summary'
type Answers = Record<number, number>

const studentName = 'יובל כהן'

export function LearnerMappingPage() {
  const { language, isLoading, t } = useI18n()
  const [questionnaire, setQuestionnaire] = useState<Questionnaire | null>(null)
  const [screen, setScreen] = useState<Screen>('chat')
  const [chatMode, setChatMode] = useState<ChatMode>('intro')
  const [activeStep, setActiveStep] = useState(0)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [isTyping, setIsTyping] = useState(true)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Answers>({})
  const [lastSectionContext, setLastSectionContext] = useState('')
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [freeText, setFreeText] = useState('')
  const [isSendingFreeText, setIsSendingFreeText] = useState(false)
  const [isLastSection, setIsLastSection] = useState(false)
  const chatBodyRef = useRef<HTMLDivElement | null>(null)

  const introMessages = useMemo(
    () => [1, 2, 3, 4, 5, 6].map((index) => t(`intro.${index}`, { studentName })),
    [t]
  )
  const sectionMessages = useMemo(
    () => [0, 1, 2, 3, 4, 5].map((index) => t(`section.${index}`)),
    [t]
  )

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
      })
      .catch(() => setQuestionnaire(null))
  }, [language, isLoading])

  useEffect(() => {
    if (!questionnaire || isLoading) return
    void playChatSequence(introMessages, 'intro')
  }, [questionnaire, introMessages, isLoading])

  useEffect(() => {
    chatBodyRef.current?.scrollTo({ top: chatBodyRef.current.scrollHeight, behavior: 'smooth' })
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
    setChatMode(mode)
    setChatMessages([])
    setIsTyping(true)

    for (const message of messages) {
      setIsTyping(true)
      await wait(Math.min(600 + message.length * 15, 1500))
      setChatMessages((previous) => [...previous, { role: 'assistant', content: message }])
      await wait(250)
    }

    setIsTyping(false)
  }

  function startQuestions() {
    setScreen('question')
    setActiveStep(1)
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

  function selectOption(questionId: number, optionIndex: number) {
    setAnswers((previous) => ({ ...previous, [questionId]: optionIndex }))
    window.setTimeout(() => {
      const nextQuestion = flattened.questions[currentIndex]
      if (!nextQuestion) return
      const nextAnswers = { ...answers, [questionId]: optionIndex }
      const currentPart = flattened.locations[currentIndex].partIndex
      const nextIndex = currentIndex + 1

      if (nextIndex >= totalQuestions) {
        void showSectionSummary(currentPart, true, nextAnswers)
        return
      }

      const nextPart = flattened.locations[nextIndex].partIndex
      setCurrentIndex(nextIndex)
      if (nextPart !== currentPart) {
        void showSectionSummary(currentPart, false, nextAnswers)
      }
    }, 350)
  }

  async function showSectionSummary(partIndex: number, last: boolean, nextAnswers: Answers = answers) {
    const part = questionnaire?.parts[partIndex]
    if (!part) return

    setScreen('chat')
    setChatMode('summary')
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
      await apiPost('/api/submit', {
        student_name: studentName,
        answers
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
        answers: filled
      })
    } catch {
      // Results page will show a no-data state if persistence fails.
    }
    navigate('/results')
  }

  const progressPercent = totalQuestions ? Math.round(((currentIndex + 1) / totalQuestions) * 100) : 0
  const currentPartNumber = currentLocation ? currentLocation.partIndex + 1 : 1
  const totalParts = questionnaire?.parts.length || 1
  const partTitle = cleanPartTitle(currentLocation?.partTitle || '')

  return (
    <>
      <AppBar studentName={studentName} studentSubtitle={t('app.studentSubtitle')} />
      <Stepper activeStep={activeStep} />
      <main className="stage" id="mainContent">
        {screen === 'chat' && (
          <section className="screen active">
            <div className="intro-grid">
              <div className="chat-side">
                <YubiMark />
                <div className="chat-presence">
                  <span className="presence-dot" />
                  <span className="presence-text">{isTyping ? t('chat.status.typing') : t('chat.status.online')}</span>
                </div>
                <div className="chat-body" ref={chatBodyRef}>
                  {chatMessages.map((message, index) => (
                    <ChatRow key={`${message.role}-${index}`} message={message} />
                  ))}
                  {isTyping && <TypingRow />}
                </div>
                <div className="chat-footer">
                  {chatMode === 'summary' ? (
                    <div className="summary-footer">
                      <div className="free-text-row">
                        <input
                          className="free-text-input"
                          dir="auto"
                          value={freeText}
                          disabled={isSendingFreeText}
                          placeholder={t('chat.freeText.placeholder')}
                          onChange={(event) => setFreeText(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void sendFreeText()
                          }}
                        />
                        <button className="send-btn" disabled={isSendingFreeText} onClick={() => void sendFreeText()}>
                          <SendIcon />
                        </button>
                      </div>
                      <button className="chat-action-btn" onClick={continueAfterSummary}>
                        <span>{isLastSection ? t('chat.action.showResults') : t('chat.action.nextSection')}</span>
                        <ChevronBackIcon />
                      </button>
                    </div>
                  ) : (
                    <div className="intro-actions">
                      <button className="chat-action-btn" onClick={startQuestions} disabled={isTyping || !questionnaire}>
                        <span>{t('chat.action.start')}</span>
                        <ChevronBackIcon />
                      </button>
                      <button className="chat-skip-btn" onClick={() => void skipWithDefaults()} disabled={!questionnaire}>
                        {t('chat.action.skip')}
                      </button>
                    </div>
                  )}
                </div>
                <div className="trust-line">
                  <LockIcon />
                  <span>{t('chat.trust')}</span>
                </div>
              </div>
              <RobotPanel label={t('robot.aria')} />
            </div>
          </section>
        )}

        {screen === 'question' && currentQuestion && (
          <section className="screen active">
            <div className="q-shell">
              <div className="progress-section visible">
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
                </div>
                <div className="progress-info">
                  <span className="progress-label">
                    {t('question.progress', {
                      part: currentPartNumber,
                      totalParts,
                      question: currentIndex + 1,
                      totalQuestions
                    })}
                  </span>
                  <span className="progress-counter">{progressPercent}%</span>
                </div>
              </div>
              <div className="question-wrapper">
                <div className="question-part-badge">{partTitle}</div>
                <div className="single-question-card question-enter-left">
                  <span className="q-buddy" aria-hidden="true"><YubiFaceIcon /></span>
                  <div className="question-number-display">{currentIndex + 1}</div>
                  <h2 className="question-text-display">{currentQuestion.text}</h2>
                  <div className="options-grid">
                    {currentQuestion.options.map((option, optionIndex) => {
                      const split = splitLeadingEmoji(option)
                      const selected = answers[currentQuestion.id] === optionIndex
                      return (
                        <button
                          className={`option-btn ${selected ? 'selected' : ''}`}
                          key={`${currentQuestion.id}-${optionIndex}`}
                          onClick={() => selectOption(currentQuestion.id, optionIndex)}
                        >
                          <span className="option-emoji">{split.emoji}</span>
                          <span className="option-label">{split.label}</span>
                          <span className="option-check">✔</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
                <button className={`nav-arrow nav-arrow-right ${currentIndex === 0 ? 'disabled' : ''}`} onClick={navigatePrev} title={t('question.prev')}>
                  <ChevronForwardIcon />
                </button>
                <button className="nav-arrow nav-arrow-left" onClick={navigateNext} title={t('question.next')}>
                  <ChevronBackIcon />
                </button>
              </div>
              <p className="q-microcopy">{t('question.microcopy')}</p>
            </div>
          </section>
        )}

        {screen === 'complete' && (
          <section className="screen active">
            <div className="complete-card">
              <span className="complete-confetti c1">✦</span>
              <span className="complete-confetti c2">✧</span>
              <span className="complete-confetti c3">✦</span>
              <div className="complete-icon-svg"><CheckIcon /></div>
              <h2 className="complete-title">{t('complete.title', { studentName })}</h2>
              <p className="complete-subtitle">{t('complete.subtitle')}</p>
              <button className="chat-action-btn complete-cta" onClick={() => navigate('/results')}>
                {t('complete.cta')}
              </button>
            </div>
          </section>
        )}
      </main>
    </>
  )
}

function ChatRow({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return <div className="chat-row user"><div className="chat-bubble user">{message.content}</div></div>
  }
  return (
    <div className="chat-row bot">
      <BotAvatar />
      <div className="chat-bubble bot">{message.content}</div>
    </div>
  )
}

function TypingRow() {
  return (
    <div className="chat-row bot typing-row">
      <BotAvatar />
      <div className="chat-bubble typing">
        <div className="typing-dot" />
        <div className="typing-dot" />
        <div className="typing-dot" />
      </div>
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
      <span className="yubi-spark spark-a">✦</span>
      <span className="yubi-spark spark-b">✦</span>
      <svg className="yubi-swoosh" viewBox="0 0 120 14" preserveAspectRatio="none" aria-hidden="true">
        <path d="M4 9 Q40 2 116 7" stroke="url(#sw)" strokeWidth="4" fill="none" strokeLinecap="round" />
        <defs><linearGradient id="sw" x1="0" x2="1"><stop offset="0" stopColor="#6F5BFF" /><stop offset="1" stopColor="#4CC9F0" /></linearGradient></defs>
      </svg>
    </div>
  )
}

function RobotPanel({ label }: { label: string }) {
  return (
    <div className="robot-side">
      <div className="robot-glow" />
      <span className="float-shape shape-1" />
      <span className="float-shape shape-2" />
      <span className="float-shape shape-3" />
      <span className="float-star star-1">✦</span>
      <span className="float-star star-2">✦</span>
      <span className="float-star star-3">✧</span>
      <div className="robot-3d react-robot" aria-label={label}>
        <div className="robot-head">
          <span className="robot-eye" />
          <span className="robot-eye" />
          <span className="robot-smile" />
        </div>
        <div className="robot-body" />
      </div>
    </div>
  )
}

function splitLeadingEmoji(value: string) {
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

function ChevronForwardIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
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