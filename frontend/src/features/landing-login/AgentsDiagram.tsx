import type { SVGProps } from 'react'
import { useI18n } from '../../i18n/I18nProvider'

function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

function MappingIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1" />
      <path d="M12 12 18 6" />
    </Icon>
  )
}

function LearningIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 5.5A2 2 0 0 1 6 4h5v15H6a2 2 0 0 0-2 1.4V5.5Z" />
      <path d="M20 5.5A2 2 0 0 0 18 4h-5v15h5a2 2 0 0 1 2 1.4V5.5Z" />
    </Icon>
  )
}

function GuideIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 5h16v11H9l-4 3.5V16H4V5Z" />
      <path d="M9.4 9.2h5.2" />
      <path d="M9.4 11.8h3.2" />
    </Icon>
  )
}

function MotivationIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 3.5 14.2 9l5.8.3-4.5 3.7 1.5 5.6L12 15.8 6.9 18.6l1.5-5.6L4 9.3 9.8 9 12 3.5Z" />
    </Icon>
  )
}

function InsightsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3.5 20.5h17" />
      <path d="M6 20V13" />
      <path d="M11 20V8" />
      <path d="M16 20v-5" />
      <path d="M20 6.5 15.5 11 12 8 7 12" />
    </Icon>
  )
}

function SafetyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 3.2 4.8 6v5.2c0 4.3 3 7.5 7.2 9.1 4.2-1.6 7.2-4.8 7.2-9.1V6L12 3.2Z" />
      <path d="m9 12 2 2 4-4.2" />
    </Icon>
  )
}

const AGENTS = [
  { key: 'mapping', Icon: MappingIcon, tone: 'blue' },
  { key: 'learning', Icon: LearningIcon, tone: 'teal' },
  { key: 'guide', Icon: GuideIcon, tone: 'purple' },
  { key: 'motivation', Icon: MotivationIcon, tone: 'orange' },
  { key: 'insights', Icon: InsightsIcon, tone: 'indigo' },
  { key: 'safety', Icon: SafetyIcon, tone: 'pink' }
] as const

const CHIPS = ['mapping', 'learning', 'guide', 'safety', 'insights', 'motivation'] as const

const RADIUS = 38

export function AgentsDiagram() {
  const { t } = useI18n()

  const nodes = AGENTS.map((agent, index) => {
    const angle = (-90 + index * 60) * (Math.PI / 180)
    const cx = 50 + RADIUS * Math.cos(angle)
    const cy = 50 + RADIUS * Math.sin(angle)
    return { ...agent, cx, cy, index }
  })

  return (
    <section className="landing720-hub" id="how">
      <div className="landing720-hub-head">
        <span className="landing720-eyebrow">
          <MappingIcon width={16} height={16} />
          {t('landing.hub.eyebrow')}
        </span>
        <h2>{t('landing.hub.title')}</h2>
        <p>{t('landing.hub.subtitle')}</p>
      </div>

      <div className="landing720-hub-stage">
        <svg className="landing720-hub-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <radialGradient id="l720-hub-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(43, 86, 245, 0.16)" />
              <stop offset="100%" stopColor="rgba(43, 86, 245, 0)" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="50" r="30" fill="url(#l720-hub-glow)" />
          {nodes.map((node) => (
            <line
              key={`line-${node.key}`}
              x1="50"
              y1="50"
              x2={node.cx}
              y2={node.cy}
              className="landing720-hub-link"
            />
          ))}
          <circle cx="50" cy="50" r={RADIUS} className="landing720-hub-orbit" />
          {nodes.map((node) => (
            <circle key={`out-${node.key}`} r="1.1" className="landing720-hub-packet">
              <animateMotion
                dur="3.4s"
                begin={`${node.index * 0.4}s`}
                repeatCount="indefinite"
                path={`M50 50 L ${node.cx} ${node.cy}`}
              />
            </circle>
          ))}
          {nodes.map((node) => (
            <circle key={`in-${node.key}`} r="0.9" className="landing720-hub-packet return">
              <animateMotion
                dur="3.4s"
                begin={`${node.index * 0.4 + 1.7}s`}
                repeatCount="indefinite"
                path={`M${node.cx} ${node.cy} L50 50`}
              />
            </circle>
          ))}
        </svg>

        <div className="landing720-hub-core">
          <span className="landing720-hub-core-pulse" aria-hidden="true" />
          <span className="landing720-hub-core-pulse delay" aria-hidden="true" />
          <strong>{t('landing.hub.coreTitle')}</strong>
          <span>{t('landing.hub.coreSubtitle')}</span>
        </div>

        {nodes.map((node) => (
          <article
            key={node.key}
            className={`landing720-hub-node tone-${node.tone}`}
            style={{ '--x': `${node.cx}%`, '--y': `${node.cy}%`, '--delay': `${node.index * 0.12}s` } as React.CSSProperties}
          >
            <span className="landing720-hub-icon">
              <node.Icon />
            </span>
            <div className="landing720-hub-text">
              <strong>{t(`landing.hub.${node.key}.title`)}</strong>
              <span>{t(`landing.hub.${node.key}.desc`)}</span>
            </div>
          </article>
        ))}
      </div>

      <div className="landing720-hub-summary">
        <p>{t('landing.hub.summary')}</p>
        <div className="landing720-hub-chips">
          {CHIPS.map((chip) => (
            <span key={chip}>{t(`landing.hub.chip.${chip}`)}</span>
          ))}
        </div>
      </div>
    </section>
  )
}
