import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import type {
  LearningComponentDTO,
  LearningSubject,
  LearningUnitDTO,
} from '../../services/learning'
import { horizon } from '../learning/pathView'
import './simple-track.css'

export type TrackState = 'completed' | 'in_progress' | 'not_started'

export interface TrackLesson {
  /** Stable across a repair round — `id` repeats when a component is revisited. */
  nodeId: string
  component: LearningComponentDTO
  unit: LearningUnitDTO
  /** Server-owned ordinal (`path_index`), never derived from array position. */
  ordinal: number | null
}

interface TrackUnit {
  unit: LearningUnitDTO
  lessons: TrackLesson[]
  hasHorizon: boolean
  state: TrackState
}

interface TrackTopic {
  key: string
  title: string
  units: TrackUnit[]
  lessonCount: number
  state: TrackState
  /** Server-owned step counters, summed over the goal's units. */
  progressPercent: number
}

interface TrackSummary {
  topics: TrackTopic[]
  resume: TrackLesson | null
}

function unitState(unit: LearningUnitDTO): TrackState {
  if (unit.unit_state === 'completed') return 'completed'
  if (unit.unit_state === 'in_progress' || (unit.steps_completed ?? 0) > 0) return 'in_progress'
  return 'not_started'
}

function rollUp(states: TrackState[]): TrackState {
  if (states.length > 0 && states.every((state) => state === 'completed')) return 'completed'
  if (states.some((state) => state !== 'not_started')) return 'in_progress'
  return 'not_started'
}

function purposeKey(component: LearningComponentDTO) {
  if (component.is_assessment) return 'learning.component.assessment'
  if (component.purpose === 'instruction') return 'learning.component.instruction'
  if (component.purpose === 'practice') return 'learning.component.practice'
  return 'learning.component.activity'
}

/**
 * Everything the plain view renders, derived once from the catalog.
 *
 * Nothing here invents a number: steps, ratios and states all come from the
 * server's path decision (Brain/xAPI), and the route is cut at `horizon` so the
 * view never promises a station that could still be taken back.
 */
function buildTrack(units: LearningUnitDTO[]): TrackSummary {
  const grouped = new Map<string, TrackUnit[]>()
  const titles = new Map<string, string>()

  units.forEach((unit) => {
    const title = unit.sub_topic_title || unit.topic_title || unit.sub_topic || unit.title
    const key = unit.sub_topic || title
    const { nodes, hasHorizon } = horizon(unit)
    const entry: TrackUnit = {
      unit,
      hasHorizon,
      state: unitState(unit),
      lessons: nodes.map((component) => ({
        nodeId: component.path_node_id,
        component,
        unit,
        ordinal: component.path_index == null ? null : component.path_index + 1,
      })),
    }
    titles.set(key, title)
    grouped.set(key, [...(grouped.get(key) ?? []), entry])
  })

  const topics: TrackTopic[] = [...grouped.entries()].map(([key, trackUnits]) => {
    const done = trackUnits.reduce((sum, entry) => sum + (entry.unit.steps_completed ?? 0), 0)
    const total = trackUnits.reduce((sum, entry) => sum + (entry.unit.steps_total ?? 0), 0)
    return {
      key,
      title: titles.get(key) ?? key,
      units: trackUnits,
      lessonCount: trackUnits.reduce((sum, entry) => sum + entry.lessons.length, 0),
      state: rollUp(trackUnits.map((entry) => entry.state)),
      progressPercent: total > 0 ? Math.round((done / total) * 100) : 0,
    }
  })

  const resumeUnit = units.find((unit) => unit.components.some((component) => component.progress_state === 'current'))
    ?? units.find((unit) => unit.next_path_node_id)
    ?? units.find((unit) => unit.unit_state !== 'completed')
    ?? null

  let resume: TrackLesson | null = null
  if (resumeUnit) {
    const entry = topics
      .flatMap((topic) => topic.units)
      .find((candidate) => candidate.unit.id === resumeUnit.id)
    resume = entry?.lessons.find((lesson) => lesson.component.progress_state === 'current')
      ?? entry?.lessons.find((lesson) => lesson.component.path_node_id === resumeUnit.next_path_node_id)
      ?? entry?.lessons.find((lesson) => lesson.component.progress_state === 'available')
      ?? null
  }

  return { topics, resume }
}

interface SimpleTrackViewProps {
  subject: LearningSubject
  units: LearningUnitDTO[]
  onOpenLesson: (lesson: TrackLesson) => void
}

/**
 * 720 F1 — the plain track view (Reut: "גם לאלה שלא רוצים משחקים ועניינים").
 * Same route, same stations, no 3D. Two screens, never both at once: the goal
 * cards, then the lessons of the one goal the learner picked. Children get one
 * decision per screen instead of the whole curriculum at once.
 */
