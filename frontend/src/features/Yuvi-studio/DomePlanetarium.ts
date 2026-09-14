import * as THREE from 'three'
import type { MoodId, RoomStations } from './RoomDesign'

export interface PlanetariumProgress {
  objectivesMastered: number
  objectivesTotal: number
  subjectCount: number
}

interface DomePlanetariumOptions {
  floorY: number
  radius: number
  rich: boolean
  reduceMotion: boolean
  progress: PlanetariumProgress | null
  stations: RoomStations
}

export interface DomePlanetarium {
  group: THREE.Group
  setStations: (stations: RoomStations) => void
  setMood: (mood: MoodId) => void
  update: (time: number) => void
  dispose: () => void
}

const CYAN = new THREE.Color(0x4eeef0)
const VIOLET = new THREE.Color(0x8d73ff)
const BRASS = new THREE.Color(0xd6a85f)
const ROSE = new THREE.Color(0xff6f91)

const MOODS: Record<MoodId, { cool: THREE.Color; warm: THREE.Color; energy: number }> = {
  studio: { cool: CYAN, warm: BRASS, energy: 0.8 },
  sunset: { cool: new THREE.Color(0xff9b72), warm: new THREE.Color(0xf2c879), energy: 0.72 },
  night: { cool: new THREE.Color(0x76dfff), warm: VIOLET, energy: 0.62 },
  party: { cool: ROSE, warm: new THREE.Color(0xffd36a), energy: 1 },
}

function seeded(index: number, salt: number) {
  const value = Math.sin(index * 91.345 + salt * 17.17) * 47453.5453
  return value - Math.floor(value)
}

function pointsGeometry(points: THREE.Vector3[]) {
  return new THREE.BufferGeometry().setFromPoints(points)
}

