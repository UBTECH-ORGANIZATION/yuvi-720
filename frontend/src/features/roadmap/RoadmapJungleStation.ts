import * as THREE from 'three'
import type { Theme } from '../../providers/ThemeProvider'
import type { RenderTier } from '../Yuvi-studio/renderTier'

interface JungleStationAssets {
  create(level: number, milestone: boolean): THREE.Group
  setTheme(theme: Theme): void
  setQuality(tier: RenderTier): void
  update(time: number): void
  dispose(): void
}

type StationArchetype = 'vine-ruin' | 'tropical-canopy' | 'shattered-garden' | 'root-shrine'
type FlowerVariant = 'star-bloom' | 'orchid' | 'torch-flower'

const STATION_ARCHETYPES: readonly StationArchetype[] = ['vine-ruin', 'tropical-canopy', 'shattered-garden', 'root-shrine']
const FLOWER_VARIANTS: readonly FlowerVariant[] = ['star-bloom', 'orchid', 'torch-flower']

interface StationDetailProfile {
  roots: number
  leaves: number
  vines: number
  flowers: number
  stones: number
  monstera: number
}

export function stationArchetype(level: number): StationArchetype {
  return STATION_ARCHETYPES[(Math.max(1, Math.round(level)) - 1) % STATION_ARCHETYPES.length]
}

export function stationFlowerVariant(level: number, index: number): FlowerVariant {
  const stationOffset = Math.max(1, Math.round(level)) % FLOWER_VARIANTS.length
  return FLOWER_VARIANTS[(stationOffset + Math.max(0, Math.round(index))) % FLOWER_VARIANTS.length]
}

export function stationDetailProfile(level: number, milestone: boolean): StationDetailProfile {
  const extra = milestone ? 1 : 0
  switch (stationArchetype(level)) {
    case 'vine-ruin':
      return { roots: 3, leaves: 4 + extra, vines: 3 + extra, flowers: 0, stones: 3 + extra, monstera: 0 }
    case 'tropical-canopy':
      return { roots: 2, leaves: 7 + extra, vines: 0, flowers: 0, stones: 0, monstera: 3 + extra }
    case 'shattered-garden':
      return { roots: 2, leaves: 3 + extra, vines: 0, flowers: 3 + extra, stones: 6 + extra, monstera: 0 }
    case 'root-shrine':
      return { roots: 8 + extra, leaves: 3, vines: 0, flowers: 0, stones: 0, monstera: 0 }
  }
}

const GLSL_NOISE = /* glsl */ `
  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x), mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x), mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y),
      f.z
    );
  }
  float fbm(vec3 p) {
    float value = 0.0;
    float amplitude = 0.55;
    for (int octave = 0; octave < 4; octave++) {
      value += noise3(p) * amplitude;
      p = p * 2.03 + 7.1;
      amplitude *= 0.48;
    }
    return value;
  }
`

