import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import type { LearningComponentDTO, LearningUnitDTO } from '../../services/learning'

interface RoadmapPoint {
  component: LearningComponentDTO
  stageIndex: number
  xPercent: number
  yPx: number
  depth: number
}

interface LearningRoadmapProps {
  unit: LearningUnitDTO
  activeComponentId?: string | null
  travellingFromId?: string | null
  compact?: boolean
  cinematic?: boolean
  onSelect?: (component: LearningComponentDTO) => void
  onTravelComplete?: () => void
}

interface RoadmapDebugState {
  enabled: boolean
  flightProgress: number | null
  fromId: string | null
  toId: string | null
}

function purposeKey(component: LearningComponentDTO) {
  if (component.is_assessment) return 'learning.component.assessment'
  if (component.purpose === 'instruction') return 'learning.component.instruction'
  if (component.purpose === 'practice') return 'learning.component.practice'
  return 'learning.component.activity'
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function pathBetween(source: RoadmapPoint, destination: RoadmapPoint) {
  const direction = Math.sign(destination.yPx - source.yPx) || -1
  const startY = source.yPx + direction * 42
  const endY = destination.yPx - direction * 42
  const distance = endY - startY
  return [
    `M ${source.xPercent} ${startY}`,
    `C ${source.xPercent} ${startY + distance * .42}`,
    `${destination.xPercent} ${startY + distance * .58}`,
    `${destination.xPercent} ${endY}`,
  ].join(' ')
}

/**
 * A provider-ordered, Duolingo-style path. The route itself uses SVG/CSS so
 * each card does not allocate a WebGL context. Progress states still come
 * exclusively from Brain/xAPI.
 */
export function LearningRoadmap({
  unit,
  activeComponentId,
  travellingFromId,
  compact = false,
  cinematic = false,
  onSelect,
  onTravelComplete,
}: LearningRoadmapProps) {
  const { t } = useI18n()
  const scrollRef = useRef<HTMLElement>(null)
  const [roadmapReady, setRoadmapReady] = useState(false)

  const components = useMemo(
    () => [...unit.components].sort((first, second) => (
      (first.order ?? 0) - (second.order ?? 0) || first.id.localeCompare(second.id)
    )),
    [unit.components],
  )

  const debug = useMemo<RoadmapDebugState>(() => {
    const params = new URLSearchParams(window.location.search)
    const rawProgress = params.get('roadmapFlight')
    const progressValue = rawProgress == null ? Number.NaN : Number(rawProgress)
    return {
      enabled: params.get('roadmapDebug') === '1',
      flightProgress: Number.isFinite(progressValue) ? clamp(progressValue, 0, 1) : null,
      fromId: params.get('roadmapFrom'),
      toId: params.get('roadmapTo'),
    }
  }, [])

  const stages = useMemo(() => {
    const grouped = new Map<string, LearningComponentDTO[]>()
    components.forEach((component, index) => {
      const key = component.order == null ? `component:${index}` : `order:${component.order}`
      grouped.set(key, [...(grouped.get(key) ?? []), component])
    })
    return [...grouped.values()]
  }, [components])

  const stageGap = compact ? 142 : 154
  const trackHeight = Math.max(compact ? 570 : 610, 122 + stages.length * stageGap)
  const points = useMemo<RoadmapPoint[]>(() => {
    const singlePositions = [58, 74, 58, 42]
    return stages.flatMap((stageComponents, stageIndex) => {
      const depth = stages.length <= 1 ? 1 : 1 - stageIndex / (stages.length - 1)
      return stageComponents.map((component, alternativeIndex) => {
        const alternativeCount = stageComponents.length
        const xPercent = alternativeCount === 1
          ? singlePositions[stageIndex % singlePositions.length]
          : 38 + (alternativeIndex / Math.max(1, alternativeCount - 1)) * 36
        return {
          component,
          stageIndex,
          xPercent,
          yPx: trackHeight - 152 - stageIndex * stageGap,
          depth,
        }
      })
    })
  }, [stageGap, stages, trackHeight])

  const activeComponent = components.find((component) => component.id === activeComponentId)
  const brainCurrent = components.find((component) => component.id === unit.current_component_id)
  const firstRoutable = components.find((component) => (
    component.progress_state === 'current' || component.progress_state === 'available'
  ))
  const lastCompleted = [...components].reverse().find((component) => component.progress_state === 'completed')
  const debugFromId = debug.enabled && debug.flightProgress != null
    ? debug.fromId || lastCompleted?.id
    : null
  const effectiveTravellingFromId = travellingFromId || debugFromId
  const currentComponentId = effectiveTravellingFromId
    || (activeComponent?.progress_state !== 'completed' ? activeComponent?.id : null)
    || (brainCurrent?.progress_state === 'current' ? brainCurrent.id : null)
    || unit.next_component_id
    || firstRoutable?.id
    || lastCompleted?.id
    || components[0]?.id
  const currentPoint = points.find((point) => point.component.id === currentComponentId)
  const destinationId = debug.enabled && debug.toId ? debug.toId : unit.next_component_id
  const nextPoint = points.find((point) => (
    point.component.id === destinationId && point.component.id !== effectiveTravellingFromId
  )) || points.find((point) => (
    point.stageIndex === (currentPoint?.stageIndex ?? -1) + 1
    && point.component.progress_state !== 'locked'
  ))

  const connections = useMemo(() => stages.slice(0, -1).flatMap((_stage, stageIndex) => {
    const sources = points.filter((point) => point.stageIndex === stageIndex)
    const destinations = points.filter((point) => point.stageIndex === stageIndex + 1)
    return sources.flatMap((source) => destinations.map((destination) => ({ source, destination })))
  }), [points, stages])

  const markerIdPrefix = useMemo(
    () => `roadmap-arrow-${unit.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
    [unit.id],
  )

  useEffect(() => {
    const revealFrame = window.requestAnimationFrame(() => setRoadmapReady(true))
    return () => window.cancelAnimationFrame(revealFrame)
  }, [])

  useEffect(() => {
    const viewport = scrollRef.current
    if (!viewport || !currentPoint) return
    if (!compact && !cinematic) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'auto' })
      return
    }
    const target = currentPoint.yPx - viewport.clientHeight * .48
    viewport.scrollTo({ top: Math.max(0, target), behavior: cinematic ? 'smooth' : 'auto' })
  }, [cinematic, compact, currentPoint])

  return (
    <section
      ref={scrollRef}
      className={`learning-roadmap learning-roadmap--path${compact ? ' learning-roadmap--panel' : ''}${cinematic ? ' learning-roadmap--cinematic' : ''}${effectiveTravellingFromId ? ' is-travelling' : ''}${debug.enabled ? ' is-debug' : ''}${debug.flightProgress != null ? ' is-debug-flight' : ''}${roadmapReady ? ' is-ready' : ' is-loading'}`}
      data-roadmap-unit={unit.id}
      style={{
        '--roadmap-debug-delay': debug.flightProgress == null
          ? '0ms'
          : `${debug.flightProgress * -1200}ms`,
      } as CSSProperties}
      aria-label={t('learning.roadmap.label', { title: unit.title })}
      aria-busy={!roadmapReady}
    >
      <div className="learning-path__track" style={{ '--roadmap-track-height': `${trackHeight}px` } as CSSProperties}>
        <svg
          className="learning-path__routes"
          viewBox={`0 0 100 ${trackHeight}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            {(['completed', 'open', 'locked'] as const).map((state) => (
              <marker
                id={`${markerIdPrefix}-${state}`}
                markerWidth="16"
                markerHeight="16"
                refX="14"
                refY="8"
                viewBox="0 0 16 16"
                orient="auto"
                markerUnits="userSpaceOnUse"
                key={state}
              >
                <path d="M 1 1 L 15 8 L 1 15 L 4.5 8 Z" className={`learning-path__arrow is-${state}`} />
              </marker>
            ))}
          </defs>
          {connections.map(({ source, destination }) => {
            const isCompleted = source.component.progress_state === 'completed'
              && destination.component.progress_state === 'completed'
            const isOpen = destination.component.progress_state !== 'locked'
            const routeState = isCompleted ? 'completed' : isOpen ? 'open' : 'locked'
            const isTravelling = effectiveTravellingFromId === source.component.id
              && nextPoint?.component.id === destination.component.id
            const routeKey = `${source.component.id}-${destination.component.id}`
            return (
              <g key={routeKey}>
                <path
                  className={`learning-path__route-shadow is-${routeState}`}
                  d={pathBetween(source, destination)}
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  className={`learning-path__route is-${routeState}${isTravelling ? ' is-travelling' : ''}`}
                  d={pathBetween(source, destination)}
                  markerEnd={`url(#${markerIdPrefix}-${routeState})`}
                  vectorEffect="non-scaling-stroke"
                  onAnimationEnd={(event) => {
                    if (!debug.enabled && event.animationName === 'learning-path-route-travel') onTravelComplete?.()
                  }}
                />
              </g>
            )
          })}
        </svg>

        <div className="learning-path__depth-grid" aria-hidden="true">
          {stages.map((_stage, stageIndex) => (
            <i
              style={{
                '--roadmap-y-px': `${trackHeight - 152 - stageIndex * stageGap}px`,
                '--stage-depth': stages.length <= 1 ? 1 : 1 - stageIndex / (stages.length - 1),
                '--stage-width': `${52 + (stages.length <= 1 ? 1 : 1 - stageIndex / (stages.length - 1)) * 24}%`,
              } as CSSProperties}
              key={`depth-${stageIndex}`}
            />
          ))}
        </div>

        {points.map((point) => {
          const { component, stageIndex, xPercent, yPx, depth } = point
          const disabled = !roadmapReady || component.progress_state === 'locked' || !onSelect
          const isCurrent = component.id === currentComponentId
          return (
            <button
              type="button"
              className={`learning-path__stage is-${component.progress_state}${component.id === activeComponentId ? ' is-active' : ''}${isCurrent ? ' is-yuvi' : ''}`}
              style={{
                '--roadmap-x': `${xPercent}%`,
                '--roadmap-y-px': `${yPx}px`,
                '--stage-depth': depth,
                '--stage-scale': .76 + depth * .28,
              } as CSSProperties}
              data-roadmap-debug={`${stageIndex + 1} · ${component.order ?? '—'}`}
              data-roadmap-component={component.id}
              data-roadmap-state={component.progress_state}
              disabled={disabled}
              onClick={() => onSelect?.(component)}
              aria-label={`${stageIndex + 1}. ${component.title}. ${t(`learning.roadmap.state.${component.progress_state}`)}`}
              key={component.id}
            >
              {isCurrent && <span className="learning-path__current-flag">{t('learning.roadmap.next')}</span>}
              <span className="learning-path__node" aria-hidden="true">
                <span className="learning-path__node-top">
                  {stageIndex + 1}
                </span>
                <span className="learning-path__node-base" />
                {component.progress_state === 'completed' && <span className="learning-path__completed-mark">✓</span>}
              </span>
              <span className="learning-path__stage-copy">
                <strong dir="auto">{component.title}</strong>
                <small>{t(purposeKey(component))}</small>
                <em>{t(`learning.roadmap.state.${component.progress_state}`)}</em>
              </span>
            </button>
          )
        })}

        <p className="learning-path__hint">{t('learning.roadmap.worldHint')}</p>
      </div>
    </section>
  )
}
