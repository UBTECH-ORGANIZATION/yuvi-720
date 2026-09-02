/* Solving one task.
 *
 * The `LearnerAppBar` stays: leaving mid-task no longer loses work — answers
 * autosave and the paper reopens where the child left it — so hiding the
 * navigation protected nothing and cost the way back to everything else.
 *
 * The completion panel is verbal plus sparks and carries no percentage. The
 * number is computed and stored — the teacher needs it — but a child who reads
 * 62% stops reading the sentence that says what to do next.
 */

import { useCallback, useEffect, useState } from 'react'
import { navigate, setNavigationGuard } from '../../app/router'
import { LearnerAppBar } from '../../components/LearnerAppBar'
import { ErrorState, Icon, LoadingState } from '../../components/primitives'
import { Modal } from '../../components/primitives/Modal'
import { useI18n } from '../../i18n/I18nProvider'
import { TaskPlayer } from '../tasks/TaskPlayer'
import {
  openTask, saveAnswers, submitTask,
  type OpenTask,
} from '../../services/tasks'
import { putCelebration } from './sparksCelebration'
import './student-tasks.css'

export function SolveTaskPage({ taskId }: { taskId: string }) {
  const { t, language } = useI18n()
  const [task, setTask] = useState<OpenTask | null>(null)
  const [error, setError] = useState<'missing' | 'failed' | null>(null)
  /* Where the child was headed when the leave-confirm caught them. */
  const [leaving, setLeaving] = useState<string | null>(null)

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

  /* No end screen: handing in returns the child to the task list, where the
     sparks arrive as a dialog over the list they are back on. */
  const submit = useCallback(async (answers: Record<string, unknown>, timeSpent: number) => {
    const payload = await submitTask(taskId, answers, timeSpent, language)
    putCelebration(payload)
    setNavigationGuard(null)
    navigate('/tasks')
    return payload
  }, [taskId, language])

  /* Leaving mid-task asks first. Not because anything would be lost — answers
     autosave — but because the app bar is back and a stray click should not
     yank a child out of a paper without a word. The dialog SAYS the progress
     is kept, which is the difference between a warning and a reassurance. */
  const inProgress = Boolean(task) &&
    task?.status !== 'submitted' && task?.status !== 'graded'
  useEffect(() => {
    if (!inProgress) return
    setNavigationGuard((path) => {
      setLeaving(path)
      return false
    })
    return () => setNavigationGuard(null)
  }, [inProgress])

  const confirmLeave = () => {
    const path = leaving
    setLeaving(null)
    setNavigationGuard(null)
    if (path) navigate(path)
  }

  if (error) {
    return (
      <>
        <LearnerAppBar />
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
      </>
    )
  }

  if (!task) {
    return (
      <>
        <LearnerAppBar />
        <main className="st-solve">
          <LoadingState title={t('tasks.solve.loading')} />
        </main>
      </>
    )
  }

  const finished = task.status === 'submitted' || task.status === 'graded'

  return (
    <>
    <LearnerAppBar />
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

      <TaskPlayer
        content={task.content}
        /* The same ground the teacher previewed. Never `teacher`, so notes and
           the present/print controls cannot appear in a child's lane. */
        subject={task.subject}
        theme={task.theme}
        initialAnswers={task.answers}
        readOnly={finished}
        onSave={finished ? undefined : save}
        onSubmit={finished ? undefined : submit}
      />

      <Modal open={leaving !== null} onClose={() => setLeaving(null)}
             titleId="st-solve-leave-title">
        <div className="st-leave">
          <h2 id="st-solve-leave-title" className="st-leave__title">
            {t('tasks.leave.title')}
          </h2>
          {/* A reassurance, not a warning: the answers are already saved. */}
          <p className="st-leave__body">{t('tasks.leave.body')}</p>
          <div className="st-leave__actions">
            <button type="button" className="sp-btn sp-btn--ghost"
                    onClick={() => setLeaving(null)}>
              {t('tasks.leave.stay')}
            </button>
            <button type="button" className="sp-btn" onClick={confirmLeave}>
              {t('tasks.leave.go')}
            </button>
          </div>
        </div>
      </Modal>
    </main>
    </>
  )
}
