import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { navigate } from '../../app/router'
import { LearnerAppBar } from '../../components/LearnerAppBar'
import { ErrorState, Icon, LoadingState } from '../../components/primitives'
import { useMediaQuery, useResponsive } from '../../hooks/useResponsive'
import { useI18n } from '../../i18n/I18nProvider'
import { useBrain } from '../../providers/BrainProvider'
import { useCompanion } from '../../providers/CompanionProvider'
import {
  getLearningCatalog,
  type LearningComponentDTO,
  type LearningSubject,
  type LearningUnitDTO,
} from '../../services/learning'
import { useYubiDesign } from '../yubi-studio/YubiDesignProvider'
import { LearningWorldUnity } from './LearningWorldUnity'
import {
  buildLearningWorldModel,
  type LearningWorldLandmark,
  type LearningWorldModel,
} from './learningWorldModel'
import type { LearningWorldHandle, LearningWorldStats } from './learningWorldRenderer'
import './learning-portal.css'
import './learning-world.css'

const SUBJECT_ORDER: LearningSubject[] = ['math', 'science', 'other']

function purposeKey(component: LearningComponentDTO) {
  if (component.is_assessment) return 'learning.component.assessment'
  if (component.purpose === 'instruction') return 'learning.component.instruction'
  if (component.purpose === 'practice') return 'learning.component.practice'
  return 'learning.component.activity'
}

function firstSubject(units: LearningUnitDTO[]): LearningSubject | null {
  const current = units.find((unit) => unit.components.some((component) => component.progress_state === 'current'))
  if (current) return current.subject
  const available = units.find((unit) => unit.components.some((component) => component.progress_state === 'available'))
  if (available) return available.subject
  return SUBJECT_ORDER.find((subject) => units.some((unit) => unit.subject === subject)) ?? null
}

interface StaticWorldProps {
  world: LearningWorldModel
  selectedId: string | null
  onSelect: (landmarkId: string) => void
}

function StaticLearningWorld({ world, selectedId, onSelect }: StaticWorldProps) {
  const { t } = useI18n()
  const currentIndex = Math.max(0, world.landmarks.findIndex((landmark) => landmark.id === world.currentLandmarkId))
  const start = Math.max(0, Math.min(currentIndex - 2, Math.max(0, world.landmarks.length - 6)))
  const visible = world.landmarks.slice(start, start + 6)

  return (
    <div className={`learning-world-static learning-world-static--${world.subject}`} role="img" aria-label={t('learning.world.fallback.aria')}>
      <div className="learning-world-static__landscape" aria-hidden="true">
        <span /><span /><span /><span />
      </div>
      <div className="learning-world-static__route" aria-hidden="true" />
      {visible.map((landmark, index) => (
        <button
          className={`learning-world-static__landmark is-${landmark.component.progress_state}${selectedId === landmark.id ? ' is-selected' : ''}`}
          style={{
            '--static-x': `${18 + (index % 3) * 31}%`,
            '--static-y': `${22 + Math.floor(index / 3) * 42 + (index % 2) * 7}%`,
          } as CSSProperties}
          type="button"
          aria-disabled={landmark.component.progress_state === 'locked'}
          aria-label={`${landmark.displayIndex}. ${landmark.component.title}. ${t(`learning.roadmap.state.${landmark.component.progress_state}`)}`}
          onClick={() => onSelect(landmark.id)}
          key={landmark.id}
        >
          <span>{landmark.displayIndex}</span>
          <strong dir="auto">{landmark.component.title}</strong>
        </button>
      ))}
    </div>
  )
}

/**
 * 720 F1 learning world. Provider order remains the curriculum authority and
 * every progress state is projected from Brain/xAPI by the backend.
 */
