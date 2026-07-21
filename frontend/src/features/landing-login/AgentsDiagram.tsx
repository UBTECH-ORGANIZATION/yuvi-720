import type { SVGProps } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import sparkMarkUrl from '../../assets/yuvi-favicon.png'

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

const RADIUS = 38

// One full trip (core -> agent) in seconds. Slow, calm, non-distracting.
const FLOW_DUR = 4.2

// RGB triplets per tone so the SVG energy lines / packets and the node pulse
// ring share one accent colour per connection.
const TONE_RGB: Record<(typeof AGENTS)[number]['tone'], string> = {
  blue: '43, 86, 245',
  teal: '13, 143, 130',
  purple: '110, 91, 214',
  orange: '201, 119, 42',
  indigo: '75, 82, 201',
  pink: '196, 81, 127'
}

// Layered neural "brain" rendered as SVG inside the glass core. Three depth
// layers (back / mid / front) give parallax so it reads as a volume you could
// step into. Nodes are blue / violet — never flat white.
type BrainNode = { x: number; y: number; r: number; hue: 'a' | 'b'; flicker: boolean; delay: number; dur: number }
type BrainLink = { x1: number; y1: number; x2: number; y2: number }
type BrainLayer = { nodes: BrainNode[]; links: BrainLink[] }

function buildBrain(): BrainLayer[] {
  // Seeded LCG so the layout is stable across renders (no hydration drift).
  let seed = 20260721
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  const specs = [
    { count: 15, maxR: 29, size: 0.5, linkDist: 15 }, // back
    { count: 20, maxR: 39, size: 0.72, linkDist: 15 }, // mid
    { count: 15, maxR: 46, size: 0.98, linkDist: 14 } // front
  ]
  return specs.map((spec) => {
    const nodes: BrainNode[] = []
    for (let i = 0; i < spec.count; i++) {
      const angle = rand() * Math.PI * 2
      const radius = Math.sqrt(rand()) * spec.maxR
      nodes.push({
        x: 50 + radius * Math.cos(angle),
        y: 50 + radius * Math.sin(angle),
        r: spec.size * (0.8 + rand() * 0.55),
        hue: rand() < 0.5 ? 'a' : 'b',
        flicker: rand() < 0.4,
        delay: rand() * 5,
        dur: 3.4 + rand() * 2.6
      })
    }
    const links: BrainLink[] = []
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y)
        if (d < spec.linkDist) {
          links.push({ x1: nodes[i].x, y1: nodes[i].y, x2: nodes[j].x, y2: nodes[j].y })
        }
      }
    }
    return { nodes, links }
  })
}

const BRAIN = buildBrain()
const BRAIN_LAYER_NAMES = ['back', 'mid', 'front'] as const

