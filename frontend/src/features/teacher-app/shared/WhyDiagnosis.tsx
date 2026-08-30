/* The gap row's "למה?" made worth pressing (#507).
 *
 * It used to open the row's own counters said again — "8 מתוך 13 מתקשים",
 * which the row already says twice. Now it answers the actual question, in
 * three reads folded from stored evidence (never generated):
 *   - WHERE inside the objective: its learnings, hardest first, with success;
 *   - WHICH questions fail, named the way the learner sees them on screen;
 *   - HOW it goes wrong: the coach's own deterministic error-type reads.
 * A closing recommendation is composed HERE from those same rows — grounded
 * by construction, because every clause names data the panel just showed.
 *
 * Fetched on first open, not with the page: the fold fans out over the
 * roster's events and decisions, and a teacher opens one gap at a time. The
 * raw evidence stays at the bottom — the diagnosis interprets, C4 discloses.
 */

import { useState } from 'react'
import { Icon } from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import type { GapDiagnosis } from '../../../services/teacher'
import type { DifficultyItem } from './DifficultiesCard'
import { RawEvidence } from './EvidenceDisclosure'

function pct(rate: number | null): number | null {
  return rate === null ? null : Math.round(rate * 100)
}

/* `informationToBot` is the author's full brief — understanding goals, answer
   values, strategy tips. The topic is its opening; the rest belongs to the
   phrased focus below, not to a headline. */
function topicLine(teaches: string): string {
  const window = teaches.slice(0, 140)
  const stop = window.indexOf('.')
  const head = stop > 30 ? window.slice(0, stop) : window
  return head.length < teaches.length ? `${head.trimEnd()}…` : head
}

export function DiagnosisToggle({ item, load }: {
  item: DifficultyItem
  load: (item: DifficultyItem) => Promise<GapDiagnosis | null>
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [state, setState] =
    useState<{ kind: 'idle' | 'loading' | 'failed' } | { kind: 'ready'; diagnosis: GapDiagnosis }>(
      { kind: 'idle' })

  const toggle = () => {
    setOpen((value) => !value)
    if (state.kind !== 'idle') return
    setState({ kind: 'loading' })
    load(item)
      .then((diagnosis) => setState(
        diagnosis ? { kind: 'ready', diagnosis } : { kind: 'failed' }))
      .catch(() => setState({ kind: 'failed' }))
  }

  return (
    <>
      <button
        type="button"
        className="tch-evidence__toggle"
        aria-expanded={open}
        onClick={toggle}
      >
        <Icon name={open ? 'chevronUp' : 'chevronLeft'} size={14} aria-hidden="true" />
        {t('tch.evidence.why')}
      </button>
      {open ? (
        <div className="tch-why">
          {state.kind === 'loading' ? (
            <p className="tch-why__loading">{t('tch.why.loading')}</p>
          ) : null}
          {state.kind === 'failed' ? (
            /* The fold failed — the raw layer below still answers C4. */
            <RawEvidence raw={item.evidence} />
          ) : null}
          {state.kind === 'ready' ? (
            <DiagnosisBody diagnosis={state.diagnosis} raw={item.evidence} />
          ) : null}
        </div>
      ) : null}
    </>
  )
}

function DiagnosisBody({ diagnosis, raw }: {
  diagnosis: GapDiagnosis
  raw: Record<string, unknown>
}) {
  const { t } = useI18n()
  const parts = diagnosis.parts
  const questions = diagnosis.hard_questions
  const errors = diagnosis.error_types
  const empty = !parts.length && !questions.length && !errors.length

  return (
    <div className="tch-why__body">
      {empty ? <p className="tch-why__none">{t('tch.why.none')}</p> : null}

      {parts.length > 0 && (
        <section className="tch-why__block">
          <h5>{t('tch.why.parts.title')}</h5>
          <ul className="tch-why__parts">
            {parts.map((part) => {
              const rate = pct(part.success_rate)
              return (
                <li key={part.component_id}>
                  <span className="tch-why__partName" dir="auto">{part.title || part.component_id}</span>
                  {rate !== null ? (
                    <span className="tch-why__meter" aria-hidden="true">
                      <span style={{ inlineSize: `${rate}%` }} />
                    </span>
                  ) : null}
                  <span className="tch-why__partLine">
                    {rate !== null ? t('tch.why.parts.line', {
                      pct: rate, struggling: part.struggling_count,
                    }) : null}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {questions.length > 0 && (
        <section className="tch-why__block">
          <h5>{t('tch.why.questions.title')}</h5>
          <ul className="tch-why__questions">
            {questions.map((question) => (
              /* Topic first (the content's own description of what the
                 question teaches), mechanics second — a teacher plans a
                 lesson around "מושגי ברוטו ונטו", not around "שאלה 2". */
              <li key={`${question.component_id}:${question.question_id}`} dir="auto">
                <strong>
                  {(question.teaches && topicLine(question.teaches))
                    || (question.ordinal !== null
                      ? t('tch.why.questionName', { ordinal: question.ordinal })
                      : question.screen_title || question.learning_title)}
                </strong>
                <span className="tch-why__qMeta">
                  {question.teaches && question.ordinal !== null
                    ? `${t('tch.why.questionName', { ordinal: question.ordinal })} · `
                    : ''}
                  {t('tch.why.questions.line', {
                    pct: pct(question.success_rate) ?? 0,
                    attempts: question.attempts,
                    learners: question.learners,
                  })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {errors.length > 0 && (
        <section className="tch-why__block">
          <h5>{t('tch.why.errors.title')}</h5>
          <div className="tch-why__errors">
            {errors.map(([kind, count]) => (
              <span key={kind} className="tch-why__error">
                {t(`tch.why.error.${kind}`)}
                {count > 1 ? <span className="tch-why__errorCount">×{count}</span> : null}
              </span>
            ))}
          </div>
        </section>
      )}

      <Recommendation diagnosis={diagnosis} />

      <RawEvidence raw={raw} />
    </div>
  )
}

/* What to focus on. The server's `focus_text` leads when present — Yuvi's own
 * phrasing of the topics above, grounded because it may only reword the folded
 * rows. Without it, deterministic clauses composed from the same rows. */
function Recommendation({ diagnosis }: { diagnosis: GapDiagnosis }) {
  const { t } = useI18n()
  if (diagnosis.focus_text) {
    return (
      <section className="tch-why__block tch-why__rec">
        <h5>{t('tch.why.rec.title')}</h5>
        <p dir="auto">{diagnosis.focus_text}</p>
      </section>
    )
  }
  const clauses: string[] = []
  const worst = diagnosis.parts[0]
  if (worst && diagnosis.parts.length > 1 && worst.title) {
    clauses.push(t('tch.why.rec.part', { part: worst.title }))
  }
  const question = diagnosis.hard_questions[0]
  if (question && question.ordinal !== null) {
    clauses.push(t('tch.why.rec.question', {
      ordinal: question.ordinal,
      learning: question.learning_title || question.screen_title,
    }))
  }
  const error = diagnosis.error_types[0]
  if (error) clauses.push(t(`tch.why.rec.error.${error[0]}`))
  if (!clauses.length) return null

  return (
    <section className="tch-why__block tch-why__rec">
      <h5>{t('tch.why.rec.title')}</h5>
      <p dir="auto">{clauses.join(' ')}</p>
    </section>
  )
}
