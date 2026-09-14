import * as THREE from 'three'
import type { PlaygroundKit, Point3 } from './PlaygroundKit.ts'
import type { PlaygroundMotion } from './PlaygroundInteractions.ts'

export function buildPlaygroundPlant(kit: PlaygroundKit, kind: 'parkTree' | 'parkFlowerBed') {
  const root = new THREE.Group()
  const motion: PlaygroundMotion = { actions: [], updates: [], reduced: false }
  const dark = kit.material('rubber', 0x2f4339)
  const foliage = kit.group(root, 'playground-landscape')
  const leafCanvas = document.createElement('canvas'); leafCanvas.width = leafCanvas.height = 128
  const leafContext = leafCanvas.getContext('2d')!
  const leafGradient = leafContext.createLinearGradient(0, 0, 128, 128)
  leafGradient.addColorStop(0, '#c5d56c'); leafGradient.addColorStop(0.5, '#6f9940'); leafGradient.addColorStop(1, '#355e2c')
  leafContext.fillStyle = leafGradient
  leafContext.beginPath(); leafContext.moveTo(64, 4); leafContext.bezierCurveTo(130, 40, 114, 95, 64, 124); leafContext.bezierCurveTo(15, 94, 0, 40, 64, 4); leafContext.fill()
  leafContext.strokeStyle = '#b7c277'; leafContext.lineWidth = 1.6
  leafContext.beginPath(); leafContext.moveTo(64, 8); leafContext.lineTo(64, 119); leafContext.stroke()
  for (let vein = 0; vein < 8; vein++) for (const side of [-1, 1]) {
    leafContext.beginPath(); leafContext.moveTo(64, 20 + vein * 12); leafContext.lineTo(64 + side * (18 + Math.sin(vein / 8 * Math.PI) * 22), 11 + vein * 12); leafContext.stroke()
  }
  const leafTexture = kit.own(new THREE.CanvasTexture(leafCanvas)); leafTexture.colorSpace = THREE.SRGBColorSpace
  const leafMaterial = kit.own(new THREE.MeshStandardMaterial({ map: leafTexture, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.83, color: 0xd7e3a6 }))
  const leafShape = kit.geometry('curved-leaf', () => {
    const shape = new THREE.PlaneGeometry(0.42, 0.68, 2, 3)
    const positions = shape.attributes.position
    for (let index = 0; index < positions.count; index++) positions.setZ(index, Math.abs(positions.getX(index)) * 0.35 + positions.getY(index) ** 2 * 0.3)
    shape.computeVertexNormals(); return shape
  })
  const leafMatrix = new THREE.Object3D()
  const random = (seed: number) => { const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return value - Math.floor(value) }
  const trees: Point3[] = kind === 'parkTree' ? [[0, 0, 0]] : []
  for (const [index, position] of trees.entries()) {
    const tree = kit.group(foliage, `park-tree-${index}`, position)
    const height = index % 3 === 0 ? 7.8 : 6.8
    kit.cylinder(tree, 1.2, 0.12, kit.material('bark', 0x8c7b5c), [0, 0.08, 0])
    kit.cylinder(tree, 0.23, height * 0.73, kit.material('wood', 0x766348), [0, height * 0.365, 0], 0.085)
    const tips: Point3[] = []
    for (let branch = 0; branch < 12; branch++) {
      const angle = branch * 2.39996 + index
      const radius = 1.3 + random(branch + 7) * 0.8
      const tip: Point3 = [Math.cos(angle) * radius, height * 0.55 + branch / 12 * 2.4, Math.sin(angle) * radius]
      tips.push(tip)
      kit.beam(tree, [0, 2.3 + branch * 0.21, 0], tip, 0.065 - branch * 0.003, kit.material('wood', 0x766348))
      kit.beam(tree, tip, [tip[0] * 1.22, tip[1] + 0.65, tip[2] * 1.22], 0.025, kit.material('wood', 0x766348))
    }
    const crown = new THREE.LOD(); crown.name = 'tree-canopy-lod'; tree.add(crown)
    for (const [level, count] of (kit.rich ? [1600, 600] : [700, 260]).entries()) {
      const leaves = new THREE.InstancedMesh(leafShape, leafMaterial, count)
      leaves.castShadow = kit.rich && level === 0; leaves.receiveShadow = true
      for (let leaf = 0; leaf < count; leaf++) {
        const tip = tips[leaf % tips.length]
        const seed = leaf + index * 1731
        const angle = random(seed + 1) * Math.PI * 2
        const vertical = random(seed + 2) * 2 - 1
        const radius = Math.sqrt(1 - vertical * vertical) * Math.cbrt(random(seed + 3))
        leafMatrix.position.set(tip[0] + Math.cos(angle) * radius * 1.25, tip[1] + vertical * 1.05, tip[2] + Math.sin(angle) * radius * 1.25)
        leafMatrix.rotation.set(random(seed + 4) * Math.PI, random(seed + 5) * Math.PI, random(seed + 6) * Math.PI)
        leafMatrix.scale.setScalar(0.65 + random(seed + 7) * 0.65)
        leafMatrix.updateMatrix(); leaves.setMatrixAt(leaf, leafMatrix.matrix)
        leaves.setColorAt(leaf, new THREE.Color().setHSL(0.19 + random(seed + 8) * 0.07, 0.25, 0.65 + random(seed + 9) * 0.25))
      }
      leaves.instanceMatrix.needsUpdate = true
      leaves.computeBoundingSphere()
      crown.addLevel(leaves, level ? 35 : 0)
    }
    crown.userData.dynamic = true
    motion.updates.push((elapsed) => { if (!motion.reduced) crown.rotation.z = Math.sin(elapsed * 1.3 + index) * 0.004 })
    kit.batch(tree)
  }
  const beds = kind === 'parkFlowerBed' ? [[0, 0, 1.8, 8]] : []
  for (const [index, [x, z, width, depth]] of beds.entries()) {
    const bed = kit.group(foliage, `planting-bed-${index}`, [x, 0, z])
    kit.box(bed, [width, 0.14, depth], kit.material('grass', 0xb1b788), [0, 0.09, 0], 0.12)
    const count = kit.rich ? 220 : 90
    const shrub = new THREE.InstancedMesh(leafShape, leafMaterial, count)
    shrub.castShadow = false; shrub.receiveShadow = true
    for (let leaf = 0; leaf < count; leaf++) {
      leafMatrix.position.set((random(leaf + index * 9) - 0.5) * width, 0.25 + random(leaf + 11) * 0.65, (random(leaf + 16) - 0.5) * depth)
      leafMatrix.rotation.set(random(leaf + 18) * 2, random(leaf + 20) * 6, 0)
      leafMatrix.scale.setScalar(0.8); leafMatrix.updateMatrix(); shrub.setMatrixAt(leaf, leafMatrix.matrix)
    }
    bed.add(shrub)
    for (let flower = 0; flower < 18; flower++) {
      const x = (random(flower + 21) - 0.5) * width, z = (random(flower + 24) - 0.5) * depth
      kit.beam(bed, [x, 0.1, z], [x, 0.65, z], 0.013, dark)
      for (let petal = 0; petal < 5; petal++) kit.sphere(bed, 0.055, kit.material('paint', flower % 2 ? 0xf2d770 : 0xd29aba), [x + Math.cos(petal * 1.256) * 0.075, 0.66, z + Math.sin(petal * 1.256) * 0.075]).scale.y = 0.4
    }
    kit.batch(bed)
  }
  root.scale.setScalar(1 / 1.75)
  const result = new THREE.Group()
  result.add(root)
  result.userData.update = (elapsed: number) => motion.updates.forEach((update) => update(elapsed))
  return result
}

export function buildPlaygroundFence(root: THREE.Group, kit: PlaygroundKit) {
  const furniture = kit.group(root, 'playground-entrance-fence')
  const steel = kit.material('steel', 0x6f7c76)
  for (const side of [-1, 1]) {
    for (let post = 0; post < 10; post++) kit.beam(furniture, [side * (8 + post * 1.5), 0, 32.1], [side * (8 + post * 1.5), 1.1, 32.1], 0.04, steel)
    for (const height of [0.3, 0.95]) kit.beam(furniture, [side * 8, height, 32.1], [side * 21.5, height, 32.1], 0.035, steel)
  }
  kit.batch(furniture)
}