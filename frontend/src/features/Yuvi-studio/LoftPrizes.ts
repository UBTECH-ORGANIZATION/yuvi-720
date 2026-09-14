import * as THREE from 'three'
import type { LoftFabrication } from './LoftFabrication'

export type LoftPrize = 'phone' | 'watch' | 'headphones' | 'plush' | 'figure' | 'vrHeadset' | 'controller'

export function buildLoftPrize(factory: LoftFabrication, kind: LoftPrize): THREE.Group {
  const group = new THREE.Group()
  group.name = `loft-prize-${kind}`
  const black = factory.material('rubber', 0x1c2023)
  const metal = factory.material('steel', 0x9ba3aa)
  const white = factory.material('paint', 0xe0e2df)
  const screen = factory.print('panel')
  if (kind === 'controller') {
    const body = factory.profile([[-0.18, 0.02], [-0.23, 0.06], [-0.2, 0.21], [-0.14, 0.25], [0.14, 0.25], [0.2, 0.21], [0.23, 0.06], [0.18, 0.02], [0.1, 0.12], [-0.1, 0.12]], 0.085, white)
    group.add(body)
    group.add(factory.box(0.125, 0.06, 0.016, black, 0, 0.206, 0.05))
    for (const x of [-0.074, 0.074]) {
      const stick = factory.cylinder(0.03, 0.036, black, x, 0.142, 0.069); stick.rotation.x = Math.PI / 2; group.add(stick)
    }
    group.add(factory.box(0.066, 0.021, 0.02, black, -0.148, 0.207, 0.055))
    group.add(factory.box(0.022, 0.063, 0.02, black, -0.148, 0.207, 0.055))
    for (let index = 0; index < 4; index += 1) {
      const angle = index * Math.PI / 2
      const button = factory.cylinder(0.011, 0.016, factory.material('paint', [0x4b9e8e, 0xad524e, 0x557fbc, 0xc4a54d][index]), 0.148 + Math.cos(angle) * 0.025, 0.207 + Math.sin(angle) * 0.025, 0.055)
      button.rotation.x = Math.PI / 2; group.add(button)
    }
  } else if (kind === 'phone') {
    group.add(factory.box(0.23, 0.46, 0.026, metal, 0, 0.23, 0))
    group.add(factory.box(0.215, 0.443, 0.013, black, 0, 0.23, 0.014))
    const display = factory.sign(0.2, 0.42, 'panel', '')
    display.position.set(0, 0.23, 0.022); group.add(display)
    group.add(factory.box(0.065, 0.014, 0.004, black, 0, 0.421, 0.027))
    group.add(factory.box(0.09, 0.1, 0.009, black, -0.057, 0.387, -0.019))
    for (const [x, y] of [[-0.075, 0.41], [-0.03, 0.386], [-0.075, 0.366]]) {
      const lens = factory.cylinder(0.017, 0.014, metal, x, y, -0.029); lens.rotation.x = Math.PI / 2; group.add(lens)
      const glass = factory.cylinder(0.012, 0.016, black, x, y, -0.032); glass.rotation.x = Math.PI / 2; group.add(glass)
    }
    group.add(factory.box(0.008, 0.058, 0.012, black, 0.12, 0.28, 0))
    group.add(factory.box(0.048, 0.005, 0.012, black, 0, 0.006, 0))
  } else if (kind === 'watch') {
    const strap = factory.material('rubber', 0x547d76)
    group.add(factory.tube([[0, 0.08, 0.08], [0, 0.02, -0.04], [0, 0.17, -0.11], [0, 0.35, -0.03], [0, 0.28, 0.08]], 0.043, strap))
    group.add(factory.box(0.19, 0.225, 0.043, metal, 0, 0.21, 0.08))
    group.add(factory.box(0.163, 0.197, 0.01, black, 0, 0.21, 0.107))
    const dial = factory.mesh(new THREE.CircleGeometry(0.066, 32), screen, 0, 0.21, 0.116); group.add(dial)
    group.add(factory.box(0.008, 0.045, 0.004, white, 0, 0.232, 0.12))
    const hand = factory.box(0.048, 0.007, 0.004, white, 0.021, 0.21, 0.12); hand.rotation.z = -0.3; group.add(hand)
    const crown = factory.cylinder(0.021, 0.014, metal, 0.1, 0.24, 0.08); crown.rotation.z = Math.PI / 2; group.add(crown)
  } else if (kind === 'headphones') {
    const cushion = factory.material('cloth', 0x30383b)
    group.add(factory.tube([[-0.17, 0.18, 0], [-0.2, 0.35, 0], [0, 0.46, 0], [0.2, 0.35, 0], [0.17, 0.18, 0]], 0.028, black))
    for (const side of [-1, 1]) {
      group.add(factory.box(0.054, 0.2, 0.13, metal, side * 0.18, 0.17, 0))
      group.add(factory.box(0.055, 0.17, 0.12, cushion, side * 0.145, 0.17, 0.018, 0.025))
      group.add(factory.box(0.03, 0.146, 0.103, white, side * 0.218, 0.17, 0, 0.025))
    }
    group.add(factory.tube([[0.19, 0.13, 0.045], [0.15, 0.07, 0.17], [0.06, 0.09, 0.22]], 0.007, black))
  } else if (kind === 'vrHeadset') {
    group.add(factory.box(0.36, 0.18, 0.19, white, 0, 0.14, 0, 0.05))
    group.add(factory.box(0.31, 0.13, 0.035, black, 0, 0.14, 0.098, 0.025))
    for (const x of [-0.11, 0.11]) {
      const lens = factory.cylinder(0.025, 0.012, metal, x, 0.14, 0.12); lens.rotation.x = Math.PI / 2; group.add(lens)
    }
    group.add(factory.tube([[-0.17, 0.14, 0], [-0.16, 0.16, -0.22], [0.16, 0.16, -0.22], [0.17, 0.14, 0]], 0.025, black))
    group.add(factory.tube([[0, 0.22, 0], [0, 0.35, -0.12], [0, 0.16, -0.23]], 0.018, black))
  } else if (kind === 'plush') {
    const fabric = factory.material('cloth', 0xc5a56f)
    const cream = factory.material('cloth', 0xe9d4aa)
    const body = factory.sphere(0.16, fabric, 0, 0.19, 0); body.scale.set(0.9, 1.15, 0.8); group.add(body)
    group.add(factory.sphere(0.13, fabric, 0, 0.4, 0.015))
    for (const side of [-1, 1]) {
      group.add(factory.sphere(0.06, fabric, side * 0.105, 0.49, 0.01))
      const arm = factory.sphere(0.069, fabric, side * 0.15, 0.22, 0); arm.scale.y = 1.5; arm.rotation.z = side * 0.3; group.add(arm)
      group.add(factory.sphere(0.075, cream, side * 0.09, 0.071, 0.04))
      group.add(factory.sphere(0.012, black, side * 0.045, 0.423, 0.13))
    }
    const muzzle = factory.sphere(0.055, cream, 0, 0.371, 0.118); muzzle.scale.z = 0.55; group.add(muzzle)
    group.add(factory.sphere(0.018, black, 0, 0.389, 0.153))
    for (let index = 0; index < 9; index += 1) group.add(factory.box(0.006, 0.01, 0.005, cream, 0, 0.12 + index * 0.022, 0.127))
  } else {
    const jacket = factory.material('paint', 0xb85542)
    group.add(factory.cylinder(0.14, 0.03, black, 0, 0.015, 0))
    for (const side of [-1, 1]) {
      group.add(factory.box(0.064, 0.15, 0.06, black, side * 0.045, 0.12, 0))
      group.add(factory.box(0.075, 0.042, 0.1, white, side * 0.045, 0.047, 0.02))
      const arm = factory.box(0.053, 0.15, 0.06, jacket, side * 0.103, 0.24, 0); arm.rotation.z = side * 0.2; group.add(arm)
    }
    group.add(factory.box(0.15, 0.19, 0.09, jacket, 0, 0.255, 0))
    group.add(factory.sphere(0.092, white, 0, 0.418, 0))
    group.add(factory.box(0.145, 0.053, 0.025, black, 0, 0.419, 0.071))
  }
  return group
}