/* Post-lesson personalized reflection (F4). Questions are generated server-side
   from the session's real evidence; every answer/skip is reported to the LRS by
   the backend. The panel never blocks progression — the learner can skip. */

import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import {
  answerReflection,
  completeReflection,
  skipReflection,
  startReflection,
  type ReflectionQuestion,
} from '../../services/agents'

interface ReflectionPanelProps {
  componentId: string | null
  sessionId: string | null
  onDone: () => void
}

type Phase = 'loading' | 'asking' | 'done' | 'hidden'

export function ReflectionPanel({ componentId, sessionId, onDone }: ReflectionPanelProps) {
  const { t, language } = useI18n()
  const [phase, setPhase] = useState<Phase>('loading')
  const [reflectionId, setReflectionId] = useState<string | null>(null)
  const [questions, setQuestions] = useState<ReflectionQuestion[]>([])
  const [index, setIndex] = useState(0)
  const [answerText, setAnswerText] = useState('')
  const [rating, setRating] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    startReflection(componentId, sessionId, language)
      .then((flow) => {
        if (flow.questions?.length) {
          setReflectionId(flow.reflection_id)
          setQuestions(flow.questions)
          setPhase('asking')
        } else {
          setPhase('hidden')
          onDone()
        }
      })
      .catch(() => {
        setPhase('hidden')
        onDone()
      })
  }, [componentId, language, onDone, sessionId])

  const question = questions[index] || null

  const advance = async () => {
    if (index + 1 < questions.length) {
      setIndex(index + 1)
      setAnswerText('')
      setRating(null)
      return
    }
    if (reflectionId) {
      try {
        await completeReflection(reflectionId)
      } catch {
        /* completion reporting must never block the learner */
      }
    }
    setPhase('done')
    onDone()
  }

  const submit = async () => {
    if (!reflectionId || !question || busy) return
    const payload = question.kind === 'rating'
      ? { rating: rating ?? undefined }
      : { answer: answerText.trim() || undefined }
    if (question.kind === 'rating' ? rating == null : !answerText.trim()) return
    setBusy(true)
    try {
      await answerReflection(reflectionId, question.number, payload)
    } catch {
      /* keep the flow moving even if one report fails */
    }
    setBusy(false)
    void advance()
  }

  const skip = async () => {
    if (busy) return
    if (reflectionId && question) {
      try {
        await skipReflection(reflectionId, question.number)
      } catch {
        /* ignore */
      }
    }
    void advance()
  }

  if (phase === 'hidden') return null
  if (phase === 'loading') {
    return (
      <div className="lesson-reflection" role="status">
        <span className="learning-player-spinner" aria-hidden="true" />
        <span>{t('learning.reflection.loading')}</span>
      </div>
    )
  }
  if (phase === 'done') {
    return (
      <div className="lesson-reflection lesson-reflection--done" role="status">
        <span>{t('learning.reflection.thanks')}</span>
      </div>
    )
  }
  if (!question) return null

  return (
    <div className="lesson-reflection" role="group" aria-label={t('learning.reflection.title')}>
      <div className="lesson-reflection__header">
        <strong>{t('learning.reflection.title')}</strong>
        <span className="lesson-reflection__step">
          {t('learning.reflection.step', { current: index + 1, total: questions.length })}
        </span>
      </div>
      <p className="lesson-reflection__question">{question.text}</p>
      {question.kind === 'rating' ? (
        <div className="lesson-reflection__rating" role="radiogroup" aria-label={question.text}>
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={rating === value}
              className={rating === value ? 'is-selected' : ''}
              onClick={() => setRating(value)}
            >
              {value}
            </button>
          ))}
        </div>
      ) : (
        <textarea
          className="lesson-reflection__input"
          value={answerText}
          maxLength={800}
          rows={2}
          placeholder={t('learning.reflection.placeholder')}
          onChange={(event) => setAnswerText(event.target.value)}
        />
      )}
      <div className="lesson-reflection__actions">
        <button type="button" className="lesson-reflection__skip" onClick={skip} disabled={busy}>
          {t('learning.reflection.skip')}
        </button>
        <button
          type="button"
          className="lesson-reflection__send"
          onClick={submit}
          disabled={busy || (question.kind === 'rating' ? rating == null : !answerText.trim())}
        >
          {index + 1 < questions.length ? t('learning.reflection.next') : t('learning.reflection.finish')}
        </button>
      </div>
    </div>
  )
}
