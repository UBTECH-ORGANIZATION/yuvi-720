/* Isometric diorama platforms for the track.

   The stations were floating gems, which read as "abstract markers on a line".
   A route the learner is meant to feel they are travelling wants PLACES, so each
   component is a small lit stage: a slab to stand on, a glass corner behind it,
   and corner lights that carry the state colour.

   Two rules this file exists to hold:

   1. EVERY STATION LOOKS DIFFERENT. Furnishing by pedagogical purpose alone was
      not enough — this unit has three `practice` components in a row, so three
      identical labs appeared and the route stopped reading as a journey. The
      design is therefore chosen per STATION (`designFor`), with purpose only
      deciding which family it is drawn from.

   2. HOVER POWERS THE ROOM UP. At rest every screen, lamp and readout is DARK;
      pointing at a station switches that station's own equipment on — the board
      lights and its chart draws itself, the balance wakes and the flasks bubble,
      the festoon lights chase along the awning, the welding arm throws sparks,
      the exam clock races. Each design animates its own props, so the effect
      says something about the place rather than being a generic glow.

   Everything is procedural — no textures to ship. */

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

export interface Platform {
  group: THREE.Group
  /** The face the mascot and the halo sit on. */
  standY: number
  /** Picking target — one box, so the raycast stays cheap. */
  hitbox: THREE.Mesh
  update: (elapsed: number, hovered: boolean, delta: number) => void
}

/** What this component is FOR. Decides which family of rooms it is drawn from. */
export type RoomKind = 'instruction' | 'practice' | 'assessment' | 'activity'

/** The actual place. Several designs share a purpose so that a unit with a run
 *  of practice components still reads as several different rooms. */
export type RoomDesign = 'classroom' | 'lab' | 'market' | 'workshop' | 'exam' | 'studio'

/** Designs available to each purpose, in the order they are handed out. The
 *  caller passes the OCCURRENCE of the purpose, so the second practice component
 *  in a unit gets the workshop and the third the market. */
const DESIGNS: Record<RoomKind, RoomDesign[]> = {
  instruction: ['classroom', 'studio'],
  practice: ['lab', 'workshop', 'market'],
  activity: ['market', 'studio', 'workshop'],
  assessment: ['exam'],
}

export function designFor(kind: RoomKind, occurrence: number): RoomDesign {
  const options = DESIGNS[kind]
  return options[occurrence % options.length]
}

export interface PlatformOptions {
  color: number
  locked: boolean
  current: boolean
  /** Assessment stations get a taller, more formal stage. */
  assessment: boolean
  design: RoomDesign
}

const SIZE = 2
const SLAB = 0.34
/** Inner face of the two glass panes — furniture stands against these. */
const WALL = SIZE / 2 - 0.08
/** Top of the deck: the floor everything in the room rests on. */
const FLOOR = SLAB / 2

interface Furnishing {
  group: THREE.Group
  alive: (elapsed: number, hover: number) => void
}

type Keep = <T extends { dispose(): void }>(item: T) => T

/* Shared kit every room is built from. Collected in one place so each design
   reads as a list of things in a room rather than as material boilerplate. */
