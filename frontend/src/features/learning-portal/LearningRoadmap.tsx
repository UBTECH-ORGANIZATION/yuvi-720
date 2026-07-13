import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import * as THREE from 'three'
import { useI18n } from '../../i18n/I18nProvider'
import { useTheme } from '../../providers/ThemeProvider'
import type { LearningComponentDTO, LearningUnitDTO } from '../../services/learning'
import { YubiAvatar3D } from '../yubi-studio/YubiAvatar3D'
import { useYubiDesign } from '../yubi-studio/YubiDesignProvider'

interface RoadmapPoint {
  component: LearningComponentDTO
  xPercent: number
  labelXPercent: number
  yPercent: number
  world: THREE.Vector3
}

interface RoadmapScreenPoint {
  platformXPercent: number
  labelXPercent: number
  yPercent: number
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

const STATE_COLORS: Record<LearningComponentDTO['progress_state'], number> = {
  completed: 0x58d8ad,
  current: 0x9f82ff,
  available: 0x4ddcf3,
  locked: 0x53607e,
}

function purposeKey(component: LearningComponentDTO) {
  if (component.is_assessment) return 'learning.component.assessment'
  if (component.purpose === 'instruction') return 'learning.component.instruction'
  if (component.purpose === 'practice') return 'learning.component.practice'
  return 'learning.component.activity'
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line)) return
    object.geometry?.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    materials.forEach((material) => material?.dispose())
  })
}

function platformGeometry(width: number, depth: number, height: number) {
  const halfWidth = width / 2
  const halfDepth = depth / 2
  const cut = Math.min(width, depth) * .17
  const shape = new THREE.Shape()
  shape.moveTo(-halfWidth + cut, -halfDepth)
  shape.lineTo(halfWidth - cut, -halfDepth)
  shape.lineTo(halfWidth, -halfDepth + cut)
  shape.lineTo(halfWidth, halfDepth - cut)
  shape.lineTo(halfWidth - cut, halfDepth)
  shape.lineTo(-halfWidth + cut, halfDepth)
  shape.lineTo(-halfWidth, halfDepth - cut)
  shape.lineTo(-halfWidth, -halfDepth + cut)
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: Math.min(.055, height * .28),
    bevelThickness: Math.min(.045, height * .24),
    curveSegments: 1,
  })
  geometry.rotateX(Math.PI / 2)
  geometry.translate(0, height / 2, 0)
  return geometry
}

function progressionEffect(componentId: string) {
  const effects = ['boost', 'portal', 'burst'] as const
  const seed = [...componentId].reduce((total, character) => total + character.charCodeAt(0), 0)
  return effects[seed % effects.length]
}

