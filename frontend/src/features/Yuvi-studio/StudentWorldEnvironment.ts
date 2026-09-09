import * as THREE from 'three'
import type { RoomLayoutId } from './RoomLayouts'

type StudentWorldId = Exclude<RoomLayoutId, 'lab'>

interface EnvironmentOptions {
  id: StudentWorldId
  floorY: number
  rich: boolean
  reduceMotion: boolean
}

export interface StudentWorldEnvironment {
  group: THREE.Group
  floorMaterial: THREE.MeshStandardMaterial
  update: (elapsed: number) => void
  dispose: () => void
}

const HALF_X = 24.4
const BACK_Z = -25.8
const FRONT_Z = 32.7
const DEPTH = FRONT_Z - BACK_Z
const MID_Z = (BACK_Z + FRONT_Z) / 2

export function createStudentWorldEnvironment(options: EnvironmentOptions): StudentWorldEnvironment {
  const { id, floorY, rich, reduceMotion } = options
  const group = new THREE.Group()
  group.name = `student-world-${id}`
  const resources = new Set<{ dispose: () => void }>()
  const track = <T extends { dispose: () => void }>(resource: T): T => { resources.add(resource); return resource }
  const animated: Array<(elapsed: number) => void> = []
  const palette = id === 'adventurePark'
    ? { floor: 0x17222a, wall: 0x283640, accent: 0x66f28f, second: 0xffcf4a, dark: 0x10171c }
    : id === 'sportsArena'
      ? { floor: 0x101b24, wall: 0x182b38, accent: 0x33d6ff, second: 0xff5d62, dark: 0x091118 }
      : { floor: 0x17131f, wall: 0x2c2335, accent: 0xff4fa3, second: 0x54e6ff, dark: 0x0e0b13 }
  const standard = (color: number, emissive = 0x000000) => track(new THREE.MeshStandardMaterial({
    color, roughness: 0.72, metalness: 0.22, emissive, emissiveIntensity: emissive ? 0.7 : 0,
  }))
  const glow = (color: number, opacity = 0.75) => track(new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }))
  const floorMaterial = standard(palette.floor)
  const floor = new THREE.Mesh(track(new THREE.PlaneGeometry(HALF_X * 2, DEPTH)), floorMaterial)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, floorY + 0.006, MID_Z)
  group.add(floor)
  const wallMaterial = standard(palette.wall)
  const back = new THREE.Mesh(track(new THREE.PlaneGeometry(HALF_X * 2, 12)), wallMaterial)
  back.position.set(0, floorY + 6, BACK_Z)
  group.add(back)
  const sideGeometry = track(new THREE.PlaneGeometry(DEPTH, 12))
  const left = new THREE.Mesh(sideGeometry, wallMaterial)
  left.rotation.y = Math.PI / 2
  left.position.set(-HALF_X, floorY + 6, MID_Z)
  group.add(left)
  const right = left.clone()
  right.rotation.y = -Math.PI / 2
  right.position.x = HALF_X
  group.add(right)
  const ceiling = new THREE.Mesh(track(new THREE.PlaneGeometry(HALF_X * 2, DEPTH)), standard(palette.dark))
  ceiling.rotation.x = Math.PI / 2
  ceiling.position.set(0, floorY + 12, MID_Z)
  group.add(ceiling)

  const box = (width: number, height: number, depth: number, material: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(track(new THREE.BoxGeometry(width, height, depth)), material)
    mesh.position.set(x, y, z)
    group.add(mesh)
    return mesh
  }

  if (id === 'adventurePark') {
    const holdMaterial = glow(palette.accent, 0.9)
    const climbing = standard(0x334b51)
    box(20, 8, 0.7, climbing, 0, floorY + 4.2, BACK_Z + 0.4)
    const holdGeometry = track(new THREE.DodecahedronGeometry(0.24, 0))
    for (let index = 0; index < (rich ? 42 : 22); index += 1) {
      const hold = new THREE.Mesh(holdGeometry, index % 3 === 0 ? glow(palette.second, 0.82) : holdMaterial)
      hold.position.set(-9 + (index % 10) * 2, floorY + 1.1 + (index % 5) * 1.35, BACK_Z + 0.82)
      hold.rotation.set(index * 0.7, index * 0.4, 0)
      group.add(hold)
    }
    const rampMaterial = standard(0x26343a)
    const ramp = box(8, 0.7, 5, rampMaterial, -19.5, floorY + 1.25, 18)
    ramp.rotation.z = -0.18
    box(5, 2.4, 6, rampMaterial, 20.5, floorY + 1.2, 17)
    const routeLights: THREE.MeshBasicMaterial[] = []
    for (let index = 0; index < 12; index += 1) {
      const lightMaterial = glow(index % 2 ? palette.accent : palette.second, 0.28)
      routeLights.push(lightMaterial)
      box(0.18, 0.05, 1.5, lightMaterial, -10 + index * 1.8, floorY + 0.04, FRONT_Z - 2.2)
    }
    animated.push((elapsed) => routeLights.forEach((entry, index) => { entry.opacity = 0.2 + Math.max(0, Math.sin(elapsed * 2.4 - index * 0.48)) * 0.72 }))
  }

  if (id === 'sportsArena') {
    const lineMaterial = glow(0xeafcff, 0.62)
    const court = new THREE.LineSegments(
      track(new THREE.EdgesGeometry(new THREE.BoxGeometry(30, 0.02, 44))),
      lineMaterial,
    )
    court.position.set(0, floorY + 0.04, 3)
    group.add(court)
    const centre = new THREE.Mesh(track(new THREE.RingGeometry(4.8, 4.95, 64)), lineMaterial)
    centre.rotation.x = -Math.PI / 2
    centre.position.set(0, floorY + 0.05, 3)
    group.add(centre)
    const goalMaterial = standard(0xd8edf2)
    for (const z of [BACK_Z + 1.1, FRONT_Z - 1.1]) {
      box(8, 0.35, 0.35, goalMaterial, 0, floorY + 3.8, z)
      box(0.35, 7.5, 0.35, goalMaterial, -3.85, floorY + 1.9, z)
      box(0.35, 7.5, 0.35, goalMaterial, 3.85, floorY + 1.9, z)
    }
    const scoreboardMaterial = glow(palette.accent, 0.7)
    box(10, 3.2, 0.35, standard(0x07131b), 0, floorY + 8.2, BACK_Z + 0.6)
    const scoreBars: THREE.Mesh[] = []
    for (let index = 0; index < 8; index += 1) scoreBars.push(box(0.55, 1.3, 0.12, scoreboardMaterial, -2.7 + index * 0.78, floorY + 8.2, BACK_Z + 0.82))
    animated.push((elapsed) => scoreBars.forEach((bar, index) => { bar.scale.y = 0.35 + Math.abs(Math.sin(elapsed * 1.8 + index)) * 0.65 }))
    for (const x of [-21.5, 21.5]) box(3.8, 2.2, 28, standard(0x243946), x, floorY + 1.1, 4)
  }

  if (id === 'creatorLoft') {
    const stageMaterial = standard(0x241a2b)
    box(18, 0.8, 7, stageMaterial, 0, floorY + 0.4, BACK_Z + 4)
    box(18, 7, 0.5, standard(0x130f19), 0, floorY + 4.3, BACK_Z + 0.6)
    const screenMaterials: THREE.MeshBasicMaterial[] = []
    for (let index = 0; index < 10; index += 1) {
      const screenMaterial = glow(index % 2 ? palette.accent : palette.second, 0.45)
      screenMaterials.push(screenMaterial)
      box(1.05, 2.4, 0.12, screenMaterial, -6.2 + index * 1.38, floorY + 3.5, BACK_Z + 0.9)
    }
    const equalizer: THREE.Mesh[] = []
    for (let index = 0; index < 16; index += 1) equalizer.push(box(0.3, 1, 0.25, glow(index % 3 ? palette.second : palette.accent, 0.72), -7.5 + index, floorY + 1.3, BACK_Z + 7.1))
    animated.push((elapsed) => {
      equalizer.forEach((bar, index) => { bar.scale.y = 0.3 + Math.abs(Math.sin(elapsed * 2.2 + index * 0.65)) * 1.7 })
      screenMaterials.forEach((entry, index) => { entry.opacity = 0.28 + Math.abs(Math.sin(elapsed * 0.9 + index * 0.4)) * 0.42 })
    })
    for (let index = 0; index < 7; index += 1) box(0.3, 0.3, DEPTH - 5, glow(index % 2 ? palette.accent : palette.second, 0.28), -18 + index * 6, floorY + 11.7, MID_Z)
  }

  return {
    group,
    floorMaterial,
    update: (elapsed) => { if (!reduceMotion) animated.forEach((animate) => animate(elapsed)) },
    dispose: () => resources.forEach((resource) => resource.dispose()),
  }
}