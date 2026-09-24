import * as THREE from 'three'
import type { Theme } from '../../providers/ThemeProvider'
import type { RenderTier } from '../Yuvi-studio/renderTier'

const SNOW_TYPES = ['snowy-grove', 'ski-stop', 'ice-camp'] as const
export type SnowStationArchetype = typeof SNOW_TYPES[number]

export function snowStationArchetype(level: number): SnowStationArchetype | null {
  return Number.isInteger(level) && level >= 41 && level <= 50 ? SNOW_TYPES[(level - 41) % 3] : null
}

function surface(kind: number, base: number, accent: number) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uKind: { value: kind }, uBase: { value: new THREE.Color(base) },
      uAccent: { value: new THREE.Color(accent) }, uAmbient: { value: 0.72 },
    },
    vertexShader: `
      varying vec3 vPosition;
      varying vec3 vNormal;
      varying vec2 vUv;
      void main() {
        vPosition = position;
        vNormal = normalize(normalMatrix * normal);
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uKind;
      uniform vec3 uBase;
      uniform vec3 uAccent;
      uniform float uAmbient;
      varying vec3 vPosition;
      varying vec3 vNormal;
      varying vec2 vUv;
      float hash(vec2 point) { return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        float grain = hash(floor(vUv * 400.0));
        vec3 color = uBase;
        if (uKind < 0.5 || uKind > 6.5) {
          float ridge = sin(vPosition.x * 28.0 + sin(vPosition.z * 13.0) * 1.8);
          color = mix(uBase, uAccent, 0.07 + grain * 0.08 + ridge * 0.035);
          if (uKind > 6.5) {
            vec2 blocks = vUv * vec2(14.0, 5.0);
            blocks.x += mod(floor(blocks.y), 2.0) * 0.5;
            vec2 edge = abs(fract(blocks) - 0.5);
            float mortar = smoothstep(0.43, 0.49, max(edge.x, edge.y));
            color = mix(color, uAccent, mortar * 0.8);
          }
        } else if (uKind < 1.5) {
          float fracture = 1.0 - smoothstep(0.018, 0.065, abs(sin(vPosition.y * 17.0 + vPosition.x * 12.0 + sin(vPosition.z * 21.0))));
          color = mix(uBase, uAccent, fracture * 0.4 + grain * 0.1);
          color *= 0.88 + vUv.y * 0.12;
        } else if (uKind < 2.5) {
          float needles = sin(vUv.x * 170.0 + vUv.y * 95.0);
          color = mix(uBase, uAccent, 0.15 + needles * 0.12 + grain * 0.1);
        } else if (uKind < 3.5) {
          float wood = sin(vPosition.y * 65.0 + sin(vPosition.x * 18.0) * 2.0);
          color = mix(uBase, uAccent, 0.16 + wood * 0.12 + grain * 0.06);
        } else if (uKind < 4.5) {
          color *= 0.78 + pow(0.5 + 0.5 * sin(vUv.x * 6.283), 4.0) * 0.22 + grain * 0.06;
        } else if (uKind < 5.5) {
          float weave = sin(vUv.x * 220.0) * sin(vUv.y * 220.0);
          color *= 0.9 + weave * 0.04 + grain * 0.06;
          float stripe = smoothstep(0.59, 0.61, vUv.y) * (1.0 - smoothstep(0.69, 0.71, vUv.y));
          color = mix(color, uAccent, stripe);
        } else {
          color = mix(uBase, uAccent, vUv.y * 0.65);
        }
        vec3 light = normalize((viewMatrix * vec4(0.35, 0.82, 0.44, 0.0)).xyz);
        vec3 normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
        float shade = uAmbient + max(dot(normal, light), 0.0) * (1.0 - uAmbient);
        if (uKind > 6.5 && !gl_FrontFacing) shade *= 0.28;
        gl_FragColor = vec4(color * (uKind > 5.5 && uKind < 6.5 ? 1.0 : shade), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
}

function iglooGeometry() {
  const positions: number[] = []
  const normals: number[] = []
  const uv: number[] = []
  const indices: number[] = []
  const rows = 32
  const columns = 64
  for (let row = 0; row <= rows; row++) {
    const height = row / rows * 0.55
    const radius = Math.sqrt(Math.max(0, 0.55 ** 2 - height ** 2))
    const opening = height <= 0.16 ? 0.19 : height < 0.35 ? Math.sqrt(0.19 ** 2 - (height - 0.16) ** 2) : 0
    const cut = radius > 0 ? Math.asin(opening / radius) : 0
    for (let column = 0; column <= columns; column++) {
      const angle = cut + column / columns * (Math.PI * 2 - cut * 2)
      const across = Math.sin(angle) * radius
      const depth = Math.cos(angle) * radius
      positions.push(across, height, depth)
      normals.push(across / 0.55, height / 0.55, depth / 0.55)
      uv.push(angle / (Math.PI * 2), row / rows)
      if (row < rows && column < columns) {
        const current = row * (columns + 1) + column
        const above = current + columns + 1
        indices.push(current, current + 1, above, current + 1, above + 1, above)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setIndex(indices)
  return geometry
}

export function createSnowStationAssets(theme: Theme, tier: RenderTier) {
  const snow = surface(0, 0xf2f5f2, 0x93b8c0)
  const ice = surface(1, 0x82c8d4, 0xe9faf6)
  const fir = surface(2, 0x235e4c, 0x69a78a)
  const wood = surface(3, 0xad8760, 0xe3c49a)
  const metal = surface(4, 0xaabec0, 0xe7eeea)
  const dark = surface(4, 0x344947, 0x819b96)
  const coral = surface(5, 0xd95363, 0xf5dfb2)
  const teal = surface(5, 0x248e88, 0xc8e9d8)
  const lamp = surface(6, 0xeab95a, 0xffedbb)
  const blocks = surface(7, 0xe9f0ee, 0x89acb7)
  const materials = [snow, ice, fir, wood, metal, dark, coral, teal, lamp, blocks]
  const baseColors = materials.map((material) => material.uniforms.uBase.value.clone() as THREE.Color)
  const ground = new THREE.CylinderGeometry(1.85, 1.78, 0.2, 48)
  const underside = new THREE.CylinderGeometry(1.78, 1.45, 0.32, 32)
  const box = new THREE.BoxGeometry(1, 1, 1)
  const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 24)
  const cone = new THREE.ConeGeometry(0.5, 1, 12)
  const sphere = new THREE.SphereGeometry(0.5, 16, 12)
  const ring = new THREE.TorusGeometry(0.5, 0.035, 6, 24)
  const plane = new THREE.PlaneGeometry(0.4, 0.27, 8, 2)
  const flagPositions = plane.getAttribute('position')
  for (let index = 0; index < flagPositions.count; index++) {
    const across = flagPositions.getX(index) + 0.2
    flagPositions.setZ(index, Math.sin(across * 12) * across * 0.13)
  }
  plane.computeVertexNormals()
  const runner = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.025, -0.39), new THREE.Vector3(0, 0.025, 0.2),
    new THREE.Vector3(0, 0.055, 0.38), new THREE.Vector3(0, 0.16, 0.47), new THREE.Vector3(0, 0.22, 0.39),
  ]), 24, 0.022, 6, false)
  const ski = new THREE.BoxGeometry(0.12, 1.2, 0.025, 1, 12, 1)
  const skiPositions = ski.getAttribute('position')
  for (let index = 0; index < skiPositions.count; index++) {
    const height = skiPositions.getY(index)
    const tip = Math.max(0, height - 0.38) / 0.22
    skiPositions.setX(index, skiPositions.getX(index) * (1 - tip * 0.2))
    skiPositions.setZ(index, skiPositions.getZ(index) + tip * tip * 0.09)
  }
  ski.computeVertexNormals()
  const dome = iglooGeometry()
  const arch = new THREE.Shape()
  arch.moveTo(-0.25, 0)
  arch.lineTo(-0.25, 0.16)
  arch.absarc(0, 0.16, 0.25, Math.PI, 0, true)
  arch.lineTo(0.25, 0)
  arch.lineTo(0.19, 0)
  arch.lineTo(0.19, 0.16)
  arch.absarc(0, 0.16, 0.19, 0, Math.PI, false)
  arch.lineTo(-0.19, 0)
  arch.closePath()
  const tunnel = new THREE.ExtrudeGeometry(arch, { depth: 0.3, bevelEnabled: false, curveSegments: 24, steps: 1 })
  const crystal = new THREE.CylinderGeometry(0.1, 0.14, 0.65, 6)
  const crystalTip = new THREE.ConeGeometry(0.1, 0.2, 6)
  const geometries = [ground, underside, box, cylinder, cone, sphere, ring, plane, runner, ski, dome, tunnel, crystal, crystalTip]
  const fineDetails: THREE.Group[] = []
  let currentTier = tier
  const mesh = (parent: THREE.Object3D, name: string, geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number], scale: [number, number, number] = [1, 1, 1]) => {
    const object = new THREE.Mesh(geometry, material)
    object.name = name
    object.position.set(...position)
    object.scale.set(...scale)
    parent.add(object)
    return object
  }
  const setTheme = (next: Theme) => {
    materials.forEach((material, index) => {
      material.uniforms.uBase.value.copy(baseColors[index]).multiplyScalar(next === 'dark' ? 1.08 : 1)
      material.uniforms.uAmbient.value = material === blocks ? 0.46 : next === 'dark' ? 0.82 : 0.72
    })
  }
  const setQuality = (next: RenderTier) => {
    currentTier = next
    fineDetails.forEach((detail) => { detail.visible = next !== 'low' })
  }
  const create = (level: number, milestone: boolean) => {
    const archetype = snowStationArchetype(level)
    if (!archetype) throw new RangeError('Snow stations cover levels 41 through 50')
    const station = new THREE.Group()
    station.name = `snow-station-${level}`
    station.userData.stationArchetype = archetype
    station.scale.setScalar(milestone ? 1.22 : 1)
    mesh(station, 'snow-ground', ground, snow, [0, -0.13, 0], [1, 2.1, 1])
    mesh(station, 'snow-ice-edge', underside, ice, [0, -0.5, 0])
    for (let index = 0; index < 16; index++) {
      const angle = index / 16 * Math.PI * 2
      const bank = mesh(station, 'snowbank', sphere, snow, [Math.cos(angle) * 1.52, 0.035, Math.sin(angle) * 1.52], [0.56, 0.26 + (index % 3) * 0.045, 0.43])
      bank.rotation.y = -angle
    }
    const detail = new THREE.Group()
    detail.name = 'snow-fine-detail'
    detail.visible = currentTier !== 'low'
    station.add(detail)
    fineDetails.push(detail)
    const place = (prop: THREE.Group, angle: number, targetSize = 1.7) => {
      prop.updateMatrixWorld(true)
      const bounds = new THREE.Box3().setFromObject(prop)
      const size = bounds.getSize(new THREE.Vector3())
      const scale = Math.min(targetSize / (Math.max(size.x, size.y, size.z) * station.scale.x), 0.52 / Math.hypot(size.x / 2, size.z / 2))
      const radians = THREE.MathUtils.degToRad(angle)
      prop.scale.setScalar(scale)
      prop.position.set(Math.cos(radians) * 1.27 - (bounds.min.x + bounds.max.x) * scale / 2, 0.08 - bounds.min.y * scale, Math.sin(radians) * 1.27 - (bounds.min.z + bounds.max.z) * scale / 2)
      prop.userData.snowProp = true
      station.add(prop)
    }
    const variation = Math.sin(level * 13.17) * 0.08
    if (archetype === 'snowy-grove') {
      const tree = new THREE.Group()
      tree.name = 'snow-fir'
      mesh(tree, 'fir-trunk', cylinder, wood, [0, 0.25, 0], [0.12, 0.5, 0.12])
      for (let index = 0; index < 3; index++) {
        const width = 0.9 - index * 0.23
        const height = 0.57 + index * 0.3
        mesh(tree, 'fir-branch-tier', cone, fir, [0, height, 0], [width, 0.62, width]).rotation.y = index * 0.35 + variation
        mesh(tree, 'fir-snow-cap', cone, snow, [0, height + 0.085, 0], [width * 0.94, 0.62, width * 0.94]).rotation.y = index * 0.35 + variation
      }
      place(tree, -110)
      const sled = new THREE.Group()
      sled.name = 'snow-sled'
      for (const side of [-1, 1]) {
        mesh(sled, 'sled-runner', runner, metal, [side * 0.23, 0, 0])
        for (const depth of [-0.23, 0.19]) mesh(sled, 'sled-support', cylinder, coral, [side * 0.23, 0.14, depth], [0.035, 0.23, 0.035])
      }
      for (let index = 0; index < 4; index++) mesh(sled, 'sled-seat-slat', box, wood, [(index - 1.5) * 0.12, 0.27, -0.04], [0.1, 0.055, 0.67])
      for (const depth of [-0.23, 0.19]) mesh(sled, 'sled-crossbar', box, coral, [0, 0.22, depth], [0.51, 0.04, 0.04])
      mesh(sled, 'sled-snow', sphere, snow, [0, 0.32, -0.19], [0.44, 0.11, 0.26])
      place(sled, -10)
      const lantern = new THREE.Group()
      lantern.name = 'snow-lantern'
      mesh(lantern, 'lantern-base', cylinder, dark, [0, 0.06, 0], [0.31, 0.12, 0.31])
      mesh(lantern, 'lantern-light', cylinder, lamp, [0, 0.26, 0], [0.22, 0.29, 0.22])
      for (const across of [-1, 1]) for (const depth of [-1, 1]) mesh(lantern, 'lantern-frame', cylinder, dark, [across * 0.105, 0.27, depth * 0.105], [0.022, 0.35, 0.022])
      mesh(lantern, 'lantern-roof', cone, coral, [0, 0.47, 0], [0.36, 0.17, 0.36])
      mesh(lantern, 'lantern-roof-snow', cone, snow, [0, 0.505, 0], [0.3, 0.14, 0.3])
      mesh(lantern, 'lantern-handle', ring, dark, [0, 0.61, 0], [0.24, 0.24, 0.24])
      place(lantern, 70, 1.1)
      const snowman = new THREE.Group()
      snowman.name = 'snowman'
      mesh(snowman, 'snowman-base', sphere, snow, [0, 0.26, 0], [0.64, 0.52, 0.6])
      mesh(snowman, 'snowman-body', sphere, snow, [0, 0.62, 0], [0.48, 0.48, 0.46])
      mesh(snowman, 'snowman-head', sphere, snow, [0, 0.94, 0], [0.35, 0.35, 0.34])
      mesh(snowman, 'snowman-scarf', cylinder, coral, [0, 0.805, 0], [0.37, 0.09, 0.35])
      mesh(snowman, 'snowman-scarf-tail', box, coral, [0.12, 0.68, 0.205], [0.085, 0.27, 0.035]).rotation.z = -0.15
      for (const side of [-1, 1]) {
        mesh(snowman, 'snowman-eye', sphere, dark, [side * 0.065, 0.98, 0.148], [0.037, 0.037, 0.025])
        mesh(snowman, 'snowman-arm', cylinder, wood, [side * 0.27, 0.66, 0], [0.027, 0.23, 0.027]).rotation.z = side * -0.85
      }
      mesh(snowman, 'snowman-carrot', cone, wood, [0, 0.935, 0.22], [0.075, 0.19, 0.075]).rotation.x = Math.PI / 2
      for (const height of [0.58, 0.68]) mesh(snowman, 'snowman-button', sphere, dark, [0, height, 0.224], [0.035, 0.035, 0.024])
      mesh(snowman, 'snowman-hat-brim', cylinder, dark, [0, 1.085, 0], [0.44, 0.04, 0.42])
      mesh(snowman, 'snowman-hat', cylinder, dark, [0, 1.185, 0], [0.28, 0.19, 0.27])
      mesh(snowman, 'snowman-hat-snow', sphere, snow, [0, 1.29, 0], [0.29, 0.075, 0.28])
      place(snowman, 160)
    } else if (archetype === 'ski-stop') {
      const rack = new THREE.Group()
      rack.name = 'snow-ski-rack'
      mesh(rack, 'ski-rack-base', box, wood, [0, 0.045, 0], [0.6, 0.09, 0.35])
      for (const side of [-1, 1]) {
        mesh(rack, 'ski-rack-post', box, wood, [side * 0.25, 0.4, -0.07], [0.055, 0.75, 0.055])
        mesh(rack, 'curved-ski', ski, level % 2 ? teal : coral, [side * 0.1, 0.68, 0.04]).rotation.z = side * 0.045
        for (const height of [0.47, 0.67]) mesh(rack, 'ski-binding', box, dark, [side * 0.1, height, 0.08], [0.095, 0.065, 0.09])
        mesh(rack, 'ski-pole', cylinder, metal, [side * 0.31, 0.54, 0], [0.018, 1.02, 0.018])
        mesh(rack, 'ski-pole-grip', cylinder, dark, [side * 0.31, 1.01, 0], [0.038, 0.14, 0.038])
        mesh(rack, 'ski-pole-basket', ring, dark, [side * 0.31, 0.16, 0], [0.1, 0.1, 0.1]).rotation.x = Math.PI / 2
      }
      mesh(rack, 'ski-rack-crossbar', box, wood, [0, 0.72, -0.065], [0.57, 0.065, 0.08])
      place(rack, -115)
      const bench = new THREE.Group()
      bench.name = 'snow-bench'
      for (const side of [-1, 1]) {
        for (const depth of [-1, 1]) mesh(bench, 'bench-leg', box, dark, [side * 0.36, 0.22, depth * 0.13], [0.05, 0.44, 0.05])
        mesh(bench, 'bench-back-post', box, dark, [side * 0.36, 0.56, -0.15], [0.045, 0.64, 0.045])
      }
      mesh(bench, 'bench-seat', box, wood, [0, 0.45, 0], [0.95, 0.07, 0.37])
      mesh(bench, 'bench-seat-snow', sphere, snow, [0, 0.51, 0], [1.0, 0.19, 0.4])
      mesh(bench, 'bench-back', box, wood, [0, 0.73, -0.15], [0.95, 0.23, 0.055])
      mesh(bench, 'bench-back-snow', sphere, snow, [0, 0.865, -0.15], [1.0, 0.13, 0.13])
      place(bench, 5)
      const pack = new THREE.Group()
      pack.name = 'snow-backpack'
      mesh(pack, 'backpack-body', sphere, coral, [0, 0.34, 0], [0.46, 0.67, 0.31])
      mesh(pack, 'backpack-base', box, dark, [0, 0.06, 0], [0.31, 0.08, 0.22])
      mesh(pack, 'backpack-flap', sphere, coral, [0, 0.54, 0.07], [0.46, 0.21, 0.27])
      mesh(pack, 'backpack-pocket', sphere, teal, [0, 0.24, 0.13], [0.3, 0.23, 0.13])
      for (const side of [-1, 1]) {
        mesh(pack, 'backpack-strap', box, dark, [side * 0.12, 0.35, -0.16], [0.04, 0.43, 0.035])
        mesh(pack, 'backpack-buckle', box, metal, [side * 0.12, 0.39, 0.153], [0.055, 0.075, 0.02])
      }
      mesh(pack, 'backpack-handle', ring, dark, [0, 0.65, 0], [0.19, 0.14, 0.19])
      place(pack, 125, 1.1)
    } else {
      const igloo = new THREE.Group()
      igloo.name = 'snow-igloo'
      mesh(igloo, 'igloo-dome', dome, blocks, [0, 0, 0])
      mesh(igloo, 'igloo-entrance', tunnel, blocks, [0, 0, 0.44])
      place(igloo, -115)
      const cluster = new THREE.Group()
      cluster.name = 'snow-crystals'
      for (let index = 0; index < 3; index++) {
        const shard = new THREE.Group()
        shard.position.set((index - 1) * 0.22, 0, index === 1 ? -0.06 : 0.03)
        shard.scale.setScalar(index === 1 ? 1 : 0.65 + variation)
        mesh(shard, 'ice-crystal-shaft', crystal, ice, [0, 0.325, 0])
        mesh(shard, 'ice-crystal-tip', crystalTip, ice, [0, 0.75, 0])
        cluster.add(shard)
      }
      place(cluster, 5)
      const flag = new THREE.Group()
      flag.name = 'snow-expedition-flag'
      mesh(flag, 'flag-foot', cylinder, dark, [0, 0.025, 0], [0.26, 0.05, 0.26])
      mesh(flag, 'flag-pole', cylinder, metal, [0, 0.55, 0], [0.028, 1.1, 0.028])
      mesh(flag, 'flag-fabric', plane, level % 2 ? coral : teal, [0.2, 0.91, 0])
      place(flag, 125)
    }
    for (let index = 0; index < 3; index++) {
      const angle = THREE.MathUtils.degToRad(level * 11 + index * 100)
      mesh(detail, 'snow-rim-drift', sphere, snow, [Math.cos(angle) * 1.65, 0.085, Math.sin(angle) * 1.65], [0.17, 0.055, 0.13])
    }
    return station
  }
  setTheme(theme)
  return {
    create, setTheme, setQuality,
    dispose() {
      geometries.forEach((geometry) => geometry.dispose())
      materials.forEach((material) => material.dispose())
      fineDetails.length = 0
    },
  }
}