function kit(color: number, locked: boolean, keep: Keep) {
  const room = new THREE.Group()

  const std = (options: THREE.MeshStandardMaterialParameters) =>
    keep(new THREE.MeshStandardMaterial(locked
      ? { ...options, color: 0x39406e, emissive: 0x000000, roughness: 0.8, metalness: 0.05 }
      : options))

  const body = std({ color: 0xc3caf0, roughness: 0.66, metalness: 0.08 })
  const white = std({ color: 0xf2f5ff, roughness: 0.5, metalness: 0.04 })
  const metal = std({ color: 0x8f9ac9, roughness: 0.35, metalness: 0.55 })
  const dark = std({ color: 0x434a7d, roughness: 0.7, metalness: 0.2 })
  const wood = std({ color: 0xc89a6b, roughness: 0.8, metalness: 0.02 })
  const leaf = std({ color: 0x5fbf88, roughness: 0.75, metalness: 0.02 })
  const accent = keep(new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: locked ? 0.16 : 0.9,
  }))

  /** Flat colour — cloth, paper, produce: things that are not lit sources. */
  const flat = (hex: number, opacity = 0.95) => keep(new THREE.MeshBasicMaterial({
    color: locked ? 0x39406e : hex, transparent: true, opacity: locked ? 0.18 : opacity,
  }))

  /* Anything with a power switch. DARK at rest — that is what makes hovering a
     station feel like turning the place on rather than just brightening it. */
  const powered: { mat: THREE.MeshStandardMaterial; peak: number }[] = []
  const screen = (hex: number, peak = 1.7) => {
    const material = keep(new THREE.MeshStandardMaterial({
      color: locked ? 0x2b3160 : 0x11162f,
      emissive: hex,
      emissiveIntensity: 0,
      roughness: 0.3,
      toneMapped: false,
    }))
    if (!locked) powered.push({ mat: material, peak })
    return material
  }

  const box = (w: number, h: number, d: number, material: THREE.Material) =>
    new THREE.Mesh(keep(new RoundedBoxGeometry(w, h, d, 2, Math.min(0.03, h / 3))), material)
  const cyl = (rt: number, rb: number, h: number, material: THREE.Material, seg = 12) =>
    new THREE.Mesh(keep(new THREE.CylinderGeometry(rt, rb, h, seg)), material)
  const ball = (r: number, material: THREE.Material) =>
    new THREE.Mesh(keep(new THREE.SphereGeometry(r, 12, 10)), material)

  /** A small occupant. At this camera a room is ~150px tall, so the read is the
   *  silhouette and the colour of the top; anything finer is wasted. */
  const folk: { group: THREE.Group; phase: number; facing: number }[] = []
  const person = (x: number, z: number, topHex: number, facing = 0) => {
    const g = new THREE.Group()
    const legs = cyl(0.045, 0.05, 0.15, dark, 8)
    legs.position.y = 0.075
    g.add(legs)
    const torso = box(0.15, 0.19, 0.11, flat(topHex))
    torso.position.y = 0.24
    g.add(torso)
    const head = ball(0.062, white)
    head.position.y = 0.39
    g.add(head)
    g.position.set(x, FLOOR, z)
    g.rotation.y = facing
    room.add(g)
    folk.push({ group: g, phase: x * 5 + z, facing })
    return g
  }

  // Floor covering — every room gets one, so the deck never reads as bare
  // scaffolding under the furniture.
  const rug = new THREE.Mesh(
    keep(new THREE.CircleGeometry(0.62, 24)),
    std({ color: 0x6f79c8, roughness: 0.9, transparent: true, opacity: 0.75 }),
  )
  rug.rotation.x = -Math.PI / 2
  rug.position.set(-0.12, FLOOR + 0.006, 0.1)
  room.add(rug)

  /** Drives every `screen()` material from the hover amount. Each design calls
   *  this from its own `alive`, usually with its own flicker on top. */
  const power = (hover: number, flicker = 1) => {
    for (const { mat, peak } of powered) mat.emissiveIntensity = peak * hover * flicker
  }
  const breathe = (elapsed: number, hover: number) => {
    for (const { group, phase, facing } of folk) {
      group.position.y = FLOOR + Math.abs(Math.sin(elapsed * 1.4 + phase)) * 0.012 * (1 + hover * 3)
      group.rotation.y = facing + Math.sin(elapsed * 0.9 + phase) * 0.12 * (0.25 + hover)
    }
  }

  return {
    room, body, white, metal, dark, wood, leaf, accent,
    flat, screen, box, cyl, ball, person, power, breathe,
  }
}

/* ── The rooms ─────────────────────────────────────────────────────────────
   Each one builds its props and returns its OWN hover behaviour. */

function classroom(color: number, locked: boolean, keep: Keep): Furnishing {
  const k = kit(color, locked, keep)
  const { room, box, cyl, flat, screen, person } = k

  const boardFrame = box(1.5, 0.86, 0.06, k.dark)
  boardFrame.position.set(0.02, FLOOR + 0.82, -WALL + 0.05)
  room.add(boardFrame)
  const board = box(1.34, 0.68, 0.02, screen(0x8ce6ff, 1.9))
  board.position.set(0.02, FLOOR + 0.82, -WALL + 0.1)
  room.add(board)

  // What APPEARS on the board when the room powers up: a bar chart that grows
  // in, and notes that write themselves one line at a time.
  const bars: THREE.Mesh[] = []
  for (let i = 0; i < 5; i += 1) {
    const bar = box(0.08, 0.34, 0.012, flat(i === 2 ? 0xffd166 : 0x67d7a6))
    bar.position.set(0.24 + i * 0.12, FLOOR + 0.66, -WALL + 0.12)
    room.add(bar)
    bars.push(bar)
  }
  const lines: THREE.Mesh[] = []
  for (let i = 0; i < 4; i += 1) {
    const line = box(0.62 - i * 0.1, 0.04, 0.01, flat(0xdff3ff, 0.9))
    line.position.set(-0.34, FLOOR + 1.06 - i * 0.13, -WALL + 0.12)
    room.add(line)
    lines.push(line)
  }

  const lectern = box(0.34, 0.5, 0.26, k.wood)
  lectern.position.set(-0.6, FLOOR + 0.25, -0.06)
  room.add(lectern)
  const holo = new THREE.Mesh(keep(new THREE.IcosahedronGeometry(0.15, 0)), k.accent)
  holo.position.set(-0.6, FLOOR + 0.76, -0.06)
  room.add(holo)

  for (const [x, z] of [[0.2, 0.32], [0.66, 0.32]] as const) {
    const desk = box(0.4, 0.05, 0.24, k.wood)
    desk.position.set(x, FLOOR + 0.36, z)
    room.add(desk)
    for (const dx of [-0.16, 0.16]) {
      const leg = box(0.04, 0.34, 0.04, k.metal)
      leg.position.set(x + dx, FLOOR + 0.18, z)
      room.add(leg)
    }
    const chair = cyl(0.09, 0.09, 0.2, k.dark, 10)
    chair.position.set(x, FLOOR + 0.1, z + 0.26)
    room.add(chair)
  }
  person(0.2, 0.58, 0xff8fab, -0.1)
  person(0.66, 0.58, 0x4cc9f0, 0.12)
  person(-0.6, 0.2, 0xc4b5fd, Math.PI * 0.85)

  return {
    group: room,
    alive: (elapsed, hover) => {
      k.power(hover, 1 + Math.sin(elapsed * 9) * 0.05 * hover)
      bars.forEach((bar, i) => {
        const grow = Math.max(0.06, Math.min(1, hover * 5 - i * 0.6))
        bar.scale.y = grow
        bar.position.y = FLOOR + 0.49 + (0.34 * grow) / 2
      })
      lines.forEach((line, i) => {
        line.scale.x = Math.max(0.02, Math.min(1, hover * 5 - i * 0.7))
      })
      holo.rotation.y = elapsed * (0.4 + hover * 2.6)
      holo.position.y = FLOOR + 0.76 + hover * 0.1 + Math.sin(elapsed * 1.6) * 0.02
      k.breathe(elapsed, hover)
    },
  }
}

