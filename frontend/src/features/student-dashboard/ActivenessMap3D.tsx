// @ts-nocheck
/* eslint-disable */
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { Icon } from '../../components/primitives'
import { YuviHeadIcon } from '../../components/YuviHeadIcon'
import { useI18n } from '../../i18n/I18nProvider'
import { useTheme } from '../../providers/ThemeProvider'
import type { DashboardDTO } from '../../services/brain'
import { createActivenessGoal } from '../../services/brain'
import { useBrain } from '../../providers/BrainProvider'
import { updateLearnerState } from '../../services/api'
import './activeness-map.css'

type Competency = DashboardDTO['competencies'][number]
type Tone = 'strong' | 'steady' | 'support'

interface ActivenessMap3DProps {
  competencies: Competency[]
  studentName: string
  /** Persisted arrangement + focus (from learner state). */
  initial?: { positions?: Record<string, number>; focus?: string | null } | null
  /** Collapse the full-screen space. */
  onClose: () => void
}

/**
 * The seven 720 activeness domains. Each is a visual metaphor whose *level*
 * (derived from the real profile activeness, never invented) drives its
 * distance, size, colour intensity and connector thickness — a personal,
 * interactive space, not a chart or a children's game.
 */
const DOMAINS: { key: string; metaphor: string; color: string; source: string }[] = [
  { key: 'persistence', metaphor: 'tree', color: '#8a6cff', source: 'growth_mindset' },
  { key: 'autonomy', metaphor: 'telescope', color: '#38a1f0', source: 'initiative_responsibility' },
  { key: 'initiative', metaphor: 'sprout', color: '#25b483', source: 'motivation_relevance' },
  { key: 'collaboration', metaphor: 'orbit', color: '#e59a3c', source: 'support_emotional' },
  { key: 'learning_management', metaphor: 'book', color: '#5566e0', source: 'self_regulation' },
  { key: 'reflection', metaphor: 'gem', color: '#c56ad6', source: 'self_awareness' },
  { key: 'decision_making', metaphor: 'compass', color: '#7f8bff', source: 'avg:self_regulation,self_awareness' },
]

// Temporary switch while working on the platform. `null` = show every domain
// (normal). Otherwise only the listed domains are shown; the rest stay hidden
// (nothing is deleted). Set to null to fully restore the map.
const VISIBLE_DOMAINS: string[] | null = null
const allDomainsShown = VISIBLE_DOMAINS === null
const isDomainVisible = (key: string) => VISIBLE_DOMAINS === null || VISIBLE_DOMAINS.includes(key)

function toneFor(value: number): Tone {
  if (value >= 70) return 'strong'
  if (value >= 45) return 'steady'
  return 'support'
}

/** Resolve a 0-100 activeness value for a domain from the real competencies. */
function valueFor(source: string, byKey: Record<string, number>): number {
  if (source.startsWith('avg:')) {
    const keys = source.slice(4).split(',')
    const vals = keys.map((k) => byKey[k]).filter((v) => typeof v === 'number')
    if (!vals.length) return 55
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
  }
  return typeof byKey[source] === 'number' ? byKey[source] : 55
}

// ── Polished procedural metaphors (clean, modern, glossy — not toy low-poly) ─
const DARK = new THREE.Color('#1b1636')

/** A glossy, environment-lit accent material that also glows under bloom. */
function shiny(color: THREE.Color, emissive: number, roughness = 0.28, metalness = 0.4) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    emissive: color.clone(),
    emissiveIntensity: emissive,
    envMapIntensity: 1.15,
    transparent: true,
    opacity: 1,
  })
}
/** Muted structural material for supporting parts (kept dark so it never blooms). */
function pearl(roughness = 0.55, metalness = 0.2) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color('#5a5580'),
    roughness,
    metalness,
    envMapIntensity: 0.5,
    transparent: true,
  })
}
/** Backwards-compatible helper (kept for the metaphor materials). */
function makeStandardMaterial(color: THREE.Color, emissiveScale: number) {
  return shiny(color, emissiveScale)
}

function enableShadows(root: THREE.Object3D) {
  root.traverse((o: any) => {
    if (o.isMesh && o.material && !o.material.transparent) {
      o.castShadow = true
    }
  })
}

function buildMetaphor(metaphor: string, color: THREE.Color, emissive: number): THREE.Group {
  const g = new THREE.Group()
  const mat = () => shiny(color, emissive)

  if (metaphor === 'tree') {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 0.7, 20), pearl(0.5, 0.1))
    trunk.position.y = 0.35
    g.add(trunk)
    const foliage = new THREE.Mesh(new THREE.SphereGeometry(0.56, 32, 24), mat())
    foliage.position.y = 1.08
    foliage.scale.set(1, 0.94, 1)
    g.add(foliage)
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.34, 28, 20), mat())
    top.position.set(0.06, 1.5, 0.02)
    g.add(top)
  } else if (metaphor === 'telescope') {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, 1.15, 28), mat())
    tube.rotation.z = Math.PI / 3.2
    tube.position.y = 0.95
    g.add(tube)
    const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.03, 16, 32), pearl(0.3, 0.6))
    ringA.position.set(0.28, 1.16, 0)
    ringA.rotation.y = Math.PI / 2
    ringA.rotation.z = Math.PI / 3.2
    g.add(ringA)
    const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.24, 24), pearl(0.3, 0.5))
    eye.rotation.z = Math.PI / 3.2
    eye.position.set(-0.44, 0.58, 0)
    g.add(eye)
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.7, 16), pearl(0.4, 0.3))
    pillar.position.y = 0.3
    g.add(pillar)
  } else if (metaphor === 'sprout') {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.08, 0.72, 16), shiny(new THREE.Color('#43c78d'), emissive * 0.5, 0.4, 0.1))
    stem.position.y = 0.36
    g.add(stem)
    for (const s of [-1, 1]) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.34, 28, 18), mat())
      leaf.scale.set(1, 0.32, 0.66)
      leaf.position.set(s * 0.33, 0.64, 0)
      leaf.rotation.z = s * -0.7
      g.add(leaf)
    }
    const bud = new THREE.Mesh(new THREE.SphereGeometry(0.17, 28, 20), mat())
    bud.position.y = 0.86
    g.add(bud)
  } else if (metaphor === 'orbit') {
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.36, 40, 28), mat())
    core.position.y = 0.9
    g.add(core)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.035, 16, 64), shiny(color, emissive, 0.2, 0.5))
    ring.position.y = 0.9
    ring.rotation.x = Math.PI / 2.3
    g.add(ring)
    for (const a of [0, Math.PI * 0.66, Math.PI * 1.33]) {
      const sat = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 14), mat())
      sat.position.set(Math.cos(a) * 0.64, 0.9 + Math.sin(a) * 0.16, Math.sin(a) * 0.42)
      g.add(sat)
    }
  } else if (metaphor === 'book') {
    for (const s of [-1, 1]) {
      const page = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.07, 0.84), mat())
      page.position.set(s * 0.33, 0.82, 0)
      page.rotation.z = s * 0.26
      g.add(page)
    }
    const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.88, 16), pearl(0.3, 0.5))
    spine.rotation.x = Math.PI / 2
    spine.position.y = 0.88
    g.add(spine)
  } else if (metaphor === 'gem') {
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.56, 0), shiny(color, emissive, 0.12, 0.55))
    gem.position.y = 1.02
    gem.scale.set(0.78, 1.28, 0.78)
    g.add(gem)
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.32, 0.16, 24), pearl(0.3, 0.5))
    base.position.y = 0.44
    g.add(base)
  } else if (metaphor === 'compass') {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.14, 40), pearl(0.3, 0.55))
    disc.position.y = 0.72
    g.add(disc)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.045, 16, 64), shiny(color, emissive, 0.22, 0.5))
    ring.position.y = 0.8
    ring.rotation.x = Math.PI / 2
    g.add(ring)
    const needle = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.72, 20), mat())
    needle.position.y = 0.86
    needle.rotation.x = Math.PI / 2
    needle.rotation.z = Math.PI
    g.add(needle)
    const back = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.34, 20), pearl(0.35, 0.4))
    back.position.y = 0.86
    back.rotation.x = -Math.PI / 2
    g.add(back)
  }
  enableShadows(g)
  return g
}

function buildIsland(color: THREE.Color, glow: boolean): THREE.Group {
  // No base plate under domains — each metaphor floats on its own.
  return new THREE.Group()
}

