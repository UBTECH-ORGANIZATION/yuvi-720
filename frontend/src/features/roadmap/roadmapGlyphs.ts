/* Canvas-painted textures for the roadmap scene: the level number badges,
   the glyphs for rewards that are not a thing with a catalogue picture (a
   hint token, a profile frame, a room mood, a sound set), and the soft dots
   the glows, beams and dust are made of. Painted once per mount; nothing
   here touches Three.js so it can be unit-tested by hand in a browser tab. */

import type { LevelState } from './roadmapModel'

export const PALETTE = {
  cyan: '#77f4ff',
  cyanDeep: '#2fb9d6',
  purple: '#9f7afe',
  pink: '#ff8abc',
  gold: '#f4c95d',
  goldDeep: '#c99a2e',
  ink: '#0b1030',
  slate: '#3a4066',
  white: '#f6f7ff',
} as const

const FONT = '"Rubik", "Heebo", system-ui, -apple-system, sans-serif'

function canvas(size: number, height = size): CanvasRenderingContext2D {
  const element = document.createElement('canvas')
  element.width = size
  element.height = height
  const context = element.getContext('2d')
  if (!context) throw new Error('2d canvas unavailable')
  return context
}

/** A soft radial dot: dust motes, item glows, the beacon's halo. */
export function glowDot(size = 64): HTMLCanvasElement {
  const ctx = canvas(size)
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.35, 'rgba(255,255,255,.55)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  return ctx.canvas
}

/** A vertical fade, bright at the bottom: wrapped around a cylinder it is
 *  the light beam that marks the learner's pad. */
