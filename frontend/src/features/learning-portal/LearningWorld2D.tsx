import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { YubiAvatar3D } from '../yubi-studio/YubiAvatar3D'
import type { YubiDesign } from '../yubi-studio/yubiDesign'
import type { LearningWorldLandmark, LearningWorldModel } from './learningWorldModel'
import type { LearningWorldHandle, LearningWorldStats } from './learningWorldRenderer'

interface LearningWorld2DProps {
  world: LearningWorldModel
  design: YubiDesign
  lowPower: boolean
  reducedMotion: boolean
  debug: boolean
  simulate: string | null
  selectedLandmarkId: string | null
  ariaLabel: string
  onLandmarkSelect: (landmarkId: string) => void
  onYubiInteract: () => void
  onReady: () => void
  onStats: (stats: LearningWorldStats) => void
}

type BuildingKind = 'cottage' | 'dome' | 'greenhouse' | 'tent' | 'tower'
type Heading = 'down' | 'left' | 'right' | 'up'

interface MapStop extends LearningWorldLandmark {
  mapX: number
  mapY: number
  building: BuildingKind
  islandIndex: number
}

interface IslandLayout {
  index: number
  unitId: string
  unitTitle: string
  centerX: number
  centerY: number
  rx: number
  ry: number
  stops: MapStop[]
  completed: boolean
  revealed: boolean
  trail: string
}

interface BridgeLayout {
  index: number
  startX: number
  startY: number
  endX: number
  endY: number
  angle: number
  length: number
  unlocked: boolean
}

interface WorldLayout {
  width: number
  height: number
  islands: IslandLayout[]
  bridges: BridgeLayout[]
  stops: MapStop[]
}

interface Point {
  x: number
  y: number
}

interface TravelPlan {
  points: Point[]
  blockedBridgeIndex: number | null
  onComplete?: () => void
}

interface Decoration {
  id: string
  kind: 'bush' | 'fence' | 'flag' | 'flower' | 'pine' | 'rock' | 'tree'
  x: number
  y: number
  scale: number
  tone: number
}

const DEFAULT_ZOOM = 1
const MIN_ZOOM = .74
const MAX_ZOOM = 1.3
const PLAYER_SPEED = 300
const BRIDGE_LENGTH = 330
const BRIDGE_HALF_WIDTH = 52
const BUILDINGS: BuildingKind[] = ['cottage', 'tent', 'tower', 'greenhouse', 'dome']

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

function hashValue(index: number, salt: number) {
  const value = Math.sin(index * 91.731 + salt * 17.413) * 43758.5453
  return value - Math.floor(value)
}

function headingFor(dx: number, dy: number): Heading {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right'
  return dy < 0 ? 'up' : 'down'
}

function edgePoint(island: IslandLayout, towardX: number, towardY: number, inset: number): Point {
  const angle = Math.atan2(towardY - island.centerY, towardX - island.centerX)
  return {
    x: island.centerX + Math.cos(angle) * (island.rx - inset),
    y: island.centerY + Math.sin(angle) * (island.ry - inset),
  }
}

/**
 * One island per content unit, chained by bridges — the Cuphead-style
 * overworld structure. Completion/reveal states come from the backend
 * progress states only; nothing here invents progress.
 */
