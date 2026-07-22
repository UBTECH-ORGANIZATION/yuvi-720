import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Icon } from '../../components/primitives'
import { CompetencyChat } from '../../components/CompetencyChat'
import { useI18n } from '../../i18n/I18nProvider'
import { useCompanion } from '../../providers/CompanionProvider'
import type { DashboardDTO } from '../../services/brain'
import { CompetencyGlyph } from './CompetencyGlyph'
import './learning-map.css'

type Competency = DashboardDTO['competencies'][number]

interface LearningMapProps {
  competencies: Competency[]
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
  onOpenDetail: (competency: Competency, side: 'good' | 'reinforce') => void
  detailsLabel: string
}

function TopicRow({ competency, side, onOpenDetail, detailsLabel }: ColumnRowProps) {
  const visual = visualFor(competency.key)
  const style = { '--lmap-accent': visual.color } as CSSProperties
  return (
    <li>
      <button
        type="button"
        className="sd-lmap-row"
        style={style}
        onClick={() => onOpenDetail(competency, side)}
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

interface TopicDetailProps {
  competency: Competency
  side: 'good' | 'reinforce'
  onClose: () => void
}

/**
 * Per-topic detail dialog: a clean, glanceable panel (topic glyph, what it means,
 * why the map shows this band — verbal, never a number — and one small next step)
 * beside an embedded, topic-scoped Yuvi chat.
 *
 * The chat is ephemeral by design: the transcript lives only here (never written
 * to conversation history), while the server still runs the memory lane, so
 * durable facts the kid shares do update the brain. Its bubbles are styled like
 * the floating companion, and each reply can be turned into a visual on demand.
 */
function TopicDetailDialog({ competency, side, onClose }: TopicDetailProps) {
  const { t } = useI18n()
  const visual = visualFor(competency.key)
  const style = { '--lmap-accent': visual.color } as CSSProperties
  const k = (suffix: string) => t(`sdash.lmap.d.${competency.key}.${suffix}`)

  const [chatOpen, setChatOpen] = useState(false)
  const { close: closeCompanion } = useCompanion()

  // Opening this focused dialog auto-closes the floating companion so the two
  // chats never sit side by side.
  useEffect(() => { closeCompanion() }, [closeCompanion])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="sd-lmap-modal" role="presentation" onClick={onClose}>
      <div
        className={`sd-lmap-detail sd-lmap-detail--${side}${chatOpen ? ' sd-lmap-detail--chat' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sd-lmap-detail-title"
        style={style}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="sd-lmap-detail__close" onClick={onClose} aria-label={t('sdash.lmap.d.close')} autoFocus>
          <Icon name="close" size={16} />
        </button>

        <header className="sd-lmap-detail__head">
          <div>
            <h3 id="sd-lmap-detail-title" dir="auto">{competency.label}</h3>
            <span className={`sd-lmap-detail__band sd-lmap-detail__band--${side}`} dir="auto">{competency.descriptor}</span>
          </div>
        </header>

        {/* Info column — glanceable: a topic glyph, the meaning, why this band,
            one next step. Stays on the inline-start side (right in RTL). */}
        <div className="sd-lmap-detail__info">
          <div className="sd-lmap-detail__glyph" aria-hidden="true">
            <CompetencyGlyph competencyKey={competency.key} color={visual.color} />
          </div>

          <p className="sd-lmap-detail__meaning" dir="auto">{k('meaning')}</p>

          <div className="sd-lmap-detail__block">
            <h4>{t(`sdash.lmap.d.whyTitle.${side}`)}</h4>
            <p dir="auto">{k(side === 'good' ? 'whyGood' : 'whyReinforce')}</p>
          </div>

          <div className="sd-lmap-detail__next">
            <span className="sd-lmap-detail__next-icon" aria-hidden="true"><Icon name="target" size={16} /></span>
            <div>
              <strong>{t('sdash.lmap.d.nextTitle')}</strong>
              <span dir="auto">{k('next')}</span>
            </div>
          </div>

          {!chatOpen && (
            <button type="button" className="sd-lmap-detail__talk" onClick={() => setChatOpen(true)}>
              <Icon name="message" size={16} />
              <span>{t('sdash.lmap.d.talk')}</span>
            </button>
          )}
        </div>

        {chatOpen && (
          <div className="sd-lmap-detail__chatpane">
            <CompetencyChat
              competencyKey={competency.key}
              greeting={t(`sdash.lmap.chat.greeting.${side}`, { topic: competency.label })}
              ephemeralNote={t('sdash.lmap.chat.ephemeral')}
            />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * "מפת הלמידה שלי" (F4) — a compact, two-column projection of the real activeness
 * bands from the brain. The left rail lists topics worth strengthening; the right
 * rail lists topics progressing nicely. No numeric scores are shown to the learner.
 */
export function LearningMap({ competencies }: LearningMapProps) {
  const { t } = useI18n()
  const [selected, setSelected] = useState<{ competency: Competency; side: 'good' | 'reinforce' } | null>(null)

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
                    onOpenDetail={(c, side) => setSelected({ competency: c, side })}
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
                    onOpenDetail={(c, side) => setSelected({ competency: c, side })}
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

      {selected && (
        <TopicDetailDialog
          competency={selected.competency}
          side={selected.side}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  )
}