/**
 * A framed nameplate that sits below each domain with the domain name printed
 * on it (billboarded toward the camera). Replaces the floating HTML labels.
 */
function buildNameplate(text: string, color: THREE.Color): THREE.Mesh {
  const W = 512
  const H = 148
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, W, H)

  // Rounded frame.
  const pad = 12
  const x = pad
  const y = pad
  const w = W - pad * 2
  const h = H - pad * 2
  const r = 30
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
  ctx.fillStyle = 'rgba(18, 13, 38, 0.9)'
  ctx.fill()
  ctx.lineWidth = 5
  ctx.strokeStyle = `#${color.getHexString()}`
  ctx.stroke()

  // Domain name (RTL-aware, auto-shrinks to fit).
  ctx.direction = 'rtl'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#f0ecff'
  let fs = 62
  ctx.font = `700 ${fs}px Rubik, Heebo, system-ui, sans-serif`
  while (ctx.measureText(text).width > w - 44 && fs > 24) {
    fs -= 4
    ctx.font = `700 ${fs}px Rubik, Heebo, system-ui, sans-serif`
  }
  ctx.fillText(text, W / 2, H / 2 + 3)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  // Always readable — the plate is drawn on top and never occluded by elements.
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  const worldH = 0.44
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(worldH * (W / H), worldH), mat)
  mesh.renderOrder = 20
  return mesh
}

/**
 * Central "smart core": a clean holographic energy sphere with subtle internal
 * motion, electric strands and particles. No statue, cup, or vertical structure.
 */
function buildAvatar(pal: ScenePalette): THREE.Group {
  const g = new THREE.Group()

  // Floating core group, animated in the render loop.
  const persona = new THREE.Group()
  persona.position.y = 1.45
  persona.userData.persona = true
  persona.userData.baseY = 1.45
  g.add(persona)

  const sphereRadius = 1.0

  // ── Barely-there glass shell — just a faint surface with a small highlight,
  // so the living interior (glow, streams, sparks) is what you actually see. ──
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(sphereRadius, 96, 72),
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#a98cff'),
      roughness: 0.22,
      metalness: 0,
      clearcoat: 0.4,
      clearcoatRoughness: 0.28,
      transparent: true,
      opacity: 0.06,
      depthWrite: false,
      envMapIntensity: 0.7,
    }),
  )
  shell.renderOrder = 4
  shell.userData.shell = true
  persona.add(shell)

  // Fresnel rim — a soft glass edge (gentle so it never blows out to white).
  const fresnelMat = new THREE.ShaderMaterial({
    uniforms: {
      uInner: { value: new THREE.Color('#7b5cff') },
      uRim: { value: new THREE.Color('#6fb6ff') },
      uPower: { value: 3.0 },
      uIntensity: { value: 0.55 },
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vV;
      void main(){
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uInner; uniform vec3 uRim; uniform float uPower; uniform float uIntensity;
      varying vec3 vN; varying vec3 vV;
      void main(){
        float f = pow(1.0 - abs(dot(vN, vV)), uPower);
        vec3 c = mix(uInner, uRim, f);
        gl_FragColor = vec4(c, f * uIntensity);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
  })
  const fresnel = new THREE.Mesh(new THREE.SphereGeometry(sphereRadius * 1.004, 96, 72), fresnelMat)
  fresnel.renderOrder = 5
  persona.add(fresnel)

  // Hover outline — a fresnel edge glow that lights ONLY the silhouette (center
  // stays fully transparent), so hover reads as a clean luminous outline rather
  // than a milky white fill. Driven by uHover in the render loop.
  const hoverMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#cdbcff') },
      uPower: { value: 3.6 },
      uHover: { value: 0 },
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vV;
      void main(){
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uPower; uniform float uHover;
      varying vec3 vN; varying vec3 vV;
      void main(){
        float f = pow(1.0 - abs(dot(vN, vV)), uPower);
        gl_FragColor = vec4(uColor, f * uHover);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
  })
  const hoverHalo = new THREE.Mesh(new THREE.SphereGeometry(sphereRadius * 1.07, 72, 54), hoverMat)
  hoverHalo.renderOrder = 6
  persona.add(hoverHalo)

  // Inner plasma core — saturated purple, deliberately DIM so the energy streams
  // stay readable (no white burnout).
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 48, 36),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color('#4b2fc0'),
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  core.renderOrder = 3
  persona.add(core)

  // Small blue-violet nucleus for depth at the very centre.
  const nucleus = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 32, 24),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color('#6f74ff'),
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  nucleus.renderOrder = 3
  persona.add(nucleus)

  // Soft halo for holographic depth (kept subtle).
  const haze = new THREE.Mesh(
    new THREE.SphereGeometry(0.82, 48, 36),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color('#5a45cc'),
      transparent: true,
      opacity: 0.13,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  haze.renderOrder = 1
  persona.add(haze)

  // ── A FEW distinct, thick energy streams (not a dense cloud of thin lines) ──
  const streamColors = ['#c39cff', '#6fb6ff', '#e08cff', '#8f9cff']
  const streams: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; spin: number; phase: number; baseTilt: number }> = []
  for (let i = 0; i < 4; i += 1) {
    const pts: THREE.Vector3[] = []
    const pathRadius = 0.56 + i * 0.05
    const turns = 0.5 + i * 0.09 // < 1 turn → a clean sweeping arc, not a knot
    const spin0 = (i / 4) * Math.PI * 2
    for (let j = 0; j <= 30; j += 1) {
      const t = j / 30
      const y = (-0.82 + t * 1.64) * 0.92
      const a = spin0 + t * Math.PI * 2 * turns
      const rr = pathRadius * Math.sin(Math.PI * t) + 0.05 // lens-shaped: pinched at poles
      pts.push(new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr))
    }
    const curve = new THREE.CatmullRomCurve3(pts)
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(streamColors[i]),
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.022, 8, false), mat)
    mesh.renderOrder = 2
    const baseTilt = (i - 1.5) * 0.16
    mesh.rotation.z = baseTilt
    persona.add(mesh)
    streams.push({ mesh, mat, spin: (i % 2 ? 1 : -1) * (0.35 + i * 0.06), phase: Math.random() * Math.PI * 2, baseTilt })
  }

  // Fewer, dimmer sparks — points of light, not a white cloud.
  const particleCount = 46
  const particlePos = new Float32Array(particleCount * 3)
  const particleSeed = new Float32Array(particleCount * 4)
  for (let i = 0; i < particleCount; i += 1) {
    const r = Math.cbrt(Math.random()) * 0.66
    const a = Math.random() * Math.PI * 2
    const p = Math.acos(2 * Math.random() - 1)
    const x = Math.sin(p) * Math.cos(a) * r
    const y = Math.cos(p) * r
    const z = Math.sin(p) * Math.sin(a) * r
    const idx = i * 3
    particlePos[idx] = x
    particlePos[idx + 1] = y
    particlePos[idx + 2] = z
    const seed = i * 4
    particleSeed[seed] = x
    particleSeed[seed + 1] = y
    particleSeed[seed + 2] = z
    particleSeed[seed + 3] = Math.random() * Math.PI * 2
  }
  const particleGeo = new THREE.BufferGeometry()
  particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3))
  const particles = new THREE.Points(
    particleGeo,
    new THREE.PointsMaterial({
      color: new THREE.Color('#bcd4ff'),
      size: 0.03,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  particles.renderOrder = 2
  persona.add(particles)

  // Inner light so the glow comes from the inside — dim + blue-violet.
  const innerLight = new THREE.PointLight(0x8f7bff, 0.55, 3.8, 1.9)
  innerLight.position.set(0, 0, 0)
  persona.add(innerLight)

  // Very small support so the sphere stays the visual focus.
  const microDock = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.24, 0.045, 40),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#3c3668'), roughness: 0.58, metalness: 0.24, envMapIntensity: 0.28 }),
  )
  microDock.position.y = 0.03
  microDock.receiveShadow = true
  g.add(microDock)

  const microRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.27, 0.013, 12, 96),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color('#c8b8ff'),
      emissive: new THREE.Color('#8f7bff'),
      emissiveIntensity: 0.5,
      roughness: 0.32,
      metalness: 0.4,
      transparent: true,
      opacity: 0.82,
    }),
  )
  microRing.rotation.x = -Math.PI / 2
  microRing.position.y = 0.055
  g.add(microRing)

  persona.userData.shell = shell
  persona.userData.fresnelMat = fresnelMat
  persona.userData.hoverHalo = hoverHalo
  persona.userData.hoverMat = hoverMat
  persona.userData.core = core
  persona.userData.nucleus = nucleus
  persona.userData.haze = haze
  persona.userData.innerLight = innerLight
  persona.userData.streams = streams
  persona.userData.particles = particles
  persona.userData.particleSeed = particleSeed

  // Low, stepped, dark base — supports the centrepiece without competing with it.
  // Three thin rounded layers, each a little smaller + a touch lighter upward.
  const stepGeo = (rTop: number, rBot: number) => {
    const geo = new THREE.CylinderGeometry(rTop, rBot, 0.08, 80)
    return geo
  }
  const layers: [number, number, number, string][] = [
    // [radiusTop, radiusBottom, centreY, color]
    [1.55, 1.62, -0.19, pal.base[0]],
    [1.3, 1.4, -0.1, pal.base[1]],
    [1.06, 1.16, -0.02, pal.base[2]],
  ]
  for (const [rTop, rBot, y, color] of layers) {
    const layer = new THREE.Mesh(
      stepGeo(rTop, rBot),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.7, metalness: 0.2, envMapIntensity: 0.15 }),
    )
    layer.position.y = y
    layer.receiveShadow = true
    g.add(layer)
    // Soft rounded top edge for each layer.
    const edge = new THREE.Mesh(
      new THREE.TorusGeometry(rTop - 0.02, 0.035, 12, 90),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.65, metalness: 0.2, envMapIntensity: 0.15 }),
    )
    edge.rotation.x = -Math.PI / 2
    edge.position.y = y + 0.04
    g.add(edge)
  }
  // A single thin light ring around the TOP layer only (light comes from here).
  const topRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.08, 0.02, 14, 120),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(pal.baseRingColor), emissive: new THREE.Color(pal.baseRingEmissive), emissiveIntensity: 0.45, roughness: 0.4, metalness: 0.35, transparent: true, opacity: 0.85 }),
  )
  topRing.rotation.x = -Math.PI / 2
  topRing.position.y = 0.04
  g.add(topRing)
  return g
}

