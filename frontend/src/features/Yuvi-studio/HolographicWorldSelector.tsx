import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { RoomLayoutId } from './RoomLayouts'

const WORLD_IDS: RoomLayoutId[] = ['lab', 'adventurePark', 'sportsArena', 'creatorLoft']

interface HolographicWorldSelectorProps {
  compact?: boolean
  open: boolean
  busy: boolean
  activeLayoutId: RoomLayoutId
  labels: Record<RoomLayoutId, string>
  lockedIds: RoomLayoutId[]
  lockedLabel: string
  currentLabel: string
  onSelect: (layoutId: RoomLayoutId) => void
}

type WorldProjection = {
  id: RoomLayoutId
  group: THREE.Group
  glowMaterials: THREE.Material[]
  particles: THREE.Points
  phase: number
  lock: THREE.Group
}

const material = (color: number, opacity: number, wireframe = false) => new THREE.MeshBasicMaterial({
  color,
  transparent: true,
  opacity,
  wireframe,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
})

function particleCloud(count: number, radius: number, color: number) {
  const positions = new Float32Array(count * 3)
  for (let index = 0; index < count; index++) {
    const angle = Math.random() * Math.PI * 2
    const distance = radius * (0.35 + Math.random() * 0.65)
    positions[index * 3] = Math.cos(angle) * distance
    positions[index * 3 + 1] = (Math.random() - 0.5) * radius * 1.2
    positions[index * 3 + 2] = Math.sin(angle) * distance
  }
  return new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3)),
    new THREE.PointsMaterial({ color, size: 0.045, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  )
}

function projectionBase() {
  const group = new THREE.Group()
  const beam = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.7, 32, 1, true), material(0x55eaff, 0.08))
  beam.position.y = -1.45
  beam.rotation.x = Math.PI
  group.add(beam)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.025, 8, 48), material(0x7cf7ff, 0.72))
  ring.rotation.x = Math.PI / 2
  ring.position.y = -0.12
  group.add(ring)
  for (let index = 0; index < 5; index++) {
    const scan = new THREE.Mesh(new THREE.TorusGeometry(0.72 + index * 0.07, 0.009, 6, 36), material(index % 2 ? 0x9e78ff : 0x54efff, 0.24))
    scan.rotation.x = Math.PI / 2
    scan.position.y = -0.75 + index * 0.36
    scan.userData.scan = true
    group.add(scan)
  }
  return group
}

function buildLab() {
  const group = projectionBase()
  const cyan = material(0x58f4ff, 0.76)
  const violet = material(0xa684ff, 0.42)
  const platform = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 1.45), material(0x428dff, 0.32))
  platform.position.y = 0.05
  group.add(platform)
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 0.08), material(0x527bff, 0.23))
  back.position.set(0, 0.5, -0.68)
  group.add(back)
  const bench = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.1, 0.34), cyan)
  bench.position.set(0, 0.42, 0.1)
  group.add(bench)
  for (let index = -2; index <= 2; index++) {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.42, 10), index % 2 ? violet : cyan)
    tube.position.set(index * 0.2, 0.66 + Math.abs(index) * 0.025, 0.08)
    group.add(tube)
  }
  const atom = new THREE.Group()
  atom.position.set(0.48, 1.08, -0.05)
  for (let index = 0; index < 3; index++) {
    const orbit = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.012, 6, 28), cyan)
    orbit.rotation.set(index * Math.PI / 3, index * Math.PI / 2.6, 0)
    atom.add(orbit)
  }
  atom.userData.spin = 0.7
  group.add(atom)
  return { group, glowMaterials: [cyan, violet] }
}

function buildAdventurePark() {
  const group = projectionBase()
  const green = material(0x64ff91, 0.62)
  const amber = material(0xffd45f, 0.58)
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 1.45), material(0x335262, 0.32))
  floor.position.y = 0.02
  group.add(floor)
  const wall = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 0.1), material(0x62dba0, 0.28))
  wall.position.set(0, 0.62, -0.65)
  group.add(wall)
  for (let index = 0; index < 14; index += 1) {
    const hold = new THREE.Mesh(new THREE.DodecahedronGeometry(0.07), index % 3 ? green : amber)
    hold.position.set(-0.72 + (index % 7) * 0.24, 0.3 + (index % 4) * 0.24, -0.72)
    group.add(hold)
  }
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.12, 0.48), amber)
  ramp.position.set(-0.55, 0.2, 0.35)
  ramp.rotation.z = -0.22
  group.add(ramp)
  return { group, glowMaterials: [green, amber] }
}

