import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { createYuviLabRoom } from '../src/features/Yuvi-studio/YuviLabRoom.ts'
import { createRoomKit, ROOM_ITEMS } from '../src/features/Yuvi-studio/RoomCatalog.ts'
import { DEFAULT_WORLDS, normalizeRoom, syncActiveWorld, switchRoomWorld } from '../src/features/Yuvi-studio/RoomDesign.ts'
import { SPORTS_PAID_PROP_IDS } from '../src/features/Yuvi-studio/SportsArenaCatalog.ts'

export function createArenaReview(rich = true, reduced = false) {
  const renderer = new THREE.WebGLRenderer({ antialias: rich, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = rich
  document.body.append(renderer.domElement)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xbcc4bf)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const roomEnvironment = new RoomEnvironment()
  const reflection = pmrem.fromScene(roomEnvironment)
  scene.environment = reflection.texture
  pmrem.dispose(); roomEnvironment.dispose()
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 180)
  const room = createYuviLabRoom(scene, { layoutId: 'sportsArena', quality: rich ? 'high' : 'low', reduceMotion: reduced, deckY: -0.92 })
  let design = normalizeRoom({ version: 9, activeLayoutId: 'sportsArena', ...structuredClone(DEFAULT_WORLDS.sportsArena) })
  room.setUserItems(design.items)
  room.setRoomStyle({ floor: 'lab', wall: 'lab', mood: 'studio' })
  room.setStations(design.stations)
  const sampleKit = createRoomKit(rich)
  const sampleScene = new THREE.Scene()
  sampleScene.background = new THREE.Color(0xc6ceca)
  sampleScene.environment = reflection.texture
  sampleScene.add(new THREE.HemisphereLight(0xffffff, 0x7d8982, 2))
  const key = new THREE.DirectionalLight(0xfffaf2, 2.4)
  key.position.set(4, 6, 5); sampleScene.add(key)
  const samples = new THREE.Group(); sampleScene.add(samples)
  let activeScene = scene
  const render = () => {
    renderer.setSize(innerWidth, innerHeight)
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
    renderer.render(activeScene, camera)
    const gl = renderer.getContext()
    const pixels = new Uint8Array(innerWidth * innerHeight * 4)
    gl.readPixels(0, 0, innerWidth, innerHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    const colors = new Set()
    let hash = 0
    for (let index = 0; index < pixels.length; index += 16) {
      colors.add(`${pixels[index] >> 4},${pixels[index + 1] >> 4},${pixels[index + 2] >> 4}`)
      hash = (hash + pixels[index] * (index % 197 + 1)) % 2147483647
    }
    return { colors: colors.size, hash, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, memory: { ...renderer.info.memory } }
  }
  return {
    renderer, room, scene, camera, samples, design,
    overview() {
      activeScene = scene
      camera.fov = 60
      camera.position.set(0, innerWidth < 600 ? 38 : 23, innerWidth < 600 ? 112 : 46)
      camera.lookAt(0, 1, -1)
      return render()
    },
    closeup(ids) {
      activeScene = sampleScene
      samples.clear()
      ids.forEach((id, index) => {
        const spec = ROOM_ITEMS.find((item) => item.id === id)
        if (!spec) throw new Error(`Missing catalog item: ${id}`)
        const root = spec.build(sampleKit.kit, new THREE.Color(spec.tint ?? '#d56b52'))
        root.position.x = (index - (ids.length - 1) / 2) * 4
        samples.add(root)
      })
      const bounds = new THREE.Box3().setFromObject(samples)
      const center = bounds.getCenter(new THREE.Vector3())
      const size = bounds.getSize(new THREE.Vector3())
      camera.fov = 40
      const distance = Math.max(size.y, size.x / (innerWidth / innerHeight), size.z) / (2 * Math.tan(THREE.MathUtils.degToRad(20))) * 1.35
      camera.position.copy(center).add(new THREE.Vector3(0.38, 0.25, 1).normalize().multiplyScalar(distance))
      camera.lookAt(center)
      return render()
    },
    moveSample() { samples.rotation.y += 0.2; return render() },
    async locale(language) {
      document.documentElement.lang = language
      document.documentElement.dir = language === 'en' ? 'ltr' : 'rtl'
      const messages = await (await fetch(`/locales/${language}.json`)).json()
      room.setLabels((key) => messages[key] ?? key)
      sampleKit.kit.setLabels((key) => messages[key] ?? key)
      return render()
    },
    exercise() {
      const item = design.items.find((item) => item.kind === 'sportsDumbbellRack')
      const original = { ...item }
      item.x += 1; item.rot += Math.PI / 4
      room.setUserItems(design.items)
      const anchor = room.itemAnchor(item.uid)
      design = normalizeRoom(JSON.parse(JSON.stringify(syncActiveWorld(design))))
      design = switchRoomWorld(switchRoomWorld(design, 'lab'), 'sportsArena')
      const restored = design.items.find((candidate) => candidate.uid === item.uid)
      const ownedUpgrade = [...SPORTS_PAID_PROP_IDS][0]
      design.items.push(...[0, 1].map((index) => ({ uid: `purchased-${index}`, kind: ownedUpgrade, x: 0, z: 0, rot: 0, wallAnchor: { wallId: 'north', offset: 0.25 + index * 0.3, height: 2 } })))
      room.setUserItems(design.items)
      return { moved: Math.abs(anchor.x - original.x - 1) < 0.01, reload: restored.x === item.x && restored.rot === item.rot, repeats: design.items.filter((candidate) => candidate.kind === ownedUpgrade).length }
    },
    render,
    dispose() {
      room.dispose(); sampleKit.dispose(); key.dispose(); reflection.dispose()
      renderer.render(new THREE.Scene(), camera)
      const memory = { ...renderer.info.memory }
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove()
      return memory
    },
  }
}