/** Per-theme colour scheme for the whole 3D scene (follows the site's data-theme). */
interface ScenePalette {
  bg: [string, string, string]      // background: center, mid, edge
  fog: number
  floor: [string, string, string]   // top-surface gradient: center, mid, edge
  floorTop: string
  floorBottom: string
  streakRGB: string                 // "r,g,b" for surface streaks/rings
  streakAlpha: number
  ringAlpha: number
  glowColor: string
  glowEmissive: string
  base: [string, string, string]    // three stepped pedestal layers
  baseRingColor: string
  baseRingEmissive: string
  contactOpacity: number
  fogDensity: number
  hemiSky: number; hemiGround: number; hemiInt: number
  keyColor: number; keyInt: number
  rimColor: number; rimInt: number
  stageColor: number; stageInt: number
  exposure: number
}

const PALETTES: Record<'light' | 'dark', ScenePalette> = {
  dark: {
    bg: ['#2a2258', '#191340', '#0b0820'],
    fog: 0x110d26,
    floor: ['#140f34', '#0c0824', '#040311'],
    floorTop: '#0a0720',
    floorBottom: '#03020c',
    streakRGB: '150,130,255',
    streakAlpha: 0.10,
    ringAlpha: 0.06,
    glowColor: '#8f7dff',
    glowEmissive: '#6f5cff',
    base: ['#0c0820', '#120d30', '#181140'],
    baseRingColor: '#8f7dff',
    baseRingEmissive: '#6f5cff',
    contactOpacity: 0.6,
    fogDensity: 0.022,
    hemiSky: 0xbcc6ff, hemiGround: 0x2a2358, hemiInt: 0.5,
    keyColor: 0xeef0ff, keyInt: 1.0,
    rimColor: 0x8aa0ff, rimInt: 0.6,
    stageColor: 0x9f8bff, stageInt: 2.4,
    exposure: 0.95,
  },
  light: {
    // Light, airy background — but the platform stays a rich indigo "stage" so
    // the glowing elements keep contrast and never wash out to white.
    bg: ['#f4f2fd', '#eae7f7', '#dbd9ee'],
    fog: 0xdedcef,
    floor: ['#241f4c', '#171238', '#0e0a26'],
    floorTop: '#1c1742',
    floorBottom: '#100c2c',
    streakRGB: '178,164,255',
    streakAlpha: 0.13,
    ringAlpha: 0.09,
    glowColor: '#a99bff',
    glowEmissive: '#7c5cff',
    base: ['#161038', '#1c1546', '#231c56'],
    baseRingColor: '#a99bff',
    baseRingEmissive: '#7c5cff',
    contactOpacity: 0.45,
    fogDensity: 0.004,
    hemiSky: 0xcfd4ff, hemiGround: 0x2a2358, hemiInt: 0.5,
    keyColor: 0xffffff, keyInt: 1.15,
    rimColor: 0x8aa0ff, rimInt: 0.55,
    stageColor: 0x9f8bff, stageInt: 1.8,
    exposure: 0.95,
  },
}

/** Futuristic circular platform — a dark, thick, softly-lit Sci-Fi disc. */
function buildArena(pal: ScenePalette): { group: THREE.Group; spinners: { obj: THREE.Object3D; speed: number }[] } {
  const group = new THREE.Group()
  const spinners: { obj: THREE.Object3D; speed: number }[] = []

  const R = 6.0
  const TOP_Y = -0.6 // world height of the top surface — a floating stage

  // ── Designed top surface: brighter middle, darker edges, faint rings + streaks
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1024
  const ctx = canvas.getContext('2d')!
  const c = 512
  const RAD = 500
  const grad = ctx.createRadialGradient(c, c, 30, c, c, RAD)
  grad.addColorStop(0, pal.floor[0])
  grad.addColorStop(0.45, pal.floor[1])
  grad.addColorStop(1, pal.floor[2])
  ctx.fillStyle = grad
  ctx.beginPath(); ctx.arc(c, c, RAD, 0, Math.PI * 2); ctx.fill()
  // Radial energy streaks toward the seven skill directions (subtle).
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + (i / 7) * Math.PI * 2
    const x2 = c + Math.cos(a) * RAD * 0.95
    const y2 = c + Math.sin(a) * RAD * 0.95
    const lg = ctx.createLinearGradient(c, c, x2, y2)
    lg.addColorStop(0, `rgba(${pal.streakRGB},0)`)
    lg.addColorStop(0.35, `rgba(${pal.streakRGB},${pal.streakAlpha})`)
    lg.addColorStop(1, `rgba(${pal.streakRGB},0)`)
    ctx.strokeStyle = lg
    ctx.lineWidth = 5
    ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(x2, y2); ctx.stroke()
  }
  // Only two thin, almost-transparent concentric rings.
  ctx.lineWidth = 2
  for (const rr of [0.5, 0.82]) {
    ctx.strokeStyle = `rgba(${pal.streakRGB},${pal.ringAlpha})`
    ctx.beginPath(); ctx.arc(c, c, RAD * rr, 0, Math.PI * 2); ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8

  // ── Two thin layers only (no thick "tire" rim, smooth subtle edge).
  // Top layer: wide + thin, with a slight bevel for a soft edge.
  const topLayer = new THREE.Mesh(
    new THREE.CylinderGeometry(R - 0.05, R, 0.08, 128),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(pal.floorTop), metalness: 0.12, roughness: 0.82, envMapIntensity: 0.08 }),
  )
  topLayer.position.y = TOP_Y - 0.04
  topLayer.receiveShadow = true
  group.add(topLayer)
  // Designed top surface (deep, matte — no milky env reflection).
  const top = new THREE.Mesh(
    new THREE.CircleGeometry(R - 0.07, 128),
    new THREE.MeshStandardMaterial({ map: tex, metalness: 0.08, roughness: 0.86, envMapIntensity: 0.06 }),
  )
  top.rotation.x = -Math.PI / 2
  top.position.y = TOP_Y + 0.002
  top.receiveShadow = true
  group.add(top)
  // Bottom layer: slightly smaller + darker.
  const bottomLayer = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 0.9, R * 0.93, 0.08, 128),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(pal.floorBottom), roughness: 0.9, metalness: 0.1, envMapIntensity: 0.05 }),
  )
  bottomLayer.position.y = TOP_Y - 0.13
  group.add(bottomLayer)

  // ── A single thin emissive edge ring, tight to the outer rim (integrated,
  // restrained — no separate glowing disc behind the platform).
  const glowRing = new THREE.Mesh(
    new THREE.TorusGeometry(R - 0.03, 0.016, 16, 260),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(pal.glowColor), emissive: new THREE.Color(pal.glowEmissive), emissiveIntensity: 0.42, metalness: 0.4, roughness: 0.4, transparent: true, opacity: 0.85 }),
  )
  glowRing.rotation.x = -Math.PI / 2
  glowRing.position.y = TOP_Y + 0.012
  group.add(glowRing)

  // ── Subtle contact shadow under the disc.
  const shCanvas = document.createElement('canvas')
  shCanvas.width = shCanvas.height = 256
  const sctx = shCanvas.getContext('2d')!
  const sg = sctx.createRadialGradient(128, 128, 20, 128, 128, 128)
  sg.addColorStop(0, 'rgba(0,0,0,0.55)')
  sg.addColorStop(0.6, 'rgba(0,0,0,0.28)')
  sg.addColorStop(1, 'rgba(0,0,0,0)')
  sctx.fillStyle = sg
  sctx.fillRect(0, 0, 256, 256)
  const shadowTex = new THREE.CanvasTexture(shCanvas)
  const contact = new THREE.Mesh(
    new THREE.CircleGeometry(R * 1.3, 64),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: pal.contactOpacity, depthWrite: false }),
  )
  contact.rotation.x = -Math.PI / 2
  contact.position.y = TOP_Y - 0.34
  group.add(contact)

  return { group, spinners }
}

