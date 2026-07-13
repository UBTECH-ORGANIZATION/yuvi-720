import { useEffect, useMemo, useState } from 'react'
import { navigate } from '../../app/router'
import { LearnerAppBar } from '../../components/LearnerAppBar'
import { ErrorState, Icon, LoadingState } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { useBrain } from '../../providers/BrainProvider'
import {
  getLearningCatalog,
  type LearningComponentDTO,
  type LearningSubject,
  type LearningUnitDTO,
} from '../../services/learning'
import { LearningRoadmap } from './LearningRoadmap'
import './learning-portal.css'

type SubjectFilter = 'all' | LearningSubject

const SUBJECTS: SubjectFilter[] = ['all', 'math', 'science', 'other']

function unitSearchText(unit: LearningUnitDTO) {
  return `${unit.title} ${unit.sub_topic} ${unit.components.map((component) => component.title).join(' ')}`.toLocaleLowerCase()
}

/** 720 F1 provider-backed learning catalog; all progress remains Brain-derived. */
export function LearningPortalPage() {
  const { t, language } = useI18n()
  const { learnerId } = useBrain()
  const [units, setUnits] = useState<LearningUnitDTO[]>([])
  const [selectedSubject, setSelectedSubject] = useState<SubjectFilter>('all')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoading(true)
    setError(false)
    getLearningCatalog(learnerId, controller.signal)
      .then((catalog) => {
        if (active) setUnits(catalog.units)
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

  const filteredUnits = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return units.filter((unit) => {
      const matchesSubject = selectedSubject === 'all' || unit.subject === selectedSubject
      const matchesQuery = !normalizedQuery || unitSearchText(unit).includes(normalizedQuery)
      return matchesSubject && matchesQuery
    })
  }, [query, selectedSubject, units])

  const availableSubjects = useMemo(
    () => new Set(units.map((unit) => unit.subject)),
    [units],
  )

  const openComponent = (unit: LearningUnitDTO, component: LearningComponentDTO) => {
    const params = new URLSearchParams({ unit: unit.id, component: component.id })
    navigate(`/learning/lesson?${params.toString()}`)
  }

  return (
    <div className="learning-catalog-page">
      <LearnerAppBar />
      <main className="learning-catalog-main">
        <section className="learning-catalog-hero" aria-labelledby="learning-catalog-title">
          <div className="learning-catalog-hero__copy">
            <span className="learning-eyebrow"><Icon name="spark" size={16} />{t('learning.catalog.eyebrow')}</span>
            <h1 id="learning-catalog-title">{t('learning.catalog.title')}</h1>
            <p>{t('learning.catalog.subtitle')}</p>
          </div>
          <div className="learning-provider-status" role="status">
            <span className="learning-provider-status__dot" aria-hidden="true" />
            <div>
              <strong>{t('learning.provider.connected')}</strong>
              <span>{t('learning.provider.approved')}</span>
            </div>
          </div>
        </section>

        <section className="learning-catalog-tools" aria-label={t('learning.filters.label')}>
          <div className="learning-subject-filters" role="group" aria-label={t('learning.filters.subject')}>
            {SUBJECTS.filter((subject) => subject === 'all' || availableSubjects.has(subject)).map((subject) => (
              <button
                className={selectedSubject === subject ? 'is-active' : ''}
                type="button"
                key={subject}
                aria-pressed={selectedSubject === subject}
                onClick={() => setSelectedSubject(subject)}
              >
                {t(`learning.subject.${subject}`)}
              </button>
            ))}
          </div>
          <label className="learning-search">
            <Icon name="book" size={17} />
            <span className="sp-visually-hidden">{t('learning.search.label')}</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('learning.search.placeholder')}
            />
          </label>
        </section>

        {loading && <LoadingState title={t('learning.loading.title')} body={t('learning.loading.body')} />}
        {error && !loading && (
          <ErrorState
            title={t('learning.error.title')}
            body={t('learning.error.body')}
            action={<button className="learning-primary-button" type="button" onClick={() => setReloadKey((key) => key + 1)}>{t('learning.retry')}</button>}
          />
        )}

        {!loading && !error && filteredUnits.length === 0 && (
          <section className="learning-empty" role="status">
            <Icon name="inbox" size={28} />
            <h2>{t('learning.empty.title')}</h2>
            <p>{t('learning.empty.body')}</p>
          </section>
        )}

        {!loading && !error && filteredUnits.length > 0 && (
          <section className="learning-unit-grid" aria-label={t('learning.catalog.units')}>
            {filteredUnits.map((unit) => (
              <article className="learning-unit-card" key={unit.id}>
                <header className="learning-unit-card__header">
                  <div className={`learning-subject-icon learning-subject-icon--${unit.subject}`} aria-hidden="true">
                    <Icon name={unit.subject === 'science' ? 'lightbulb' : 'book'} size={22} />
                  </div>
                  <div>
                    <span className="learning-unit-card__subject">{t(`learning.subject.${unit.subject}`)}</span>
                    <h2>{unit.title}</h2>
                    <p>{unit.sub_topic}</p>
                  </div>
                  <span className="learning-unit-card__count">
                    {t('learning.unit.componentCount', { count: unit.components.length })}
                  </span>
                </header>

                {!unit.languages.includes(language) && (
                  <p className="learning-language-notice">
                    <Icon name="alert" size={15} />
                    {t('learning.language.fallback')}
                  </p>
                )}

                <LearningRoadmap
                  unit={unit}
                  activeComponentId={unit.current_component_id}
                  onSelect={(component) => openComponent(unit, component)}
                />
              </article>
            ))}
          </section>
        )}

        <footer className="learning-catalog-disclosure">
          <Icon name="spark" size={16} />
          <span>{t('learning.aiDisclosure')}</span>
        </footer>
      </main>
    </div>
  )
}
