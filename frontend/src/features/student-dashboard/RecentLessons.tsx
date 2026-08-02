import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { lessonCardView, onPathNodes, stationPeek } from '../learning/pathView'
import { useMediaQuery } from '../../hooks/useResponsive'
import type {
  LearningComponentDTO,
  LearningUnitDTO,
} from '../../services/learning'
import { LessonGlyph, glyphForUnit } from './LessonGlyph'
import { subTopicLabel } from './subjectLabels'

interface RecentLessonsProps {
  units: LearningUnitDTO[]
  onOpenLearning: () => void
  onOpenComponent: (unit: LearningUnitDTO, component: LearningComponentDTO) => void
}

type LessonStatus = 'active' | 'inProgress' | 'completed' | 'notStarted'

/** Which station of the primary lesson the card is showing. The arrows move
 *  along the learner's own route — back to something they actually did, forward
 *  to the one step ahead — rather than scrolling the rail sideways. */
type PeekSlot = 'prev' | 'current' | 'next'

interface LessonView {
  unit: LearningUnitDTO
  status: LessonStatus
  completed: number
  total: number
  /** 0…1 from the server, for THIS learner's path. Never rendered as a number. */
  progress: number
  target: LearningComponentDTO | null
  /** Estimated minutes left across the steps still ahead on the path, or null. */
  minutesLeft: number | null
}

/** Read the monotone ceiling the trail component keeps, so the card's own bar
 *  cannot retract when an adaptive path grows a step under the learner. */
function shownRatio(lesson: LessonView): number {
  try {
    const ceilings = JSON.parse(sessionStorage.getItem('yuvilab:progress-ceiling') || '{}')
    return Math.max(Number(ceilings[lesson.unit.id] ?? 0), lesson.progress)
  } catch {
    return lesson.progress
  }
}

const STATUS_RANK: Record<LessonStatus, number> = {
  active: 0,
  inProgress: 1,
  completed: 2,
  notStarted: 3,
}

const CTA_BY_STATUS: Record<LessonStatus, string> = {
  active: 'resume',
  inProgress: 'continue',
  completed: 'review',
  notStarted: 'start',
}

const STATUS_ICON: Record<LessonStatus, string> = {
  active: 'play',
  inProgress: 'clock',
  completed: 'check',
  notStarted: 'play',
}

/** Distinct accent per card position so the row feels lively (mockup colours). */
const PALETTE = ['violet', 'sky', 'emerald', 'amber', 'rose', 'teal'] as const

function buildLessonView(unit: LearningUnitDTO): LessonView {
  // Every count comes from the server's plan for THIS learner. Deriving them
  // from `components.length` counted skipped optionals and non-chosen
  // equivalents, and missed a repair round entirely — so the card could promise
  // five steps to someone walking six.
  const view = lessonCardView(unit)
  return {
    unit,
    status: view.status,
    completed: unit.steps_completed ?? 0,
    total: unit.steps_total ?? onPathNodes(unit).length,
    progress: view.progress,
    target: view.target,
    minutesLeft: view.minutesLeft,
  }
}

/** Screen-reader label describing where the learner stands.
 *
 *  No ordinal and no denominator: the total moves as the path adapts, and §3.4
 *  keeps numeric measurement off the learner's screen. What is left is the thing
 *  that is actually stable — how much is still ahead. */
function progressAriaLabel(
  lesson: LessonView,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  switch (lesson.status) {
    case 'completed':
      return t('sdash.lessons.status.completed')
    case 'active':
      return t('sdash.lessons.resumeHere')
    case 'inProgress':
      return t('sdash.lessons.onTheWay')
    default: {
      if (lesson.minutesLeft != null && lesson.minutesLeft > 0) {
        return t('sdash.lessons.approxMinutes', { count: lesson.minutesLeft })
      }
      return t('sdash.lessons.status.notStarted')
    }
  }
}

