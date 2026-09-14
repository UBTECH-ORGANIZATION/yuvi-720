import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { createLoftSurfaceMaterials } from '../src/features/Yuvi-studio/LoftSurfaceMaterials.ts'

for (const rich of [true, false]) {
  test(`loft surfaces share correctly encoded maps and release them (rich=${rich})`, (context) => {
    const requests: string[] = []
    const textures: THREE.Texture[] = []
    context.mock.method(THREE.TextureLoader.prototype, 'load', (url: string) => {
      requests.push(url)
      const texture = new THREE.Texture()
      textures.push(texture)
      return texture
    })
    const surfaces = createLoftSurfaceMaterials(rich)
    const floor = new THREE.MeshStandardMaterial()
    const stage = new THREE.MeshStandardMaterial()
    surfaces.apply(floor)
    surfaces.apply(stage)
    assert.equal(floor.map, stage.map)
    assert.equal(floor.map?.colorSpace, THREE.SRGBColorSpace)
    assert.equal(floor.roughnessMap?.colorSpace, THREE.NoColorSpace)
    assert.equal(floor.map?.wrapS, THREE.RepeatWrapping)
    assert.equal(floor.map?.wrapT, THREE.RepeatWrapping)
    assert.deepEqual(floor.map?.repeat.toArray(), [8, 10])
    assert.equal(floor.map?.anisotropy, rich ? 4 : 1)
    assert.equal(floor.metalness, 0)
    assert.equal(requests.length, rich ? 3 : 2)
    if (rich) assert.equal(floor.normalMap?.colorSpace, THREE.NoColorSpace)
    else assert.equal(floor.normalMap, null)
    let released = 0
    textures.forEach((texture) => texture.addEventListener('dispose', () => { released += 1 }))
    surfaces.dispose()
    assert.equal(released, textures.length)
    floor.dispose()
    stage.dispose()
  })
}