function lab(color: number, locked: boolean, keep: Keep): Furnishing {
  const k = kit(color, locked, keep)
  const { room, box, cyl, flat, screen, person } = k

  // Bank of three monitors whose output comes on in sequence.
  const rows: { mesh: THREE.Mesh; index: number }[] = []
  ;([[-0.52, 0.34], [0, 0], [0.52, -0.34]] as const).forEach(([x, tilt], i) => {
    const frame = box(0.5, 0.4, 0.04, k.dark)
    frame.position.set(x, FLOOR + 0.92, -WALL + 0.1)
    frame.rotation.y = tilt
    room.add(frame)
    const panel = box(0.44, 0.34, 0.02, screen(0x8ce6ff, 1.5 + i * 0.2))
    panel.position.set(x, FLOOR + 0.92, -WALL + 0.13)
    panel.rotation.y = tilt
    room.add(panel)
    for (let r = 0; r < 4; r += 1) {
      const row = box(0.3 - r * 0.04, 0.026, 0.01, flat(r === 0 ? 0xffd166 : 0x8ce6ff, 0.9))
      row.position.set(x - 0.04, FLOOR + 1.03 - r * 0.07, -WALL + 0.15)
      row.rotation.y = tilt
      room.add(row)
      rows.push({ mesh: row, index: i * 4 + r })
    }
  })

  const bench = box(1.5, 0.07, 0.44, k.white)
  bench.position.set(-0.02, FLOOR + 0.56, -WALL + 0.34)
  room.add(bench)
  for (const x of [-0.68, 0.6]) {
    const cabinet = box(0.24, 0.5, 0.38, k.body)
    cabinet.position.set(x, FLOOR + 0.27, -WALL + 0.34)
    room.add(cabinet)
  }

  // The balance — the instrument this unit is about. Its readout waking up is
  // the clearest "the equipment just switched on" signal in the scene.
  const plate = cyl(0.13, 0.13, 0.02, k.metal, 16)
  plate.position.set(-0.42, FLOOR + 0.64, -WALL + 0.32)
  room.add(plate)
  const readout = box(0.18, 0.08, 0.1, screen(0x67d7a6, 2.4))
  readout.position.set(-0.42, FLOOR + 0.66, -WALL + 0.46)
  room.add(readout)
  const sample = box(0.14, 0.1, 0.14, flat(0xff8fab))
  sample.position.set(-0.42, FLOOR + 0.7, -WALL + 0.32)
  room.add(sample)

  // Flasks that bubble while the bench is running.
  const bubbles: { mesh: THREE.Mesh; base: number; phase: number }[] = []
  ;([[0.08, 0x4cc9f0], [0.26, 0xff8fab], [0.44, 0xffd166]] as const).forEach(([x, hex], i) => {
    const flask = cyl(0.07, 0.09, 0.19, flat(hex, 0.85), 10)
    flask.position.set(x, FLOOR + 0.69, -WALL + 0.3)
    room.add(flask)
    for (let b = 0; b < 2; b += 1) {
      const bubble = k.ball(0.02, flat(0xffffff, 0.8))
      bubble.position.set(x, FLOOR + 0.66, -WALL + 0.3)
      room.add(bubble)
      bubbles.push({ mesh: bubble, base: FLOOR + 0.62, phase: i * 1.3 + b * 0.9 })
    }
  })

  const stool = cyl(0.15, 0.13, 0.34, k.metal, 12)
  stool.position.set(-0.1, FLOOR + 0.17, 0.2)
  room.add(stool)
  person(0.34, 0.3, 0x8ce6ff, Math.PI * 0.9)

  return {
    group: room,
    alive: (elapsed, hover) => {
      k.power(hover)
      rows.forEach(({ mesh, index }) => {
        mesh.scale.x = 0.04 + Math.max(0, Math.min(1, hover * 4 - index * 0.12)) * 0.96
      })
      for (const { mesh, base, phase } of bubbles) {
        const t = (elapsed * 0.8 + phase) % 1
        mesh.position.y = base + t * 0.16
        ;(mesh.material as THREE.MeshBasicMaterial).opacity = hover * (1 - t) * 0.9
      }
      stool.rotation.y = elapsed * (0.2 + hover * 3)
      k.breathe(elapsed, hover)
    },
  }
}