/** Opaque premium backdrop with a soft central halo for depth (no strong glow). */
function makeBackgroundTexture(pal: ScenePalette): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 512
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = pal.bg[2]
  ctx.fillRect(0, 0, 512, 512)
  const grad = ctx.createRadialGradient(256, 232, 30, 256, 256, 340)
  grad.addColorStop(0, pal.bg[0])
  grad.addColorStop(0.4, pal.bg[1])
  grad.addColorStop(1, pal.bg[2])
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 512, 512)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// Glow only for a central strength; steady/support stay matte (clarity first).
const EMISSIVE_BY_TONE: Record<Tone, number> = { strong: 0.32, steady: 0, support: 0 }

export function ActivenessMap3D({ competencies, studentName, initial, onClose }: ActivenessMap3DProps) {
  const { t, direction } = useI18n()
  const { theme } = useTheme()
  const { learnerId } = useBrain()
  const mountRef = useRef<HTMLDivElement | null>(null)
  const labelRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const captionRef = useRef<HTMLDivElement | null>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const sceneApi = useRef<any>(null)

  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [activeGoal, setActiveGoal] = useState<{ domain: string; behavior: string; context: string; text: string; id?: string } | null>(initial?.goal ?? null)
  const [flow, setFlow] = useState<{ domain: string; step: 1 | 2 | 3; behavior: string | null; context: string | null } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)

  const reduced = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  // Derive the seven domains from the real activeness (no invented numbers).
  // Kept free of `t` so the WebGL scene does not remount on every render;
  // localized strings are resolved in the overlay JSX below.
  const domains = useMemo(() => {
    const byKey: Record<string, number> = {}
    for (const c of competencies) byKey[c.key] = c.value
    return DOMAINS.map((d, index) => {
      const value = valueFor(d.source, byKey)
      const tone = toneFor(value)
      return {
        ...d,
        value,
        tone,
        level: Math.max(0, Math.min(1, value / 100)),
        defaultSlot: index,
      }
    })
  }, [competencies])

  // Only rebuild the scene when the underlying values actually change.
  const signature = useMemo(() => domains.map((d) => `${d.key}:${d.value}`).join('|'), [domains])
  const domainsRef = useRef(domains)
  useEffect(() => { domainsRef.current = domains })

  // The single area worth promoting now (lowest activeness) — unless the learner
  // already has an active goal, in which case that domain is the focus.
  const suggestedKey = useMemo(
    () => domains.reduce((a, b) => (b.level < a.level ? b : a), domains[0])?.key ?? null,
    [domains],
  )
  const nextFocusKey = activeGoal?.domain ?? suggestedKey

  // Three clear states — exactly one focus, the rest split strengths / in-process.
  const stateByKey = useMemo(() => {
    const ranked = [...domains].sort((a, b) => b.level - a.level)
    const others = ranked.filter((d) => d.key !== nextFocusKey)
    const half = Math.ceil(others.length / 2)
    const map: Record<string, 'strength' | 'process' | 'focus'> = {}
    others.forEach((d, i) => { map[d.key] = i < half ? 'strength' : 'process' })
    if (nextFocusKey) map[nextFocusKey] = 'focus'
    return map
  }, [domains, nextFocusKey])

  const stateByKeyRef = useRef(stateByKey)
  useEffect(() => { stateByKeyRef.current = stateByKey })
  const nextFocusRef = useRef(nextFocusKey)
  useEffect(() => { nextFocusRef.current = nextFocusKey })

  // Push the three-state visuals + spotlight into the scene when they change.
  useEffect(() => { sceneApi.current?.setStates(stateByKey) }, [stateByKey])
  useEffect(() => { sceneApi.current?.setSpotlight(nextFocusKey) }, [nextFocusKey])

  // Keep the latest tapped node in a ref for the animation loop.
  const focusRef = useRef<string | null>(focusKey)
  useEffect(() => { focusRef.current = focusKey }, [focusKey])

  const persist = (goal: typeof activeGoal) => {
    void updateLearnerState({
      activeness_map: {
        positions: sceneApi.current?.getPositions() ?? {},
        focus: goal?.domain ?? null,
        goal,
      },
    }).catch(() => undefined)
  }

  const openCard = (key: string) => {
    setFocusKey(key)
    sceneApi.current?.focusDomain(key)
  }

  const startFlow = (domain: string) => {
    setFlow({ domain, step: 1, behavior: null, context: null })
  }

  const goalText = (flowState: { domain: string; behavior: string | null; context: string | null }) => {
    if (!flowState.behavior || !flowState.context) return ''
    return t('actmap.goal.template', {
      behavior: t(`actmap.domain.${flowState.domain}.${flowState.behavior}`),
      context: t(`actmap.context.${flowState.context}`),
    })
  }

  const confirmGoal = async () => {
    if (!flow || !flow.behavior || !flow.context || saving) return
    const text = goalText(flow)
    const goal = { domain: flow.domain, behavior: flow.behavior, context: flow.context, text }
    setSaving(true)
    try {
      if (!learnerId) throw new Error('learner unknown')   // catch keeps the local demo flow
      const created = await createActivenessGoal(learnerId, { domain: flow.domain, text })
      const withId = { ...goal, id: created.id }
      setActiveGoal(withId)
      persist(withId)
      window.dispatchEvent(new Event('yuvilab:brain-updated'))
      setFlow(null)
      setFocusKey(flow.domain)
      setToast(t('actmap.goal.created'))
      window.setTimeout(() => setToast(null), 4000)
    } catch {
      // Still reflect it locally so the demo flow never dead-ends.
      setActiveGoal(goal)
      persist(goal)
      setFlow(null)
      setFocusKey(flow.domain)
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const domains = domainsRef.current
    // The activeness map is always dark — it never follows the site light theme.
    const pal = PALETTES.dark
    const width = mount.clientWidth
    const height = mount.clientHeight
    const renderer = new THREE.WebGLRenderer({ antialias: !reduced, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, reduced ? 1.25 : 2))
    renderer.setSize(width, height)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = pal.exposure
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = makeBackgroundTexture(pal)
    scene.fog = new THREE.FogExp2(pal.fog, pal.fogDensity)

    // Environment map for glossy, premium reflections.
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100)
    const DEFAULT_POS = new THREE.Vector3(0, 10.2, 11)
    const DEFAULT_TARGET = new THREE.Vector3(0, 1.0, 0)
    camera.position.copy(DEFAULT_POS)

    // Cinematic lighting, tuned per theme.
    scene.add(new THREE.HemisphereLight(pal.hemiSky, pal.hemiGround, pal.hemiInt))
    const key = new THREE.DirectionalLight(pal.keyColor, pal.keyInt)
    key.position.set(5, 12, 6)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.near = 1
    key.shadow.camera.far = 40
    key.shadow.camera.left = -11
    key.shadow.camera.right = 11
    key.shadow.camera.top = 11
    key.shadow.camera.bottom = -11
    key.shadow.bias = -0.0004
    key.shadow.radius = 4
    scene.add(key)
    const rim = new THREE.DirectionalLight(pal.rimColor, pal.rimInt)
    rim.position.set(-7, 4, -8)
    scene.add(rim)
    const stageGlow = new THREE.PointLight(pal.stageColor, pal.stageInt, 11, 2)
    stageGlow.position.set(0, 2.6, 0)
    scene.add(stageGlow)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.copy(DEFAULT_TARGET)
    controls.enablePan = false
    controls.enableDamping = !reduced
    controls.dampingFactor = 0.08
    controls.minDistance = 6.5
    controls.maxDistance = 15
    controls.minPolarAngle = Math.PI * 0.16
    controls.maxPolarAngle = Math.PI * 0.49
    controls.rotateSpeed = 0.7
    controls.autoRotate = false
    controls.autoRotateSpeed = 0.35
    controls.update()

    // Center avatar — holographic energy core.
    const avatar = buildAvatar(pal)
    avatar.scale.setScalar(1.0)
    scene.add(avatar)
    let personaNode: THREE.Object3D | null = null
    avatar.traverse((o: any) => {
      if (o.userData?.persona) personaNode = o
    })


    // Rich arena: designed floor, glow, orbital rings.
    const arena = buildArena(pal)
    scene.add(arena.group)
    const spinners = arena.spinners

    const SLOT_COUNT = domains.length
    const positions: Record<string, number> = {}
    for (const d of domains) {
      const saved = initial?.positions?.[d.key]
      positions[d.key] = typeof saved === 'number' ? saved : d.defaultSlot
    }

    const slotAngle = (slot: number) => -Math.PI / 2 + (slot / SLOT_COUNT) * Math.PI * 2

    interface IslandData {
      key: string
      domain: (typeof domains)[number]
      group: THREE.Group
      metaphor: THREE.Group
      island: THREE.Group
      plate: THREE.Mesh
      mats: THREE.MeshStandardMaterial[]
      baseEmissive: number[]
      phase: number
      dim: number
    }
    const islands: IslandData[] = []

    // Three states drive the visuals; updated from React via setStates().
    // 'strength' = closer + full colour, 'process' = farther + activity ring,
    // 'focus' = the single node to promote now (spotlight).
    let stateMap: Record<string, string> = {}
    const stateOf = (k: string) => stateMap[k] || 'strength'
    let spotlightKey: string | null = null
    const R_STRENGTH = 4.9
    const R_FOCUS = 5.2
    const R_PROCESS = 5.5
    const radiusForState = (s: string) => (s === 'process' ? R_PROCESS : s === 'focus' ? R_FOCUS : R_STRENGTH)

    for (const d of domains) {
      const color = new THREE.Color(d.color)
      const group = new THREE.Group()
      const island = buildIsland(color, false)
      const metaphor = buildMetaphor(d.metaphor, color, 0.16)
      const scale = 0.62 + d.level * 0.32
      metaphor.scale.setScalar(scale)
      island.scale.setScalar(0.62 + d.level * 0.2)
      // Each element rests on its own small base (like the central core).
      island.position.y = 0
      group.add(island)
      metaphor.position.y = -0.25
      group.add(metaphor)

      // Framed nameplate below the element (billboarded in the render loop).
      const plate = buildNameplate(t(`actmap.domain.${d.key}`), color)
      scene.add(plate)

      const mats: THREE.MeshStandardMaterial[] = []
      const baseEmissive: number[] = []
      group.traverse((o: any) => {
        if (o.isMesh && o.material?.emissiveIntensity !== undefined) {
          mats.push(o.material)
          baseEmissive.push(o.material.emissiveIntensity)
        }
      })

      scene.add(group)
      islands.push({
        key: d.key,
        domain: d,
        group,
        metaphor,
        island,
        plate,
        mats,
        baseEmissive,
        tint: color.clone(),
        baseScale: scale,
        hover: 0,
        angle: 0,
        targetX: 0,
        targetZ: 0,
        phase: Math.random() * Math.PI * 2,
        dim: 0,
      })
    }

    const layout = () => {
      for (const it of islands) {
        const slot = positions[it.key]
        it.angle = slotAngle(slot)
        const r = radiusForState(stateOf(it.key))
        it.targetX = Math.cos(it.angle) * r
        it.targetZ = Math.sin(it.angle) * r
      }
    }
    layout()
    // Snap to initial positions on first build.
    for (const it of islands) it.group.position.set(it.targetX, 0, it.targetZ)

    // Temporarily hide the domain nodes that are not in the allow-list
    // (platform + central figure always stay). Restore via VISIBLE_DOMAINS.
    for (const it of islands) {
      if (!isDomainVisible(it.key)) {
        it.group.visible = false
        it.plate.visible = false
      }
    }

    // Camera focus goal.
    const goalTarget = DEFAULT_TARGET.clone()
    let goalDistance = DEFAULT_POS.distanceTo(DEFAULT_TARGET)
    let transitioning = false
    const applyFocus = (k: string | null, instant: boolean) => {
      const it = k ? islands.find((i) => i.key === k) : null
      if (it) {
        goalTarget.copy(it.group.position).setY(1)
        goalDistance = 10
      } else {
        goalTarget.copy(DEFAULT_TARGET)
        goalDistance = DEFAULT_POS.distanceTo(DEFAULT_TARGET)
      }
      transitioning = true
      if (instant || reduced) {
        controls.target.copy(goalTarget)
        const dir = camera.position.clone().sub(controls.target).normalize()
        camera.position.copy(controls.target).add(dir.multiplyScalar(goalDistance))
        controls.update()
        transitioning = false
      }
    }

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const hitPoint = new THREE.Vector3()

    let downAt = 0
    let downX = 0
    let downY = 0
    let dragging: IslandData | null = null
    let moved = false
    // Hover / click on the central energy orb (opens Yubi's status summary).
    let orbDownHit = false
    let hoverOrb = false
    // Hovered domain (grows + glows) and the animated LED cord state.
    let hoverKey: string | null = null
    let activeWireKey: string | null = null
    let pendingOpenKey: string | null = null
    let wireProgress = 0
    let wireMesh: THREE.Mesh | null = null
    // Tapping the orb grows every cord at once, then opens Yubi's chat.
    let allWiresActive = false
    let allWireProgress = 0
    let pendingPanelOpen = false
    let sawPanel = false
    const allWireMeshes = new Map<string, THREE.Mesh>()
    const wireMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 1.6,
      roughness: 0.28,
      metalness: 0.1,
      transparent: true,
    })
    const wA = new THREE.Vector3()
    const wB = new THREE.Vector3()
    const wC = new THREE.Vector3()
    // Build a tube along the cord, drawn only up to `progress` (0..1).
    const buildWireGeometry = (curve: THREE.Curve<THREE.Vector3>, progress: number) => {
      const p = Math.max(0.001, progress)
      const n = Math.max(2, Math.round(44 * p))
      const pts: THREE.Vector3[] = []
      for (let i = 0; i <= n; i++) pts.push(curve.getPoint((i / n) * p))
      const sub = new THREE.CatmullRomCurve3(pts)
      return new THREE.TubeGeometry(sub, n, 0.03, 8, false)
    }

    const setPointer = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    }

    const pickOrb = (): boolean => {
      if (!personaNode) return false
      raycaster.setFromCamera(pointer, camera)
      return raycaster.intersectObject(personaNode, true).length > 0
    }

    const pickIsland = (): IslandData | null => {
      raycaster.setFromCamera(pointer, camera)
      const hits = raycaster.intersectObjects(islands.map((i) => i.group), true)
      if (!hits.length) return null
      let obj: any = hits[0].object
      while (obj && !obj.userData?.islandKey && obj.parent) {
        const found = islands.find((i) => i.group === obj)
        if (found) return found
        obj = obj.parent
      }
      return islands.find((i) => i.group === obj) ?? null
    }

    const onPointerDown = (e: PointerEvent) => {
      setPointer(e)
      const it = pickIsland()
      downAt = performance.now()
      downX = e.clientX
      downY = e.clientY
      moved = false
      orbDownHit = !it && pickOrb()
      if (it) {
        dragging = it
        controls.enabled = false
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) {
        // Hover feedback: highlight the orb or the domain under the cursor.
        setPointer(e)
        hoverOrb = pickOrb()
        const hit = hoverOrb ? null : pickIsland()
        hoverKey = hit ? hit.key : null
        renderer.domElement.style.cursor = hoverOrb || hoverKey ? 'pointer' : ''
        return
      }
      const dist = Math.hypot(e.clientX - downX, e.clientY - downY)
      if (dist > 6) moved = true
      if (!moved) return
      setPointer(e)
      raycaster.setFromCamera(pointer, camera)
      if (raycaster.ray.intersectPlane(dragPlane, hitPoint)) {
        // Snap onto the node's own state ring at the dragged angle.
        const angle = Math.atan2(hitPoint.z, hitPoint.x)
        const r = radiusForState(stateOf(dragging.key))
        dragging.group.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r)
      }
    }

    const nearestSlot = (angle: number) => {
      let best = 0
      let bestDiff = Infinity
      for (let s = 0; s < SLOT_COUNT; s++) {
        let diff = Math.abs(((slotAngle(s) - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
        if (diff < bestDiff) { bestDiff = diff; best = s }
      }
      return best
    }

    const onPointerUp = (e: PointerEvent) => {
      controls.enabled = true
      const it = dragging
      dragging = null
      const quick = performance.now() - downAt < 400
      const far = Math.hypot(e.clientX - downX, e.clientY - downY) > 6
      if (!it) {
        // Quick tap on the central orb → grow every cord, then open Yubi's chat.
        if (orbDownHit && quick && !far) {
          setFocusKeyRef.current(null)
          activeWireKey = null
          pendingOpenKey = null
          allWiresActive = true
          allWireProgress = 0
          sawPanel = false
          pendingPanelOpen = true
        }
        orbDownHit = false
        return
      }
      if (moved) {
        // Snap to nearest slot; swap if occupied.
        const angle = Math.atan2(it.group.position.z, it.group.position.x)
        const target = nearestSlot(angle)
        const occupant = islands.find((i) => i !== it && positions[i.key] === target)
        if (occupant) positions[occupant.key] = positions[it.key]
        positions[it.key] = target
        layout()
        persistRef.current(positions)
      } else if (quick) {
        // Tap → grow an LED cord from the orb to the domain, then open its info.
        if (focusRef.current === it.key) {
          // Tapping the open domain again closes it and removes the cord.
          setFocusKeyRef.current(null)
          applyFocus(null, false)
          activeWireKey = null
          pendingOpenKey = null
        } else {
          activeWireKey = it.key
          pendingOpenKey = it.key
          wireProgress = 0
          setFocusKeyRef.current(null) // keep the card hidden until the cord connects
          applyFocus(it.key, false)
          // Leaving the orb overview: drop the all-cords chat.
          allWiresActive = false
          pendingPanelOpen = false
          setPanelOpenRef.current(false)
        }
      }
    }

    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)

    // Bloom for a premium neon glow (skipped in reduced-motion for perf).
    let composer: EffectComposer | null = null
    let bloomPass: UnrealBloomPass | null = null
    if (!reduced) {
      composer = new EffectComposer(renderer)
      composer.addPass(new RenderPass(scene, camera))
      bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.11, 0.45, 0.94)
      composer.addPass(bloomPass)
      composer.addPass(new OutputPass())
    }
    const renderFrame = () => (composer ? composer.render() : renderer.render(scene, camera))

    const clock = new THREE.Clock()
    const tmp = new THREE.Vector3()
    let raf = 0
    let hoverT = 0
    const render = () => {
      const dt = clock.getDelta()
      const et = clock.elapsedTime

      // Living world: slowly rotate the orbital rings.
      if (!reduced) {
        for (const s of spinners) s.obj.rotation.z += dt * s.speed
      }

      // Gently bob + animate internal energy.
      if (personaNode) {
        const baseY = personaNode.userData.baseY ?? 1.2
        personaNode.position.y = baseY + Math.sin(et * 1.05) * 0.035
        personaNode.rotation.y = Math.sin(et * 0.22) * 0.12

        const shell = personaNode.userData.shell
        const fresnelMat = personaNode.userData.fresnelMat
        const core = personaNode.userData.core
        const nucleus = personaNode.userData.nucleus
        const haze = personaNode.userData.haze
        const innerLight = personaNode.userData.innerLight
        const streams = personaNode.userData.streams ?? []
        const particles = personaNode.userData.particles
        const particleSeed = personaNode.userData.particleSeed

        if (fresnelMat?.uniforms) {
          fresnelMat.uniforms.uIntensity.value = 0.5 + (Math.sin(et * 1.6) + 1) * 0.06
        }
        if (core?.material) {
          core.material.opacity = 0.38 + Math.sin(et * 2.0) * 0.06
          core.scale.setScalar(1 + Math.sin(et * 1.4 + 0.4) * 0.05)
        }
        if (nucleus?.material) {
          nucleus.material.opacity = 0.44 + (Math.sin(et * 2.6) + 1) * 0.06
          nucleus.scale.setScalar(1 + Math.sin(et * 2.2) * 0.12)
        }
        if (haze?.material) {
          haze.material.opacity = 0.11 + (Math.sin(et * 1.8) + 1) * 0.025
          haze.rotation.y += dt * 0.2
          haze.rotation.x = Math.sin(et * 0.45) * 0.08
        }
        if (innerLight) {
          innerLight.intensity = 0.46 + (Math.sin(et * 2.3) + 1) * 0.1
        }

        // Distinct energy streams: rotate at their own pace + pulse like current.
        for (let i = 0; i < streams.length; i += 1) {
          const s = streams[i]
          s.mesh.rotation.y += dt * s.spin
          s.mesh.rotation.z = s.baseTilt + Math.sin(et * 0.6 + s.phase) * 0.14
          s.mat.opacity = 0.6 + (Math.sin(et * (2.2 + i * 0.5) + s.phase) + 1) * 0.16
        }

        if (particles?.geometry?.attributes?.position && particleSeed) {
          const pos = particles.geometry.attributes.position.array
          const count = pos.length / 3
          for (let i = 0; i < count; i += 1) {
            const idx = i * 3
            const seed = i * 4
            const sx = particleSeed[seed]
            const sy = particleSeed[seed + 1]
            const sz = particleSeed[seed + 2]
            const phase = particleSeed[seed + 3]
            const pulse = 1 + Math.sin(et * 1.8 + phase) * 0.08
            pos[idx] = sx * pulse + Math.sin(et * 0.9 + phase) * 0.012
            pos[idx + 1] = sy * pulse + Math.cos(et * 1.1 + phase) * 0.012
            pos[idx + 2] = sz * pulse + Math.sin(et * 1.2 + phase * 0.7) * 0.012
          }
          particles.geometry.attributes.position.needsUpdate = true
          particles.rotation.y += dt * 0.14
        }

        // Hover affordance: gently enlarge + a crisp fresnel OUTLINE (no milky
        // fill, no whole-orb brightening) so it stays sharp and premium.
        hoverT += ((hoverOrb ? 1 : 0) - hoverT) * (reduced ? 1 : 0.16)
        personaNode.scale.setScalar(1 + hoverT * 0.11)
        const hoverMat = personaNode.userData.hoverMat
        if (hoverMat?.uniforms) hoverMat.uniforms.uHover.value = hoverT
        if (fresnelMat?.uniforms) fresnelMat.uniforms.uIntensity.value += hoverT * 0.28
      }

      // Smooth camera focus (only while transitioning, so it never fights
      // the learner's own rotate/zoom once the move has settled).
      if (!reduced && transitioning) {
        controls.target.lerp(goalTarget, 0.09)
        const dir = camera.position.clone().sub(controls.target)
        const curDist = dir.length()
        const nextDist = curDist + (goalDistance - curDist) * 0.09
        camera.position.copy(controls.target).add(dir.normalize().multiplyScalar(nextDist))
        if (controls.target.distanceTo(goalTarget) < 0.06 && Math.abs(nextDist - goalDistance) < 0.08) {
          transitioning = false
        }
      }
      controls.update()

      // The spotlight = the tapped node (card open) else the focus-to-promote.
      const spot = focusRef.current ?? spotlightKey

      for (const it of islands) {
        const state = stateOf(it.key)
        const isSpot = it.key === spot
        const isProcess = state === 'process'

        // Ease each node toward its state-based ring position (unless dragging).
        if (it !== dragging) {
          it.group.position.x += (it.targetX - it.group.position.x) * (reduced ? 1 : 0.09)
          it.group.position.z += (it.targetZ - it.group.position.z) * (reduced ? 1 : 0.09)
        }
        // Elements stay put — no idle bob, no spin.
        it.group.position.y = 0

        // Framed nameplate: sit it just below the element and face the camera.
        it.plate.position.set(it.group.position.x, -0.42, it.group.position.z)
        it.plate.quaternion.copy(camera.quaternion)

        // Hover: the domain grows a little and glows brighter.
        const wantHover = it.key === hoverKey ? 1 : 0
        it.hover += (wantHover - it.hover) * (reduced ? 1 : 0.16)
        it.metaphor.scale.setScalar(it.baseScale * (1 + it.hover * 0.22))

        // Per-state emphasis. Process nodes are calmer + muted; strengths show
        // full colour; the focus node gets a soft glow + coloured line.
        const wantDim = isProcess ? 0.36 : 0
        it.dim += (wantDim - it.dim) * (reduced ? 1 : 0.1)
        it.spotGlow = (it.spotGlow ?? 0) + ((isSpot ? 1 : 0) - (it.spotGlow ?? 0)) * (reduced ? 1 : 0.1)
        const em = 1 - it.dim * 0.7 * (1 - it.hover)
        const boost = it.spotGlow * 0.3 + it.hover * 0.6
        it.mats.forEach((m, i) => {
          m.emissiveIntensity = it.baseEmissive[i] * em + boost
          m.opacity = 1 - it.dim * 0.42 * (1 - it.hover)
        })
      }

      // Animated LED cord: grows out of the orb and connects to the tapped
      // domain; only when it reaches the domain does its info card open.
      if (activeWireKey && !pendingOpenKey && focusRef.current !== activeWireKey) {
        activeWireKey = null // the card was closed elsewhere → drop the cord
      }
      if (activeWireKey) {
        const it = islands.find((i) => i.key === activeWireKey)
        if (it) {
          const center = wA.set(0, personaNode?.position.y ?? 1.2, 0)
          const target = wB.set(it.group.position.x, -0.1, it.group.position.z)
          const dir = wC.copy(target).sub(center).normalize()
          const origin = center.clone().add(dir.multiplyScalar(1.05))
          const mid = origin.clone().add(target).multiplyScalar(0.5)
          mid.y += 0.9
          const curve = new THREE.QuadraticBezierCurve3(origin, mid.clone(), target.clone())
          wireProgress = reduced ? 1 : Math.min(1, wireProgress + dt / 0.55)
          const geo = buildWireGeometry(curve, wireProgress)
          if (!wireMesh) {
            wireMesh = new THREE.Mesh(geo, wireMat)
            wireMesh.renderOrder = 9
            scene.add(wireMesh)
          } else {
            wireMesh.geometry.dispose()
            wireMesh.geometry = geo
          }
          wireMat.color.copy(it.tint)
          wireMat.emissive.copy(it.tint)
          if (wireProgress >= 1 && pendingOpenKey) {
            setFocusKeyRef.current(pendingOpenKey)
            pendingOpenKey = null
          }
        }
      } else if (wireMesh) {
        wireMesh.geometry.dispose()
        scene.remove(wireMesh)
        wireMesh = null
      }

      // All cords at once: grow from the orb to every domain, then open the
      // Yubi chat; the cords stay lit while the chat is open.
      if (allWiresActive) {
        const center = wA.set(0, personaNode?.position.y ?? 1.2, 0)
        allWireProgress = reduced ? 1 : Math.min(1, allWireProgress + dt / 0.7)
        const building = allWireProgress < 1
        for (const it of islands) {
          if (!it.group.visible) continue
          let mesh = allWireMeshes.get(it.key)
          if (building || !mesh) {
            const target = wB.set(it.group.position.x, -0.1, it.group.position.z)
            const dir = wC.copy(target).sub(center).normalize()
            const origin = center.clone().add(dir.multiplyScalar(1.05))
            const mid = origin.clone().add(target).multiplyScalar(0.5)
            mid.y += 0.9
            const curve = new THREE.QuadraticBezierCurve3(origin, mid.clone(), target.clone())
            const geo = buildWireGeometry(curve, allWireProgress)
            if (!mesh) {
              const m = wireMat.clone()
              m.color.copy(it.tint)
              m.emissive.copy(it.tint)
              mesh = new THREE.Mesh(geo, m)
              mesh.renderOrder = 9
              scene.add(mesh)
              allWireMeshes.set(it.key, mesh)
            } else {
              mesh.geometry.dispose()
              mesh.geometry = geo
            }
          }
        }
        if (allWireProgress >= 1 && pendingPanelOpen) {
          openOrbPanelRef.current()
          pendingPanelOpen = false
        }
        // Once the chat has actually opened, close the cords when it closes.
        if (!pendingPanelOpen) {
          if (panelOpenRef.current) sawPanel = true
          if (sawPanel && !panelOpenRef.current) allWiresActive = false
        }
      }
      if (!allWiresActive && allWireMeshes.size) {
        for (const m of allWireMeshes.values()) {
          m.geometry.dispose()
          ;(m.material as any).dispose?.()
          scene.remove(m)
        }
        allWireMeshes.clear()
        sawPanel = false
      }

      renderFrame()

      // Project labels to screen (HTML overlay), pinned just below each node.
      const rect = mount.getBoundingClientRect()
      for (const it of islands) {
        const el = labelRefsRef.current[it.key]
        if (!el) continue
        const p = tmp.copy(it.group.position).setY(-0.5 + it.group.position.y)
        p.project(camera)
        const x = Math.max(60, Math.min(rect.width - 60, (p.x * 0.5 + 0.5) * rect.width))
        const y = Math.max(60, Math.min(rect.height - 40, (-p.y * 0.5 + 0.5) * rect.height))
        const visible = p.z < 1
        el.style.opacity = visible ? '1' : '0'
        el.style.transform = `translate(-50%, 40%) translate(${x}px, ${y}px)`
      }
      // Caption in front of the dais.
      if (captionRef.current) {
        const p = tmp.set(0, -0.62, 1.2).project(camera)
        const x = (p.x * 0.5 + 0.5) * rect.width
        const y = (-p.y * 0.5 + 0.5) * rect.height
        captionRef.current.style.transform = `translate(-50%, 0) translate(${x}px, ${y}px)`
      }
      // Tooltip anchored to the focused island.
      if (tooltipRef.current) {
        const fk = focusRef.current
        const it = fk ? islands.find((i) => i.key === fk) : null
        if (it) {
          const p = tmp.copy(it.group.position).setY(2.6 + it.group.position.y).project(camera)
          const x = (p.x * 0.5 + 0.5) * rect.width
          const y = (-p.y * 0.5 + 0.5) * rect.height
          tooltipRef.current.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`
        }
      }

      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)

    const onResize = () => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      composer?.setSize(w, h)
      bloomPass?.setSize(w, h)
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(mount)

    // Expose imperative helpers to React.
    sceneApi.current = {
      getPositions: () => ({ ...positions }),
      resetView: () => applyFocus(null, false),
      focusDomain: (k: string | null) => applyFocus(k, false),
      // Drive the three-state visuals + which node holds the spotlight.
      setStates: (map: Record<string, string>) => { stateMap = map; layout() },
      setSpotlight: (k: string | null) => { spotlightKey = k },
    }
    // Push the current three-state model + focus into the freshly-built scene.
    sceneApi.current.setStates(stateByKeyRef.current)
    sceneApi.current.setSpotlight(nextFocusRef.current)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      controls.dispose()
      composer?.dispose?.()
      pmrem.dispose()
      scene.background?.dispose?.()
      renderer.dispose()
      scene.traverse((o: any) => {
        if (o.geometry) o.geometry.dispose?.()
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m: any) => m.dispose?.())
          else o.material.dispose?.()
        }
      })
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement)
      sceneApi.current = null
    }
    // Rebuild the scene when values or motion pref change (theme is ignored —
    // the map is always dark).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, reduced])

  // Bridge refs so the stable effect can reach latest React setters/values.
  const labelRefsRef = useRef(labelRefs.current)
  useEffect(() => { labelRefsRef.current = labelRefs.current })
  const setFocusKeyRef = useRef(setFocusKey)
  useEffect(() => { setFocusKeyRef.current = setFocusKey })
  const openOrbPanelRef = useRef<() => void>(() => {})
  useEffect(() => { openOrbPanelRef.current = () => setPanelOpen(true) })
  const panelOpenRef = useRef(panelOpen)
  useEffect(() => { panelOpenRef.current = panelOpen }, [panelOpen])
  const setPanelOpenRef = useRef(setPanelOpen)
  useEffect(() => { setPanelOpenRef.current = setPanelOpen })
  const activeGoalRef = useRef(activeGoal)
  useEffect(() => { activeGoalRef.current = activeGoal }, [activeGoal])
  // Persist the new arrangement after a drag (keeps focus + goal intact).
  const persistRef = useRef((_p: Record<string, number>) => persist(activeGoalRef.current))
  useEffect(() => { persistRef.current = (_p: Record<string, number>) => persist(activeGoalRef.current) })

  const cardDomain = focusKey && !flow ? domains.find((d) => d.key === focusKey) : null

  // Yubi status summary (deterministic, from real activeness — no invented numbers).
  const summaryStrengths = domains.filter((d) => d.tone !== 'support')
  const summaryGrowth = domains.filter((d) => d.tone === 'support')

  return (
    <div className={`actmap ${direction === 'rtl' ? 'actmap--rtl' : ''}`} dir={direction}>
      <div className="actmap__stage" ref={mountRef} />

      {/* Minimal top chrome. */}
      <header className="actmap__bar">
        <button className="actmap__icon-btn" type="button" onClick={onClose} aria-label={t('actmap.back')}>
          <Icon name="arrow" size={18} />
        </button>
        <h2 className="actmap__title">{t('actmap.title')}</h2>
      </header>

      {/* Domain names are drawn in-scene as framed nameplates below each node. */}

      {/* Personal note from Yubi about the tapped domain. */}
      {cardDomain && isDomainVisible(cardDomain.key) && (
        <div className="actmap__card actmap__card--yubi" role="dialog" aria-label={t(`actmap.domain.${cardDomain.key}`)}>
          <button className="actmap__card-close" type="button" onClick={() => { setFocusKey(null); sceneApi.current?.resetView() }} aria-label={t('actmap.card.close')}>
            <Icon name="close" size={16} />
          </button>
          <div className="actmap__card-yubi-head">
            <span className="actmap__card-yubi-mark"><YuviHeadIcon width={34} height={34} /></span>
            <div className="actmap__card-yubi-id">
              <strong>{t('actmap.yubi.title')}</strong>
              <span>{t('actmap.card.yubi.sub')}</span>
            </div>
            <span
              className="actmap__card-domain"
              style={{ ['--dot' as any]: cardDomain.color }}
            >
              <span className="actmap__card-dot" style={{ background: cardDomain.color }} aria-hidden="true" />
              {t(`actmap.domain.${cardDomain.key}`)}
            </span>
          </div>
          <p className="actmap__card-greeting" dir="auto">
            {t(`actmap.card.yubi.msg.${activeGoal?.domain === cardDomain.key ? 'hasGoal' : (stateByKey[cardDomain.key] || 'strength')}`, {
              name: studentName,
              domain: t(`actmap.domain.${cardDomain.key}`),
            })}
          </p>
          {activeGoal?.domain === cardDomain.key ? (
            <p className="actmap__card-hasgoal"><Icon name="check" size={14} /> {t('actmap.card.hasGoalNote')}</p>
          ) : (
            <button className="actmap__card-cta" type="button" onClick={() => startFlow(cardDomain.key)}>
              <Icon name="target" size={15} /> {t('actmap.card.makeGoal')}
            </button>
          )}
        </div>
      )}

      {/* Goal-building flow: behavior → context → measurable goal. */}
      {flow && (
        <div className="actmap__flow-backdrop" onClick={() => setFlow(null)}>
          <div className="actmap__flow" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="actmap__flow-head">
              <span className="actmap__flow-kicker">{t(`actmap.domain.${flow.domain}`)}</span>
              <strong>{t('actmap.goal.title')}</strong>
              <button className="actmap__card-close" type="button" onClick={() => setFlow(null)} aria-label={t('actmap.goal.cancel')}>
                <Icon name="close" size={16} />
              </button>
            </div>
            <div className="actmap__flow-steps" aria-hidden="true">
              {[1, 2, 3].map((s) => <span key={s} className={s <= flow.step ? 'is-on' : ''} />)}
            </div>

            {flow.step === 1 && (
              <>
                <h4>{t('actmap.goal.step1')}</h4>
                <div className="actmap__flow-options">
                  {['b1', 'b2', 'b3'].map((b) => (
                    <button
                      key={b}
                      type="button"
                      className={`actmap__flow-option ${flow.behavior === b ? 'is-sel' : ''}`}
                      onClick={() => setFlow({ ...flow, behavior: b, step: 2 })}
                    >
                      {t(`actmap.domain.${flow.domain}.${b}`)}
                    </button>
                  ))}
                </div>
              </>
            )}

            {flow.step === 2 && (
              <>
                <h4>{t('actmap.goal.step2')}</h4>
                <div className="actmap__flow-options">
                  {['math', 'group', 'exam', 'any'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`actmap__flow-option ${flow.context === c ? 'is-sel' : ''}`}
                      onClick={() => setFlow({ ...flow, context: c, step: 3 })}
                    >
                      {t(`actmap.context.${c}`)}
                    </button>
                  ))}
                </div>
                <button className="actmap__flow-back" type="button" onClick={() => setFlow({ ...flow, step: 1 })}>
                  {t('actmap.goal.back')}
                </button>
              </>
            )}

            {flow.step === 3 && (
              <>
                <h4>{t('actmap.goal.step3')}</h4>
                <p className="actmap__flow-goal" dir="auto">{goalText(flow)}</p>
                <div className="actmap__flow-actions">
                  <button className="actmap__flow-back" type="button" onClick={() => setFlow({ ...flow, step: 2 })}>
                    {t('actmap.goal.back')}
                  </button>
                  <button className="actmap__flow-confirm" type="button" onClick={() => void confirmGoal()} disabled={saving}>
                    <Icon name="check" size={15} /> {t('actmap.goal.confirm')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {toast && <div className="actmap__toast" role="status"><Icon name="check" size={15} /> {toast}</div>}

      {/* Yubi status summary — a right-side chat panel opened from the orb. */}
      {panelOpen && (
        <>
          <div className="actmap__yubi-backdrop" onClick={() => setPanelOpen(false)} />
          <aside className="actmap__yubi" role="dialog" aria-label={t('actmap.yubi.title')} dir={direction}>
            <header className="actmap__yubi-head">
              <span className="actmap__yubi-mark"><YuviHeadIcon width={30} height={30} /></span>
              <strong>{t('actmap.yubi.title')}</strong>
              <button className="actmap__card-close" type="button" onClick={() => setPanelOpen(false)} aria-label={t('actmap.yubi.close')}>
                <Icon name="close" size={16} />
              </button>
            </header>
            <div className="actmap__yubi-body">
              <div className="actmap__yubi-msg" dir="auto">{t('actmap.yubi.intro', { name: studentName })}</div>

              {summaryStrengths.length > 0 && (
                <div className="actmap__yubi-msg">
                  <span className="actmap__yubi-section"><Icon name="check" size={13} /> {t('actmap.yubi.strengths')}</span>
                  <ul className="actmap__yubi-list">
                    {summaryStrengths.map((d) => (
                      <li key={d.key}>
                        <span className="actmap__yubi-dot" style={{ background: d.color }} aria-hidden="true" />
                        <p dir="auto"><b>{t(`actmap.domain.${d.key}`)}</b> — {t(`actmap.yubi.strong.${d.key}`)}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {summaryGrowth.length > 0 && (
                <div className="actmap__yubi-msg">
                  <span className="actmap__yubi-section"><Icon name="target" size={13} /> {t('actmap.yubi.growth')}</span>
                  <ul className="actmap__yubi-list">
                    {summaryGrowth.map((d) => (
                      <li key={d.key}>
                        <span className="actmap__yubi-dot" style={{ background: d.color }} aria-hidden="true" />
                        <p dir="auto"><b>{t(`actmap.domain.${d.key}`)}</b> — {t(`actmap.yubi.grow.${d.key}`)}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="actmap__yubi-msg actmap__yubi-msg--outro" dir="auto">{t('actmap.yubi.outro')}</div>
            </div>
          </aside>
        </>
      )}
    </div>
  )
}
