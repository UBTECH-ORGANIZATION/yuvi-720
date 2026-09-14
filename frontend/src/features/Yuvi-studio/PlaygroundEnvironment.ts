import * as THREE from 'three'
import { createPlaygroundKit } from './PlaygroundKit.ts'
import { PLAYGROUND_BOUNDS } from './PlaygroundLayout.ts'
import { buildPlaygroundWalls } from './PlaygroundWalls.ts'
import { buildPlaygroundFence } from './PlaygroundLandscape.ts'
import type { PlaygroundMotion } from './PlaygroundInteractions.ts'

export function createPlaygroundEnvironment(options: { floorY: number; rich: boolean; reduceMotion: boolean }) {
  const kit = createPlaygroundKit(options.rich)
  const group = new THREE.Group(); group.name = 'student-world-adventurePark'; group.position.y = options.floorY
  const motion: PlaygroundMotion = { actions: [], updates: [], reduced: options.reduceMotion }
  const paving = kit.material('stone', 0x587588)
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512
  const context = canvas.getContext('2d')!
  context.fillStyle = '#b8bdb2'; context.fillRect(0, 0, 512, 512)
  for (let row = 0; row < 8; row++) for (let column = -1; column < 5; column++) {
    const shade = 184 + (row * 13 + column * 7) % 22
    context.fillStyle = `rgb(${shade},${shade + 3},${shade - 5})`
    context.fillRect(column * 128 + row % 2 * 64 + 2, row * 64 + 2, 124, 60)
  }
  for (let grain = 0; grain < 18000; grain++) {
    context.fillStyle = grain % 2 ? '#ffffff12' : '#25382714'
    context.fillRect(grain * 73 % 512, grain * 137 % 509, 1, 1)
  }
  const paverMap = kit.own(new THREE.CanvasTexture(canvas)); paverMap.colorSpace = THREE.SRGBColorSpace
  paverMap.wrapS = paverMap.wrapT = THREE.RepeatWrapping; paverMap.repeat.set(8, 10); paverMap.anisotropy = 4
  paving.map = paverMap
  const bump = kit.own(paverMap.clone()); bump.colorSpace = THREE.NoColorSpace; paving.bumpMap = bump; paving.bumpScale = 0.035
  kit.box(group, [48.8, 0.1, 58.5], paving, [0, -0.05, 3.45], 0)
  const walls = kit.group(group, 'park-boundary-walls')
  const wall = kit.material('stone', 0x66889d)
  kit.box(walls, [48.8, 12, 0.18], wall, [0, 6, PLAYGROUND_BOUNDS.back])
  for (const x of [-24.4, 24.4]) {
    kit.box(walls, [0.18, 12, 58.5], wall, [x, 6, 3.45])
    for (let panel = 0; panel < 24; panel++) kit.box(walls, [0.025, 12, 0.018], kit.material('stone', 0x466478), [x + (x < 0 ? 0.11 : -0.11), 6, -25 + panel * 2.45])
    kit.box(walls, [0.24, 0.18, 58.5], kit.material('stone', 0x486b82), [x, 12, 3.45])
  }
  kit.batch(walls)
  const roof = kit.group(group, 'playground-roof')
  const ceiling = kit.mesh(roof, kit.geometry('playground-ceiling', () => new THREE.PlaneGeometry(48.8, 58.5)), kit.material('stone', 0x7595aa), [0, 12, 3.45])
  ceiling.rotation.x = Math.PI / 2
  ceiling.castShadow = false
  const fanMaterial = kit.material('steel', 0x7b8580)
  for (const [index, z] of [-12, 3, 20].entries()) {
    const fan = kit.group(roof, `playground-ceiling-fan-${index}`, [0, 11.35, z])
    kit.cylinder(fan, 0.055, 0.45, fanMaterial, [0, 0.4, 0])
    const rotor = kit.group(fan, 'fan-rotor')
    rotor.userData.dynamic = true
    kit.cylinder(rotor, 0.25, 0.22, fanMaterial)
    for (let blade = 0; blade < 3; blade++) {
      const arm = kit.group(rotor, 'fan-blade')
      arm.rotation.y = blade * Math.PI * 2 / 3
      kit.box(arm, [1.5, 0.035, 0.22], fanMaterial, [0.95, 0, 0], 0.02)
    }
    motion.updates.push((elapsed) => { if (!motion.reduced) rotor.rotation.y = elapsed * 0.65 })
  }
  const wallsContent = buildPlaygroundWalls(group, kit, motion)
  buildPlaygroundFence(group, kit)
  group.updateMatrixWorld(true)
  const interact = (raycaster: THREE.Raycaster) => {
    const hits = raycaster.intersectObject(group, true)
    const closest = hits.find((hit) => hit.object.visible)
    if (!closest) return false
    const action = motion.actions.find((entry) => {
      let node: THREE.Object3D | null = closest.object
      while (node) { if (node === entry.object) return true; node = node.parent }
      return false
    })
    if (!action) return false
    action.activate(); return true
  }
  return { group, floorMaterial: paving, setLabels: wallsContent.setLabels,
    update: (elapsed: number) => motion.updates.forEach((update) => update(elapsed)),
    interact, actions: motion.actions, ready: kit.ready, assetFailures: kit.failures,
    dispose: () => { motion.actions.length = 0; motion.updates.length = 0; kit.dispose() },
  }
}