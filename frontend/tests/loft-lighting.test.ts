import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { createLoftLighting } from '../src/features/Yuvi-studio/LoftLighting.ts'

/* Every light is built once whatever the tier (the room's rule: a tier
   change flips visibility, it never rebuilds), so the budget is what is
   VISIBLE: two fixtures on low, two and the stage spot on medium, all five
   on high — with the rig and the station lights that is 6 / 10 / 16. */
for (const rich of [true, false]) {
  test(`loft lighting has a bounded light and shadow budget (rich=${rich})`, () => {
    const floorY = -0.92
    const lighting = createLoftLighting(floorY, rich)
    const lights: THREE.Light[] = []
    lighting.group.traverse((node) => { if (node instanceof THREE.Light) lights.push(node) })
    assert.equal(lights.length, 5)
    const visible = () => lights.filter((light) => light.visible).length
    assert.equal(visible(), rich ? 5 : 2)
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
    // A governor tier change lands here without a rebuild.
    lighting.setQuality('low'); assert.equal(visible(), 2); assert.equal(stage.visible, false)
    lighting.setQuality('medium'); assert.equal(visible(), 3); assert.equal(stage.visible, true)
    lighting.setQuality('high'); assert.equal(visible(), 5)
    let released = 0
    lights.forEach((light) => light.addEventListener('dispose', () => { released += 1 }))
    lighting.dispose()
    assert.equal(released, lights.length)
  })
}

test('a world of its own keeps only the key and effect lights of the lab, and budgets its own', () => {
  const room = readFileSync(new URL('../src/features/Yuvi-studio/YuviLabRoom.ts', import.meta.url), 'utf8')
  assert.match(room, /const lab = layoutId === 'lab'\n\s+keyLight\.visible = true\n\s+accentLight\.visible = lab\n\s+warmLight\.visible = lab\n\s+rimLight\.visible = lab && notLow\n\s+coolLight\.visible = lab && notLow\n\s+windowLight\.visible = lab && high\n\s+if \(screenLight\) screenLight\.visible = lab && high/)
  assert.match(room, /setEnvironmentQuality\?\.\(q\)/)
  const environment = readFileSync(new URL('../src/features/Yuvi-studio/StudentWorldEnvironment.ts', import.meta.url), 'utf8')
  assert.match(environment, /setQuality = lighting\.setQuality/)
  const park = readFileSync(new URL('../src/features/Yuvi-studio/PlaygroundLighting.ts', import.meta.url), 'utf8')
  // The park's probe and fog follow the tier; the renderer's shadow map is
  // the canvas' to enable, never the park's.
  assert.match(park, /if \(quality !== 'low'\) \{\n\s+const probeScene = new RoomEnvironment\(\)/)
  assert.match(park, /sun\.castShadow = quality === 'high'/)
  assert.doesNotMatch(park, /renderer\.shadowMap\.(enabled|type)/)
  const avatar = readFileSync(new URL('../src/features/Yuvi-studio/YuviAvatar3D.tsx', import.meta.url), 'utf8')
  assert.match(avatar, /createPlaygroundLighting\(scene, renderer, roomQuality\)/)
  assert.match(avatar, /if \(playgroundLighting\) playgroundLighting\.setQuality\(next\)/)
})
