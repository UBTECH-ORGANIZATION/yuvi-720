import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { MoodId } from './RoomDesign.ts'

const MOOD_LIGHTING: Record<MoodId, {
  background: number
  sky: number
  ground: number
  hemisphere: number
  sun: number
  sunlight: number
}> = {
  studio: { background: 0xcbd0c9, sky: 0xf1f3eb, ground: 0x87927f, hemisphere: 0.65, sun: 0xfff6e7, sunlight: 1.5 },
  sunset: { background: 0x8e5b68, sky: 0xffbd8a, ground: 0x624954, hemisphere: 0.82, sun: 0xffa462, sunlight: 1.9 },
  night: { background: 0x111827, sky: 0x789bd0, ground: 0x26364d, hemisphere: 0.48, sun: 0xc4d9ff, sunlight: 0.72 },
  party: { background: 0x27133f, sky: 0xf17ac6, ground: 0x35345f, hemisphere: 0.78, sun: 0x72e9ff, sunlight: 1.35 },
  aqua: { background: 0x123d46, sky: 0x7de7dd, ground: 0x24525a, hemisphere: 0.8, sun: 0xa8fff4, sunlight: 1.45 },
  rose: { background: 0x4a2037, sky: 0xff9fbd, ground: 0x573348, hemisphere: 0.8, sun: 0xffd0dc, sunlight: 1.4 },
  arcade: { background: 0x1b1039, sky: 0xa66cff, ground: 0x273052, hemisphere: 0.72, sun: 0x56f1e4, sunlight: 1.6 },
  aurora: { background: 0x0b3137, sky: 0x75f0c1, ground: 0x253b5a, hemisphere: 0.85, sun: 0xc4e3ff, sunlight: 1.7 },
}

export function createPlaygroundLighting(scene: THREE.Scene, renderer: THREE.WebGLRenderer, rich: boolean) {
  const previousEnvironment = scene.environment
  const previousEnvironmentIntensity = scene.environmentIntensity
  const previousBackground = scene.background
  const previousFog = scene.fog
  const probeScene = new RoomEnvironment()
  const generator = new THREE.PMREMGenerator(renderer)
  const probe = generator.fromScene(probeScene, 0.04)
  generator.dispose(); probeScene.dispose()
  scene.environment = probe.texture
  scene.environmentIntensity = 0.45
  scene.background = new THREE.Color(0xcbd0c9)
  scene.fog = new THREE.Fog(0xcbd0c9, 85, 175)
  const hemisphere = new THREE.HemisphereLight(0xf1f3eb, 0x87927f, 0.65)
  const sun = new THREE.DirectionalLight(0xfff6e7, 1.5)
  sun.position.set(-10, 10.5, 15); sun.target.position.set(0, 0, -3)
  sun.castShadow = rich
  sun.shadow.mapSize.set(2048, 2048)
  Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 1, far: 100 })
  sun.shadow.camera.updateProjectionMatrix(); sun.shadow.normalBias = 0.04; sun.shadow.bias = -0.00015
  renderer.shadowMap.enabled = rich; renderer.shadowMap.type = THREE.PCFSoftShadowMap
  scene.add(hemisphere, sun, sun.target)
  const setMood = (mood: MoodId) => {
    const lighting = MOOD_LIGHTING[mood] ?? MOOD_LIGHTING.studio
    hemisphere.color.setHex(lighting.sky)
    hemisphere.groundColor.setHex(lighting.ground)
    hemisphere.intensity = lighting.hemisphere
    sun.color.setHex(lighting.sun)
    sun.intensity = lighting.sunlight
    scene.background = new THREE.Color(lighting.background)
    scene.fog = new THREE.Fog(lighting.background, 85, 175)
  }
  return { setMood, dispose: () => {
    scene.remove(hemisphere, sun, sun.target)
    probe.dispose(); sun.shadow.dispose()
    scene.environment = previousEnvironment; scene.background = previousBackground; scene.fog = previousFog
    scene.environmentIntensity = previousEnvironmentIntensity
  } }
}