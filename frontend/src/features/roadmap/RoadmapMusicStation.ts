import * as THREE from 'three'
import type { Theme } from '../../providers/ThemeProvider'
import type { RenderTier } from '../Yuvi-studio/renderTier'

const MUSIC_TYPES = ['live-stage', 'dj-booth', 'drum-stage'] as const
export type MusicStationArchetype = typeof MUSIC_TYPES[number]

export function musicStationArchetype(level: number): MusicStationArchetype | null {
  return Number.isInteger(level) && level >= 21 && level <= 30 ? MUSIC_TYPES[(level - 21) % 3] : null
}

function musicMaterial(kind: number, base: number, accent: number) {
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
        vec3 color = uBase;
        float grain = hash(floor(vUv * 450.0));
        if (uKind < 0.5) {
          float wood = sin(vPosition.y * 95.0 + sin(vPosition.x * 17.0) * 2.0);
          color = mix(uBase, uAccent, 0.1 + wood * 0.06 + grain * 0.08);
        } else if (uKind < 1.5) {
          vec2 weave = abs(fract(vUv * 65.0) - 0.5);
          float hole = smoothstep(0.18, 0.3, length(weave));
          color = mix(uBase * 0.4, uAccent, hole * 0.55);
        } else if (uKind < 2.5) {
          float radius = length(vUv - 0.5);
          float grooves = 0.5 + 0.5 * sin(radius * 900.0);
          color *= 0.65 + grooves * 0.35;
          color = mix(color, uAccent, 1.0 - smoothstep(0.11, 0.12, radius));
          color *= smoothstep(0.012, 0.019, radius);
        } else if (uKind < 3.5) {
          float radius = length(vUv - 0.5);
          color *= 0.8 + sin(radius * 500.0) * 0.09 + grain * 0.1;
        } else if (uKind < 4.5) {
          color = mix(uBase, uAccent, grain * 0.1);
        } else {
          float seam = smoothstep(0.47, 0.5, abs(fract(vPosition.x * 3.0) - 0.5));
          color *= 0.9 + grain * 0.1 - seam * 0.2;
        }
        vec3 light = normalize((viewMatrix * vec4(0.35, 0.82, 0.44, 0.0)).xyz);
        vec3 normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
        float shade = uAmbient + max(dot(normal, light), 0.0) * (1.0 - uAmbient);
        gl_FragColor = vec4(color * shade, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
}

export function createMusicStationAssets(theme: Theme, tier: RenderTier) {
  const deck = musicMaterial(5, 0x545c60, 0x929fa0)
  const red = musicMaterial(0, 0xa92d46, 0xe36168)
  const wood = musicMaterial(0, 0xb19773, 0xede2c9)
  const grille = musicMaterial(1, 0x192428, 0x8a9c9e)
  const vinyl = musicMaterial(2, 0x263136, 0x40c4b1)
  const brass = musicMaterial(3, 0xcab66b, 0xf0dda1)
  const silver = musicMaterial(3, 0xabb9be, 0xe2edef)
  const skin = musicMaterial(4, 0xd9e0de, 0x818e91)
  const dark = musicMaterial(4, 0x252d31, 0x7b8587)
  const teal = musicMaterial(4, 0x26b6a3, 0x9ce8d9)
  const materials = [deck, red, wood, grille, vinyl, brass, silver, skin, dark, teal]
  const baseColors = materials.map((material) => material.uniforms.uBase.value.clone() as THREE.Color)
  const base = new THREE.CylinderGeometry(1.85, 1.7, 0.42, 48)
  const box = new THREE.BoxGeometry(1, 1, 1)
  const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 24)
  const ball = new THREE.SphereGeometry(0.5, 16, 12)
  const disc = new THREE.CircleGeometry(0.5, 48)
  const rim = new THREE.TorusGeometry(0.5, 0.025, 6, 32)
  const cymbal = new THREE.LatheGeometry([
    new THREE.Vector2(0, 0.09), new THREE.Vector2(0.07, 0.09),
    new THREE.Vector2(0.13, 0.035), new THREE.Vector2(0.35, 0.012), new THREE.Vector2(0.5, 0),
  ], 40)
  const headphoneArc = new THREE.TorusGeometry(0.17, 0.025, 6, 20, Math.PI)
  const outline = new THREE.Shape()
  outline.moveTo(0, -0.38)
  outline.bezierCurveTo(-0.4, -0.38, -0.43, -0.08, -0.24, 0.04)
  outline.bezierCurveTo(-0.1, 0.14, -0.28, 0.22, -0.2, 0.37)
  outline.quadraticCurveTo(-0.09, 0.18, 0, 0.3)
  outline.quadraticCurveTo(0.09, 0.18, 0.2, 0.37)
  outline.bezierCurveTo(0.28, 0.22, 0.1, 0.14, 0.24, 0.04)
  outline.bezierCurveTo(0.43, -0.08, 0.4, -0.38, 0, -0.38)
  const guitarBody = new THREE.ExtrudeGeometry(outline, { depth: 0.11, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.025, bevelThickness: 0.025, curveSegments: 10 })
  const geometries = [base, box, cylinder, ball, disc, rim, cymbal, headphoneArc, guitarBody]
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
      material.uniforms.uBase.value.copy(baseColors[index]).multiplyScalar(next === 'dark' ? 1.18 : 1)
      material.uniforms.uAmbient.value = next === 'dark' ? 0.82 : 0.72
    })
  }
  const setQuality = (next: RenderTier) => {
    currentTier = next
    fineDetails.forEach((group) => { group.visible = next !== 'low' })
  }
  const create = (level: number, milestone: boolean) => {
    const archetype = musicStationArchetype(level)
    if (!archetype) throw new RangeError('Music stations cover levels 21 through 30')
    const station = new THREE.Group()
    station.name = `music-station-${level}`
    station.userData.stationArchetype = archetype
    station.scale.setScalar(milestone ? 1.22 : 1)
    mesh(station, 'music-ground', base, deck, [0, -0.13, 0])
    const detail = new THREE.Group()
    detail.name = 'music-fine-detail'
    detail.visible = currentTier !== 'low'
    station.add(detail)
    fineDetails.push(detail)
    const place = (prop: THREE.Group, angle: number) => {
      prop.updateMatrixWorld(true)
      const bounds = new THREE.Box3().setFromObject(prop)
      const size = bounds.getSize(new THREE.Vector3())
      const scale = Math.min(
        1.47 / (Math.max(size.x, size.y, size.z) * station.scale.x),
        0.46 / Math.hypot(size.x / 2, size.z / 2),
      )
      const across = Math.cos(THREE.MathUtils.degToRad(angle)) * 1.3
      const depth = Math.sin(THREE.MathUtils.degToRad(angle)) * 1.3
      prop.scale.setScalar(scale)
      prop.position.set(across - (bounds.min.x + bounds.max.x) * scale / 2, 0.08 - bounds.min.y * scale, depth - (bounds.min.z + bounds.max.z) * scale / 2)
      prop.userData.musicProp = true
      station.add(prop)
    }
    const support = (parent: THREE.Group, height: number) => {
      mesh(parent, 'stand-foot', cylinder, dark, [0, 0.025, 0], [0.35, 0.05, 0.35])
      mesh(parent, 'stand-pole', cylinder, silver, [0, height / 2, 0], [0.035, height, 0.035])
    }
    if (archetype === 'live-stage') {
      const guitar = new THREE.Group()
      guitar.name = 'music-guitar'
      mesh(guitar, 'guitar-body', guitarBody, red, [0, 0.46, 0])
      mesh(guitar, 'guitar-pickguard', guitarBody, skin, [0.05, 0.5, 0.12], [0.55, 0.65, 0.15])
      mesh(guitar, 'guitar-neck', box, wood, [0, 1.02, 0.035], [0.105, 0.74, 0.075])
      mesh(guitar, 'guitar-headstock', box, wood, [0.025, 1.46, 0.035], [0.16, 0.22, 0.08]).rotation.z = -0.14
      mesh(guitar, 'guitar-bridge', box, silver, [0, 0.32, 0.145], [0.18, 0.045, 0.04])
      for (const side of [-1, 1]) {
        mesh(guitar, 'guitar-cradle', box, dark, [side * 0.18, 0.055, 0.035], [0.08, 0.11, 0.36])
        mesh(guitar, 'guitar-tuners', box, silver, [side * 0.12, 1.46, 0.035], [0.08, 0.13, 0.05])
      }
      for (let index = 0; index < 4; index++) {
        mesh(guitar, 'guitar-string', box, silver, [(index - 1.5) * 0.02, 0.87, 0.165], [0.004, 1.05, 0.004])
      }
      place(guitar, -115)
      const mic = new THREE.Group()
      mic.name = 'music-microphone'
      support(mic, 1.18)
      mesh(mic, 'microphone-grille', ball, grille, [0, 1.3, 0.035], [0.2, 0.29, 0.2])
      mesh(mic, 'microphone-handle', cylinder, dark, [0, 1.14, 0.035], [0.1, 0.2, 0.1])
      place(mic, 5)
      const monitorAssembly = new THREE.Group()
      monitorAssembly.name = 'music-monitor'
      const monitor = mesh(monitorAssembly, 'music-wedge-monitor', box, dark, [0, 0, 0], [0.42, 0.25, 0.34])
      monitor.rotation.x = -0.2
      mesh(monitorAssembly, 'monitor-grille', disc, grille, [0, Math.sin(0.2) * 0.172, Math.cos(0.2) * 0.172], [0.25, 0.19, 1]).rotation.x = -0.2
      place(monitorAssembly, 125)
    } else if (archetype === 'dj-booth') {
      const console = new THREE.Group()
      console.name = 'music-dj-console'
      mesh(console, 'dj-console-deck', box, dark, [0, 0.64, 0], [1.35, 0.13, 0.62])
      for (const side of [-1, 1]) {
        mesh(console, 'dj-console-leg', box, silver, [side * 0.51, 0.3, 0], [0.08, 0.6, 0.42])
        mesh(console, 'turntable-platter', cylinder, silver, [side * 0.41, 0.725, 0], [0.47, 0.04, 0.47])
        mesh(console, 'turntable-record', disc, vinyl, [side * 0.41, 0.75, 0], [0.44, 0.44, 1]).rotation.x = -Math.PI / 2
        mesh(console, 'turntable-tonearm', box, silver, [side * 0.57, 0.78, 0.06], [0.025, 0.025, 0.25]).rotation.y = side * 0.3
      }
      mesh(console, 'dj-mixer', box, teal, [0, 0.72, 0], [0.22, 0.04, 0.43])
      for (let index = 0; index < 3; index++) {
        mesh(console, 'mixer-fader', box, skin, [0, 0.75, (index - 1) * 0.11], [0.14, 0.025, 0.025])
      }
      place(console, -115)
      const speaker = new THREE.Group()
      speaker.name = 'music-speaker'
      mesh(speaker, 'speaker-cabinet', box, dark, [0, 0.55, 0], [0.48, 1.1, 0.4])
      for (const height of [0.3, 0.8]) {
        mesh(speaker, 'speaker-driver', disc, grille, [0, height, 0.205], [0.37, 0.37, 1])
        mesh(speaker, 'speaker-rim', rim, silver, [0, height, 0.209], [0.38, 0.38, 0.38])
        mesh(speaker, 'speaker-cone', ball, dark, [0, height, 0.21], [0.13, 0.13, 0.06])
      }
      place(speaker, 5)
      const headphones = new THREE.Group()
      headphones.name = 'music-headphones'
      mesh(headphones, 'headphone-band', headphoneArc, silver, [0, 0, 0])
      for (const side of [-1, 1]) mesh(headphones, 'headphone-earcup', box, teal, [side * 0.17, 0, 0], [0.08, 0.12, 0.12])
      place(headphones, 125)
    } else {
      const kit = new THREE.Group()
      kit.name = 'music-drum-kit'
      const drum = (name: string, across: number, height: number, depth: number, diameter: number) => {
        const shell = mesh(kit, name, cylinder, red, [across, height, depth], [diameter, 0.4, diameter])
        shell.rotation.x = Math.PI / 2
        mesh(kit, 'drum-head', disc, skin, [across, height, depth + 0.205], [diameter, diameter, 1])
        mesh(kit, 'drum-rim', rim, silver, [across, height, depth + 0.21], [diameter, diameter, diameter])
      }
      drum('bass-drum', 0, 0.4, 0, 0.78)
      drum('tom-left', -0.3, 0.99, 0, 0.46)
      drum('tom-right', 0.3, 1.01, 0, 0.5)
      for (const side of [-1, 1]) mesh(kit, 'drum-foot', cylinder, silver, [side * 0.4, 0.17, 0.02], [0.035, 0.34, 0.035])
      mesh(kit, 'tom-support', cylinder, silver, [0, 0.81, -0.06], [0.035, 0.7, 0.035])
      place(kit, -115)
      const cymbalStand = new THREE.Group()
      cymbalStand.name = 'music-cymbal'
      support(cymbalStand, 1.18)
      mesh(cymbalStand, 'brushed-cymbal', cymbal, brass, [0, 1.1, 0], [0.75, 0.75, 0.75])
      place(cymbalStand, 5)
      const stool = new THREE.Group()
      stool.name = 'music-drum-stool'
      mesh(stool, 'drum-stool-seat', cylinder, dark, [0, 0.92, 0], [0.44, 0.065, 0.44])
      for (const across of [-1, 1]) {
        for (const depth of [-1, 1]) {
          const bottom = new THREE.Vector3(across * 0.21, 0.035, depth * 0.21)
          const top = new THREE.Vector3(across * 0.14, 0.9, depth * 0.14)
          const midpoint = bottom.clone().add(top).multiplyScalar(0.5)
          const direction = top.clone().sub(bottom)
          const leg = mesh(stool, 'drum-stool-leg', cylinder, silver, [midpoint.x, midpoint.y, midpoint.z], [0.032, direction.length(), 0.032])
          leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
          mesh(stool, 'drum-stool-foot', cylinder, dark, [bottom.x, 0.02, bottom.z], [0.05, 0.04, 0.05])
        }
      }
      mesh(stool, 'drum-stool-footrest', rim, silver, [0, 0.34, 0], [0.5, 0.5, 0.5]).rotation.x = Math.PI / 2
      place(stool, 125)
    }
    for (const side of [-1, 1]) {
      mesh(detail, 'stage-edge-fastener', cylinder, silver, [side * 1.46, 0.088, 0.64], [0.045, 0.012, 0.045])
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