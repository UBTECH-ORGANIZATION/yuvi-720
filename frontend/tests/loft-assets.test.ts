/* The worlds' shipped PBR assets match their manifests and still load.
 *
 * `scripts/optimize-model-assets.mjs` writes `src/assets/models/` from the
 * Poly Haven downloads: 1K WebP maps and glTF props that reference them
 * through `EXT_texture_webp`. The manifests record the bytes and md5 of every
 * shipped file (plus the provenance of the original), so a file edited by
 * hand, or an optimizer run that was not committed whole, fails here rather
 * than as a broken prop in a child's loft.
 */
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

const md5 = (bytes: Buffer) => createHash('md5').update(bytes).digest('hex')
const isWebp = (bytes: Buffer) => bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP'
const MAX_PX = 1024

const loft = new URL('../src/assets/models/creator-loft/', import.meta.url)
const park = new URL('../src/assets/models/playground/', import.meta.url)
const loftManifest = JSON.parse(readFileSync(new URL('manifest.json', loft), 'utf8'))
const parkManifest = JSON.parse(readFileSync(new URL('manifest.json', park), 'utf8'))

test('playground maps: nine 1K WebP files matching the manifest', () => {
  assert.equal(parkManifest.assets.length, 9)
  for (const file of parkManifest.assets) {
    const bytes = readFileSync(new URL(file.path.replace(/^playground\//, ''), park))
    assert.equal(bytes.length, file.bytes, file.path)
    assert.equal(md5(bytes), file.md5, file.path)
    assert.ok(isWebp(bytes), `${file.path} is not WebP`)
    assert.ok(file.width <= MAX_PX && file.height <= MAX_PX, `${file.path} is ${file.width}×${file.height}`)
    assert.ok(file.source?.md5, `${file.path} lost its Poly Haven provenance`)
  }
})

test('concrete PBR maps match the manifest', () => {
  assert.equal(loftManifest.textures.length, 3)
  for (const file of loftManifest.textures) {
    const bytes = readFileSync(new URL(file.path.replace(/^creator-loft\//, ''), loft))
    assert.equal(bytes.length, file.bytes, file.path)
    assert.equal(md5(bytes), file.md5, file.path)
    assert.ok(isWebp(bytes), `${file.path} is not WebP`)
    assert.ok(file.width <= MAX_PX && file.height <= MAX_PX)
  }
})

for (const asset of loftManifest.assets) {
  test(`${asset.id}: shipped glTF has intact WebP dependencies and valid geometry`, async () => {
    const bytes = readFileSync(new URL(asset.path.replace(/^creator-loft\//, ''), loft))
    assert.equal(md5(bytes), asset.md5)
    const document = JSON.parse(bytes.toString())
    for (const file of asset.dependencies) {
      const dependency = readFileSync(new URL(file.path.replace(/^creator-loft\//, ''), loft))
      assert.equal(dependency.length, file.bytes, file.path)
      assert.equal(md5(dependency), file.md5, file.path)
      if (file.path.endsWith('.webp')) assert.ok(isWebp(dependency), `${file.path} is not WebP`)
    }
    // Every image is a shipped WebP and every texture reaches it through the
    // extension — a plain `source` left behind would ask for a JPEG that is gone.
    assert.ok(document.extensionsRequired.includes('EXT_texture_webp'))
    for (const image of document.images) {
      assert.equal(image.mimeType, 'image/webp')
      assert.ok(asset.dependencies.some((file: { path: string }) => file.path === `${asset.path.replace(/[^/]+$/, '')}${image.uri}`), image.uri)
    }
    for (const texture of document.textures) {
      assert.equal(texture.source, undefined)
      assert.equal(typeof texture.extensions.EXT_texture_webp.source, 'number')
    }
    assert.ok(document.materials.some((material: any) => material.normalTexture && material.pbrMetallicRoughness?.baseColorTexture))

    // Parse the geometry with the textures stubbed: this runner has no image
    // decoder, so the WebP indirection is folded back into `source` and the
    // decode boundary plugin below answers for every texture.
    for (const buffer of document.buffers) {
      const data = readFileSync(new URL(`${asset.id}/${buffer.uri}`, loft))
      buffer.uri = `data:application/octet-stream;base64,${data.toString('base64')}`
    }
    for (const texture of document.textures) {
      texture.source = texture.extensions.EXT_texture_webp.source
      delete texture.extensions
    }
    document.extensionsUsed = document.extensionsUsed.filter((name: string) => name !== 'EXT_texture_webp')
    document.extensionsRequired = document.extensionsRequired.filter((name: string) => name !== 'EXT_texture_webp')
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

test('the shipped set stays small enough for a school connection', () => {
  const all = [
    ...parkManifest.assets,
    ...loftManifest.textures,
    ...loftManifest.assets.flatMap((asset: any) => [asset, ...asset.dependencies]),
  ]
  const total = all.reduce((sum: number, file: { bytes: number }) => sum + file.bytes, 0)
  // 28 MB of JPEG before the optimizer; the budget leaves room for a fifth prop.
  assert.ok(total <= 8 * 1024 * 1024, `world assets total ${(total / 1024).toFixed(0)} KB, over 8 MB — lower --quality in the optimizer`)
})