export function LearningPortalPage() {
  const { t, language } = useI18n()
  const { learnerId } = useBrain()
  const { open: openCompanion } = useCompanion()
  const { design } = useYubiDesign()
  const { isPhone, isTablet } = useResponsive()
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const sceneRef = useRef<LearningWorldHandle>(null)
  const [units, setUnits] = useState<LearningUnitDTO[]>([])
  const [selectedSubject, setSelectedSubject] = useState<LearningSubject | null>(null)
  const [selectedLandmarkId, setSelectedLandmarkId] = useState<string | null>(null)
  const [journeyOpen, setJourneyOpen] = useState(false)
  const [sceneReady, setSceneReady] = useState(false)
  const [unityFailed, setUnityFailed] = useState(false)
  const [travelling, setTravelling] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [stats, setStats] = useState<LearningWorldStats | null>(null)

  const debug = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    return {
      enabled: params.get('worldDebug') === '1',
      simulate: params.get('worldSimulate'),
    }
  }, [])

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

  const world = useMemo(
    () => selectedSubject ? buildLearningWorldModel(units, selectedSubject) : null,
    [selectedSubject, units],
  )

  useEffect(() => {
    if (!world) return
    setSceneReady(false)
    setUnityFailed(false)
    setTravelling(false)
    setSelectedLandmarkId((current) => (
      current && world.landmarks.some((landmark) => landmark.id === current)
        ? current
        : world.recommendedLandmarkId ?? world.currentLandmarkId ?? world.landmarks[0]?.id ?? null
    ))
  }, [world])

  const selectedLandmark = useMemo(
    () => world?.landmarks.find((landmark) => landmark.id === selectedLandmarkId) ?? null,
    [selectedLandmarkId, world],
  )

  const selectLandmark = useCallback((landmarkId: string) => {
    if (!world) return
    const landmark = world.landmarks.find((candidate) => candidate.id === landmarkId)
    if (!landmark) return
    setSelectedLandmarkId(landmarkId)
    if (landmark.component.progress_state === 'locked') {
      sceneRef.current?.showBlocked(landmarkId)
      setAnnouncement(t('learning.world.announcement.blocked', { title: landmark.component.title }))
      return
    }
    sceneRef.current?.focus(landmarkId)
    setAnnouncement(t('learning.world.announcement.selected', { title: landmark.component.title }))
  }, [t, world])

  const showRecommended = useCallback(() => {
    if (!world?.recommendedLandmarkId) return
    setSelectedLandmarkId(world.recommendedLandmarkId)
    sceneRef.current?.focus(world.recommendedLandmarkId)
    setAnnouncement(t('learning.world.announcement.recommended'))
  }, [t, world])

  const openLandmark = useCallback(() => {
    if (!selectedLandmark || travelling) return
    if (selectedLandmark.component.progress_state === 'locked') {
      sceneRef.current?.showBlocked(selectedLandmark.id)
      setAnnouncement(t('learning.world.announcement.blocked', { title: selectedLandmark.component.title }))
      return
    }
    const openLesson = () => {
      const params = new URLSearchParams({
        unit: selectedLandmark.unit.id,
        component: selectedLandmark.component.id,
      })
      navigate(`/learning/lesson?${params.toString()}`)
    }
    setTravelling(true)
    setAnnouncement(t('learning.world.announcement.travelling', { title: selectedLandmark.component.title }))
    if (!sceneReady) {
      openLesson()
      return
    }
    sceneRef.current?.travelTo(selectedLandmark.id, openLesson)
  }, [sceneReady, selectedLandmark, t, travelling])

  const handleSceneReady = useCallback(() => setSceneReady(true), [])
  const handleStats = useCallback((nextStats: LearningWorldStats) => setStats(nextStats), [])
  const handleUnityFatalError = useCallback(() => setUnityFailed(true), [])
  const handleWorldBlocked = useCallback(() => {
    setTravelling(false)
    setAnnouncement(t('learning.world.bridgeLocked'))
  }, [t])

  const lowPower = isTablet
  const useStaticWorld = isPhone || unityFailed

  return (
    <div
      className={`learning-world-page learning-world-page--${selectedSubject ?? 'empty'}${journeyOpen ? ' is-journey-open' : ''}`}
      data-world-ready={!loading && !error && (sceneReady || useStaticWorld)}
      data-world-subject={selectedSubject ?? 'none'}
      data-world-fallback={useStaticWorld}
    >
      <LearnerAppBar />
      <main className="learning-world-main" aria-labelledby="learning-world-title">
        {loading && (
          <div className="learning-world-state">
            <LoadingState title={t('learning.loading.title')} body={t('learning.loading.body')} />
          </div>
        )}
        {error && !loading && (
          <div className="learning-world-state">
            <ErrorState
              title={t('learning.error.title')}
              body={t('learning.error.body')}
              action={<button className="learning-primary-button" type="button" onClick={() => setReloadKey((key) => key + 1)}>{t('learning.retry')}</button>}
            />
          </div>
        )}
        {!loading && !error && !world && (
          <section className="learning-world-state learning-empty" role="status">
            <Icon name="inbox" size={28} />
            <h1 id="learning-world-title">{t('learning.empty.title')}</h1>
            <p>{t('learning.empty.body')}</p>
          </section>
        )}

        {!loading && !error && world && (
          <>
            <section className="learning-world-stage" aria-label={t('learning.world.region')}>
              {useStaticWorld ? (
                <StaticLearningWorld world={world} selectedId={selectedLandmarkId} onSelect={selectLandmark} />
              ) : (
                <LearningWorldUnity
                  ref={sceneRef}
                  world={world}
                  design={design}
                  lowPower={lowPower}
                  reducedMotion={reducedMotion}
                  simulate={debug.simulate}
                  selectedLandmarkId={selectedLandmarkId}
                  ariaLabel={t('learning.world.canvasAria', { subject: t(`learning.subject.${world.subject}`) })}
                  onLandmarkSelect={selectLandmark}
                  onYubiInteract={openCompanion}
                  onBlocked={handleWorldBlocked}
                  onReady={handleSceneReady}
                  onFatalError={handleUnityFatalError}
                  onStats={handleStats}
                />
              )}

              {!useStaticWorld && sceneReady && (
                <div className="learning-world-navigation-help" aria-hidden="true">
                  <Icon name="compass" size={16} />
                  <span>{t('learning.world.navigationHelp')}</span>
                </div>
              )}

              {!sceneReady && !useStaticWorld && (
                <div className="learning-world-scene-loading" role="status">
                  <span aria-hidden="true" />
                  <strong>{t('learning.world.preparing')}</strong>
                </div>
              )}

              <header className="learning-world-hud">
                {/* Title kept for screen readers only (the <main> is labelled by it); the visible
                    intro card was removed to keep the world view clean. */}
                <h1 id="learning-world-title" className="sp-sr-only">{t(`learning.world.title.${world.subject}`)}</h1>

                <div className="learning-world-subjects" role="group" aria-label={t('learning.filters.subject')}>
                  {availableSubjects.map((subject) => (
                    <button
                      className={selectedSubject === subject ? 'is-active' : ''}
                      type="button"
                      aria-pressed={selectedSubject === subject}
                      onClick={() => setSelectedSubject(subject)}
                      key={subject}
                    >
                      <Icon name={subject === 'science' ? 'leaf' : subject === 'math' ? 'orbit' : 'book'} size={16} />
                      <span>{t(`learning.subject.${subject}`)}</span>
                    </button>
                  ))}
                </div>

                <div className="learning-world-controls" role="group" aria-label={t('learning.world.controls')}>
                  <button type="button" onClick={() => sceneRef.current?.resetCamera()} title={t('learning.world.reset')}>
                    <Icon name="compass" size={19} />
                    <span>{t('learning.world.reset')}</span>
                  </button>
                  <button type="button" aria-expanded={journeyOpen} onClick={() => setJourneyOpen((open) => !open)}>
                    <Icon name="map" size={19} />
                    <span>{t('learning.world.journey.open')}</span>
                  </button>
                  <button className="is-coach" type="button" onClick={openCompanion}>
                    <Icon name="message" size={19} />
                    <span>{t('learning.world.askYubi')}</span>
                  </button>
                </div>
              </header>

              <aside className={`learning-world-journey${journeyOpen ? ' is-open' : ''}`} aria-hidden={!journeyOpen}>
                <div className="learning-world-journey__header">
                  <div>
                    <span>{t('learning.world.journey.eyebrow')}</span>
                    <h2>{t('learning.world.journey.title')}</h2>
                  </div>
                  <button type="button" aria-label={t('learning.world.journey.close')} onClick={() => setJourneyOpen(false)}>
                    <Icon name="close" size={19} />
                  </button>
                </div>
                <p>{t('learning.world.journey.body')}</p>
                <div className="learning-world-journey__list">
                  {world.units.map((unit, unitIndex) => (
                    <section key={unit.id} aria-labelledby={`world-unit-${unitIndex}`}>
                      <h3 id={`world-unit-${unitIndex}`} dir="auto">{unit.title}</h3>
                      {world.landmarks.filter((landmark) => landmark.unit.id === unit.id).map((landmark) => (
                        <button
                          className={`${selectedLandmarkId === landmark.id ? 'is-selected ' : ''}is-${landmark.component.progress_state}`}
                          type="button"
                          aria-disabled={landmark.component.progress_state === 'locked'}
                          onClick={() => {
                            selectLandmark(landmark.id)
                            if (landmark.component.progress_state !== 'locked') setJourneyOpen(false)
                          }}
                          key={landmark.id}
                        >
                          <span>{landmark.displayIndex}</span>
                          <b dir="auto">{landmark.component.title}</b>
                          <small>{t(`learning.roadmap.state.${landmark.component.progress_state}`)}</small>
                        </button>
                      ))}
                    </section>
                  ))}
                </div>
              </aside>

              <button
                className={`learning-world-journey-backdrop${journeyOpen ? ' is-open' : ''}`}
                type="button"
                aria-label={t('learning.world.journey.close')}
                tabIndex={journeyOpen ? 0 : -1}
                onClick={() => setJourneyOpen(false)}
              />

              {selectedLandmark && (
                <LandmarkDetails
                  landmark={selectedLandmark}
                  languageSupported={selectedLandmark.component.languages.includes(language)}
                  travelling={travelling}
                  recommendedId={world.recommendedLandmarkId}
                  onOpen={openLandmark}
                  onShowRecommended={showRecommended}
                  onClose={() => setSelectedLandmarkId(null)}
                />
              )}

              <div className="learning-world-disclosure">
                <Icon name="spark" size={14} />
                <span>{t('learning.aiDisclosure')}</span>
              </div>

              {debug.enabled && (
                <output className="learning-world-debug" aria-label={t('learning.world.debug')}>
                  <b>WORLD DEBUG</b>
                  <span>subject: {world.subject}</span>
                  <span>renderer: {stats?.renderer ?? 'unity-webgl'}</span>
                  <span>landmarks: {world.landmarks.length}</span>
                  <span>selected: {selectedLandmarkId ?? 'none'}</span>
                  <span>position: {stats?.positionX ?? '—'}, {stats?.positionY ?? '—'}</span>
                  <span>zoom: {stats?.zoom ?? '—'}</span>
                  <span>fps: {stats?.fps ?? '—'}</span>
                  <span>draws: {stats?.drawCalls ?? '—'}</span>
                  <span>triangles: {stats?.triangles ?? '—'}</span>
                  <span>geometries: {stats?.geometries ?? '—'}</span>
                  <span>textures: {stats?.textures ?? '—'}</span>
                </output>
              )}
            </section>
            <p className="sp-sr-only" aria-live="polite">{announcement}</p>
          </>
        )}
      </main>
    </div>
  )
}

