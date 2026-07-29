// @ts-nocheck
/* eslint-disable */
/**
 * Procedural texture kit for the activeness world.
 *
 * Everything here is generated on a canvas at runtime — no binary assets, no
 * network cost, and every surface (grass, rock, bark, paper, metal, sky) gets a
 * matching **normal + roughness** map so the scene reads as a crafted,
 * hand-painted diorama instead of flat coloured plastic.
 *
 * Textures are cached by key: a domain island and its metaphor reuse the same
 * GPU upload, so seven islands cost roughly one island's worth of memory.
 */
import * as THREE from 'three'

/* ── deterministic value noise ─────────────────────────────────────────── */

const hash = (x: number, y: number, seed: number) => {
  let h = x * 374761393 + y * 668265263 + seed * 1442695040888963407
  h = (h ^ (h >>> 13)) * 1274126177
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

const smooth = (t: number) => t * t * (3 - 2 * t)

/** Tileable value noise — wraps on `period` so textures repeat seamlessly. */
function valueNoise(x: number, y: number, period: number, seed: number) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const w = (n: number) => ((n % period) + period) % period
  const x0 = w(xi)
  const x1 = w(xi + 1)
  const y0 = w(yi)
  const y1 = w(yi + 1)
  const u = smooth(xf)
  const v = smooth(yf)
  const a = hash(x0, y0, seed)
  const b = hash(x1, y0, seed)
  const c = hash(x0, y1, seed)
  const d = hash(x1, y1, seed)
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

/** Fractal brownian motion over the tileable noise. */
export function fbm(x: number, y: number, octaves: number, basePeriod: number, seed: number) {
  let sum = 0
  let amp = 0.5
  let norm = 0
  let period = basePeriod
  for (let o = 0; o < octaves; o += 1) {
    sum += valueNoise(x * period, y * period, period, seed + o * 91) * amp
    norm += amp
    amp *= 0.5
    period *= 2
  }
  return sum / norm
}

/* ── canvas helpers ────────────────────────────────────────────────────── */

function canvasOf(size: number) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  return c
}

/** Derive a tangent-space normal map from a greyscale height field. */
function normalFromHeight(height: Float32Array, size: number, strength: number): HTMLCanvasElement {
  const c = canvasOf(size)
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(size, size)
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)]
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength
      // normalize(-dx, -dy, 1)
      const len = Math.hypot(dx, dy, 1)
      const i = (y * size + x) * 4
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255
      img.data[i + 2] = (1 / len) * 0.5 * 255 + 127
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return c
}

