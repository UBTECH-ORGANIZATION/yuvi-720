/* The gap row's "למה?" made worth pressing (#507).
 *
 * It used to open the row's own counters said again — "8 מתוך 13 מתקשים",
 * which the row already says twice. Now it opens ONE paragraph: what is
 * actually hard for the class and what to focus on, phrased by the server
 * (`focus_text`) from folded evidence — the objective's per-learning success,
 * the failing questions' own `informationToBot` topic descriptions, the
 * coach's error-type reads. Grounded by construction: the model may only
 * reword that fold, and when phrasing is unavailable the same rows compose a
 * deterministic sentence here instead. Nothing else renders — no sections, no
 * raw dump; the counters live on the row itself (the sentence and the split
 * bar), which is where C4's disclosure always was.
 *
 * Fetched on first open, not with the page: the fold fans out over the
 * roster's events and decisions, and a teacher opens one gap at a time.
 */

import { useState } from 'react'
import { Icon } from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import type { GapDiagnosis } from '../../../services/teacher'
import type { DifficultyItem } from './DifficultiesCard'

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
            <p className="tch-why__none">{t('tch.why.none')}</p>
          ) : null}
          {state.kind === 'ready' ? (
            <DiagnosisBody diagnosis={state.diagnosis} />
          ) : null}
        </div>
      ) : null}
    </>
  )
}

/* ONE paragraph, by request (#507 follow-up): the guidance, nothing else —
 * no folded sections, no raw-data toggle. The folds still exist in the
 * payload as the phrasing's grounding, and the counters the raw layer used
 * to repeat are already on the row itself (the sentence and the split bar),
 * so the C4 disclosure lives where it always did. */
function DiagnosisBody({ diagnosis }: { diagnosis: GapDiagnosis }) {
  const { t } = useI18n()
  const guidance = diagnosis.focus_text || composedGuidance(diagnosis, t)

  return (
    <div className="tch-why__body">
      {guidance
        ? <p className="tch-why__text" dir="auto">{guidance}</p>
        : <p className="tch-why__none">{t('tch.why.none')}</p>}
    </div>
  )
}

/* The no-model fallback: deterministic clauses composed from the same folded
 * rows the phrasing would have reworded. */
function composedGuidance(
  diagnosis: GapDiagnosis,
  t: (key: string, params?: Record<string, string | number>) => string,
): string | null {
  const clauses: string[] = []
  const worst = diagnosis.parts[0]
  if (worst && diagnosis.parts.length > 1 && worst.title) {
    clauses.push(t('tch.why.rec.part', { part: worst.title }))
  }
  const question = diagnosis.hard_questions[0]
  if (question) {
    const topic = question.teaches && topicLine(question.teaches)
    if (topic) {
      clauses.push(t('tch.why.rec.topic', { topic }))
    } else if (question.ordinal !== null) {
      clauses.push(t('tch.why.rec.question', {
        ordinal: question.ordinal,
        learning: question.learning_title || question.screen_title,
      }))
    }
  }
  const error = diagnosis.error_types[0]
  if (error) clauses.push(t(`tch.why.rec.error.${error[0]}`))
  return clauses.length ? clauses.join(' ') : null
}