function market(color: number, locked: boolean, keep: Keep): Furnishing {
  const k = kit(color, locked, keep)
  const { room, box, cyl, flat, screen, person } = k

  const counter = box(1.12, 0.44, 0.34, k.wood)
  counter.position.set(-0.16, FLOOR + 0.22, -0.22)
  room.add(counter)
  const counterTop = box(1.2, 0.05, 0.4, k.white)
  counterTop.position.set(-0.16, FLOOR + 0.46, -0.22)
  room.add(counterTop)

  // Striped awning — the signature of the stall.
  ;[0xff8fab, 0xf7f9ff, 0xff8fab, 0xf7f9ff, 0xff8fab].forEach((hex, i) => {
    const panel = box(0.26, 0.03, 0.42, flat(hex))
    panel.position.set(-0.68 + i * 0.26, FLOOR + 1.02, -0.34)
    panel.rotation.x = -0.32
    room.add(panel)
  })
  for (const x of [-0.72, 0.34]) {
    const pole = cyl(0.028, 0.028, 0.62, k.metal, 8)
    pole.position.set(x, FLOOR + 0.72, -0.16)
    room.add(pole)
  }

  // Festoon lights under the awning. They CHASE along the string rather than
  // all lighting at once — this stall's own way of opening for business.
  const bulbs: THREE.Mesh[] = []
  for (let i = 0; i < 7; i += 1) {
    const bulb = k.ball(0.032, screen(0xffd166, 2.6))
    bulb.position.set(-0.66 + i * 0.19, FLOOR + 0.9 + Math.sin(i * 0.9) * 0.02, -0.06)
    room.add(bulb)
    bulbs.push(bulb)
  }

  const goods: { mesh: THREE.Mesh; base: number; phase: number }[] = []
  ;[0x67d7a6, 0xffd166, 0xff8fab, 0x4cc9f0].forEach((hex, i) => {
    const crate = box(0.24, 0.16, 0.22, k.wood)
    crate.position.set(-0.6 + i * 0.29, FLOOR + 0.56, -0.22)
    room.add(crate)
    for (let n = 0; n < 3; n += 1) {
      const fruit = k.ball(0.045, flat(hex))
      fruit.position.set(-0.66 + i * 0.29 + n * 0.055, FLOOR + 0.67, -0.24 + (n % 2) * 0.06)
      room.add(fruit)
      goods.push({ mesh: fruit, base: fruit.position.y, phase: i * 2 + n })
    }
  })

  const rack = box(0.88, 1.0, 0.22, k.body)
  rack.position.set(-0.32, FLOOR + 0.5, -WALL + 0.14)
  room.add(rack)
  for (let i = 0; i < 3; i += 1) {
    const shelf = box(0.8, 0.035, 0.2, k.wood)
    shelf.position.set(-0.32, FLOOR + 0.3 + i * 0.3, -WALL + 0.16)
    room.add(shelf)
    for (const [dx, hex] of [[-0.22, 0x4cc9f0], [0, 0xffd166], [0.22, 0x67d7a6]] as const) {
      const jar = cyl(0.055, 0.055, 0.16, flat(hex, 0.9), 8)
      jar.position.set(-0.32 + dx, FLOOR + 0.4 + i * 0.3, -WALL + 0.16)
      room.add(jar)
    }
  }

  const sign = box(0.52, 0.2, 0.03, screen(0xffd166, 2))
  sign.position.set(0.42, FLOOR + 1.02, -WALL + 0.2)
  room.add(sign)

  const pot = cyl(0.1, 0.08, 0.14, k.wood, 10)
  pot.position.set(-0.8, FLOOR + 0.07, 0.5)
  room.add(pot)
  const bush = new THREE.Mesh(keep(new THREE.IcosahedronGeometry(0.15, 0)), k.leaf)
  bush.position.set(-0.8, FLOOR + 0.24, 0.5)
  room.add(bush)

  person(-0.16, -0.52, 0x8ce6ff, 0)
  const customer = person(0.28, 0.4, 0xc4b5fd, Math.PI)

  return {
    group: room,
    alive: (elapsed, hover) => {
      bulbs.forEach((bulb, i) => {
        const wave = 0.5 + 0.5 * Math.sin(elapsed * 3 - i * 0.7)
        ;(bulb.material as THREE.MeshStandardMaterial).emissiveIntensity =
          2.6 * hover * (0.35 + wave * 0.65)
      })
      k.power(hover)
      for (const { mesh, base, phase } of goods) {
        mesh.position.y = base + Math.abs(Math.sin(elapsed * 3 + phase)) * 0.03 * hover
      }
      // The customer steps up to the counter when the stall opens.
      customer.position.z = 0.4 - hover * 0.16
      bush.rotation.y = elapsed * 0.3
      k.breathe(elapsed, hover)
    },
  }
}

