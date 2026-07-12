import { Icon, StatusPill } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import type { DashboardSubject } from '../../services/brain'

interface SubjectJourneyProps {
  subjects: DashboardSubject[]
  onOpenLearning: () => void
}

export function SubjectJourney({ subjects, onOpenLearning }: SubjectJourneyProps) {
  const { t } = useI18n()

  return (
    <section className="sd-section" aria-labelledby="sd-subjects-title">
      <div className="sd-section__heading">
        <div>
          <span className="sd-section__kicker">{t('sdash.subjects.kicker')}</span>
          <h2 id="sd-subjects-title">{t('sdash.subjects')}</h2>
          <p>{t('sdash.subjects.subtitle')}</p>
        </div>
        <button className="sd-text-action" type="button" onClick={onOpenLearning}>
          <span>{t('sdash.subjects.all')}</span>
          <Icon name="arrow" size={16} />
        </button>
      </div>

      <div className="sd-subject-grid">
        {subjects.map((subject) => (
          <article className={`sd-subject-card sd-subject-card--${subject.key}`} key={subject.key}>
            <header className="sd-subject-card__header">
              <span className="sd-subject-card__icon" aria-hidden="true">
                <Icon name={subject.key === 'math' ? 'chart' : 'lightbulb'} size={22} />
              </span>
              <div className="sd-subject-card__identity">
                <h3 dir="auto">{subject.name}</h3>
                <StatusPill tone={subject.progress >= 70 ? 'strong' : subject.progress >= 35 ? 'steady' : 'support'}>
                  {subject.level}
                </StatusPill>
              </div>
            </header>

            <div className="sd-subject-card__track" aria-hidden="true">
              <span style={{ inlineSize: `${subject.progress}%` }} />
            </div>

            <ol className="sd-objective-path" aria-label={t('sdash.subjects.path')}>
              {subject.curriculum.map((objective) => (
                <li className={`sd-objective sd-objective--${objective.statusClass.replace('curr-', '')}`} key={objective.objectiveId}>
                  <span className="sd-objective__marker" aria-hidden="true">
                    {objective.statusClass === 'curr-done' ? <Icon name="check" size={13} /> : null}
                  </span>
                  <span className="sd-objective__copy">
                    <strong dir="auto">{objective.topic}</strong>
                    <small>{objective.status}</small>
                  </span>
                </li>
              ))}
            </ol>
          </article>
        ))}
      </div>
    </section>
  )
}