interface LandmarkDetailsProps {
  landmark: LearningWorldLandmark
  languageSupported: boolean
  travelling: boolean
  recommendedId: string | null
  onOpen: () => void
  onShowRecommended: () => void
  onClose: () => void
}

function LandmarkDetails({
  landmark,
  languageSupported,
  travelling,
  recommendedId,
  onOpen,
  onShowRecommended,
  onClose,
}: LandmarkDetailsProps) {
  const { t } = useI18n()
  const { component, unit } = landmark
  const locked = component.progress_state === 'locked'
  const completed = component.progress_state === 'completed'

  return (
    <article className={`learning-world-details is-${component.progress_state}`} aria-labelledby="learning-world-details-title">
      <button className="learning-world-details__close" type="button" aria-label={t('learning.world.details.close')} onClick={onClose}>
        <Icon name="close" size={18} />
      </button>
      <div className="learning-world-details__step" aria-hidden="true">{landmark.displayIndex}</div>
      <div className="learning-world-details__copy">
        <span>{unit.title} · {t(purposeKey(component))}</span>
        <h2 id="learning-world-details-title" dir="auto">{component.title}</h2>
        <div className="learning-world-details__meta">
          <b>{t(`learning.roadmap.state.${component.progress_state}`)}</b>
          {component.estimated_minutes && <span>{t('learning.component.minutes', { minutes: component.estimated_minutes })}</span>}
        </div>
        {locked && <p>{t('learning.world.blocked.body')}</p>}
        {!languageSupported && <p>{t('learning.language.fallback')}</p>}
      </div>
      <div className="learning-world-details__actions">
        {locked ? (
          <button type="button" disabled={!recommendedId} onClick={onShowRecommended}>
            <Icon name="compass" size={18} />
            {t('learning.world.showRecommended')}
          </button>
        ) : (
          <button type="button" disabled={travelling} onClick={onOpen}>
            <Icon name="play" size={18} />
            {travelling
              ? t('learning.world.travelling')
              : completed
                ? t('learning.world.revisit')
                : t('learning.world.start')}
          </button>
        )}
      </div>
    </article>
  )
}
