import type { CSSProperties } from 'react'
import { Icon, StatusPill } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import type { DashboardSubject } from '../../services/brain'
import type { LearningComponentDTO, LearningUnitDTO } from '../../services/learning'

interface SubjectJourneyProps {
  subjects: DashboardSubject[]
  roadmapUnits: LearningUnitDTO[]
  onOpenLearning: () => void
  onOpenComponent: (unit: LearningUnitDTO, component: LearningComponentDTO) => void
}

export function SubjectJourney({
  subjects,
  roadmapUnits,
  onOpenLearning,
  onOpenComponent,
}: SubjectJourneyProps) {
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
        {subjects.map((subject) => {
          const subjectRoadmaps = roadmapUnits.filter((unit) => unit.subject === subject.key)
          return (
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

            {subjectRoadmaps.length > 0 ? (
              <div className="sd-subject-roadmaps">
                {subjectRoadmaps.map((unit) => (
                  <section
                    className="sd-mini-roadmap"
                    aria-label={t('learning.roadmap.label', { title: unit.title })}
                    key={unit.id}
                  >
                    <header className="sd-mini-roadmap__header">
                      <span>{t('sdash.subjects.roadmap')}</span>
                      <strong dir="auto">{unit.title}</strong>
                    </header>
                    <ol
                      className="sd-mini-roadmap__path"
                      style={{ '--sd-roadmap-count': unit.components.length } as CSSProperties}
                    >
                      {unit.components.map((component, index) => {
                        const nextComponent = unit.components[index + 1]
                        const hasCompletedConnection = component.progress_state === 'completed'
                          && nextComponent?.progress_state === 'completed'
                        return (
                          <li
                            className={`is-${component.progress_state}${hasCompletedConnection ? ' has-completed-connection' : ''}`}
                            key={component.id}
                          >
                            <button
                              type="button"
                              disabled={component.progress_state === 'locked'}
                              onClick={() => onOpenComponent(unit, component)}
                              aria-label={`${component.title}. ${t(`learning.roadmap.state.${component.progress_state}`)}`}
                            >
                              <span className="sd-mini-roadmap__node" aria-hidden="true">
                                {component.progress_state === 'completed' ? <Icon name="check" size={12} /> : null}
                              </span>
                              <span className="sd-mini-roadmap__copy">
                                <strong dir="auto">{component.title}</strong>
                                <small>{t(`learning.roadmap.state.${component.progress_state}`)}</small>
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ol>
                  </section>
                ))}
              </div>
            ) : (
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
            )}
          </article>
          )
        })}
      </div>
    </section>
  )
}
