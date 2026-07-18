import { useMemo, type CSSProperties } from 'react'
import { Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import type { DashboardDTO } from '../../services/brain'
import './learning-map.css'

type Competency = DashboardDTO['competencies'][number]

interface LearningMapProps {
  competencies: Competency[]
  /** Opens the AI coach to talk about a specific topic / the map. */
  onExplore: () => void
}

/** Line-icon + soft accent per topic, mirroring the activeness component (no emoji). */
const VISUALS: Record<string, { icon: string; color: string }> = {
  motivation_relevance: { icon: 'target', color: '#7c6cff' },
  growth_mindset: { icon: 'leaf', color: '#1f9d6b' },
  initiative_responsibility: { icon: 'arrow', color: '#1aa9d1' },
  self_regulation: { icon: 'compass', color: '#5a45f0' },
  self_awareness: { icon: 'search', color: '#d99a1f' },
  support_emotional: { icon: 'message', color: '#e0658a' },
}
const FALLBACK_VISUAL = { icon: 'spark', color: '#7c6cff' }

function visualFor(key: string) {
  return VISUALS[key] ?? FALLBACK_VISUAL
}

/** Keep the dashboard card compact — at most four topics per column. */
const MAX_PER_COLUMN = 4

/**
 * Demo-only placeholder topics for the "needs reinforcement" column so the card
 * shows how it looks even when the brain has no real support-band competencies yet.
 * Not derived from real data — labels/descriptors are localized copy.
 */
const DEMO_REINFORCE_KEYS = ['growth_mindset', 'self_regulation', 'self_awareness'] as const

interface ColumnRowProps {
  competency: Competency
  side: 'good' | 'reinforce'
  onExplore: () => void
  detailsLabel: string
}

function TopicRow({ competency, side, onExplore, detailsLabel }: ColumnRowProps) {
  const visual = visualFor(competency.key)
  const style = { '--lmap-accent': visual.color } as CSSProperties
  return (
    <li>
      <button
        type="button"
        className="sd-lmap-row"
        style={style}
        onClick={onExplore}
        aria-label={`${competency.label} — ${competency.descriptor}. ${detailsLabel}`}
      >
        <span className="sd-lmap-row__icon" aria-hidden="true">
          <Icon name={visual.icon} size={20} />
        </span>
        <span className="sd-lmap-row__body">
          <span className="sd-lmap-row__title" dir="auto">{competency.label}</span>
          <span className="sd-lmap-row__desc" dir="auto">{competency.descriptor}</span>
        </span>
        <span className={`sd-lmap-row__status sd-lmap-row__status--${side}`} aria-hidden="true">
          {side === 'good' ? <Icon name="check" size={14} /> : <Icon name="target" size={14} />}
        </span>
        <span className="sd-lmap-row__chevron" aria-hidden="true">
          <Icon name="chevronLeft" size={16} />
        </span>
      </button>
    </li>
  )
}

/**
 * "מפת הלמידה שלי" (F4) — a compact, two-column projection of the real activeness
 * bands from the brain. The left rail lists topics worth strengthening; the right
 * rail lists topics progressing nicely. No numeric scores are shown to the learner.
 */
export function LearningMap({ competencies, onExplore }: LearningMapProps) {
  const { t } = useI18n()

  const { good, reinforce } = useMemo(() => {
    const good: Competency[] = []
    const reinforce: Competency[] = []
    for (const competency of competencies) {
      if (competency.tone === 'support') reinforce.push(competency)
      else good.push(competency)
    }
    // Keep the card compact — show at most four topics per column.
    return { good: good.slice(0, MAX_PER_COLUMN), reinforce: reinforce.slice(0, MAX_PER_COLUMN) }
  }, [competencies])

  // Demo fallback: when there is no real support-band topic, show placeholder
  // topics so the column still demonstrates its intended look.
  const reinforceDisplay = useMemo<Competency[]>(() => {
    if (reinforce.length > 0) return reinforce
    return DEMO_REINFORCE_KEYS.map((key) => ({
      key,
      icon: visualFor(key).icon,
      label: t(`sdash.learningMap.demo.${key}.label`),
      value: 0,
      descriptor: t(`sdash.learningMap.demo.${key}.desc`),
      tone: 'support' as const,
    }))
  }, [reinforce, t])

  if (good.length === 0 && reinforce.length === 0) return null

  const detailsLabel = t('sdash.learningMap.details')

  return (
    <section className="sd-section" aria-labelledby="sd-lmap-title">
      <div className="sd-lmap">
        <header className="sd-lmap__head">
          <div className="sd-lmap__heading">
            <span className="sd-lmap__head-icon" aria-hidden="true"><Icon name="map" size={22} /></span>
            <div>
              <h2 id="sd-lmap-title">{t('sdash.learningMap.title')}</h2>
              <p>{t('sdash.learningMap.subtitle')}</p>
            </div>
          </div>
          <button type="button" className="sd-lmap__see-all" onClick={onExplore}>
            <span>{t('sdash.learningMap.seeAll')}</span>
            <Icon name="chevronLeft" size={16} />
          </button>
        </header>

        <div className="sd-lmap__grid">
          <div className="sd-lmap__col sd-lmap__col--reinforce">
            <div className="sd-lmap__col-head">
              <span className="sd-lmap__col-icon" aria-hidden="true"><Icon name="target" size={16} /></span>
              <h3>{t('sdash.learningMap.reinforce.title')}</h3>
            </div>
            {reinforceDisplay.length > 0 ? (
              <ul className="sd-lmap__list">
                {reinforceDisplay.map((competency) => (
                  <TopicRow
                    key={competency.key}
                    competency={competency}
                    side="reinforce"
                    onExplore={onExplore}
                    detailsLabel={detailsLabel}
                  />
                ))}
              </ul>
            ) : (
              <p className="sd-lmap__empty">{t('sdash.learningMap.reinforce.empty')}</p>
            )}
          </div>

          <div className="sd-lmap__col sd-lmap__col--good">
            <div className="sd-lmap__col-head">
              <span className="sd-lmap__col-icon" aria-hidden="true"><Icon name="leaf" size={16} /></span>
              <h3>{t('sdash.learningMap.good.title')}</h3>
            </div>
            {good.length > 0 ? (
              <ul className="sd-lmap__list">
                {good.map((competency) => (
                  <TopicRow
                    key={competency.key}
                    competency={competency}
                    side="good"
                    onExplore={onExplore}
                    detailsLabel={detailsLabel}
                  />
                ))}
              </ul>
            ) : (
              <p className="sd-lmap__empty">{t('sdash.learningMap.good.empty')}</p>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
