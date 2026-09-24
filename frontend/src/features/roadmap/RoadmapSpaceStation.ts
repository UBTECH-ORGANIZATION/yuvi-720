import * as THREE from 'three'
import type { Theme } from '../../providers/ThemeProvider'
import type { RenderTier } from '../Yuvi-studio/renderTier'

const SPACE_TYPES = ['lunar-surface', 'orbital-deck', 'asteroid-outpost'] as const
const YUVI_STANDING_HEIGHT = 2.1
const SPACE_PROP_SIZE = YUVI_STANDING_HEIGHT * 0.7
export type SpaceStationArchetype = typeof SPACE_TYPES[number]

export function spaceStationArchetype(level: number): SpaceStationArchetype | null {
  return Number.isInteger(level) && level >= 11 && level <= 20 ? SPACE_TYPES[(level - 11) % 3] : null
}

function surfaceMaterial(kind: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uKind: { value: kind }, uBase: { value: new THREE.Color() },
      uAccent: { value: new THREE.Color() }, uAmbient: { value: 0.72 },
    },
    vertexShader: /* glsl */ `
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
    fragmentShader: /* glsl */ `
      uniform float uKind;
      uniform vec3 uBase;
      uniform vec3 uAccent;
      uniform float uAmbient;
      varying vec3 vPosition;
      varying vec3 vNormal;
      varying vec3 vLocalNormal;
      varying vec2 vUv;
      float hash(vec3 point) {
        point = fract(point * 0.1031);
        point += dot(point, point.yzx + 33.33);
        return fract((point.x + point.y) * point.z);
      }
      float noise(vec3 point) {
        vec3 cell = floor(point);
        vec3 weight = fract(point);
        weight = weight * weight * (3.0 - 2.0 * weight);
        return mix(mix(mix(hash(cell), hash(cell + vec3(1,0,0)), weight.x),
          mix(hash(cell + vec3(0,1,0)), hash(cell + vec3(1,1,0)), weight.x), weight.y),
          mix(mix(hash(cell + vec3(0,0,1)), hash(cell + vec3(1,0,1)), weight.x),
          mix(hash(cell + vec3(0,1,1)), hash(cell + vec3(1,1,1)), weight.x), weight.y), weight.z);
      }
      float grid(vec2 position, vec2 count, float width) {
        vec2 edge = abs(fract(position * count) - 0.5);
        return smoothstep(0.5 - width, 0.5, max(edge.x, edge.y));
      }
      void main() {
        float grain = noise(vPosition * 65.0);
        float broad = noise(vPosition * 4.8);
        vec3 color = uBase;
        if (uKind < 0.5 || uKind > 4.5) {
          float pits = smoothstep(0.64, 0.85, noise(vPosition * 18.0));
          color *= 0.77 + broad * 0.16 + grain * 0.12 - pits * 0.17;
          if (uKind > 4.5) {
            float radius = length(vPosition.xz);
            float bowl = 1.0 - smoothstep(0.19, 0.34, radius);
            float rim = smoothstep(0.28, 0.34, radius) * (1.0 - smoothstep(0.35, 0.44, radius));
            color *= 1.0 - bowl * 0.27 + rim * 0.12;
          }
        } else if (uKind < 1.5) {
          float seams = grid(vPosition.xz + 0.5, vec2(1.8), 0.025);
          float brush = noise(vec3(vPosition.x * 130.0, vPosition.y * 3.0, vPosition.z * 4.0));
          color *= 0.85 + brush * 0.15;
          color *= 1.0 - seams * 0.3 * max(vLocalNormal.y, 0.0);
          float stripe = smoothstep(1.45, 1.48, abs(vPosition.x)) * (1.0 - smoothstep(1.57, 1.6, abs(vPosition.x)));
          color = mix(color, uAccent, stripe * max(vLocalNormal.y, 0.0));
        } else if (uKind < 2.5) {
          float cracks = 1.0 - smoothstep(0.015, 0.065, abs(noise(vPosition * 7.0) - 0.47));
          float minerals = smoothstep(0.76, 0.94, grain);
          color *= 0.72 + broad * 0.32 - cracks * 0.17;
          color = mix(color, uAccent, minerals * 0.75);
        } else if (uKind < 3.5) {
          float cells = grid(vUv, vec2(6.0, 3.0), 0.04);
          float contacts = grid(vUv, vec2(36.0, 1.0), 0.025);
          color = mix(uBase * (0.75 + vUv.y * 0.25), uAccent, max(cells, contacts * 0.2));
        } else {
          color = mix(uBase, uAccent, smoothstep(0.42, 0.45, vUv.x) * (1.0 - smoothstep(0.65, 0.68, vUv.x)));
        }
        vec3 light = normalize((viewMatrix * vec4(0.35, 0.82, 0.44, 0.0)).xyz);
        vec3 normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
        float diffuse = uAmbient + max(dot(normal, light), 0.0) * (1.0 - uAmbient);
        gl_FragColor = vec4(color * diffuse, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
}

function asteroidGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(1.82, 0.92, 1.12, 12, 3)
  const positions = geometry.getAttribute('position')
  for (let index = 0; index < positions.count; index++) {
    const across = positions.getX(index)
    const height = positions.getY(index)
    const depth = positions.getZ(index)
    const angle = Math.atan2(depth, across)
    const crag = 1 + Math.sin(angle * 5) * 0.07 + Math.cos(angle * 3) * 0.06
    positions.setXYZ(index, across * crag, height > 0.55 ? height : height + Math.sin(angle * 4 + height) * 0.1, depth * crag)
  }
  geometry.computeVertexNormals()
  return geometry
}

