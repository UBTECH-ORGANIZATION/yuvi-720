import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { createLoftLighting } from '../src/features/Yuvi-studio/LoftLighting.ts'

for (const rich of [true, false]) {
  test(`loft lighting has a bounded light and shadow budget (rich=${rich})`, () => {
    const floorY = -0.92
    const lighting = createLoftLighting(floorY, rich)
    const lights: THREE.Light[] = []
    lighting.group.traverse((node) => { if (node instanceof THREE.Light) lights.push(node) })
    assert.equal(lights.length, rich ? 5 : 3)
    assert.equal(lights.filter((light) => light.castShadow).length, rich ? 1 : 0)
    for (const light of lights) {
      assert.ok(light.position.y > floorY + 9)
      assert.ok(light.position.y < floorY + 12)
      assert.ok(light.intensity > 0)
      assert.ok(light instanceof THREE.PointLight || light instanceof THREE.SpotLight)
      assert.ok(light.distance > 0 && light.distance <= 34)
    }
    const stage = lights.find((light) => light instanceof THREE.SpotLight) as THREE.SpotLight
    assert.equal(stage.target.parent, lighting.group)
    assert.equal(stage.target.position.y, floorY + 0.8)
    let released = 0
    lights.forEach((light) => light.addEventListener('dispose', () => { released += 1 }))
    lighting.dispose()
    assert.equal(released, lights.length)
  })
}