import { useId, useMemo } from 'react'
import '../styles/badge.css'

/**
 * Yuvi learning badge — a flat, theme-aware coin. Ported verbatim from the
 * "Yuvi Learning Badges" design artifact so the visual is identical everywhere
 * it renders (shelf, celebration, toast, profile avatar).
 *
 * The badge is a PROJECTION of the brain (see backend `badges.py`); this
 * component only draws what it is handed — no logic, no data fetching.
 */

export type BadgeTier = 'bronze' | 'silver' | 'gold'
export type BadgeState = 'locked' | 'inprogress' | 'earned'
export type BadgeGlyph =
  | 'flask' | 'math' | 'book' | 'planet' | 'gear' | 'valley' | 'comeback' | 'flame'

export interface BadgeProps {
  /** subject family key — drives the coin colour (falls back to `science`). */
  subject: string
  glyph: BadgeGlyph
  tier?: BadgeTier
  state?: BadgeState
  /** 0..1 ring fill, used when `state === 'inprogress'`. */
  progress?: number
  title?: string
  /** rendered pixel width; the SVG scales to it. */
  size?: number
  /** compact form (avatar chip): drops the star pill and the earned ring. */
  mini?: boolean
  /** keep the coin + ring but hide the star pill (milestone badges have no tier depth). */
  noStars?: boolean
  /** decorative background pattern behind the glyph. */
  motif?: BadgeMotif
  className?: string
}

const METAL: Record<BadgeTier, string> = { bronze: '#E1954E', silver: '#A9B7CC', gold: '#F3C64C' }
const STARS: Record<BadgeTier, number> = { bronze: 1, silver: 2, gold: 3 }

interface Palette { a: string; b: string; deep: string }
const SUBJECTS: Record<string, Palette> = {
  // subjects
  science: { a: '#7FA8FF', b: '#4F79EA', deep: '#26439A' },
  math: { a: '#5BD09D', b: '#22A971', deep: '#128153' },
  language: { a: '#C08CEE', b: '#8E5AD8', deep: '#63389F' },
  discovery: { a: '#8E7DF6', b: '#5E4CE0', deep: '#3A2BA0' },
  stem: { a: '#F8B65D', b: '#EC8A2C', deep: '#B25E10' },
  world: { a: '#42D7D2', b: '#17A6AC', deep: '#0B767C' },
  // milestone families — each its own colour for variety on the shelf
  spark: { a: '#FFD27A', b: '#F4A63C', deep: '#B26A10' },   // first steps — gold
  aim: { a: '#FF9DB0', b: '#E5487A', deep: '#9E2150' },     // sharpshooter — crimson
  flame: { a: '#FFB27A', b: '#F5642B', deep: '#B23A0E' },   // on fire — ember
  revive: { a: '#7DE0B0', b: '#1F9D6B', deep: '#0E7A4F' },  // comeback — green
  devote: { a: '#9DB0FF', b: '#5A6BEA', deep: '#2E3A9E' },  // dedicated — indigo
  streak: { a: '#7DE0E6', b: '#17A6AC', deep: '#0B767C' },  // consistency — cyan
  cosmos: { a: '#B79CFF', b: '#7C5CFF', deep: '#4733C9' },  // explorer — violet
}

/** Decorative pattern drawn behind the glyph, clipped to the coin. */
export type BadgeMotif = 'none' | 'rays' | 'orbit' | 'sparkle' | 'target'

function motifMarkup(motif: BadgeMotif | undefined): string {
  switch (motif) {
    case 'rays': {
      let lines = ''
      for (let i = 0; i < 12; i++) {
        lines += `<line x1="100" y1="100" x2="100" y2="22" stroke="#fff" stroke-width="4" opacity="0.09" stroke-linecap="round" transform="rotate(${i * 30} 100 100)"/>`
      }
      return `<g>${lines}</g>`
    }
    case 'orbit':
      return (
        `<g fill="none" stroke="#fff" opacity="0.16" stroke-width="3">` +
        `<ellipse cx="100" cy="100" rx="70" ry="30" transform="rotate(-22 100 100)"/>` +
        `<ellipse cx="100" cy="100" rx="70" ry="30" transform="rotate(22 100 100)"/></g>`
      )
    case 'target':
      return (
        `<g fill="none" stroke="#fff" opacity="0.13" stroke-width="3">` +
        `<circle cx="100" cy="100" r="64"/><circle cx="100" cy="100" r="46"/><circle cx="100" cy="100" r="28"/></g>`
      )
    case 'sparkle': {
      const pts = [[64, 60], [140, 72], [58, 128], [146, 132], [100, 44]]
      return pts
        .map(([x, y], i) => {
          const s = i % 2 ? 5 : 7
          return `<path transform="translate(${x},${y})" d="M0,-${s} L${s * 0.28},-${s * 0.28} L${s},0 L${s * 0.28},${s * 0.28} L0,${s} L-${s * 0.28},${s * 0.28} L-${s},0 L-${s * 0.28},-${s * 0.28} Z" fill="#fff" opacity="0.2"/>`
        })
        .join('')
    }
    default:
      return ''
  }
}

