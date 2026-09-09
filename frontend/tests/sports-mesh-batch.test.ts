import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { batchSportsMeshes } from '../src/features/Yuvi-studio/SportsMeshBatch.ts'

test('static batching preserves transformed bounds, leaves fans movable and owns merged buffers', () => {
  const root = new THREE.Group()
  const material = new THREE.MeshStandardMaterial()
  const geometry = new THREE.BoxGeometry(1, 2, 1)
  const nonIndexed = geometry.toNonIndexed()
  for (const x of [-2, 2]) {
    const nested = new THREE.Group()
    nested.position.set(x, 1, -2)
    nested.rotation.y = 0.7
    nested.add(new THREE.Mesh(x < 0 ? geometry : nonIndexed, material))
    root.add(nested)
  }
  const fan = new THREE.Group()
  fan.name = 'sports-gym-fan-1'
  fan.add(new THREE.Mesh(geometry, material))
  root.add(fan)
  const before = new THREE.Box3().setFromObject(root)
  const owned: THREE.BufferGeometry[] = []
  batchSportsMeshes(root, (buffer) => owned.push(buffer))
  const after = new THREE.Box3().setFromObject(root)
  assert.ok(before.min.distanceTo(after.min) < 0.00001)
  assert.ok(before.max.distanceTo(after.max) < 0.00001)
  assert.equal(owned.length, 1)
  assert.equal(fan.children.length, 1)
  assert.ok(root.getObjectByName('sports-static-batch'))
  owned.forEach((buffer) => buffer.dispose())
  geometry.dispose(); nonIndexed.dispose(); material.dispose()
})