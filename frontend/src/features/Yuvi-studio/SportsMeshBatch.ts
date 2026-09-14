import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export function batchSportsMeshes(root: THREE.Group, own: (geometry: THREE.BufferGeometry) => void) {
  root.updateMatrixWorld(true)
  const inverse = root.matrixWorld.clone().invert()
  const batches = new Map<THREE.Material, THREE.Mesh[]>()
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || Array.isArray(node.material) || node.material.transparent) return
    let parent: THREE.Object3D | null = node
    while (parent && parent !== root) {
      if (parent.name.startsWith('sports-gym-fan-')) return
      parent = parent.parent
    }
    const batch = batches.get(node.material) ?? []
    batch.push(node)
    batches.set(node.material, batch)
  })
  for (const [material, meshes] of batches) {
    if (meshes.length < 2) continue
    const geometries = meshes.map((mesh) => (
      mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
    ).applyMatrix4(inverse.clone().multiply(mesh.matrixWorld)))
    const merged = mergeGeometries(geometries)
    geometries.forEach((geometry) => geometry.dispose())
    if (!merged) continue
    own(merged)
    const mesh = new THREE.Mesh(merged, material)
    mesh.name = 'sports-static-batch'
    mesh.castShadow = meshes.some((source) => source.castShadow)
    mesh.receiveShadow = true
    meshes.forEach((source) => source.removeFromParent())
    root.add(mesh)
  }
}