export function RecentLessons({
  units,
  onOpenLearning,
  onOpenComponent,
}: RecentLessonsProps) {
  const { t, language } = useI18n()
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [revealed, setRevealed] = useState(false)
  const [peek, setPeek] = useState<PeekSlot>('current')

  const [subjectFilter, setSubjectFilter] = useState<string | null>(null)
  const [subTopicFilter, setSubTopicFilter] = useState<string | null>(null)

  const allLessons = useMemo(() => {
    return units
      .map(buildLessonView)
      .filter((lesson) => lesson.total > 0)
      .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status])
      .slice(0, 12)
  }, [units])

  // Subject tabs so math / science lessons are not interleaved in one row.
  const subjects = useMemo(() => {
    const seen: string[] = []
    for (const lesson of allLessons) {
      if (!seen.includes(lesson.unit.subject)) seen.push(lesson.unit.subject)
    }
    return seen
  }, [allLessons])

  // Lessons for the selected subject (before the sub-topic sub-filter).
  const subjectLessons = useMemo(() => {
    if (!subjectFilter || !subjects.includes(subjectFilter)) return allLessons
    return allLessons.filter((lesson) => lesson.unit.subject === subjectFilter)
  }, [allLessons, subjectFilter, subjects])

  // Sub-subjects (dotted sub-topic keys) present within the selected subject —
  // the second navigation tier the learner drills into.
  const subTopics = useMemo(() => {
    const seen: string[] = []
    for (const lesson of subjectLessons) {
      const key = lesson.unit.sub_topic
      if (key && !seen.includes(key)) seen.push(key)
    }
    return seen
  }, [subjectLessons])

  // Reset the sub-topic drill-down whenever the subject changes or it no longer
  // applies (e.g. switched back to "all").
  useEffect(() => {
    if (subTopicFilter && !subTopics.includes(subTopicFilter)) setSubTopicFilter(null)
  }, [subTopics, subTopicFilter])

  const lessons = useMemo(() => {
    if (!subTopicFilter) return subjectLessons
    return subjectLessons.filter((lesson) => lesson.unit.sub_topic === subTopicFilter)
  }, [subjectLessons, subTopicFilter])

  const primaryUnitId = useMemo(() => {
    const primary = lessons.find((lesson) => lesson.status === 'active')
      ?? lessons.find((lesson) => lesson.status === 'inProgress')
      ?? lessons[0]
    return primary?.unit.id ?? null
  }, [lessons])

  useEffect(() => {
    if (prefersReducedMotion) {
      setRevealed(true)
      return
    }
    setRevealed(false)
    const frame = window.requestAnimationFrame(() => setRevealed(true))
    return () => window.cancelAnimationFrame(frame)
  }, [prefersReducedMotion, lessons])

  // Looking around the route is a peek, not a move: whenever the recommendation
  // itself changes, the card snaps back to where the learner actually stands.
  useEffect(() => { setPeek('current') }, [primaryUnitId])

  return (
    <section className="sd-section sd-lessons" aria-labelledby="sd-lessons-title">
      <div className="sd-section__heading">
        <div>
          <span className="sd-section__kicker">{t('sdash.lessons.kicker')}</span>
          <h2 id="sd-lessons-title">{t('sdash.lessons.title')}</h2>
          <p>{t('sdash.lessons.subtitle')}</p>
        </div>
        <button className="sd-text-action" type="button" onClick={onOpenLearning}>
          <span>{t('sdash.lessons.all')}</span>
          <Icon name="arrow" size={16} />
        </button>
      </div>

      {subjects.length > 1 && (
        <div className="sd-lessons__filters" role="tablist" aria-label={t('sdash.lessons.filter')}>
          <button
            type="button"
            role="tab"
            aria-selected={subjectFilter === null}
            className={`sd-lessons__filter${subjectFilter === null ? ' is-active' : ''}`}
            onClick={() => { setSubjectFilter(null); setSubTopicFilter(null) }}
          >
            {t('sdash.lessons.filter.all')}
          </button>
          {subjects.map((subject) => (
            <button
              key={subject}
              type="button"
              role="tab"
              aria-selected={subjectFilter === subject}
              className={`sd-lessons__filter${subjectFilter === subject ? ' is-active' : ''}`}
              onClick={() => { setSubjectFilter(subject); setSubTopicFilter(null) }}
            >
              {t(`learning.subject.${subject}`)}
            </button>
          ))}
        </div>
      )}

      {subTopics.length > 1 && (
        <div className="sd-lessons__subfilters" role="tablist" aria-label={t('sdash.lessons.subFilter')}>
          <button
            type="button"
            role="tab"
            aria-selected={subTopicFilter === null}
            className={`sd-lessons__subfilter${subTopicFilter === null ? ' is-active' : ''}`}
            onClick={() => setSubTopicFilter(null)}
          >
            {t('sdash.lessons.filter.all')}
          </button>
          {subTopics.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={subTopicFilter === key}
              className={`sd-lessons__subfilter${subTopicFilter === key ? ' is-active' : ''}`}
              onClick={() => setSubTopicFilter(key)}
              dir="auto"
            >
              {subTopicLabel(key, language)}
            </button>
          ))}
        </div>
      )}

      {lessons.length === 0 ? (
        <div className="sd-lessons-empty">
          <p>{t('sdash.lessons.empty')}</p>
          <button className="sd-button sd-button--primary" type="button" onClick={onOpenLearning}>
            <span>{t('sdash.lessons.all')}</span>
            <Icon name="arrow" size={16} />
          </button>
        </div>
      ) : (
        <div className="sd-lessons__carousel">
          <ul className={`sd-lesson-track${revealed ? ' is-revealed' : ''}`}>
            {lessons.map((lesson, index) => {
              const tone = PALETTE[index % PALETTE.length]
              const isPrimary = lesson.unit.id === primaryUnitId
              // Every signal the catalog carries, so the picture is a reading
              // of the lesson rather than one illustration per subject.
              const glyphVariant = glyphForUnit(lesson.unit)

              // The route around the current step, for the arrows. Only the
              // primary card offers it — it is the one lesson the learner is
              // actually standing in.
              const stations = isPrimary ? stationPeek(lesson.unit) : null
              const focus = stations && peek === 'prev' ? stations.previous
                : stations && peek === 'next' ? stations.next
                : null
              // A refresh can settle the route while the learner is peeking (the
              // station behind them stops being the station behind them). Falling
              // back to `current` keeps the card from offering a CTA for a
              // station it is no longer showing.
              const slot: PeekSlot = focus ? peek : 'current'
              const canGoBack = !!stations && (slot === 'next' || (slot === 'current' && !!stations.previous))
              const canGoForward = !!stations && (slot === 'prev' || (slot === 'current' && !!stations.next))
              const ctaTarget = slot === 'prev' ? focus : lesson.target
              return (
                <li
                  key={lesson.unit.id}
                  className={`sd-lesson-card sd-lesson-card--${tone} is-${lesson.status}${isPrimary ? ' is-primary' : ''}${focus ? ` is-peeking is-peeking-${slot}` : ''}`}
                  style={{ '--sd-lesson-index': index } as CSSProperties}
                >
                  {/* The subject, as a chip — and as a filter. It replaces a
                      "recommended" ribbon that said the same thing the card's
                      own prominence already says. */}
                  <button
                    type="button"
                    className={`sd-lesson-card__subject-chip sd-subject--${lesson.unit.subject}${
                      subjectFilter === lesson.unit.subject ? ' is-active' : ''}`}
                    onClick={() => setSubjectFilter(
                      subjectFilter === lesson.unit.subject ? null : lesson.unit.subject,
                    )}
                    aria-pressed={subjectFilter === lesson.unit.subject}
                  >
                    {t(`learning.subject.${lesson.unit.subject}`)}
                  </button>
                  <div className="sd-lesson-card__media" aria-hidden="true">
                    <LessonGlyph variant={glyphVariant} />
                    {focus ? (
                      // A station they got through wears a check; one they
                      // stumbled on wears the redo mark, not a tick it never
                      // earned. Ahead of them: a lock, because it is one.
                      <span className={`sd-lesson-card__peek-mark sd-lesson-card__peek-mark--${
                        slot === 'next' ? 'next' : focus.outcome === 'failed' ? 'redo' : 'prev'}`}>
                        <Icon
                          name={slot === 'next' ? 'lock' : focus.outcome === 'failed' ? 'reflect' : 'check'}
                          size={15}
                        />
                      </span>
                    ) : (
                      <span className={`sd-lesson-card__badge sd-lesson-card__badge--${lesson.status}`}>
                        <Icon name={STATUS_ICON[lesson.status]} size={12} />
                      </span>
                    )}
                  </div>

                  <div className="sd-lesson-card__body">
                    {/* Peeking swaps the card onto one station of the route: the
                        title becomes that station's, and the lesson it belongs
                        to drops to the line beneath — so a kid looking around
                        never loses which lesson they are in. */}
                    {focus && (
                      <span className="sd-lesson-card__peek-kicker">
                        {t(`sdash.lessons.peek.${slot}`)}
                      </span>
                    )}
                    <h3 className="sd-lesson-card__title" dir="auto">
                      {focus ? focus.title : lesson.unit.title}
                    </h3>
                    {/* The ministry's own name for the sub-topic this belongs to
                        ("מסה ונפח של גופים"), from the goal registry — not a
                        dotted key run through a hand-written label table. */}
                    {focus ? (
                      <p className="sd-lesson-card__subtopic" dir="auto">{lesson.unit.title}</p>
                    ) : (lesson.unit.sub_topic_title || lesson.unit.sub_topic) && (
                      <p className="sd-lesson-card__subtopic" dir="auto">
                        {lesson.unit.sub_topic_title
                          || subTopicLabel(lesson.unit.sub_topic, language)}
                      </p>
                    )}
                    <div
                      className="sd-lesson-card__track-row"
                      role="img"
                      aria-label={progressAriaLabel(lesson, t)}
                    >
                      {lesson.status !== 'notStarted' && (
                        <div className="sd-lesson-card__bar">
                          <span style={{ inlineSize: revealed ? `${Math.round(shownRatio(lesson) * 100)}%` : 0 }} />
                        </div>
                      )}
                    </div>

                  </div>

                  {/* One action, and it always says what tapping it does: resume
                      the current station, go back to one already walked, or —
                      on the step ahead — nothing at all, because it is locked
                      until this one is finished. */}
                  <div className="sd-lesson-card__foot">
                    {slot === 'next' && focus ? (
                      <button
                        className="sd-lesson-card__cta sd-lesson-card__cta--locked"
                        type="button"
                        disabled
                      >
                        <Icon name="lock" size={14} />
                        <span>{t('sdash.lessons.peek.locked')}</span>
                      </button>
                    ) : (
                      <button
                        className={`sd-lesson-card__cta sd-lesson-card__cta--${slot === 'prev' ? 'completed' : lesson.status}`}
                        type="button"
                        disabled={!ctaTarget}
                        onClick={() => ctaTarget && onOpenComponent(lesson.unit, ctaTarget)}
                      >
                        <span>
                          {slot === 'prev'
                            ? t('sdash.lessons.peek.revisit')
                            : t(`sdash.lessons.cta.${CTA_BY_STATUS[lesson.status]}`)}
                        </span>
                        <Icon
                          name={slot === 'prev' || lesson.status === 'completed' ? 'reflect' : 'arrow'}
                          size={slot === 'prev' || lesson.status === 'completed' ? 13 : 15}
                        />
                      </button>
                    )}
                  </div>

                  {/* The route, on the card's own edges: back to what the kid
                      already did, forward to the one step ahead. They move
                      along THIS lesson — the rail itself scrolls on its own. */}
                  {isPrimary && (
                    <>
                      <button
                        className="sd-lesson-card__step"
                        type="button"
                        onClick={() => setPeek(slot === 'next' ? 'current' : 'prev')}
                        disabled={!canGoBack}
                        aria-label={t('sdash.lessons.peek.back')}
                      >
                        <Icon name="chevronLeft" size={17} />
                      </button>
                      <button
                        className="sd-lesson-card__step sd-lesson-card__step--next"
                        type="button"
                        onClick={() => setPeek(slot === 'prev' ? 'current' : 'next')}
                        disabled={!canGoForward}
                        aria-label={t('sdash.lessons.peek.forward')}
                      >
                        <Icon name="chevronLeft" size={17} />
                      </button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
