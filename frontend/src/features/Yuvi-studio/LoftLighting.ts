import * as THREE from 'three'
import type { RenderTier } from './renderTier.ts'

/* The Creator Loft's practicals: four ceiling fixtures and the stage spot.
   Every light is built once, whatever the tier, and the budget only flips
   visibility (the lab's rule, see `applyLightBudget` in YuviLabRoom): so a
   governor tier change mid-session lands here too, and the numbers stay
   inside the room's 6 / 10 / 16 with the rig and the station lights —
   low: the two diagonal fixtures; medium: those and the stage spot; high:
   all four and the spot. The spot's shadow is a build-time choice like the
   lab key light's, and the map is only ever enabled at high. */
export function createLoftLighting(floorY: number, rich: boolean) {
  const group = new THREE.Group()
  group.name = 'creator-loft-practical-lighting'
  const fixtures = [[-16, -7], [16, -7], [-12, 19], [12, 19]]
  const lights = fixtures.map(([x, z]) => {
    const light = new THREE.PointLight(0xfff1dd, 240, 32, 2)
    light.position.set(x, floorY + 9.5, z)
    group.add(light)
    return light
  })
  const stage = new THREE.SpotLight(0xe2efff, 480, 34, Math.PI / 3, 0.8, 2)
  stage.position.set(0, floorY + 10.8, -16)
  stage.target.position.set(0, floorY + 0.8, -22)
  stage.castShadow = rich
  stage.shadow.mapSize.set(1024, 1024)
  stage.shadow.camera.near = 1
  stage.shadow.camera.far = 34
  stage.shadow.normalBias = 0.04
  stage.shadow.bias = -0.0002
  group.add(stage, stage.target)
  const setQuality = (quality: RenderTier) => {
    const high = quality === 'high'
    // Two fixtures carry the low tiers a little brighter, as the reduced
    // room always had them.
    lights.forEach((light, index) => {
      light.visible = high || index === 0 || index === 3
      light.intensity = high ? 240 : 320
    })
    stage.visible = quality !== 'low'
  }
  setQuality(rich ? 'high' : 'low')
  return {
    group,
    setQuality,
    dispose() {
      group.traverse((node) => { if (node instanceof THREE.Light) node.dispose() })
    },
  }
}