function buildSportsArena() {
  const group = projectionBase()
  const cyan = material(0x64efff, 0.68)
  const red = material(0xff5d62, 0.58)
  const court = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 1.5), material(0x2b7290, 0.3))
  court.position.y = 0.02
  group.add(court)
  const centre = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.018, 8, 32), cyan)
  centre.rotation.x = Math.PI / 2
  centre.position.y = 0.1
  group.add(centre)
  for (const x of [-0.78, 0.78]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.75, 0.04), red)
    post.position.set(x, 0.45, 0)
    group.add(post)
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 8, 24), red)
    hoop.position.set(x > 0 ? x - 0.12 : x + 0.12, 0.72, 0)
    hoop.rotation.y = Math.PI / 2
    group.add(hoop)
  }
  return { group, glowMaterials: [cyan, red] }
}

function buildCreatorLoft() {
  const group = projectionBase()
  const pink = material(0xff58ac, 0.64)
  const cyan = material(0x58eaff, 0.6)
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 1.45), material(0x62486d, 0.28))
  floor.position.y = 0.02
  group.add(floor)
  const stage = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.18, 0.48), pink)
  stage.position.set(0, 0.18, -0.42)
  group.add(stage)
  for (let index = 0; index < 9; index += 1) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.3 + (index % 4) * 0.13, 0.08), index % 2 ? cyan : pink)
    bar.position.set(-0.55 + index * 0.14, 0.48, -0.68)
    bar.userData.float = true
    group.add(bar)
  }
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.48, 0.08), cyan)
  screen.position.set(0.55, 0.65, 0.3)
  group.add(screen)
  return { group, glowMaterials: [pink, cyan] }
}

