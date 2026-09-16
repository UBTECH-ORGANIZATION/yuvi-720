import * as THREE from 'three'

export function createSportsHallSurface(rich: boolean) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = rich ? 1024 : 512
  const context = canvas.getContext('2d')!
  const size = canvas.width
  context.fillStyle = '#bfc6bb'
  context.fillRect(0, 0, size, size)
  for (let row = 0; row < 80; row++) {
    const shade = 180 + row * 17 % 22
    context.fillStyle = `rgb(${shade},${shade + 5},${shade - 3})`
    context.fillRect(0, row * size / 80, size, size / 80 - 0.5)
    context.fillStyle = '#a7ada2'
    for (let joint = 0; joint < 7; joint++) context.fillRect((joint + (row % 3) / 3) * size / 7, row * size / 80, 0.7, size / 80)
  }
  context.globalAlpha = 0.08
  for (let grain = 0; grain < 6000; grain++) {
    context.fillStyle = grain % 2 ? '#ffffff' : '#495247'
    context.fillRect(grain * 71 % size, grain * 163 % size, size / 64, 0.5)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = rich ? 4 : 1
  return {
    apply(material: THREE.MeshStandardMaterial) {
      material.map = texture
      material.color.setHex(0xffffff)
      material.roughness = 0.58
      material.metalness = 0
      material.needsUpdate = true
    },
    dispose() { texture.dispose() },
  }
}