function glyphMarkup(name: string, deep: string, id: string): string {
  switch (name) {
    case 'flask':
      return (
        `<clipPath id="fl${id}"><circle cx="100" cy="110" r="25"/></clipPath>` +
        `<circle cx="100" cy="110" r="25" fill="#fff"/>` +
        `<g clip-path="url(#fl${id})"><rect x="74" y="114" width="52" height="32" fill="${deep}"/>` +
        `<path d="M74,116 q13,-8 26,0 t26,0 v-4 h-52 z" fill="${deep}"/></g>` +
        `<circle cx="95" cy="122" r="3" fill="#fff" opacity="0.85"/><circle cx="107" cy="129" r="2.3" fill="#fff" opacity="0.7"/>` +
        `<rect x="93" y="62" width="14" height="34" rx="3" fill="#fff"/><rect x="88" y="57" width="24" height="8" rx="4" fill="#fff"/>` +
        `<path d="M93,70 h14 M93,77 h14" stroke="${deep}" stroke-width="2.4" opacity="0.45" stroke-linecap="round"/>` +
        `<g stroke="#141A38" stroke-width="4.6" fill="none" stroke-linecap="round">` +
        `<ellipse cx="100" cy="108" rx="41" ry="15.5" transform="rotate(27 100 108)"/>` +
        `<ellipse cx="100" cy="108" rx="41" ry="15.5" transform="rotate(-27 100 108)"/></g>` +
        `<circle cx="135" cy="94" r="4.2" fill="#141A38"/>`
      )
    case 'math':
      return (
        `<g stroke="#fff" stroke-width="9" stroke-linecap="round">` +
        `<path d="M84,86 v16 M76,94 h16"/><path d="M108,94 h16"/>` +
        `<path d="M76,114 l16,16 M92,114 l-16,16"/><path d="M108,122 h16"/></g>` +
        `<circle cx="116" cy="114" r="3" fill="#fff"/><circle cx="116" cy="130" r="3" fill="#fff"/>`
      )
    case 'book':
      return (
        `<path d="M100,84 C90,77 75,78 67,83 L67,126 C75,120 90,119 100,126 Z" fill="#fff"/>` +
        `<path d="M100,84 C110,77 125,78 133,83 L133,126 C125,120 110,119 100,126 Z" fill="#F1E9FB"/>` +
        `<path d="M100,84 L100,126" stroke="${deep}" stroke-width="3.2" stroke-linecap="round"/>` +
        `<g stroke="${deep}" stroke-width="2.5" opacity="0.5" stroke-linecap="round">` +
        `<path d="M75,94 h16 M75,103 h16 M75,112 h13 M109,94 h16 M109,103 h16 M109,112 h13"/></g>`
      )
    case 'planet':
      return (
        `<ellipse cx="100" cy="104" rx="42" ry="14" transform="rotate(-20 100 104)" fill="none" stroke="${deep}" stroke-width="7"/>` +
        `<circle cx="100" cy="101" r="25" fill="#fff"/>` +
        `<path d="M62,112 A42,14 0 0 0 138,96" transform="rotate(-20 100 104)" fill="none" stroke="${deep}" stroke-width="7" stroke-linecap="round"/>` +
        `<circle cx="91" cy="94" r="7" fill="${deep}" opacity="0.16"/><circle cx="108" cy="106" r="4" fill="${deep}" opacity="0.12"/>` +
        `<path d="M136,74 l1.7,4.4 4.4,1.7 -4.4,1.7 -1.7,4.4 -1.7,-4.4 -4.4,-1.7 4.4,-1.7 z" fill="#fff"/>`
      )
    case 'gear': {
      let teeth = ''
      for (let i = 0; i < 8; i++) {
        teeth += `<rect x="96" y="66" width="8" height="14" rx="2.5" fill="#fff" transform="rotate(${45 * i} 100 102)"/>`
      }
      return (
        teeth +
        `<circle cx="100" cy="102" r="23" fill="#fff"/><circle cx="100" cy="102" r="10" fill="${deep}"/>` +
        `<path d="M100,90 l2.4,6.6 7,0.3 -5.4,4.4 1.9,6.7 -5.9,-3.8 -5.9,3.8 1.9,-6.7 -5.4,-4.4 7,-0.3 z" fill="#fff"/>`
      )
    }
    case 'valley':
      return (
        `<circle cx="100" cy="88" r="14" fill="#fff"/>` +
        `<path d="M54,130 L86,84 L106,112 L122,90 L146,130 Z" fill="#fff"/>` +
        `<path d="M86,84 l-9,13 9,5 7,-6 z" fill="${deep}" opacity="0.18"/>` +
        `<path d="M122,90 l-8,11 8,4 6,-5 z" fill="${deep}" opacity="0.18"/>` +
        `<path d="M64,130 q18,-10 36,0 t36,0" fill="none" stroke="${deep}" stroke-width="3" opacity="0.35" stroke-linecap="round"/>`
      )
    case 'comeback':
      return (
        `<path d="M100,60 l26,30 h-16 v22 h-20 v-22 h-16 z" fill="#fff"/>` +
        `<path d="M62,126 q38,26 76,0" fill="none" stroke="#fff" stroke-width="7.5" stroke-linecap="round" opacity="0.92"/>` +
        `<circle cx="62" cy="126" r="4.5" fill="#fff"/><circle cx="138" cy="126" r="4.5" fill="#fff"/>`
      )
    case 'flame':
      return (
        `<path d="M100,56 c16,22 30,30 30,50 a30,30 0 0 1 -60,0 c0,-13 8,-22 16,-31 c1,9 6,12 11,12 c-6,-14 -8,-24 3,-43 z" fill="#fff"/>` +
        `<path d="M100,98 c8,7 13,13 13,22 a13,13 0 0 1 -26,0 c0,-7 5,-13 13,-22 z" fill="${deep}" opacity="0.28"/>`
      )
    default:
      return ''
  }
}

