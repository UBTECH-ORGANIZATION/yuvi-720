import * as THREE from 'three'
import { createPlaygroundEnvironment } from '../src/features/Yuvi-studio/PlaygroundEnvironment.ts'
import { createPlaygroundLighting } from '../src/features/Yuvi-studio/PlaygroundLighting.ts'
import { createRoomKit, roomItemSpec, WEEKLY_SURPRISE_READY } from '../src/features/Yuvi-studio/RoomCatalog.ts'
import { ADVENTURE_PARK_DEFAULT_ITEMS, normalizeRoom } from '../src/features/Yuvi-studio/RoomDesign.ts'
import { playgroundGiftPosition } from '../src/features/Yuvi-studio/PlaygroundLayout.ts'

export async function createPlaygroundReview(rich = true, reduced = false) {
  document.body.style.cssText = 'margin:0;overflow:hidden;background:#c2d9dc'
  const renderer = new THREE.WebGLRenderer({ antialias: rich, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight)
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05
  document.body.append(renderer.domElement)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 250)
  const lighting = createPlaygroundLighting(scene, renderer, rich)
  if (new URLSearchParams(location.search).has('direct')) {
    scene.environment = null
    scene.children.filter((child) => child.type === 'Mesh').forEach((child) => { child.visible = false })
  }
  const park = createPlaygroundEnvironment({ floorY: 0, rich, reduceMotion: reduced })
  const catalogKit = createRoomKit(rich)
  const samples = new THREE.Group(); samples.visible = false; scene.add(samples)
  const equipment = new THREE.Group(); scene.add(equipment)
  const room = normalizeRoom({ version: 9, activeLayoutId: 'adventurePark', items: ADVENTURE_PARK_DEFAULT_ITEMS }, {
    sportsArenaOwned: false,
    boundsFor: (item) => ({ radius: (roomItemSpec(item.kind)?.radius ?? 1) * 1.75, height: 1, wall: roomItemSpec(item.kind)?.placement === 'wall' }),
  })
  for (const item of room.items) {
    const spec = roomItemSpec(item.kind)
    const object = new THREE.Group()
    object.add(spec.build(catalogKit.kit, new THREE.Color(spec.tint ?? '#ffffff')))
    object.name = item.kind; object.userData.uid = item.uid
    object.scale.setScalar(1.75); object.position.set(item.x, 0, item.z); object.rotation.y = item.rot
    equipment.add(object)
  }
  const giftPosition = playgroundGiftPosition([
    ...room.items.map((item) => ({ ...item, radius: roomItemSpec(item.kind).radius * 1.75 })),
    ...Object.values(room.stations).filter((station) => station.placed).map((station) => ({ ...station, radius: 2 })),
    { x: 0, z: 0, radius: 2 },
  ])
  const gift = roomItemSpec(WEEKLY_SURPRISE_READY).build(catalogKit.kit, new THREE.Color('#ffffff'))
  gift.name = 'weekly-gift'; gift.scale.setScalar(1.75); gift.position.set(giftPosition.x, 0, giftPosition.z)
  scene.add(gift)
  scene.add(park.group)
  await catalogKit.ready()
  await park.ready()
  if (park.assetFailures.length) throw new Error(`Missing assets: ${park.assetFailures}`)
  const render = (time = 0) => {
    park.update(time); scene.updateMatrixWorld(true)
    if (!reduced) samples.traverse((node) => { if (typeof node.userData.update === 'function') node.userData.update(time) })
    if (!reduced) equipment.traverse((node) => { if (typeof node.userData.update === 'function') node.userData.update(time) })
    renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix()
    renderer.render(scene, camera)
    const gl = renderer.getContext(), pixels = new Uint8Array(innerWidth * innerHeight * 4)
    gl.readPixels(0, 0, innerWidth, innerHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    const colors = new Set(); let hash = 0
    for (let index = 0; index < pixels.length; index += 64) {
      colors.add(`${pixels[index] >> 4},${pixels[index + 1] >> 4},${pixels[index + 2] >> 4}`)
      hash = (hash + pixels[index] * (index % 197 + 1) + pixels[index + 1] * 7) % 2147483647
    }
    return { colors: colors.size, hash, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, memory: { ...renderer.info.memory } }
  }
  return {
    park, scene, camera, renderer, render, samples, equipment, gift,
    checkEquipment() {
      const checks = equipment.children.map((object) => {
        const originalPosition = object.position.clone(), originalRotation = object.rotation.y
        object.position.set(0, 0, 0); object.rotation.y = Math.PI / 4
        render(2)
        let radius = 0
        const point = new THREE.Vector3(), instance = new THREE.Matrix4(), transform = new THREE.Matrix4()
        object.traverse((node) => {
          if (!node.isMesh) return
          const positions = node.geometry.attributes.position
          for (let index = 0; index < (node.isInstancedMesh ? node.count : 1); index++) {
            if (node.isInstancedMesh) { node.getMatrixAt(index, instance); transform.multiplyMatrices(node.matrixWorld, instance) }
            else transform.copy(node.matrixWorld)
            for (let vertex = 0; vertex < positions.count; vertex++) {
              point.fromBufferAttribute(positions, vertex).applyMatrix4(transform)
              radius = Math.max(radius, Math.hypot(point.x, point.z))
            }
          }
        })
        const preserved = object.rotation.y === Math.PI / 4
        object.position.copy(originalPosition); object.rotation.y = originalRotation
        return { kind: object.name, preserved, radius, allowed: roomItemSpec(object.name).radius * 1.75 }
      })
      scene.updateMatrixWorld(true)
      const eye = new THREE.Vector3(gift.position.x, 2.2, gift.position.z + 6)
      const target = gift.position.clone().add(new THREE.Vector3(0, 0.65, 0))
      const ray = new THREE.Raycaster(eye, target.sub(eye).normalize())
      const hit = ray.intersectObjects([park.group, equipment, gift], true)[0]
      let hitGift = false
      for (let node = hit?.object; node; node = node.parent) if (node === gift) hitGift = true
      return { checks, hitGift, giftPosition: gift.position.toArray() }
    },
    catalog() {
      samples.clear(); samples.visible = true
      for (const [index, id] of ['parkSwings', 'parkBasketSwing', 'parkCarousel'].entries()) {
        const spec = roomItemSpec(id)
        if (!spec) throw new Error(`Missing catalog ride ${id}`)
        const object = spec.build(catalogKit.kit, new THREE.Color(spec.tint))
        object.name = id; object.scale.setScalar(1.75); object.position.set(-6 + index * 9, 0, 23)
        samples.add(object)
      }
      camera.position.set(3, 9, 42); camera.lookAt(3, 1, 23)
      return render()
    },
    async locale(language) {
      document.documentElement.lang = language; document.documentElement.dir = language === 'en' ? 'ltr' : 'rtl'
      const messages = await (await fetch(`/locales/${language}.json`)).json()
      park.setLabels((key) => messages[key] ?? key)
    },
    view(name = 'overview') {
      samples.visible = false
      const views = { overview: [[0, 10, 38], [0, 2, -2]], roof: [[0, 5, 27], [0, 11.5, 0]], towers: [[-1, 7, 5], [-11, 2, -9]], climbing: [[0, 5, -7], [0, 4, -24]], traffic: [[10, 4, 23], [24, 3, 20]], sand: [[-5, 6, 31], [-14, 0, 21]], cleared: [[-1, 5, 32], [9, 1, 24]], gift: [[gift.position.x, 2.2, gift.position.z + 6], [gift.position.x, 0.65, gift.position.z]] }
      const [position, target] = views[name]
      camera.position.set(...position); camera.lookAt(...target)
      if (innerWidth < 600 && name === 'overview') { camera.position.set(0, 40, 98); camera.lookAt(0, 0, -1) }
      return render()
    },
    dispose() { catalogKit.dispose(); park.dispose(); lighting.dispose(); scene.clear(); renderer.render(scene, camera); const memory = { ...renderer.info.memory }; renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); return memory },
  }
}