function workshop(color: number, locked: boolean, keep: Keep): Furnishing {
  const k = kit(color, locked, keep)
  const { room, box, cyl, screen, person } = k

  const toolWall = box(1.4, 0.8, 0.05, k.dark)
  toolWall.position.set(-0.02, FLOOR + 0.82, -WALL + 0.04)
  room.add(toolWall)
  for (let i = 0; i < 6; i += 1) {
    const tool = box(0.06, 0.26 - (i % 3) * 0.05, 0.04, k.metal)
    tool.position.set(-0.56 + i * 0.22, FLOOR + 0.86, -WALL + 0.09)
    room.add(tool)
  }
  const gauge = box(0.24, 0.14, 0.03, screen(0xff8fab, 2.2))
  gauge.position.set(0.5, FLOOR + 1.06, -WALL + 0.09)
  room.add(gauge)

  const bench = box(1.2, 0.09, 0.46, k.wood)
  bench.position.set(-0.1, FLOOR + 0.5, -0.24)
  room.add(bench)
  for (const x of [-0.6, 0.38]) {
    const leg = box(0.09, 0.46, 0.09, k.metal)
    leg.position.set(x, FLOOR + 0.24, -0.24)
    room.add(leg)
  }

  // The robotic arm that works the bench.
  const armBase = cyl(0.13, 0.16, 0.1, k.metal, 14)
  armBase.position.set(0.24, FLOOR + 0.6, -0.28)
  room.add(armBase)
  const arm = new THREE.Group()
  const upper = box(0.09, 0.34, 0.09, k.body)
  upper.position.y = 0.17
  arm.add(upper)
  const fore = box(0.07, 0.26, 0.07, k.body)
  fore.position.set(0, 0.34, 0.1)
  fore.rotation.x = 0.7
  arm.add(fore)
  const tip = k.ball(0.05, screen(0xffd166, 3))
  tip.position.set(0, 0.44, 0.2)
  arm.add(tip)
  arm.position.set(0.24, FLOOR + 0.64, -0.28)
  room.add(arm)

  // Sparks from the tip. Invisible at rest — the arm only cuts when the room is
  // running, which is this workshop's version of switching on.
  const sparkCount = 22
  const sparkPos = new Float32Array(sparkCount * 3)
  for (let i = 0; i < sparkCount; i += 1) {
    sparkPos[i * 3] = (Math.random() - 0.5) * 0.24
    sparkPos[i * 3 + 1] = Math.random() * 0.2
    sparkPos[i * 3 + 2] = (Math.random() - 0.5) * 0.24
  }
  const sparkGeo = keep(new THREE.BufferGeometry())
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3))
  const sparkMat = keep(new THREE.PointsMaterial({
    color: 0xffd166, size: 0.05, transparent: true, opacity: 0, toneMapped: false,
  }))
  const sparks = new THREE.Points(sparkGeo, sparkMat)
  sparks.position.set(0.24, FLOOR + 1.0, -0.1)
  room.add(sparks)

  for (const [x, z, s] of [[0.58, 0.34, 0.3], [0.34, 0.62, 0.22]] as const) {
    const crate = box(s, s, s, k.wood)
    crate.position.set(x, FLOOR + s / 2, z)
    crate.rotation.y = 0.3
    room.add(crate)
  }
  const barrel = cyl(0.16, 0.16, 0.36, k.metal, 14)
  barrel.position.set(-0.74, FLOOR + 0.18, 0.44)
  room.add(barrel)
  person(-0.3, 0.26, 0x67d7a6, Math.PI * 0.9)

  const sparkAttr = sparkGeo.getAttribute('position') as THREE.BufferAttribute
  return {
    group: room,
    alive: (elapsed, hover) => {
      k.power(hover, 1 + Math.sin(elapsed * 14) * 0.18 * hover)
      arm.rotation.y = Math.sin(elapsed * 1.6) * 0.7 * hover
      arm.rotation.z = Math.sin(elapsed * 2.2) * 0.12 * hover
      sparkMat.opacity = hover * 0.85
      for (let i = 0; i < sparkCount; i += 1) {
        let y = sparkAttr.getY(i) - 0.012 * (0.4 + hover)
        if (y < -0.12) y = 0.2
        sparkAttr.setY(i, y)
      }
      sparkAttr.needsUpdate = true
      barrel.rotation.y = elapsed * 0.2
      k.breathe(elapsed, hover)
    },
  }
}

