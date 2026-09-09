import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { GAMING_ROOM_POSTERS, drawGamingPoster, drawGamingRoomNeon, type GamingRoomPoster } from './GamingRoomArtwork.ts'
import { SPORTS_ARENA_ARTWORKS, drawSportsArtwork, type SportsArenaArtwork } from './SportsArtwork.ts'
import { drawSportsGymSign } from './SportsGymSign.ts'

export type LoftPrint = 'gymSign' | 'marquee' | 'neonTitle' | GamingRoomPoster | SportsArenaArtwork | 'race' | 'arcade' | 'pinball' | 'ticket' | 'court' | 'panel'
export type LoftTranslator = (key: string) => string

export function createLoftFabrication(rich: boolean) {
  const resources = new Set<{ dispose(): void }>()
  const track = <Resource extends { dispose(): void }>(resource: Resource) => { resources.add(resource); return resource }
  const materials = new Map<string, THREE.MeshStandardMaterial>()
  const prints = new Map<string, { material: THREE.MeshStandardMaterial; redraw: () => void }>()
  let translate: LoftTranslator = () => ''

  const material = (finish: 'steel' | 'paint' | 'rubber' | 'cloth' | 'glass', color: THREE.ColorRepresentation) => {
    const key = `${finish}:${new THREE.Color(color).getHexString()}`
    const cached = materials.get(key)
    if (cached) return cached
    const textureCanvas = document.createElement('canvas')
    textureCanvas.width = textureCanvas.height = 128
    const context = textureCanvas.getContext('2d')!
    context.fillStyle = '#d8d8d8'
    context.fillRect(0, 0, 128, 128)
    for (let index = 0; index < 160; index += 1) {
      const shade = 130 + (index * 37 % 110)
      context.fillStyle = `rgb(${shade},${shade},${shade})`
      if (finish === 'steel') context.fillRect(0, index % 128, 128, 0.3)
      else context.fillRect(index * 47 % 128, index * 29 % 128, finish === 'cloth' ? 3 : 1, 1)
    }
    const surface = track(new THREE.CanvasTexture(textureCanvas))
    surface.wrapS = surface.wrapT = THREE.RepeatWrapping
    surface.repeat.set(finish === 'cloth' ? 12 : 3, finish === 'cloth' ? 12 : 3)
    const result = track(new THREE.MeshPhysicalMaterial({
      color, metalness: finish === 'steel' ? 0.95 : 0,
      roughness: finish === 'steel' ? 0.34 : finish === 'paint' ? 0.38 : finish === 'glass' ? 0.08 : 0.88,
      roughnessMap: finish === 'glass' ? null : surface,
      bumpMap: finish === 'cloth' || finish === 'rubber' ? surface : null,
      bumpScale: finish === 'cloth' ? 0.009 : 0.002,
      clearcoat: finish === 'paint' ? 0.65 : 0,
      clearcoatRoughness: 0.24,
      transparent: finish === 'glass', opacity: finish === 'glass' ? 0.14 : 1,
      depthWrite: finish !== 'glass', side: finish === 'glass' ? THREE.DoubleSide : THREE.FrontSide,
      envMapIntensity: finish === 'glass' ? 1.4 : 0.7,
    }))
    materials.set(key, result)
    return result
  }
  const mesh = (geometry: THREE.BufferGeometry, surface: THREE.Material, x = 0, y = 0, z = 0) => {
    const result = new THREE.Mesh(track(geometry), surface)
    result.position.set(x, y, z)
    result.castShadow = rich && !(surface.transparent && surface.opacity < 0.5)
    result.receiveShadow = true
    return result
  }
  const box = (width: number, height: number, depth: number, surface: THREE.Material, x = 0, y = 0, z = 0, bevel = 0.015) =>
    mesh(new RoundedBoxGeometry(width, height, depth, rich ? 3 : 1, Math.min(bevel, width / 3, height / 3, depth / 3)), surface, x, y, z)
  const cylinder = (radius: number, height: number, surface: THREE.Material, x = 0, y = 0, z = 0) =>
    mesh(new THREE.CylinderGeometry(radius, radius, height, rich ? 24 : 12), surface, x, y, z)
  const sphere = (radius: number, surface: THREE.Material, x = 0, y = 0, z = 0) =>
    mesh(new THREE.SphereGeometry(radius, rich ? 24 : 12, rich ? 16 : 8), surface, x, y, z)
  const tube = (points: number[][], radius: number, surface: THREE.Material) =>
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point))), rich ? 32 : 16, radius, rich ? 8 : 5, false), surface)
  const profile = (points: number[][], depth: number, surface: THREE.Material) => {
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)))
    shape.closePath()
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: rich ? 3 : 1, steps: 1 })
    geometry.translate(0, 0, -depth / 2)
    return mesh(geometry, surface)
  }
  const print = (kind: LoftPrint, label = '', color = '#32b6b0') => {
    const key = `${kind}:${label}:${color}`
    const cached = prints.get(key)
    if (cached) return cached.material
    const canvas = document.createElement('canvas')
    const isPoster = GAMING_ROOM_POSTERS.includes(kind as GamingRoomPoster)
    const isSportsArtwork = SPORTS_ARENA_ARTWORKS.includes(kind as SportsArenaArtwork)
    const isNeon = kind === 'neonTitle'
    canvas.width = rich ? 1024 : 512
    canvas.height = kind === 'marquee' || kind === 'ticket' || isNeon ? canvas.width / 4 : (isPoster || isSportsArtwork) ? Math.round(canvas.width * 468 / 600) : canvas.width
    if (kind === 'gymSign') canvas.height = Math.round(canvas.width * 2.4 / 5.7)
    const context = canvas.getContext('2d')!
    const texture = track(new THREE.CanvasTexture(canvas))
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = rich ? 4 : 1
    let previous = '\0'
    let previousDirection = ''
    const redraw = () => {
      const text = label ? translate(label) : ''
      const direction = document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr'
      if (text === previous && direction === previousDirection) return
      previous = text
      previousDirection = direction
      const width = canvas.width, height = canvas.height
      context.direction = direction
      if (kind === 'gymSign') {
        drawSportsGymSign(context, width, height, text)
        texture.needsUpdate = true
        return
      }
      if (isPoster || isSportsArtwork || isNeon) {
        if (isPoster) drawGamingPoster(context, kind as GamingRoomPoster, width, height, text)
        else if (isSportsArtwork) drawSportsArtwork(context, kind as SportsArenaArtwork, width, height)
        else drawGamingRoomNeon(context, width, height, text)
        texture.needsUpdate = true
        return
      }
      context.fillStyle = kind === 'ticket' || kind === 'court' ? '#ece9db' : '#10191c'
      context.fillRect(0, 0, width, height)
      context.strokeStyle = color
      context.lineWidth = width * 0.012
      context.strokeRect(width * 0.025, height * 0.08, width * 0.95, height * 0.84)
      if (kind === 'race') {
        context.fillStyle = '#738891'; context.fillRect(0, 0, width, height * 0.45)
        context.fillStyle = '#384849'; context.fillRect(0, height * 0.45, width, height * 0.55)
        context.fillStyle = '#22272b'; context.beginPath(); context.moveTo(width * 0.44, height * 0.45); context.lineTo(width * 0.58, height * 0.45); context.lineTo(width * 0.96, height); context.lineTo(width * 0.05, height); context.fill()
        context.strokeStyle = '#efead8'; context.setLineDash([height * 0.05, height * 0.045]); context.beginPath(); context.moveTo(width * 0.51, height * 0.45); context.lineTo(width * 0.52, height); context.stroke(); context.setLineDash([])
      }
      if (kind === 'arcade') {
        for (let index = 0; index < 36; index += 1) {
          context.fillStyle = ['#d76056', '#e9c661', '#64b6ad'][Math.floor(index / 12)]
          context.fillRect(width * (0.1 + index % 9 * 0.09), height * (0.25 + Math.floor(index / 9) * 0.1), width * 0.073, height * 0.064)
        }
        context.fillStyle = '#eef6ee'; context.fillRect(width * 0.4, height * 0.86, width * 0.2, height * 0.023)
        context.beginPath(); context.arc(width * 0.66, height * 0.73, width * 0.018, 0, Math.PI * 2); context.fill()
      }
      if (kind === 'pinball' || kind === 'panel') {
        context.strokeStyle = color
        for (let index = 0; index < 5; index += 1) { context.beginPath(); context.arc(width * 0.5, height * 0.55, width * (0.12 + index * 0.08), Math.PI * 1.1, Math.PI * 2.85); context.stroke() }
        context.fillStyle = '#e9c661'
        for (let index = 0; index < 18; index += 1) context.fillRect(index * 137 % width, index * 73 % height, 3, 3)
      }
      if (kind === 'court') {
        context.strokeStyle = '#b7534f'; context.beginPath(); context.moveTo(0, height / 2); context.lineTo(width, height / 2); context.stroke()
        context.beginPath(); context.arc(width / 2, height / 2, width * 0.22, 0, Math.PI * 2); context.stroke()
        context.fillStyle = '#6e8084'
        for (let row = 0; row < 30; row += 1) for (let column = 0; column < 18; column += 1) context.fillRect(width * (0.05 + column * 0.05), height * (0.025 + row * 0.032), 1.5, 1.5)
      }
      if (kind === 'ticket') {
        context.fillStyle = '#253438'
        for (let index = 0; index < 48; index += 1) context.fillRect(width * (0.68 + index * 0.0045), height * 0.22, index % 3 + 1, height * 0.56)
        context.setLineDash([5, 5]); context.strokeStyle = '#65706d'; context.beginPath(); context.moveTo(width * 0.63, 0); context.lineTo(width * 0.63, height); context.stroke(); context.setLineDash([])
      }
      if (text) {
        context.direction = document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr'
        context.textAlign = 'center'; context.textBaseline = 'middle'
        let size = kind === 'marquee' ? height * 0.46 : height * 0.12
        const maxWidth = width * (kind === 'ticket' ? 0.53 : 0.85)
        do { context.font = `700 ${size}px sans-serif`; if (context.measureText(text).width <= maxWidth) break; size -= 1 } while (size > 8)
        context.fillStyle = kind === 'ticket' || kind === 'court' ? '#233236' : '#f4efe1'
        context.fillText(text, width * (kind === 'ticket' ? 0.32 : 0.5), kind === 'marquee' || kind === 'ticket' ? height / 2 : height * 0.12)
      }
      texture.needsUpdate = true
    }
    redraw()
    const result = track(new THREE.MeshStandardMaterial({ map: texture, roughness: 0.42, metalness: 0, emissive: kind === 'arcade' || kind === 'race' || kind === 'marquee' ? 0xffffff : 0x000000, emissiveMap: texture, emissiveIntensity: kind === 'marquee' ? 0.55 : 0.35 }))
    if (kind === 'gymSign') {
      result.emissive.setHex(0xffffff)
      result.emissiveIntensity = 0.65
    }
    if (isPoster || isSportsArtwork || isNeon) {
      result.emissive.setHex(0xffffff)
      result.emissiveIntensity = isNeon ? 1.8 : isSportsArtwork ? 0.28 : 0.65
      result.transparent = isNeon
      result.depthWrite = !isNeon
      result.toneMapped = !isNeon
    }
    prints.set(key, { material: result, redraw })
    return result
  }
  const sign = (width: number, height: number, kind: LoftPrint, label: string, color?: string) => mesh(new THREE.PlaneGeometry(width, height), print(kind, label, color))
  return {
    rich, material, mesh, box, cylinder, sphere, tube, profile, print, sign,
    setLabels(next: LoftTranslator) { translate = next; prints.forEach((entry) => entry.redraw()) },
    dispose() { resources.forEach((resource) => resource.dispose()); resources.clear(); prints.clear(); materials.clear() },
  }
}

export type LoftFabrication = ReturnType<typeof createLoftFabrication>