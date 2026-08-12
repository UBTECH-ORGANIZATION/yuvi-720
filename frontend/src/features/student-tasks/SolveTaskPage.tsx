/* Solving one task — a focus surface, like a lesson.
 *
 * Deliberately no `LearnerAppBar`: this is the one learner screen where the
 * navigation is a way to lose work. There is a single way out and it says so.
 *
 * The completion panel is verbal plus sparks and carries no percentage. The
 * number is computed and stored — the teacher needs it — but a child who reads
 * 62% stops reading the sentence that says what to do next.
 */

import { useCallback, useEffect, useState } from 'react'
import { navigate } from '../../app/router'
import { ErrorState, Icon, LoadingState } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { TaskPlayer } from '../tasks/TaskPlayer'
import {
  openTask, saveAnswers, submitTask,
  type OpenTask, type SubmitResult,
} from '../../services/tasks'
import './student-tasks.css'

export function SolveTaskPage({ taskId }: { taskId: string }) {
  const { t, language } = useI18n()
  const [task, setTask] = useState<OpenTask | null>(null)
  const [result, setResult] = useState<SubmitResult | null>(null)
  const [error, setError] = useState<'missing' | 'failed' | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    openTask(taskId, controller.signal)
      .then(setTask)
      .catch((cause) => {
        if (controller.signal.aborted) return
        setError(String(cause).includes('404') ? 'missing' : 'failed')
      })
    return () => controller.abort()
  }, [taskId])

  /* Failure here is silent on purpose: an autosave that interrupts a child
     mid-answer with an error banner is worse than one that quietly retries on
     the next change, and the submit path reports for real. */
  const save = useCallback(async (answers: Record<string, unknown>, timeSpent: number) => {
    try {
      await saveAnswers(taskId, answers, timeSpent)
    } catch {
      /* keep the answers in memory; the next change tries again */
    }
  }, [taskId])

  const submit = useCallback(async (answers: Record<string, unknown>, timeSpent: number) => {
    const payload = await submitTask(taskId, answers, timeSpent, language)
    setResult(payload)
    return payload
  }, [taskId, language])

  if (error) {
    return (
      <main className="st-solve">
        <ErrorState
          title={t(error === 'missing' ? 'tasks.solve.missing' : 'tasks.solve.error')}
          body={t(error === 'missing' ? 'tasks.solve.missingBody' : 'tasks.solve.errorBody')}
          action={
            <button type="button" className="sp-btn" onClick={() => navigate('/tasks')}>
              {t('tasks.solve.backToList')}
            </button>
          }
        />
      </main>
    )
  }

  if (!task) {
    return (
      <main className="st-solve">
        <LoadingState title={t('tasks.solve.loading')} />
      </main>
    )
  }

  const finished = Boolean(result) || task.status === 'submitted' || task.status === 'graded'

  return (
    <main className="st-solve">
      <header className="st-solve__bar">
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                onClick={() => navigate('/tasks')}>
          <Icon name="arrow" size={15} className="st-solve__back" />
          {t('tasks.solve.leave')}
        </button>
        <h1 className="st-solve__title">{task.title ?? t('tasks.untitled')}</h1>
        <span className="st-solve__spacer" />
      </header>

      {result ? (
        <section className="st-done" role="status">
          <span className="st-done__mark" aria-hidden="true">
            <Icon name="spark" size={28} />
          </span>
          {/* The sentence, then the sparks. No number anywhere. */}
          <p className="st-done__said">{result.message}</p>
          <p className="st-done__sparks">
            <Icon name="spark" size={16} />
            {t('tasks.done.sparks', { n: String(result.sparks) })}
          </p>
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                  onClick={() => navigate('/tasks')}>
            {t('tasks.solve.backToList')}
          </button>
        </section>
      ) : null}

      <TaskPlayer
        content={task.content}
        /* The same ground the teacher previewed. Never `teacher`, so notes and
           the present/print controls cannot appear in a child's lane. */
        subject={task.subject}
        theme={task.theme}
        initialAnswers={task.answers}
        readOnly={finished}
        result={result}
        onSave={finished ? undefined : save}
        onSubmit={finished ? undefined : submit}
      />
    </main>
  )
}
