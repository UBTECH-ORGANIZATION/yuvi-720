import * as THREE from 'three'
import type { Theme } from '../../providers/ThemeProvider'
import type { RenderTier } from '../Yuvi-studio/renderTier'

const GRAFFITI_TYPES = ['mural-corner', 'skate-spot', 'street-art-studio'] as const
const ART_STYLES = ['bubble', 'angular', 'stencil', 'comic', 'ribbon'] as const
export type GraffitiStationArchetype = typeof GRAFFITI_TYPES[number]

export function graffitiStationArchetype(level: number): GraffitiStationArchetype | null {
  return Number.isInteger(level) && level >= 31 && level <= 40 ? GRAFFITI_TYPES[(level - 31) % 3] : null
}

export function graffitiArtStyle(level: number) {
  return graffitiStationArchetype(level) ? ART_STYLES[(level - 31) % ART_STYLES.length] : null
}

function surface(kind: number, base: number, accent: number, pattern = 0) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uKind: { value: kind }, uBase: { value: new THREE.Color(base) },
      uAccent: { value: new THREE.Color(accent) }, uPattern: { value: pattern }, uAmbient: { value: 0.72 },
    },
    vertexShader: `
      varying vec3 vPosition;
      varying vec3 vNormal;
      varying vec3 vLocalNormal;
      varying vec2 vUv;
      void main() {
        vPosition = position;
        vNormal = normalize(normalMatrix * normal);
        vLocalNormal = normal;
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uKind;
      uniform vec3 uBase;
      uniform vec3 uAccent;
      uniform float uPattern;
      uniform float uAmbient;
      varying vec3 vPosition;
      varying vec3 vNormal;
      varying vec3 vLocalNormal;
      varying vec2 vUv;
      float hash(vec2 point) { return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453); }
      float stroke(vec2 point, vec2 start, vec2 end, float width) {
        vec2 direction = end - start;
        float progress = clamp(dot(point - start, direction) / dot(direction, direction), 0.0, 1.0);
        return 1.0 - smoothstep(width, width + 0.016, length(point - start - direction * progress));
      }
      vec3 artwork(vec2 point, vec3 background) {
        if (uPattern > 4.5) point.x = 1.0 - point.x;
        float mist = hash(floor(point * 280.0));
        float style = mod(uPattern, 5.0);
        vec3 ink = vec3(0.035, 0.055, 0.065);
        vec3 warm = uPattern > 4.5 ? vec3(0.98, 0.69, 0.1) : vec3(0.95, 0.16, 0.29);
        vec3 color = background;
        if (style < 0.5) {
          float bubbles = min(length((point - vec2(0.3, 0.52)) * vec2(1.0, 0.8)) - 0.19,
            min(length((point - vec2(0.51, 0.58)) * vec2(1.0, 0.85)) - 0.2,
            length((point - vec2(0.72, 0.48)) * vec2(1.0, 0.85)) - 0.17));
          color = mix(color, ink, 1.0 - smoothstep(0.018, 0.03, bubbles));
          color = mix(color, mix(uAccent, warm, smoothstep(0.38, 0.7, point.y)), 1.0 - smoothstep(-0.01, 0.005, bubbles));
          float shine = stroke(point, vec2(0.23, 0.62), vec2(0.28, 0.66), 0.012);
          shine += stroke(point, vec2(0.44, 0.72), vec2(0.5, 0.74), 0.012);
          color = mix(color, vec3(0.98), clamp(shine, 0.0, 1.0));
        } else if (style < 1.5) {
          float zig = max(stroke(point, vec2(0.12, 0.27), vec2(0.39, 0.75), 0.075),
            max(stroke(point, vec2(0.39, 0.75), vec2(0.53, 0.28), 0.065), stroke(point, vec2(0.53, 0.28), vec2(0.83, 0.73), 0.07)));
          float outline = max(stroke(point, vec2(0.12, 0.27), vec2(0.39, 0.75), 0.103),
            max(stroke(point, vec2(0.39, 0.75), vec2(0.53, 0.28), 0.093), stroke(point, vec2(0.53, 0.28), vec2(0.83, 0.73), 0.098)));
          color = mix(color, ink, outline);
          color = mix(color, uAccent, zig);
          float arrow = max(stroke(point, vec2(0.64, 0.72), vec2(0.83, 0.73), 0.027), stroke(point, vec2(0.83, 0.73), vec2(0.84, 0.51), 0.027));
          color = mix(color, warm, max(arrow, stroke(point, vec2(0.2, 0.43), vec2(0.76, 0.54), 0.024)));
        } else if (style < 2.5) {
          vec2 centered = point - vec2(0.49, 0.52);
          float angle = atan(centered.y, centered.x) - 1.5708;
          float radius = mix(0.12, 0.32, pow(0.5 + 0.5 * cos(angle * 5.0), 1.5));
          float star = 1.0 - smoothstep(radius, radius + 0.012, length(centered));
          float halo = 1.0 - smoothstep(0.02, 0.033, abs(length(centered) - 0.36));
          color = mix(color, uAccent, halo);
          color = mix(color, ink, 1.0 - smoothstep(radius + 0.012, radius + 0.026, length(centered)));
          color = mix(color, warm, star * (0.78 + mist * 0.22));
          float stripes = step(0.55, fract((point.x + point.y) * 12.0));
          color = mix(color, vec3(0.98), star * stripes * 0.22);
        } else if (style < 3.5) {
          vec2 centered = point - 0.5;
          float angle = atan(centered.y, centered.x);
          float burstRadius = 0.29 + 0.09 * pow(0.5 + 0.5 * cos(angle * 11.0), 3.0);
          float burst = 1.0 - smoothstep(burstRadius, burstRadius + 0.012, length(centered));
          color = mix(color, ink, 1.0 - smoothstep(burstRadius + 0.013, burstRadius + 0.025, length(centered)));
          color = mix(color, vec3(0.98, 0.81, 0.16), burst);
          float dots = 1.0 - smoothstep(0.12, 0.22, length(fract(point * 22.0) - 0.5));
          color = mix(color, warm, dots * burst * 0.6);
          float bolt = max(stroke(point, vec2(0.58, 0.76), vec2(0.39, 0.48), 0.044),
            max(stroke(point, vec2(0.39, 0.48), vec2(0.59, 0.51), 0.038), stroke(point, vec2(0.59, 0.51), vec2(0.43, 0.24), 0.044)));
          color = mix(color, ink, bolt);
        } else {
          float wave = 0.5 + sin(point.x * 8.5) * 0.19;
          float ribbon = 1.0 - smoothstep(0.08, 0.097, abs(point.y - wave));
          float second = 1.0 - smoothstep(0.04, 0.055, abs(point.y - (0.49 + sin(point.x * 8.5 + 2.2) * 0.23)));
          float edge = 1.0 - smoothstep(0.104, 0.12, abs(point.y - wave));
          float ends = smoothstep(0.07, 0.12, point.x) * (1.0 - smoothstep(0.88, 0.93, point.x));
          color = mix(color, ink, edge * ends);
          color = mix(color, uAccent, ribbon * ends);
          color = mix(color, warm, second * ends);
        }
        float drip = stroke(point, vec2(0.29, 0.09), vec2(0.29, 0.3), 0.006);
        drip += stroke(point, vec2(0.68, 0.15), vec2(0.68, 0.32), 0.009);
        color = mix(color, uAccent, clamp(drip, 0.0, 1.0) * 0.9);
        return color;
      }
      void main() {
        float grain = hash(floor(vUv * 430.0));
        vec3 color = uBase * (0.91 + grain * 0.09);
        if (uKind < 0.5) {
          float seam = smoothstep(0.48, 0.5, abs(fract(vPosition.x * 1.7) - 0.5));
          color *= 1.0 - seam * 0.14;
          if (vLocalNormal.y > 0.9) {
            vec2 paintUv = vPosition.xz / 2.5 + 0.5;
            float weathering = 0.78 + grain * 0.18;
            color = mix(color, artwork(paintUv, color), weathering);
          }
        } else if (uKind < 1.5) {
          vec2 bricks = vUv * vec2(4.0, 6.0);
          bricks.x += mod(floor(bricks.y), 2.0) * 0.5;
          vec2 edge = abs(fract(bricks) - 0.5);
          float mortar = smoothstep(0.445, 0.49, max(edge.x, edge.y));
          color = mix(color, vec3(0.25, 0.29, 0.3), mortar);
          if (vLocalNormal.z > 0.9) color = artwork(vUv, color);
        } else if (uKind < 2.5) {
          color = artwork(vUv, color);
        } else if (uKind < 3.5) {
          color = mix(color, uAccent, (0.5 + 0.5 * sin(vPosition.y * 70.0 + sin(vPosition.x * 18.0))) * 0.14);
        } else if (uKind < 4.5) {
          float metalSheen = pow(0.5 + 0.5 * sin(vUv.x * 6.283), 5.0);
          color *= 0.72 + metalSheen * 0.36 + hash(floor(vUv * vec2(180.0, 4.0))) * 0.06;
        } else if (uKind > 5.5) {
          float label = step(0.16, vUv.y) * (1.0 - step(0.77, vUv.y));
          color = mix(vec3(0.86, 0.89, 0.87), uBase, label);
          float stripe = step(0.1, fract(vUv.y * 16.0)) * (1.0 - step(0.45, fract(vUv.y * 16.0)));
          float info = step(0.26, vUv.x) * (1.0 - step(0.49, vUv.x)) * step(0.2, vUv.y) * (1.0 - step(0.42, vUv.y));
          color = mix(color, vec3(0.12, 0.16, 0.17), info * stripe);
          float band = step(0.59, vUv.y) * (1.0 - step(0.65, vUv.y));
          color = mix(color, vec3(0.94), band);
          color *= 0.75 + pow(0.5 + 0.5 * sin(vUv.x * 6.283), 4.0) * 0.25;
        }
        vec3 light = normalize((viewMatrix * vec4(0.35, 0.82, 0.44, 0.0)).xyz);
        vec3 normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
        gl_FragColor = vec4(color * (uAmbient + max(dot(normal, light), 0.0) * (1.0 - uAmbient)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
}

export function createGraffitiStationAssets(theme: Theme, tier: RenderTier) {
  const concrete = surface(5, 0xa9b7b8, 0xe2ebea)
  const artSets = Array.from({ length: 10 }, (_, index) => {
    const archetype = graffitiStationArchetype(index + 31)
    const accent = [0x12b9b0, 0x347cd2, 0xdb497a, 0x34a966, 0x11b5cd][index % 5]
    return {
      ground: surface(0, 0xa9b7b8, accent, (index + 2) % 10),
      primary: surface(archetype === 'mural-corner' ? 1 : 2, archetype === 'skate-spot' ? 0x27383d : 0xe3e7dc, accent, index),
      secondary: archetype === 'skate-spot' ? surface(2, 0xe3e7dc, accent, (index + 3) % 10) : null,
    }
  })
  const wood = surface(3, 0xa68e6b, 0xe5d7ba)
  const metal = surface(4, 0xc1cdcc, 0xe4edeb)
  const dark = surface(5, 0x263538, 0x758d8d)
  const teal = surface(5, 0x20c3b4, 0xb1eee2)
  const coral = surface(5, 0xe95065, 0xfab9b6)
  const yellow = surface(5, 0xefd05c, 0xfff0bb)
  const canTeal = surface(6, 0x20c3b4, 0xffffff)
  const canCoral = surface(6, 0xe95065, 0xffffff)
  const canYellow = surface(6, 0xefd05c, 0xffffff)
  const materials = [concrete, wood, metal, dark, teal, coral, yellow, canTeal, canCoral, canYellow,
    ...artSets.flatMap((art) => art.secondary ? [art.ground, art.primary, art.secondary] : [art.ground, art.primary])]
  const baseColors = materials.map((material) => material.uniforms.uBase.value.clone() as THREE.Color)
  const groundGeometry = new THREE.CylinderGeometry(1.85, 1.72, 0.42, 48)
  const box = new THREE.BoxGeometry(1, 1, 1)
  const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 24)
  const plane = new THREE.PlaneGeometry(1, 1)
  const disc = new THREE.CircleGeometry(0.5, 32)
  const canBody = new THREE.LatheGeometry([
    new THREE.Vector2(0, 0.008), new THREE.Vector2(0.06, 0.008),
    new THREE.Vector2(0.071, 0.016), new THREE.Vector2(0.073, 0.03),
    new THREE.Vector2(0.073, 0.315), new THREE.Vector2(0.07, 0.337),
    new THREE.Vector2(0.059, 0.353), new THREE.Vector2(0.04, 0.365),
    new THREE.Vector2(0.03, 0.368), new THREE.Vector2(0, 0.368),
  ], 32)
  const canRim = new THREE.TorusGeometry(0.07, 0.005, 6, 32)
  const valveRim = new THREE.TorusGeometry(0.032, 0.004, 6, 24)
  const handle = new THREE.TorusGeometry(0.23, 0.012, 6, 24, Math.PI)
  const bucket = new THREE.LatheGeometry([
    new THREE.Vector2(0, 0), new THREE.Vector2(0.17, 0),
    new THREE.Vector2(0.22, 0.35), new THREE.Vector2(0.2, 0.35),
    new THREE.Vector2(0.155, 0.04), new THREE.Vector2(0, 0.04),
  ], 28)
  const shape = new THREE.Shape()
  shape.moveTo(-0.17, -0.4)
  shape.bezierCurveTo(-0.17, -0.59, 0.17, -0.59, 0.17, -0.4)
  shape.lineTo(0.17, 0.4)
  shape.bezierCurveTo(0.17, 0.59, -0.17, 0.59, -0.17, 0.4)
  shape.closePath()
  const skateboard = new THREE.ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 2, steps: 1, curveSegments: 12 })
  const positions = skateboard.getAttribute('position')
  const uv = skateboard.getAttribute('uv')
  for (let index = 0; index < positions.count; index++) {
    const height = positions.getY(index)
    positions.setZ(index, positions.getZ(index) + Math.pow(Math.max(0, Math.abs(height) - 0.33), 2) * 1.4)
    uv.setXY(index, positions.getX(index) / 0.36 + 0.5, height / 1.15 + 0.5)
  }
  skateboard.computeVertexNormals()
  const geometries = [groundGeometry, box, cylinder, plane, disc, canBody, canRim, valveRim, handle, bucket, skateboard]
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
  const sprayCan = (parent: THREE.Group, across: number, depth: number, color: THREE.Material) => {
    mesh(parent, 'spray-can-body', canBody, metal, [across, 0, depth])
    const label = color === teal ? canTeal : color === coral ? canCoral : canYellow
    mesh(parent, 'spray-can-label', cylinder, label, [across, 0.174, depth], [0.147, 0.266, 0.147])
    mesh(parent, 'spray-can-base-rim', canRim, metal, [across, 0.014, depth]).rotation.x = Math.PI / 2
    mesh(parent, 'spray-can-valve-rim', valveRim, metal, [across, 0.37, depth]).rotation.x = Math.PI / 2
    mesh(parent, 'spray-can-nozzle', cylinder, concrete, [across, 0.388, depth], [0.044, 0.035, 0.044])
    mesh(parent, 'spray-can-outlet', disc, dark, [across, 0.388, depth + 0.0225], [0.012, 0.012, 1])
  }
  const setTheme = (next: Theme) => {
    materials.forEach((material, index) => {
      material.uniforms.uBase.value.copy(baseColors[index]).multiplyScalar(next === 'dark' ? 1.14 : 1)
      material.uniforms.uAmbient.value = next === 'dark' ? 0.82 : 0.72
    })
  }
  const setQuality = (next: RenderTier) => {
    currentTier = next
    fineDetails.forEach((detail) => { detail.visible = next !== 'low' })
  }
  const create = (level: number, milestone: boolean) => {
    const archetype = graffitiStationArchetype(level)
    if (!archetype) throw new RangeError('Graffiti stations cover levels 31 through 40')
    const station = new THREE.Group()
    station.name = `graffiti-station-${level}`
    station.userData.stationArchetype = archetype
    station.userData.artStyle = graffitiArtStyle(level)
    station.scale.setScalar(milestone ? 1.22 : 1)
    const art = artSets[level - 31]
    mesh(station, 'graffiti-ground', groundGeometry, art.ground, [0, -0.13, 0])
    const detail = new THREE.Group()
    detail.name = 'graffiti-fine-detail'
    detail.visible = currentTier !== 'low'
    station.add(detail)
    fineDetails.push(detail)
    const place = (prop: THREE.Group, angle: number, targetSize = 1.47, wide = false) => {
      prop.updateMatrixWorld(true)
      const bounds = new THREE.Box3().setFromObject(prop)
      const size = bounds.getSize(new THREE.Vector3())
      const radians = THREE.MathUtils.degToRad(angle)
      const centerX = Math.cos(radians) * 1.3
      const centerZ = Math.sin(radians) * 1.3
      let footprintScale = 0.46 / Math.hypot(size.x / 2, size.z / 2)
      if (wide) {
        footprintScale = Infinity
        const squaredRadius = (size.x * size.x + size.z * size.z) / 4
        for (const across of [-size.x / 2, size.x / 2]) {
          for (const depth of [-size.z / 2, size.z / 2]) {
            const projection = centerX * across + centerZ * depth
            const limit = (-projection + Math.sqrt(projection * projection + squaredRadius * (1.78 * 1.78 - 1.3 * 1.3))) / squaredRadius
            footprintScale = Math.min(footprintScale, limit)
          }
        }
        footprintScale = Math.min(footprintScale, 0.48 / (size.z / 2))
      }
      const scale = Math.min(targetSize / (Math.max(size.x, size.y, size.z) * station.scale.x), footprintScale)
      prop.scale.setScalar(scale)
      prop.position.set(centerX - (bounds.min.x + bounds.max.x) * scale / 2, 0.08 - bounds.min.y * scale, centerZ - (bounds.min.z + bounds.max.z) * scale / 2)
      prop.userData.graffitiProp = true
      prop.userData.largeMural = wide
      station.add(prop)
    }
    if (archetype === 'mural-corner') {
      const wall = new THREE.Group()
      wall.name = 'graffiti-mural-wall'
      mesh(wall, 'painted-brick-wall', box, art.primary, [0, 0.49, 0], [1.1, 0.98, 0.16])
      mesh(wall, 'wall-coping', box, concrete, [0, 1, 0], [1.14, 0.06, 0.2])
      place(wall, -90, 1.85, true)
      const cans = new THREE.Group()
      cans.name = 'graffiti-spray-cluster'
      sprayCan(cans, -0.12, 0, teal)
      sprayCan(cans, 0.12, 0.06, coral)
      sprayCan(cans, 0, -0.19, yellow)
      place(cans, 5, 0.85)
      const paintBucket = new THREE.Group()
      paintBucket.name = 'graffiti-paint-bucket'
      mesh(paintBucket, 'paint-bucket-shell', bucket, metal, [0, 0, 0])
      mesh(paintBucket, 'bucket-paint', disc, teal, [0, 0.29, 0], [0.38, 0.38, 1]).rotation.x = -Math.PI / 2
      mesh(paintBucket, 'bucket-handle', handle, dark, [0, 0.3, 0])
      mesh(paintBucket, 'bucket-color-band', cylinder, teal, [0, 0.19, 0], [0.397, 0.11, 0.397])
      place(paintBucket, 125, 0.9)
    } else if (archetype === 'skate-spot') {
      const rack = new THREE.Group()
      rack.name = 'graffiti-skateboard-rack'
      mesh(rack, 'painted-skateboard', skateboard, art.primary, [0, 0.69, 0])
      for (const height of [0.36, 1.02]) {
        mesh(rack, 'skateboard-truck', box, metal, [0, height, 0.105], [0.31, 0.06, 0.12])
        for (const side of [-1, 1]) {
          mesh(rack, 'skateboard-wheel', cylinder, yellow, [side * 0.17, height, 0.14], [0.1, 0.07, 0.1]).rotation.z = Math.PI / 2
        }
      }
      mesh(rack, 'skate-rack-base', box, dark, [0, 0.04, 0], [0.46, 0.08, 0.4])
      for (const side of [-1, 1]) mesh(rack, 'skate-rack-prong', box, metal, [side * 0.11, 0.15, 0.1], [0.035, 0.26, 0.08])
      place(rack, -115)
      const ledge = new THREE.Group()
      ledge.name = 'graffiti-skate-ledge'
      mesh(ledge, 'skate-ledge-block', box, concrete, [0, 0.2, 0], [0.85, 0.4, 0.35])
      mesh(ledge, 'ledge-art', plane, art.secondary!, [0, 0.2, 0.176], [0.83, 0.36, 1])
      mesh(ledge, 'ledge-metal-cap', box, metal, [0, 0.41, 0], [0.89, 0.035, 0.37])
      place(ledge, 5, 1.1)
      const cans = new THREE.Group()
      cans.name = 'graffiti-spray-cluster'
      sprayCan(cans, -0.1, 0, coral)
      sprayCan(cans, 0.1, 0.08, teal)
      place(cans, 125, 0.85)
    } else {
      const easel = new THREE.Group()
      easel.name = 'graffiti-easel'
      for (const side of [-1, 1]) {
        mesh(easel, 'easel-leg', box, wood, [side * 0.23, 0.63, 0], [0.055, 1.25, 0.07]).rotation.z = side * 0.16
      }
      mesh(easel, 'easel-rear-leg', box, wood, [0, 0.57, -0.23], [0.055, 1.18, 0.07]).rotation.x = -0.3
      mesh(easel, 'easel-crossbar', box, wood, [0, 0.32, 0], [0.55, 0.07, 0.08])
      mesh(easel, 'easel-panel', box, wood, [0, 0.94, 0.06], [0.92, 1.02, 0.065])
      mesh(easel, 'easel-painting', plane, art.primary, [0, 0.94, 0.095], [0.88, 0.98, 1])
      mesh(easel, 'easel-shelf', box, wood, [0, 0.425, 0.08], [0.97, 0.055, 0.17])
      place(easel, -90, 1.85, true)
      const tray = new THREE.Group()
      tray.name = 'graffiti-roller-tray'
      mesh(tray, 'roller-tray-base', box, dark, [0, 0.025, 0], [0.42, 0.05, 0.62])
      mesh(tray, 'tray-paint', plane, coral, [0, 0.055, -0.12], [0.34, 0.29, 1]).rotation.x = -Math.PI / 2
      for (const side of [-1, 1]) {
        mesh(tray, 'tray-side-rim', box, dark, [side * 0.2, 0.065, 0], [0.03, 0.08, 0.62])
        mesh(tray, 'tray-end-rim', box, dark, [0, 0.065, side * 0.3], [0.4, 0.08, 0.03])
      }
      mesh(tray, 'paint-roller', cylinder, coral, [0, 0.14, -0.03], [0.1, 0.3, 0.1]).rotation.z = Math.PI / 2
      mesh(tray, 'roller-axle', box, metal, [0.17, 0.14, 0.065], [0.02, 0.02, 0.2])
      mesh(tray, 'roller-elbow', box, metal, [0.085, 0.14, 0.16], [0.19, 0.02, 0.02])
      mesh(tray, 'roller-handle', cylinder, teal, [0, 0.14, 0.245], [0.06, 0.15, 0.06]).rotation.x = Math.PI / 2
      place(tray, 5, 0.85)
      const crate = new THREE.Group()
      crate.name = 'graffiti-paint-crate'
      mesh(crate, 'crate-bottom', box, wood, [0, 0.025, 0], [0.5, 0.05, 0.4])
      for (const side of [-1, 1]) {
        for (const height of [0.1, 0.23]) {
          mesh(crate, 'crate-side-slat', box, wood, [side * 0.235, height, 0], [0.03, 0.08, 0.4])
          mesh(crate, 'crate-front-slat', box, wood, [0, height, side * 0.185], [0.47, 0.08, 0.03])
        }
        for (const depth of [-1, 1]) mesh(crate, 'crate-corner', box, wood, [side * 0.215, 0.16, depth * 0.165], [0.04, 0.29, 0.04])
      }
      const supplies = new THREE.Group()
      supplies.position.y = 0.05
      sprayCan(supplies, -0.1, 0, teal)
      sprayCan(supplies, 0.1, 0, yellow)
      crate.add(supplies)
      place(crate, 125, 0.9)
    }
    for (let index = 0; index < 4; index++) {
      const angle = THREE.MathUtils.degToRad(level * 17 + index * 13)
      const drop = mesh(detail, 'ground-paint-drop', disc, index % 2 ? coral : teal, [Math.cos(angle) * 1.67, 0.083, Math.sin(angle) * 1.67], [0.04 + index * 0.012, 0.04, 1])
      drop.rotation.x = -Math.PI / 2
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