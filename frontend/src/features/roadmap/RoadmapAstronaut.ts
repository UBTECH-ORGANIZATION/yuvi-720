import * as THREE from 'three'
import { cloneDesign, DEFAULT_DESIGN } from '../Yuvi-studio/YuviDesign'
import { createRoadmapYuvi } from './RoadmapYuvi'

export function createRoadmapAstronautTexture(renderer: THREE.WebGLRenderer) {
  const design = cloneDesign(DEFAULT_DESIGN)
  design.equipped.headTop = 'astro'
  const avatar = createRoadmapYuvi(design)
  avatar.update(0, false, true, 1)
  avatar.object.traverse((object) => {
    if (object.name.startsWith('roadmap-yuvi-thruster')) object.visible = false
  })
  avatar.object.updateMatrixWorld(true)
  const bounds = new THREE.Box3()
  avatar.object.traverseVisible((object) => {
    if (object instanceof THREE.Mesh) bounds.expandByObject(object)
  })
  const center = bounds.getCenter(new THREE.Vector3())
  const size = bounds.getSize(new THREE.Vector3())
  const half = Math.max(size.x, size.y) * 0.57
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 20)
  camera.position.set(center.x, center.y, center.z + 8)
  camera.lookAt(center)
  const scene = new THREE.Scene()
  scene.add(avatar.object, new THREE.HemisphereLight(0xe4f4ff, 0x53496f, 2.5))
  const key = new THREE.DirectionalLight(0xffffff, 3)
  key.position.set(-3, 5, 6)
  scene.add(key)
  const target = new THREE.WebGLRenderTarget(512, 512)
  target.texture.name = 'roadmap-yubi-astronaut'
  const previousTarget = renderer.getRenderTarget()
  const viewport = renderer.getViewport(new THREE.Vector4())
  const scissor = renderer.getScissor(new THREE.Vector4())
  const scissorTest = renderer.getScissorTest()
  const clearColor = renderer.getClearColor(new THREE.Color())
  const clearAlpha = renderer.getClearAlpha()
  try {
    renderer.setRenderTarget(target)
    renderer.setScissorTest(false)
    renderer.setClearColor(0x000000, 0)
    renderer.clear()
    renderer.render(scene, camera)
    return target
  } catch (error) {
    target.dispose()
    throw error
  } finally {
    renderer.setRenderTarget(previousTarget)
    renderer.setViewport(viewport)
    renderer.setScissor(scissor)
    renderer.setScissorTest(scissorTest)
    renderer.setClearColor(clearColor, clearAlpha)
    avatar.dispose()
  }
}