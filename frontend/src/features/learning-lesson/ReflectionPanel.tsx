/* Post-lesson personalized reflection (F4). Questions are generated server-side
   from the session's real evidence; every answer/skip is reported to the LRS by
   the backend. The panel never blocks progression — the learner can skip.

   All questions are shown AT ONCE rather than one at a time. As a wizard it
   made the learner press "next" three times through a column that was mostly
   empty, and each press hid what they had just said. Together they read as one
   short debrief, they can be answered in any order, and one action sends the
   lot — answered questions are reported as answers, the rest as skips, exactly
   as before. */

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
/** What the learner has put into one question so far. */
type Draft = { rating?: number; text?: string }

export function ReflectionPanel({ componentId, sessionId, onDone }: ReflectionPanelProps) {
  const { t, language } = useI18n()
  const [phase, setPhase] = useState<Phase>('loading')
  const [reflectionId, setReflectionId] = useState<string | null>(null)
  const [questions, setQuestions] = useState<ReflectionQuestion[]>([])
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
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

  const isAnswered = (question: ReflectionQuestion) => {
    const draft = drafts[question.number]
    return question.kind === 'rating'
      ? draft?.rating != null
      : Boolean(draft?.text?.trim())
  }
  const answeredCount = questions.filter(isAnswered).length

  /** Report every question — answered ones as answers, the rest as skips. */
  const send = async (skipAll = false) => {
    if (busy) return
    setBusy(true)
    for (const question of questions) {
      const draft = drafts[question.number]
      const answered = !skipAll && isAnswered(question)
      try {
        if (answered) {
          await answerReflection(reflectionId!, question.number, question.kind === 'rating'
            ? { rating: draft?.rating }
            : { answer: draft?.text?.trim() })
        } else {
          await skipReflection(reflectionId!, question.number)
        }
      } catch {
        /* keep the flow moving even if one report fails */
      }
    }
    if (reflectionId) {
      try {
        await completeReflection(reflectionId)
      } catch {
        /* completion reporting must never block the learner */
      }
    }
    setBusy(false)
    setPhase('done')
    onDone()
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
  if (!questions.length) return null

  return (
    <div className="lesson-reflection" role="group" aria-label={t('learning.reflection.title')}>
      <div className="lesson-reflection__header">
        <strong>{t('learning.reflection.title')}</strong>
        <span className="lesson-reflection__step">
          {t('learning.reflection.count', { total: questions.length })}
        </span>
      </div>

      <ol className="lesson-reflection__list">
        {questions.map((question, i) => (
          <li key={question.number} className={isAnswered(question) ? 'is-answered' : ''}>
            <p className="lesson-reflection__question">
              <span className="lesson-reflection__ordinal" aria-hidden>{i + 1}</span>
              {question.text}
            </p>
            {question.kind === 'rating' ? (
              <div className="lesson-reflection__rating" role="radiogroup" aria-label={question.text}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={drafts[question.number]?.rating === value}
                    className={drafts[question.number]?.rating === value ? 'is-selected' : ''}
                    onClick={() => setDrafts((d) => ({ ...d, [question.number]: { rating: value } }))}
                  >
                    {value}
                  </button>
                ))}
              </div>
            ) : (
              <textarea
                className="lesson-reflection__input"
                value={drafts[question.number]?.text || ''}
                maxLength={800}
                rows={2}
                aria-label={question.text}
                placeholder={t('learning.reflection.placeholder')}
                onChange={(event) =>
                  setDrafts((d) => ({ ...d, [question.number]: { text: event.target.value } }))}
              />
            )}
          </li>
        ))}
      </ol>

      <div className="lesson-reflection__actions">
        <button type="button" className="lesson-reflection__skip" onClick={() => send(true)} disabled={busy}>
          {t('learning.reflection.skip')}
        </button>
        <button
          type="button"
          className="lesson-reflection__send"
          onClick={() => send()}
          disabled={busy || answeredCount === 0}
        >
          {t('learning.reflection.finish')}
        </button>
      </div>
    </div>
  )
}
