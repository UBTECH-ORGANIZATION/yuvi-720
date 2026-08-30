import { useCallback, useEffect, useMemo, useState } from 'react'
import { navigate } from '../../app/router'
import { LearnerAppBar } from '../../components/LearnerAppBar'
import { ErrorState, Icon, LoadingState } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { useBrain } from '../../providers/BrainProvider'
import {
  getLearningCatalog,
  type LearningSubject,
  type LearningUnitDTO,
} from '../../services/learning'
import { SimpleTrackView, type TrackLesson } from './SimpleTrackView'
import './learning-portal.css'

const SUBJECT_ORDER: LearningSubject[] = ['math', 'science', 'other']

function firstSubject(units: LearningUnitDTO[]): LearningSubject | null {
  const current = units.find((unit) => unit.components.some((component) => component.progress_state === 'current'))
  if (current) return current.subject
  const available = units.find((unit) => unit.components.some((component) => component.progress_state === 'available'))
  if (available) return available.subject
  return SUBJECT_ORDER.find((subject) => units.some((unit) => unit.subject === subject)) ?? null
}

/**
 * 720 F1 learning track. The 3D world is deliberately not mounted here (board
 * item 460): every learner gets the plain track view, which is the same route
 * and the same stations at a fraction of the load. Provider order remains the
 * curriculum authority and every progress state is projected from Brain/xAPI by
 * the backend.
 */
export function LearningPortalPage() {
  const { t } = useI18n()
  const { learnerId } = useBrain()
  const [units, setUnits] = useState<LearningUnitDTO[]>([])
  const [selectedSubject, setSelectedSubject] = useState<LearningSubject | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoading(true)
    setError(false)
    getLearningCatalog(controller.signal)
      .then((catalog) => {
        if (!active) return
        setUnits(catalog.units)
        setSelectedSubject((current) => (
          current && catalog.units.some((unit) => unit.subject === current)
            ? current
            : firstSubject(catalog.units)
        ))
      })
      .catch(() => {
        if (active && !controller.signal.aborted) setError(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [learnerId, reloadKey])

  const availableSubjects = useMemo(
    () => SUBJECT_ORDER.filter((subject) => units.some((unit) => unit.subject === subject)),
    [units],
  )

  const subjectUnits = useMemo(
    () => (selectedSubject ? units.filter((unit) => unit.subject === selectedSubject) : []),
    [selectedSubject, units],
  )

  const openLesson = useCallback((lesson: TrackLesson) => {
    if (lesson.component.progress_state === 'locked') return
    const params = new URLSearchParams({
      unit: lesson.unit.id,
      component: lesson.component.id,
    })
    navigate(`/learning/lesson?${params.toString()}`)
  }, [])

  const hasTrack = !loading && !error && Boolean(selectedSubject) && subjectUnits.length > 0

  return (
    <div
      className="learning-catalog-page"
      data-track-ready={hasTrack}
      data-track-subject={selectedSubject ?? 'none'}
    >
      <LearnerAppBar />
      <main className="learning-catalog-main">
        {loading && <LoadingState title={t('learning.loading.title')} body={t('learning.loading.body')} />}

        {error && !loading && (
          <ErrorState
            title={t('learning.error.title')}
            body={t('learning.error.body')}
            action={(
              <button className="learning-primary-button" type="button" onClick={() => setReloadKey((key) => key + 1)}>
                {t('learning.retry')}
              </button>
            )}
          />
        )}

        {!loading && !error && (
          <>
            {availableSubjects.length > 0 && (
              <div className="learning-catalog-tools">
                <div className="learning-subject-filters" role="group" aria-label={t('learning.filters.subject')}>
                  {availableSubjects.map((subject) => (
                    <button
                      className={selectedSubject === subject ? 'is-active' : ''}
                      type="button"
                      aria-pressed={selectedSubject === subject}
                      onClick={() => setSelectedSubject(subject)}
                      key={subject}
                    >
                      {t(`learning.subject.${subject}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {hasTrack && selectedSubject ? (
              <SimpleTrackView subject={selectedSubject} units={subjectUnits} onOpenLesson={openLesson} />
            ) : (
              <section className="learning-empty" role="status">
                <Icon name="inbox" size={28} />
                <h1>{t('learning.empty.title')}</h1>
                <p>{t('learning.empty.body')}</p>
              </section>
            )}

            <p className="learning-catalog-disclosure">
              <Icon name="spark" size={14} />
              <span>{t('learning.aiDisclosure')}</span>
            </p>
          </>
        )}
      </main>
    </div>
  )
}

