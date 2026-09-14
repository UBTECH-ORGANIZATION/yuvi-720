import * as THREE from 'three'

export function createLoftSurfaceMaterials(rich: boolean) {
  const textures: THREE.Texture[] = []
  let disposed = false
  const loader = new THREE.TextureLoader()
  const load = (name: string, color = false) => {
    const texture = loader.load(`/models/creator-loft/concrete/${name}.jpg`, (loaded) => {
      if (disposed) loaded.dispose()
    })
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.anisotropy = rich ? 4 : 1
    texture.repeat.set(8, 10)
    textures.push(texture)
    return texture
  }
  const map = load('Diffuse', true)
  const normalMap = rich ? load('nor_gl') : null
  const roughnessMap = load('Rough')
  return {
    apply(material: THREE.MeshStandardMaterial) {
      material.map = map
      material.normalMap = normalMap
      material.roughnessMap = roughnessMap
      material.normalScale.set(0.35, 0.35)
      material.roughness = 0.7
      material.metalness = 0
      material.color.setHex(0x8b8e92)
      material.needsUpdate = true
    },
    dispose() {
      disposed = true
      textures.forEach((texture) => texture.dispose())
    },
  }
}