export function SimpleTrackView({ subject, units, onOpenLesson }: SimpleTrackViewProps) {
  const { t, language } = useI18n()
  const track = useMemo(() => buildTrack(units), [units])
  const [openGoal, setOpenGoal] = useState<string | null>(null)

  useEffect(() => {
    setOpenGoal(null)
  }, [subject])

  const goal = track.topics.find((topic) => topic.key === openGoal) ?? null

  if (goal) {
    return (
      <div className="lt-track" data-track-subject={subject} data-track-goal={goal.key}>
        <header className="lt-head lt-head--goal">
          <button className="lt-back" type="button" onClick={() => setOpenGoal(null)}>
            <Icon name="chevronLeft" size={16} />
            {t('learning.track.back')}
          </button>
          <h1 dir="auto">{goal.title}</h1>
          <p>
            <span className="lt-chip">{t(`learning.track.topicState.${goal.state}`)}</span>
            {t('learning.track.topic.lessons', { count: goal.lessonCount })}
          </p>
        </header>

        {goal.units.map((entry) => (
          <section className="lt-unit" key={entry.unit.id}>
            {goal.units.length > 1 && <h2 dir="auto">{entry.unit.title}</h2>}
            <ol className="lt-lessons">
              {entry.lessons.map((lesson) => {
                const state = lesson.component.progress_state
                const locked = state === 'locked'
                return (
                  <li key={lesson.nodeId}>
                    <button
                      className={`lt-lesson is-${state}`}
                      type="button"
                      disabled={locked}
                      onClick={() => onOpenLesson(lesson)}
                    >
                      <span className="lt-lesson__index" aria-hidden="true">
                        {locked ? <Icon name="lock" size={14} /> : state === 'completed' ? <Icon name="check" size={14} /> : lesson.ordinal ?? '·'}
                      </span>
                      <span className="lt-lesson__copy">
                        <b dir="auto">{lesson.component.title}</b>
                        <small>{t(purposeKey(lesson.component))}</small>
                      </span>
                      <span className="lt-lesson__meta">
                        {lesson.component.estimated_minutes != null && (
                          <span>{t('learning.component.minutes', { minutes: lesson.component.estimated_minutes })}</span>
                        )}
                        <span className="lt-chip">{t(`learning.roadmap.state.${state}`)}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
            {entry.hasHorizon && (
              <p className="lt-horizon">
                <Icon name="compass" size={14} />
                {t('learning.track.horizon')}
              </p>
            )}
          </section>
        ))}
      </div>
    )
  }

  return (
    <div className="lt-track" data-track-subject={subject}>
      <header className="lt-head">
        <h1 id="learning-track-title">{t(`learning.subject.${subject}`)}</h1>
        <p>{t(`learning.track.subtitle.${subject}`)}</p>
      </header>

      {track.resume ? (
        <section className="lt-resume" aria-labelledby="learning-track-resume-title">
          <div className="lt-resume__copy">
            <span className="lt-resume__eyebrow">
              <Icon name="play" size={14} />
              {t('learning.track.resume.eyebrow')}
            </span>
            <h2 id="learning-track-resume-title" dir="auto">
              {track.resume.ordinal
                ? t('learning.track.resume.title', { index: track.resume.ordinal, title: track.resume.component.title })
                : track.resume.component.title}
            </h2>
            <div className="lt-resume__meta">
              {track.resume.component.estimated_minutes != null && (
                <span><Icon name="clock" size={14} />{t('learning.component.minutes', { minutes: track.resume.component.estimated_minutes })}</span>
              )}
              {!track.resume.component.languages.includes(language) && (
                <span className="lt-resume__note">{t('learning.language.fallback')}</span>
              )}
            </div>
          </div>
          <button
            className="lt-primary"
            type="button"
            onClick={() => track.resume && onOpenLesson(track.resume)}
          >
            <Icon name="play" size={18} />
            {t('learning.track.resume.action')}
          </button>
        </section>
      ) : (
        <section className="lt-resume lt-resume--done" role="status">
          <div className="lt-resume__copy">
            <span className="lt-resume__eyebrow"><Icon name="spark" size={14} />{t('learning.track.resume.doneEyebrow')}</span>
            <h2 dir="auto">{t('learning.track.resume.doneTitle')}</h2>
            <p>{t('learning.track.resume.doneBody')}</p>
          </div>
        </section>
      )}

      <section className="lt-goals" aria-labelledby="learning-track-goals-title">
        <div className="lt-goals__head">
          <h2 id="learning-track-goals-title">{t('learning.track.topics.title')}</h2>
          <p>{t('learning.track.topics.body')}</p>
        </div>

        <ul className="lt-goals__grid">
          {track.topics.map((topic) => (
            <li key={topic.key}>
              <button
                className={`lt-goal is-${topic.state}`}
                type="button"
                onClick={() => setOpenGoal(topic.key)}
              >
                <span className="lt-goal__state" aria-hidden="true">
                  <Icon name={topic.state === 'completed' ? 'check' : topic.state === 'in_progress' ? 'pulse' : 'target'} size={20} />
                </span>
                <span className="lt-goal__title" dir="auto">{topic.title}</span>
                <span className="lt-goal__meta">
                  <span className="lt-chip">{t(`learning.track.topicState.${topic.state}`)}</span>
                  <span>{t('learning.track.topic.lessons', { count: topic.lessonCount })}</span>
                </span>
                <span
                  className="lt-meter"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={topic.progressPercent}
                  aria-label={t('learning.track.kpi.progress')}
                >
                  <span style={{ '--lt-fill': `${topic.progressPercent}%` } as CSSProperties} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