function greyCanvas(values: Float32Array, size: number, lo: number, hi: number): HTMLCanvasElement {
  const c = canvasOf(size)
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(size, size)
  for (let i = 0; i < values.length; i += 1) {
    const v = Math.round((lo + (hi - lo) * values[i]) * 255)
    const p = i * 4
    img.data[p] = img.data[p + 1] = img.data[p + 2] = v
    img.data[p + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return c
}

function toTexture(canvas: HTMLCanvasElement, srgb: boolean, repeat = 1) {
  const tex = new THREE.CanvasTexture(canvas)
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(repeat, repeat)
  tex.anisotropy = 16
  tex.needsUpdate = true
  return tex
}

export interface SurfaceMaps {
  map: THREE.Texture
  normalMap: THREE.Texture
  roughnessMap: THREE.Texture
}

const cache = new Map<string, any>()
function memo<T>(key: string, make: () => T): T {
  const hit = cache.get(key)
  if (hit) return hit
  const made = make()
  cache.set(key, made)
  return made
}

/** Drop every cached texture (called when the world unmounts). */
export function disposeTextureCache() {
  for (const value of cache.values()) {
    if (value?.isTexture) value.dispose()
    else if (value?.map) {
      value.map?.dispose?.()
      value.normalMap?.dispose?.()
      value.roughnessMap?.dispose?.()
    }
  }
  cache.clear()
}

/* ── surfaces ──────────────────────────────────────────────────────────── */

const mix = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, t)

/**
 * Living grass: clumped colour variation, darker in the crevices, with a
 * blade-scale normal map so raking light picks out the texture.
 */
export function grassMaps(lightHex: string, darkHex: string, seed = 7): SurfaceMaps {
  return memo(`grass:${lightHex}:${darkHex}:${seed}`, () => {
    const S = 256
    const light = new THREE.Color(lightHex)
    const dark = new THREE.Color(darkHex)
    const height = new Float32Array(S * S)
    const rough = new Float32Array(S * S)
    const c = canvasOf(S)
    const ctx = c.getContext('2d')!
    const img = ctx.createImageData(S, S)
    for (let y = 0; y < S; y += 1) {
      for (let x = 0; x < S; x += 1) {
        const i = y * S + x
        const clump = fbm(x / S, y / S, 4, 5, seed)
        const blades = fbm(x / S, y / S, 3, 34, seed + 17)
        const t = Math.min(1, Math.max(0, clump * 0.72 + blades * 0.42 - 0.08))
        const col = mix(dark, light, t)
        // a few sun-bleached tips
        const tip = blades > 0.72 ? (blades - 0.72) * 1.4 : 0
        col.lerp(new THREE.Color('#f2ffd8'), tip * 0.35)
        const p = i * 4
        img.data[p] = col.r * 255
        img.data[p + 1] = col.g * 255
        img.data[p + 2] = col.b * 255
        img.data[p + 3] = 255
        height[i] = blades * 0.7 + clump * 0.3
        rough[i] = 0.72 + (1 - blades) * 0.2
      }
    }
    ctx.putImageData(img, 0, 0)
    return {
      map: toTexture(c, true, 2),
      normalMap: toTexture(normalFromHeight(height, S, 26), false, 2),
      roughnessMap: toTexture(greyCanvas(rough, S, 0, 1), false, 2),
    }
  })
}

/**
 * Weathered rock: layered strata, sharp chips and mineral speckle. Used for the
 * underside of every floating island.
 */
export function rockMaps(baseHex: string, veinHex: string, seed = 3): SurfaceMaps {
  return memo(`rock:${baseHex}:${veinHex}:${seed}`, () => {
    const S = 256
    const base = new THREE.Color(baseHex)
    const vein = new THREE.Color(veinHex)
    const height = new Float32Array(S * S)
    const rough = new Float32Array(S * S)
    const c = canvasOf(S)
    const ctx = c.getContext('2d')!
    const img = ctx.createImageData(S, S)
    for (let y = 0; y < S; y += 1) {
      for (let x = 0; x < S; x += 1) {
        const i = y * S + x
        const strata = fbm(x / S, y / S * 3.2, 4, 6, seed)
        const chips = fbm(x / S, y / S, 5, 18, seed + 31)
        const grit = fbm(x / S, y / S, 2, 60, seed + 55)
        const t = Math.min(1, Math.max(0, strata * 0.6 + chips * 0.55 - 0.1))
        const col = mix(base, vein, t)
        col.multiplyScalar(0.86 + grit * 0.3)
        const p = i * 4
        img.data[p] = col.r * 255
        img.data[p + 1] = col.g * 255
        img.data[p + 2] = col.b * 255
        img.data[p + 3] = 255
        height[i] = chips * 0.62 + strata * 0.38
        rough[i] = 0.78 + grit * 0.18
      }
    }
    ctx.putImageData(img, 0, 0)
    return {
      map: toTexture(c, true, 1.6),
      normalMap: toTexture(normalFromHeight(height, S, 34), false, 1.6),
      roughnessMap: toTexture(greyCanvas(rough, S, 0, 1), false, 1.6),
    }
  })
}

/** Tree bark — vertical fibres with deep grooves. */
export function barkMaps(): SurfaceMaps {
  return memo('bark', () => {
    const S = 256
    const light = new THREE.Color('#6a5340')
    const dark = new THREE.Color('#3a2b22')
    const height = new Float32Array(S * S)
    const rough = new Float32Array(S * S)
    const c = canvasOf(S)
    const ctx = c.getContext('2d')!
    const img = ctx.createImageData(S, S)
    for (let y = 0; y < S; y += 1) {
      for (let x = 0; x < S; x += 1) {
        const i = y * S + x
        const fibre = fbm(x / S * 3.4, y / S * 0.35, 4, 16, 12)
        const knot = fbm(x / S, y / S, 3, 5, 41)
        const t = Math.min(1, Math.max(0, fibre * 0.8 + knot * 0.3 - 0.1))
        const col = mix(dark, light, t)
        const p = i * 4
        img.data[p] = col.r * 255
        img.data[p + 1] = col.g * 255
        img.data[p + 2] = col.b * 255
        img.data[p + 3] = 255
        height[i] = fibre
        rough[i] = 0.8 + (1 - fibre) * 0.15
      }
    }
    ctx.putImageData(img, 0, 0)
    return {
      map: toTexture(c, true, 1),
      normalMap: toTexture(normalFromHeight(height, S, 40), false, 1),
      roughnessMap: toTexture(greyCanvas(rough, S, 0, 1), false, 1),
    }
  })
}

/** Fine paper for the open book — soft fibre grain, almost flat. */
export function paperMaps(): SurfaceMaps {
  return memo('paper', () => {
    const S = 128
    const height = new Float32Array(S * S)
    const rough = new Float32Array(S * S)
    const c = canvasOf(S)
    const ctx = c.getContext('2d')!
    const img = ctx.createImageData(S, S)
    for (let y = 0; y < S; y += 1) {
      for (let x = 0; x < S; x += 1) {
        const i = y * S + x
        const g = fbm(x / S, y / S, 3, 26, 5)
        const v = 0.9 + g * 0.1
        const p = i * 4
        img.data[p] = 252 * v
        img.data[p + 1] = 249 * v
        img.data[p + 2] = 240 * v
        img.data[p + 3] = 255
        height[i] = g
        rough[i] = 0.86
      }
    }
    ctx.putImageData(img, 0, 0)
    return {
      map: toTexture(c, true, 1),
      normalMap: toTexture(normalFromHeight(height, S, 8), false, 1),
      roughnessMap: toTexture(greyCanvas(rough, S, 0, 1), false, 1),
    }
  })
}

/** Brushed metal for the telescope / compass bodies. */
export function metalMaps(): SurfaceMaps {
  return memo('metal', () => {
    const S = 256
    const height = new Float32Array(S * S)
    const rough = new Float32Array(S * S)
    const c = canvasOf(S)
    const ctx = c.getContext('2d')!
    const img = ctx.createImageData(S, S)
    for (let y = 0; y < S; y += 1) {
      for (let x = 0; x < S; x += 1) {
        const i = y * S + x
        const brush = fbm(x / S * 0.2, y / S * 8, 3, 40, 23)
        const patina = fbm(x / S, y / S, 3, 6, 77)
        const v = 0.72 + brush * 0.24 + patina * 0.1
        const p = i * 4
        img.data[p] = 226 * v
        img.data[p + 1] = 230 * v
        img.data[p + 2] = 246 * v
        img.data[p + 3] = 255
        height[i] = brush
        rough[i] = 0.18 + patina * 0.34
      }
    }
    ctx.putImageData(img, 0, 0)
    return {
      map: toTexture(c, true, 1),
      normalMap: toTexture(normalFromHeight(height, S, 6), false, 1),
      roughnessMap: toTexture(greyCanvas(rough, S, 0, 1), false, 1),
    }
  })
}

/* ── sprites & backdrops ───────────────────────────────────────────────── */

/** Soft radial sprite — used for glows, ground shadows and dust motes. */
export function radialSprite(inner: string, outer = 'rgba(255,255,255,0)', stopAt = 0.55): THREE.Texture {
  return memo(`radial:${inner}:${outer}:${stopAt}`, () => {
    const S = 256
    const c = canvasOf(S)
    const ctx = c.getContext('2d')!
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
    g.addColorStop(0, inner)
    g.addColorStop(stopAt, inner.replace(/[\d.]+\)$/, '0.28)'))
    g.addColorStop(1, outer)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, S, S)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    return tex
  })
}

