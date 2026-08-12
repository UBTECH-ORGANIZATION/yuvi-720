/* The learner's task list.
 *
 * Ordered by what is due, not by what arrived — a task due tomorrow matters
 * more than one that landed this morning, and "newest first" buries it.
 *
 * Finished tasks keep the sentence the child was told and never show a mark.
 * The score exists and the teacher can see it; putting it here would make the
 * number the whole message, which is the one thing 5.6 rules out.
 */

import { useEffect, useState } from 'react'
import { navigate } from '../../app/router'
import { LearnerAppBar } from '../../components/LearnerAppBar'
import { EmptyState, ErrorState, Icon, SkeletonRows } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { listMyTasks, type MyTask } from '../../services/tasks'
import './student-tasks.css'
import { formatDay } from '../../i18n/dates'

/** Overdue first, then by due date, then by what arrived most recently.
 *  Undated tasks sort after dated ones rather than to the top — an absent
 *  deadline is not an urgent one. */
function byUrgency(a: MyTask, b: MyTask) {
  const done = (task: MyTask) => task.status === 'submitted' || task.status === 'graded'
  if (done(a) !== done(b)) return done(a) ? 1 : -1
  if (a.due_at && b.due_at) return a.due_at.localeCompare(b.due_at)
  if (a.due_at) return -1
  if (b.due_at) return 1
  return String(b.assigned_at ?? '').localeCompare(String(a.assigned_at ?? ''))
}

function daysUntil(due: string | null): number | null {
  if (!due) return null
  const at = new Date(due).getTime()
  if (Number.isNaN(at)) return null
  return Math.ceil((at - Date.now()) / 86_400_000)
}

export function MyTasksPage() {
  const { t, language } = useI18n()
  const [tasks, setTasks] = useState<MyTask[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    listMyTasks(controller.signal)
      .then((payload) => setTasks([...payload.tasks].sort(byUrgency)))
      .catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => controller.abort()
  }, [])

  const open = tasks?.filter((task) => task.status !== 'submitted' && task.status !== 'graded') ?? []
  const finished = tasks?.filter((task) => task.status === 'submitted' || task.status === 'graded') ?? []

  return (
    <>
      <LearnerAppBar />
      <main className="st-wrap">
        <header className="st-hero">
          <p className="st-hero__eyebrow">{t('tasks.my.eyebrow')}</p>
          <h1>{t('tasks.my.title')}</h1>
          <p>{t('tasks.my.subtitle')}</p>
        </header>

        {error ? (
          <ErrorState title={t('tasks.my.error')} body={t('tasks.my.errorBody')} />
        ) : tasks === null ? (
          <SkeletonRows rows={3} />
        ) : tasks.length === 0 ? (
          <EmptyState icon="backpack" title={t('tasks.my.empty')} body={t('tasks.my.emptyBody')} />
        ) : (
          <>
            {open.length > 0 ? (
              <section className="st-section">
                <h2>{t('tasks.my.open')}</h2>
                <ul className="st-list">
                  {open.map((task) => (
                    <TaskRow key={task.launch_id} task={task} language={language} />
                  ))}
                </ul>
              </section>
            ) : null}

            {finished.length > 0 ? (
              <section className="st-section">
                <h2>{t('tasks.my.finished')}</h2>
                <ul className="st-list st-list--quiet">
                  {finished.map((task) => (
                    <TaskRow key={task.launch_id} task={task} language={language} />
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </main>
    </>
  )
}

function TaskRow({ task, language }: { task: MyTask; language: string }) {
  const { t } = useI18n()
  const done = task.status === 'submitted' || task.status === 'graded'
  const left = daysUntil(task.due_at)
  const overdue = left !== null && left < 0 && !done

  return (
    <li className={`st-row${done ? ' is-done' : ''}${overdue ? ' is-overdue' : ''}`}>
      <button type="button" className="st-row__hit"
              onClick={() => navigate(`/tasks/${encodeURIComponent(task.launch_id)}`)}>
        <span className="st-row__icon" aria-hidden="true">
          <Icon name={done ? 'check' : 'backpack'} size={18} />
        </span>
        <span className="st-row__text">
          <span className="st-row__title">{task.title ?? t('tasks.untitled')}</span>
          {/* Two rows with the same title are two sittings of one task, not a
              duplicate — say which, or it reads as a bug. */}
          {task.repeat > 1 ? (
            <span className="st-row__tag">{t('tasks.my.repeat', { n: String(task.repeat) })}</span>
          ) : null}
          <span className="st-row__meta">
            {task.status === 'in_progress' ? (
              <span className="st-row__tag">{t('tasks.status.in_progress')}</span>
            ) : null}
            {done && task.completed_at ? (
              <span>{formatDay(task.completed_at)}</span>
            ) : left !== null ? (
              <span className={overdue ? 'is-overdue' : ''}>
                {overdue
                  ? t('tasks.due.overdue', { n: String(Math.abs(left)) })
                  : left === 0 ? t('tasks.due.today')
                  : t('tasks.due.in', { n: String(left) })}
              </span>
            ) : null}
          </span>
          {/* Words, never a mark. */}
          {done && task.feedback ? (
            <span className="st-row__said">{task.feedback}</span>
          ) : null}
        </span>
        <Icon name="arrow" size={16} className="st-row__go" />
      </button>
    </li>
  )
}
