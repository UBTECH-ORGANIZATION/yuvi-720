/* The dashboard's task card — a pointer, not a second task list.
 *
 * It shows only what is still waiting, capped at three, because a dashboard
 * card that grows without bound stops being a summary. Everything else lives
 * on `/tasks`.
 *
 * It renders nothing at all when there is nothing outstanding. An empty card
 * headed "my tasks" tells a child their teacher has forgotten them; absence
 * says the same thing without the accusation.
 */

import { useEffect, useState } from 'react'
import { navigate } from '../../app/router'
import { Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { listMyTasks, type MyTask } from '../../services/tasks'

const MAX_VISIBLE = 3

function outstanding(task: MyTask) {
  return task.status !== 'submitted' && task.status !== 'graded'
}

export function MyTasks() {
  const { t } = useI18n()
  const [tasks, setTasks] = useState<MyTask[] | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    listMyTasks(controller.signal)
      .then((payload) => setTasks(payload.tasks.filter(outstanding)))
      // Silent: this is one card on a busy dashboard, and an error banner here
      // would be louder than the feature.
      .catch(() => setTasks([]))
    return () => controller.abort()
  }, [])

  if (!tasks?.length) return null

  return (
    <section className="sd-tasks">
      <header className="sd-tasks__head">
        <h2>
          <Icon name="backpack" size={18} />
          {t('tasks.my.title')}
        </h2>
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                onClick={() => navigate('/tasks')}>
          {t('tasks.my.seeAll')}
        </button>
      </header>

      <ul className="sd-tasks__list">
        {tasks.slice(0, MAX_VISIBLE).map((task) => (
          <li key={task.task_id}>
            <button type="button"
                    onClick={() => navigate(`/tasks/${encodeURIComponent(task.task_id)}`)}>
              <span className="sd-tasks__title">{task.title ?? t('tasks.untitled')}</span>
              {task.status === 'in_progress' ? (
                <span className="sd-tasks__tag">{t('tasks.status.in_progress')}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