export function createSpaceStationAssets(theme: Theme, tier: RenderTier) {
  const lunar = surfaceMaterial(0)
  const metal = surfaceMaterial(1)
  const asteroid = surfaceMaterial(2)
  const solar = surfaceMaterial(3)
  const accent = surfaceMaterial(4)
  const craterSurface = surfaceMaterial(5)
  const materials = [lunar, metal, asteroid, solar, accent, craterSurface]
  const moonBase = new THREE.CylinderGeometry(1.85, 1.55, 0.58, 40, 1)
  const deckBase = new THREE.CylinderGeometry(1.88, 1.72, 0.34, 8, 1)
  const asteroidBase = asteroidGeometry()
  const crater = new THREE.LatheGeometry([
    new THREE.Vector2(0, 0.015), new THREE.Vector2(0.17, 0.02),
    new THREE.Vector2(0.28, 0.045), new THREE.Vector2(0.34, 0.105),
    new THREE.Vector2(0.39, 0.085), new THREE.Vector2(0.46, 0),
  ], 24)
  const rock = new THREE.DodecahedronGeometry(0.23, 1)
  const pole = new THREE.CylinderGeometry(0.022, 0.028, 0.93, 8)
  const flag = new THREE.PlaneGeometry(0.48, 0.3, 6, 2)
  const flagPositions = flag.getAttribute('position')
  for (let index = 0; index < flagPositions.count; index++) {
    const across = flagPositions.getX(index) + 0.24
    flagPositions.setZ(index, Math.sin(across * 10) * across * 0.12)
  }
  flag.computeVertexNormals()
  const panel = new THREE.BoxGeometry(1.08, 0.065, 0.62)
  const cells = new THREE.PlaneGeometry(0.98, 0.53)
  const stand = new THREE.CylinderGeometry(0.055, 0.09, 0.35, 8)
  const instrument = new THREE.BoxGeometry(0.38, 0.24, 0.28)
  const dish = new THREE.LatheGeometry([
    new THREE.Vector2(0, 0), new THREE.Vector2(0.09, 0.015),
    new THREE.Vector2(0.2, 0.065), new THREE.Vector2(0.31, 0.16),
    new THREE.Vector2(0.34, 0.2),
  ], 24)
  const geometries = [moonBase, deckBase, asteroidBase, crater, rock, pole, flag, panel, cells, stand, instrument, dish]
  const fineDetails: THREE.Group[] = []
  let currentTier = tier

  const setTheme = (next: Theme) => {
    const light = next === 'light'
    const palette = [
      [light ? 0xcbd0d3 : 0xd9dde0, 0x999fa6],
      [light ? 0x8dabb0 : 0xa6c1c3, 0x23bba5],
      [light ? 0x626872 : 0x858b96, 0xcaa477],
      [0x163963, light ? 0x7fc6d0 : 0xa0d6e4],
      [0xe6a23b, 0xf1e8d0],
      [light ? 0xcbd0d3 : 0xd9dde0, 0x999fa6],
    ]
    materials.forEach((material, index) => {
      material.uniforms.uBase.value.setHex(palette[index][0])
      material.uniforms.uAccent.value.setHex(palette[index][1])
      material.uniforms.uAmbient.value = light ? 0.72 : 0.82
    })
  }
  const setQuality = (next: RenderTier) => {
    currentTier = next
    fineDetails.forEach((detail) => { detail.visible = next !== 'low' })
  }
  const create = (level: number, milestone: boolean) => {
    const archetype = spaceStationArchetype(level)
    if (!archetype) throw new RangeError('Space stations cover levels 11 through 20')
    const group = new THREE.Group()
    group.name = `space-station-${level}`
    group.userData.stationArchetype = archetype
    group.scale.setScalar(milestone ? 1.22 : 1)
    const detail = new THREE.Group()
    detail.name = 'space-fine-detail'
    detail.visible = currentTier !== 'low'
    fineDetails.push(detail)
    group.add(detail)
    const add = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number], parent: THREE.Object3D = group) => {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = name
      mesh.position.set(...position)
      parent.add(mesh)
      return mesh
    }
    const placeProp = (prop: THREE.Object3D, across: number, depth: number) => {
      prop.updateMatrixWorld(true)
      const bounds = new THREE.Box3().setFromObject(prop)
      const size = bounds.getSize(new THREE.Vector3())
      const scale = SPACE_PROP_SIZE / (Math.max(size.x, size.y, size.z) * group.scale.x)
      prop.scale.multiplyScalar(scale)
      prop.position.set(
        across - (bounds.min.x + bounds.max.x) * 0.5 * scale,
        0.08 - bounds.min.y * scale,
        depth - (bounds.min.z + bounds.max.z) * 0.5 * scale,
      )
      prop.userData.spaceProp = true
      group.add(prop)
    }
    const variation = Math.sin(level * 17.13) * 0.5 + 0.5
    if (archetype === 'lunar-surface') {
      add('space-ground', moonBase, lunar, [0, -0.21, 0])
      for (let index = 0; index < 3; index++) {
        const angle = -Math.PI / 2 + (index - 1) * 1.45 + variation * 0.12
        const rim = add(`moon-crater-${index}`, crater, craterSurface, [Math.cos(angle) * 1.32, 0.08, Math.sin(angle) * 1.32])
        rim.scale.setScalar(0.65 + ((index + level) % 3) * 0.12)
      }
      const expeditionFlag = new THREE.Group()
      expeditionFlag.name = 'moon-expedition-flag'
      add('moon-flag-pole', pole, metal, [0, 0.465, 0], expeditionFlag)
      add('moon-flag', flag, accent, [0.24, 0.78, 0], expeditionFlag)
      placeProp(expeditionFlag, -1.08, -1.12)
      const moonRock = new THREE.Mesh(rock, lunar)
      moonRock.name = 'moon-rock'
      moonRock.scale.set(1.2, 0.7, 0.85)
      placeProp(moonRock, 1.17, -1.18)
      add('moon-pebble', rock, lunar, [1.47, 0.13, -0.52], detail).scale.setScalar(0.4)
    } else if (archetype === 'orbital-deck') {
      add('space-ground', deckBase, metal, [0, -0.09, 0]).rotation.y = Math.PI / 8
      for (const side of [-1, 1]) {
        const array = new THREE.Group()
        array.name = 'orbital-solar-array'
        array.position.set(0, 0.44, 0)
        array.rotation.x = 0.35 + variation * 0.1
        add('solar-frame', panel, metal, [0, 0, 0], array)
        add('solar-cells', cells, solar, [0, 0.035, 0], array).rotation.x = -Math.PI / 2
        const solarAssembly = new THREE.Group()
        solarAssembly.name = `orbital-solar-assembly-${side}`
        solarAssembly.add(array)
        add('solar-stand', stand, metal, [0, 0.175, 0], solarAssembly)
        placeProp(solarAssembly, side * 0.9, -1.28)
        add(`deck-fastener-${side}`, stand, metal, [side * 1.45, 0.1, 0.73], detail).scale.set(0.4, 0.1, 0.4)
      }
      add('orbital-instrument-box', instrument, metal, [1.42, 0.2, 0.1])
      add('orbital-instrument-screen', cells, solar, [1.42, 0.21, 0.245]).scale.set(0.28, 0.25, 1)
    } else {
      add('space-ground', asteroidBase, asteroid, [0, -0.48, 0]).rotation.y = variation * 0.18
      for (const side of [-1, 1]) {
        const antenna = new THREE.Group()
        antenna.name = 'asteroid-antenna'
        antenna.position.set(0, 0.51, 0)
        antenna.rotation.z = side * 0.42
        add('antenna-dish', dish, metal, [0, 0, 0], antenna)
        add('antenna-feed', pole, metal, [0, 0.17, 0], antenna).scale.set(0.65, 0.45, 0.65)
        const antennaAssembly = new THREE.Group()
        antennaAssembly.name = `asteroid-antenna-assembly-${side}`
        antennaAssembly.add(antenna)
        add('antenna-support', stand, metal, [0, 0.2625, 0], antennaAssembly).scale.y = 1.5
        placeProp(antennaAssembly, side * 1.12, -1.18)
      }
      const fragment = add('asteroid-fragment', rock, asteroid, [0, 0, -1.52])
      fragment.scale.set(0.8, 0.55, 0.7)
      rock.computeBoundingBox()
      fragment.position.y = 0.08 - rock.boundingBox!.min.y * fragment.scale.y
    }
    return group
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