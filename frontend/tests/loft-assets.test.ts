import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

if (!globalThis.ProgressEvent) {
  Object.defineProperty(globalThis, 'ProgressEvent', {
    value: class extends Event {
      constructor(type: string, properties = {}) {
        super(type)
        Object.assign(this, properties)
      }
    },
    configurable: true,
  })
}

const root = new URL('../public/models/creator-loft/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'))

test('concrete PBR maps match their published hashes', () => {
  assert.equal(manifest.textures.length, 3)
  for (const file of manifest.textures) {
    const bytes = readFileSync(new URL(file.path, root))
    assert.equal(bytes.length, file.bytes)
    assert.equal(createHash('md5').update(bytes).digest('hex'), file.md5)
  }
})

for (const asset of manifest.assets) {
  test(`${asset.id}: self-hosted PBR model has intact dependencies and valid geometry`, async () => {
    const bytes = readFileSync(new URL(asset.path, root))
    assert.equal(createHash('md5').update(bytes).digest('hex'), asset.md5)
    const document = JSON.parse(bytes.toString())
    for (const file of asset.dependencies) {
      const dependency = readFileSync(new URL(file.path, root))
      assert.equal(dependency.length, file.bytes)
      assert.equal(createHash('md5').update(dependency).digest('hex'), file.md5)
    }
    for (const buffer of document.buffers) {
      const data = readFileSync(new URL(`${asset.id}/${buffer.uri}`, root))
      buffer.uri = `data:application/octet-stream;base64,${data.toString('base64')}`
    }
    for (const image of document.images) {
      assert.ok(asset.dependencies.some((file: { path: string }) => file.path === `${asset.id}/${image.uri}`))
    }
    assert.ok(document.materials.some((material: any) => material.normalTexture && material.pbrMetallicRoughness?.baseColorTexture))
    const loader = new GLTFLoader()
    loader.register(() => ({ name: 'test-texture-decode-boundary', loadTexture: async () => new THREE.Texture() }))
    const model = await loader.parseAsync(JSON.stringify(document), '')
    const bounds = new THREE.Box3().setFromObject(model.scene)
    assert.equal(bounds.isEmpty(), false)
    assert.ok(bounds.getSize(new THREE.Vector3()).length() > 0)
    let vertices = 0
    model.scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return
      const count = node.geometry.getAttribute('position').count
      assert.ok(count >= 3)
      vertices += count
      node.geometry.dispose()
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose()
        material.dispose()
      }
    })
    assert.ok(vertices > 1000)
  })
}