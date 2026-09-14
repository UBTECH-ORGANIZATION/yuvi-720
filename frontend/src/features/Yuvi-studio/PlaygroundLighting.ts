import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

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
  return { dispose: () => {
    scene.remove(hemisphere, sun, sun.target)
    probe.dispose(); sun.shadow.dispose()
    scene.environment = previousEnvironment; scene.background = previousBackground; scene.fog = previousFog
    scene.environmentIntensity = previousEnvironmentIntensity
  } }
}