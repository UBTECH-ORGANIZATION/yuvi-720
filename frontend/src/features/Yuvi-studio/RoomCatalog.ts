// @ts-nocheck
/* eslint-disable */
/**
 * Room prop catalog — everything a learner can put in their own room.
 *
 * Same contract as YuviAssets: each entry is a pure procedural builder that
 * returns a self-contained THREE.Group authored in FLOOR-LOCAL space (origin on
 * the floor, +Z toward the front of the room). The room module positions and
 * rotates the group; a builder never touches the scene.
 *
 * House rules:
 *  - geometry and materials come from the shared kit so 60 props do not
 *    allocate 600 GPU objects
 *  - nothing casts a shadow (the room has exactly one shadow-casting light and
 *    it belongs to Yuvi); props are grounded with a blob instead
 *  - anything that glows is emissive/additive geometry, never a real light
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

export type RoomItemCategory = 'seating' | 'desk' | 'play' | 'nature' | 'light' | 'tech' | 'wall'
export type RoomItemPlacement = 'floor' | 'wall'

export interface RoomItemSpec {
  id: string
  category: RoomItemCategory
  placement: RoomItemPlacement
  /** Footprint radius in world units — spacing, the ghost ring and pathfinding. */
  radius: number
  /** Height, used to keep tall props out of the camera's way near the front. */
  height: number
  /** Items the learner can recolour. */
  tintable?: boolean
  /** Default tint for tintable props. */
  tint?: string
  build: (kit: RoomKit, tint: THREE.Color) => THREE.Object3D
}

export type MatKind =
  | 'matte' | 'gloss' | 'metal' | 'wood' | 'fabric' | 'glass' | 'dark' | 'leaf' | 'emissive'

export interface RoomKit {
  rich: boolean
  mat: (kind: MatKind, color?: THREE.ColorRepresentation) => THREE.Material
  box: (w: number, h: number, d: number, mat: THREE.Material) => THREE.Mesh
  rbox: (w: number, h: number, d: number, r: number, mat: THREE.Material) => THREE.Mesh
  cyl: (rTop: number, rBot: number, h: number, mat: THREE.Material, seg?: number, open?: boolean) => THREE.Mesh
  sph: (r: number, mat: THREE.Material) => THREE.Mesh
  tor: (r: number, tube: number, mat: THREE.Material) => THREE.Mesh
  plane: (w: number, h: number, mat: THREE.Material) => THREE.Mesh
  cone: (r: number, h: number, mat: THREE.Material) => THREE.Mesh
  /** Cached translucent material. Builders must never mutate a shared one. */
  sheer: (color: THREE.ColorRepresentation, opacity: number, glowing?: boolean) => THREE.Material
  /** Additive halo quad — the cheap way to make something read as lit. */
  halo: (size: number, color: THREE.ColorRepresentation, opacity?: number) => THREE.Mesh
}

/* ── shared kit ─────────────────────────────────────────────────────────────
   One kit per room instance. It owns every geometry/material it hands out and
   returns a disposer, so the room's own dispose() stays a one-liner. */
export function createRoomKit(rich: boolean): { kit: RoomKit; dispose: () => void } {
  const disposables: Array<{ dispose: () => void }> = []
  const geoCache = new Map<string, THREE.BufferGeometry>()
  const matCache = new Map<string, THREE.Material>()

  const geo = <T extends THREE.BufferGeometry>(key: string, make: () => T): T => {
    let cached = geoCache.get(key) as T | undefined
    if (!cached) {
      cached = make()
      geoCache.set(key, cached)
      disposables.push(cached)
    }
    return cached
  }

  const mat: RoomKit['mat'] = (kind, color = 0xffffff) => {
    const hex = new THREE.Color(color).getHexString()
    const key = `${kind}|${hex}`
    let cached = matCache.get(key)
    if (cached) return cached
    switch (kind) {
      case 'gloss':
        cached = new THREE.MeshPhysicalMaterial({ color, roughness: 0.18, metalness: 0.08, clearcoat: 0.9, clearcoatRoughness: 0.16, envMapIntensity: 0.9 })
        break
      case 'metal':
        cached = new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0.94, clearcoat: 0.35, envMapIntensity: 1 })
        break
      case 'wood':
        cached = new THREE.MeshStandardMaterial({ color, roughness: 0.76, metalness: 0.03, envMapIntensity: 0.3 })
        break
      case 'fabric':
        cached = new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0, envMapIntensity: 0.2 })
        break
      case 'glass':
        cached = new THREE.MeshPhysicalMaterial({ color, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, clearcoat: 1, envMapIntensity: 1.6, side: THREE.DoubleSide })
        break
      case 'dark':
        cached = new THREE.MeshStandardMaterial({ color, roughness: 0.66, metalness: 0.4, envMapIntensity: 0.35 })
        break
      case 'leaf':
        cached = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0, envMapIntensity: 0.35, side: THREE.DoubleSide })
        break
      case 'emissive':
        cached = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5, roughness: 0.35, toneMapped: false })
        break
      default:
        cached = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.08, envMapIntensity: 0.45 })
    }
    matCache.set(key, cached)
    disposables.push(cached)
    return cached
  }

  // One shared radial sprite for every halo in the room.
  const haloTex = (() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 96
    const ctx = canvas.getContext('2d')!
    const gradient = ctx.createRadialGradient(48, 48, 0, 48, 48, 48)
    gradient.addColorStop(0, 'rgba(255,255,255,0.85)')
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.22)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 96, 96)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    disposables.push(texture)
    return texture
  })()

  const kit: RoomKit = {
    rich,
    mat,
    box: (w, h, d, material) => new THREE.Mesh(geo(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d)), material),
    rbox: (w, h, d, r, material) => new THREE.Mesh(geo(`r${w}|${h}|${d}|${r}`, () => new RoundedBoxGeometry(w, h, d, rich ? 3 : 1, r)), material),
    cyl: (rTop, rBot, h, material, seg = 18, open = false) =>
      new THREE.Mesh(geo(`c${rTop}|${rBot}|${h}|${seg}|${open}`, () => new THREE.CylinderGeometry(rTop, rBot, h, rich ? seg : Math.max(6, seg >> 1), 1, open)), material),
    sph: (r, material) => new THREE.Mesh(geo(`s${r}`, () => new THREE.SphereGeometry(r, rich ? 20 : 10, rich ? 14 : 8)), material),
    tor: (r, tube, material) => new THREE.Mesh(geo(`t${r}|${tube}`, () => new THREE.TorusGeometry(r, tube, rich ? 10 : 6, rich ? 28 : 14)), material),
    plane: (w, h, material) => new THREE.Mesh(geo(`p${w}|${h}`, () => new THREE.PlaneGeometry(w, h)), material),
    cone: (r, h, material) => new THREE.Mesh(geo(`n${r}|${h}`, () => new THREE.ConeGeometry(r, h, rich ? 18 : 9)), material),
    sheer: (color, opacity, glowing = false) => {
      const key = `sheer|${new THREE.Color(color).getHexString()}|${opacity}|${glowing}`
      let cached = matCache.get(key)
      if (cached) return cached
      cached = new THREE.MeshStandardMaterial({
        color,
        emissive: glowing ? color : 0x000000,
        emissiveIntensity: glowing ? 1.4 : 0,
        transparent: true,
        opacity,
        depthWrite: false,
        roughness: 0.3,
        side: THREE.DoubleSide,
        toneMapped: !glowing,
      })
      matCache.set(key, cached)
      disposables.push(cached)
      return cached
    },
    halo: (size, color, opacity = 0.5) => {
      const material = new THREE.MeshBasicMaterial({
        map: haloTex, color, transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      })
      disposables.push(material)
      return new THREE.Mesh(geo(`p${size}|${size}`, () => new THREE.PlaneGeometry(size, size)), material)
    },
  }

  return {
    kit,
    dispose: () => {
      for (const item of disposables) item.dispose?.()
      disposables.length = 0
      geoCache.clear()
      matCache.clear()
    },
  }
}