export function HolographicWorldSelector({ compact = false, open, busy, activeLayoutId, labels, lockedIds, lockedLabel, currentLabel, onSelect }: HolographicWorldSelectorProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const viewportRefs = useRef<Partial<Record<RoomLayoutId, HTMLSpanElement>>>({})
  const [activated, setActivated] = useState(open)
  const [selectedId, setSelectedId] = useState<RoomLayoutId | null>(null)
  const openRef = useRef(open)
  const busyRef = useRef(busy)
  const selectRef = useRef(onSelect)
  const hoveredRef = useRef<RoomLayoutId | null>(null)
  const selectedRef = useRef<RoomLayoutId | null>(null)
  const lockedRef = useRef(new Set(lockedIds))
  const requestSelectionRef = useRef<(id: RoomLayoutId) => void>(() => {})

  useEffect(() => {
    openRef.current = open
    if (open) setActivated(true)
    else {
      selectedRef.current = null
      setSelectedId(null)
    }
  }, [open])
  useEffect(() => { busyRef.current = busy }, [busy])
  useEffect(() => { lockedRef.current = new Set(lockedIds) }, [lockedIds])
  useEffect(() => { selectRef.current = onSelect }, [onSelect])

  useEffect(() => {
    if (!activated) return
    const mount = mountRef.current
    if (!mount) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: !reduceMotion, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setClearColor(0x000000, 0)
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40)
    camera.position.set(0, 0.72, compact ? 5.8 : 6.4)
    const builders = [buildLab, buildAdventurePark, buildSportsArena, buildCreatorLoft]
    const worlds: WorldProjection[] = WORLD_IDS.map((id, index) => {
      const built = builders[index]()
      const particles = particleCloud(reduceMotion ? 24 : 58, 1.45, index === 2 ? 0xac78ff : 0x69f4ff)
      built.group.add(particles)
      const lock = new THREE.Group()
      const lockMaterial = material(0xffd76a, 0.88)
      const lockBody = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.28, 0.1), lockMaterial)
      const lockShackle = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.035, 8, 20, Math.PI), lockMaterial)
      lockShackle.position.y = 0.14
      lockShackle.rotation.z = Math.PI
      lock.add(lockBody, lockShackle)
      lock.position.set(0, 1.65, 0)
      built.group.add(lock)
      built.group.userData.worldId = id
      built.group.traverse((object) => { object.userData.worldId = id })
      scene.add(built.group)
      return { id, ...built, particles, lock, phase: index * 1.9 }
    })
    let openProgress = 0
    let last = performance.now()
    let frame = 0
    let selectionStarted = 0

    const resize = () => {
      const width = mount.clientWidth || 1
      const height = mount.clientHeight || 1
      renderer.setSize(width, height, false)
    }
    const requestSelection = (id: RoomLayoutId) => {
      if (!openRef.current || busyRef.current || selectedRef.current) return
      selectedRef.current = id
      setSelectedId(id)
      selectionStarted = performance.now()
      window.setTimeout(() => selectRef.current(id), reduceMotion ? 120 : 460)
    }
    requestSelectionRef.current = requestSelection
    const observer = new ResizeObserver(resize)
    observer.observe(mount)
    resize()

    const render = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const targetOpen = openRef.current ? 1 : 0
      openProgress += (targetOpen - openProgress) * Math.min(1, dt * (reduceMotion ? 12 : 5.5))
      const selected = selectedRef.current
      worlds.forEach((world, index) => {
        const hovered = hoveredRef.current === world.id
        world.lock.visible = lockedRef.current.has(world.id)
        world.lock.position.y = 1.65 + (reduceMotion ? 0 : Math.sin(now * 0.0025 + world.phase) * 0.06)
        const selectedAge = selected === world.id ? Math.min(1, (now - selectionStarted) / 460) : 0
        const stagger = Math.max(0, Math.min(1, openProgress * 1.45 - index * 0.12))
        const visibility = selected && selected !== world.id ? Math.max(0, 1 - selectedAge * 1.7) : stagger
        const hoverScale = hovered ? 1.2 : 1
        const selectedScale = selected === world.id ? 1 + Math.sin(selectedAge * Math.PI) * 0.32 : 1
        const scale = Math.max(0.001, visibility * hoverScale * selectedScale * (compact ? 1.02 : 1))
        world.group.scale.lerp(new THREE.Vector3(scale, scale, scale), Math.min(1, dt * 12))
        world.group.position.x = 0
        world.group.position.y = -2.45 + stagger * 2.78 + Math.sin(now * 0.0014 + world.phase) * 0.06
        world.group.rotation.y += dt * (hovered ? 0.75 : 0.24)
        world.group.rotation.x += ((hovered ? -0.12 : 0) - world.group.rotation.x) * Math.min(1, dt * 8)
        world.particles.rotation.y -= dt * (hovered ? 1.25 : 0.32)
        ;(world.particles.material as THREE.PointsMaterial).opacity = Math.min(1, visibility * (hovered || selected === world.id ? 1 : 0.58))
        const pulse = 0.72 + Math.sin(now * 0.004 + world.phase) * 0.2 + (hovered ? 0.35 : 0)
        world.glowMaterials.forEach((entry) => { entry.opacity = Math.min(1, pulse * visibility) })
        world.group.children.forEach((child) => {
          if (child.userData.spin) child.rotation.y += dt * child.userData.spin
          if (child.userData.scan) child.rotation.z += dt * 0.22
          if (child.userData.float) child.position.y = 0.62 + Math.sin(now * 0.002) * 0.08
        })
      })
      const canvasRect = renderer.domElement.getBoundingClientRect()
      renderer.setScissorTest(true)
      worlds.forEach((world) => {
        const viewport = viewportRefs.current[world.id]
        if (!viewport) return
        const rect = viewport.getBoundingClientRect()
        const width = Math.max(1, rect.width)
        const height = Math.max(1, rect.height)
        const x = rect.left - canvasRect.left
        const y = canvasRect.bottom - rect.bottom
        renderer.setViewport(x, y, width, height)
        renderer.setScissor(x, y, width, height)
        camera.aspect = width / height
        camera.updateProjectionMatrix()
        worlds.forEach((entry) => { entry.group.visible = entry === world })
        renderer.render(scene, camera)
      })
      worlds.forEach((world) => { world.group.visible = true })
      frame = requestAnimationFrame(render)
    }
    frame = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      requestSelectionRef.current = () => {}
      scene.traverse((object) => {
        const renderable = object as THREE.Mesh
        renderable.geometry?.dispose()
        const entry = renderable.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(entry)) entry.forEach((item) => item.dispose())
        else entry?.dispose()
      })
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [activated])

  return <div className={`ys-world-projection${open ? ' is-open' : ''}${compact ? ' is-compact' : ''}`} aria-hidden={!open}>
    <div className="ys-world-projection__canvas" ref={mountRef} />
    <div className="ys-world-projection__targets">
      {WORLD_IDS.map((id) => (
        <button
          key={id}
          type="button"
          className={selectedId === id ? 'is-selected' : undefined}
          aria-label={`${labels[id]}${lockedIds.includes(id) ? `, ${lockedLabel}` : ''}`}
          aria-current={activeLayoutId === id ? 'true' : undefined}
          aria-pressed={selectedId === id}
          disabled={!open || busy}
          onPointerEnter={() => { hoveredRef.current = id }}
          onPointerLeave={() => { hoveredRef.current = null }}
          onFocus={() => { hoveredRef.current = id }}
          onBlur={() => { hoveredRef.current = null }}
          onClick={() => requestSelectionRef.current(id)}
        >
          <span
            className="ys-world-card__hologram"
            ref={(element) => {
              if (element) viewportRefs.current[id] = element
              else delete viewportRefs.current[id]
            }}
            aria-hidden="true"
          />
          <span className="ys-world-card__state">
            {activeLayoutId === id ? currentLabel : lockedIds.includes(id) ? lockedLabel : ''}
          </span>
          <span className="ys-world-card__name">{labels[id]}</span>
        </button>
      ))}
    </div>
  </div>
}