/** Four-point star sparkle used for dust and crystal glints. */
export function sparkleSprite(): THREE.Texture {
  return memo('sparkle', () => {
    const S = 128
    const c = canvasOf(S)
    const ctx = c.getContext('2d')!
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.25, 'rgba(226,214,255,0.6)')
    g.addColorStop(1, 'rgba(190,170,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, S, S)
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = 2.4
    ctx.beginPath()
    ctx.moveTo(S / 2, 8); ctx.lineTo(S / 2, S - 8)
    ctx.moveTo(8, S / 2); ctx.lineTo(S - 8, S / 2)
    ctx.stroke()
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  })
}

/**
 * A round status pin planted on an island: a coloured disc with a white,
 * language-free glyph. The learner must be able to read every domain's state
 * from the shapes alone, in about three seconds, without reading any label.
 */
export function statusBadge(kind: 'strength' | 'next' | 'process' | 'unknown', hex: string): THREE.Texture {
  return memo(`statusbadge:${kind}:${hex}`, () => {
    const S = 256
    const c = canvasOf(S)
    const ctx = c.getContext('2d')!
    const R = S * 0.4
    const cx = S / 2
    const cy = S / 2

    // white collar so the pin keeps its shape against grass, sky or fog
    ctx.fillStyle = 'rgba(255,255,255,.95)'
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.16, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = hex
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill()

    ctx.strokeStyle = '#ffffff'
    ctx.fillStyle = '#ffffff'
    ctx.lineWidth = S * 0.055
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (kind === 'strength') {
      // filled star — "this is already mine"
      const spikes = 5
      const outer = R * 0.62
      const inner = outer * 0.46
      ctx.beginPath()
      for (let i = 0; i < spikes * 2; i += 1) {
        const rr = i % 2 === 0 ? outer : inner
        const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2
        const px = cx + Math.cos(a) * rr
        const py = cy + Math.sin(a) * rr
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath(); ctx.fill()
    } else if (kind === 'next') {
      // target rings — "this is where I'm heading"
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.6, 0, Math.PI * 2); ctx.stroke()
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.3, 0, Math.PI * 2); ctx.stroke()
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.08, 0, Math.PI * 2); ctx.fill()
    } else if (kind === 'process') {
      // rising arrow — "on the way"
      ctx.beginPath()
      ctx.moveTo(cx, cy + R * 0.55)
      ctx.lineTo(cx, cy - R * 0.5)
      ctx.moveTo(cx - R * 0.36, cy - R * 0.16)
      ctx.lineTo(cx, cy - R * 0.55)
      ctx.lineTo(cx + R * 0.36, cy - R * 0.16)
      ctx.stroke()
    } else {
      // question mark — "we have no picture of this one yet"
      ctx.lineWidth = S * 0.062
      ctx.beginPath()
      ctx.arc(cx, cy - R * 0.16, R * 0.3, Math.PI * 0.92, Math.PI * 2.12)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(cx + R * 0.02, cy + R * 0.05)
      ctx.lineTo(cx + R * 0.02, cy + R * 0.24)
      ctx.stroke()
      ctx.beginPath(); ctx.arc(cx + R * 0.02, cy + R * 0.52, R * 0.09, 0, Math.PI * 2); ctx.fill()
    }

    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    return tex
  })
}

