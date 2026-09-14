import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export type Point3 = [number, number, number]
export type Finish = 'steel' | 'paint' | 'wood' | 'rubber' | 'sand' | 'stone' | 'rope' | 'bark' | 'grass'

export function createPlaygroundKit(rich: boolean) {
  const resources = new Set<{ dispose(): void }>()
  const materials = new Map<string, THREE.MeshStandardMaterial>()
  const geometries = new Map<string, THREE.BufferGeometry>()
  const textures = new Map<string, THREE.Texture>()
  const pending: Promise<void>[] = []
  const failures: string[] = []
  let disposed = false
  const own = <Resource extends { dispose(): void }>(resource: Resource): Resource => { resources.add(resource); return resource }
  const geometry = (key: string, build: () => THREE.BufferGeometry) => {
    if (!geometries.has(key)) geometries.set(key, own(build()))
    return geometries.get(key)!
  }
  const texture = (asset: string, channel: string, repeat: number) => {
    const key = `${asset}/${channel}/${repeat}`
    if (textures.has(key)) return textures.get(key)!
    let resolve!: () => void
    pending.push(new Promise<void>((done) => { resolve = done }))
    const result = own(new THREE.TextureLoader().load(`/models/playground/${asset}-${channel}.jpg`, (loaded) => {
      if (disposed) loaded.dispose()
      resolve()
    }, undefined, () => { failures.push(key); resolve() }))
    result.wrapS = result.wrapT = THREE.RepeatWrapping
    result.repeat.set(repeat, repeat)
    result.colorSpace = channel === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace
    result.anisotropy = rich ? 4 : 1
    textures.set(key, result)
    return result
  }
  const noise = (finish: Finish) => {
    const key = `grain/${finish}`
    if (textures.has(key)) return textures.get(key)!
    const size = 128
    const pixels = new Uint8Array(size * size * 4)
    for (let index = 0; index < size * size; index++) {
      const grain = finish === 'wood' || finish === 'rope' ? Math.sin(index % size * 1.9 + Math.sin(Math.floor(index / size) * 0.04)) : Math.sin(index * 127.1) * Math.cos(index * 311.7)
      const value = 178 + grain * 45
      pixels.set([value, value, value, 255], index * 4)
    }
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size
    const context = canvas.getContext('2d')!
    context.putImageData(new ImageData(new Uint8ClampedArray(pixels), size, size), 0, 0)
    const result = own(new THREE.CanvasTexture(canvas))
    result.wrapS = result.wrapT = THREE.RepeatWrapping
    result.needsUpdate = true
    textures.set(key, result)
    return result
  }
  const material = (finish: Finish, color: THREE.ColorRepresentation) => {
    const key = `${finish}/${new THREE.Color(color).getHexString()}`
    if (materials.has(key)) return materials.get(key)!
    const surface = own(new THREE.MeshStandardMaterial({ color,
      roughness: finish === 'steel' ? 0.3 : finish === 'paint' ? 0.39 : 0.88,
      metalness: finish === 'steel' ? 0.85 : 0,
      bumpMap: noise(finish), roughnessMap: noise(finish),
      bumpScale: finish === 'sand' ? 0.07 : finish === 'rope' ? 0.025 : 0.012,
    }))
    const asset = finish === 'wood' ? 'wood_planks' : finish === 'grass' ? 'aerial_grass_rock' : finish === 'bark' ? 'brown_mud_leaves_01' : null
    if (asset) {
      surface.map = texture(asset, 'color', finish === 'grass' ? 3 : 1)
      surface.normalMap = texture(asset, 'normal', finish === 'grass' ? 3 : 1)
      surface.normalScale.setScalar(finish === 'bark' ? 0.7 : 0.35)
      surface.roughnessMap = texture(asset, 'roughness', finish === 'grass' ? 3 : 1)
    }
    materials.set(key, surface)
    return surface
  }
  const mesh = (parent: THREE.Object3D, shape: THREE.BufferGeometry, surface: THREE.Material, position: Point3 = [0, 0, 0]) => {
    const result = new THREE.Mesh(shape, surface)
    result.position.set(...position)
    result.castShadow = rich
    result.receiveShadow = true
    parent.add(result)
    return result
  }
  const box = (parent: THREE.Object3D, size: Point3, surface: THREE.Material, position: Point3 = [0, 0, 0], radius = 0.025) =>
    mesh(parent, geometry(`box/${size}/${radius}`, () => new RoundedBoxGeometry(...size, 1, Math.min(radius, ...size.map((value) => value / 3)))), surface, position)
  const cylinder = (parent: THREE.Object3D, radius: number, height: number, surface: THREE.Material, position: Point3 = [0, 0, 0], top = radius) =>
    mesh(parent, geometry(`cylinder/${radius}/${height}/${top}`, () => new THREE.CylinderGeometry(top, radius, height, rich ? 16 : 10)), surface, position)
  const sphere = (parent: THREE.Object3D, radius: number, surface: THREE.Material, position: Point3 = [0, 0, 0]) =>
    mesh(parent, geometry(`sphere/${radius}`, () => new THREE.SphereGeometry(radius, rich ? 16 : 10, rich ? 10 : 6)), surface, position)
  const beam = (parent: THREE.Object3D, start: Point3, end: Point3, radius: number, surface: THREE.Material) => {
    const direction = new THREE.Vector3(...end).sub(new THREE.Vector3(...start))
    const result = cylinder(parent, radius, direction.length(), surface)
    result.position.set(...start).addScaledVector(direction, 0.5)
    result.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
    return result
  }
  const tube = (parent: THREE.Object3D, points: Point3[], radius: number, surface: THREE.Material, segments = rich ? 40 : 24) =>
    mesh(parent, own(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point))), segments, radius, rich ? 10 : 6, false)), surface)
  const group = (parent: THREE.Object3D, name: string, position: Point3 = [0, 0, 0]) => {
    const result = new THREE.Group()
    result.name = name
    result.position.set(...position)
    parent.add(result)
    return result
  }
  const bolt = (parent: THREE.Object3D, position: Point3) => {
    const result = cylinder(parent, 0.038, 0.035, material('steel', 0xa5adae), position)
    result.rotation.x = Math.PI / 2
    return result
  }
  const batch = (root: THREE.Group) => {
    root.updateMatrixWorld(true)
    const inverse = root.matrixWorld.clone().invert()
    const sets = new Map<THREE.Material, THREE.Mesh[]>()
    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh) || node instanceof THREE.InstancedMesh || Array.isArray(node.material) || node.material.transparent) return
      let ancestor: THREE.Object3D | null = node
      while (ancestor && ancestor !== root) {
        if (ancestor.userData.dynamic || ancestor instanceof THREE.LOD) return
        ancestor = ancestor.parent
      }
      const entries = sets.get(node.material) ?? []
      entries.push(node)
      sets.set(node.material, entries)
    })
    for (const [surface, entries] of sets) {
      if (entries.length < 2) continue
      const copies = entries.map((entry) => (entry.geometry.index ? entry.geometry.toNonIndexed() : entry.geometry.clone()).applyMatrix4(inverse.clone().multiply(entry.matrixWorld)))
      const merged = mergeGeometries(copies)
      copies.forEach((copy) => copy.dispose())
      if (!merged) continue
      const result = mesh(root, own(merged), surface)
      result.name = 'playground-static-batch'
      entries.forEach((entry) => entry.removeFromParent())
    }
  }
  return { rich, own, material, mesh, box, cylinder, sphere, beam, tube, group, bolt, batch, geometry, failures,
    ready: () => Promise.all(pending),
    dispose: () => { disposed = true; resources.forEach((resource) => resource.dispose()); resources.clear(); materials.clear(); geometries.clear(); textures.clear() },
  }
}

export type PlaygroundKit = ReturnType<typeof createPlaygroundKit>