/** A vertical Three.js journey whose states remain derived from Brain/xAPI evidence. */
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
  const { theme } = useTheme()
  const { design, loaded } = useYubiDesign()
  const scrollRef = useRef<HTMLElement>(null)
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const [renderWorld, setRenderWorld] = useState(false)
  const [sceneReady, setSceneReady] = useState(false)
  const [roadmapReady, setRoadmapReady] = useState(false)
  const [yubiFallbackReady, setYubiFallbackReady] = useState(false)
  const [screenPoints, setScreenPoints] = useState<Record<string, RoadmapScreenPoint>>({})
  const components = useMemo(
    () => [...unit.components].sort((first, second) => (
      (first.order ?? 0) - (second.order ?? 0) || first.id.localeCompare(second.id)
    )),
    [unit.components],
  )
  const points = useMemo<RoadmapPoint[]>(() => {
    const count = Math.max(components.length, 1)
    const worldGap = count > 5 ? 1.75 : 2.05
    const front = ((count - 1) * worldGap) / 2
    return components.map((component, index) => ({
      component,
      xPercent: index % 2 === 0 ? 37 : 63,
      labelXPercent: index % 2 === 0 ? 80 : 20,
      yPercent: count === 1 ? 50 : 10 + (index / (count - 1)) * 80,
      world: new THREE.Vector3(index % 2 === 0 ? -1.25 : 1.25, 0, front - index * worldGap),
    }))
  }, [components])

  const activeComponent = components.find((component) => component.id === activeComponentId)
  const brainCurrent = components.find((component) => component.id === unit.current_component_id)
  const firstRoutable = components.find((component) => (
    component.progress_state === 'current' || component.progress_state === 'available'
  ))
  const lastCompleted = [...components].reverse().find((component) => component.progress_state === 'completed')
  const visibleYuviId = travellingFromId
    || (activeComponent?.progress_state !== 'completed' ? activeComponent?.id : null)
    || (brainCurrent?.progress_state === 'current' ? brainCurrent.id : null)
    || unit.next_component_id
    || firstRoutable?.id
    || lastCompleted?.id
    || components[0]?.id
  const yuviPoint = points.find((point) => point.component.id === visibleYuviId)
  const yuviIndex = yuviPoint ? points.indexOf(yuviPoint) : -1
  const nextPoint = points.find((point) => (
    point.component.id === unit.next_component_id && point.component.id !== travellingFromId
  )) || (yuviIndex >= 0 ? points[yuviIndex + 1] : undefined)
  const trackHeight = Math.max(compact ? 560 : 620, components.length * (compact ? 152 : 172))
  const projectionReady = points.length > 0 && points.every((point) => Boolean(screenPoints[point.component.id]))
  const yubiReady = !yuviPoint || loaded || yubiFallbackReady
  const yuviScreenPoint = yuviPoint ? screenPoints[yuviPoint.component.id] : undefined

  useEffect(() => {
    if (loaded) return
    const fallbackTimer = window.setTimeout(() => setYubiFallbackReady(true), 900)
    return () => window.clearTimeout(fallbackTimer)
  }, [loaded])

  useEffect(() => {
    const ready = renderWorld && sceneReady && projectionReady && yubiReady
    if (!ready) {
      setRoadmapReady(false)
      return
    }
    const revealTimer = window.setTimeout(() => setRoadmapReady(true), 180)
    return () => window.clearTimeout(revealTimer)
  }, [projectionReady, renderWorld, sceneReady, yubiReady])

  useEffect(() => {
    const host = canvasHostRef.current
    if (!host) return
    const updateVisibility = () => {
      const rect = host.getBoundingClientRect()
      const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0))
      const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0))
      const visible = visibleHeight > Math.min(rect.height * .22, 160)
        && visibleWidth > Math.min(rect.width * .22, 120)
      setRenderWorld((current) => current === visible ? current : visible)
    }
    const observer = new IntersectionObserver(
      () => updateVisibility(),
      // Keep only the visible two-card row warm. Preload margins can retain the
      // previous row and create four simultaneous WebGL contexts while scrolling.
      { rootMargin: '0px', threshold: .01 },
    )
    observer.observe(host)
    window.addEventListener('scroll', updateVisibility, { capture: true, passive: true })
    window.addEventListener('resize', updateVisibility, { passive: true })
    updateVisibility()
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', updateVisibility, true)
      window.removeEventListener('resize', updateVisibility)
    }
  }, [])

  useEffect(() => {
    const host = canvasHostRef.current
    if (!host || !renderWorld || points.length === 0) return
    setSceneReady(false)
    setScreenPoints({})
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'low-power' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.domElement.setAttribute('aria-hidden', 'true')
    renderer.domElement.style.inlineSize = '100%'
    renderer.domElement.style.blockSize = '100%'
    renderer.domElement.style.display = 'block'
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const isDark = theme === 'dark'
    const camera = new THREE.PerspectiveCamera(34, 1, .1, 80)
    const worldHeight = Math.max(7.2, Math.abs(points[0].world.z - points[points.length - 1].world.z) + 2.6)
    camera.position.set(0, Math.max(5.6, worldHeight * .68), Math.max(9.2, worldHeight * 1.12))
    camera.lookAt(0, -.15, -.2)

    scene.add(new THREE.HemisphereLight(isDark ? 0xc8ebff : 0xffffff, isDark ? 0x151a36 : 0xb7c4dd, isDark ? 1.25 : 1.5))
    const key = new THREE.DirectionalLight(isDark ? 0xeaf8ff : 0xffffff, isDark ? 1.55 : 1.95)
    key.position.set(3.5, 9, 5)
    scene.add(key)

    points.slice(0, -1).forEach((point, index) => {
      const destination = points[index + 1]
      if (
        point.component.progress_state !== 'completed'
        || destination.component.progress_state !== 'completed'
      ) return
      const start = point.world.clone().setY(.13)
      const end = destination.world.clone().setY(.13)
      const middle = start.clone().lerp(end, .5).setY(.2)
      const curve = new THREE.CatmullRomCurve3([start, middle, end])
      const glow = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 10, .09, 4, false),
        new THREE.MeshBasicMaterial({ color: 0x4ddcf3, transparent: true, opacity: .12, depthWrite: false }),
      )
      const trail = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 10, .035, 4, false),
        new THREE.MeshBasicMaterial({ color: 0x58d8ad, transparent: true, opacity: .92 }),
      )
      scene.add(glow, trail)
    })

    points.forEach((point) => {
      const state = point.component.progress_state
      const color = STATE_COLORS[state]
      const group = new THREE.Group()
      group.position.copy(point.world)

      const underGlow = new THREE.Mesh(
        platformGeometry(1.82, 1.3, .025),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: state === 'locked' ? .035 : .13,
          depthWrite: false,
        }),
      )
      underGlow.position.y = -.08
      group.add(underGlow)

      const baseGeometry = platformGeometry(1.62, 1.12, .24)
      const base = new THREE.Mesh(
        baseGeometry,
        new THREE.MeshStandardMaterial({
          color: state === 'locked'
            ? (isDark ? 0x252d43 : 0x8995a8)
            : (isDark ? 0x263756 : 0x687990),
          metalness: .82,
          roughness: .26,
          flatShading: true,
        }),
      )
      group.add(base)

      const energyBandGeometry = platformGeometry(1.55, 1.05, .045)
      const energyBand = new THREE.Mesh(
        energyBandGeometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: state === 'locked' ? .18 : .78,
        }),
      )
      energyBand.position.y = .135
      group.add(energyBand)

      const deckGeometry = platformGeometry(1.4, .91, .12)
      const deck = new THREE.Mesh(
        deckGeometry,
        new THREE.MeshStandardMaterial({
          color: state === 'locked'
            ? (isDark ? 0x4c566c : 0xaeb7c5)
            : (isDark ? 0xa9b9ce : 0xe7edf5),
          metalness: .7,
          roughness: .18,
          flatShading: true,
        }),
      )
      deck.position.y = .235
      group.add(deck)

      const deckEdges = new THREE.LineSegments(
        new THREE.EdgesGeometry(deckGeometry, 18),
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: state === 'locked' ? .24 : .88,
        }),
      )
      deckEdges.position.y = .238
      group.add(deckEdges)

      scene.add(group)
    })

    const starCount = compact ? 45 : 80
    const starPositions = new Float32Array(starCount * 3)
    for (let index = 0; index < starCount; index += 1) {
      starPositions[index * 3] = (Math.random() - .5) * 10
      starPositions[index * 3 + 1] = Math.random() * 2.2
      starPositions[index * 3 + 2] = (Math.random() - .5) * (worldHeight + 3)
    }
    const starsGeometry = new THREE.BufferGeometry()
    starsGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
    const stars = new THREE.Points(
      starsGeometry,
      new THREE.PointsMaterial({ color: isDark ? 0xaedfff : 0x7588bc, size: .045, transparent: true, opacity: isDark ? .62 : .34, depthWrite: false }),
    )
    scene.add(stars)

    let readyTimer = 0
    const render = () => renderer.render(scene, camera)
    const projectScreenPoints = () => {
      const nextPoints = Object.fromEntries(points.map((point) => {
        const projected = point.world.clone()
        projected.y = .22
        projected.project(camera)
        const platformXPercent = THREE.MathUtils.clamp((projected.x + 1) * 50, 20, 80)
        return [point.component.id, {
          platformXPercent,
          labelXPercent: platformXPercent < 50 ? 74 : 26,
          yPercent: THREE.MathUtils.clamp((1 - projected.y) * 50, 13, 86),
        }]
      }))
      setScreenPoints(nextPoints)
    }
    const resize = () => {
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      camera.updateMatrixWorld(true)
      projectScreenPoints()
      render()
      window.clearTimeout(readyTimer)
      readyTimer = window.setTimeout(() => setSceneReady(true), 0)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    return () => {
      observer.disconnect()
      window.clearTimeout(readyTimer)
      disposeScene(scene)
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [compact, points, renderWorld, theme])

  useEffect(() => {
    const viewport = scrollRef.current
    if (!viewport || !visibleYuviId || !renderWorld) return
    const point = screenPoints[visibleYuviId]
    if (!point) return
    const target = (point.yPercent / 100) * trackHeight - viewport.clientHeight * .52
    viewport.scrollTo({ top: Math.max(0, target), behavior: cinematic ? 'smooth' : 'auto' })
  }, [cinematic, renderWorld, screenPoints, trackHeight, visibleYuviId])

  return (
    <section
      ref={scrollRef}
      className={`learning-roadmap learning-roadmap--three${compact ? ' learning-roadmap--panel' : ''}${cinematic ? ' learning-roadmap--cinematic' : ''}${travellingFromId ? ' is-travelling' : ''}${roadmapReady ? ' is-ready' : ' is-loading'}`}
      aria-label={t('learning.roadmap.label', { title: unit.title })}
      aria-busy={!roadmapReady}
    >
      {!roadmapReady && (
        <div className="learning-roadmap__loading" role="status">
          <span className="learning-roadmap__loading-spinner" aria-hidden="true" />
          <span>{t('learning.loading.title')}</span>
        </div>
      )}
      <div className="learning-roadmap__track" style={{ '--roadmap-track-height': `${trackHeight}px` } as CSSProperties}>
        <div className="learning-roadmap__world" ref={canvasHostRef} aria-hidden="true" />
        <div className="learning-roadmap__atmosphere" aria-hidden="true"><i /><i /><i /></div>
        {points.map(({ component, labelXPercent, yPercent }, index) => {
          const disabled = !roadmapReady || component.progress_state === 'locked' || !onSelect
          const screenPoint = screenPoints[component.id]
          const platformY = screenPoint?.yPercent ?? yPercent
          const projectedLabelX = screenPoint?.labelXPercent ?? labelXPercent
          const labelNearYuvi = component.id !== visibleYuviId
            && yuviScreenPoint
            && Math.abs(projectedLabelX - yuviScreenPoint.platformXPercent) < 34
            && Math.abs(platformY - yuviScreenPoint.yPercent) < 22
          const labelX = labelNearYuvi ? (projectedLabelX < 50 ? 74 : 26) : projectedLabelX
          const labelY = THREE.MathUtils.clamp(
            platformY + (component.id === visibleYuviId ? 11.5 : index % 2 === 0 ? 1.3 : -1.3),
            9,
            91,
          )
          return (
            <button
              type="button"
              className={`learning-roadmap__stage is-${component.progress_state}${component.id === activeComponentId ? ' is-active' : ''}`}
              style={{
                '--roadmap-x': `${labelX}%`,
                '--roadmap-y': `${labelY}%`,
                '--roadmap-index': index,
              } as CSSProperties}
              disabled={disabled}
              onClick={() => onSelect?.(component)}
              aria-label={`${component.title}. ${t(`learning.roadmap.state.${component.progress_state}`)}`}
              key={component.id}
            >
              <span className="learning-roadmap__stage-copy">
                <strong dir="auto">{component.title}</strong>
                <small>{t(purposeKey(component))}</small>
                <em>{t(`learning.roadmap.state.${component.progress_state}`)}</em>
              </span>
            </button>
          )
        })}
        {points.filter(({ component }) => component.progress_state === 'completed').map((point) => {
          const screenPoint = screenPoints[point.component.id]
          return (
            <span
              className="learning-roadmap__completed-check"
              style={{
                '--roadmap-x': `${screenPoint?.platformXPercent ?? point.xPercent}%`,
                '--roadmap-y': `${screenPoint?.yPercent ?? point.yPercent}%`,
              } as CSSProperties}
              aria-hidden="true"
              key={`check-${point.component.id}`}
            >✓</span>
          )
        })}
        {renderWorld && yubiReady && sceneReady && yuviPoint && (() => {
          const nextScreenPoint = nextPoint ? screenPoints[nextPoint.component.id] : undefined
          const yuviX = yuviScreenPoint?.platformXPercent ?? yuviPoint.xPercent
          const yuviY = yuviScreenPoint?.yPercent ?? yuviPoint.yPercent
          return (
          <div
            className={`learning-roadmap__yuvi-3d${travellingFromId === yuviPoint.component.id ? ` is-flying flight-${progressionEffect(yuviPoint.component.id)}` : ''}`}
            style={{
              '--roadmap-x': `${yuviX}%`,
              '--roadmap-y': `${yuviY}%`,
              '--flight-destination-x': `${nextScreenPoint?.platformXPercent ?? nextPoint?.xPercent ?? yuviX}%`,
              '--flight-destination-y': `${nextScreenPoint?.yPercent ?? nextPoint?.yPercent ?? yuviY}%`,
            } as CSSProperties}
            aria-label={t('learning.roadmap.yuviHere')}
            onAnimationEnd={(event) => {
              if (event.animationName === 'learning-yuvi-3d-flight') onTravelComplete?.()
            }}
          >
            <span className="learning-roadmap__flight-smoke" aria-hidden="true"><i /><i /><i /><i /></span>
            <span className="learning-roadmap__flight-thrusters" aria-hidden="true"><i /><i /></span>
            <YubiAvatar3D
              key={loaded ? 'persisted-yuvi' : 'fallback-yuvi'}
              initialDesign={design}
              label={t('learning.roadmap.yuviHere')}
              muted
              frontFacing
              grounded
            />
          </div>
          )
        })()}
        <p className="learning-roadmap__world-hint">{t('learning.roadmap.worldHint')}</p>
      </div>
    </section>
  )
}
