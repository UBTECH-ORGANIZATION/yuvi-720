import { Icon, StatusPill } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import type { DashboardDTO } from '../../services/brain'

interface DashboardOverviewProps {
  dashboard: DashboardDTO
  onMentoring: () => void
  onAskYuvi: () => void
}

export function DashboardOverview({ dashboard, onMentoring, onAskYuvi }: DashboardOverviewProps) {
  const { t, language } = useI18n()
  const firstStrength = dashboard.mapping.strengths[0]
  const firstChallenge = dashboard.difficulties[0]
  const activeGoal = dashboard.goals.find((goal) => !goal.done)

  const formatDeadline = (value?: string | null) => {
    if (!value) return null
    const date = new Date(`${value}T00:00:00`)
    if (Number.isNaN(date.getTime())) return value
    return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'long' }).format(date)
  }

  return (
    <>
      <section className="sd-section" aria-labelledby="sd-today-title">
        <div className="sd-section__heading">
          <div>
            <span className="sd-section__kicker">{t('sdash.today.kicker')}</span>
            <h2 id="sd-today-title">{t('sdash.today.title')}</h2>
            <p>{t('sdash.today.subtitle')}</p>
          </div>
        </div>

        <div className="sd-today-grid">
          <article className="sd-focus-card sd-focus-card--goal">
            <span className="sd-focus-card__icon"><Icon name="target" size={23} /></span>
            <div className="sd-focus-card__body">
              <h3>{t('sdash.goals')}</h3>
              {activeGoal ? (
                <>
                  <p dir="auto">{activeGoal.text}</p>
                  {activeGoal.deadline && (
                    <span className="sd-focus-card__meta">
                      <Icon name="clock" size={14} />
                      {t('sdash.goal.deadline', { date: formatDeadline(activeGoal.deadline) || activeGoal.deadline })}
                    </span>
                  )}
                </>
              ) : <p className="sd-muted">{t('sdash.goalsEmpty')}</p>}
            </div>
            <button className="sd-card-action" type="button" onClick={onMentoring}>{t('sdash.goal.open')}</button>
          </article>

          <article className="sd-focus-card sd-focus-card--strength">
            <span className="sd-focus-card__icon"><Icon name="spark" size={23} /></span>
            <div className="sd-focus-card__body">
              <h3>{t('sdash.strengths')}</h3>
              {firstStrength ? (
                <>
                  <p className="sd-focus-card__lead" dir="auto">{firstStrength}</p>
                  <span className="sd-focus-card__meta">{t('sdash.strength.use')}</span>
                </>
              ) : <p className="sd-muted">{t('sdash.strength.empty')}</p>}
            </div>
          </article>

          <article className="sd-focus-card sd-focus-card--challenge">
            <span className="sd-focus-card__icon"><Icon name="lightbulb" size={23} /></span>
            <div className="sd-focus-card__body">
              <h3>{t('sdash.challenges')}</h3>
              {firstChallenge ? (
                <>
                  <p className="sd-focus-card__lead" dir="auto">{firstChallenge.text}</p>
                  <span className="sd-focus-card__meta">{t('sdash.challenge.support')}</span>
                </>
              ) : <p className="sd-muted">{t('sdash.challenge.empty')}</p>}
            </div>
            <button className="sd-card-action" type="button" onClick={onAskYuvi}>{t('sdash.challenge.askYuvi')}</button>
          </article>
        </div>
      </section>

      <section className="sd-learning-profile" aria-labelledby="sd-profile-title">
        <div className="sd-learning-profile__intro">
          <span className="sd-section__kicker">{t('sdash.mapping.kicker')}</span>
          <h2 id="sd-profile-title">{t('sdash.mapping')}</h2>
          <p>{t('sdash.mapping.subtitle')}</p>

          <dl className="sd-profile-facts">
            <div>
              <dt>{t('sdash.learningStyle')}</dt>
              <dd dir="auto">{dashboard.mapping.learningStyle || t('sdash.profile.notYet')}</dd>
            </div>
            <div>
              <dt>{t('sdash.environment')}</dt>
              <dd dir="auto">{dashboard.mapping.environment || t('sdash.profile.notYet')}</dd>
            </div>
          </dl>

          <div className="sd-profile-tags">
            <span className="sd-profile-tags__label">{t('sdash.interests')}</span>
            <div>
              {dashboard.mapping.interests.length > 0
                ? dashboard.mapping.interests.map((interest) => <span className="sd-profile-tag" dir="auto" key={interest}>{interest}</span>)
                : <span className="sd-muted">{t('sdash.profile.notYet')}</span>}
            </div>
          </div>
        </div>

        <div className="sd-activeness">
          <div className="sd-activeness__heading">
            <h3>{t('sdash.competencies')}</h3>
            <p>{t('sdash.competencies.subtitle')}</p>
          </div>
          <div className="sd-activeness__grid">
            {dashboard.competencies.map((competency) => (
              <article className={`sd-competency sd-competency--${competency.tone}`} key={competency.key}>
                <span className="sd-competency__icon"><Icon name={competencyIcon(competency.key)} size={18} /></span>
                <span className="sd-competency__copy">
                  <strong dir="auto">{competency.label}</strong>
                  <StatusPill tone={competency.tone}>{competency.descriptor}</StatusPill>
                </span>
              </article>
            ))}
          </div>
        </div>
      </section>

      {dashboard.reflectionPreview?.answer && (
        <section className="sd-reflection" aria-labelledby="sd-reflection-title">
          <span className="sd-reflection__icon"><Icon name="reflect" size={25} /></span>
          <div>
            <span className="sd-section__kicker">{t('sdash.reflection.kicker')}</span>
            <h2 id="sd-reflection-title">{t('sdash.reflection.title')}</h2>
            <blockquote dir="auto">{dashboard.reflectionPreview.answer}</blockquote>
          </div>
        </section>
      )}
    </>
  )
}

function competencyIcon(key: string): string {
  if (key === 'motivation_relevance') return 'target'
  if (key === 'growth_mindset') return 'spark'
  if (key === 'initiative_responsibility') return 'arrow'
  if (key === 'self_regulation') return 'clock'
  if (key === 'self_awareness') return 'reflect'
  return 'message'
}
