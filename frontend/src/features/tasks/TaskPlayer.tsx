/* The player: one task, its components in order, and the answers in between.
 *
 * Native React over a validated JSON spec. Nothing the model wrote executes —
 * it describes, and this renders. That is the decision that removed generated
 * HTML5 games from the plan, and it is also why there is no
 * `dangerouslySetInnerHTML` anywhere under `features/tasks`.
 *
 * ## Two things it is careful about
 *
 * **Autosave, debounced, and never after submission.** A child who closes the
 * tab twenty minutes in must not lose twenty minutes. But a save that fires on
 * every keystroke of an open answer is a request per character, so writes are
 * debounced and skipped when nothing changed.
 *
 * **The submit button is honest about what is unanswered.** Not disabled —
 * a child is allowed to hand in an incomplete paper, and a disabled button
 * with no explanation is the worst version of that. It says how many are
 * blank, and asks once.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { QuestionCard } from './QuestionCard'
import { SlideDeck, StudyBlock } from './SlideDeck'
import type {
  LearnerQuestion, Slide, SubmitResult, TaskComponent, TaskContent,
} from '../../services/tasks'
import './tasks.css'

const SAVE_DEBOUNCE_MS = 1500

/** Presentation, practice, test. Three, not four.
 *
 *  "Activity" was a fourth tab whose scored blocks were practice questions with
 *  a widget name on them — `normalize_block` builds one by calling
 *  `normalize_question` — so a teacher was being asked to choose between two
 *  words for the same thing. Its study cards moved into practice, and its
 *  content still renders there for every task built before the merge. */
const ORDER: TaskComponent[] = ['presentation', 'practice', 'test']

interface Props {
  content: TaskContent
  initialAnswers?: Record<string, unknown>
  readOnly?: boolean
  onSave?: (answers: Record<string, unknown>, timeSpent: number) => Promise<unknown> | void
  onSubmit?: (answers: Record<string, unknown>, timeSpent: number) => Promise<SubmitResult | void>
  /** Set once submitted — switches every control to read-only with verdicts. */
  result?: SubmitResult | null
  /** The teacher trying their own task, from the review screen.
   *
   *  Everything answers and everything marks, and **nothing is written**: no
   *  autosave, no submit, no attempt row, no activity. A demo that persisted
   *  would put a teacher's answers in the place a child's belong.
   *
   *  Marking is done here from the key rather than by the server, which is
   *  honest about what this is — a rehearsal, not a submission — and is only
   *  possible because the teacher's copy of the content carries the key. The
   *  learner's copy does not, so this mode is inert in the learner lane by
   *  construction rather than by permission. */
  demo?: boolean
  /** The subject the task was built for. Chooses the deck's ground; comes from
   *  the task spec, so it is the teacher's answer and never the model's. */
  subject?: string
  /** The teacher's ground override, from `spec.presentation.theme`. */
  theme?: string
  /** The teacher's own copy: speaker notes, present and print. A learner never
   *  passes this, so `notes` cannot render in the child's lane even if a
   *  slide somehow arrived carrying one. */
  teacher?: boolean
  /** Per-slide controls for the review screen, rendered under the deck. */
  slideActions?: (index: number, slide: Slide) => React.ReactNode
}

/** The key, as it reaches the teacher's copy of a question. */
type DemoKey = {
  index?: number
  value?: boolean
  indices?: number[]
  order?: number[]
  pairs?: [number, number][]
  blanks?: { accept?: string[] }[]
}

/** Mark one answer against its key. `null` when this type is not markable
 *  without a model (an open answer), which the card renders as "no verdict"
 *  rather than as wrong. */
function markLocally(question: LearnerQuestion, given: unknown): boolean | null {
  const key = (question as { answer?: DemoKey }).answer
  if (!key) return null
  const same = (a: unknown[], b: unknown[]) =>
    a.length === b.length && a.every((value, index) => value === b[index])

  switch (question.type) {
    case 'mcq':
    case 'image_mcq':
      return given === key.index
    case 'true_false':
      return given === key.value
    case 'multiple_correct':
      return Array.isArray(given) &&
        same([...(given as number[])].sort(), [...(key.indices ?? [])].sort())
    case 'ordering':
      return Array.isArray(given) && same(given as number[], key.order ?? [])
    case 'matching':
      return Array.isArray(given) &&
        same((given as [number, number][]).map(String).sort(),
             (key.pairs ?? []).map(String).sort())
    case 'fill_blank': {
      const blanks = key.blanks ?? []
      const answers = Array.isArray(given) ? (given as string[]) : []
      if (!blanks.length) return null
      return blanks.every((blank, index) => (blank.accept ?? []).some((accepted) =>
        String(accepted).trim().toLowerCase() ===
        String(answers[index] ?? '').trim().toLowerCase()))
    }
    default:
      // An open answer is graded by a model against a rubric. Guessing here
      // would tell a teacher their own task marks wrongly.
      return null
  }
}