function buildWorldLayout(world: LearningWorldModel): WorldLayout {
  const margin = 620
  const islands: IslandLayout[] = []
  let cursorX = margin
  let previousCenterY = 0

  world.units.forEach((unit, index) => {
    const unitLandmarks = world.landmarks
      .filter((landmark) => landmark.unit.id === unit.id)
      .sort((first, second) => first.displayIndex - second.displayIndex)
    const stopCount = Math.max(1, unitLandmarks.length)
    const rx = clamp(330 + stopCount * 52, 380, 620)
    const ry = rx * .74
    const centerX = cursorX + rx
    const centerY = 900 + (index % 2 === 0 ? 0 : 230) + Math.sin(index * 1.7) * 60

    const stops = unitLandmarks.map<MapStop>((landmark, stopIndex) => {
      const t = stopCount === 1 ? .5 : stopIndex / (stopCount - 1)
      const wiggle = Math.sin(t * Math.PI * 2.1 + index) * .34
      return {
        ...landmark,
        islandIndex: index,
        mapX: centerX + (t - .5) * rx * 1.16 * .82 + wiggle * rx * .2,
        mapY: centerY + Math.sin(t * Math.PI * 1.9 + .5 + index * .8) * ry * .42,
        building: BUILDINGS[(landmark.unitIndex * 2 + landmark.stageIndex + landmark.alternativeIndex) % BUILDINGS.length],
      }
    })

    const completed = unitLandmarks.length > 0
      && unitLandmarks.every(({ component }) => component.progress_state === 'completed')

    const trailPoints = stops.map((stop) => ({ x: stop.mapX, y: stop.mapY + 96 }))
    const trail = trailPoints.length < 2 ? '' : trailPoints.reduce((path, point, pointIndex) => {
      if (pointIndex === 0) return `M ${point.x} ${point.y}`
      const previous = trailPoints[pointIndex - 1]
      const midX = (previous.x + point.x) / 2
      return `${path} Q ${midX} ${previous.y}, ${point.x} ${point.y}`
    }, '')

    islands.push({
      index,
      unitId: unit.id,
      unitTitle: unit.title,
      centerX,
      centerY,
      rx,
      ry,
      stops,
      completed,
      revealed: false,
      trail,
    })
    cursorX = centerX + rx + BRIDGE_LENGTH
    previousCenterY = centerY
  })

  void previousCenterY
  const bridges: BridgeLayout[] = []
  islands.slice(0, -1).forEach((island, index) => {
    const next = islands[index + 1]
    const start = edgePoint(island, next.centerX, next.centerY, 46)
    const end = edgePoint(next, island.centerX, island.centerY, 46)
    // Backend truth decides reachability: a bridge opens when this island is
    // fully completed, or when the backend already exposes non-locked content
    // on the far side (the world never locks content the backend allows).
    const unlocked = island.completed
      || next.stops.some(({ component }) => component.progress_state !== 'locked')
    bridges.push({
      index,
      startX: start.x,
      startY: start.y,
      endX: end.x,
      endY: end.y,
      angle: Math.atan2(end.y - start.y, end.x - start.x),
      length: Math.hypot(end.x - start.x, end.y - start.y),
      unlocked,
    })
  })

  islands.forEach((island, index) => {
    island.revealed = index === 0 || bridges[index - 1]?.unlocked === true
  })

  const maxX = islands.length ? Math.max(...islands.map((island) => island.centerX + island.rx)) : 1200
  const maxY = islands.length ? Math.max(...islands.map((island) => island.centerY + island.ry)) : 1000
  return {
    width: Math.max(2000, maxX + margin),
    height: Math.max(1700, maxY + 560),
    islands,
    bridges,
    stops: islands.flatMap((island) => island.stops),
  }
}

function createIslandDecorations(island: IslandLayout, lowPower: boolean) {
  const decorations: Decoration[] = []
  const count = lowPower ? 14 : 24
  const kinds: Decoration['kind'][] = ['tree', 'pine', 'bush', 'flower', 'rock', 'fence', 'flag']
  for (let index = 0; index < count * 4 && decorations.length < count; index += 1) {
    const angle = hashValue(index, island.index * 7 + 3) * Math.PI * 2
    const radial = .42 + hashValue(index, island.index * 11 + 5) * .5
    const x = island.centerX + Math.cos(angle) * island.rx * radial
    const y = island.centerY + Math.sin(angle) * island.ry * radial
    const nearStop = island.stops.some((stop) => Math.hypot(stop.mapX - x, stop.mapY - y) < 168)
    if (nearStop) continue
    decorations.push({
      id: `${island.unitId}-${index}`,
      kind: kinds[Math.floor(hashValue(index, 41) * kinds.length)],
      x,
      y,
      scale: .66 + hashValue(index, 53) * .66,
      tone: Math.floor(hashValue(index, 67) * 4),
    })
  }
  return decorations
}

