import { useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import type { DashboardDTO } from '../../services/brain'
import { WeeklyHeroArt } from './WeeklyHeroArt'
import './skills-dashboard.css'

type Competency = DashboardDTO['competencies'][number]

interface SkillDashboardProps {
  competencies: Competency[]
  /** Opens the AI coach to start working on the weekly skill. */
  onStartWeekly: () => void
}

/** Line-icon + pastel accent per MoE activeness component (no emoji, per the UIUX bar). */
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

function levelFor(value: number) {
  return Math.max(1, Math.min(5, Math.floor(value / 20) + 1))
}

interface Node {
  competency: Competency
  index: number
  /** data-point coordinates (scaled by value) in the 0–100 viewBox */
  px: number
  py: number
  /** icon/label anchor at the outer ring */
  ix: number
  iy: number
  /** vertical half — used so the tooltip never clips off-card */
  half: 'top' | 'bottom'
}

const CENTER = 50
const RING = 33
const ICON_RING = 45

function buildNodes(competencies: Competency[]): Node[] {
  const count = competencies.length || 1
  return competencies.map((competency, index) => {
    const angle = (-90 + (360 / count) * index) * (Math.PI / 180)
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const clamped = Math.max(0, Math.min(100, competency.value))
    const r = (clamped / 100) * RING
    return {
      competency,
      index,
      px: CENTER + r * cos,
      py: CENTER + r * sin,
      ix: CENTER + ICON_RING * cos,
      iy: CENTER + ICON_RING * sin,
      half: sin > 0.35 ? 'bottom' : 'top',
    }
  })
}

function ringPolygon(count: number, factor: number): string {
  const points: string[] = []
  for (let i = 0; i < count; i += 1) {
    const angle = (-90 + (360 / count) * i) * (Math.PI / 180)
    const x = CENTER + RING * factor * Math.cos(angle)
    const y = CENTER + RING * factor * Math.sin(angle)
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`)
  }
  return points.join(' ')
}

/**
 * The activeness "פעלנות" experience — an explanatory radar (left) that always
 * defers to the single weekly coaching focus (right). Values come straight from
 * the brain projection; the UI never invents a competency number.
 */
export function SkillDashboard({ competencies, onStartWeekly }: SkillDashboardProps) {
  const { t } = useI18n()
  const [active, setActive] = useState<number | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  const nodes = useMemo(() => buildNodes(competencies), [competencies])
  const count = competencies.length || 1

  const areaPoints = useMemo(
    () => nodes.map((node) => `${node.px.toFixed(2)},${node.py.toFixed(2)}`).join(' '),
    [nodes],
  )

  // The single skill the learner should remember: the one most worth strengthening.
  const weekly = useMemo(() => {
    if (competencies.length === 0) return null
    return competencies.reduce((lowest, current) =>
      current.value < lowest.value ? current : lowest,
    )
  }, [competencies])

  if (!weekly) return null

  const weeklyVisual = visualFor(weekly.key)
  const weeklyLevel = levelFor(weekly.value)
  const skillText = (suffix: string, fallback: string) =>
    t(`sdash.skill.${weekly.key}.${suffix}`) === `sdash.skill.${weekly.key}.${suffix}`
      ? fallback
      : t(`sdash.skill.${weekly.key}.${suffix}`)

  const onRadarKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (active === null) return
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((active + 1) % count)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((active - 1 + count) % count)
    } else if (event.key === 'Escape') {
      setActive(null)
    }
  }

  return (
    <section className="sk-skills" aria-labelledby="sk-skills-title">
      <header className="sk-skills__intro">
        <span className="sk-skills__kicker">
          <Icon name="spark" size={16} />
          {t('sdash.skills.kicker')}
        </span>
        <h2 id="sk-skills-title">{t('sdash.skills.title')}</h2>
        <p>{t('sdash.skills.subtitle')}</p>
      </header>

      <div className="sk-skills__grid">
        {/* ── Left · explanatory radar ─────────────────────────────── */}
        <div className="sk-radar-card">
          <button
            type="button"
            className="sk-radar-help"
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen((open) => !open)}
          >
            <Icon name="reflect" size={15} />
            {t('sdash.skills.help')}
          </button>
          {helpOpen && (
            <p className="sk-radar-help__body" role="note">{t('sdash.skills.helpBody')}</p>
          )}

          <div
            className="sk-radar"
            role="group"
            aria-label={t('sdash.skills.radar.aria')}
            onKeyDown={onRadarKey}
          >
            <svg
              className="sk-radar__svg"
              viewBox="0 0 100 100"
              role="presentation"
              aria-hidden="true"
            >
              {[0.25, 0.5, 0.75, 1].map((factor) => (
                <polygon key={factor} className="sk-radar__ring" points={ringPolygon(count, factor)} />
              ))}
              {nodes.map((node) => (
                <line
                  key={`axis-${node.competency.key}`}
                  className={`sk-radar__axis${active === node.index ? ' is-active' : ''}`}
                  x1={CENTER}
                  y1={CENTER}
                  x2={CENTER + RING * Math.cos((-90 + (360 / count) * node.index) * (Math.PI / 180))}
                  y2={CENTER + RING * Math.sin((-90 + (360 / count) * node.index) * (Math.PI / 180))}
                />
              ))}
              <polygon className="sk-radar__area" points={areaPoints} />
              {nodes.map((node) => (
                <circle
                  key={`point-${node.competency.key}`}
                  className={`sk-radar__point${active === node.index ? ' is-active' : ''}`}
                  cx={node.px}
                  cy={node.py}
                  r={active === node.index ? 2.6 : 1.7}
                  style={{ '--i': node.index } as CSSProperties}
                />
              ))}
            </svg>

            {nodes.map((node) => {
              const visual = visualFor(node.competency.key)
              const level = levelFor(node.competency.value)
              const isActive = active === node.index
              const tip = skillTip(t, node.competency.key)
              return (
                <button
                  key={node.competency.key}
                  type="button"
                  className={`sk-node${isActive ? ' is-active' : ''}`}
                  style={{
                    left: `${node.ix}%`,
                    top: `${node.iy}%`,
                    '--accent': visual.color,
                    '--i': node.index,
                  } as CSSProperties}
                  onMouseEnter={() => setActive(node.index)}
                  onMouseLeave={() => setActive((current) => (current === node.index ? null : current))}
                  onFocus={() => setActive(node.index)}
                  onBlur={() => setActive((current) => (current === node.index ? null : current))}
                  aria-label={t('sdash.skills.skillAria', {
                    label: node.competency.label,
                    level,
                    percent: node.competency.value,
                    tip,
                  })}
                >
                  <span className="sk-node__chip">
                    <Icon name={visual.icon} size={20} />
                  </span>
                  <span className="sk-node__label" dir="auto">{node.competency.label}</span>
                  <span className="sk-node__meta">
                    <span>{t('sdash.skills.weekly.level', { level })}</span>
                    <strong>{node.competency.value}%</strong>
                  </span>
                  {isActive && (
                    <span className={`sk-tooltip sk-tooltip--${node.half}`} role="tooltip">
                      <strong dir="auto">{node.competency.label}</strong>
                      <em>{node.competency.value}%</em>
                      <span dir="auto">{tip}</span>
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Right · the one weekly focus ─────────────────────────── */}
        <aside className="sk-weekly" aria-labelledby="sk-weekly-title" style={{ '--accent': weeklyVisual.color } as CSSProperties}>
          <div className="sk-weekly__top">
            <div className="sk-weekly__intro">
              <span className="sk-weekly__eyebrow">{t('sdash.skills.weekly.eyebrow')}</span>
              <h3 id="sk-weekly-title" dir="auto">{weekly.label}</h3>
              <p dir="auto">{skillText('note', weekly.descriptor)}</p>
            </div>
            <WeeklyHeroArt className="sk-weekly__art" />
          </div>

          <div className="sk-weekly__progress">
            <div className="sk-weekly__progress-head">
              <span>{t('sdash.skills.weekly.progressLabel')}</span>
              <strong>{weekly.value}%</strong>
            </div>
            <div
              className="sk-progress"
              role="progressbar"
              aria-valuenow={weekly.value}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t('sdash.skills.weekly.progressLabel')}
            >
              <span className="sk-progress__fill" style={{ '--value': `${weekly.value}%` } as CSSProperties} />
            </div>
            <span className="sk-weekly__level">{t('sdash.skills.weekly.level', { level: weeklyLevel })}</span>
          </div>

          <p className="sk-weekly__why" dir="auto">
            {skillText('why', t('sdash.skills.weekly.whyFallback', { skill: weekly.label }))}
          </p>

          <div className="sk-weekly__challenge">
            <span className="sk-weekly__challenge-title">
              <Icon name="target" size={16} />
              {t('sdash.skills.weekly.challengeTitle')}
            </span>
            <p dir="auto">{skillText('mission', t('sdash.skills.weekly.missionFallback'))}</p>
          </div>

          <button type="button" className="sk-weekly__cta" onClick={onStartWeekly}>
            <Icon name="spark" size={18} />
            {t('sdash.skills.weekly.cta')}
          </button>
        </aside>
      </div>
    </section>
  )
}

function skillTip(t: (key: string, params?: Record<string, string | number>) => string, key: string): string {
  const value = t(`sdash.skill.${key}.tip`)
  return value === `sdash.skill.${key}.tip` ? '' : value
}