export function createDomePlanetarium(options: DomePlanetariumOptions): DomePlanetarium {
  const { floorY, radius, rich, reduceMotion, progress } = options
  const group = new THREE.Group()
  group.name = 'dome-planetarium'

  const ambientStars: THREE.Vector3[] = []
  const ambientCount = rich ? 110 : 54
  for (let index = 0; index < ambientCount; index += 1) {
    const angle = seeded(index, 1) * Math.PI * 2
    const radial = radius * (0.12 + seeded(index, 2) * 0.76)
    ambientStars.push(new THREE.Vector3(
      Math.cos(angle) * radial,
      floorY + 5.1 + seeded(index, 3) * 6.2,
      Math.sin(angle) * radial,
    ))
  }
  const ambientMaterial = new THREE.PointsMaterial({
    color: 0x9ebcff,
    size: rich ? 0.15 : 0.1,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
  const ambient = new THREE.Points(pointsGeometry(ambientStars), ambientMaterial)
  group.add(ambient)

  const constellation = new THREE.Group()
  constellation.name = 'evidence-constellation'
  group.add(constellation)
  const objectiveTotal = Math.max(0, Math.floor(progress?.objectivesTotal ?? 0))
  const objectiveMastered = Math.min(objectiveTotal, Math.max(0, Math.floor(progress?.objectivesMastered ?? 0)))
  const nodeCount = Math.min(rich ? 36 : 20, objectiveTotal)
  const litCount = objectiveTotal > 0 ? Math.round((objectiveMastered / objectiveTotal) * nodeCount) : 0
  const constellationPoints: THREE.Vector3[] = []
  const constellationColors: number[] = []
  for (let index = 0; index < nodeCount; index += 1) {
    const angle = index * 2.399963 + seeded(index, 4) * 0.28
    const radial = radius * (0.2 + 0.55 * Math.sqrt((index + 1) / (nodeCount + 1)))
    constellationPoints.push(new THREE.Vector3(
      Math.cos(angle) * radial,
      floorY + 6.2 + seeded(index, 5) * 4.2,
      Math.sin(angle) * radial,
    ))
    const color = index < litCount ? BRASS : CYAN.clone().multiplyScalar(0.42)
    constellationColors.push(color.r, color.g, color.b)
  }
  const constellationGeometry = pointsGeometry(constellationPoints)
  constellationGeometry.setAttribute('color', new THREE.Float32BufferAttribute(constellationColors, 3))
  const constellationMaterial = new THREE.PointsMaterial({
    size: rich ? 0.31 : 0.21,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
  constellation.add(new THREE.Points(constellationGeometry, constellationMaterial))

  const routeMaterial = new THREE.LineBasicMaterial({
    color: CYAN,
    transparent: true,
    opacity: nodeCount > 1 ? 0.24 : 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })
  if (nodeCount > 1) constellation.add(new THREE.Line(pointsGeometry(constellationPoints), routeMaterial))
  const achievedMaterial = new THREE.LineBasicMaterial({
    color: BRASS,
    transparent: true,
    opacity: litCount > 1 ? 0.74 : 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })
  if (litCount > 1) constellation.add(new THREE.Line(pointsGeometry(constellationPoints.slice(0, litCount)), achievedMaterial))

  const planet = new THREE.Group()
  planet.name = 'central-holographic-planet'
  planet.position.set(0, floorY + (rich ? 3.55 : 1.35), -9.5)
  if (!rich) planet.scale.setScalar(0.5)
  group.add(planet)
  const planetShellMaterial = new THREE.MeshBasicMaterial({
    color: CYAN,
    wireframe: true,
    transparent: true,
    opacity: 0.74,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
  planet.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.55, rich ? 2 : 1), planetShellMaterial))
  const planetCoreMaterial = new THREE.MeshBasicMaterial({
    color: VIOLET,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
  planet.add(new THREE.Mesh(new THREE.SphereGeometry(1.28, rich ? 24 : 16, rich ? 16 : 10), planetCoreMaterial))
  const brassMaterial = new THREE.MeshBasicMaterial({ color: BRASS, toneMapped: false })
  const equator = new THREE.Mesh(new THREE.TorusGeometry(1.72, 0.025, 6, rich ? 64 : 32), brassMaterial)
  equator.rotation.x = Math.PI / 2
  equator.rotation.y = 0.28
  planet.add(equator)
  const longitude = new THREE.Mesh(new THREE.TorusGeometry(1.48, 0.014, 6, rich ? 56 : 28), planetShellMaterial)
  longitude.rotation.y = Math.PI / 2
  planet.add(longitude)
  const orbit = new THREE.Mesh(new THREE.TorusGeometry(2.18, 0.018, 6, rich ? 64 : 32), planetShellMaterial)
  orbit.rotation.set(1.08, 0.18, 0.35)
  planet.add(orbit)
  const moon = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), brassMaterial)
  moon.position.set(2.18, 0, 0)
  orbit.add(moon)

  const ribs = new THREE.Group()
  ribs.name = 'brass-observatory-ribs'
  group.add(ribs)
  const ribMaterial = new THREE.LineBasicMaterial({
    color: BRASS,
    transparent: true,
    opacity: 0.11,
    depthWrite: false,
    toneMapped: false,
  })
  for (let index = 0; index < 4; index += 1) {
    const angle = (index / 4) * Math.PI
    const across = new THREE.Vector3(Math.cos(angle) * radius * 0.985, floorY + 0.08, Math.sin(angle) * radius * 0.985)
    const opposite = across.clone().multiply(new THREE.Vector3(-1, 1, -1))
    opposite.y = floorY + 0.08
    const curve = new THREE.QuadraticBezierCurve3(across, new THREE.Vector3(0, floorY + radius * 0.615, 0), opposite)
    ribs.add(new THREE.Line(pointsGeometry(curve.getPoints(rich ? 56 : 28)), ribMaterial))
  }

  const paths = new THREE.Group()
  paths.name = 'curved-station-paths'
  paths.position.y = floorY + 0.042
  group.add(paths)
  const pathMaterials = [CYAN, BRASS, VIOLET, CYAN].map((color) => new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.38,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  }))
  const setStations = (stations: RoomStations) => {
    for (const child of [...paths.children]) {
      paths.remove(child)
      const geometry = (child as THREE.Line).geometry
      geometry?.dispose()
    }
    const stationList = [stations.avatar, stations.room, stations.explore, stations.mission]
    stationList.forEach((station, index) => {
      const end = new THREE.Vector3(station.x, 0, station.z)
      const distance = Math.max(1, end.length())
      const perpendicular = new THREE.Vector3(-end.z / distance, 0, end.x / distance)
      const control = end.clone().multiplyScalar(0.5).add(perpendicular.multiplyScalar((index % 2 ? -1 : 1) * Math.min(2.8, distance * 0.18)))
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), control, end)
      paths.add(new THREE.Line(pointsGeometry(curve.getPoints(rich ? 36 : 20)), pathMaterials[index]))
    })
  }
  setStations(options.stations)

  const horizon = new THREE.Group()
  horizon.name = 'restrained-planetarium-horizon'
  horizon.position.y = floorY + 0.18
  group.add(horizon)
  const horizonMaterial = new THREE.MeshBasicMaterial({
    color: BRASS,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    toneMapped: false,
  })
  const beaconGeometry = new THREE.BoxGeometry(0.05, 0.55, 0.05)
  const beaconCount = rich ? 24 : 12
  for (let index = 0; index < beaconCount; index += 1) {
    const angle = (index / beaconCount) * Math.PI * 2
    const beacon = new THREE.Mesh(beaconGeometry, horizonMaterial)
    beacon.position.set(Math.cos(angle) * radius * 1.08, seeded(index, 8) * 0.9, Math.sin(angle) * radius * 1.08)
    horizon.add(beacon)
  }

  let moodEnergy = MOODS.studio.energy
  const setMood = (mood: MoodId) => {
    const palette = MOODS[mood]
    moodEnergy = palette.energy
    planetShellMaterial.color.copy(palette.cool)
    planetCoreMaterial.color.copy(palette.cool).lerp(palette.warm, 0.38)
    brassMaterial.color.copy(palette.warm)
    ribMaterial.color.copy(palette.warm)
    horizonMaterial.color.copy(palette.warm)
    achievedMaterial.color.copy(palette.warm)
    pathMaterials.forEach((material, index) => material.color.copy(index % 2 ? palette.warm : palette.cool))
  }

  const update = (time: number) => {
    const breath = reduceMotion ? 0.86 : 0.82 + Math.sin(time * 0.42) * 0.08
    planetShellMaterial.opacity = breath * (0.62 + moodEnergy * 0.24)
    planetCoreMaterial.opacity = breath * (0.16 + moodEnergy * 0.08)
    constellationMaterial.opacity = 0.72 + moodEnergy * 0.23
    if (reduceMotion) return
    planet.rotation.y = time * 0.07
    equator.rotation.z = time * 0.045
    orbit.rotation.z = 0.35 - time * 0.025
    constellation.rotation.y = Math.sin(time * 0.035) * 0.012
    horizon.rotation.y = time * 0.006
  }

  const dispose = () => {
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    group.traverse((object) => {
      const renderable = object as THREE.Mesh | THREE.Line | THREE.Points
      if (renderable.geometry) geometries.add(renderable.geometry)
      if (Array.isArray(renderable.material)) renderable.material.forEach((material) => materials.add(material))
      else if (renderable.material) materials.add(renderable.material)
    })
    geometries.forEach((geometry) => geometry.dispose())
    materials.forEach((material) => material.dispose())
  }

  return { group, setStations, setMood, update, dispose }
}