/**
 * The world backdrop: a soft lavender sky with a warm halo behind the centre —
 * matches the product's light surfaces so the map feels part of the app.
 */
export function skyTexture(stops: [string, string, string], halo: string): THREE.Texture {
  return memo(`sky:${stops.join()}:${halo}`, () => {
    const W = 512
    const H = 512
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const ctx = c.getContext('2d')!
    const v = ctx.createLinearGradient(0, 0, 0, H)
    v.addColorStop(0, stops[0])
    v.addColorStop(0.52, stops[1])
    v.addColorStop(1, stops[2])
    ctx.fillStyle = v
    ctx.fillRect(0, 0, W, H)
    const halos: [number, number, number, number][] = [
      [0.5, 0.42, 0.46, 1],
      [0.18, 0.3, 0.26, 0.55],
      [0.84, 0.36, 0.24, 0.45],
    ]
    for (const [hx, hy, hr, alpha] of halos) {
      const g = ctx.createRadialGradient(W * hx, H * hy, 0, W * hx, H * hy, W * hr)
      g.addColorStop(0, halo.replace('ALPHA', String(0.55 * alpha)))
      g.addColorStop(1, halo.replace('ALPHA', '0'))
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
    }
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  })
}

/** Engraved compass face (cardinal ticks) drawn straight to a texture. */
export function compassFace(tintHex: string): THREE.Texture {
  return memo(`compassface:${tintHex}`, () => {
    const S = 512
    const c = canvasOf(S)
    const ctx = c.getContext('2d')!
    const g = ctx.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S / 2)
    g.addColorStop(0, '#fbf7ff')
    g.addColorStop(0.7, '#e6e0f6')
    g.addColorStop(1, '#cdc4e6')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 4, 0, Math.PI * 2); ctx.fill()
    ctx.translate(S / 2, S / 2)
    for (let i = 0; i < 48; i += 1) {
      const major = i % 12 === 0
      const mid = i % 4 === 0
      ctx.save()
      ctx.rotate((i / 48) * Math.PI * 2)
      ctx.strokeStyle = major ? tintHex : mid ? 'rgba(70,58,110,.6)' : 'rgba(110,100,150,.32)'
      ctx.lineWidth = major ? 9 : mid ? 5 : 3
      ctx.beginPath()
      ctx.moveTo(0, -S / 2 + 16)
      ctx.lineTo(0, -S / 2 + (major ? 62 : mid ? 44 : 32))
      ctx.stroke()
      ctx.restore()
    }
    ctx.strokeStyle = 'rgba(90,76,140,.34)'
    ctx.lineWidth = 4
    ctx.beginPath(); ctx.arc(0, 0, S / 2 - 78, 0, Math.PI * 2); ctx.stroke()
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 16
    return tex
  })
}

/** Open-book page art: ruled lines that read as text at a distance. */
export function pageText(): THREE.Texture {
  return memo('pagetext', () => {
    const W = 512
    const H = 512
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fdfbf4'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = 'rgba(58,50,96,.42)'
    for (let line = 0; line < 13; line += 1) {
      const y = 62 + line * 32
      const w = 150 + Math.round(hash(line, 3, 9) * 160)
      const x = W / 2 - w / 2 + (hash(line, 7, 4) - 0.5) * 40
      ctx.fillRect(x, y, w, 7)
    }
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 16
    return tex
  })
}