function islandGeometry(archetype: StationArchetype): THREE.BufferGeometry {
  const segments = 14
  const shape = archetype === 'tropical-canopy' ? { x: 1.16, z: 0.9, depth: 0.86 }
    : archetype === 'shattered-garden' ? { x: 1.08, z: 1.08, depth: 0.72 }
      : archetype === 'root-shrine' ? { x: 0.9, z: 1.12, depth: 1.18 }
        : { x: 1, z: 1, depth: 1 }
  const rings = [
    { y: 0.08, radius: 1.72 },
    { y: -0.18, radius: 1.9 },
    { y: -0.62 * shape.depth, radius: 1.55 },
    { y: -1.16 * shape.depth, radius: 1.08 },
    { y: -1.72 * shape.depth, radius: 0.5 },
    { y: -2.08 * shape.depth, radius: 0.12 },
  ]
  const positions: number[] = [0, 0.1, 0]
  const indices: number[] = []
  for (let ring = 0; ring < rings.length; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const angle = segment / segments * Math.PI * 2
      const irregular = 1 + Math.sin(segment * 4.71 + ring * 1.93) * 0.07 + Math.sin(segment * 1.37 - ring) * 0.045
      const radius = rings[ring].radius * irregular
      positions.push(Math.cos(angle) * radius * shape.x, rings[ring].y, Math.sin(angle) * radius * shape.z)
    }
  }
  for (let segment = 0; segment < segments; segment++) indices.push(0, 1 + segment, 1 + (segment + 1) % segments)
  for (let ring = 0; ring < rings.length - 1; ring++) {
    const start = 1 + ring * segments
    const next = start + segments
    for (let segment = 0; segment < segments; segment++) {
      const following = (segment + 1) % segments
      indices.push(start + segment, next + segment, start + following, start + following, next + segment, next + following)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function islandMaterial(theme: Theme): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uStone: { value: new THREE.Color() },
      uStoneDark: { value: new THREE.Color() },
      uMoss: { value: new THREE.Color() },
      uMossBright: { value: new THREE.Color() },
      uLight: { value: new THREE.Vector3(0.35, 0.82, 0.44).normalize() },
      uAmbient: { value: 0.64 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPosition;
      varying vec3 vNormal;
      ${GLSL_NOISE}
      void main() {
        vec3 p = position;
        float crag = fbm(position * 2.4 + vec3(4.0));
        p += normal * (crag - 0.5) * 0.12;
        vPosition = p;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uStone;
      uniform vec3 uStoneDark;
      uniform vec3 uMoss;
      uniform vec3 uMossBright;
      uniform vec3 uLight;
      uniform float uAmbient;
      uniform float uTime;
      varying vec3 vPosition;
      varying vec3 vNormal;
      ${GLSL_NOISE}
      void main() {
        float broad = fbm(vPosition * 1.6 + vec3(0.0, 2.0, 0.0));
        float grain = fbm(vPosition * 7.5 + vec3(11.0));
        float upward = smoothstep(0.18, 0.82, vNormal.y);
        float ledge = smoothstep(-0.42, 0.02, vPosition.y);
        float mossMask = smoothstep(0.3, 0.6, broad + upward * 0.62 + ledge * 0.24);
        vec3 stone = mix(uStoneDark, uStone, 0.38 + grain * 0.62);
        vec3 moss = mix(uMoss, uMossBright, grain);
        vec3 albedo = mix(stone, moss, mossMask * upward);
        float diffuse = uAmbient + max(dot(normalize(vNormal), uLight), 0.0) * (1.0 - uAmbient);
        float crevice = 0.84 + grain * 0.16;
        gl_FragColor = vec4(albedo * diffuse * crevice, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
}

function leafGeometry(): THREE.BufferGeometry {
  const positions: number[] = []
  const indices: number[] = []
  const segments = 6
  for (let index = 0; index <= segments; index++) {
    const progress = index / segments
    const width = Math.sin(progress * Math.PI) * 0.28
    const y = Math.sin(progress * Math.PI) * 0.1
    const z = (progress - 0.5) * 1.35
    positions.push(-width, y, z, width, y, z)
    if (index < segments) {
      const start = index * 2
      indices.push(start, start + 2, start + 1, start + 1, start + 2, start + 3)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function flowerGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(0.24, 7, 4)
  geometry.scale(1.55, 0.22, 0.72)
  return geometry
}

function fracturedStoneGeometry(variant: number): THREE.BufferGeometry {
  const geometry = new THREE.DodecahedronGeometry(0.5, 0)
  const positions = geometry.getAttribute('position')
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index)
    const y = positions.getY(index)
    const z = positions.getZ(index)
    const fracture = 0.82 + seeded(index + 1, variant + 401) * 0.34
    positions.setXYZ(
      index,
      (x + (seeded(index + 1, variant + 411) - 0.5) * 0.16) * fracture,
      (y + (seeded(index + 1, variant + 421) - 0.5) * 0.12) * (0.78 + variant * 0.08),
      (z + (seeded(index + 1, variant + 431) - 0.5) * 0.16) * fracture,
    )
  }
  positions.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

function monsteraMonkeyLeafGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(0, -0.58)
  shape.bezierCurveTo(-0.56, -0.38, -0.62, 0.22, 0, 0.66)
  shape.bezierCurveTo(0.62, 0.22, 0.56, -0.38, 0, -0.58)
  for (const [x, y, radiusX, radiusY] of [
    [-0.22, -0.04, 0.09, 0.16],
    [0.22, 0.02, 0.09, 0.16],
    [-0.13, 0.3, 0.07, 0.13],
    [0.14, 0.34, 0.07, 0.13],
  ] as const) {
    const hole = new THREE.Path()
    hole.absellipse(x, y, radiusX, radiusY, 0, Math.PI * 2, false, 0)
    shape.holes.push(hole)
  }
  const geometry = new THREE.ShapeGeometry(shape, 10)
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

function seeded(level: number, salt: number): number {
  return Math.abs(Math.sin(level * 91.731 + salt * 17.113) * 43758.5453) % 1
}

export function createJungleStationAssets(theme: Theme, tier: RenderTier): JungleStationAssets {
  const islands = STATION_ARCHETYPES.map(islandGeometry)
  const stone = islandMaterial(theme)
  const rootGeometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.1, -0.4, 0.05),
    new THREE.Vector3(-0.07, -0.82, 0.12),
    new THREE.Vector3(0.04, -1.28, 0.2),
  ]), 7, 0.055, 5, false)
  const rootMaterial = new THREE.MeshStandardMaterial({ color: 0x503a25, roughness: 1, flatShading: true })
  const leaf = leafGeometry()
  const leafMaterial = new THREE.MeshStandardMaterial({ color: 0x287548, roughness: 0.9, flatShading: true, side: THREE.DoubleSide })
  const fernMaterial = new THREE.MeshStandardMaterial({ color: 0x5cae58, roughness: 0.88, flatShading: true, side: THREE.DoubleSide })
  const vineGeometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.14, 0.35, 0.08),
    new THREE.Vector3(-0.1, 0.72, 0.14),
    new THREE.Vector3(0.16, 1.08, 0.05),
    new THREE.Vector3(-0.08, 1.42, 0.12),
  ]), 12, 0.028, 5, false)
  const vineMaterial = new THREE.MeshStandardMaterial({ color: 0x2c6b35, roughness: 1 })
  const petal = flowerGeometry()
  const flowerPink = new THREE.MeshStandardMaterial({ color: 0xd84f77, roughness: 0.72, flatShading: true })
  const flowerOrange = new THREE.MeshStandardMaterial({ color: 0xee8d35, roughness: 0.72, flatShading: true })
  const flowerBlue = new THREE.MeshStandardMaterial({ color: 0x557dcc, roughness: 0.72, flatShading: true })
  const flowerCentreMaterial = new THREE.MeshStandardMaterial({ color: 0xf2c94c, roughness: 0.68 })
  const flowerCentreGeometry = new THREE.SphereGeometry(0.12, 7, 5)
  const fracturedStones = [0, 1, 2].map(fracturedStoneGeometry)
  const monsteraStemGeometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.04, 0.22, 0),
    new THREE.Vector3(-0.03, 0.46, 0.03),
    new THREE.Vector3(0.06, 0.68, 0),
  ]), 7, 0.018, 4, false)
  const monsteraLeaf = monsteraMonkeyLeafGeometry()
  const monsteraMaterial = new THREE.MeshStandardMaterial({ color: 0x348a4c, roughness: 0.88, flatShading: true, side: THREE.DoubleSide })
  const blendedStoneMaterial = new THREE.MeshStandardMaterial({ color: 0x696d68, roughness: 1, flatShading: true })
  const ruinMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uStone: { value: new THREE.Color() },
      uMoss: { value: new THREE.Color() },
      uLight: { value: new THREE.Vector3(0.35, 0.82, 0.44).normalize() },
      uAmbient: { value: 0.52 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPosition;
      varying vec3 vNormal;
      ${GLSL_NOISE}
      void main() {
        vec3 p = position + normal * (noise3(position * 5.0 + 3.0) - 0.5) * 0.055;
        vPosition = p;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uStone;
      uniform vec3 uMoss;
      uniform vec3 uLight;
      uniform float uAmbient;
      varying vec3 vPosition;
      varying vec3 vNormal;
      ${GLSL_NOISE}
      void main() {
        float cracks = smoothstep(0.38, 0.46, abs(noise3(vPosition * 8.0) - 0.5));
        float moss = smoothstep(0.48, 0.74, fbm(vPosition * 2.4) + max(vNormal.y, 0.0) * 0.4);
        vec3 color = mix(uStone * (0.68 + cracks * 0.32), uMoss, moss * 0.72);
        float light = uAmbient + max(dot(normalize(vNormal), uLight), 0.0) * (1.0 - uAmbient);
        gl_FragColor = vec4(color * light, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const lichenGeometry = new THREE.CircleGeometry(0.12, 8)
  const lichenMaterial = new THREE.MeshBasicMaterial({ color: 0xa6b66d, side: THREE.DoubleSide })
  const animatedLeaves: THREE.Group[] = []
  const qualityGroups: THREE.Group[] = []
  const materials = [stone, rootMaterial, leafMaterial, fernMaterial, vineMaterial, flowerPink, flowerOrange, flowerBlue, flowerCentreMaterial, ruinMaterial, lichenMaterial, monsteraMaterial, blendedStoneMaterial]
  const geometries = [...islands, rootGeometry, leaf, vineGeometry, petal, flowerCentreGeometry, ...fracturedStones, monsteraStemGeometry, monsteraLeaf, lichenGeometry]

  const setTheme = (next: Theme) => {
    const light = next === 'light'
    stone.uniforms.uStone.value.setHex(light ? 0x716858 : 0x62685b)
    stone.uniforms.uStoneDark.value.setHex(light ? 0x363c35 : 0x343c36)
    stone.uniforms.uMoss.value.setHex(light ? 0x285f39 : 0x286044)
    stone.uniforms.uMossBright.value.setHex(light ? 0x609647 : 0x5b9854)
    stone.uniforms.uAmbient.value = light ? 0.64 : 0.72
    ruinMaterial.uniforms.uStone.value.setHex(light ? 0x817969 : 0x70736a)
    ruinMaterial.uniforms.uMoss.value.setHex(light ? 0x3d7447 : 0x3e7650)
    ruinMaterial.uniforms.uAmbient.value = light ? 0.52 : 0.64
    rootMaterial.color.setHex(light ? 0x5b4028 : 0x684c31)
    leafMaterial.color.setHex(light ? 0x237044 : 0x318856)
    fernMaterial.color.setHex(light ? 0x58a94f : 0x65ad59)
    vineMaterial.color.setHex(light ? 0x2e7438 : 0x347b48)
    monsteraMaterial.color.setHex(light ? 0x348a4c : 0x429a5c)
    blendedStoneMaterial.color.setHex(light ? 0x747771 : 0x767b75)
    lichenMaterial.color.setHex(light ? 0xa0ad66 : 0x98aa68)
  }

  const addFlower = (parent: THREE.Group, level: number, index: number, radius: number) => {
    const flower = new THREE.Group()
    const variant = stationFlowerVariant(level, index)
    const petalMaterial = [flowerPink, flowerOrange, flowerBlue][(level + index) % 3]
    const petalCount = variant === 'orchid' ? 3 : variant === 'torch-flower' ? 6 : 5
    for (let petalIndex = 0; petalIndex < petalCount; petalIndex++) {
      const petalMesh = new THREE.Mesh(petal, petalMaterial)
      const angle = petalIndex / petalCount * Math.PI * 2
      const reach = variant === 'orchid' ? (petalIndex === 1 ? 0.24 : 0.18) : variant === 'torch-flower' ? 0.12 + petalIndex * 0.018 : 0.17
      petalMesh.position.set(Math.cos(angle) * reach, variant === 'torch-flower' ? petalIndex * 0.035 : 0, Math.sin(angle) * reach)
      petalMesh.rotation.set(variant === 'orchid' ? (petalIndex - 1) * 0.22 : 0, -angle, variant === 'torch-flower' ? 0.55 : 0)
      if (variant === 'orchid') petalMesh.scale.set(petalIndex === 1 ? 1.45 : 0.9, 1, petalIndex === 1 ? 0.72 : 1)
      if (variant === 'torch-flower') petalMesh.scale.set(0.62, 0.82, 1.18)
      flower.add(petalMesh)
    }
    const centre = new THREE.Mesh(flowerCentreGeometry, flowerCentreMaterial)
    centre.scale.setScalar(variant === 'torch-flower' ? 0.72 : variant === 'orchid' ? 1.18 : 1)
    flower.add(centre)
    const angle = seeded(level, index + 151) * Math.PI * 2
    flower.position.set(Math.cos(angle) * radius, 0.44 + seeded(level, index + 161) * 0.18, Math.sin(angle) * radius)
    flower.rotation.y = seeded(level, index + 171) * Math.PI
    flower.scale.setScalar(0.68 + seeded(level, index + 181) * 0.48)
    parent.add(flower)
  }

  const addBrokenStones = (parent: THREE.Group, level: number, count: number, radius: number, material: THREE.Material = ruinMaterial) => {
    for (let index = 0; index < count; index++) {
      const angle = seeded(level, index + 201) * Math.PI * 2
      const block = new THREE.Mesh(fracturedStones[(level + index) % fracturedStones.length], material)
      block.position.set(Math.cos(angle) * radius, 0.18 + seeded(level, index + 211) * 0.16, Math.sin(angle) * radius)
      block.rotation.set(seeded(level, index + 221) * 1.1, angle, (seeded(level, index + 231) - 0.5) * 1.25)
      block.scale.set(0.52 + seeded(level, index + 241) * 0.72, 0.42 + seeded(level, index + 251) * 0.58, 0.58 + seeded(level, index + 261) * 0.68)
      parent.add(block)
      if (index % 2 === 0) {
        const lichen = new THREE.Mesh(lichenGeometry, lichenMaterial)
        lichen.position.copy(block.position).add(new THREE.Vector3(0, block.scale.y * 0.52 + 0.05, 0))
        lichen.rotation.x = -Math.PI / 2
        lichen.scale.setScalar(0.7 + seeded(level, index + 271) * 1.2)
        parent.add(lichen)
      }
    }
  }

  const addMonsteraMonkey = (parent: THREE.Group, level: number, count: number, radius: number) => {
    for (let index = 0; index < count; index++) {
      const plant = new THREE.Group()
      plant.add(new THREE.Mesh(monsteraStemGeometry, vineMaterial))
      const monkeyLeaf = new THREE.Mesh(monsteraLeaf, monsteraMaterial)
      monkeyLeaf.position.set(0.04, 0.72, 0)
      monkeyLeaf.rotation.z = (seeded(level, index + 461) - 0.5) * 0.4
      monkeyLeaf.scale.setScalar(0.42 + seeded(level, index + 471) * 0.12)
      plant.add(monkeyLeaf)
      const angle = seeded(level, index + 451) * Math.PI * 2
      plant.position.set(Math.cos(angle) * radius, 0.18, Math.sin(angle) * radius)
      plant.rotation.y = -angle + seeded(level, index + 481) * 0.7
      plant.scale.setScalar(0.86 + seeded(level, index + 491) * 0.28)
      parent.add(plant)
    }
  }

  const addClimbingVines = (parent: THREE.Group, level: number, count: number, radius: number) => {
    for (let index = 0; index < count; index++) {
      const angle = seeded(level, index + 281) * Math.PI * 2
      const vine = new THREE.Mesh(vineGeometry, vineMaterial)
      vine.position.set(Math.cos(angle) * radius, 0.18, Math.sin(angle) * radius)
      vine.rotation.y = -angle
      vine.scale.setScalar(0.82 + seeded(level, index + 291) * 0.5)
      parent.add(vine)
      for (let leafIndex = 0; leafIndex < 3; leafIndex++) {
        const vineLeaf = new THREE.Mesh(leaf, leafIndex % 2 ? fernMaterial : leafMaterial)
        vineLeaf.position.set(vine.position.x, 0.46 + leafIndex * 0.34, vine.position.z)
        vineLeaf.rotation.set(0.12, -angle + leafIndex * 1.7, leafIndex % 2 ? 0.35 : -0.35)
        vineLeaf.scale.setScalar(0.34 + leafIndex * 0.06)
        parent.add(vineLeaf)
      }
    }
  }

  const create = (level: number, milestone: boolean) => {
    const group = new THREE.Group()
    const archetype = stationArchetype(level)
    const profile = stationDetailProfile(level, milestone)
    group.userData.stationArchetype = archetype
    const islandMesh = new THREE.Mesh(islands[STATION_ARCHETYPES.indexOf(archetype)], stone)
    islandMesh.rotation.y = seeded(level, 1) * Math.PI
    islandMesh.scale.setScalar(milestone ? 1.22 : 1)
    group.add(islandMesh)

    const detail = new THREE.Group()
    for (let index = 0; index < profile.roots; index++) {
      const angle = seeded(level, index + 3) * Math.PI * 2
      const root = new THREE.Mesh(rootGeometry, rootMaterial)
      root.position.set(Math.cos(angle) * (0.62 + seeded(level, index + 9) * 0.8), -0.38, Math.sin(angle) * (0.62 + seeded(level, index + 9) * 0.8))
      root.scale.set(0.72 + seeded(level, index + 12) * 0.7, 0.7 + seeded(level, index + 17) * 1.4, 0.72 + seeded(level, index + 12) * 0.7)
      root.rotation.z = (seeded(level, index + 21) - 0.5) * 0.28
      detail.add(root)
    }

    const leaves = new THREE.Group()
    for (let index = 0; index < profile.leaves; index++) {
      const angle = seeded(level, index + 31) * Math.PI * 2
      const radius = 1.18 + seeded(level, index + 41) * 0.42
      const leafMesh = new THREE.Mesh(leaf, index % 3 === 0 ? fernMaterial : leafMaterial)
      leafMesh.position.set(Math.cos(angle) * radius, 0.2 + seeded(level, index + 51) * 0.22, Math.sin(angle) * radius)
      leafMesh.rotation.set(-0.12 + seeded(level, index + 61) * 0.38, -angle + Math.PI / 2, (seeded(level, index + 71) - 0.5) * 0.42)
      leafMesh.scale.setScalar(0.72 + seeded(level, index + 81) * 0.7)
      leaves.add(leafMesh)
    }
    leaves.userData.phase = seeded(level, 99) * Math.PI * 2
    animatedLeaves.push(leaves)
    detail.add(leaves)

    if (profile.vines) addClimbingVines(detail, level, profile.vines, 1.02)
    if (profile.stones) addBrokenStones(detail, level, profile.stones, 1.12, archetype === 'vine-ruin' ? blendedStoneMaterial : ruinMaterial)
    for (let index = 0; index < profile.flowers; index++) {
      addFlower(detail, level, index, 1.18 + seeded(level, index + 301) * 0.24)
    }
    if (profile.monstera) addMonsteraMonkey(detail, level, profile.monstera, 1.38)
    qualityGroups.push(detail)
    group.add(detail)
    return group
  }

  const setQuality = (next: RenderTier) => {
    qualityGroups.forEach((group) => { group.visible = next !== 'low' })
  }

  setTheme(theme)
  setQuality(tier)
  return {
    create,
    setTheme,
    setQuality,
    update(time) {
      stone.uniforms.uTime.value = time
      animatedLeaves.forEach((leaves) => {
        leaves.rotation.z = Math.sin(time * 0.72 + Number(leaves.userData.phase)) * 0.018
      })
    },
    dispose() {
      geometries.forEach((geometry) => geometry.dispose())
      materials.forEach((material) => material.dispose())
    },
  }
}
