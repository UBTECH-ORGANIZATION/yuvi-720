import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { useMediaQuery } from '../../hooks/useResponsive'
import type { DashboardSubject } from '../../services/brain'
import type { LearningUnitDTO } from '../../services/learning'
import './my-subjects.css'

interface MySubjectsProps {
  subjects: DashboardSubject[]
  units: LearningUnitDTO[]
  onOpenLearning: () => void
}

/** Line icons, not the DTO's emoji — the 720 UI bar keeps emoji off the page. */
const SUBJECT_ICON: Record<string, string> = {
  math: 'calculator',
  science: 'orbit',
}

type ObjectiveState = 'mastered' | 'inProgress' | 'notStarted'

interface ObjectiveView {
  id: string
  title: string
  percent: number
  state: ObjectiveState
  needsReview: boolean
  /** The component the learner is standing in, from the catalog. Null when the
   *  objective has no unit on their path yet. */
  task: string | null
  illustration: { url: string; staticUrl: string } | null
}

/** The step the learner is on inside this objective, and the artwork for it.
 *
 *  Both come from the unit the objective maps to, so nothing here is invented:
 *  the task is a real component title from the learner's own path, and the
 *  picture is the curated diagram the catalog already resolved for that unit. */
function unitFacts(units: LearningUnitDTO[], objectiveId: string) {
  const mine = units.filter((unit) => unit.objective_id === objectiveId)
  const unit = mine.find((u) => u.unit_state === 'in_progress')
    ?? mine.find((u) => u.current_component_id)
    ?? mine[0]
  if (!unit) return { task: null, illustration: null }
  // A repair round puts the same component on the path twice; the later visit
  // is the one they are actually in.
  const current = (unit.components || [])
    .filter((c) => c.on_path && c.component_id === unit.current_component_id)
    .sort((a, b) => (b.visit ?? 0) - (a.visit ?? 0))[0]
  return {
    task: current?.title || null,
    illustration: unit.illustration
      ? { url: unit.illustration.url, staticUrl: unit.illustration.staticUrl }
      : null,
  }
}

function objectiveState(
  statusClass: string, percent: number,
): ObjectiveState {
  if (statusClass === 'curr-done') return 'mastered'
  if (statusClass === 'curr-current' || percent > 0) return 'inProgress'
  return 'notStarted'
}

/**
 * "My subjects" — where the learner stands, by subject and by the learning
 * objectives inside it.
 *
 * Deliberately not a launcher: no CTA, no link into a lesson. Everywhere else
 * on the dashboard already offers a way in, and a child needs one place that
 * simply shows how far they have come.
 */
export function MySubjects({ subjects, units, onOpenLearning }: MySubjectsProps) {
  const { t } = useI18n()
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [selected, setSelected] = useState<string | null>(null)

  // Open the first subject as soon as one arrives, so the panel shows progress
  // instead of an invitation to click. Once only: after that the learner owns
  // the selection, and re-opening it would make "back" do nothing.
  const primed = useRef(false)
  useEffect(() => {
    if (primed.current || !subjects.length) return
    primed.current = true
    setSelected(subjects[0].key)
  }, [subjects])

  const active = useMemo(
    () => subjects.find((s) => s.key === selected) ?? null,
    [subjects, selected],
  )

  const objectives = useMemo<ObjectiveView[]>(() => {
    if (!active) return []
    // A payload cached from before these fields shipped must still render.
    return (active.curriculum ?? []).map((row) => ({
      id: row.objectiveId,
      title: row.topic,
      percent: row.percent ?? 0,
      state: objectiveState(row.statusClass, row.percent ?? 0),
      needsReview: row.needsReview ?? false,
      ...unitFacts(units, row.objectiveId),
    }))
  }, [active, units])

  return (
    <section className="sd-section sd-subjects" aria-labelledby="sd-subjects-title">
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

      {/* Two columns on a wide card; below 860px the same two panes take turns
          in one column, so drilling in never makes the section taller. */}
      <div className={`sd-subjects__cols${active ? ' is-drilled' : ''}`}>
        <ul className="sd-subjects__list">
          {subjects.map((subject) => (
            <li key={subject.key}>
              <button
                type="button"
                className={`sd-subject-row${selected === subject.key ? ' is-open' : ''}`}
                aria-expanded={selected === subject.key}
                aria-controls="sd-subjects-objectives"
                onClick={() => setSelected(selected === subject.key ? null : subject.key)}
              >
                <span className="sd-subject-row__icon" style={{ background: subject.iconBg }}>
                  <Icon name={SUBJECT_ICON[subject.key] || 'book'} size={20} />
                </span>
                <span className="sd-subject-row__body">
                  <span className="sd-subject-row__head">
                    <span className="sd-subject-row__name" dir="auto">{subject.name}</span>
                    <span className={`sd-subject-row__chip is-${subject.levelKey || 'starting'}`}>
                      {t(`sdash.subjects.level.${subject.levelKey || 'starting'}`)}
                    </span>
                  </span>
                  {/* The chip is the spoken reading of this bar, so the bar
                      itself stays decorative rather than saying it twice. */}
                  <span className="sd-subject-row__bar" aria-hidden="true">
                    <span style={{ inlineSize: `${subject.progress}%`, backgroundImage: subject.gradient }} />
                  </span>
                </span>
                <Icon className="sd-subject-row__go" name="chevronLeft" size={18} />
              </button>
            </li>
          ))}
        </ul>

        <div className="sd-subjects__objectives" id="sd-subjects-objectives">
          {!active ? (
            <div className="sd-subjects__prompt">
              <Icon name="library" size={26} />
              <p>{t('sdash.subjects.pick')}</p>
            </div>
          ) : (
            <>
              <div className="sd-subjects__objectives-head">
                <button
                  type="button"
                  className="sd-subjects__back"
                  onClick={() => setSelected(null)}
                >
                  <Icon name="chevronLeft" size={16} />
                  <span>{t('sdash.subjects.back')}</span>
                </button>
                <h3 dir="auto">{t('sdash.subjects.objectives', { subject: active.name })}</h3>
              </div>
              {objectives.length === 0 ? (
                <p className="sd-subjects__empty">{t('sdash.subjects.emptySubject')}</p>
              ) : (
                <ul className="sd-subjects__objective-list">
                  {objectives.map((objective) => (
                    <li key={objective.id} className={`sd-objective is-${objective.state}`}>
                      <span className="sd-objective__art" aria-hidden="true">
                        {objective.illustration ? (
                          <img
                            src={reducedMotion ? objective.illustration.staticUrl : objective.illustration.url}
                            alt=""
                            loading="lazy"
                          />
                        ) : (
                          <Icon name={SUBJECT_ICON[active.key] || 'book'} size={22} />
                        )}
                      </span>
                      <span className="sd-objective__body">
                        <span className="sd-objective__title" dir="auto">{objective.title}</span>
                        <span
                          className="sd-objective__bar"
                          role="img"
                          aria-label={t(`sdash.subjects.status.${objective.state}`)}
                        >
                          <span style={{ inlineSize: `${objective.percent}%` }} />
                        </span>
                        <span className="sd-objective__task" dir="auto">
                          {objective.task
                            ? t('sdash.subjects.currentTask', { task: objective.task })
                            : t(`sdash.subjects.status.${objective.state}`)}
                        </span>
                      </span>
                      {objective.needsReview && (
                        <span className="sd-objective__review">
                          <Icon name="reflect" size={13} />
                          <span>{t('sdash.subjects.needsReview')}</span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
