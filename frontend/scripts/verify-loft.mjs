import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const output = fileURLToPath(new URL('../../.runtime/loft-review/', import.meta.url))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/__loft-review', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en" dir="ltr"><head><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block}</style></head><body></body></html>' }))
  await page.goto('http://127.0.0.1:5173/__loft-review')
  await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js')
    const { RoomEnvironment } = await import('/node_modules/three/examples/jsm/environments/RoomEnvironment.js')
    const { createRoomKit, ROOM_ITEMS } = await import('/src/features/Yuvi-studio/RoomCatalog.ts')
    const { createLoftSurfaceMaterials } = await import('/src/features/Yuvi-studio/LoftSurfaceMaterials.ts')
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setSize(innerWidth, innerHeight)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.06
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    document.body.append(renderer.domElement)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x434b50)
    const pmrem = new THREE.PMREMGenerator(renderer), roomEnvironment = new RoomEnvironment()
    const environment = pmrem.fromScene(roomEnvironment)
    scene.environment = environment.texture
    roomEnvironment.dispose(); pmrem.dispose()
    scene.add(new THREE.HemisphereLight(0xfff6e6, 0x354e59, 1.1))
    const key = new THREE.DirectionalLight(0xfff2dc, 3)
    key.position.set(-3, 8, 6); key.castShadow = true; key.shadow.mapSize.set(2048, 2048)
    Object.assign(key.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10 })
    key.shadow.normalBias = 0.02
    scene.add(key)
    const floorMaterial = new THREE.MeshStandardMaterial()
    const surfaces = createLoftSurfaceMaterials(true); surfaces.apply(floorMaterial)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), floorMaterial)
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; floor.receiveShadow = true; scene.add(floor)
    const instance = createRoomKit(true)
    const camera = new THREE.PerspectiveCamera(33, innerWidth / innerHeight, 0.1, 100)
    const items = new THREE.Group(); scene.add(items)
    window.review = {
      THREE, renderer, scene, camera, instance, items, ROOM_ITEMS,
      render() {
        renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight
        const bounds = new THREE.Box3().setFromObject(items).getSize(new THREE.Vector3())
        const distance = Math.max(14, bounds.x / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect) * 1.25)
        camera.position.set(4, 4.7, distance); camera.lookAt(0, 0.95, 0); camera.updateProjectionMatrix()
        renderer.render(scene, camera)
      },
      dispose() { instance.dispose(); surfaces.dispose(); floor.geometry.dispose(); floorMaterial.dispose(); key.dispose(); environment.dispose(); renderer.dispose(); renderer.forceContextLoss() },
    }
  })
  const results = []
  const groups = [
    ['loftArcadeCabinet', 'loftClawMachine', 'loftPinball'],
    ['loftRacingSimulator', 'loftAirHockey', 'loftVrStation'],
    ['loftBasketballArcade', 'loftPrizeCounter', 'loftTokenPusher'],
  ]
  for (const [index, ids] of groups.entries()) {
    const metrics = await page.evaluate(async ({ ids }) => {
      const state = window.review
      state.items.clear()
      for (const [index, id] of ids.entries()) {
        const spec = state.ROOM_ITEMS.find((item) => item.id === id)
        const root = spec.build(state.instance.kit, new state.THREE.Color(spec.tint ?? (index % 2 ? '#4c8783' : '#ae5546')))
        root.position.x = (index - 1) * 3.7
        state.items.add(root)
      }
      const pending = []
      state.items.traverse((node) => { if (node.userData.assetReady) pending.push(node.userData.assetReady) })
      await Promise.all(pending)
      const states = []
      state.items.traverse((node) => { if (node.userData.roomModel) states.push(node.userData.assetState) })
      return { imported: states }
    }, { ids })
    for (const language of ['en', 'he', 'ar']) {
      await page.evaluate(async (language) => {
        document.documentElement.lang = language
        document.documentElement.dir = language === 'en' ? 'ltr' : 'rtl'
        const messages = await (await fetch(`/locales/${language}.json`)).json()
        window.review.instance.kit.setLabels((key) => messages[key] ?? key)
        await document.fonts.ready
        window.review.render()
      }, language)
      await page.screenshot({ path: `${output}/machines-${index}-${language}.png` })
    }
    await page.setViewportSize({ width: 390, height: 844 })
    const pixels = await page.evaluate(() => {
      const state = window.review; state.render()
      const width = state.renderer.domElement.width, height = state.renderer.domElement.height
      const buffer = new Uint8Array(width * height * 4), gl = state.renderer.getContext()
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, buffer)
      const checksum = () => buffer.reduce((sum, value, index) => (sum + value * (index % 31 + 1)) % 2147483647, 0)
      const before = checksum()
      state.items.children[1].rotation.y += Math.PI / 4
      state.items.children[1].position.x += 0.2
      state.items.traverse((node) => node.userData.update?.(3))
      state.render()
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, buffer)
      const colored = buffer.reduce((sum, value, index) => sum + (index % 4 === 0 && Math.max(value, buffer[index + 1], buffer[index + 2]) - Math.min(value, buffer[index + 1], buffer[index + 2]) > 30 ? 1 : 0), 0)
      return { width, height, colored, moved: before !== checksum(), triangles: state.renderer.info.render.triangles, drawCalls: state.renderer.info.render.calls }
    })
    await page.screenshot({ path: `${output}/machines-${index}-mobile.png` })
    results.push({ ids, ...metrics, ...pixels })
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  const roomResult = await page.evaluate(async () => {
    const state = window.review, THREE = state.THREE
    const { createYuviLabRoom } = await import('/src/features/Yuvi-studio/YuviLabRoom.ts')
    const { CREATOR_LOFT_DEFAULT_ITEMS, CREATOR_LOFT_NEW_MACHINES } = await import('/src/features/Yuvi-studio/RoomDesign.ts')
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x262c2e); scene.environment = state.scene.environment
    scene.fog = new THREE.FogExp2(0x262c2e, 0.008)
    scene.add(new THREE.HemisphereLight(0xfff2dc, 0x526674, 0.3))
    const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(5, 10, 15); scene.add(fill)
    const room = createYuviLabRoom(scene, { layoutId: 'creatorLoft', quality: 'high', deckY: -0.92 })
    const items = [...CREATOR_LOFT_DEFAULT_ITEMS, ...CREATOR_LOFT_NEW_MACHINES].map((item) => ({ ...item }))
    room.setUserItems(items)
    const messages = await (await fetch('/locales/he.json')).json()
    document.documentElement.dir = 'rtl'; document.documentElement.lang = 'he'
    room.setLabels((key) => messages[key] ?? key)
    const pending = []; scene.traverse((node) => { if (node.userData.assetReady) pending.push(node.userData.assetReady) }); await Promise.all(pending)
    room.setRoomStyle({ floor: 'wood', wall: 'lab', mood: 'studio' })
    room.setRoomStyle({ floor: 'lab', wall: 'lab', mood: 'studio' })
    const anchor = room.itemAnchor('loft-racing-simulator')?.clone()
    const racer = items.find((item) => item.uid === 'loft-racing-simulator'); racer.x += 1; racer.rot += Math.PI / 4; room.setUserItems(items)
    const changed = room.itemAnchor(racer.uid)
    room.update(2, 1 / 60)
    const camera = new THREE.PerspectiveCamera(67, innerWidth / innerHeight, 0.1, 150)
    state.renderer.setSize(innerWidth, innerHeight)
    camera.position.set(0, 15, 29); camera.lookAt(0, 1, -5); state.renderer.render(scene, camera)
    window.roomReview = { room, scene, camera }
    return { machines: items.length, imported: pending.length, moved: Boolean(anchor && changed && Math.abs(changed.x - anchor.x - 1) < 0.01), lights: scene.children.length, drawCalls: state.renderer.info.render.calls, triangles: state.renderer.info.render.triangles }
  })
  await page.screenshot({ path: `${output}/full-room-desktop.png` })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => {
    const { renderer } = window.review, { scene, camera } = window.roomReview
    renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix()
    camera.position.set(-14, 4, 4); camera.lookAt(-17, 1.2, -8); renderer.render(scene, camera)
  })
  await page.screenshot({ path: `${output}/full-room-mobile.png` })
  const artworkResults = []
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    for (const language of ['en', 'he', 'ar']) {
      const targets = await page.evaluate(async (language) => {
        const { room, scene } = window.roomReview
        const messages = await (await fetch(`/locales/${language}.json`)).json()
        document.documentElement.dir = language === 'en' ? 'ltr' : 'rtl'
        document.documentElement.lang = language
        room.setLabels((key) => messages[key] ?? key)
        const names = []
        scene.traverse((node) => { if (node.name.startsWith('gaming-poster-') || node.name === 'gaming-room-neon-title') names.push(node.name) })
        return names
      }, language)
      if (targets.length !== 9 || new Set(targets).size !== 9) throw new Error('Expected eight unique posters and one main title')
      for (const name of targets) {
        const metrics = await page.evaluate((name) => {
          const { THREE, renderer } = window.review, { scene, camera } = window.roomReview
          const target = scene.getObjectByName(name)
          scene.updateMatrixWorld(true)
          const center = target.getWorldPosition(new THREE.Vector3())
          const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(target.getWorldQuaternion(new THREE.Quaternion()))
          camera.fov = 45; camera.aspect = innerWidth / innerHeight
          const { width, height } = target.geometry.parameters
          const fitDistance = Math.max(height, width / camera.aspect) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.22
          camera.position.copy(center).addScaledVector(normal, fitDistance)
          camera.lookAt(center); camera.updateProjectionMatrix()
          renderer.setSize(innerWidth, innerHeight); renderer.render(scene, camera)
          const gl = renderer.getContext(), pixels = new Uint8Array(innerWidth * innerHeight * 4)
          gl.readPixels(0, 0, innerWidth, innerHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
          let colored = 0
          for (let index = 0; index < pixels.length; index += 4) if (Math.max(...pixels.subarray(index, index + 3)) - Math.min(...pixels.subarray(index, index + 3)) > 35) colored += 1
          const texture = target.material.map.image, context = texture.getContext('2d')
          const artwork = context.getImageData(0, 0, texture.width, texture.height).data
          const checksum = artwork.reduce((sum, value, index) => (sum + value * (index % 31 + 1)) % 2147483647, 0)
          const corners = [[-width / 2, -height / 2], [width / 2, height / 2]].map(([x, y]) => target.localToWorld(new THREE.Vector3(x, y, 0)).project(camera))
          return { colored, checksum, framed: corners.every((point) => Math.abs(point.x) < 1 && Math.abs(point.y) < 1), neonSegments: scene.getObjectByName('gaming-room-neon-tubes').count }
        }, name)
        if (metrics.colored < 1000 || !metrics.framed || metrics.neonSegments < 60) throw new Error(`Artwork verification failed: ${name}`)
        artworkResults.push({ name, language, viewport: viewport.width, ...metrics })
        await page.screenshot({ path: `${output}/${name}-${language}-${viewport.width}.png` })
      }
    }
  }
  const uniqueArtwork = new Set(artworkResults.filter((entry) => entry.language === 'en' && entry.viewport === 1440).map((entry) => entry.checksum))
  if (uniqueArtwork.size !== 9) throw new Error('Poster images unexpectedly duplicated')
  await page.evaluate(() => { window.roomReview.room.dispose(); window.review.dispose() })
  const report = { results, roomResult, artworkResults, errors, output }
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  if (!roomResult.moved || errors.length || results.some((result) => !result.moved || result.colored < 1000 || result.imported.some((state) => state !== 'ready'))) process.exitCode = 1
} finally {
  await browser.close()
}