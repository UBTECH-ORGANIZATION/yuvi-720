import * as THREE from 'three'
import type { PlaygroundKit } from './PlaygroundKit.ts'

export type PlaygroundRideKind = 'parkSwings' | 'parkBasketSwing' | 'parkCarousel'
export const PLAYGROUND_RIDE_BOUNDS = {
  parkSwings: { radius: 2.5, height: 2.3 },
  parkBasketSwing: { radius: 2.5, height: 2.3 },
  parkCarousel: { radius: 1.5, height: 0.75 },
} as const

export function buildPlaygroundRide(kit: PlaygroundKit, kind: PlaygroundRideKind, tint: THREE.Color) {
  const root = new THREE.Group()
  root.name = kind
  const steel = kit.material('steel', 0xa6afb0)
  const dark = kit.material('rubber', 0x293735)
  const paint = kit.material('paint', tint)
  const rope = kit.material('rope', 0xc6b895)
  const yellow = kit.material('paint', 0xe5b63b)
  if (kind === 'parkCarousel') {
    kit.cylinder(root, 2.45, 0.08, dark, [0, 0.04, 0])
    const carousel = kit.group(root, 'carousel-platform', [0, 0.13, 0])
    carousel.userData.dynamic = true
    kit.cylinder(carousel, 2.1, 0.13, paint)
    for (const angle of [0, Math.PI * 2 / 3, Math.PI * 4 / 3]) {
      const segment = kit.group(carousel, 'carousel-handrail')
      segment.rotation.y = angle
      kit.tube(segment, [[0.6, 0.05, 0], [0.6, 0.9, 0], [1.75, 0.9, 0], [1.75, 0.05, 0]], 0.055, steel)
      kit.box(segment, [0.6, 0.12, 0.6], yellow, [1.2, 0.4, 0.4], 0.1)
    }
    root.userData.update = (elapsed: number) => { carousel.rotation.y = elapsed * 0.14 }
  } else {
    for (const x of [-2.3, 2.3]) {
      for (const side of [-1, 1]) {
        kit.beam(root, [x, 0.12, side * 1.65], [x, 3.8, 0], 0.11, steel)
        kit.cylinder(root, 0.18, 0.25, dark, [x, 0.12, side * 1.65])
      }
      kit.beam(root, [x, 1.4, -1.1], [x, 1.4, 1.1], 0.065, steel)
    }
    kit.beam(root, [-2.5, 3.8, 0], [2.5, 3.8, 0], 0.14, paint)
    const pivots: THREE.Group[] = []
    const basket = kind === 'parkBasketSwing'
    for (const [index, x] of (basket ? [0] : [-1.1, 1.1]).entries()) {
      const pivot = kit.group(root, `swing-pivot-${index}`, [x, 3.7, 0])
      pivot.userData.dynamic = true
      pivots.push(pivot)
      const width = basket ? 0.85 : 0.36
      for (const side of [-1, 1]) {
        kit.beam(pivot, [side * width, 0, 0], [side * width, -2.8, 0], 0.027, steel)
        for (let link = 0; link < (kit.rich ? 25 : 12); link++) {
          const chain = kit.mesh(pivot, kit.geometry('chain-link', () => new THREE.TorusGeometry(0.043, 0.012, 4, 8)), steel, [side * width, -link * (kit.rich ? 0.108 : 0.23), 0])
          chain.scale.y = 1.5
          chain.rotation.y = link % 2 * Math.PI / 2
        }
      }
      if (basket) {
        const rim = kit.mesh(pivot, kit.geometry('basket-rim', () => new THREE.TorusGeometry(0.9, 0.095, 8, 32)), paint, [0, -2.8, 0])
        rim.rotation.x = Math.PI / 2
        for (let cord = -3; cord <= 3; cord++) {
          const across = Math.sqrt(0.8 ** 2 - (cord * 0.22) ** 2)
          kit.beam(pivot, [-across, -2.84, cord * 0.22], [across, -2.84, cord * 0.22], 0.028, rope)
          kit.beam(pivot, [cord * 0.22, -2.84, -across], [cord * 0.22, -2.84, across], 0.028, rope)
        }
      } else {
        kit.box(pivot, [0.86, 0.12, 0.42], dark, [0, -2.8, 0], 0.08)
        if (index === 1) {
          kit.box(pivot, [0.84, 0.45, 0.07], paint, [0, -2.53, -0.2], 0.05)
          kit.tube(pivot, [[-0.38, -2.65, -0.2], [-0.38, -2.4, 0.24], [0.38, -2.4, 0.24], [0.38, -2.65, -0.2]], 0.065, paint)
          kit.box(pivot, [0.09, 0.38, 0.06], dark, [0, -2.6, 0.22])
        }
      }
    }
    root.userData.update = (elapsed: number) => pivots.forEach((pivot, index) => { pivot.rotation.x = Math.sin(elapsed * 1.8 + index) * 0.09 })
  }
  kit.batch(root)
  const scaled = new THREE.Group()
  root.scale.setScalar(1 / 1.75)
  scaled.add(root)
  return scaled
}