export function beamGradient(): HTMLCanvasElement {
  const ctx = canvas(4, 128)
  const gradient = ctx.createLinearGradient(0, 0, 0, 128)
  gradient.addColorStop(0, 'rgba(255,255,255,0)')
  gradient.addColorStop(0.55, 'rgba(255,255,255,.28)')
  gradient.addColorStop(1, 'rgba(255,255,255,.9)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 4, 128)
  return ctx.canvas
}

/** The number that floats over a pad. Reached levels are gold, the current
 *  one is cyan, the road ahead is slate — the same code the ring on the pad
 *  speaks, so a number is readable from a distance before the ring is. */
export function levelBadge(level: number, state: LevelState, milestone: boolean): HTMLCanvasElement {
  const size = 160
  const ctx = canvas(size)
  const c = size / 2
  const fill = state === 'current' ? PALETTE.cyan : state === 'reached' ? PALETTE.gold : PALETTE.slate
  const ink = state === 'locked' ? PALETTE.white : PALETTE.ink
  ctx.shadowColor = fill
  ctx.shadowBlur = state === 'locked' ? 0 : 18
  ctx.beginPath()
  if (milestone) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2
      ctx.lineTo(c + Math.cos(a) * 58, c + Math.sin(a) * 58)
    }
    ctx.closePath()
  } else {
    ctx.arc(c, c, 52, 0, Math.PI * 2)
  }
  ctx.fillStyle = state === 'locked' ? 'rgba(58,64,102,.92)' : fill
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.lineWidth = 5
  ctx.strokeStyle = state === 'locked' ? 'rgba(159,122,254,.55)' : 'rgba(255,255,255,.75)'
  ctx.stroke()
  ctx.fillStyle = ink
  ctx.font = `800 ${level >= 10 ? 62 : 68}px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(level), c, c + 4)
  return ctx.canvas
}

export type GlyphKind = 'hint' | 'frame' | 'mood' | 'sound' | 'lock'

/** A reward that has no catalogue picture, drawn as a badge: a rounded tile
 *  in the reward's colour with a line icon in it. */
export function rewardGlyph(kind: GlyphKind, level?: number): HTMLCanvasElement {
  const size = 256
  const ctx = canvas(size)
  const c = size / 2
  const tint = kind === 'frame' ? PALETTE.gold : kind === 'sound' ? PALETTE.pink : kind === 'lock' ? PALETTE.slate : PALETTE.purple
  // Tile
  ctx.beginPath()
  ctx.roundRect(28, 28, size - 56, size - 56, 44)
  const back = ctx.createLinearGradient(0, 28, 0, size - 28)
  back.addColorStop(0, 'rgba(20,24,56,.96)')
  back.addColorStop(1, 'rgba(10,13,34,.96)')
  ctx.fillStyle = back
  ctx.fill()
  ctx.lineWidth = 6
  ctx.strokeStyle = tint
  ctx.shadowColor = tint
  ctx.shadowBlur = 22
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.strokeStyle = tint
  ctx.fillStyle = tint
  ctx.lineWidth = 11
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (kind === 'hint') {
    // A bulb: dome, neck, base.
    ctx.beginPath()
    ctx.arc(c, c - 18, 44, Math.PI * 0.8, Math.PI * 2.2)
    ctx.lineTo(c + 22, c + 34)
    ctx.lineTo(c - 22, c + 34)
    ctx.closePath()
    ctx.stroke()
    ctx.beginPath(); ctx.moveTo(c - 18, c + 56); ctx.lineTo(c + 18, c + 56); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(c - 12, c + 76); ctx.lineTo(c + 12, c + 76); ctx.stroke()
    // Rays
    for (const a of [-2.6, -2.0, -1.1, -0.5]) {
      ctx.beginPath()
      ctx.moveTo(c + Math.cos(a) * 62, c - 18 + Math.sin(a) * 62)
      ctx.lineTo(c + Math.cos(a) * 80, c - 18 + Math.sin(a) * 80)
      ctx.stroke()
    }
  } else if (kind === 'frame') {
    ctx.beginPath()
    ctx.roundRect(c - 60, c - 60, 120, 120, 22)
    ctx.stroke()
    ctx.fillStyle = PALETTE.gold
    ctx.font = `800 ${level && level >= 10 ? 54 : 60}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(level ? String(level) : '★', c, c + 3)
    // Corner sparks
    for (const [x, y] of [[c - 78, c - 78], [c + 78, c - 78], [c - 78, c + 78], [c + 78, c + 78]] as const) {
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill()
    }
  } else if (kind === 'mood') {
    // A lamp cone over a lit floor, three arcs of light.
    for (const r of [34, 58, 82]) {
      ctx.beginPath()
      ctx.arc(c, c + 44, r, Math.PI * 1.15, Math.PI * 1.85)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.moveTo(c - 26, c + 44); ctx.lineTo(c, c - 4); ctx.lineTo(c + 26, c + 44)
    ctx.closePath()
    ctx.fill()
  } else if (kind === 'sound') {
    // A speaker and three waves.
    ctx.beginPath()
    ctx.moveTo(c - 70, c - 22); ctx.lineTo(c - 44, c - 22); ctx.lineTo(c - 12, c - 52)
    ctx.lineTo(c - 12, c + 52); ctx.lineTo(c - 44, c + 22); ctx.lineTo(c - 70, c + 22)
    ctx.closePath()
    ctx.fill()
    for (const r of [30, 54, 78]) {
      ctx.beginPath()
      ctx.arc(c - 6, c, r, -Math.PI * 0.3, Math.PI * 0.3)
      ctx.stroke()
    }
  } else {
    // A padlock.
    ctx.beginPath()
    ctx.roundRect(c - 46, c - 6, 92, 72, 16)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(c, c - 20, 30, Math.PI, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = PALETTE.ink
    ctx.beginPath(); ctx.arc(c, c + 26, 10, 0, Math.PI * 2); ctx.fill()
  }
  return ctx.canvas
}

/** A spark: a four-point star in gold with a warm core, for spark grants. */
export function sparkGlyph(): HTMLCanvasElement {
  const size = 256
  const ctx = canvas(size)
  const c = size / 2
  const halo = ctx.createRadialGradient(c, c, 0, c, c, c)
  halo.addColorStop(0, 'rgba(255,214,110,.75)')
  halo.addColorStop(0.5, 'rgba(255,190,70,.18)')
  halo.addColorStop(1, 'rgba(255,190,70,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, size, size)
  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2
    const r = i % 2 === 0 ? 92 : 30
    ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r)
  }
  ctx.closePath()
  const star = ctx.createLinearGradient(c, c - 92, c, c + 92)
  star.addColorStop(0, '#fff3c4')
  star.addColorStop(0.55, PALETTE.gold)
  star.addColorStop(1, PALETTE.goldDeep)
  ctx.fillStyle = star
  ctx.shadowColor = '#ffd36e'
  ctx.shadowBlur = 24
  ctx.fill()
  return ctx.canvas
}
