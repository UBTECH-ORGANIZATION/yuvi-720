import * as THREE from 'three'
import type { LoftFabrication } from './LoftFabrication'
import { buildLoftPrize } from './LoftPrizes.ts'
import type { RoomKit } from './RoomCatalog'

export const LOFT_CABINET_BOUNDS: Record<string, { radius: number; height: number }> = {
  loftArcadeCabinet: { radius: 0.72, height: 2.05 },
  loftClawMachine: { radius: 0.9, height: 2.2 },
  loftTokenPusher: { radius: 0.92, height: 1.72 },
  loftPinball: { radius: 1.05, height: 1.72 },
  loftBasketballArcade: { radius: 1.65, height: 2.45 },
  loftPrizeCounter: { radius: 2.1, height: 1.65 },
  loftRacingSimulator: { radius: 1.8, height: 2.2 },
  loftAirHockey: { radius: 1.9, height: 1.1 },
  loftVrStation: { radius: 2, height: 2.5 },
}

export function buildLoftCabinet(factory: LoftFabrication, kind: string, tint: THREE.Color, model: RoomKit['model']) {
  const root = new THREE.Group()
  root.name = kind
  const paint = factory.material('paint', tint)
  const black = factory.material('rubber', 0x202528)
  const steel = factory.material('steel', 0x9da7ad)
  const white = factory.material('paint', 0xdedfd8)
  const glass = factory.material('glass', 0xd9eef0)
  const mount = (object: THREE.Object3D, x: number, y: number, z: number, parent = root) => {
    object.position.set(x, y, z); parent.add(object); return object
  }
  const sign = (width: number, height: number, x: number, y: number, z: number, style: Parameters<typeof factory.sign>[2] = 'marquee', key = '') =>
    mount(factory.sign(width, height, style, key, `#${tint.getHexString()}`), x, y, z)
  const feet = (width: number, depth: number, height = 0.11) => {
    for (const x of [-width / 2, width / 2]) for (const z of [-depth / 2, depth / 2]) {
      root.add(factory.cylinder(0.045, height, steel, x, height / 2, z))
      root.add(factory.cylinder(0.055, 0.025, black, x, 0.0125, z))
    }
  }
  const screws = (width: number, height: number, x: number, y: number, z: number) => {
    for (const side of [-1, 1]) for (const row of [-1, 1]) {
      const screw = factory.cylinder(0.011, 0.005, steel, x + side * width / 2, y + row * height / 2, z)
      screw.rotation.x = Math.PI / 2; root.add(screw)
      root.add(factory.box(0.011, 0.002, 0.006, black, screw.position.x, screw.position.y, z + 0.003))
    }
  }
  const service = (z: number, y = 0.42, x = 0) => {
    root.add(factory.box(0.31, 0.34, 0.022, black, x, y, z))
    root.add(factory.box(0.15, 0.1, 0.015, steel, x, y + 0.067, z + 0.018))
    root.add(factory.box(0.095, 0.012, 0.019, black, x, y + 0.07, z + 0.023))
    const lock = factory.cylinder(0.017, 0.01, steel, x + 0.08, y - 0.075, z + 0.018); lock.rotation.x = Math.PI / 2; root.add(lock)
    screws(0.26, 0.29, x, y, z + 0.017)
  }
  const controls = (x: number, y: number, z: number, parent = root) => {
    parent.add(factory.cylinder(0.067, 0.02, steel, x - 0.16, y, z))
    parent.add(factory.cylinder(0.016, 0.13, black, x - 0.16, y + 0.06, z))
    parent.add(factory.sphere(0.042, factory.material('paint', 0xac423c), x - 0.16, y + 0.13, z))
    for (let index = 0; index < 3; index += 1) {
      parent.add(factory.cylinder(0.036, 0.018, black, x + index * 0.093, y, z))
      parent.add(factory.cylinder(0.028, 0.023, factory.material('paint', [0x419e91, 0xd5b855, 0xb75448][index]), x + index * 0.093, y + 0.012, z))
    }
  }
  const vents = (width: number, y: number, z: number) => {
    for (let index = 0; index < (factory.rich ? 10 : 5); index += 1) root.add(factory.box(width, 0.007, 0.008, black, 0, y + index * 0.018, z))
  }

  if (kind === 'loftArcadeCabinet') {
    feet(0.83, 0.66)
    const outline = [[-0.4, 0.12], [0.4, 0.12], [0.43, 0.89], [0.53, 1.01], [0.49, 1.12], [0.2, 1.2], [0.02, 1.65], [0.34, 1.78], [0.34, 1.97], [-0.39, 1.97]]
    for (const side of [-1, 1]) {
      const panel = factory.profile(outline, 0.055, paint); panel.rotation.y = -Math.PI / 2; panel.position.x = side * 0.47; root.add(panel)
      const art = factory.sign(0.57, 1.35, 'panel', ''); art.rotation.y = side * Math.PI / 2; art.position.set(side * 0.507, 0.99, -0.06); root.add(art)
    }
    root.add(factory.box(0.87, 0.71, 0.75, black, 0, 0.49, -0.015))
    root.add(factory.box(0.86, 0.2, 0.73, black, 0, 1.86, -0.02))
    sign(0.81, 0.16, 0, 1.86, 0.354)
    const display = new THREE.Group(); display.position.set(0, 1.44, 0.125); display.rotation.x = -0.29; root.add(display)
    display.add(factory.box(0.84, 0.61, 0.07, black))
    mount(factory.sign(0.73, 0.5, 'arcade', ''), 0, 0, 0.04, display)
    const deck = new THREE.Group(); deck.position.set(0, 1.02, 0.31); deck.rotation.x = -0.12; root.add(deck)
    deck.add(factory.box(0.87, 0.06, 0.42, steel)); controls(0, 0.04, 0.03, deck)
    service(0.368); vents(0.36, 0.14, 0.367)
  } else if (kind === 'loftClawMachine') {
    feet(1.18, 0.89)
    root.add(factory.box(1.38, 0.52, 1.08, paint, 0, 0.36, 0))
    root.add(factory.box(1.46, 0.24, 1.12, paint, 0, 2.04, 0))
    sign(1.23, 0.17, 0, 2.04, 0.569)
    root.add(factory.box(1.26, 0.055, 0.96, white, 0, 0.65, 0))
    for (const x of [-0.65, 0.65]) for (const z of [-0.49, 0.49]) root.add(factory.box(0.055, 1.3, 0.055, steel, x, 1.29, z))
    for (const z of [-0.505, 0.505]) root.add(factory.box(1.25, 1.2, 0.009, glass, 0, 1.29, z))
    for (const x of [-0.667, 0.667]) root.add(factory.box(0.009, 1.2, 0.96, glass, x, 1.29, 0))
    for (const x of [-0.47, 0.47]) root.add(factory.box(0.025, 0.04, 0.88, steel, x, 1.89, 0))
    const carriage = new THREE.Group(); carriage.position.y = 1.85; root.add(carriage)
    carriage.add(factory.box(1, 0.038, 0.06, steel))
    carriage.add(factory.box(0.18, 0.075, 0.13, black, 0, -0.035, 0))
    carriage.add(factory.tube([[0, -0.06, 0], [0.015, -0.22, 0], [0, -0.38, 0]], 0.009, black))
    carriage.add(factory.cylinder(0.065, 0.12, steel, 0, -0.43, 0))
    for (let index = 0; index < 3; index += 1) {
      const finger = factory.tube([[0.04, -0.46, 0], [0.17, -0.57, 0], [0.14, -0.73, 0], [0.04, -0.76, 0]], 0.012, steel)
      finger.rotation.y = index * Math.PI * 2 / 3; carriage.add(finger)
    }
    for (let index = 0; index < 6; index += 1) {
      const prize = index % 2 ? buildLoftPrize(factory, 'plush') : model('rubber_duck_toy', [0.29, 0.29, 0.29])
      if (index % 2) prize.scale.setScalar(0.56)
      mount(prize, -0.39 + index % 3 * 0.39, 0.683, -0.23 + Math.floor(index / 3) * 0.43)
      prize.rotation.y = index * 0.7
    }
    root.add(factory.box(1.25, 0.065, 0.21, steel, 0, 0.72, 0.57)); controls(-0.24, 0.76, 0.56)
    root.add(factory.box(0.45, 0.22, 0.018, black, -0.31, 0.29, 0.551))
    root.add(factory.box(0.4, 0.18, 0.012, glass, -0.31, 0.3, 0.566))
    service(0.549, 0.35, 0.36)
    root.userData.update = (elapsed: number) => { carriage.position.z = Math.sin(elapsed * 0.42) * 0.24 }
  } else if (kind === 'loftPinball') {
    feet(1.16, 1.5, 0.85)
    const table = new THREE.Group(); table.position.y = 1; table.rotation.x = -0.12; root.add(table)
    table.add(factory.box(1.35, 0.25, 1.8, paint))
    const playfield = factory.sign(1.19, 1.65, 'pinball', ''); playfield.rotation.x = -Math.PI / 2; mount(playfield, 0, 0.133, 0, table)
    for (const x of [-0.65, 0.65]) table.add(factory.box(0.05, 0.11, 1.83, steel, x, 0.17, 0))
    for (const [x, z] of [[-0.28, -0.37], [0.26, -0.28], [0, 0.05]]) {
      table.add(factory.cylinder(0.105, 0.07, steel, x, 0.18, z))
      table.add(factory.cylinder(0.084, 0.04, white, x, 0.228, z))
    }
    for (const side of [-1, 1]) {
      const flipper = factory.box(0.27, 0.04, 0.065, white, side * 0.18, 0.18, 0.55); flipper.rotation.y = side * 0.36; table.add(flipper)
      table.add(factory.tube([[side * 0.48, 0.19, 0.58], [side * 0.5, 0.2, -0.46], [side * 0.2, 0.23, -0.7]], 0.014, steel))
      table.add(factory.cylinder(0.042, 0.055, paint, side * 0.31, 0.182, 0.27))
    }
    table.add(factory.sphere(0.029, steel, 0.27, 0.18, 0.32))
    table.add(factory.box(1.22, 0.006, 1.7, glass, 0, 0.29, 0))
    root.add(factory.box(1.35, 0.5, 0.16, paint, 0, 1.45, -0.84))
    sign(1.16, 0.31, 0, 1.47, -0.749, 'panel')
    service(0.91, 0.95)
    const plunger = factory.cylinder(0.026, 0.14, steel, 0.52, 0.94, 0.94); plunger.rotation.x = Math.PI / 2; root.add(plunger)
  } else if (kind === 'loftBasketballArcade') {
    feet(1.8, 2.4)
    const ramp = factory.box(1.94, 0.09, 2.6, steel, 0, 0.62, 0.1); ramp.rotation.x = -0.15; root.add(ramp)
    root.add(factory.box(2.04, 0.32, 0.18, paint, 0, 0.49, 1.41))
    sign(1.72, 0.2, 0, 0.49, 1.508)
    for (const side of [-1, 1]) {
      root.add(factory.tube([[side, 0.13, 1.35], [side, 1.38, 1.35], [side, 2.35, -1.15], [side, 0.13, -1.15]], 0.03, steel))
      for (let index = 0; index < (factory.rich ? 16 : 8); index += 1) {
        const z = -1.1 + index * (factory.rich ? 0.15 : 0.3)
        root.add(factory.tube([[side, 0.8, z], [side, 1.83 - z * 0.36, z]], 0.005, black))
      }
      for (let index = 0; index < 6; index += 1) root.add(factory.tube([[side, 0.84 + index * 0.11, 1.3], [side, 1.1 + index * 0.23, -1.1]], 0.005, black))
    }
    root.add(factory.box(1.99, 1.19, 0.055, white, 0, 1.83, -1.17))
    sign(1.63, 0.25, 0, 2.2, -1.133)
    const target = factory.sign(0.6, 0.48, 'court', ''); mount(target, 0, 1.76, -1.13)
    const rim = factory.mesh(new THREE.TorusGeometry(0.29, 0.022, 8, 32), factory.material('paint', 0xb85434), 0, 1.64, -0.79); rim.rotation.x = Math.PI / 2; root.add(rim)
    for (let index = 0; index < 12; index += 1) {
      const angle = index * Math.PI / 6
      root.add(factory.tube([[Math.cos(angle) * 0.28, 1.63, -0.79 + Math.sin(angle) * 0.28], [Math.cos(angle + 0.3) * 0.15, 1.23, -0.79 + Math.sin(angle + 0.3) * 0.15]], 0.005, white))
    }
    for (const [x, z] of [[-0.42, 0.8], [0.34, 0.74], [0, 0.25]]) {
      const ball = factory.sphere(0.19, factory.material('rubber', 0xb76531), x, 0.79, z); root.add(ball)
      for (const angle of [0, Math.PI / 2]) { const seam = factory.mesh(new THREE.TorusGeometry(0.191, 0.003, 5, 32), black, x, 0.79, z); seam.rotation.y = angle; root.add(seam) }
    }
  } else if (kind === 'loftTokenPusher') {
    feet(1.18, 0.88)
    root.add(factory.box(1.43, 0.62, 1.03, paint, 0, 0.4, 0))
    root.add(factory.box(1.47, 0.19, 1.08, paint, 0, 1.61, 0))
    sign(1.24, 0.14, 0, 1.61, 0.549)
    for (const x of [-0.67, 0.67]) { root.add(factory.box(0.043, 0.8, 1.04, steel, x, 1.11, 0)); root.add(factory.box(0.009, 0.76, 0.95, glass, x * 0.95, 1.11, 0)) }
    root.add(factory.box(1.27, 0.79, 0.009, glass, 0, 1.1, 0.51))
    root.add(factory.box(1.25, 0.05, 0.93, steel, 0, 0.79, 0))
    const tray = new THREE.Group(); tray.position.set(0, 1.07, -0.2); root.add(tray)
    tray.add(factory.box(1.23, 0.035, 0.54, steel))
    const gold = factory.material('steel', 0xc7a454)
    for (let index = 0; index < 36; index += 1) {
      const parent = index < 18 ? tray : root
      parent.add(factory.cylinder(0.054, 0.013, gold, -0.5 + index % 9 * 0.125, index < 18 ? 0.025 : 0.824, index < 18 ? -0.14 + Math.floor(index / 9) * 0.18 : -0.24 + Math.floor((index - 18) / 9) * 0.3))
    }
    service(0.53, 0.39)
    const ticket = factory.sign(0.31, 0.09, 'ticket', ''); ticket.rotation.x = 0.4; mount(ticket, -0.42, 0.32, 0.55)
    root.userData.update = (elapsed: number) => { tray.position.z = -0.2 + Math.sin(elapsed * 0.9) * 0.11 }
  } else if (kind === 'loftRacingSimulator') {
    feet(1.3, 2.55)
    root.add(factory.box(1.54, 0.16, 3.12, black, 0, 0.18, 0))
    for (const side of [-1, 1]) {
      const panel = factory.profile([[-1.45, 0.25], [1.45, 0.25], [1.1, 0.5], [-0.3, 0.65], [-0.8, 1.5], [-1.3, 1.5]], 0.055, paint)
      panel.rotation.y = -Math.PI / 2; panel.position.x = side * 0.73; root.add(panel)
    }
    root.add(factory.box(1.4, 0.85, 0.18, black, 0, 1.62, -1.23))
    sign(1.26, 0.72, 0, 1.63, -1.13, 'race', '')
    sign(1.28, 0.19, 0, 2.07, -1.13)
    root.add(factory.box(0.72, 0.12, 0.68, factory.material('cloth', 0x353b3d), 0, 0.6, 0.8, 0.05))
    const back = factory.box(0.71, 0.83, 0.16, black, 0, 1.02, 1.13, 0.05); back.rotation.x = -0.16; root.add(back)
    for (const side of [-1, 1]) root.add(factory.tube([[side * 0.34, 0.6, 0.55], [side * 0.38, 1.2, 1.03], [side * 0.21, 1.5, 1.13]], 0.062, paint))
    root.add(factory.box(0.95, 0.18, 0.46, black, 0, 1.03, -0.57))
    const wheel = new THREE.Group(); wheel.position.set(0, 1.16, -0.29); wheel.rotation.x = -0.35; root.add(wheel)
    wheel.add(factory.mesh(new THREE.TorusGeometry(0.22, 0.026, 10, 40), black))
    for (let index = 0; index < 3; index += 1) { const spoke = factory.box(0.034, 0.2, 0.024, steel, 0, 0.08, 0); const pivot = new THREE.Group(); pivot.rotation.z = index * Math.PI * 2 / 3; pivot.add(spoke); wheel.add(pivot) }
    wheel.add(factory.sphere(0.057, paint))
    for (const x of [-0.18, 0.18]) { const pedal = factory.box(0.14, 0.035, 0.24, steel, x, 0.38, -0.45); pedal.rotation.x = 0.45; root.add(pedal) }
    root.add(factory.cylinder(0.015, 0.2, steel, 0.55, 0.84, 0.2)); root.add(factory.sphere(0.042, black, 0.55, 0.96, 0.2))
    root.userData.update = (elapsed: number) => { wheel.rotation.z = Math.sin(elapsed * 0.6) * 0.14 }
  } else if (kind === 'loftAirHockey') {
    feet(1.55, 2.6, 0.69)
    root.add(factory.box(1.94, 0.27, 3.22, paint, 0, 0.79, 0))
    const surface = factory.sign(1.68, 2.95, 'court', ''); surface.rotation.x = -Math.PI / 2; mount(surface, 0, 0.933, 0)
    for (const x of [-0.93, 0.93]) root.add(factory.box(0.095, 0.09, 3.23, steel, x, 0.95, 0))
    for (const z of [-1.55, 1.55]) {
      for (const x of [-0.65, 0.65]) root.add(factory.box(0.64, 0.095, 0.11, steel, x, 0.95, z))
      root.add(factory.box(0.52, 0.065, 0.12, black, 0, 0.955, z))
      const malletColor = factory.material('paint', z < 0 ? 0x397f9a : 0xb95247)
      root.add(factory.cylinder(0.1, 0.033, malletColor, 0.25, 0.96, z * 0.73))
      root.add(factory.cylinder(0.035, 0.083, malletColor, 0.25, 1.012, z * 0.73))
    }
    root.add(factory.cylinder(0.057, 0.018, black, -0.21, 0.955, 0.31))
    sign(1.35, 0.13, 0, 0.76, 1.619)
  } else if (kind === 'loftVrStation') {
    feet(2.2, 2.2)
    root.add(factory.box(2.65, 0.12, 2.65, black, 0, 0.15, 0, 0.045))
    const mat = factory.sign(2.3, 2.3, 'panel', ''); mat.rotation.x = -Math.PI / 2; mount(mat, 0, 0.216, 0)
    root.add(factory.box(0.46, 1.15, 0.48, paint, -0.97, 0.77, -0.8))
    mount(buildLoftPrize(factory, 'vrHeadset'), -0.97, 1.36, -0.8)
    root.add(factory.tube([[-1.17, 0.23, -1.13], [-1.17, 2.23, -1.13], [-0.9, 2.38, -1.13], [0.9, 2.38, -1.13], [1.17, 2.23, -1.13], [1.17, 0.23, -1.13]], 0.041, steel))
    root.add(factory.tube([[0, 2.38, -1.13], [0.18, 2.16, -0.75], [-0.6, 1.92, -0.6], [-0.96, 1.6, -0.8]], 0.008, black))
    sign(1.82, 0.28, 0, 2.15, -1.08)
    for (const side of [-1, 1]) {
      const controller = new THREE.Group(); controller.add(factory.cylinder(0.027, 0.17, white)); controller.add(factory.mesh(new THREE.TorusGeometry(0.06, 0.011, 8, 24), white, 0, 0.09, 0)); mount(controller, -0.96 + side * 0.18, 1.27, -0.5)
    }
  } else if (kind === 'loftPrizeCounter') {
    feet(3.45, 1.08)
    root.add(factory.box(3.83, 0.82, 1.28, factory.material('paint', 0x384849), 0, 0.53, 0))
    root.add(factory.box(4, 0.08, 1.4, steel, 0, 0.98, 0))
    sign(2.62, 0.21, 0, 0.55, 0.65)
    for (const x of [-1.87, 1.87]) root.add(factory.box(0.014, 0.52, 1.26, glass, x, 1.3, 0))
    root.add(factory.box(3.73, 0.014, 1.26, glass, 0, 1.57, 0))
    root.add(factory.box(3.73, 0.52, 0.014, glass, 0, 1.3, 0.64))
    const prizes = [buildLoftPrize(factory, 'phone'), buildLoftPrize(factory, 'watch'), buildLoftPrize(factory, 'headphones'), buildLoftPrize(factory, 'plush'), buildLoftPrize(factory, 'figure')]
    prizes.forEach((prize, index) => {
      prize.scale.setScalar(0.82); mount(prize, -1.43 + index * 0.71, 1.07, -0.08)
      root.add(factory.box(0.48, 0.045, 0.48, white, -1.43 + index * 0.71, 1.042, -0.08))
    })
    const controller = buildLoftPrize(factory, 'controller'); mount(controller, -0.8, 1.07, 0.32)
    const console = model('gaming_console', [0.48, 0.16, 0.42]); mount(console, 0.55, 1.07, 0.3)
    for (const x of [-1.87, 0, 1.87]) root.add(factory.box(0.028, 0.55, 0.028, steel, x, 1.3, 0.65))
  } else throw new Error(`Unknown loft cabinet: ${kind}`)
  const bounds = new THREE.Box3().setFromObject(root)
  const limit = LOFT_CABINET_BOUNDS[kind]
  const radius = Math.hypot(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)), Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)))
  root.scale.setScalar(Math.min(1, limit.radius / radius, limit.height / bounds.max.y))
  return root
}