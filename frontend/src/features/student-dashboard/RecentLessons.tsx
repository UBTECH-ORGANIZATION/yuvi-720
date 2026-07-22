import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { useMediaQuery } from '../../hooks/useResponsive'
import type {
  LearningComponentDTO,
  LearningUnitDTO,
} from '../../services/learning'
import { LessonGlyph, pickGlyphVariant } from './LessonGlyph'

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
  progress: number
  target: LearningComponentDTO | null
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
  const components = unit.components ?? []
  const total = components.length
  const completed = components.filter((c) => c.progress_state === 'completed').length
  const current = components.find((c) => c.progress_state === 'current') ?? null
  const nextAvailable = components.find((c) => c.progress_state === 'available') ?? null

  let status: LessonStatus
  if (current) status = 'active'
  else if (total > 0 && completed === total) status = 'completed'
  else if (completed > 0) status = 'inProgress'
  else status = 'notStarted'

  return {
    unit,
    status,
    completed,
    total,
    progress: total > 0 ? Math.round((completed / total) * 100) : 0,
    target: current ?? nextAvailable ?? components[0] ?? null,
  }
}

export function RecentLessons({
  units,
  onOpenLearning,
  onOpenComponent,
}: RecentLessonsProps) {
  const { t } = useI18n()
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [revealed, setRevealed] = useState(false)
  const trackRef = useRef<HTMLUListElement>(null)
  const [scrollState, setScrollState] = useState({ canPrev: false, canNext: false })

  const [subjectFilter, setSubjectFilter] = useState<string | null>(null)

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

  const lessons = useMemo(() => {
    if (!subjectFilter || !subjects.includes(subjectFilter)) return allLessons
    return allLessons.filter((lesson) => lesson.unit.subject === subjectFilter)
  }, [allLessons, subjectFilter, subjects])

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
            onClick={() => setSubjectFilter(null)}
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
              onClick={() => setSubjectFilter(subject)}
            >
              {t(`learning.subject.${subject}`)}
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
          <button
            className="sd-carousel-nav sd-carousel-nav--prev"
            type="button"
            onClick={() => scrollByDirection('prev')}
            disabled={!scrollState.canPrev}
            aria-label={t('sdash.lessons.prev')}
          >
            <Icon name="arrow" size={20} />
          </button>

          <ul ref={trackRef} className={`sd-lesson-track${revealed ? ' is-revealed' : ''}`}>
            {lessons.map((lesson, index) => {
              const tone = PALETTE[index % PALETTE.length]
              const isPrimary = lesson.unit.id === primaryUnitId
              const glyphVariant = pickGlyphVariant(
                lesson.unit.title,
                lesson.unit.sub_topic,
                lesson.unit.subject,
              )
              return (
                <li
                  key={lesson.unit.id}
                  className={`sd-lesson-card sd-lesson-card--${tone} is-${lesson.status}${isPrimary ? ' is-primary' : ''}`}
                  style={{ '--sd-lesson-index': index } as CSSProperties}
                >
                  <div className="sd-lesson-card__media" aria-hidden="true">
                    <LessonGlyph variant={glyphVariant} />
                    <span className={`sd-lesson-card__badge sd-lesson-card__badge--${lesson.status}`}>
                      <Icon name={STATUS_ICON[lesson.status]} size={12} />
                    </span>
                  </div>

                  <div className="sd-lesson-card__body">
                    <span className="sd-lesson-card__subject" dir="auto">
                      {t(`learning.subject.${lesson.unit.subject}`)}
                    </span>
                    <h3 className="sd-lesson-card__title" dir="auto">{lesson.unit.title}</h3>
                    <div
                      className="sd-lesson-card__track-row"
                      role="img"
                      aria-label={t('sdash.lessons.progress', { completed: lesson.completed, total: lesson.total })}
                    >
                      <div className="sd-lesson-card__bar">
                        <span style={{ inlineSize: revealed ? `${lesson.progress}%` : 0 }} />
                      </div>
                      <span className="sd-lesson-card__steps">
                        <strong>{lesson.progress}%</strong>
                        {' · '}
                        {t('sdash.lessons.progress', { completed: lesson.completed, total: lesson.total })}
                      </span>
                    </div>
                  </div>

                  <button
                    className="sd-lesson-card__cta"
                    type="button"
                    disabled={!lesson.target}
                    onClick={() => lesson.target && onOpenComponent(lesson.unit, lesson.target)}
                  >
                    <span>{t(`sdash.lessons.cta.${CTA_BY_STATUS[lesson.status]}`)}</span>
                    <Icon name="arrow" size={15} />
                  </button>
                </li>
              )
            })}
          </ul>

          <button
            className="sd-carousel-nav sd-carousel-nav--next"
            type="button"
            onClick={() => scrollByDirection('next')}
            disabled={!scrollState.canNext}
            aria-label={t('sdash.lessons.next')}
          >
            <Icon name="arrow" size={20} />
          </button>
        </div>
      )}
    </section>
  )
}
