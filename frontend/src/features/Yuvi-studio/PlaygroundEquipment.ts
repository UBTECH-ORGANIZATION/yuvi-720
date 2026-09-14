import * as THREE from 'three'
import type { PlaygroundKit, Point3 } from './PlaygroundKit.ts'
import { movingPart, type PlaygroundMotion } from './PlaygroundInteractions.ts'
import { PLAYGROUND_EQUIPMENT, type PlaygroundEquipmentKind } from './PlaygroundItems.ts'
import { buildPlaygroundPlant } from './PlaygroundLandscape.ts'

export function buildPlaygroundEquipment(kit: PlaygroundKit, kind: PlaygroundEquipmentKind) {
  if (kind === 'parkTree' || kind === 'parkFlowerBed') return buildPlaygroundPlant(kit, kind)
  const root = new THREE.Group()
  const motion: PlaygroundMotion = { actions: [], updates: [], reduced: false }
  const steel = kit.material('steel', 0xa6afb0)
  const dark = kit.material('rubber', 0x293735)
  const rope = kit.material('rope', 0xc6b895)
  const timber = kit.material('wood', 0xd5b78d)
  const teal = kit.material('paint', 0x258b82)
  const yellow = kit.material('paint', 0xe5b63b)
  const coral = kit.material('paint', 0xc95743)
  const blue = kit.material('paint', 0x477fbb)
  const cream = kit.material('paint', 0xece4d3)
  const surfaces = [teal, coral, yellow, blue]
  const post = (parent: THREE.Object3D, x: number, z: number, height: number) => {
    kit.cylinder(parent, 0.105, height, steel, [x, height / 2, z])
    kit.cylinder(parent, 0.18, 0.06, dark, [x, 0.05, z])
    kit.sphere(parent, 0.108, dark, [x, height, z]).scale.y = 0.5
    for (const dx of [-0.11, 0.11]) kit.bolt(parent, [x + dx, 0.075, z + 0.1])
  }
  const rail = (parent: THREE.Object3D, from: Point3, to: Point3, height = 1) => {
    kit.beam(parent, [from[0], from[1] + height, from[2]], [to[0], to[1] + height, to[2]], 0.055, steel)
    const count = Math.ceil(Math.hypot(to[0] - from[0], to[2] - from[2]) / 0.22)
    for (let index = 0; index <= count; index++) {
      const progress = index / count
      const foot: Point3 = from.map((value, axis) => value + (to[axis] - value) * progress) as Point3
      kit.beam(parent, foot, [foot[0], foot[1] + height, foot[2]], 0.025, teal)
    }
  }
  const net = (parent: THREE.Object3D, start: Point3, across: Point3, up: Point3, columns: number, rows: number) => {
    const point = (horizontal: number, vertical: number): Point3 => start.map((value, axis) => value + across[axis] * horizontal + up[axis] * vertical) as Point3
    for (let column = 0; column <= columns; column++) kit.beam(parent, point(column / columns, 0), point(column / columns, 1), 0.028, rope)
    for (let row = 0; row <= rows; row++) kit.beam(parent, point(0, row / rows), point(1, row / rows), 0.028, rope)
    for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) kit.sphere(parent, 0.044, dark, point(column / columns, row / rows))
  }
  const slide = (parent: THREE.Group, points: Point3[], surface: THREE.Material, enclosed: boolean) => {
    const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)))
    const segments = kit.rich ? 80 : 40
    const sides = kit.rich ? 20 : 12
    const frames = curve.computeFrenetFrames(segments, false)
    const vertices: number[] = [], uvs: number[] = [], indices: number[] = []
    for (let step = 0; step <= segments; step++) {
      const centre = curve.getPointAt(step / segments)
      const tangent = curve.getTangentAt(step / segments)
      const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize()
      const up = new THREE.Vector3().crossVectors(right, tangent).normalize()
      for (let side = 0; side <= sides; side++) {
        const angle = enclosed ? side / sides * Math.PI * 2 : (side / sides - 0.5) * Math.PI * 1.05
        const normal = enclosed ? frames.normals[step] : right
        const binormal = enclosed ? frames.binormals[step] : up
        const vertex = centre.clone().addScaledVector(normal, Math.sin(angle) * 0.64).addScaledVector(binormal, -Math.cos(angle) * 0.64)
        vertices.push(vertex.x, vertex.y, vertex.z)
        uvs.push(side / sides, step / segments * 8)
        if (step < segments && side < sides) {
          const current = step * (sides + 1) + side
          indices.push(current, current + sides + 1, current + 1, current + 1, current + sides + 1, current + sides + 2)
        }
      }
    }
    const shape = kit.own(new THREE.BufferGeometry())
    shape.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    shape.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    shape.setIndex(indices); shape.computeVertexNormals()
    const facing = kit.own(surface.clone()); facing.side = THREE.DoubleSide
    kit.mesh(parent, shape, facing)
    if (enclosed) {
      for (let step = 0; step <= 8; step++) {
        const ring = kit.mesh(parent, kit.geometry('slide-flange', () => new THREE.TorusGeometry(0.65, 0.045, 6, 24)), cream)
        ring.position.copy(curve.getPointAt(step / 8))
        ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), curve.getTangentAt(step / 8))
      }
    } else {
      for (const side of [-1, 1]) {
        const edge = Array.from({ length: 30 }, (_, step): Point3 => {
          const progress = step / 29
          const centre = curve.getPointAt(progress)
          const right = new THREE.Vector3().crossVectors(curve.getTangentAt(progress), new THREE.Vector3(0, 1, 0)).normalize()
          centre.addScaledVector(right, side * 0.64)
          return [centre.x, centre.y, centre.z]
        })
        kit.tube(parent, edge, 0.045, steel)
      }
    }
  }

  if (kind === 'parkPlayStructure') {
  const towers = kit.group(root, 'playground-towers')
  kit.box(towers, [9, 0.045, 15.5], kit.material('rubber', 0x819b88), [-12.8, 0.025, -7.3], 0.015)
  for (const [index, [x, z, height]] of [[-15, -13, 2.5], [-15, -6, 1.8]].entries()) {
    const tower = kit.group(towers, `tower-${index}`, [x, 0, z])
    for (const dx of [-1.45, 1.45]) for (const dz of [-1.45, 1.45]) post(tower, dx, dz, height + 2.3)
    for (let plank = 0; plank < 12; plank++) kit.box(tower, [2.9, 0.14, 0.23], timber, [0, height, -1.35 + plank * 0.245])
    for (const side of [-1, 1]) {
      if (index === 1 && side === 1) {
        rail(tower, [1.45, height, -1.4], [1.45, height, -0.65])
        rail(tower, [1.45, height, 0.65], [1.45, height, 1.4])
      } else rail(tower, [side * 1.45, height, -1.4], [side * 1.45, height, 1.4])
    }
    rail(tower, [-1.4, height, -1.45], [-0.55, height, -1.45])
    rail(tower, [0.55, height, -1.45], [1.4, height, -1.45])
    const roof = kit.cylinder(tower, 2.2, 0.9, surfaces[index], [0, height + 2.55, 0], 0.12)
    roof.rotation.y = Math.PI / 4
    kit.cylinder(tower, 0.14, 0.18, steel, [0, height + 3.07, 0])
    kit.box(tower, [0.95, 0.9, 0.075], surfaces[index], [0.8, height + 0.57, 1.45], 0.12)
    for (let bead = 0; bead < 2; bead++) {
      const panel = kit.group(tower, `play-panel-${index}-${bead}`, [0.53 + bead * 0.28, height + 0.6, 1.53])
      kit.cylinder(panel, 0.115, 0.1, surfaces[(bead + index + 1) % 4]).rotation.x = Math.PI / 2
      kit.box(panel, [0.16, 0.025, 0.025], cream, [0, 0, 0.07])
      movingPart(motion, panel, `panel-${index}-${bead}`, 'z', Math.PI, true)
    }
  }
  const bridge = (start: Point3, end: Point3, flexible: boolean) => {
    const steps = 18
    for (let step = 0; step <= steps; step++) {
      const fraction = step / steps
      const point: Point3 = start.map((value, axis) => value + (end[axis] - value) * fraction) as Point3
      point[1] -= flexible ? Math.sin(fraction * Math.PI) * 0.45 : 0
      const alongX = Math.abs(end[0] - start[0]) > Math.abs(end[2] - start[2])
      kit.box(towers, alongX ? [0.23, 0.1, 1.15] : [1.15, 0.1, 0.23], timber, point)
      for (const side of [-1, 1]) {
        const foot: Point3 = [point[0] + (alongX ? 0 : side * 0.57), point[1], point[2] + (alongX ? side * 0.57 : 0)]
        kit.beam(towers, foot, [foot[0], foot[1] + 1, foot[2]], 0.025, flexible ? rope : steel)
      }
    }
    const alongX = Math.abs(end[0] - start[0]) > Math.abs(end[2] - start[2])
    for (const side of [-1, 1]) {
      const points = Array.from({ length: 12 }, (_, step): Point3 => {
        const fraction = step / 11
        return [start[0] + (end[0] - start[0]) * fraction + (alongX ? 0 : side * 0.57), start[1] + (end[1] - start[1]) * fraction + 1 - (flexible ? Math.sin(fraction * Math.PI) * 0.45 : 0), start[2] + (end[2] - start[2]) * fraction + (alongX ? side * 0.57 : 0)]
      })
      kit.tube(towers, points, 0.045, flexible ? rope : steel)
    }
  }
  bridge([-15, 2.5, -11.5], [-15, 1.8, -7.5], true)
  slide(towers, [[-15, 3.15, -14.5], [-12, 2.8, -14], [-10, 1.5, -12], [-9, 0.8, -10]], coral, true)
  slide(towers, [[-15, 2.45, -4.5], [-15, 2.2, -3.3], [-15, 1.2, -0.8], [-15, 0.75, 0]], steel, false)
  net(towers, [-16.45, 0.2, -10], [0, 0, 2.8], [0, 1.6, 1.2], 6, 4)
  const stairs = kit.group(towers, 'tower-side-stairs')
  for (let step = 0; step < 9; step++) kit.box(stairs, [0.35, 0.18, 1.15], timber, [-10.82 - step * 0.32, 0.2 + step * 0.2, -6])
  rail(stairs, [-10.65, 0.2, -6.58], [-13.55, 1.8, -6.58], 0.85)
  rail(stairs, [-10.65, 0.2, -5.42], [-13.55, 1.8, -5.42], 0.85)
  for (const z of [-6.5, -5.5]) {
    kit.beam(stairs, [-10.65, 0.08, z], [-13.55, 1.64, z], 0.065, steel)
    kit.beam(stairs, [-13.4, 0.05, z], [-13.4, 1.65, z], 0.065, steel)
  }
  slide(towers, [[-14, 1.1, -9.5], [-12, 1.1, -9.5], [-10, 1.1, -9.5]], teal, true)
  kit.batch(towers)
  }
  if (kind === 'parkDiscoverySand') {
  const sandbox = kit.group(root, 'playground-sand-discovery', [-15.5, 0, 23])
  kit.box(sandbox, [12.3, 0.18, 9.3], kit.material('sand', 0xd8c69a), [0, 0.1, 0], 0.4)
  for (const side of [-1, 1]) {
    kit.box(sandbox, [12.8, 0.32, 0.3], timber, [0, 0.16, side * 4.65], 0.1)
    kit.box(sandbox, [0.3, 0.32, 9.3], timber, [side * 6.25, 0.16, 0], 0.1)
  }
  for (let mound = 0; mound < 3; mound++) kit.sphere(sandbox, 0.65, kit.material('sand', 0xd8c69a), [-4 + mound * 1.4, 0.12, -1.8 + mound % 3]).scale.set(1, 0.35, 0.8)
  for (let toy = 0; toy < 4; toy++) {
    const x = -4.7 + toy * 1.25, z = 2 + Math.sin(toy * 2) * 1.2
    kit.cylinder(sandbox, 0.16, 0.25, surfaces[toy % 4], [x, 0.26, z], 0.2)
    kit.tube(sandbox, [[x - 0.19, 0.35, z], [x, 0.61, z], [x + 0.19, 0.35, z]], 0.015, steel)
    kit.beam(sandbox, [x + 0.3, 0.24, z], [x + 0.5, 0.24, z + 0.45], 0.025, timber)
    kit.box(sandbox, [0.16, 0.025, 0.2], surfaces[(toy + 1) % 4], [x + 0.54, 0.24, z + 0.5], 0.03)
  }
  for (const [index, x] of [-3].entries()) {
    kit.cylinder(sandbox, 0.38, 0.42, dark, [x, 0.3, -2.3])
    const excavator = kit.group(sandbox, `excavator-${index}`, [x, 0.65, -2.3])
    kit.box(excavator, [0.5, 0.12, 0.45], teal, [0, 0.12, 0.35], 0.08)
    kit.beam(excavator, [0, 0.2, 0], [0, 1.2, -0.6], 0.075, yellow)
    kit.beam(excavator, [0, 1.2, -0.6], [0, 0.4, -1.4], 0.06, yellow)
    kit.beam(excavator, [0.12, 0.3, -0.1], [0.12, 0.9, -0.65], 0.026, steel)
    kit.box(excavator, [0.55, 0.32, 0.5], steel, [0, 0.2, -1.45], 0.08)
    for (const side of [-1, 1]) kit.beam(excavator, [side * 0.22, 0.3, 0.12], [side * 0.3, 0.7, -0.1], 0.025, dark)
    movingPart(motion, excavator, `excavator-${index}`, 'y', 0.7, true)
  }
  kit.box(sandbox, [1.8, 0.15, 1], timber, [0, 0.85, -2.7])
  for (const x of [-0.7, 0.7]) for (const z of [-3, -2.4]) post(sandbox, x, z, 0.8)
  kit.cylinder(sandbox, 0.28, 0.2, blue, [0, 0.99, -2.7], 0.4)
  kit.batch(sandbox)
  }
  if (kind === 'parkSpringRider') {
  const riders = kit.group(root, 'playground-riders')
  for (const [index, x] of [-1].entries()) {
    const z = 29.5
    kit.cylinder(riders, 0.32, 0.12, steel, [x, 0.1, z])
    const coil: Point3[] = Array.from({ length: 80 }, (_, step) => [x + Math.cos(step / 79 * Math.PI * 10) * 0.15, 0.15 + step / 79 * 0.55, z + Math.sin(step / 79 * Math.PI * 10) * 0.15])
    kit.tube(riders, coil, 0.035, steel, 80)
    const rider = kit.group(riders, `spring-rider-${index}`, [x, 0.72, z])
    kit.box(rider, [0.42, 0.12, 0.65], dark, [0, 0.1, 0.1], 0.08)
    kit.box(rider, [0.12, 0.5, 0.8], surfaces[index], [0, 0.12, -0.1], 0.15)
    kit.tube(rider, [[0, 0.1, -0.3], [0, 0.62, -0.4], [0, 0.75, -0.25]], 0.07, surfaces[index])
    kit.beam(rider, [-0.3, 0.55, -0.35], [0.3, 0.55, -0.35], 0.04, dark)
    kit.beam(rider, [-0.3, -0.12, -0.2], [0.3, -0.12, -0.2], 0.045, steel)
    movingPart(motion, rider, `rider-${index}`, 'x', 0.22, true)
  }
  kit.batch(riders)
  }
  if (kind === 'parkSeesaw') {
  const seesaw = kit.group(root, 'seesaw', [-3, 0, 25.6])
  kit.cylinder(seesaw, 0.22, 0.65, steel, [0, 0.33, 0])
  const plank = kit.group(seesaw, 'seesaw-arm', [0, 0.72, 0])
  kit.box(plank, [4.2, 0.18, 0.25], coral)
  for (const side of [-1, 1]) {
    kit.box(plank, [0.65, 0.12, 0.45], dark, [side * 1.65, 0.12, 0], 0.07)
    kit.tube(plank, [[side * 1.2, 0, -0.2], [side * 1.2, 0.5, -0.2], [side * 1.2, 0.5, 0.2], [side * 1.2, 0, 0.2]], 0.035, steel)
    kit.cylinder(seesaw, 0.3, 0.18, dark, [side * 1.8, 0.12, 0])
  }
  movingPart(motion, plank, 'seesaw-main', 'z', 0.2, true)
  kit.batch(seesaw)
  }
  const bounds = PLAYGROUND_EQUIPMENT[kind]
  root.position.set(-bounds.centreX, 0, -bounds.centreZ)
  const scaled = new THREE.Group()
  scaled.add(root)
  scaled.scale.setScalar(bounds.scale / 1.75)
  const result = new THREE.Group()
  result.add(scaled)
  result.userData.update = (elapsed: number) => motion.updates.forEach((update) => update(elapsed))
  return result
}