export function AgentsDiagram() {
  const { t } = useI18n()

  const nodes = AGENTS.map((agent, index) => {
    const angleDeg = -90 + index * 60
    const angle = angleDeg * (Math.PI / 180)
    const cx = 50 + RADIUS * Math.cos(angle)
    const cy = 50 + RADIUS * Math.sin(angle)
    // Stagger each connection evenly around the ring so packets ripple outward
    // like a rotating wave rather than all firing at once.
    const begin = (index * FLOW_DUR) / AGENTS.length
    return { ...agent, cx, cy, angleDeg, index, rgb: TONE_RGB[agent.tone], begin }
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
            <filter id="l720-hub-line-blur" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="0.85" />
            </filter>
          </defs>
          <circle cx="50" cy="50" r="30" fill="url(#l720-hub-glow)" />

          {/* Soft glow that hugs each fiber line */}
          {nodes.map((node) => (
            <line
              key={`glow-${node.key}`}
              x1="50"
              y1="50"
              x2={node.cx}
              y2={node.cy}
              className="landing720-hub-link-glow"
              filter="url(#l720-hub-line-blur)"
              style={{ stroke: `rgba(${node.rgb}, 0.16)` } as React.CSSProperties}
            />
          ))}

          {/* Thin continuous fiber line; brightens a little as its light nears the core */}
          {nodes.map((node) => (
            <line
              key={`line-${node.key}`}
              x1="50"
              y1="50"
              x2={node.cx}
              y2={node.cy}
              className="landing720-hub-link"
              style={{ stroke: `rgb(${node.rgb})` } as React.CSSProperties}
            >
              <animate
                attributeName="stroke-opacity"
                dur={`${FLOW_DUR}s`}
                begin={`${node.begin}s`}
                repeatCount="indefinite"
                values="0.2;0.2;0.5;0.22"
                keyTimes="0;0.6;0.92;1"
              />
            </line>
          ))}

          <circle cx="50" cy="50" r={RADIUS} className="landing720-hub-orbit" />

          {/* A single tiny light travelling along the fiber into the core */}
          {nodes.map((node) => (
            <circle
              key={`spark-${node.key}`}
              r="0.5"
              className="landing720-hub-spark"
              style={{
                fill: `rgb(${node.rgb})`,
                filter: `drop-shadow(0 0 1.6px rgba(${node.rgb}, 0.95))`
              } as React.CSSProperties}
            >
              <animateMotion
                dur={`${FLOW_DUR}s`}
                begin={`${node.begin}s`}
                repeatCount="indefinite"
                calcMode="spline"
                keyPoints="0;1"
                keyTimes="0;1"
                keySplines="0.4 0 0.6 1"
                path={`M${node.cx} ${node.cy} L50 50`}
              />
              <animate
                attributeName="opacity"
                dur={`${FLOW_DUR}s`}
                begin={`${node.begin}s`}
                repeatCount="indefinite"
                values="0;1;1;0.9;0"
                keyTimes="0;0.08;0.7;0.92;1"
              />
              <animate
                attributeName="r"
                dur={`${FLOW_DUR}s`}
                begin={`${node.begin}s`}
                repeatCount="indefinite"
                values="0.42;0.5;0.72"
                keyTimes="0;0.7;1"
              />
            </circle>
          ))}
        </svg>

        <span className="landing720-hub-core-energy" aria-hidden="true" />
        <span className="landing720-hub-core-shadow" aria-hidden="true" />

        <div className="landing720-hub-core" style={{ '--arrival': `${FLOW_DUR / AGENTS.length}s` } as React.CSSProperties}>
          <span className="landing720-hub-core-ring" aria-hidden="true" />
          <span className="landing720-hub-core-ring delay" aria-hidden="true" />
          <span className="landing720-hub-core-texture" aria-hidden="true" />
          <svg
            className="landing720-hub-core-net"
            viewBox="0 0 100 100"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
          >
            <defs>
              <clipPath id="l720-core-clip">
                <circle cx="50" cy="50" r="49" />
              </clipPath>
              <filter id="l720-core-soft" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="0.45" />
              </filter>
            </defs>
            <g clipPath="url(#l720-core-clip)">
              {BRAIN.map((layer, li) => {
                const name = BRAIN_LAYER_NAMES[li]
                return (
                  <g
                    key={`layer-${name}`}
                    className={`landing720-hub-core-layer ${name}`}
                    filter={name === 'back' ? 'url(#l720-core-soft)' : undefined}
                  >
                    {layer.links.map((link, i) => (
                      <line
                        key={`e-${name}-${i}`}
                        x1={link.x1}
                        y1={link.y1}
                        x2={link.x2}
                        y2={link.y2}
                        className="landing720-hub-core-edge"
                      />
                    ))}
                    {layer.nodes.map((n, i) => (
                      <circle
                        key={`n-${name}-${i}`}
                        cx={n.x}
                        cy={n.y}
                        r={n.r}
                        className={`landing720-hub-core-node hue-${n.hue}${n.flicker ? ' flicker' : ''}`}
                        style={{
                          animationDelay: `${n.delay}s`,
                          animationDuration: `${n.dur}s`
                        } as React.CSSProperties}
                      />
                    ))}
                  </g>
                )
              })}
            </g>
          </svg>
          <span className="landing720-hub-core-reflection" aria-hidden="true" />
          <span className="landing720-hub-core-arrival" aria-hidden="true" />
          <img className="landing720-hub-core-logo" src={sparkMarkUrl} alt={t('landing.hub.coreTitle')} />
        </div>

        {nodes.map((node) => (
          <article
            key={node.key}
            className={`landing720-hub-node tone-${node.tone}`}
            style={{
              '--x': `${node.cx}%`,
              '--y': `${node.cy}%`,
              '--angle': `${node.angleDeg}deg`,
              '--delay': `${node.index * 0.12}s`,
              '--tone': node.rgb,
              '--flow': `${FLOW_DUR}s`,
              '--pulse-delay': `${node.begin}s`
            } as React.CSSProperties}
          >
            <span className="landing720-hub-node-port" aria-hidden="true" />
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
    </section>
  )
}
