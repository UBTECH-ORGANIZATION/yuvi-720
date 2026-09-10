import * as THREE from 'three'
import type { PlaygroundKit } from './PlaygroundKit.ts'
import { trafficPhase, type PlaygroundMotion } from './PlaygroundInteractions.ts'

export function buildPlaygroundWalls(root: THREE.Group, kit: PlaygroundKit, motion: PlaygroundMotion) {
  const steel = kit.material('steel', 0x8e9998)
  const dark = kit.material('rubber', 0x293230)
  const pale = kit.material('stone', 0xdadbd1)
  const colors = [0xc85a42, 0x338b80, 0xe2b93f, 0x426aa8, 0x729b45, 0x99639b]
  const climbing = kit.group(root, 'playground-climbing-wall')
  for (let panel = 0; panel < 11; panel++) {
    const x = -20 + panel * 4
    const wall = kit.group(climbing, `climbing-panel-${panel}`, [x, 0, -25.1])
    const slope = panel % 3 === 0 ? 0.065 : panel % 3 === 1 ? -0.025 : 0.025
    kit.box(wall, [3.96, 9.5, 0.25], kit.material('stone', panel % 2 ? 0xc7cdc3 : 0xd9dcd1), [0, 4.85, 0]).rotation.x = slope
    for (const side of [-1, 1]) kit.beam(wall, [side * 1.96, 0, -0.2], [side * 1.96, 9.7, -0.2], 0.07, steel)
    for (const height of [1.8, 3.8, 5.8, 7.8]) kit.box(wall, [3.95, 0.015, 0.035], dark, [0, height, (height - 4.85) * Math.sin(-slope) + 0.15])
    const holes = new THREE.InstancedMesh(kit.geometry('hold-bolt-hole', () => new THREE.CylinderGeometry(0.018, 0.018, 0.015, 6)), dark, 9 * 20)
    const transform = new THREE.Object3D()
    for (let hole = 0; hole < 180; hole++) {
      const height = 0.7 + Math.floor(hole / 9) * 0.44
      transform.position.set(-1.65 + hole % 9 * 0.41, height, (height - 4.85) * Math.sin(-slope) + 0.145)
      transform.rotation.x = Math.PI / 2
      transform.updateMatrix(); holes.setMatrixAt(hole, transform.matrix)
    }
    holes.instanceMatrix.needsUpdate = true; wall.add(holes)
    const cushion = kit.box(climbing, [3.97, 0.24, 5.5], kit.material('rubber', panel % 2 ? 0x546d65 : 0x6e857b), [x, 0.12, -22.7], 0.08)
    cushion.name = 'climbing-crash-mat'
    for (const side of [-1, 1]) kit.box(climbing, [0.3, 0.035, 0.12], dark, [x + side * 1.5, 0.22, -20.01])
    for (let route = 0; route < 2; route++) {
      const routeIndex = (panel + route) % colors.length
      const holdMat = kit.material('stone', colors[routeIndex])
      const variant = (panel + route) % 3
      const shape = kit.geometry(`climbing-hold-${variant}`, () => {
        const hold = new THREE.SphereGeometry(0.24, 16, 10)
        const positions = hold.attributes.position
        for (let vertex = 0; vertex < positions.count; vertex++) {
          const x = positions.getX(vertex), y = positions.getY(vertex), z = positions.getZ(vertex)
          const indentation = Math.exp(-((x * 6) ** 2 + ((y - 0.08) * 10) ** 2)) * (variant === 0 ? 0.14 : 0.06)
          positions.setXYZ(vertex, x * (variant === 1 ? 1.6 : 1), y * (variant === 2 ? 0.55 : 1), z * 0.8 - (z > 0 ? indentation : 0))
        }
        hold.computeVertexNormals()
        return hold
      })
      const holds = new THREE.InstancedMesh(shape, holdMat, 15)
      holds.castShadow = kit.rich; holds.receiveShadow = true
      const transform = new THREE.Object3D()
      for (let step = 0; step < 15; step++) {
        const height = 0.7 + step * 0.56
        const x = (route ? 0.75 : -0.75) + Math.sin(step * 1.9 + panel) * 0.55
        const z = (height - 4.85) * Math.sin(-slope) + 0.25
        transform.position.set(x, height, z)
        transform.rotation.set(0.1, 0.2 * Math.sin(step), step * 1.83)
        transform.scale.setScalar(0.7 + step % 3 * 0.24)
        transform.updateMatrix(); holds.setMatrixAt(step, transform.matrix)
        kit.bolt(wall, [x, height - 0.04, z + 0.16])
      }
      holds.instanceMatrix.needsUpdate = true; wall.add(holds)
    }
    if (panel % 2 === 0) {
      const volume = kit.mesh(wall, kit.geometry('climbing-volume', () => new THREE.ConeGeometry(0.72, 0.48, 3)), kit.material('stone', colors[panel % 6]), [0, 3 + panel % 3, 0.2])
      volume.rotation.x = Math.PI / 2; volume.rotation.z = panel
      kit.cylinder(wall, 0.18, 0.15, steel, [0, 9.3, 0.5]).rotation.x = Math.PI / 2
      kit.beam(wall, [0, 9.3, 0.6], [0.3, 0.45, 0.9], 0.021, kit.material('rope', 0xada16a))
      kit.box(wall, [0.24, 0.5, 0.18], dark, [0.3, 0.7, 0.9], 0.08)
    }
  }
  kit.batch(climbing)

  const traffic = kit.group(root, 'playground-traffic-wall', [24.05, 0, 20])
  traffic.rotation.y = -Math.PI / 2
  kit.box(traffic, [19.5, 6.3, 0.16], pale, [0, 3.65, 0], 0.03)
  for (let joint = 0; joint < 10; joint++) kit.box(traffic, [0.018, 6.3, 0.02], steel, [-9.5 + joint * 2, 3.65, 0.1])
  const sign = (kind: string, x: number, y: number) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512
    const context = canvas.getContext('2d')!
    const red = '#c93230', white = '#f8f6eb', blue = '#176bb0'
    context.clearRect(0, 0, 512, 512)
    context.fillStyle = kind === 'speed' || kind === 'school' ? white : kind === 'stop' ? red : blue
    context.fillRect(0, 0, 512, 512)
    context.strokeStyle = white; context.lineWidth = 15; context.strokeRect(18, 18, 476, 476)
    context.strokeStyle = white; context.fillStyle = white; context.lineWidth = 20; context.lineCap = 'round'
    const line = (points: number[][]) => { context.beginPath(); points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y)); context.stroke() }
    if (kind === 'bike') {
      for (const x of [140, 370]) { context.beginPath(); context.arc(x, 340, 70, 0, Math.PI * 2); context.stroke() }
      line([[140, 340], [220, 220], [280, 340], [140, 340], [300, 220], [370, 340]])
      line([[300, 220], [295, 175], [335, 175]]); line([[185, 200], [235, 200]])
    } else if (kind === 'speed') {
      context.strokeStyle = red; context.lineWidth = 42; context.beginPath(); context.arc(256, 256, 209, 0, Math.PI * 2); context.stroke()
      context.fillStyle = '#202828'; context.textAlign = 'center'; context.font = 'bold 235px sans-serif'; context.fillText('20', 256, 340)
    } else if (kind === 'stop') {
      context.fillStyle = white
      context.beginPath(); context.roundRect(180, 220, 165, 160, 35); context.fill()
      for (let finger = 0; finger < 4; finger++) { context.beginPath(); context.roundRect(180 + finger * 42, 105 + Math.abs(finger - 1) * 17, 34, 160, 17); context.fill() }
      line([[193, 310], [132, 225]])
    } else {
      if (kind === 'school') { context.strokeStyle = red; context.lineWidth = 28; line([[256, 35], [475, 454], [37, 454], [256, 35]]); context.strokeStyle = '#202828'; context.fillStyle = '#202828' }
      const person = (x: number, scale: number) => {
        context.save(); context.translate(x, 170); context.scale(scale, scale)
        context.beginPath(); context.arc(0, 0, 29, 0, Math.PI * 2); context.fill()
        line([[0, 55], [-30, 140], [-90, 200]]); line([[-30, 140], [45, 205]])
        line([[0, 65], [65, 105]]); line([[0, 65], [-80, 105]])
        context.restore()
      }
      person(kind === 'school' ? 220 : 265, kind === 'school' ? 0.78 : 1)
      if (kind === 'school') person(335, 0.52)
      else for (let stripe = 0; stripe < 5; stripe++) context.fillRect(75 + stripe * 75, 420, 52, 18)
    }
    const texture = kit.own(new THREE.CanvasTexture(canvas)); texture.colorSpace = THREE.SRGBColorSpace
    const material = kit.own(new THREE.MeshStandardMaterial({ map: texture, roughness: 0.4, metalness: 0.15 }))
    const isRound = kind === 'speed' || kind === 'bike'
    const shape = kit.geometry(`sign-shape/${kind}`, () => isRound ? new THREE.CircleGeometry(0.9, 48) : kind === 'stop' ? new THREE.CircleGeometry(0.95, 8) : new THREE.PlaneGeometry(1.8, 1.8))
    const backing = kit.cylinder(traffic, 0.96, 0.08, steel, [x, y, 0.25]); backing.rotation.x = Math.PI / 2
    if (!isRound && kind !== 'stop') { backing.visible = false; kit.box(traffic, [1.87, 1.87, 0.08], steel, [x, y, 0.25]) }
    kit.mesh(traffic, shape, material, [x, y, 0.3])
    kit.beam(traffic, [x, 0.4, 0.14], [x, y + 0.55, 0.14], 0.06, steel)
    kit.bolt(traffic, [x, y - 0.65, 0.32])
  }
  for (const [index, kind] of ['stop', 'crossing', 'bike', 'school', 'speed'].entries()) sign(kind, -8 + index * 4, 4)
  const road = kit.group(root, 'playground-crossing', [21, 0, 20])
  kit.box(road, [4.5, 0.035, 17], kit.material('stone', 0x525b59), [0, 0.035, 0], 0.03)
  for (let stripe = 0; stripe < 7; stripe++) kit.box(road, [3.6, 0.008, 0.32], kit.material('paint', 0xf2efdb), [0, 0.058, -2 + stripe * 0.62])
  for (const z of [-7, -5, 5, 7]) kit.box(road, [0.1, 0.008, 0.9], kit.material('paint', 0xf2efdb), [0, 0.058, z])
  kit.cylinder(road, 0.075, 3.9, steel, [-1.6, 1.95, -3.3])
  kit.box(road, [0.5, 1.5, 0.38], dark, [-1.6, 3.4, -3.3], 0.08)
  const bulbs = [0xc52e25, 0xdba926, 0x2c9e68].map((color, index) => {
    const surface = kit.own(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0 }))
    kit.cylinder(road, 0.18, 0.12, dark, [-1.6, 3.86 - index * 0.46, -3.07]).rotation.x = Math.PI / 2
    kit.sphere(road, 0.15, surface, [-1.6, 3.86 - index * 0.46, -2.98]).scale.z = 0.3
    return surface
  })
  const pedestrian = kit.own(new THREE.MeshStandardMaterial({ color: 0x22b77c, emissive: 0x22b77c }))
  kit.box(road, [0.42, 0.65, 0.25], dark, [-1.6, 2.25, -3.28], 0.05)
  kit.box(road, [0.19, 0.33, 0.02], pedestrian, [-1.6, 2.25, -3.14], 0.035)
  const button = kit.group(road, 'pedestrian-button', [-1.6, 1.05, -3.07])
  kit.box(button, [0.23, 0.3, 0.1], kit.material('paint', 0xe2b93f))
  kit.cylinder(button, 0.065, 0.06, dark, [0, 0, 0.07]).rotation.x = Math.PI / 2
  button.userData.dynamic = true
  let requested = -100, elapsed = 0
  motion.actions.push({ id: 'crossing-button', label: 'YuviStudio.playground.action.crossing', object: button, activate: () => { if (elapsed - requested >= 13) requested = elapsed } })
  motion.updates.push((now) => {
    elapsed = now
    const phase = trafficPhase(now - requested)
    bulbs.forEach((surface, index) => { surface.emissiveIntensity = (index === 0 ? phase === 'clearance' || phase === 'pedestrians' : index === 1 ? phase === 'amber' : phase === 'vehicles') ? 2 : 0 })
    pedestrian.emissiveIntensity = phase === 'pedestrians' ? 2 : 0
    pedestrian.color.setHex(phase === 'pedestrians' ? 0x22b77c : 0xad3228)
  })
  kit.batch(traffic); kit.batch(road)
  return { setLabels: (_translate: (key: string) => string) => {} }
}