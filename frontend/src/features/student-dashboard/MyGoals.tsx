import { useEffect, useState } from 'react'
import { Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import type { DashboardDTO } from '../../services/brain'

type Goal = DashboardDTO['goals'][number]

interface MyGoalsProps {
  goals: Goal[]
  /** Opens the full goals surface (mentoring). */
  onSeeAll: () => void
  /** Starts a flow to add / define a new goal. */
  onAddGoal: () => void
}

const MAX_VISIBLE = 3

/** Normalize the raw brain status into a learner-facing status key. */
function statusKey(goal: Goal): 'new' | 'started' | 'in_progress' | 'almost_done' | 'done' {
  if (goal.done || goal.status === 'done') return 'done'
  switch (goal.status) {
    case 'new':
      return 'new'
    case 'started':
      return 'started'
    case 'almost_done':
      return 'almost_done'
    case 'in_progress':
    case 'open':
    case 'mentoring':
      return 'in_progress'
    default:
      break
  }
  // Fall back to step-based inference when the status is unset.
  if (goal.steps && goal.steps.total > 0) {
    const ratio = goal.steps.done / goal.steps.total
    if (ratio <= 0) return 'new'
    if (ratio >= 1) return 'done'
    if (ratio >= 0.75) return 'almost_done'
    if (ratio <= 0.25) return 'started'
    return 'in_progress'
  }
  return 'in_progress'
}

/** Normalize the raw brain source into one of the three known origins. */
function sourceKey(goal: Goal): 'self' | 'teacher' | 'yuvi' {
  const raw = (goal.source || '').toLowerCase()
  if (raw === 'self' || raw === 'learner') return 'self'
  if (raw === 'yuvi' || raw === 'ai' || raw === 'suggested' || raw === 'agent') return 'yuvi'
  // Mentoring, teacher, co-created and everything else read as "with the teacher".
  return 'teacher'
}

/** Presentational icon inferred from the goal wording (RTL-safe, no emoji). */
function goalIcon(text: string): string {
  const t = text.toLowerCase()
  if (/שיעור|השתתפ|כיתה|class|lesson|particip/.test(t)) return 'message'
  if (/זמן|לוח|time|schedul/.test(t)) return 'clock'
  if (/מתמטיק|תרגול|math|practice|חשבון/.test(t)) return 'calculator'
  if (/קרוא|קריא|ספר|read|book/.test(t)) return 'book'
  if (/עבוד|הגש|משימ|assign|submit|task/.test(t)) return 'document'
  return 'target'
}

// Sorting: attention / near deadline first, then in progress, started, new, done last.
const STATUS_RANK: Record<string, number> = {
  almost_done: 0,
  in_progress: 1,
  started: 2,
  new: 3,
  done: 9,
}

export function MyGoals({ goals, onSeeAll, onAddGoal }: MyGoalsProps) {
  const { t, language } = useI18n()
  const [openGoal, setOpenGoal] = useState<Goal | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    if (!helpOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHelpOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [helpOpen])

  const formatDeadline = (value?: string | null) => {
    if (!value) return null
    const date = new Date(`${value}T00:00:00`)
    if (Number.isNaN(date.getTime())) return value
    return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'long' }).format(date)
  }

  const deadlineTime = (value?: string | null) => {
    if (!value) return Number.POSITIVE_INFINITY
    const time = new Date(`${value}T00:00:00`).getTime()
    return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
  }

  const sorted = [...goals].sort((a, b) => {
    const rankA = STATUS_RANK[statusKey(a)] ?? 5
    const rankB = STATUS_RANK[statusKey(b)] ?? 5
    if (rankA !== rankB) return rankA - rankB
    return deadlineTime(a.deadline) - deadlineTime(b.deadline)
  })

  const visible = sorted.slice(0, MAX_VISIBLE)
  const remaining = sorted.length - visible.length

  const header = (
    <div className="sd-goals__head">
      <div className="sd-goals__heading">
        <span className="sd-goals__head-icon" aria-hidden="true"><Icon name="inbox" size={20} /></span>
        <div>
          <h2 id="sd-goals-title">{t('sdash.goalsCard.title')}</h2>
          <p>{t('sdash.goalsCard.subtitle')}</p>
        </div>
      </div>
      <div className="sd-goals__head-actions">
        {goals.length > 0 && (
          <button type="button" className="sd-goals__see-all" onClick={onSeeAll}>
            <span>{t('sdash.goalsCard.seeAll')}</span>
            <Icon name="chevronLeft" size={16} />
          </button>
        )}
        <button
          type="button"
          className="sd-goals__help"
          onClick={() => setHelpOpen(true)}
          aria-label={t('sdash.goalsCard.help.aria')}
        >
          <Icon name="help" size={17} />
        </button>
      </div>
    </div>
  )

  return (
    <section className="sd-section" aria-labelledby="sd-goals-title">
      <div className="sd-goals">
        {header}

        {goals.length === 0 ? (
          <div className="sd-goals__empty">
            <span className="sd-goals__empty-icon" aria-hidden="true"><Icon name="target" size={26} /></span>
            <h3>{t('sdash.goalsCard.empty.title')}</h3>
            <p>{t('sdash.goalsCard.empty.body')}</p>
            <button type="button" className="sd-button sd-button--primary" onClick={onAddGoal}>
              {t('sdash.goalsCard.empty.action')}
            </button>
          </div>
        ) : (
          <>
            <ul className="sd-goals__list">
              {visible.map((goal, index) => {
                const sKey = statusKey(goal)
                const deadline = formatDeadline(goal.deadline)
                const steps = goal.steps
                const percent = steps && steps.total > 0
                  ? Math.round((steps.done / steps.total) * 100)
                  : null
                return (
                  <li key={goal.id || `${goal.text}-${index}`}>
                    <button
                      type="button"
                      className="sd-goal-row"
                      onClick={() => setOpenGoal(goal)}
                      aria-label={`${goal.text} — ${t(`sdash.goalsCard.status.${sKey}`)}`}
                    >
                      <span className={`sd-goal-row__icon sd-goal-row__icon--${sKey}`} aria-hidden="true">
                        <Icon name={goalIcon(goal.text)} size={20} />
                      </span>

                      <span className="sd-goal-row__body">
                        <span className="sd-goal-row__title" dir="auto">{goal.text}</span>
                        <span className="sd-goal-row__source">{t(`sdash.goalsCard.source.${sourceKey(goal)}`)}</span>
                      </span>

                      <span className="sd-goal-row__progress">
                        <span className={`sd-goal-row__status sd-goal-row__status--${sKey}`}>
                          {t(`sdash.goalsCard.status.${sKey}`)}
                        </span>
                        <span className="sd-goal-row__bar" role="presentation">
                          <span
                            className={`sd-goal-row__bar-fill sd-goal-row__bar-fill--${sKey}`}
                            style={{ inlineSize: `${percent ?? 0}%` }}
                          />
                        </span>
                        {steps && steps.total > 0 && (
                          <span className="sd-goal-row__steps">
                            {t('sdash.goalsCard.steps', { done: steps.done, total: steps.total })}
                          </span>
                        )}
                      </span>

                      <span className="sd-goal-row__deadline">
                        <Icon name="calendar" size={14} />
                        {deadline
                          ? t('sdash.goalsCard.deadline', { date: deadline })
                          : t('sdash.goalsCard.noDeadline')}
                      </span>

                      <span className="sd-goal-row__enter" aria-hidden="true">
                        <Icon name="chevronLeft" size={18} />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>

            {remaining > 0 && (
              <button type="button" className="sd-goals__more" onClick={onSeeAll}>
                {remaining === 1
                  ? t('sdash.goalsCard.moreOne')
                  : t('sdash.goalsCard.moreMany', { count: remaining })}
              </button>
            )}
          </>
        )}
      </div>

      {goals.length > 0 && (
        <div className="sd-goals__add">
          <p>{t('sdash.goalsCard.addPrompt')}</p>
          <button type="button" className="sd-button sd-button--primary" onClick={onAddGoal}>
            <Icon name="plus" size={16} />
            <span>{t('sdash.goalsCard.add')}</span>
          </button>
        </div>
      )}

      {helpOpen && (
        <div className="sd-goals-help" role="presentation" onClick={() => setHelpOpen(false)}>
          <div
            className="sd-goals-help__card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sd-goals-help-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="sd-goals-help__close"
              onClick={() => setHelpOpen(false)}
              aria-label={t('sdash.goalsCard.help.close')}
              autoFocus
            >
              <Icon name="close" size={16} />
            </button>
            <span className="sd-goals-help__icon" aria-hidden="true"><Icon name="target" size={22} /></span>
            <h3 id="sd-goals-help-title">{t('sdash.goalsCard.help.title')}</h3>
            <p dir="auto">{t('sdash.goalsCard.help.what')}</p>
            <h4>{t('sdash.goalsCard.help.how.title')}</h4>
            <ul>
              <li dir="auto"><Icon name="teacher" size={15} /><span>{t('sdash.goalsCard.help.how.teacher')}</span></li>
              <li dir="auto"><Icon name="spark" size={15} /><span>{t('sdash.goalsCard.help.how.self')}</span></li>
              <li dir="auto"><Icon name="message" size={15} /><span>{t('sdash.goalsCard.help.how.yuvi')}</span></li>
            </ul>
            <h4>{t('sdash.goalsCard.help.progress.title')}</h4>
            <p dir="auto">{t('sdash.goalsCard.help.progress.body')}</p>
          </div>
        </div>
      )}

      {openGoal && (
        <GoalDrawer
          goal={openGoal}
          statusKey={statusKey(openGoal)}
          sourceKey={sourceKey(openGoal)}
          deadline={formatDeadline(openGoal.deadline)}
          onClose={() => setOpenGoal(null)}
          onOpenSpace={() => {
            setOpenGoal(null)
            onSeeAll()
          }}
        />
      )}
    </section>
  )
}

interface GoalDrawerProps {
  goal: Goal
  statusKey: 'new' | 'started' | 'in_progress' | 'almost_done' | 'done'
  sourceKey: 'self' | 'teacher' | 'yuvi'
  deadline: string | null
  onClose: () => void
  onOpenSpace: () => void
}

function GoalDrawer({ goal, statusKey, sourceKey, deadline, onClose, onOpenSpace }: GoalDrawerProps) {
  const { t } = useI18n()
  const steps = goal.steps
  const percent = steps && steps.total > 0 ? Math.round((steps.done / steps.total) * 100) : null

  return (
    <div className="sd-goal-drawer" role="dialog" aria-modal="true" aria-labelledby="sd-goal-drawer-title">
      <button type="button" className="sd-goal-drawer__scrim" aria-label={t('sdash.goalsCard.detail.close')} onClick={onClose} />
      <div className="sd-goal-drawer__panel">
        <div className="sd-goal-drawer__top">
          <span className={`sd-goal-drawer__badge sd-goal-drawer__badge--${statusKey}`}>
            {t(`sdash.goalsCard.status.${statusKey}`)}
          </span>
          <button type="button" className="sd-goal-drawer__close" onClick={onClose} aria-label={t('sdash.goalsCard.detail.close')}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <h2 id="sd-goal-drawer-title" dir="auto">{goal.text}</h2>

        <dl className="sd-goal-drawer__facts">
          <div>
            <dt>{t('sdash.goalsCard.detail.source')}</dt>
            <dd>{t(`sdash.goalsCard.source.${sourceKey}`)}</dd>
          </div>
          <div>
            <dt>{t('sdash.goalsCard.detail.deadline')}</dt>
            <dd>{deadline ? t('sdash.goalsCard.deadline', { date: deadline }) : t('sdash.goalsCard.noDeadline')}</dd>
          </div>
        </dl>

        {steps && steps.total > 0 && (
          <div className="sd-goal-drawer__progress">
            <div className="sd-goal-drawer__progress-head">
              <span>{t('sdash.goalsCard.detail.progress')}</span>
              <span>{t('sdash.goalsCard.steps', { done: steps.done, total: steps.total })}</span>
            </div>
            <span className="sd-goal-row__bar">
              <span
                className={`sd-goal-row__bar-fill sd-goal-row__bar-fill--${statusKey}`}
                style={{ inlineSize: `${percent ?? 0}%` }}
              />
            </span>
          </div>
        )}

        <button type="button" className="sd-button sd-button--primary sd-goal-drawer__cta" onClick={onOpenSpace}>
          {t('sdash.goalsCard.detail.cta')}
        </button>
      </div>
    </div>
  )
}
