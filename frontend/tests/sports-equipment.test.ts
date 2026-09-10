import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { buildSportsEquipment } from '../src/features/Yuvi-studio/SportsEquipment.ts'

const material = new THREE.MeshStandardMaterial()
const mesh = () => new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), material)
const kit: any = {
  mat: () => material, box: mesh, rbox: mesh, cyl: mesh, sph: mesh, tor: mesh, plane: mesh, cone: mesh,
  sheer: () => material, halo: mesh, gymSignPrint: () => material,
}

for (const rich of [true, false]) {
  test(`dumbbell sample has aligned weights and stable dimensions (rich=${rich})`, () => {
    const geometryKit = {
      ...kit, rich,
      box: (width: number, height: number, depth: number) => new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material),
      rbox: (width: number, height: number, depth: number) => new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material),
      cyl: (top: number, bottom: number, height: number, _material: THREE.Material, segments: number) => new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, segments), material),
      tor: (radius: number, tube: number) => new THREE.Mesh(new THREE.TorusGeometry(radius, tube), material),
    }
    const root = buildSportsEquipment('sportsDumbbellRack', geometryKit, new THREE.Color('#20a8a0'))
    const weights: THREE.Object3D[] = []
    root.traverse((child) => { if (child.name === 'dumbbell-weight') weights.push(child) })
    assert.equal(weights.length, 20)
    for (const weight of weights) assert.ok(Math.abs(weight.rotation.z - Math.PI / 2) < 0.001)
    const bounds = new THREE.Box3().setFromObject(root)
    assert.ok(bounds.min.y >= -0.001)
    assert.ok(bounds.max.y < 1.5)
    assert.ok(bounds.max.x - bounds.min.x <= 2.81)
    assert.ok(root.getObjectByName('rack-bolt'))
    assert.equal(Boolean(root.getObjectByName('knurled-grip')), rich)
    root.traverse((child) => { if (child instanceof THREE.Mesh) child.geometry.dispose() })
  })
}

for (const kind of ['sportsWallScoreboard', 'sportsDumbbellRack', 'sportsSquatRack', 'sportsCableMachine', 'sportsLegPress', 'sportsAdjustableBench', 'sportsRacketCorner', 'sportsSeatingBench', 'sportsPortableScoreboard', 'sportsJerseyDisplay', 'sportsJerseyDisplayAlt']) {
  test(`${kind} is a multi-mesh movable root`, () => {
    const root = buildSportsEquipment(kind, kit, new THREE.Color('#20a8a0'))
    const meshes: THREE.Mesh[] = []
    root.traverse((child) => { if (child instanceof THREE.Mesh) meshes.push(child) })
    assert.ok(meshes.length >= 3)
    root.position.set(8, 0, -4)
    root.rotation.y = Math.PI / 2
    root.updateMatrixWorld(true)
    assert.ok(meshes.every((child) => child.parent !== null && child.getWorldPosition(new THREE.Vector3()).distanceTo(root.position) > 0))
  })
}