function exam(color: number, locked: boolean, keep: Keep): Furnishing {
  const k = kit(color, locked, keep)
  const { room, box, cyl, flat, screen, person } = k

  const papers: THREE.Mesh[] = []
  for (const [x, z] of [[-0.44, 0.06], [0.18, 0.06], [-0.44, 0.5], [0.18, 0.5]] as const) {
    const desk = box(0.42, 0.05, 0.28, k.white)
    desk.position.set(x, FLOOR + 0.4, z)
    room.add(desk)
    for (const dx of [-0.17, 0.17]) {
      const leg = box(0.035, 0.38, 0.035, k.metal)
      leg.position.set(x + dx, FLOOR + 0.2, z)
      room.add(leg)
    }
    const paper = box(0.2, 0.008, 0.14, flat(0xffffff))
    paper.position.set(x, FLOOR + 0.44, z)
    room.add(paper)
    papers.push(paper)
  }
  person(-0.44, 0.32, 0xc4b5fd, 0.05)
  person(0.18, 0.76, 0xff8fab, -0.05)

  const podium = cyl(0.2, 0.26, 0.46, k.wood, 14)
  podium.position.set(0.66, FLOOR + 0.23, -0.4)
  room.add(podium)
  person(0.66, -0.12, 0x67d7a6, Math.PI)

  const arch = new THREE.Mesh(
    keep(new THREE.TorusGeometry(0.6, 0.045, 8, 26, Math.PI)), screen(0xffd166, 1.8),
  )
  arch.position.set(-0.12, FLOOR + 0.5, -WALL + 0.16)
  room.add(arch)

  const banner = box(0.62, 0.58, 0.02, flat(0xffd166, 0.85))
  banner.position.set(-0.12, FLOOR + 1.16, -WALL + 0.06)
  room.add(banner)
  const crest = new THREE.Mesh(keep(new THREE.OctahedronGeometry(0.13, 0)), k.accent)
  crest.position.set(-0.12, FLOOR + 1.16, -WALL + 0.11)
  room.add(crest)

  const plinth = cyl(0.18, 0.24, 0.3, k.metal, 16)
  plinth.position.set(-0.74, FLOOR + 0.15, 0.5)
  room.add(plinth)
  const trophy = new THREE.Mesh(keep(new THREE.OctahedronGeometry(0.15, 0)), screen(0xffd166, 3))
  trophy.position.set(-0.74, FLOOR + 0.46, 0.5)
  room.add(trophy)

  // The clock: an exam has a time limit, and the hand racing is this hall's own
  // way of coming alive.
  const face = cyl(0.13, 0.13, 0.03, k.white, 16)
  face.rotation.z = Math.PI / 2
  face.position.set(-WALL + 0.04, FLOOR + 1.0, -0.1)
  room.add(face)
  const handGeo = new THREE.BoxGeometry(0.012, 0.1, 0.012)
  handGeo.translate(0, 0.05, 0)
  const hand = new THREE.Mesh(keep(handGeo), flat(0xff8fab, 1))
  hand.position.set(-WALL + 0.07, FLOOR + 1.0, -0.1)
  room.add(hand)

  return {
    group: room,
    alive: (elapsed, hover) => {
      k.power(hover)
      hand.rotation.x = elapsed * (0.4 + hover * 7)
      crest.rotation.y = elapsed * (0.3 + hover * 2.2)
      trophy.rotation.y = elapsed * (0.3 + hover * 2)
      trophy.position.y = FLOOR + 0.46 + hover * 0.14 + Math.sin(elapsed * 1.6) * 0.02
      papers.forEach((paper, i) => {
        paper.rotation.y = Math.sin(elapsed * 2 + i) * 0.14 * hover
        paper.position.y = FLOOR + 0.44 + Math.abs(Math.sin(elapsed * 3 + i)) * 0.012 * hover
      })
      k.breathe(elapsed, hover)
    },
  }
}

function studio(color: number, locked: boolean, keep: Keep): Furnishing {
  const k = kit(color, locked, keep)
  const { room, box, cyl, flat, screen, person } = k

  const backWall = box(1.4, 0.9, 0.04, k.white)
  backWall.position.set(0.02, FLOOR + 0.86, -WALL + 0.04)
  room.add(backWall)
  const pinned: THREE.Mesh[] = []
  const sheetHues = [0xff8fab, 0x8ce6ff, 0xffd166, 0x67d7a6, 0xc4b5fd, 0xf7f9ff]
  for (let i = 0; i < 6; i += 1) {
    const sheet = box(0.24, 0.2, 0.01, flat(sheetHues[i]))
    sheet.position.set(-0.5 + (i % 3) * 0.34, FLOOR + 1.06 - Math.floor(i / 3) * 0.26, -WALL + 0.08)
    sheet.rotation.z = (i % 2 ? 1 : -1) * 0.05
    room.add(sheet)
    pinned.push(sheet)
  }

  const easel = new THREE.Group()
  for (const [dx, dz] of [[-0.16, 0.1], [0.16, 0.1], [0, -0.16]] as const) {
    const leg = cyl(0.02, 0.02, 0.6, k.wood, 6)
    leg.position.set(dx, 0.3, dz)
    leg.rotation.x = dz * 0.6
    leg.rotation.z = -dx * 0.6
    easel.add(leg)
  }
  easel.position.set(-0.5, FLOOR, 0.12)
  room.add(easel)
  const canvasBoard = box(0.42, 0.34, 0.03, screen(0x8ce6ff, 1.6))
  canvasBoard.position.set(-0.5, FLOOR + 0.66, 0.1)
  canvasBoard.rotation.x = -0.16
  room.add(canvasBoard)

  const table = box(0.7, 0.06, 0.4, k.wood)
  table.position.set(0.4, FLOOR + 0.42, 0.1)
  room.add(table)
  for (const dx of [-0.28, 0.28]) {
    const leg = box(0.05, 0.4, 0.05, k.metal)
    leg.position.set(0.4 + dx, FLOOR + 0.21, 0.1)
    room.add(leg)
  }
  const pots: THREE.Mesh[] = []
  ;[0xff8fab, 0xffd166, 0x67d7a6, 0x4cc9f0].forEach((hex, i) => {
    const pot = cyl(0.06, 0.06, 0.12, flat(hex), 10)
    pot.position.set(0.16 + i * 0.16, FLOOR + 0.51, 0.06)
    room.add(pot)
    pots.push(pot)
  })

  person(-0.5, 0.56, 0xffd166, Math.PI)

  return {
    group: room,
    alive: (elapsed, hover) => {
      k.power(hover)
      // The work on the wall lifts like paper in a draught, and the paint pots
      // turn as if being chosen from.
      pinned.forEach((sheet, i) => {
        sheet.rotation.x = Math.sin(elapsed * 1.8 + i) * 0.12 * hover
      })
      pots.forEach((pot, i) => {
        pot.rotation.y = elapsed * (0.2 + hover * 2) * (i % 2 ? 1 : -1)
        pot.position.y = FLOOR + 0.51 + Math.abs(Math.sin(elapsed * 2.4 + i)) * 0.02 * hover
      })
      canvasBoard.rotation.z = Math.sin(elapsed * 1.2) * 0.02 * hover
      k.breathe(elapsed, hover)
    },
  }
}

