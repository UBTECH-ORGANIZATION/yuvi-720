import * as THREE from 'three'
import type { RoomKit } from './RoomCatalog'

const at = (object: THREE.Object3D, x: number, y: number, z: number) => {
  object.position.set(x, y, z)
  return object
}

export function buildSportsEquipment(kind: string, kit: RoomKit, tint: THREE.Color): THREE.Group {
  const group = new THREE.Group()
  const steel = kit.mat('metal', 0x34444b)
  const dark = kit.mat('dark', 0x151c20)
  const rubber = kit.mat('matte', 0x202629)
  const accent = kit.mat('gloss', tint)
  const chrome = kit.mat('metal', 0xcbd6d9)
  const chalk = kit.mat('fabric', 0xe7e9e5)
  const link = (start: number[], end: number[], radius: number, material = steel, name = 'welded-tube') => {
    const from = new THREE.Vector3(...start)
    const to = new THREE.Vector3(...end)
    const mesh = kit.cyl(radius, radius, from.distanceTo(to), material, 10)
    mesh.position.copy(from.clone().add(to).multiplyScalar(0.5))
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.sub(from).normalize())
    mesh.name = name
    group.add(mesh)
    return mesh
  }
  const bolt = (x: number, y: number, z: number) => {
    const mesh = at(kit.cyl(0.035, 0.035, 0.025, chrome, 6), x, y, z)
    mesh.rotation.x = Math.PI / 2
    mesh.name = 'hex-bolt'
    group.add(mesh)
  }
  const plate = (x: number, y: number, z: number, radius = 0.36) => {
    const weight = at(kit.cyl(radius, radius, 0.08, rubber, 24), x, y, z)
    weight.rotation.z = Math.PI / 2
    weight.name = 'weight-plate'
    group.add(weight)
    const hub = at(kit.tor(radius * 0.28, 0.02, chrome), x + Math.sign(x) * 0.045, y, z)
    hub.rotation.y = Math.PI / 2
    group.add(hub)
    if (kit.rich) {
      const edge = at(kit.tor(radius * 0.87, 0.009, steel), x + Math.sign(x) * 0.045, y, z)
      edge.rotation.y = Math.PI / 2
      group.add(edge)
    }
  }
  const pad = (width: number, depth: number, x: number, y: number, z: number, angle = 0) => {
    const cushion = new THREE.Group()
    cushion.name = 'stitched-padding'
    cushion.position.set(x, y, z)
    cushion.rotation.x = angle
    cushion.add(kit.rbox(width, 0.16, depth, 0.055, kit.mat('fabric', tint)))
    for (const side of [-1, 1]) {
      cushion.add(at(kit.box(0.008, 0.006, depth - 0.1, chalk), side * (width / 2 - 0.04), 0.081, 0))
      if (kit.rich) for (let stitch = -depth / 2 + 0.1; stitch < depth / 2 - 0.08; stitch += 0.07) {
        cushion.add(at(kit.box(0.017, 0.006, 0.007, chalk), side * (width / 2 - 0.065), 0.081, stitch))
      }
    }
    group.add(cushion)
  }
  group.name = kind
  const bar = (length: number, x: number, y: number, z: number) => {
    const mesh = at(kit.cyl(0.055, 0.055, length, chrome, 10), x, y, z)
    mesh.rotation.z = Math.PI / 2
    group.add(mesh)
  }

  if (kind === 'sportsDumbbellRack') {
    group.name = kind
    for (const x of [-1.25, 1.25]) {
      group.add(at(kit.rbox(0.12, 1.25, 0.12, 0.015, steel), x, 0.66, -0.12))
      group.add(at(kit.rbox(0.3, 0.08, 0.86, 0.025, rubber), x, 0.04, 0))
      for (const y of [0.35, 0.94]) {
        group.add(at(kit.box(0.18, 0.12, 0.64, steel), x, y, 0))
        for (const z of [-0.29, 0.29]) {
          const bolt = at(kit.cyl(0.035, 0.035, 0.025, chrome, 6), x, y + 0.07, z)
          bolt.name = 'rack-bolt'
          group.add(bolt)
        }
      }
    }
    for (const y of [0.39, 0.98]) {
      for (const z of [-0.22, 0.22]) {
        group.add(at(kit.box(2.8, 0.06, 0.16, steel), 0, y, z))
        group.add(at(kit.box(2.8, 0.022, 0.17, rubber), 0, y + 0.04, z))
      }
      for (const [index, x] of [-1.08, -0.54, 0, 0.54, 1.08].entries()) {
        const radius = 0.135 + index * 0.012
        const center = y + radius + 0.05
        bar(0.44, x, center, 0)
        for (const side of [-1, 1]) {
          const weight = at(kit.cyl(radius, radius, 0.105, rubber, 12), x + side * 0.185, center, 0)
          weight.rotation.z = Math.PI / 2
          weight.name = 'dumbbell-weight'
          group.add(weight)
          const cap = at(kit.cyl(0.045, 0.045, 0.015, chrome, 12), x + side * 0.244, center, 0)
          cap.rotation.z = Math.PI / 2
          group.add(cap)
        }
        if (kit.rich) for (let grip = -3; grip <= 3; grip++) {
          const ring = at(kit.tor(0.055, 0.004, dark), x + grip * 0.025, center, 0)
          ring.rotation.y = Math.PI / 2
          ring.name = 'knurled-grip'
          group.add(ring)
        }
      }
    }
  } else if (kind === 'sportsSquatRack') {
    for (const x of [-1.35, 1.35]) {
      for (const z of [-0.55, 0.58]) {
        group.add(at(kit.rbox(0.15, 3.05, 0.15, 0.02, steel), x, 1.53, z))
        for (let height = 0.55; height < 2.8; height += 0.18) {
          const hole = at(kit.cyl(0.024, 0.024, 0.008, dark, 8), x, height, z + 0.078)
          hole.rotation.x = Math.PI / 2
          group.add(hole)
        }
        for (const height of [0.18, 2.92]) bolt(x, height, z + 0.09)
      }
      group.add(at(kit.rbox(0.42, 0.08, 1.65, 0.025, rubber), x, 0.04, 0.08))
      link([x, 1.1, -0.55], [x, 1.1, 0.58], 0.07)
      group.add(at(kit.box(0.16, 0.1, 0.32, accent), x, 2.25, -0.36))
      group.add(at(kit.box(0.16, 0.19, 0.07, steel), x, 2.3, -0.2))
      for (const offset of [0, 0.1]) plate(Math.sign(x) * (1.5 + offset), 2.42, -0.3)
    }
    link([-1.35, 2.98, -0.55], [1.35, 2.98, -0.55], 0.07)
    link([-1.35, 2.9, 0.58], [1.35, 2.9, 0.58], 0.04, rubber, 'pull-up-grip')
    bar(3.25, 0, 2.42, -0.3)
  } else if (kind === 'sportsCableMachine') {
    for (const x of [-0.9, 0.9]) {
      for (const offset of [-0.32, 0.32]) {
        group.add(at(kit.box(0.12, 3.05, 0.12, steel), x + offset, 1.53, -0.16))
        link([x + offset * 0.55, 0.16, 0], [x + offset * 0.55, 2.8, 0], 0.022, chrome)
        bolt(x + offset, 2.85, -0.085)
      }
      group.add(at(kit.rbox(0.85, 0.09, 1.05, 0.025, rubber), x, 0.045, 0))
      for (let index = 0; index < 10; index++) {
        group.add(at(kit.rbox(0.55, 0.075, 0.3, 0.012, dark), x, 0.22 + index * 0.09, 0))
        bolt(x, 0.22 + index * 0.09, 0.17)
      }
      for (const y of [1.65, 2.72]) {
        const pulley = at(kit.tor(0.13, 0.025, steel), x, y, 0.24)
        pulley.name = 'grooved-pulley'
        group.add(pulley)
        bolt(x, y, 0.26)
      }
      link([x - 0.13, 1.06, 0.24], [x - 0.13, 2.72, 0.24], 0.009, dark, 'tensioned-cable')
      const wrap = at(kit.tor(0.13, 0.009, dark), x, 2.72, 0.24)
      group.add(wrap)
      link([x + 0.13, 2.72, 0.24], [x + 0.13, 1.4, 0.24], 0.009, dark, 'tensioned-cable')
      link([x + 0.13, 1.4, 0.24], [x - 0.05, 1.12, 0.4], 0.025, chrome)
      link([x + 0.13, 1.4, 0.24], [x + 0.31, 1.12, 0.4], 0.025, chrome)
      link([x - 0.05, 1.12, 0.4], [x + 0.31, 1.12, 0.4], 0.04, rubber, 'cable-grip')
    }
    group.add(at(kit.rbox(2.6, 0.15, 0.22, 0.025, steel), 0, 2.98, 0))
    link([-0.45, 2.82, 0.1], [0.45, 2.82, 0.1], 0.045, rubber)
  } else if (kind === 'sportsLegPress') {
    for (const x of [-0.65, 0.65]) {
      link([x, 0.1, 1.18], [x, 0.1, -1.18], 0.08)
      link([x, 0.32, 0.85], [x, 1.42, -0.95], 0.045, chrome, 'press-guide-rail')
      link([x, 0.1, -1.18], [x, 1.42, -0.95], 0.06)
      link([x, 0.35, 0.8], [x, 0.6, 0.5], 0.03, rubber)
      for (const z of [-1.18, 1.18]) group.add(at(kit.box(0.28, 0.08, 0.32, rubber), x, 0.04, z))
      plate(Math.sign(x) * 0.85, 1.13, -0.55, 0.29)
      bolt(x, 0.2, 1.18)
    }
    link([-0.65, 0.1, 0.8], [0.65, 0.1, 0.8], 0.08)
    pad(0.9, 0.6, 0, 0.38, 0.55)
    pad(0.9, 0.72, 0, 0.7, 0.96, 1.05)
    const foot = at(kit.rbox(1.25, 0.1, 0.72, 0.025, steel), 0, 1.17, -0.55)
    foot.rotation.x = -0.7
    group.add(foot)
    for (let tread = -0.5; tread <= 0.5; tread += 0.1) {
      const ridge = kit.box(0.025, 0.012, 0.62, rubber)
      ridge.position.set(tread, 0.06, 0)
      foot.add(ridge)
    }
  } else if (kind === 'sportsAdjustableBench') {
    pad(0.7, 0.55, 0, 0.6, 0.55)
    pad(0.7, 1.25, 0, 0.94, -0.28, -0.55)
    link([0, 0.3, 0.7], [0, 0.3, -0.9], 0.07)
    link([0, 0.3, -0.72], [0, 1.02, -0.65], 0.05, chrome)
    for (const z of [-0.8, 0.65]) {
      link([0, 0.1, z], [0, 0.55, z], 0.065)
      link([-0.48, 0.08, z], [0.48, 0.08, z], 0.06)
      for (const x of [-0.46, 0.46]) group.add(at(kit.rbox(0.18, 0.1, 0.23, 0.02, rubber), x, 0.05, z))
    }
    for (const z of [-0.6, -0.4, -0.2, 0]) group.add(at(kit.box(0.14, 0.08, 0.06, accent), 0, 0.39, z))
    bolt(0, 0.6, 0.23)
  } else if (kind === 'sportsRacketCorner') {
    group.add(at(kit.rbox(1.65, 0.12, 0.72, 0.04, dark), 0, 0.06, 0))
    for (const x of [-0.7, 0.7]) link([x, 0.12, 0.22], [x, 1.55, 0.22], 0.035)
    link([-0.7, 0.95, 0.22], [0.7, 0.95, 0.22], 0.035)
    for (const [index, x] of [-0.53, 0, 0.53].entries()) {
      const racket = new THREE.Group()
      racket.name = ['tennis-racket', 'badminton-racket', 'padel-paddle'][index]
      racket.position.x = x
      racket.add(at(kit.cyl(0.033, 0.033, 0.32, rubber, 12), 0, 0.56, 0))
      racket.add(at(kit.cyl(0.014, 0.014, 0.4, chrome, 12), 0, 0.91, 0))
      const radius = index === 1 ? 0.19 : 0.22
      const head = at(kit.tor(radius, 0.025, accent), 0, 1.32, 0)
      head.scale.y = 1.32
      racket.add(head)
      if (index === 2) {
        const face = at(kit.cyl(radius - 0.01, radius - 0.01, 0.045, accent, 28), 0, 1.32, 0)
        face.rotation.x = Math.PI / 2
        face.scale.z = 1.32
        racket.add(face)
        for (let row = -2; row <= 2; row++) for (let column = -2; column <= 2; column++) {
          if (row * row + column * column > 6) continue
          const hole = at(kit.cyl(0.017, 0.017, 0.002, dark, 8), column * 0.062, 1.32 + row * 0.074, 0.024)
          hole.rotation.x = Math.PI / 2
          racket.add(hole)
        }
      } else {
        for (let index = -3; index <= 3; index++) {
          const offset = index * radius / 4
          const chord = 2 * Math.sqrt(radius * radius - offset * offset)
          racket.add(at(kit.box(0.004, chord * 1.32, 0.004, chalk), offset, 1.32, 0))
          racket.add(at(kit.box(chord, 0.004, 0.004, chalk), 0, 1.32 + offset * 1.32, 0))
        }
      }
      for (let wrap = 0; wrap < 6; wrap++) {
        const grip = at(kit.tor(0.033, 0.003, chalk), 0, 0.44 + wrap * 0.045, 0)
        grip.rotation.x = Math.PI / 2
        racket.add(grip)
      }
      group.add(racket)
    }
    for (const x of [-0.55, -0.38]) group.add(at(kit.sph(0.07, kit.mat('fabric', 0xc9d752)), x, 0.2, 0.2))
  } else if (kind === 'sportsSeatingBench' || kind === 'sportsParkBench') {
    const slat = kind === 'sportsParkBench' ? kit.mat('wood', 0xad9271) : chrome
    for (const z of [-0.28, 0, 0.28]) group.add(at(kit.rbox(3.05, 0.1, 0.23, 0.02, slat), 0, 0.59, z))
    for (const x of [-1.15, 1.15]) {
      link([x, 0.08, -0.35], [x, 0.54, -0.2], 0.055)
      link([x, 0.08, 0.35], [x, 0.54, 0.2], 0.055)
      link([x, 0.52, -0.35], [x, 0.52, 0.35], 0.055)
      for (const z of [-0.28, 0, 0.28]) {
        const screw = at(kit.cyl(0.018, 0.018, 0.012, chrome, 6), x, 0.646, z)
        group.add(screw)
      }
      if (kind === 'sportsParkBench') link([x, 0.15, -0.3], [x, 1.2, -0.45], 0.045)
    }
    if (kind === 'sportsParkBench') for (const height of [0.85, 1.12]) group.add(at(kit.rbox(3.05, 0.2, 0.1, 0.025, slat), 0, height, -0.43))
  } else if (kind === 'sportsWallScoreboard') {
    group.name = 'yubis-gym-sign'
    group.add(at(kit.rbox(6, 2.7, 0.23, 0.06, steel), 0, 1.35, 0))
    group.add(at(kit.rbox(5.86, 2.56, 0.035, 0.035, kit.mat('emissive', 0x64bdaf)), 0, 1.35, 0.13))
    group.add(at(kit.box(5.76, 2.46, 0.025, dark), 0, 1.35, 0.155))
    const face = at(kit.plane(5.7, 2.4, kit.gymSignPrint()), 0, 1.35, 0.173)
    face.name = 'gym-sign-face'
    group.add(face)
    for (const x of [-2.94, 2.94]) for (const y of [0.08, 2.62]) bolt(x, y, 0.13)
  } else if (kind === 'sportsPortableScoreboard') {
    const portable = kind === 'sportsPortableScoreboard'
    const center = portable ? 1.55 : 0.55
    group.add(at(kit.rbox(1.7, 0.95, 0.17, 0.035, steel), 0, center, 0))
    group.add(at(kit.box(1.57, 0.82, 0.015, dark), 0, center, 0.092))
    for (const x of [-0.52, -0.23, 0.23, 0.52]) {
      const dash = at(kit.box(0.18, 0.025, 0.015, kit.mat('emissive', 0xb6cdbd)), x, center, 0.107)
      dash.name = 'idle-dash'
      group.add(dash)
    }
    for (const x of [-0.76, 0.76]) for (const y of [-0.38, 0.38]) bolt(x, center + y, 0.1)
    if (kit.rich) for (let vent = -0.55; vent < 0.6; vent += 0.1) group.add(at(kit.box(0.035, 0.06, 0.005, dark), vent, center - 0.44, 0.09))
    if (portable) for (const x of [-0.62, 0.62]) {
      link([x, 0.12, 0], [x, 1.45, 0], 0.04)
      link([x, 0.15, -0.35], [x, 0.15, 0.35], 0.04)
      for (const z of [-0.32, 0.32]) {
        const wheel = at(kit.cyl(0.095, 0.095, 0.045, rubber, 12), x, 0.095, z)
        wheel.rotation.z = Math.PI / 2
        group.add(wheel)
      }
    }
  } else if (kind === 'sportsJerseyDisplay' || kind === 'sportsJerseyDisplayAlt') {
    const away = kind === 'sportsJerseyDisplayAlt'
    const fabric = kit.mat('fabric', tint)
    group.add(at(kit.rbox(1.35, 1.75, 0.12, 0.025, away ? chrome : dark), 0, 0.875, 0))
    group.add(at(kit.box(1.22, 1.62, 0.018, kit.mat('fabric', 0xe2e4df)), 0, 0.875, 0.07))
    group.add(at(kit.rbox(0.6, 0.84, 0.045, 0.025, fabric), 0, 0.89, 0.1))
    for (const side of [-1, 1]) {
      const sleeve = at(kit.rbox(0.31, 0.32, 0.045, 0.02, fabric), side * 0.35, 1.21, 0.1)
      sleeve.rotation.z = side * 0.55
      group.add(sleeve)
      for (const y of [0.5, 1.08]) group.add(at(kit.box(0.012, 0.008, 0.006, chalk), side * 0.27, y, 0.126))
    }
    const collar = at(kit.tor(0.11, 0.018, chalk), 0, 1.29, 0.127)
    collar.scale.y = 0.6
    group.add(collar)
    for (let fold = -2; fold <= 2; fold++) {
      const crease = at(kit.rbox(0.045, 0.66, 0.018, 0.008, fabric), fold * 0.1, 0.84, 0.127)
      crease.rotation.z = fold * 0.022
      crease.name = 'jersey-fold'
      group.add(crease)
    }
    if (away) for (const y of [0.75, 0.92]) group.add(at(kit.box(0.56, 0.06, 0.012, chalk), 0, y, 0.146))
    else group.add(at(kit.box(0.055, 0.65, 0.012, chalk), -0.16, 0.86, 0.146))
    group.add(at(kit.box(1.23, 1.63, 0.012, kit.mat('glass', 0xffffff)), 0, 0.875, 0.18))
  } else if (kind === 'sportsBasketballHoop') {
    group.add(at(kit.rbox(2.5, 0.18, 1.6, 0.04, rubber), 0, 0.09, -0.25))
    link([0, 0.18, -0.65], [0, 3.15, -0.65], 0.1)
    link([0, 2.5, -0.65], [0, 3.6, 0], 0.06)
    group.add(at(kit.rbox(2.35, 1.45, 0.08, 0.025, kit.mat('glass', 0xe5eee9)), 0, 3.4, 0))
    for (const x of [-1.18, 1.18]) group.add(at(kit.box(0.055, 1.5, 0.09, steel), x, 3.4, 0))
    for (const y of [2.66, 4.14]) group.add(at(kit.box(2.4, 0.055, 0.09, steel), 0, y, 0))
    for (const x of [-0.45, 0.45]) group.add(at(kit.box(0.03, 0.52, 0.01, chalk), x, 3.08, 0.05))
    for (const y of [2.82, 3.34]) group.add(at(kit.box(0.9, 0.03, 0.01, chalk), 0, y, 0.05))
    const rim = at(kit.tor(0.42, 0.027, accent), 0, 2.86, 0.46)
    rim.rotation.x = Math.PI / 2
    group.add(rim)
    link([0, 2.86, 0], [0, 2.86, 0.2], 0.04)
    const count = kit.rich ? 16 : 10
    for (let row = 0; row < 4; row++) for (let index = 0; index < count; index++) {
      const angle = index / count * Math.PI * 2 + (row % 2) * Math.PI / count
      const radius = 0.42 - row * 0.045
      for (const side of [-1, 1]) {
        const next = angle + side * Math.PI / count
        link([Math.cos(angle) * radius, 2.84 - row * 0.13, 0.46 + Math.sin(angle) * radius], [Math.cos(next) * (radius - 0.045), 2.71 - row * 0.13, 0.46 + Math.sin(next) * (radius - 0.045)], 0.006, chalk, 'basketball-net')
      }
    }
    for (const x of [-0.28, 0.28]) bolt(x, 0.2, -0.55)
  } else if (kind === 'sportsMiniGoal') {
    for (const x of [-1.5, 1.5]) {
      link([x, 0.06, -0.45], [x, 1.2, -0.45], 0.05, chalk)
      link([x, 0.06, -0.45], [x, 0.06, 0.65], 0.045, chalk)
      link([x, 1.2, -0.45], [x, 0.06, 0.65], 0.035, chalk)
      bolt(x, 0.15, -0.39)
    }
    link([-1.5, 1.2, -0.45], [1.5, 1.2, -0.45], 0.05, chalk)
    link([-1.5, 0.06, 0.65], [1.5, 0.06, 0.65], 0.04, chalk)
    for (let column = 0; column <= 20; column++) {
      const x = -1.5 + column * 0.15
      link([x, 1.18, -0.44], [x, 0.07, 0.64], 0.005, chalk, 'goal-net')
    }
    for (let row = 0; row <= 8; row++) {
      const height = 0.07 + row * 1.11 / 8
      const depth = 0.64 - row * 1.08 / 8
      link([-1.5, height, depth], [1.5, height, depth], 0.005, chalk, 'goal-net')
      for (const x of [-1.5, 1.5]) link([x, height, -0.44], [x, height, depth], 0.005, chalk, 'goal-net')
    }
  }
  return group
}