/* ── palette ──────────────────────────────────────────────────────────────── */
const OAK = 0x9a6b40
const DARKWOOD = 0x4a2f1d
const STEEL = 0x8e96b8
const CHARCOAL = 0x232743
const CREAM = 0xf3ecdd
const LEAF = 0x3fa96a
const LEAF_DEEP = 0x1f7a4a

const at = (obj: THREE.Object3D, x: number, y: number, z: number) => { obj.position.set(x, y, z); return obj }
const flat = (mesh: THREE.Mesh) => { mesh.rotation.x = -Math.PI / 2; return mesh }

/* ── catalog ────────────────────────────────────────────────────────────────
   Every entry answers "what would a kid actually want in their room?" — the
   list is deliberately long, because the whole point of the room is that two
   learners' rooms should not look alike. */
export const ROOM_ITEMS: RoomItemSpec[] = [
  /* ── seating ─────────────────────────────────────────────────────────── */
  {
    id: 'rug', category: 'seating', placement: 'floor', radius: 1.1, height: 0.03,
    tintable: true, tint: '#7C6BFF',
    build: (kit, tint) => {
      const group = new THREE.Group()
      // A cylinder is already flat-on to the floor; only the inner disc needs laying down.
      group.add(at(kit.cyl(1, 1, 0.02, kit.mat('fabric', tint), 32), 0, 0.01, 0))
      const inner = flat(kit.plane(1.2, 1.2, kit.mat('fabric', new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.45))))
      group.add(at(inner, 0, 0.025, 0))
      return group
    },
  },
  {
    id: 'beanbag', category: 'seating', placement: 'floor', radius: 0.55, height: 0.6,
    tintable: true, tint: '#ff8fd0',
    build: (kit, tint) => {
      const group = new THREE.Group()
      const body = kit.sph(0.5, kit.mat('fabric', tint))
      body.scale.set(1, 0.66, 1)
      at(body, 0, 0.3, 0)
      group.add(body)
      const top = kit.sph(0.3, kit.mat('fabric', new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.2)))
      top.scale.set(1, 0.6, 1)
      at(top, 0, 0.54, -0.1)
      group.add(top)
      return group
    },
  },
  {
    id: 'couch', category: 'seating', placement: 'floor', radius: 1, height: 0.8,
    tintable: true, tint: '#4c6fff',
    build: (kit, tint) => {
      const group = new THREE.Group()
      const fabric = kit.mat('fabric', tint)
      group.add(at(kit.rbox(1.7, 0.34, 0.75, 0.1, fabric), 0, 0.3, 0))
      group.add(at(kit.rbox(1.7, 0.55, 0.2, 0.08, fabric), 0, 0.6, -0.3))
      for (const sx of [-0.82, 0.82]) group.add(at(kit.rbox(0.18, 0.5, 0.75, 0.07, fabric), sx, 0.42, 0))
      for (const sx of [-0.5, 0.5]) {
        const cushion = at(kit.rbox(0.32, 0.32, 0.1, 0.06, kit.mat('fabric', CREAM)), sx, 0.62, -0.16)
        cushion.rotation.x = 0.2
        group.add(cushion)
      }
      for (const [sx, sz] of [[-0.7, 0.3], [0.7, 0.3], [-0.7, -0.3], [0.7, -0.3]]) {
        group.add(at(kit.cyl(0.05, 0.05, 0.13, kit.mat('wood', DARKWOOD), 10), sx, 0.065, sz))
      }
      return group
    },
  },
  {
    id: 'gamingChair', category: 'seating', placement: 'floor', radius: 0.42, height: 1.15,
    tintable: true, tint: '#ff5d73',
    build: (kit, tint) => {
      const group = new THREE.Group()
      const shell = kit.mat('gloss', tint)
      const dark = kit.mat('dark', CHARCOAL)
      group.add(at(kit.cyl(0.05, 0.05, 0.4, kit.mat('metal', STEEL), 12), 0, 0.2, 0))
      for (let i = 0; i < 5; i++) {
        const leg = at(kit.box(0.34, 0.04, 0.07, dark), 0, 0.04, 0)
        leg.rotation.y = (i / 5) * Math.PI * 2
        leg.position.x = Math.cos(leg.rotation.y) * 0.17
        leg.position.z = Math.sin(leg.rotation.y) * 0.17
        group.add(leg)
      }
      group.add(at(kit.rbox(0.52, 0.1, 0.5, 0.06, shell), 0, 0.45, 0))
      const back = at(kit.rbox(0.5, 0.78, 0.12, 0.06, shell), 0, 0.86, -0.22)
      back.rotation.x = -0.14
      group.add(back)
      group.add(at(kit.rbox(0.34, 0.14, 0.1, 0.05, dark), 0, 1.2, -0.28))
      for (const sx of [-0.3, 0.3]) group.add(at(kit.rbox(0.08, 0.06, 0.34, 0.03, dark), sx, 0.62, -0.02))
      return group
    },
  },
  {
    id: 'cushions', category: 'seating', placement: 'floor', radius: 0.5, height: 0.2,
    tintable: true, tint: '#ffd166',
    build: (kit, tint) => {
      const group = new THREE.Group()
      const shades = [tint, new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.35), new THREE.Color(tint).lerp(new THREE.Color(0x000000), 0.2)]
      const spots = [[-0.26, 0.1], [0.24, -0.14], [0.02, 0.3]]
      spots.forEach(([x, z], i) => {
        const cushion = at(kit.rbox(0.42, 0.14, 0.42, 0.07, kit.mat('fabric', shades[i])), x, 0.08, z)
        cushion.rotation.y = i * 0.7
        group.add(cushion)
      })
      return group
    },
  },
  {
    id: 'hammock', category: 'seating', placement: 'floor', radius: 1.1, height: 1.5,
    tintable: true, tint: '#4ecdc4',
    build: (kit, tint) => {
      const group = new THREE.Group()
      const wood = kit.mat('wood', OAK)
      for (const sx of [-1, 1]) {
        const post = at(kit.cyl(0.05, 0.07, 1.4, wood, 10), sx, 0.7, 0)
        post.rotation.z = sx * 0.12
        group.add(post)
        group.add(at(kit.box(0.5, 0.07, 0.5, wood), sx, 0.035, 0))
      }
      const sling = at(kit.cyl(0.34, 0.34, 1.7, kit.mat('fabric', tint), 20, true), 0, 0.78, 0)
      sling.rotation.z = Math.PI / 2
      sling.scale.set(1, 1, 0.5)
      group.add(sling)
      return group
    },
  },

  /* ── desk & learning ─────────────────────────────────────────────────── */
  {
    id: 'desk', category: 'desk', placement: 'floor', radius: 0.85, height: 0.78,
    build: (kit) => {
      const group = new THREE.Group()
      const wood = kit.mat('wood', OAK)
      group.add(at(kit.rbox(1.5, 0.07, 0.7, 0.03, wood), 0, 0.75, 0))
      for (const [sx, sz] of [[-0.68, 0.28], [0.68, 0.28], [-0.68, -0.28], [0.68, -0.28]]) {
        group.add(at(kit.cyl(0.035, 0.045, 0.72, kit.mat('metal', STEEL), 10), sx, 0.36, sz))
      }
      group.add(at(kit.rbox(0.5, 0.34, 0.5, 0.04, kit.mat('matte', CHARCOAL)), 0.42, 0.94, -0.1))
      const screen = at(kit.plane(0.44, 0.28, kit.mat('emissive', 0x63d8ff)), 0.42, 0.96, 0.152)
      group.add(screen)
      group.add(at(kit.rbox(0.34, 0.02, 0.16, 0.01, kit.mat('matte', 0xe6e9f7)), -0.3, 0.79, 0.16))
      return group
    },
  },
  {
    id: 'bookshelf', category: 'desk', placement: 'floor', radius: 0.55, height: 1.7,
    tintable: true, tint: '#9a6b40',
    build: (kit, tint) => {
      const group = new THREE.Group()
      const wood = kit.mat('wood', tint)
      group.add(at(kit.box(1, 0.05, 0.34, wood), 0, 1.68, 0))
      for (const sx of [-0.48, 0.48]) group.add(at(kit.box(0.05, 1.7, 0.34, wood), sx, 0.85, 0))
      const bookColors = [0xff5d73, 0x4eeef0, 0xffd166, 0x7c5cff, 0x5ce67e, 0xff8fd0]
      for (let shelf = 0; shelf < 4; shelf++) {
        const y = 0.34 + shelf * 0.42
        group.add(at(kit.box(0.96, 0.04, 0.34, wood), 0, y, 0))
        const count = 5 + (shelf % 3)
        for (let i = 0; i < count; i++) {
          const h = 0.22 + ((i * 7 + shelf * 3) % 5) * 0.02
          const book = at(kit.box(0.06, h, 0.22, kit.mat('matte', bookColors[(i + shelf) % bookColors.length])), -0.4 + i * 0.085, y + 0.02 + h / 2, 0)
          book.rotation.z = i === count - 1 ? 0.28 : 0
          group.add(book)
        }
      }
      return group
    },
  },
  {
    id: 'whiteboard', category: 'desk', placement: 'floor', radius: 0.6, height: 1.6,
    build: (kit) => {
      const group = new THREE.Group()
      const steel = kit.mat('metal', STEEL)
      for (const sx of [-0.55, 0.55]) {
        group.add(at(kit.cyl(0.03, 0.03, 0.9, steel, 8), sx, 0.45, 0))
        group.add(at(kit.box(0.08, 0.04, 0.5, steel), sx, 0.03, 0))
      }
      group.add(at(kit.rbox(1.3, 0.78, 0.05, 0.03, kit.mat('gloss', 0xf7f9ff)), 0, 1.2, 0))
      group.add(at(kit.plane(1.1, 0.6, kit.sheer(0x7c5cff, 0.16, true)), 0, 1.2, 0.031))
      return group
    },
  },
  {
    id: 'deskLamp', category: 'desk', placement: 'floor', radius: 0.3, height: 1.3,
    tintable: true, tint: '#ffd166',
    build: (kit, tint) => {
      const group = new THREE.Group()
      const steel = kit.mat('metal', 0x39406e)
      group.add(at(kit.cyl(0.16, 0.2, 0.05, steel, 16), 0, 0.025, 0))
      const stem = at(kit.cyl(0.02, 0.02, 1.05, steel, 8), 0, 0.57, 0)
      stem.rotation.z = 0.08
      group.add(stem)
      const shade = at(kit.cone(0.19, 0.24, kit.mat('gloss', tint)), 0.14, 1.14, 0)
      shade.rotation.z = Math.PI + 0.5
      group.add(shade)
      const bulb = at(kit.sph(0.06, kit.mat('emissive', 0xfff2cc)), 0.17, 1.03, 0)
      group.add(bulb)
      const glow = at(flat(kit.halo(1.5, 0xffe6b0, 0.28)), 0.2, 0.02, 0)
      group.add(glow)
      return group
    },
  },
  {
    id: 'globe', category: 'desk', placement: 'floor', radius: 0.32, height: 1.05,
    build: (kit) => {
      const group = new THREE.Group()
      const wood = kit.mat('wood', DARKWOOD)
      group.add(at(kit.cyl(0.2, 0.26, 0.06, wood, 16), 0, 0.03, 0))
      group.add(at(kit.cyl(0.03, 0.03, 0.62, wood, 8), 0, 0.37, 0))
      const ball = at(kit.sph(0.24, kit.mat('gloss', 0x2f6fd0)), 0, 0.84, 0)
      group.add(ball)
      for (let i = 0; i < 4; i++) {
        const land = at(kit.sph(0.09, kit.mat('matte', LEAF)), 0, 0.84, 0)
        land.scale.set(1.1, 0.6, 0.5)
        land.position.set(Math.cos(i * 1.7) * 0.2, 0.84 + Math.sin(i * 2.3) * 0.12, Math.sin(i * 1.7) * 0.2)
        group.add(land)
      }
      const ring = at(kit.tor(0.29, 0.015, kit.mat('metal', 0xd8c48a)), 0, 0.84, 0)
      ring.rotation.y = Math.PI / 2
      ring.rotation.x = 0.4
      group.add(ring)
      return group
    },
  },
  {
    id: 'storage', category: 'desk', placement: 'floor', radius: 0.55, height: 0.8,
    tintable: true, tint: '#4cc9f0',
    build: (kit, tint) => {
      const group = new THREE.Group()
      const frame = kit.mat('wood', CREAM)
      const bins = [tint, new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.4), new THREE.Color(tint).lerp(new THREE.Color(0x000000), 0.25)]
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 2; col++) {
          const x = -0.2 + col * 0.4
          const y = 0.2 + row * 0.4
          group.add(at(kit.rbox(0.4, 0.4, 0.4, 0.02, frame), x, y, 0))
          group.add(at(kit.rbox(0.32, 0.3, 0.32, 0.04, kit.mat('matte', bins[(row + col) % 3])), x, y - 0.02, 0.03))
        }
      }
      return group
    },
  },

  /* ── play ────────────────────────────────────────────────────────────── */
  {
    id: 'arcade', category: 'play', placement: 'floor', radius: 0.5, height: 1.85,
    tintable: true, tint: '#7c5cff',
    build: (kit, tint) => {
      const group = new THREE.Group()
      const shell = kit.mat('gloss', tint)
      group.add(at(kit.rbox(0.8, 1.5, 0.66, 0.06, shell), 0, 0.75, 0))
      group.add(at(kit.rbox(0.86, 0.34, 0.2, 0.05, shell), 0, 1.68, -0.1))
      const marquee = at(kit.plane(0.7, 0.22, kit.mat('emissive', 0xff5d73)), 0, 1.68, 0.01)
      group.add(marquee)
      const screen = at(kit.plane(0.6, 0.46, kit.mat('emissive', 0x4eeef0)), 0, 1.16, 0.335)
      group.add(screen)
      const panel = at(kit.rbox(0.74, 0.06, 0.3, 0.03, kit.mat('dark', CHARCOAL)), 0, 0.9, 0.28)
      panel.rotation.x = -0.32
      group.add(panel)
      group.add(at(kit.cyl(0.02, 0.02, 0.16, kit.mat('metal', STEEL), 8), -0.16, 0.99, 0.3))
      group.add(at(kit.sph(0.05, kit.mat('gloss', 0xff5d73)), -0.16, 1.07, 0.3))
      for (let i = 0; i < 3; i++) group.add(at(kit.cyl(0.035, 0.035, 0.03, kit.mat('emissive', [0xffd166, 0x4eeef0, 0x5ce67e][i]), 12), 0.06 + i * 0.11, 0.94, 0.3))
      group.add(at(flat(kit.halo(1.6, tint, 0.3)), 0, 0.02, 0.1))
      return group
    },
  },
  {
    id: 'hoop', category: 'play', placement: 'floor', radius: 0.6, height: 2.3,
    build: (kit) => {
      const group = new THREE.Group()
      const steel = kit.mat('metal', STEEL)
      group.add(at(kit.cyl(0.06, 0.09, 2.05, steel, 12), 0, 1.02, -0.2))
      group.add(at(kit.cyl(0.4, 0.46, 0.07, kit.mat('dark', CHARCOAL), 18), 0, 0.035, -0.2))
      group.add(at(kit.rbox(1, 0.66, 0.05, 0.02, kit.mat('gloss', 0xf7f9ff)), 0, 1.94, -0.14))
      group.add(at(kit.plane(0.42, 0.34, kit.sheer(0xff5d73, 0.5, true)), 0, 1.88, -0.11))
      const rim = at(kit.tor(0.21, 0.022, kit.mat('emissive', 0xff7a3d)), 0, 1.72, 0.1)
      rim.rotation.x = Math.PI / 2
      group.add(rim)
      const net = at(kit.cyl(0.2, 0.12, 0.3, kit.mat('glass', 0xffffff), 14, true), 0, 1.57, 0.1)
      group.add(net)
      return group
    },
  },
  {
    id: 'skate', category: 'play', placement: 'floor', radius: 0.45, height: 0.75,
    tintable: true, tint: '#ff7a3d',
    build: (kit, tint) => {
      const group = new THREE.Group()
      const deck = at(kit.rbox(0.24, 0.04, 0.86, 0.02, kit.mat('gloss', tint)), 0, 0.42, 0)
      deck.rotation.x = 0.24
      deck.rotation.z = 0.12
      group.add(deck)
      for (const sz of [-0.28, 0.28]) {
        const axle = at(kit.cyl(0.03, 0.03, 0.24, kit.mat('metal', STEEL), 10), 0.06, 0.42 - sz * 0.24, sz * 0.92)
        axle.rotation.z = Math.PI / 2
        group.add(axle)
      }
      group.add(at(kit.rbox(0.3, 0.5, 0.3, 0.06, kit.mat('matte', CHARCOAL)), 0.34, 0.2, 0.1))
      return group
    },
  },
  {
    id: 'goal', category: 'play', placement: 'floor', radius: 0.85, height: 1,
    build: (kit) => {
      const group = new THREE.Group()
      const bar = kit.mat('gloss', 0xf7f9ff)
      const crossbar = at(kit.cyl(0.045, 0.045, 1.6, bar, 10), 0, 0.92, -0.1)
      crossbar.rotation.z = Math.PI / 2
      group.add(crossbar)
      for (const sx of [-0.8, 0.8]) group.add(at(kit.cyl(0.045, 0.045, 0.92, bar, 10), sx, 0.46, -0.1))
      group.add(at(kit.plane(1.6, 0.92, kit.sheer(0xdfe6ff, 0.3)), 0, 0.46, -0.34))
      group.add(at(kit.sph(0.13, kit.mat('gloss', 0xffffff)), 0.5, 0.13, 0.6))
      for (let i = 0; i < 5; i++) {
        const patch = at(kit.sph(0.05, kit.mat('matte', CHARCOAL)), 0.5, 0.13, 0.6)
        patch.scale.set(1, 1, 0.35)
        patch.position.add(new THREE.Vector3(Math.cos(i * 1.3) * 0.1, Math.sin(i * 2.1) * 0.1, Math.sin(i * 1.3) * 0.1))
        group.add(patch)
      }
      return group
    },
  },
  {
    id: 'drums', category: 'play', placement: 'floor', radius: 0.7, height: 0.95,
    tintable: true, tint: '#e63946',
    build: (kit, tint) => {
      const group = new THREE.Group()
      const shell = kit.mat('gloss', tint)
      const skin = kit.mat('matte', CREAM)
      const chrome = kit.mat('metal', 0xd7dcf0)
      group.add(at(kit.cyl(0.36, 0.36, 0.44, shell, 22), 0, 0.24, 0))
      const face = at(kit.cyl(0.36, 0.36, 0.02, skin, 22), 0, 0.24, 0.22)
      face.rotation.x = Math.PI / 2
      group.add(face)
      for (const [x, z, r] of [[-0.34, -0.3, 0.16], [0.34, -0.3, 0.18]]) {
        group.add(at(kit.cyl(r, r, 0.24, shell, 16), x, 0.62, z))
        group.add(at(kit.cyl(r, r, 0.02, skin, 16), x, 0.74, z))
      }
      for (const [x, z, tilt] of [[-0.6, 0.14, -0.24], [0.62, 0.1, 0.2]]) {
        group.add(at(kit.cyl(0.012, 0.012, 0.8, chrome, 8), x, 0.4, z))
        const cymbal = at(kit.cyl(0.22, 0.2, 0.012, kit.mat('metal', 0xe8c86a), 20), x, 0.82, z)
        cymbal.rotation.z = tilt
        group.add(cymbal)
      }
      return group
    },
  },
  {
    id: 'guitar', category: 'play', placement: 'floor', radius: 0.35, height: 1.15,
    tintable: true, tint: '#f4a261',
    build: (kit, tint) => {
      const group = new THREE.Group()
      // Leaned against an invisible wall, the way a guitar actually stands.
      const lean = new THREE.Group()
      lean.rotation.z = 0.16
      group.add(lean)
      const body = at(kit.sph(0.26, kit.mat('gloss', tint)), 0, 0.32, 0)
      body.scale.set(1, 1.1, 0.34)
      lean.add(body)
      const hole = at(kit.cyl(0.08, 0.08, 0.01, kit.mat('dark', 0x120c22), 16), 0, 0.36, 0.09)
      hole.rotation.x = Math.PI / 2
      lean.add(hole)
      lean.add(at(kit.box(0.09, 0.62, 0.05, kit.mat('wood', DARKWOOD)), 0, 0.86, 0.01))
      lean.add(at(kit.box(0.12, 0.14, 0.05, kit.mat('wood', 0x2a1a10)), 0, 1.2, 0.01))
      return group
    },
  },
  {
    id: 'chess', category: 'play', placement: 'floor', radius: 0.5, height: 0.72,
    build: (kit) => {
      const group = new THREE.Group()
      const wood = kit.mat('wood', DARKWOOD)
      group.add(at(kit.cyl(0.06, 0.16, 0.62, wood, 12), 0, 0.31, 0))
      group.add(at(kit.rbox(0.66, 0.06, 0.66, 0.02, kit.mat('wood', OAK)), 0, 0.66, 0))
      const dark = kit.mat('matte', 0x2b2440)
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          if ((i + j) % 2) continue
          group.add(at(kit.plane(0.075, 0.075, dark), -0.2625 + i * 0.075, 0.6905, -0.2625 + j * 0.075).rotateX(-Math.PI / 2))
        }
      }
      for (let i = 0; i < 6; i++) {
        const white = i % 2 === 0
        const piece = at(kit.cyl(0.018, 0.03, 0.09, kit.mat('gloss', white ? CREAM : 0x2b2440), 10), -0.2 + i * 0.08, 0.74, white ? -0.16 : 0.16)
        group.add(piece)
        group.add(at(kit.sph(0.026, kit.mat('gloss', white ? CREAM : 0x2b2440)), piece.position.x, 0.795, piece.position.z))
      }
      return group
    },
  },
  {
    id: 'trampoline', category: 'play', placement: 'floor', radius: 0.9, height: 0.5,
    tintable: true, tint: '#5ce67e',
    build: (kit, tint) => {
      const group = new THREE.Group()
      const steel = kit.mat('metal', STEEL)
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        group.add(at(kit.cyl(0.03, 0.03, 0.42, steel, 8), Math.cos(a) * 0.72, 0.21, Math.sin(a) * 0.72))
      }
      group.add(at(kit.tor(0.8, 0.06, kit.mat('gloss', tint)), 0, 0.44, 0).rotateX(Math.PI / 2))
      group.add(at(kit.cyl(0.76, 0.76, 0.02, kit.mat('dark', 0x1b1a33), 26), 0, 0.42, 0))
      return group
    },
  },

  /* ── nature ──────────────────────────────────────────────────────────── */
  {
    id: 'plant', category: 'nature', placement: 'floor', radius: 0.34, height: 0.9,
    tintable: true, tint: '#3fa96a',
    build: (kit, tint) => {
      const group = new THREE.Group()
      group.add(at(kit.cyl(0.2, 0.15, 0.28, kit.mat('matte', 0xd9714f), 16), 0, 0.14, 0))
      group.add(at(kit.cyl(0.21, 0.21, 0.05, kit.mat('matte', 0xc46143), 16), 0, 0.29, 0))
      const leafMat = kit.mat('leaf', tint)
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + i * 0.4
        const leaf = at(kit.sph(0.16, leafMat), Math.cos(a) * 0.14, 0.42 + (i % 3) * 0.16, Math.sin(a) * 0.14)
        leaf.scale.set(0.42, 1.5, 0.22)
        leaf.rotation.z = Math.cos(a) * 0.5
        leaf.rotation.x = Math.sin(a) * 0.5
        group.add(leaf)
      }
      return group
    },
  },
  {
    id: 'palm', category: 'nature', placement: 'floor', radius: 0.5, height: 1.9,
    build: (kit) => {
      const group = new THREE.Group()
      group.add(at(kit.cyl(0.24, 0.3, 0.34, kit.mat('matte', 0xb9835e), 16), 0, 0.17, 0))
      const trunk = at(kit.cyl(0.07, 0.11, 1.4, kit.mat('wood', 0x7a5433), 12), 0, 1.02, 0)
      trunk.rotation.z = 0.06
      group.add(trunk)
      const leafMat = kit.mat('leaf', LEAF_DEEP)
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2
        const frond = at(kit.sph(0.4, leafMat), Math.cos(a) * 0.3, 1.72, Math.sin(a) * 0.3)
        frond.scale.set(1.05, 0.13, 0.36)
        frond.rotation.y = -a
        frond.rotation.z = -0.32
        group.add(frond)
      }
      return group
    },
  },
  {
    id: 'cactus', category: 'nature', placement: 'floor', radius: 0.28, height: 0.85,
    build: (kit) => {
      const group = new THREE.Group()
      group.add(at(kit.cyl(0.17, 0.14, 0.24, kit.mat('matte', 0xe6c27a), 14), 0, 0.12, 0))
      const flesh = kit.mat('matte', 0x4f9d5d)
      group.add(at(kit.cyl(0.11, 0.12, 0.56, flesh, 14), 0, 0.5, 0))
      group.add(at(kit.sph(0.11, flesh), 0, 0.78, 0))
      for (const side of [-1, 1]) {
        const arm = at(kit.cyl(0.055, 0.055, 0.24, flesh, 10), 0.15 * side, 0.55, 0)
        arm.rotation.z = Math.PI / 2
        group.add(arm)
        group.add(at(kit.cyl(0.055, 0.055, 0.2, flesh, 10), 0.26 * side, 0.65, 0))
        group.add(at(kit.sph(0.055, flesh), 0.26 * side, 0.75, 0))
      }
      group.add(at(kit.sph(0.05, kit.mat('matte', 0xff8fd0)), 0, 0.87, 0))
      return group
    },
  },
  {
    id: 'aquarium', category: 'nature', placement: 'floor', radius: 0.6, height: 1.05,
    build: (kit) => {
      const group = new THREE.Group()
      group.add(at(kit.rbox(1.05, 0.5, 0.45, 0.03, kit.mat('wood', DARKWOOD)), 0, 0.25, 0))
      group.add(at(kit.rbox(1, 0.48, 0.42, 0.02, kit.mat('glass', 0x9fd8ff)), 0, 0.76, 0))
      group.add(at(kit.box(0.96, 0.4, 0.38, kit.sheer(0x2f8fd0, 0.35)), 0, 0.73, 0))
      group.add(at(kit.box(0.96, 0.06, 0.38, kit.mat('matte', 0xe6d3a3)), 0, 0.55, 0))
      for (let i = 0; i < 4; i++) {
        const weed = at(kit.cyl(0.012, 0.02, 0.24, kit.mat('leaf', LEAF), 6), -0.34 + i * 0.22, 0.7, -0.05)
        weed.rotation.z = Math.sin(i) * 0.3
        group.add(weed)
      }
      for (let i = 0; i < 3; i++) {
        const fish = at(kit.sph(0.05, kit.mat('emissive', [0xff8f3d, 0xffd166, 0xff5d73][i])), -0.2 + i * 0.24, 0.7 + i * 0.08, 0.05)
        fish.scale.set(1.4, 0.9, 0.5)
        group.add(fish)
      }
      group.add(at(kit.rbox(1.02, 0.05, 0.44, 0.02, kit.mat('dark', CHARCOAL)), 0, 1.02, 0))
      return group
    },
  },
  {
    id: 'bonsai', category: 'nature', placement: 'floor', radius: 0.3, height: 0.72,
    build: (kit) => {
      const group = new THREE.Group()
      group.add(at(kit.rbox(0.44, 0.14, 0.34, 0.03, kit.mat('matte', 0x6b4a7a)), 0, 0.07, 0))
      const trunk = at(kit.cyl(0.035, 0.06, 0.34, kit.mat('wood', 0x54351f), 10), 0, 0.31, 0)
      trunk.rotation.z = -0.2
      group.add(trunk)
      const canopy = kit.mat('leaf', LEAF_DEEP)
      for (const [x, y, z, s] of [[-0.14, 0.55, 0, 1], [0.12, 0.62, 0.04, 0.8], [0.02, 0.5, -0.1, 0.7]]) {
        const puff = at(kit.sph(0.17 * s, canopy), x, y, z)
        puff.scale.set(1.2, 0.6, 1.1)
        group.add(puff)
      }
      return group
    },
  },
  {
    id: 'flowers', category: 'nature', placement: 'floor', radius: 0.55, height: 0.5,
    tintable: true, tint: '#ff8fd0',
    build: (kit, tint) => {
      const group = new THREE.Group()
      group.add(at(kit.rbox(1.05, 0.2, 0.32, 0.03, kit.mat('wood', OAK)), 0, 0.1, 0))
      group.add(at(kit.box(0.98, 0.06, 0.26, kit.mat('matte', 0x3a2a1c)), 0, 0.2, 0))
      const stem = kit.mat('leaf', LEAF)
      const petals = [tint, new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.4), new THREE.Color(0xffd166)]
      for (let i = 0; i < 7; i++) {
        const x = -0.42 + i * 0.14
        const h = 0.2 + (i % 3) * 0.06
        group.add(at(kit.cyl(0.012, 0.012, h, stem, 6), x, 0.22 + h / 2, (i % 2) * 0.08 - 0.04))
        const head = at(kit.sph(0.06, kit.mat('matte', petals[i % 3])), x, 0.24 + h, (i % 2) * 0.08 - 0.04)
        head.scale.set(1, 0.7, 1)
        group.add(head)
      }
      return group
    },
  },
  {
    id: 'stump', category: 'nature', placement: 'floor', radius: 0.4, height: 0.45,
    build: (kit) => {
      const group = new THREE.Group()
      group.add(at(kit.cyl(0.32, 0.36, 0.42, kit.mat('wood', 0x6b4a2c), 18), 0, 0.21, 0))
      const top = at(kit.cyl(0.32, 0.32, 0.02, kit.mat('wood', 0xc79b6a), 18), 0, 0.43, 0)
      group.add(top)
      for (let i = 1; i <= 3; i++) {
        const ring = at(kit.tor(0.08 * i, 0.006, kit.mat('wood', 0x8a6238)), 0, 0.445, 0)
        ring.rotation.x = Math.PI / 2
        group.add(ring)
      }
      const moss = at(kit.sph(0.14, kit.mat('leaf', LEAF)), 0.22, 0.38, 0.14)
      moss.scale.set(1, 0.4, 1)
      group.add(moss)
      return group
    },
  },

  /* ── light ───────────────────────────────────────────────────────────── */
  {
    id: 'stringLights', category: 'light', placement: 'floor', radius: 0.7, height: 1.9,
    tintable: true, tint: '#ffd166',
    build: (kit, tint) => {
      const group = new THREE.Group()
      const wood = kit.mat('wood', OAK)
      for (const sx of [-0.7, 0.7]) {
        group.add(at(kit.cyl(0.035, 0.05, 1.8, wood, 8), sx, 0.9, 0))
        group.add(at(kit.cyl(0.2, 0.24, 0.06, kit.mat('dark', CHARCOAL), 14), sx, 0.03, 0))
      }
      const bulbMat = kit.mat('emissive', tint)
      for (let i = 0; i <= 8; i++) {
        const p = i / 8
        const x = -0.7 + p * 1.4
        const y = 1.78 - Math.sin(p * Math.PI) * 0.32
        group.add(at(kit.sph(0.045, bulbMat), x, y, 0))
        if (kit.rich) group.add(at(kit.halo(0.32, tint, 0.55), x, y, 0))
      }
      return group
    },
  },
  {
    id: 'neon', category: 'light', placement: 'wall', radius: 0.5, height: 1.6,
    tintable: true, tint: '#4eeef0',
    build: (kit, tint) => {
      const group = new THREE.Group()
      const glowMat = kit.mat('emissive', tint)
      // A friendly lightning bolt — reads at any size and needs no text.
      const segments: Array<[number, number, number, number]> = [
        [0.1, 1.62, 0.34, -0.5], [-0.03, 1.34, 0.3, 0.9], [0.08, 1.06, 0.34, -0.5],
      ]
      for (const [x, y, len, rot] of segments) {
        const bar = at(kit.cyl(0.028, 0.028, len, glowMat, 10), x, y, 0.03)
        bar.rotation.z = rot
        group.add(bar)
      }
      group.add(at(kit.halo(1.1, tint, 0.5), 0.05, 1.34, 0.06))
      group.add(at(kit.rbox(0.5, 0.72, 0.04, 0.03, kit.mat('dark', 0x14112c)), 0.05, 1.34, -0.01))
      return group
    },
  },
  {
    id: 'lavaLamp', category: 'light', placement: 'floor', radius: 0.22, height: 0.85,
    tintable: true, tint: '#ff5d73',
    build: (kit, tint) => {
      const group = new THREE.Group()
      const metal = kit.mat('metal', 0xc9a227)
      group.add(at(kit.cyl(0.13, 0.16, 0.12, metal, 16), 0, 0.06, 0))
      const glass = at(kit.cyl(0.09, 0.12, 0.52, kit.mat('glass', tint), 18), 0, 0.4, 0)
      group.add(glass)
      const blobMat = kit.mat('emissive', tint)
      for (let i = 0; i < 4; i++) {
        const blob = at(kit.sph(0.05, blobMat), 0, 0.24 + i * 0.13, 0)
        blob.scale.set(1, 0.8 + (i % 2) * 0.5, 1)
        group.add(blob)
      }
      group.add(at(kit.cyl(0.06, 0.1, 0.14, metal, 16), 0, 0.72, 0))
      group.add(at(kit.halo(0.9, tint, 0.4), 0, 0.42, 0))
      return group
    },
  },
  {
    id: 'discoBall', category: 'light', placement: 'floor', radius: 0.3, height: 1.9,
    build: (kit) => {
      const group = new THREE.Group()
      group.add(at(kit.cyl(0.02, 0.02, 0.5, kit.mat('metal', STEEL), 6), 0, 1.65, 0))
      const ball = at(kit.sph(0.26, kit.mat('metal', 0xdfe6ff)), 0, 1.28, 0)
      group.add(ball)
      for (let i = 0; i < (kit.rich ? 26 : 10); i++) {
        const a = i * 2.4
        const facet = at(kit.plane(0.09, 0.09, kit.mat('emissive', 0xffffff)), 0, 1.28, 0)
        const y = Math.cos(i / (kit.rich ? 26 : 10) * Math.PI)
        const r = Math.sqrt(Math.max(0, 1 - y * y)) * 0.27
        facet.position.set(Math.cos(a) * r, 1.28 + y * 0.27, Math.sin(a) * r)
        facet.lookAt(0, 1.28, 0)
        group.add(facet)
      }
      group.add(at(kit.cyl(0.24, 0.3, 0.06, kit.mat('dark', CHARCOAL), 16), 0, 0.03, 0))
      group.add(at(kit.cyl(0.03, 0.03, 1.6, kit.mat('metal', STEEL), 6), 0, 0.83, 0))
      return group
    },
  },
  {
    id: 'starProjector', category: 'light', placement: 'floor', radius: 0.26, height: 0.42,
    tintable: true, tint: '#7c5cff',
    build: (kit, tint) => {
      const group = new THREE.Group()
      group.add(at(kit.sph(0.2, kit.mat('gloss', CHARCOAL)), 0, 0.2, 0))
      const dome = at(kit.sph(0.17, kit.mat('glass', tint)), 0, 0.28, 0)
      group.add(dome)
      group.add(at(kit.cone(0.5, 1.4, kit.sheer(tint, 0.08, true)), 0, 1.05, 0))
      for (let i = 0; i < 10; i++) {
        const star = at(kit.sph(0.02, kit.mat('emissive', 0xffffff)), Math.cos(i * 1.9) * (0.2 + i * 0.03), 0.6 + i * 0.09, Math.sin(i * 1.9) * (0.2 + i * 0.03))
        group.add(star)
      }
      return group
    },
  },

  /* ── tech ────────────────────────────────────────────────────────────── */
  {
    id: 'telescope', category: 'tech', placement: 'floor', radius: 0.45, height: 1.45,
    build: (kit) => {
      const group = new THREE.Group()
      const metal = kit.mat('metal', 0x3d4470)
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2
        const leg = at(kit.cyl(0.022, 0.03, 1, metal, 8), Math.cos(a) * 0.2, 0.5, Math.sin(a) * 0.2)
        leg.rotation.z = -Math.cos(a) * 0.36
        leg.rotation.x = Math.sin(a) * 0.36
        group.add(leg)
      }
      const tube = at(kit.cyl(0.11, 0.13, 0.86, kit.mat('gloss', 0xf2f4ff), 18), 0, 1.16, 0)
      tube.rotation.x = -0.62
      group.add(tube)
      const lens = at(kit.cyl(0.115, 0.115, 0.04, kit.mat('emissive', 0x63d8ff), 18), 0.0, 1.42, 0.32)
      lens.rotation.x = -0.62 + Math.PI / 2
      group.add(lens)
      group.add(at(kit.cyl(0.05, 0.05, 0.2, metal, 10), 0, 0.98, -0.16))
      return group
    },
  },
  {
    id: 'printer3d', category: 'tech', placement: 'floor', radius: 0.4, height: 0.85,
    build: (kit) => {
      const group = new THREE.Group()
      const frame = kit.mat('metal', 0x555d8c)
      group.add(at(kit.rbox(0.66, 0.16, 0.6, 0.03, kit.mat('dark', CHARCOAL)), 0, 0.08, 0))
      for (const [sx, sz] of [[-0.3, -0.27], [0.3, -0.27], [-0.3, 0.27], [0.3, 0.27]]) {
        group.add(at(kit.cyl(0.02, 0.02, 0.68, frame, 8), sx, 0.5, sz))
      }
      group.add(at(kit.box(0.66, 0.03, 0.6, frame), 0, 0.84, 0))
      group.add(at(kit.rbox(0.44, 0.02, 0.42, 0.01, kit.mat('gloss', 0xd7dcf0)), 0, 0.22, 0))
      const head = at(kit.rbox(0.16, 0.14, 0.16, 0.03, kit.mat('gloss', 0xff7a3d)), 0, 0.52, 0)
      group.add(head)
      group.add(at(kit.cyl(0.1, 0.12, 0.2, kit.sheer(0x4eeef0, 0.7, true), 14), 0, 0.33, 0))
      return group
    },
  },
  {
    id: 'holoGlobe', category: 'tech', placement: 'floor', radius: 0.42, height: 1.1,
    tintable: true, tint: '#4eeef0',
    build: (kit, tint) => {
      const group = new THREE.Group()
      group.add(at(kit.cyl(0.32, 0.38, 0.14, kit.mat('dark', 0x1a1740), 20), 0, 0.07, 0))
      const ring = at(kit.tor(0.3, 0.02, kit.mat('emissive', tint)), 0, 0.15, 0)
      ring.rotation.x = Math.PI / 2
      group.add(ring)
      group.add(at(kit.sph(0.28, kit.mat('glass', tint)), 0, 0.7, 0))
      group.add(at(kit.sph(0.29, kit.sheer(tint, 0.16, true)), 0, 0.7, 0))
      for (let i = 0; i < 3; i++) {
        const orbit = at(kit.tor(0.38 + i * 0.05, 0.006, kit.mat('emissive', tint)), 0, 0.7, 0)
        orbit.rotation.x = 1.1 + i * 0.5
        orbit.rotation.y = i * 0.8
        group.add(orbit)
      }
      group.add(at(kit.halo(1.4, tint, 0.35), 0, 0.7, 0))
      return group
    },
  },
  {
    id: 'petBot', category: 'tech', placement: 'floor', radius: 0.3, height: 0.55,
    tintable: true, tint: '#ffd166',
    build: (kit, tint) => {
      const group = new THREE.Group()
      const shell = kit.mat('gloss', tint)
      group.add(at(kit.rbox(0.3, 0.22, 0.42, 0.09, shell), 0, 0.26, 0))
      const head = at(kit.rbox(0.26, 0.22, 0.24, 0.08, shell), 0, 0.4, 0.22)
      group.add(head)
      group.add(at(kit.sph(0.045, kit.mat('emissive', 0x4eeef0)), -0.07, 0.43, 0.34))
      group.add(at(kit.sph(0.045, kit.mat('emissive', 0x4eeef0)), 0.07, 0.43, 0.34))
      group.add(at(kit.cyl(0.012, 0.012, 0.12, kit.mat('metal', STEEL), 6), 0, 0.56, 0.2))
      group.add(at(kit.sph(0.03, kit.mat('emissive', 0xff5d73)), 0, 0.62, 0.2))
      for (const [sx, sz] of [[-0.11, -0.14], [0.11, -0.14], [-0.11, 0.14], [0.11, 0.14]]) {
        group.add(at(kit.cyl(0.06, 0.06, 0.05, kit.mat('dark', CHARCOAL), 12), sx, 0.07, sz).rotateZ(Math.PI / 2))
      }
      const tail = at(kit.cyl(0.015, 0.015, 0.2, kit.mat('metal', STEEL), 6), 0, 0.4, -0.24)
      tail.rotation.x = 0.6
      group.add(tail)
      return group
    },
  },
  {
    id: 'rocket', category: 'tech', placement: 'floor', radius: 0.34, height: 1.5,
    tintable: true, tint: '#ff5d73',
    build: (kit, tint) => {
      const group = new THREE.Group()
      const shell = kit.mat('gloss', CREAM)
      group.add(at(kit.cyl(0.26, 0.3, 0.08, kit.mat('dark', CHARCOAL), 16), 0, 0.04, 0))
      group.add(at(kit.cyl(0.16, 0.18, 0.9, shell, 18), 0, 0.6, 0))
      group.add(at(kit.cone(0.18, 0.42, kit.mat('gloss', tint)), 0, 1.26, 0))
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2
        const fin = at(kit.box(0.03, 0.3, 0.22, kit.mat('gloss', tint)), Math.cos(a) * 0.18, 0.26, Math.sin(a) * 0.18)
        fin.rotation.y = -a
        group.add(fin)
      }
      const window = at(kit.cyl(0.08, 0.08, 0.02, kit.mat('emissive', 0x63d8ff), 16), 0, 0.86, 0.17)
      window.rotation.x = Math.PI / 2
      group.add(window)
      return group
    },
  },
  {
    id: 'serverRack', category: 'tech', placement: 'floor', radius: 0.4, height: 1.5,
    build: (kit) => {
      const group = new THREE.Group()
      group.add(at(kit.rbox(0.6, 1.44, 0.5, 0.04, kit.mat('dark', 0x14162e)), 0, 0.72, 0))
      for (let i = 0; i < 7; i++) {
        const y = 0.18 + i * 0.18
        group.add(at(kit.rbox(0.52, 0.13, 0.04, 0.02, kit.mat('metal', 0x39406e)), 0, y, 0.25))
        for (let led = 0; led < 3; led++) {
          group.add(at(kit.sph(0.014, kit.mat('emissive', [0x5ce67e, 0x4eeef0, 0xffd166][(i + led) % 3])), -0.18 + led * 0.05, y, 0.28))
        }
      }
      group.add(at(kit.halo(1, 0x4eeef0, 0.28), 0, 0.7, 0.34))
      return group
    },
  },

  /* ── wall ────────────────────────────────────────────────────────────── */
  {
    id: 'poster', category: 'wall', placement: 'wall', radius: 0.4, height: 1.9,
    tintable: true, tint: '#7c5cff',
    build: (kit, tint) => {
      const group = new THREE.Group()
      group.add(at(kit.rbox(0.9, 1.24, 0.04, 0.02, kit.mat('matte', CREAM)), 0, 1.48, 0))
      const art = at(kit.plane(0.78, 1.1, kit.mat('matte', tint)), 0, 1.48, 0.025)
      group.add(art)
      const sun = at(kit.cyl(0.18, 0.18, 0.01, kit.mat('emissive', 0xffd166), 20), 0, 1.68, 0.031)
      sun.rotation.x = Math.PI / 2
      group.add(sun)
      for (let i = 0; i < 3; i++) {
        const hill = at(kit.sph(0.3, kit.mat('matte', new THREE.Color(tint).lerp(new THREE.Color(0x000000), 0.35 + i * 0.12))), -0.2 + i * 0.2, 1.05 + i * 0.03, 0.032)
        hill.scale.set(1, 0.45, 0.02)
        group.add(hill)
      }
      return group
    },
  },
  {
    id: 'clock', category: 'wall', placement: 'wall', radius: 0.3, height: 2.2,
    build: (kit) => {
      const group = new THREE.Group()
      group.add(at(kit.cyl(0.26, 0.26, 0.06, kit.mat('gloss', CREAM), 24), 0, 2.05, 0).rotateX(Math.PI / 2))
      const face = at(kit.cyl(0.23, 0.23, 0.01, kit.mat('matte', 0xf7f9ff), 24), 0, 2.05, 0.035)
      face.rotation.x = Math.PI / 2
      group.add(face)
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2
        group.add(at(kit.box(0.015, 0.04, 0.01, kit.mat('matte', CHARCOAL)), Math.sin(a) * 0.19, 2.05 + Math.cos(a) * 0.19, 0.042).rotateZ(-a))
      }
      const hourHand = at(kit.box(0.02, 0.12, 0.012, kit.mat('matte', CHARCOAL)), 0, 2.11, 0.05)
      group.add(hourHand)
      const minHand = at(kit.box(0.015, 0.17, 0.012, kit.mat('matte', 0x7c5cff)), 0.06, 2.03, 0.05)
      minHand.rotation.z = -1.1
      group.add(minHand)
      return group
    },
  },
  {
    id: 'trophies', category: 'wall', placement: 'wall', radius: 0.45, height: 1.6,
    build: (kit) => {
      const group = new THREE.Group()
      group.add(at(kit.rbox(1.05, 0.05, 0.24, 0.02, kit.mat('wood', OAK)), 0, 1.5, 0.1))
      const gold = kit.mat('metal', 0xe8c86a)
      for (let i = 0; i < 3; i++) {
        const x = -0.32 + i * 0.32
        group.add(at(kit.rbox(0.16, 0.06, 0.14, 0.02, kit.mat('wood', DARKWOOD)), x, 1.56, 0.1))
        group.add(at(kit.cyl(0.025, 0.025, 0.1, gold, 10), x, 1.64, 0.1))
        const cup = at(kit.sph(0.09, gold), x, 1.74, 0.1)
        cup.scale.set(1, 0.85, 1)
        group.add(cup)
        for (const side of [-1, 1]) {
          const handle = at(kit.tor(0.045, 0.01, gold), x + side * 0.1, 1.75, 0.1)
          handle.rotation.y = Math.PI / 2
          group.add(handle)
        }
      }
      return group
    },
  },
  {
    id: 'banner', category: 'wall', placement: 'wall', radius: 0.5, height: 2.3,
    tintable: true, tint: '#4cc9f0',
    build: (kit, tint) => {
      const group = new THREE.Group()
      group.add(at(kit.cyl(0.025, 0.025, 1.1, kit.mat('wood', DARKWOOD), 8), 0, 2.24, 0.02).rotateZ(Math.PI / 2))
      const cloth = at(kit.plane(1, 1.5, kit.mat('fabric', tint)), 0, 1.46, 0.02)
      group.add(cloth)
      for (let i = 0; i < 3; i++) {
        const stripe = at(kit.plane(0.86, 0.1, kit.mat('matte', CREAM)), 0, 1.9 - i * 0.34, 0.03)
        group.add(stripe)
      }
      const star = at(kit.sph(0.16, kit.mat('emissive', 0xffd166)), 0, 1.3, 0.035)
      star.scale.set(1, 1, 0.08)
      group.add(star)
      return group
    },
  },
  {
    id: 'frames', category: 'wall', placement: 'wall', radius: 0.5, height: 1.9,
    build: (kit) => {
      const group = new THREE.Group()
      const shots: Array<[number, number, number, number, number]> = [
        [-0.36, 1.72, 0.42, 0.34, 0xff8fd0],
        [0.1, 1.86, 0.32, 0.32, 0x4eeef0],
        [0.14, 1.42, 0.44, 0.3, 0xffd166],
        [-0.34, 1.28, 0.3, 0.28, 0x5ce67e],
      ]
      for (const [x, y, w, h, color] of shots) {
        group.add(at(kit.rbox(w, h, 0.03, 0.01, kit.mat('wood', CREAM)), x, y, 0))
        group.add(at(kit.plane(w - 0.07, h - 0.07, kit.mat('matte', color)), x, y, 0.02))
      }
      return group
    },
  },
]

export const ROOM_CATEGORIES: RoomItemCategory[] = ['seating', 'desk', 'play', 'nature', 'light', 'tech', 'wall']

const BY_ID = new Map(ROOM_ITEMS.map((spec) => [spec.id, spec]))

export function roomItemSpec(id: string): RoomItemSpec | undefined {
  return BY_ID.get(id)
}

export function itemsInCategory(category: RoomItemCategory): RoomItemSpec[] {
  return ROOM_ITEMS.filter((spec) => spec.category === category)
}