const BUILDERS: Record<RoomDesign, (c: number, l: boolean, k: Keep) => Furnishing> = {
  classroom, lab, market, workshop, exam, studio,
}

export function buildPlatform(opts: PlatformOptions, keep: Keep): Platform {
  const group = new THREE.Group()
  const { color, locked, current, assessment } = opts
  const dim = locked ? 0.28 : 1

  // ── the slab ──
  // Isometric reads through the CONTRAST between the top face and the two side
  // faces. A single mid-tone standard material lit from one side gave all three
  // faces nearly the same value, which flattened every platform into a navy
  // diamond — so the body is deliberately light and the lighting rig shapes it.
  const slabGeo = keep(new RoundedBoxGeometry(SIZE, SLAB, SIZE, 3, 0.07))
  const slabMat = keep(new THREE.MeshStandardMaterial({
    color: locked ? 0x3b4370 : 0x5b64a8,
    roughness: 0.72,
    metalness: 0.12,
  }))
  group.add(new THREE.Mesh(slabGeo, slabMat))

  // Inset deck: the lit surface the learner reads as "the floor of this room".
  // Deliberately a NEUTRAL floor with only a wash of the state colour — driving
  // the full state colour through the deck emissive lit every wall and every
  // piece of furniture the same hue, and the rooms collapsed into one green
  // silhouette. The state now reads from the edges, posts and halo instead.
  const deckGeo = keep(new RoundedBoxGeometry(SIZE - 0.24, 0.08, SIZE - 0.24, 2, 0.035))
  const deckMat = keep(new THREE.MeshStandardMaterial({
    color: locked ? 0x2b3160 : 0x8e97d6,
    emissive: color,
    emissiveIntensity: locked ? 0.04 : 0.18,
    roughness: 0.5,
    metalness: 0.1,
    transparent: true,
    opacity: locked ? 0.6 : 1,
  }))
  const deck = new THREE.Mesh(deckGeo, deckMat)
  deck.position.y = SLAB / 2
  group.add(deck)

  // ── glass corner: two panes, so the platform reads as a room, not a tile ──
  const paneMat = keep(new THREE.MeshStandardMaterial({
    color: 0xa9c4ff,
    emissive: color,
    emissiveIntensity: locked ? 0.04 : 0.3,
    roughness: 0.1,
    metalness: 0.05,
    transparent: true,
    opacity: locked ? 0.1 : 0.3,
    side: THREE.DoubleSide,
  }))
  const wallH = assessment ? 1.35 : 1
  const paneGeo = keep(new THREE.PlaneGeometry(SIZE - 0.2, wallH))
  const backPane = new THREE.Mesh(paneGeo, paneMat)
  backPane.position.set(0, SLAB / 2 + wallH / 2, -(SIZE / 2 - 0.08))
  group.add(backPane)
  const sidePane = new THREE.Mesh(paneGeo, paneMat)
  sidePane.rotation.y = Math.PI / 2
  sidePane.position.set(-(SIZE / 2 - 0.08), SLAB / 2 + wallH / 2, 0)
  group.add(sidePane)

  // Bright top edge on each pane — the strongest read of the state colour.
  const edgeMat = keep(new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: locked ? 0.22 : 0.95,
  }))
  const edgeGeo = keep(new THREE.BoxGeometry(SIZE - 0.2, 0.045, 0.045))
  const backEdge = new THREE.Mesh(edgeGeo, edgeMat)
  backEdge.position.set(0, SLAB / 2 + wallH, -(SIZE / 2 - 0.1))
  group.add(backEdge)
  const sideEdge = new THREE.Mesh(edgeGeo, edgeMat)
  sideEdge.rotation.y = Math.PI / 2
  sideEdge.position.set(-(SIZE / 2 - 0.1), SLAB / 2 + wallH, 0)
  group.add(sideEdge)

  // ── coloured edge strips along the slab rim ──
  // The state colour alone made every platform the same object in a different
  // hue. A short run of mixed strips down each visible edge gives the slab a
  // manufactured, lit-from-within look.
  const stripHues = [0xff8fab, 0x67d7a6, 0xffd166, 0x4cc9f0]
  const stripGeo = keep(new THREE.BoxGeometry(0.34, 0.05, 0.05))
  for (const [axis, sign] of [['x', 1], ['z', 1]] as const) {
    for (let i = 0; i < 4; i += 1) {
      const stripMat = keep(new THREE.MeshBasicMaterial({
        color: stripHues[(i + (axis === 'x' ? 0 : 2)) % stripHues.length],
        transparent: true,
        opacity: locked ? 0.12 : 0.85,
      }))
      const strip = new THREE.Mesh(stripGeo, stripMat)
      const along = -SIZE / 2 + 0.32 + i * 0.42
      if (axis === 'x') strip.position.set(along, -SLAB / 2 + 0.09, (SIZE / 2) * sign)
      else {
        strip.position.set((SIZE / 2) * sign, -SLAB / 2 + 0.09, along)
        strip.rotation.y = Math.PI / 2
      }
      group.add(strip)
    }
  }

  // ── corner lights ──
  const postGeo = keep(new THREE.CylinderGeometry(0.045, 0.045, 0.26, 10))
  const postMat = keep(new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: locked ? 0.25 : 1,
  }))
  const half = SIZE / 2 - 0.1
  for (const [x, z] of [[half, half], [-half, half], [half, -half], [-half, -half]]) {
    const post = new THREE.Mesh(postGeo, postMat)
    post.position.set(x, SLAB / 2 + 0.08, z)
    group.add(post)
  }

  // ── ground bloom under the slab: lifts the platform off the starfield ──
  const bloomGeo = keep(new THREE.CircleGeometry(SIZE * 0.85, 28))
  const bloomMat = keep(new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: locked ? 0.05 : 0.24, side: THREE.DoubleSide,
  }))
  const bloom = new THREE.Mesh(bloomGeo, bloomMat)
  bloom.rotation.x = -Math.PI / 2
  bloom.position.y = -SLAB / 2 - 0.02
  group.add(bloom)

  // ── "you are here" ring, only on the current station ──
  let halo: THREE.Mesh | null = null
  if (current) {
    const haloGeo = keep(new THREE.TorusGeometry(SIZE * 0.62, 0.022, 8, 44))
    const haloMat = keep(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }))
    halo = new THREE.Mesh(haloGeo, haloMat)
    halo.rotation.x = -Math.PI / 2
    halo.position.y = SLAB / 2 + 0.05
    group.add(halo)
  }

  // ── the room itself ──
  const furnishing = BUILDERS[opts.design](color, locked, keep)
  group.add(furnishing.group)

  // Every room carries its OWN lamp. A single scene lamp parked over the focused
  // station left the other four as dark boxes — all that detail was in there and
  // none of it was visible.
  const roomLamp = new THREE.PointLight(0xfff2d8, locked ? 1.6 : 9, 3.4, 2)
  roomLamp.position.set(0.1, SLAB / 2 + 0.95, 0.1)
  group.add(roomLamp)

  // Invisible pick target covering the whole diorama — raycasting the real
  // meshes made the glass panes swallow hits meant for the deck.
  const hitGeo = keep(new THREE.BoxGeometry(SIZE, wallH + SLAB, SIZE))
  const hitMat = keep(new THREE.MeshBasicMaterial({ visible: false }))
  const hitbox = new THREE.Mesh(hitGeo, hitMat)
  hitbox.position.y = wallH / 2
  group.add(hitbox)

  // The caller positions the group AFTER `buildPlatform` returns, so the resting
  // height cannot be read here — it is captured on the first update instead.
  // Reading it at build time meant `baseY` was 0 for every station, and the lift
  // below then eased each platform towards the origin: with a real frame delta
  // the whole route collapsed onto station 1 and the later platforms vanished.
  let baseY: number | null = null
  // Hover is SMOOTHED rather than boolean: the room waking up and settling back
  // is the whole effect, and a hard 0/1 made props jump between frames.
  let hoverAmount = 0
  const update = (elapsed: number, hovered: boolean, delta: number) => {
    if (baseY === null) baseY = group.position.y
    const target = hovered && !locked ? 1 : 0
    hoverAmount += (target - hoverAmount) * Math.min(1, delta * 7)
    // Hover lifts the whole stage a little rather than scaling it — scaling an
    // isometric box breaks the shared vanishing lines and looks like a glitch.
    group.position.y += (baseY + hoverAmount * 0.16 - group.position.y) * Math.min(1, delta * 9)
    if (halo) {
      halo.rotation.z = elapsed * 0.8
      halo.scale.setScalar(1 + Math.sin(elapsed * 2.3) * 0.05)
    }
    const pulse = locked ? 0.25 : 0.72 + Math.sin(elapsed * 1.6) * 0.22
    postMat.opacity = pulse * dim + 0.2
    deckMat.emissiveIntensity = locked
      ? 0.03
      : 0.14 + Math.sin(elapsed * 1.2) * 0.05 + hoverAmount * 0.22
    // The room's own equipment powers up under the pointer.
    furnishing.alive(elapsed, hoverAmount)
  }

  return { group, standY: SLAB / 2 + 0.03, hitbox, update }
}
