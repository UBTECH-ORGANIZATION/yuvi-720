import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { createStudentWorldEnvironment } from '../src/features/Yuvi-studio/StudentWorldEnvironment.ts'

for (const rich of [true, false]) for (const reduceMotion of [true, false]) {
  test(`sports hall structure, idle motion and cleanup (rich=${rich}, reduced=${reduceMotion})`, () => {
    const context = new Proxy({}, { get: () => () => undefined })
    const original = Object.getOwnPropertyDescriptor(globalThis, 'document')
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } })
    try {
      const hall = createStudentWorldEnvironment({ id: 'sportsArena', floorY: 0, rich, reduceMotion })
      assert.ok(hall.group.getObjectByName('sports-arena-shell')?.getObjectByName('sports-static-batch'))
      assert.ok(hall.group.getObjectByName('sports-acoustic-wall-panels'))
      for (const name of ['sports-mounted-hoops', 'sports-score-wall', 'sports-original-artworks']) assert.equal(hall.group.getObjectByName(name), undefined)
      const fan = hall.group.getObjectByName('sports-gym-fan-1')!
      hall.update(1)
      const before = fan.rotation.y
      hall.update(3)
      assert.equal(fan.rotation.y === before, reduceMotion)
      const resources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>()
      const lights: THREE.Light[] = []
      hall.group.traverse((node) => {
        if (node instanceof THREE.Light) lights.push(node)
        if (!(node instanceof THREE.Mesh)) return
        resources.add(node.geometry)
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          resources.add(material)
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) resources.add(value)
        }
      })
      assert.equal(lights.length, 2)
      assert.ok(lights.every((light) => !light.castShadow))
      let disposed = 0
      for (const resource of resources) resource.addEventListener('dispose', () => { disposed++ })
      hall.dispose()
      assert.equal(disposed, resources.size)
      hall.dispose()
      assert.equal(disposed, resources.size)
    } finally {
      if (original) Object.defineProperty(globalThis, 'document', original)
      else Reflect.deleteProperty(globalThis, 'document')
    }
  })
}