function starPath(cx: number, cy: number, fill: string): string {
  return `<path transform="translate(${cx},${cy})" d="M0,-6 L1.8,-1.9 6.3,-1.9 2.7,1.1 4,5.7 0,3 -4,5.7 -2.7,1.1 -6.3,-1.9 -1.8,-1.9 Z" fill="${fill}"/>`
}

function buildSvg(props: BadgeProps, rawId: string): string {
  const subj = SUBJECTS[props.subject] || SUBJECTS.science
  const state: BadgeState = props.state || 'earned'
  const tier: BadgeTier = props.tier || 'bronze'
  const pct = typeof props.progress === 'number' ? Math.max(0, Math.min(1, props.progress)) : 0
  const id = rawId.replace(/[^a-zA-Z0-9]/g, '')
  const metal = METAL[tier]
  const n = STARS[tier]
  const R = 84
  const ringR = 94
  const C = 2 * Math.PI * ringR
  const showRing = !(props.mini && state === 'earned')

  let ring = ''
  if (showRing && state === 'inprogress') {
    ring =
      `<circle cx="100" cy="100" r="${ringR}" fill="none" stroke="${subj.a}" stroke-width="9" opacity="0.30"/>` +
      `<circle class="yv-badge__ring" cx="100" cy="100" r="${ringR}" fill="none" stroke="${subj.b}" stroke-width="9" ` +
      `stroke-linecap="round" transform="rotate(-90 100 100)" stroke-dasharray="${C.toFixed(1)}" ` +
      `stroke-dashoffset="${(C * (1 - pct)).toFixed(1)}"/>`
  } else if (showRing) {
    ring =
      `<circle cx="100" cy="100" r="${ringR}" fill="none" stroke="${metal}" stroke-width="6"/>` +
      `<circle cx="100" cy="100" r="${ringR}" fill="none" stroke="#fff" stroke-width="1.4" opacity="0.5" transform="scale(0.955)" transform-origin="100 100"/>`
  }

  let pill = ''
  if (!props.mini && !props.noStars && state === 'earned') {
    const pw = n * 15 + 20
    const px = 100 - pw / 2
    const py = 176
    const sx0 = 100 - ((n - 1) * 15) / 2
    let stars = ''
    for (let i = 0; i < n; i++) stars += starPath(sx0 + i * 15, py + 11, metal)
    pill = `<rect x="${px.toFixed(1)}" y="${py}" width="${pw}" height="22" rx="11" fill="#fff" stroke="rgba(20,26,56,0.10)"/>${stars}`
  }

  const vbH = props.mini || props.noStars || state !== 'earned' ? 200 : 206
  const label = props.title || 'Badge'
  return (
    `<svg viewBox="0 0 200 ${vbH}" role="img" aria-label="${label}">` +
    `<defs><radialGradient id="bg${id}" cx="42%" cy="34%" r="74%">` +
    `<stop offset="0%" stop-color="${subj.a}"/><stop offset="100%" stop-color="${subj.b}"/></radialGradient>` +
    `<clipPath id="cc${id}"><circle cx="100" cy="100" r="${R}"/></clipPath></defs>` +
    ring +
    `<g class="yv-badge__medallion"><circle cx="100" cy="100" r="${R}" fill="url(#bg${id})"/>` +
    `<g clip-path="url(#cc${id})">${motifMarkup(props.motif)}<ellipse cx="100" cy="66" rx="62" ry="34" fill="#fff" opacity="0.16"/>` +
    `<circle cx="100" cy="100" r="${R}" fill="none" stroke="#fff" stroke-width="2" opacity="0.28" transform="scale(0.93)" transform-origin="100 100"/></g>` +
    `<g class="yv-badge__glyph">${glyphMarkup(props.glyph, subj.deep, id)}</g>${pill}</g></svg>`
  )
}

export function Badge(props: BadgeProps) {
  const rawId = useId()
  const html = useMemo(() => buildSvg(props, rawId), [props, rawId])
  const state: BadgeState = props.state || 'earned'
  const classes = [
    'yv-badge',
    `yv-badge--${state}`,
    props.mini ? 'yv-badge--mini' : '',
    props.className || '',
  ].filter(Boolean).join(' ')

  return (
    <span
      className={classes}
      style={props.size ? { width: props.size } : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