function questionsIn(content: TaskContent, component: TaskComponent): LearnerQuestion[] {
  if (component === 'test') return content.test?.questions ?? []
  if (component !== 'practice') return []
  return [
    ...(content.practice?.questions ?? []),
    // Study cards: not scored, and rehearsal reads better after the questions
    // than before them.
    ...(content.practice?.study ?? []),
    // Everything a pre-merge task stored under its own part. Rendered here so
    // an existing task keeps every block it was built with.
    ...(content.interactive?.blocks ?? []),
  ]
}

export function TaskPlayer({
  content, initialAnswers, readOnly, onSave, onSubmit, result, demo,
  subject, theme, teacher, slideActions,
}: Props) {
  const { t } = useI18n()
  const [answers, setAnswers] = useState<Record<string, unknown>>(initialAnswers ?? {})
  const [demoChecked, setDemoChecked] = useState(false)
  const [hints, setHints] = useState<Set<string>>(new Set())
  const [step, setStep] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const startedAt = useRef(Date.now())
  const savedRef = useRef(JSON.stringify(initialAnswers ?? {}))
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const steps = useMemo(
    () => ORDER.filter((component) => (
      component === 'presentation'
        ? (content.presentation?.slides?.length ?? 0) > 0
        : questionsIn(content, component).length > 0
    )),
    [content],
  )
  const current = steps[Math.min(step, steps.length - 1)]

  const scored = useMemo(
    () => steps.flatMap((component) => questionsIn(content, component))
      .filter((question) => question.scored !== false),
    [content, steps],
  )
  const unanswered = scored.filter((question) => {
    const given = answers[question.id]
    return given === undefined || given === '' ||
      (Array.isArray(given) && given.length === 0)
  })

  const elapsed = () => Math.round((Date.now() - startedAt.current) / 1000)

  /* Debounced autosave. The comparison against the last saved payload is what
     keeps a re-render — or a reorder that produced the same array — from
     costing a request. */
  useEffect(() => {
    // `demo` first and explicitly: a rehearsal writes nothing, and relying on
    // the caller simply not passing `onSave` would make that a convention
    // rather than a guarantee.
    if (demo || readOnly || !onSave) return
    const payload = JSON.stringify(answers)
    if (payload === savedRef.current) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      savedRef.current = payload
      void onSave(answers, elapsed())
    }, SAVE_DEBOUNCE_MS)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [answers, readOnly, onSave])

  /* A pending save must still land when the child navigates away mid-debounce —
     otherwise the last thing they typed is the one thing that is lost. */
  useEffect(() => {
    if (demo || readOnly || !onSave) return
    const flush = () => {
      const payload = JSON.stringify(answers)
      if (payload !== savedRef.current) {
        savedRef.current = payload
        void onSave(answers, elapsed())
      }
    }
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [answers, readOnly, onSave])

  const answer = useCallback((id: string, value: unknown) => {
    setAnswers((previous) => ({ ...previous, [id]: value }))
  }, [])

  const submit = async () => {
    if (!onSubmit || busy) return
    setBusy(true)
    try {
      if (timer.current) clearTimeout(timer.current)
      await onSubmit(answers, elapsed())
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  const shown = result ? (result.content ?? content) : content
  const done = Boolean(result) || readOnly || (demo && demoChecked)

  /* Marked here, from the key, and only once the teacher asks. Computed per
     render rather than stored, so "try again" is a flag flip and cannot leave
     a stale verdict behind. */
  const demoVerdict = (question: LearnerQuestion) => {
    if (!demo || !demoChecked) return question.verdict
    const correct = markLocally(question, answers[question.id])
    if (correct === null) return null
    return { correctness: correct ? 1 : 0, correct, skipped: false, detail: null }
  }

  return (
    <div className="yv-player">
      {steps.length > 1 ? (
        <nav className="yv-player__steps" aria-label={t('tasks.steps.label')}>
          {steps.map((component, index) => (
            <button
              key={component} type="button"
              className={`yv-player__step${index === step ? ' is-at' : ''}`}
              aria-current={index === step ? 'step' : undefined}
              onClick={() => setStep(index)}
            >
              <Icon name={component === 'presentation' ? 'book'
                : component === 'test' ? 'document' : 'click'} size={15} />
              {t(`tasks.component.${component}`)}
            </button>
          ))}
        </nav>
      ) : null}

      {current === 'presentation' ? (
        <SlideDeck
          slides={shown.presentation?.slides ?? []}
          subject={subject}
          theme={theme}
          teacher={teacher}
          slideActions={slideActions}
          onFinished={() => { if (step < steps.length - 1) { /* the child advances */ } }}
        />
      ) : (
        <div className="yv-player__questions">
          {current === 'test' && content.test?.time_limit_minutes ? (
            <p className="yv-player__limit">
              <Icon name="clock" size={15} />
              {t('tasks.test.limit', { n: String(content.test.time_limit_minutes) })}
            </p>
          ) : null}

          {questionsIn(shown, current).map((question, index) => (
            question.scored === false ? (
              <StudyBlock key={`${question.id}:${index}`} block={question as never} />
            ) : (
              <QuestionCard
                /* Position too, not the id alone. Practice now renders the old
                   fourth part's blocks beside its own questions, and a task
                   built before block ids were namespaced can carry the same id
                   twice — React would then reuse one node for both. */
                key={`${question.id}:${index}`}
                question={question}
                index={index}
                value={answers[question.id]}
                onChange={(value) => answer(question.id, value)}
                readOnly={done}
                verdict={demoVerdict(question)}
                showHint={hints.has(question.id)}
                onAskHint={() => setHints((current) => new Set(current).add(question.id))}
              />
            )
          ))}
        </div>
      )}

      <footer className="yv-player__foot">
        {step > 0 ? (
          <button type="button" className="sp-btn sp-btn--ghost"
                  onClick={() => setStep((position) => position - 1)}>
            {t('tasks.back')}
          </button>
        ) : <span />}

        {step < steps.length - 1 ? (
          <button type="button" className="sp-btn yv-player__next"
                  onClick={() => setStep((position) => position + 1)}>
            {t('tasks.next')}
            <Icon name="arrow" size={16} />
          </button>
        ) : demo ? (
          /* A rehearsal ends in marking, not in handing in. Nothing is sent,
             nothing is stored, and "try again" simply un-marks. */
          <div className="yv-player__demo">
            {demoChecked ? (
              <>
                <span className="yv-player__demoScore" dir="auto">
                  {t('tasks.demo.score', {
                    right: String(scored.filter(
                      (question) => markLocally(question, answers[question.id]) === true).length),
                    all: String(scored.length),
                  })}
                </span>
                <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                        onClick={() => { setDemoChecked(false); setAnswers({}) }}>
                  {t('tasks.demo.again')}
                </button>
              </>
            ) : (
              <button type="button" className="sp-btn"
                      onClick={() => setDemoChecked(true)}>
                <Icon name="check" size={16} />
                {t('tasks.demo.check')}
              </button>
            )}
          </div>
        ) : done ? null : confirming ? (
          <div className="yv-player__confirm">
            <p>
              {unanswered.length
                ? t('tasks.submit.blanks', { n: String(unanswered.length) })
                : t('tasks.submit.sure')}
            </p>
            <div className="yv-player__confirmBtns">
              <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                      onClick={() => setConfirming(false)}>
                {t('tasks.submit.cancel')}
              </button>
              <button type="button" className="sp-btn sp-btn--sm" disabled={busy}
                      onClick={() => void submit()}>
                {busy ? t('tasks.submit.sending') : t('tasks.submit.confirm')}
              </button>
            </div>
          </div>
        ) : (
          /* Never disabled. A child may hand in an incomplete paper; the count
             tells them what is blank rather than a dead button telling them
             nothing. */
          <button type="button" className="sp-btn sp-btn--gradient"
                  onClick={() => setConfirming(true)}>
            <Icon name="check" size={16} />
            {t('tasks.submit')}
          </button>
        )}
      </footer>
    </div>
  )
}
