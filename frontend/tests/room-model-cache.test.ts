import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createRoomModelCache } from '../src/features/Yuvi-studio/RoomModelCache.ts'

test('models share GPU resources while preserving independent fitted roots', async () => {
  let calls = 0
  const source = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2), new THREE.MeshStandardMaterial())
  const cache = createRoomModelCache(async () => { calls += 1; return source })
  const first = cache.model('/model.glb', [1, 2, 1])
  const second = cache.model('/model.glb', [2, 4, 2])
  await Promise.all([first.userData.assetReady, second.userData.assetReady])
  assert.equal(calls, 1)
  assert.notEqual(first.children[0], second.children[0])
  assert.equal((first.children[0] as THREE.Mesh).geometry, source.geometry)
  const bounds = new THREE.Box3().setFromObject(first)
  assert.equal(bounds.min.y, 0)
  assert.equal(bounds.max.y, 2)
  first.position.x = 7
  assert.equal(second.position.x, 0)
  cache.dispose()
})

test('late loads are disposed and never attached after room teardown', async () => {
  let resolve!: (root: THREE.Object3D) => void
  const source = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
  let releases = 0
  source.geometry.addEventListener('dispose', () => { releases += 1 })
  const cache = createRoomModelCache(() => new Promise((done) => { resolve = done }))
  const holder = cache.model('/late.glb', [1, 1, 1])
  cache.dispose()
  resolve(source)
  await holder.userData.assetReady
  assert.equal(holder.children.length, 0)
  assert.equal(holder.userData.assetState, 'disposed')
  assert.equal(releases, 1)
})

test('failed downloads are handled and hologram previews do not hydrate in full color', async () => {
  const failed = createRoomModelCache(async () => { throw new Error('unavailable') })
  const missing = failed.model('/missing.glb', [1, 1, 1])
  await missing.userData.assetReady
  assert.equal(missing.userData.assetState, 'error')
  const cache = createRoomModelCache(async () => new THREE.Group())
  const preview = cache.model('/preview.glb', [1, 1, 1])
  preview.userData.assetPreview = true
  await preview.userData.assetReady
  assert.equal(preview.children.length, 0)
  cache.dispose()
  failed.dispose()
})