import * as THREE from 'three'

export function createLoftLighting(floorY: number, rich: boolean) {
  const group = new THREE.Group()
  group.name = 'creator-loft-practical-lighting'
  const fixtures = rich
    ? [[-16, -7], [16, -7], [-12, 19], [12, 19]]
    : [[-12, -7], [12, 19]]
  for (const [x, z] of fixtures) {
    const light = new THREE.PointLight(0xfff1dd, rich ? 240 : 320, 32, 2)
    light.position.set(x, floorY + 9.5, z)
    group.add(light)
  }
  const stage = new THREE.SpotLight(0xe2efff, 480, 34, Math.PI / 3, 0.8, 2)
  stage.position.set(0, floorY + 10.8, -16)
  stage.target.position.set(0, floorY + 0.8, -22)
  stage.castShadow = rich
  stage.shadow.mapSize.set(1024, 1024)
  stage.shadow.camera.near = 1
  stage.shadow.camera.far = 34
  stage.shadow.normalBias = 0.04
  stage.shadow.bias = -0.0002
  group.add(stage, stage.target)
  return {
    group,
    dispose() {
      group.traverse((node) => { if (node instanceof THREE.Light) node.dispose() })
    },
  }
}