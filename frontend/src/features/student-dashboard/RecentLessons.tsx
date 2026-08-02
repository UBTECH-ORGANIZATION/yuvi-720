import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { lessonCardView, onPathNodes } from '../learning/pathView'
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
  const trackRef = useRef<HTMLUListElement>(null)
  const [scrollState, setScrollState] = useState({ canPrev: false, canNext: false })

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

  const syncScrollState = () => {
    const el = trackRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    const current = Math.abs(el.scrollLeft)
    setScrollState({ canPrev: current > 4, canNext: max > 4 && current < max - 4 })
  }

  useLayoutEffect(syncScrollState, [lessons])
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    el.addEventListener('scroll', syncScrollState, { passive: true })
    window.addEventListener('resize', syncScrollState)
    return () => {
      el.removeEventListener('scroll', syncScrollState)
      window.removeEventListener('resize', syncScrollState)
    }
  }, [lessons])

  const scrollByDirection = (direction: 'prev' | 'next') => {
    const el = trackRef.current
    if (!el) return
    const isRtl = getComputedStyle(el).direction === 'rtl'
    const card = el.querySelector<HTMLElement>('.sd-lesson-card')
    const step = (card?.offsetWidth ?? el.clientWidth * 0.8) + 18
    const towardEnd = direction === 'next'
    const sign = (isRtl ? -1 : 1) * (towardEnd ? 1 : -1)
    el.scrollBy({ left: sign * step, behavior: prefersReducedMotion ? 'auto' : 'smooth' })
  }

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
          <ul ref={trackRef} className={`sd-lesson-track${revealed ? ' is-revealed' : ''}`}>
            {lessons.map((lesson, index) => {
              const tone = PALETTE[index % PALETTE.length]
              const isPrimary = lesson.unit.id === primaryUnitId
              // Every signal the catalog carries, so the picture is a reading
              // of the lesson rather than one illustration per subject.
              const glyphVariant = glyphForUnit(lesson.unit)
              return (
                <li
                  key={lesson.unit.id}
                  className={`sd-lesson-card sd-lesson-card--${tone} is-${lesson.status}${isPrimary ? ' is-primary' : ''}`}
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
                    <span className={`sd-lesson-card__badge sd-lesson-card__badge--${lesson.status}`}>
                      <Icon name={STATUS_ICON[lesson.status]} size={12} />
                    </span>
                  </div>

                  <div className="sd-lesson-card__body">
                    <h3 className="sd-lesson-card__title" dir="auto">{lesson.unit.title}</h3>
                    {/* The ministry's own name for the sub-topic this belongs to
                        ("מסה ונפח של גופים"), from the goal registry — not a
                        dotted key run through a hand-written label table. */}
                    {(lesson.unit.sub_topic_title || lesson.unit.sub_topic) && (
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

                  {/* The CTA and the way to the neighbouring lessons in one row:
                      the carousel arrows used to float over the edge of the rail,
                      half off-card, and on a narrow screen they covered the card
                      they were meant to move. */}
                  <div className="sd-lesson-card__foot">
                    {isPrimary && (
                      <button
                        className="sd-lesson-card__step"
                        type="button"
                        onClick={() => scrollByDirection('prev')}
                        disabled={!scrollState.canPrev}
                        aria-label={t('sdash.lessons.prev')}
                      >
                        <Icon name="chevronLeft" size={16} />
                      </button>
                    )}
                    <button
                      className={`sd-lesson-card__cta sd-lesson-card__cta--${lesson.status}`}
                      type="button"
                      disabled={!lesson.target}
                      onClick={() => lesson.target && onOpenComponent(lesson.unit, lesson.target)}
                    >
                      <span>{t(`sdash.lessons.cta.${CTA_BY_STATUS[lesson.status]}`)}</span>
                      <Icon name={lesson.status === 'completed' ? 'reflect' : 'arrow'} size={lesson.status === 'completed' ? 13 : 15} />
                    </button>
                    {isPrimary && (
                      <button
                        className="sd-lesson-card__step sd-lesson-card__step--next"
                        type="button"
                        onClick={() => scrollByDirection('next')}
                        disabled={!scrollState.canNext}
                        aria-label={t('sdash.lessons.next')}
                      >
                        <Icon name="chevronLeft" size={16} />
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