function Building({
  stop,
  revealed,
  selected,
  blocked,
  onSelect,
}: {
  stop: MapStop
  revealed: boolean
  selected: boolean
  blocked: boolean
  onSelect: (landmarkId: string) => void
}) {
  const { t } = useI18n()
  if (!revealed) return null
  const state = stop.component.progress_state
  return (
    <button
      className={`lw-building lw-building--${stop.building} is-${state}${selected ? ' is-selected' : ''}${blocked ? ' is-blocked' : ''}`}
      style={{ left: stop.mapX, top: stop.mapY, zIndex: Math.floor(stop.mapY) } as CSSProperties}
      type="button"
      aria-disabled={state === 'locked'}
      aria-label={`${stop.displayIndex}. ${stop.component.title}. ${t(`learning.roadmap.state.${state}`)}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(stop.id)
      }}
    >
      <span className="lw-building__shadow" aria-hidden="true" />
      <span className="lw-building__art" aria-hidden="true">
        <i className="lw-building__base">
          <b className="lw-building__window" />
          <b className="lw-building__door" />
        </i>
        <i className="lw-building__roof" />
        <i className="lw-building__top" />
      </span>
      <span className={`lw-building__flag is-${state}`} aria-hidden="true"><i /></span>
      <span className="lw-building__number" aria-hidden="true">{stop.displayIndex}</span>
      <span className="lw-building__label" dir="auto">
        <strong>{stop.component.title}</strong>
        <small>{t(`learning.roadmap.state.${state}`)}</small>
      </span>
    </button>
  )
}

export const LearningWorld2D = forwardRef<LearningWorldHandle, LearningWorld2DProps>(function LearningWorld2D({
  world,
  design,
  lowPower,
  reducedMotion,
  debug,
  simulate,
  selectedLandmarkId,
  ariaLabel,
  onLandmarkSelect,
  onYubiInteract,
  onReady,
  onStats,
}, ref) {
  const { t } = useI18n()
  const viewportRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  const layout = useMemo(() => buildWorldLayout(world), [world])
  const decorations = useMemo(
    () => layout.islands.filter((island) => island.revealed).flatMap((island) => createIslandDecorations(island, lowPower)),
    [layout, lowPower],
  )
  const stopsById = useMemo(() => new Map(layout.stops.map((stop) => [stop.id, stop])), [layout])
  const keysRef = useRef(new Set<string>())
  const planRef = useRef<TravelPlan | null>(null)
  const positionRef = useRef<Point>({ x: layout.width / 2, y: layout.height / 2 })
  const cameraRef = useRef<Point>({ x: 0, y: 0 })
  const zoomRef = useRef(DEFAULT_ZOOM)
  const animationRef = useRef(0)
  const blockedTimerRef = useRef<number | null>(null)
  const [heading, setHeading] = useState<Heading>('down')
  const [moving, setMoving] = useState(false)
  const [blockedStopId, setBlockedStopId] = useState<string | null>(null)
  const [blockedBridgeIndex, setBlockedBridgeIndex] = useState<number | null>(null)
  const [sectionIndex, setSectionIndex] = useState(0)
  const [zoomLabel, setZoomLabel] = useState(DEFAULT_ZOOM)
  const headingRef = useRef<Heading>('down')
  const movingRef = useRef(false)
  const sectionRef = useRef(0)

  const islandIndexAt = useCallback((x: number, y: number) => layout.islands.findIndex((island) => {
    const nx = (x - island.centerX) / (island.rx * .94)
    const ny = (y - island.centerY) / (island.ry * .92)
    return nx * nx + ny * ny <= 1
  }), [layout.islands])

  const onBridge = useCallback((x: number, y: number, requireUnlocked: boolean) => layout.bridges.some((bridge) => {
    if (requireUnlocked && !bridge.unlocked) return false
    const dx = bridge.endX - bridge.startX
    const dy = bridge.endY - bridge.startY
    const lengthSq = dx * dx + dy * dy
    if (!lengthSq) return false
    const along = clamp(((x - bridge.startX) * dx + (y - bridge.startY) * dy) / lengthSq, 0, 1)
    const px = bridge.startX + dx * along
    const py = bridge.startY + dy * along
    return Math.hypot(x - px, y - py) <= BRIDGE_HALF_WIDTH
  }), [layout.bridges])

  const isWalkable = useCallback((x: number, y: number) => {
    const island = islandIndexAt(x, y)
    if (island >= 0 && layout.islands[island].revealed) {
      const nearBuilding = layout.islands[island].stops.some((stop) => (
        Math.abs(stop.mapX - x) < 84 && stop.mapY - y > -4 && stop.mapY - y < 96
      ))
      return !nearBuilding
    }
    return onBridge(x, y, true)
  }, [islandIndexAt, layout.islands, onBridge])

  /** Waypoint route across the island chain; stops at the first locked bridge. */
  const routeTo = useCallback((target: Point): TravelPlan => {
    const position = positionRef.current
    const fromIsland = Math.max(0, islandIndexAt(position.x, position.y))
    const toIsland = islandIndexAt(target.x, target.y)
    if (toIsland < 0 || toIsland === fromIsland) {
      return { points: [target], blockedBridgeIndex: null }
    }
    const step = toIsland > fromIsland ? 1 : -1
    const points: Point[] = []
    for (let index = fromIsland; index !== toIsland; index += step) {
      const bridge = layout.bridges[step > 0 ? index : index - 1]
      if (!bridge) break
      const entry = step > 0
        ? { x: bridge.startX, y: bridge.startY }
        : { x: bridge.endX, y: bridge.endY }
      const exit = step > 0
        ? { x: bridge.endX, y: bridge.endY }
        : { x: bridge.startX, y: bridge.startY }
      if (!bridge.unlocked) {
        points.push(entry)
        return { points, blockedBridgeIndex: bridge.index }
      }
      points.push(entry, exit)
    }
    points.push(target)
    return { points, blockedBridgeIndex: null }
  }, [islandIndexAt, layout.bridges])

  useEffect(() => {
    const start = stopsById.get(world.currentLandmarkId ?? '')
      ?? stopsById.get(world.recommendedLandmarkId ?? '')
      ?? layout.stops[0]
    positionRef.current = start
      ? { x: start.mapX, y: start.mapY + 118 }
      : { x: layout.islands[0]?.centerX ?? layout.width / 2, y: layout.islands[0]?.centerY ?? layout.height / 2 }
    planRef.current = null
    cameraRef.current = { x: 0, y: 0 }
    zoomRef.current = DEFAULT_ZOOM
    setZoomLabel(DEFAULT_ZOOM)
    const startIsland = Math.max(0, islandIndexAt(positionRef.current.x, positionRef.current.y))
    sectionRef.current = startIsland
    setSectionIndex(startIsland)
  }, [islandIndexAt, layout, stopsById, world.currentLandmarkId, world.recommendedLandmarkId])

  const setMovementVisual = useCallback((nextHeading: Heading, nextMoving: boolean) => {
    if (headingRef.current !== nextHeading) {
      headingRef.current = nextHeading
      setHeading(nextHeading)
    }
    if (movingRef.current !== nextMoving) {
      movingRef.current = nextMoving
      setMoving(nextMoving)
    }
  }, [])

  const flashBlocked = useCallback((stopId: string | null, bridgeIndex: number | null) => {
    setBlockedStopId(stopId)
    setBlockedBridgeIndex(bridgeIndex)
    if (blockedTimerRef.current != null) window.clearTimeout(blockedTimerRef.current)
    blockedTimerRef.current = window.setTimeout(() => {
      setBlockedStopId(null)
      setBlockedBridgeIndex(null)
    }, reducedMotion ? 320 : 1500)
  }, [reducedMotion])

  const travelToStop = useCallback((landmarkId: string, onComplete?: () => void) => {
    const stop = stopsById.get(landmarkId)
    if (!stop) return
    const plan = routeTo({ x: stop.mapX, y: stop.mapY + 118 })
    if (reducedMotion) {
      const destination = plan.points[plan.points.length - 1]
      if (destination) positionRef.current = destination
      if (plan.blockedBridgeIndex != null) flashBlocked(landmarkId, plan.blockedBridgeIndex)
      else onComplete?.()
      return
    }
    planRef.current = {
      ...plan,
      onComplete: plan.blockedBridgeIndex != null
        ? () => flashBlocked(landmarkId, plan.blockedBridgeIndex)
        : onComplete,
    }
  }, [flashBlocked, reducedMotion, routeTo, stopsById])

  useImperativeHandle(ref, () => ({
    focus: (landmarkId) => travelToStop(landmarkId),
    resetCamera: () => {
      planRef.current = null
      zoomRef.current = DEFAULT_ZOOM
      setZoomLabel(DEFAULT_ZOOM)
    },
    travelTo: (landmarkId, onComplete) => travelToStop(landmarkId, onComplete),
    showBlocked: (landmarkId) => {
      const stop = stopsById.get(landmarkId)
      const plan = stop ? routeTo({ x: stop.mapX, y: stop.mapY + 118 }) : null
      flashBlocked(landmarkId, plan?.blockedBridgeIndex ?? null)
      if (stop && plan?.blockedBridgeIndex != null && !reducedMotion) planRef.current = plan
    },
  }), [flashBlocked, reducedMotion, routeTo, stopsById, travelToStop])

  const changeZoom = useCallback((amount: number) => {
    const next = clamp(zoomRef.current + amount, MIN_ZOOM, MAX_ZOOM)
    zoomRef.current = next
    setZoomLabel(next)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
      const key = event.key.toLowerCase()
      if (!['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(key)) return
      event.preventDefault()
      planRef.current = null
      keysRef.current.add(key)
    }
    const onKeyUp = (event: KeyboardEvent) => keysRef.current.delete(event.key.toLowerCase())
    const clearKeys = () => keysRef.current.clear()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', clearKeys)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clearKeys)
    }
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    const worldElement = worldRef.current
    const player = playerRef.current
    if (!viewport || !worldElement || !player) return
    let previous = performance.now()
    let statsAt = previous
    let frames = 0
    let ready = false

    const frame = (now: number) => {
      const delta = Math.min(.05, (now - previous) / 1000)
      previous = now
      frames += 1
      const position = positionRef.current
      let dx = 0
      let dy = 0
      const keys = keysRef.current
      if (keys.has('arrowleft') || keys.has('a')) dx -= 1
      if (keys.has('arrowright') || keys.has('d')) dx += 1
      if (keys.has('arrowup') || keys.has('w')) dy -= 1
      if (keys.has('arrowdown') || keys.has('s')) dy += 1

      const plan = planRef.current
      if (!dx && !dy && plan?.points.length) {
        const next = plan.points[0]
        const remainingX = next.x - position.x
        const remainingY = next.y - position.y
        const distance = Math.hypot(remainingX, remainingY)
        if (distance <= PLAYER_SPEED * delta + 2) {
          position.x = next.x
          position.y = next.y
          plan.points.shift()
          if (!plan.points.length) {
            planRef.current = null
            plan.onComplete?.()
          }
        } else {
          dx = remainingX / distance
          dy = remainingY / distance
        }
      }

      const hasMovement = Boolean(dx || dy)
      if (hasMovement) {
        const magnitude = Math.hypot(dx, dy) || 1
        dx /= magnitude
        dy /= magnitude
        const nextX = clamp(position.x + dx * PLAYER_SPEED * delta, 70, layout.width - 70)
        const nextY = clamp(position.y + dy * PLAYER_SPEED * delta, 70, layout.height - 70)
        const followingPlan = Boolean(planRef.current)
        // Plans already run along approved waypoints; keyboard motion is
        // validated against walkable land (islands + unlocked bridges) only.
        if (followingPlan || isWalkable(nextX, position.y)) position.x = nextX
        if (followingPlan || isWalkable(position.x, nextY)) position.y = nextY
        setMovementVisual(headingFor(dx, dy), true)
      } else {
        setMovementVisual(headingRef.current, false)
      }

      const islandHere = islandIndexAt(position.x, position.y)
      if (islandHere >= 0 && islandHere !== sectionRef.current) {
        sectionRef.current = islandHere
        setSectionIndex(islandHere)
      }

      player.style.left = `${position.x}px`
      player.style.top = `${position.y}px`
      player.style.zIndex = String(Math.floor(position.y + 70))

      const zoom = zoomRef.current
      const viewportWidth = viewport.clientWidth
      const viewportHeight = viewport.clientHeight
      const desiredX = viewportWidth * .5 - position.x * zoom
      const desiredY = viewportHeight * .58 - position.y * zoom
      const minimumX = Math.min(0, viewportWidth - layout.width * zoom)
      const minimumY = Math.min(0, viewportHeight - layout.height * zoom)
      const targetX = clamp(desiredX, minimumX, 0)
      const targetY = clamp(desiredY, minimumY, 0)
      const cameraEase = reducedMotion ? 1 : 1 - Math.pow(.0006, delta)
      cameraRef.current.x += (targetX - cameraRef.current.x) * cameraEase
      cameraRef.current.y += (targetY - cameraRef.current.y) * cameraEase
      worldElement.style.transform = `translate3d(${cameraRef.current.x}px, ${cameraRef.current.y}px, 0) scale(${zoom})`

      if (!ready) {
        ready = true
        onReady()
      }
      if (debug && now - statsAt >= 500) {
        onStats({
          fps: Math.round(frames * 1000 / (now - statsAt)),
          drawCalls: 0,
          triangles: 0,
          geometries: layout.stops.length + decorations.length,
          textures: 1,
          renderer: 'dom-2d-islands',
          positionX: Math.round(position.x),
          positionY: Math.round(position.y),
          zoom: Number(zoom.toFixed(2)),
        })
        statsAt = now
        frames = 0
      }
      animationRef.current = window.requestAnimationFrame(frame)
    }

    animationRef.current = window.requestAnimationFrame(frame)
    return () => window.cancelAnimationFrame(animationRef.current)
  }, [debug, decorations.length, islandIndexAt, isWalkable, layout, onReady, onStats, reducedMotion, setMovementVisual])

  useEffect(() => {
    if (simulate !== 'blocked' || !world.recommendedLandmarkId) return
    const timer = window.setTimeout(() => flashBlocked(world.recommendedLandmarkId!, layout.bridges.find((bridge) => !bridge.unlocked)?.index ?? null), 700)
    return () => window.clearTimeout(timer)
  }, [flashBlocked, layout.bridges, simulate, world.recommendedLandmarkId])

  useEffect(() => () => {
    if (blockedTimerRef.current != null) window.clearTimeout(blockedTimerRef.current)
  }, [])

  const onGroundPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('button, a, input, textarea, select')) return
    const worldElement = worldRef.current
    if (!worldElement) return
    const rect = worldElement.getBoundingClientRect()
    const point = {
      x: (event.clientX - rect.left) / zoomRef.current,
      y: (event.clientY - rect.top) / zoomRef.current,
    }
    const island = islandIndexAt(point.x, point.y)
    const walkableTarget = (island >= 0 && layout.islands[island].revealed) || onBridge(point.x, point.y, true)
    if (!walkableTarget) return
    const plan = routeTo(point)
    if (plan.blockedBridgeIndex != null) {
      planRef.current = { ...plan, onComplete: () => flashBlocked(null, plan.blockedBridgeIndex) }
      return
    }
    planRef.current = plan
  }

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    changeZoom(event.deltaY > 0 ? -.08 : .08)
  }

  const currentIsland = layout.islands[sectionIndex]

  return (
    <div
      ref={viewportRef}
      className={`learning-world-2d learning-world-2d--${world.subject}`}
      role="region"
      aria-label={ariaLabel}
      onPointerDown={onGroundPointerDown}
      onWheel={onWheel}
    >
      <div
        ref={worldRef}
        className="learning-world-2d__map"
        style={{ width: layout.width, height: layout.height }}
      >
        <div className="lw-sea" aria-hidden="true">
          <span className="lw-sea__waves" />
          <span className="lw-sea__sparkle" />
        </div>

        {layout.islands.map((island) => (
          <div
            className={`lw-island${island.revealed ? ' is-revealed' : ' is-hidden'}${island.completed ? ' is-completed' : ''}`}
            style={{
              left: island.centerX,
              top: island.centerY,
              '--island-rx': `${island.rx}px`,
              '--island-ry': `${island.ry}px`,
            } as CSSProperties}
            key={island.unitId}
          >
            <span className="lw-island__cliff" aria-hidden="true" />
            <span className="lw-island__sand" aria-hidden="true" />
            <span className="lw-island__land" aria-hidden="true" />
            <span className="lw-island__mottle" aria-hidden="true" />
            {!island.revealed && (
              <span className="lw-island__clouds" aria-hidden="true">
                <i /><i /><i /><i /><i />
                <b>?</b>
              </span>
            )}
          </div>
        ))}

        <svg className="lw-trails" viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
          {layout.islands.filter((island) => island.revealed && island.trail).map((island) => (
            <path className="lw-trails__path" d={island.trail} key={`trail-${island.unitId}`} />
          ))}
        </svg>

        {layout.bridges.map((bridge) => {
          const fromRevealed = layout.islands[bridge.index]?.revealed
          if (!fromRevealed) return null
          return (
            <div
              className={`lw-bridge${bridge.unlocked ? ' is-open' : ' is-locked'}${blockedBridgeIndex === bridge.index ? ' is-refused' : ''}`}
              style={{
                left: bridge.startX,
                top: bridge.startY,
                inlineSize: bridge.length,
                transform: `translateY(-50%) rotate(${bridge.angle}rad)`,
                zIndex: Math.floor(Math.max(bridge.startY, bridge.endY)),
              } as CSSProperties}
              key={`bridge-${bridge.index}`}
            >
              <span className="lw-bridge__planks" aria-hidden="true" />
              <span className="lw-bridge__rope lw-bridge__rope--near" aria-hidden="true" />
              <span className="lw-bridge__rope lw-bridge__rope--far" aria-hidden="true" />
              {!bridge.unlocked && (
                <span className="lw-bridge__gate" aria-hidden="true">
                  <i className="lw-bridge__gate-post" />
                  <i className="lw-bridge__gate-lock"><b /></i>
                  <em className="lw-bridge__gate-sign" dir="auto">{t('learning.world.bridgeLocked')}</em>
                </span>
              )}
            </div>
          )
        })}

        <div className="lw-decor" aria-hidden="true">
          {decorations.map((decoration) => (
            <span
              className={`lw-prop lw-prop--${decoration.kind} tone-${decoration.tone}`}
              style={{
                left: decoration.x,
                top: decoration.y,
                zIndex: Math.floor(decoration.y),
                '--prop-scale': decoration.scale,
              } as CSSProperties}
              key={decoration.id}
            ><i /><b /></span>
          ))}
        </div>

        {layout.stops.map((stop) => (
          <Building
            stop={stop}
            revealed={layout.islands[stop.islandIndex]?.revealed ?? false}
            selected={selectedLandmarkId === stop.id}
            blocked={blockedStopId === stop.id}
            onSelect={onLandmarkSelect}
            key={stop.id}
          />
        ))}

        <div
          ref={playerRef}
          className={`lw-player is-heading-${heading}${moving ? ' is-flying' : ''}`}
          style={{ left: positionRef.current.x, top: positionRef.current.y }}
        >
          <span className="lw-player__shadow" aria-hidden="true" />
          <span className="lw-player__smoke" aria-hidden="true"><b /><b /><b /><b /><b /><b /></span>
          <div className="lw-player__avatar">
            <YubiAvatar3D
              initialDesign={design}
              label={t('learning.world.yuviLabel')}
              muted
              grounded={!moving}
              flying={moving}
              heading={heading}
              performanceMode={lowPower ? 'low' : 'standard'}
              onAvatarClick={onYubiInteract}
            />
          </div>
          <span className="lw-player__thrusters" aria-hidden="true"><i /><i /></span>
        </div>
      </div>

      {currentIsland && (
        <div className="lw-section-banner" dir="auto">
          <span>{t('learning.world.sectionLabel', { index: sectionIndex + 1 })}</span>
          <strong>{currentIsland.unitTitle}</strong>
        </div>
      )}

      <div className="learning-world-2d__zoom" role="group" aria-label={t('learning.world.zoomControls')}>
        <button type="button" aria-label={t('learning.world.zoomIn')} onClick={() => changeZoom(.1)}>+</button>
        <output aria-live="off">{Math.round(zoomLabel * 100)}%</output>
        <button type="button" aria-label={t('learning.world.zoomOut')} onClick={() => changeZoom(-.1)}>−</button>
      </div>
    </div>
  )
})
