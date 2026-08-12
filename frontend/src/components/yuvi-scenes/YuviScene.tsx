/* Yuvi, drawn for the mood of the week.
 *
 * Five hand-authored base scenes × four hand-authored subject props, composed
 * through a per-pose anchor. Nine assets, twenty designed combinations — a flat
 * catalogue of twenty full scenes is the kind of number that gets half-built
 * and then looks it, and a shared drop-point for the prop would put the beaker
 * in Yuvi's chest in three of the five poses.
 *
 * The palette is `YuviHeadIcon`'s, which is the canonical robot: body #b9d8f1,
 * eyes #74f7ff over a #090b17 visor, accents #7c6cff / #a98cff, antenna bulb
 * #4cc9f0. Expression lives in two eye paths and one mouth path, so a mood is
 * a real change of face rather than a swapped emoji.
 *
 * viewBox is 400×320 for every scene. The prop anchor is declared per pose, in
 * that space, so props are drawn once at the origin and placed by transform.
 *
 * Motion is CSS (see yuvi-scene.css) and stops dead under
 * `prefers-reduced-motion` — the composition is designed to read as a still.
 */

import type { ReactElement } from 'react'

import { DEFAULT_SCENE, isSceneKey, type PropKey, type SceneKey } from './scenes'
import './yuvi-scene.css'

interface Props {
  /** The mood. Anything unrecognised falls back to a designed default. */
  scene: string | null | undefined
  /** Which prop Yuvi holds. Chosen by code from what the class worked on. */
  prop?: PropKey
  /** Announced to screen readers; the caller has the language. */
  label: string
  className?: string
}

/* ── the robot ────────────────────────────────────────────────────────────────
   One body, five faces. Drawn at the origin of a 400×320 stage and positioned
   by each pose, so the geometry is written once. */

function Body({ tilt = 0 }: { tilt?: number }) {
  return (
    <g transform={`rotate(${tilt} 200 170)`}>
      {/* antenna */}
      <path d="M200 96V74" stroke="#7c6cff" strokeWidth="7" strokeLinecap="round" />
      <circle cx="200" cy="68" r="8" fill="#4cc9f0" className="yv-scene__bulb" />
      {/* ears */}
      <rect x="112" y="140" width="18" height="42" rx="9" fill="#8dbde8" />
      <rect x="270" y="140" width="18" height="42" rx="9" fill="#8dbde8" />
      <circle cx="121" cy="161" r="5" fill="#4cc9f0" />
      <circle cx="279" cy="161" r="5" fill="#4cc9f0" />
      {/* head */}
      <rect x="122" y="96" width="156" height="152" rx="52" fill="#b9d8f1" />
      {/* gloss */}
      <path d="M144 122c28-24 84-28 116 4" stroke="#fff" strokeWidth="9"
            strokeLinecap="round" opacity=".62" />
      {/* visor */}
      <rect x="146" y="128" width="108" height="88" rx="34" fill="#090b17" />
    </g>
  )
}

/** Eyes and mouth. The whole difference between one mood and another. */
const FACES: Record<SceneKey, ReactElement> = {
  celebrating: (
    <>
      <path d="M164 166c6-13 21-13 27 0" stroke="#74f7ff" strokeWidth="9" strokeLinecap="round" />
      <path d="M212 166c6-13 21-13 27 0" stroke="#74f7ff" strokeWidth="9" strokeLinecap="round" />
      <path d="M172 186c16 18 40 18 56 0" stroke="#a98cff" strokeWidth="9" strokeLinecap="round" />
    </>
  ),
  cheering_on: (
    <>
      <circle cx="177" cy="166" r="9" fill="#74f7ff" />
      <circle cx="225" cy="166" r="9" fill="#74f7ff" />
      <path d="M176 190c14 12 34 12 48 0" stroke="#a98cff" strokeWidth="9" strokeLinecap="round" />
    </>
  ),
  pointing: (
    <>
      <circle cx="177" cy="164" r="9" fill="#74f7ff" />
      <circle cx="225" cy="164" r="9" fill="#74f7ff" />
      {/* one raised brow: attention, not alarm */}
      <path d="M212 146c8-6 18-6 26 0" stroke="#74f7ff" strokeWidth="6" strokeLinecap="round" opacity=".85" />
      <path d="M178 190h44" stroke="#a98cff" strokeWidth="9" strokeLinecap="round" />
    </>
  ),
  waiting: (
    <>
      {/* half-lidded: quiet, never sad — a quiet week is not bad news */}
      <path d="M166 170h24" stroke="#74f7ff" strokeWidth="9" strokeLinecap="round" />
      <path d="M212 170h24" stroke="#74f7ff" strokeWidth="9" strokeLinecap="round" />
      <path d="M180 192c12 7 28 7 40 0" stroke="#a98cff" strokeWidth="8" strokeLinecap="round" opacity=".9" />
    </>
  ),
  thinking: (
    <>
      <circle cx="175" cy="166" r="8" fill="#74f7ff" />
      <circle cx="223" cy="163" r="10" fill="#74f7ff" />
      <path d="M180 192c10 5 24 4 34-3" stroke="#a98cff" strokeWidth="8" strokeLinecap="round" />
    </>
  ),
}

/* ── the props ────────────────────────────────────────────────────────────────
   Drawn at the origin, small, and placed by each pose's anchor. */

const PROPS: Record<PropKey, ReactElement> = {
  math: (
    <g>
      <rect x="-26" y="-26" width="52" height="52" rx="12" fill="#7c6cff" />
      <path d="M-12 -6h24M0 -18v24" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
      <path d="M-12 14h24" stroke="#fff" strokeWidth="6" strokeLinecap="round" opacity=".7" />
    </g>
  ),
  science: (
    <g>
      <path d="M-9 -26h18v16l16 30a10 10 0 0 1-9 15h-32a10 10 0 0 1-9-15l16-30z" fill="#4cc9f0" />
      <path d="M-14 12h28" stroke="#0d2a3d" strokeWidth="5" strokeLinecap="round" opacity=".5" />
      <circle cx="-4" cy="20" r="4" fill="#fff" opacity=".8" />
      <circle cx="8" cy="16" r="3" fill="#fff" opacity=".6" />
    </g>
  ),
  english: (
    <g>
      <rect x="-28" y="-22" width="56" height="44" rx="7" fill="#a98cff" />
      <path d="M0 -22v44" stroke="#fff" strokeWidth="4" opacity=".55" />
      <path d="M-20 -10h13M-20 0h13M7 -10h13M7 0h13" stroke="#fff" strokeWidth="4"
            strokeLinecap="round" opacity=".85" />
    </g>
  ),
  generic: (
    <g>
      <circle cx="0" cy="0" r="24" fill="#7c6cff" />
      <path d="M-9 2l7 8 13-16" stroke="#fff" strokeWidth="7"
            strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ),
}

/* ── the poses ────────────────────────────────────────────────────────────────
   Arms, extras, and the hand-placed prop anchor for each mood. The anchor is
   what keeps this a designed composition rather than an assembled one. */

interface Pose {
  tilt: number
  /** Where the prop sits, in stage coordinates, with its own rotation. */
  anchor: { x: number; y: number; rotate: number; scale: number }
  arms: ReactElement
  extras?: ReactElement
}

const ARM = { stroke: '#8dbde8', strokeWidth: 17, strokeLinecap: 'round' as const, fill: 'none' }

const POSES: Record<SceneKey, Pose> = {
  celebrating: {
    tilt: -3,
    anchor: { x: 306, y: 128, rotate: 14, scale: 1 },
    arms: (
      <>
        <path d="M124 216c-22-6-38-26-40-52" {...ARM} />
        <path d="M276 216c22-10 40-34 42-62" {...ARM} />
      </>
    ),
    extras: (
      <g className="yv-scene__sparks">
        <path d="M92 96l5 14 14 5-14 5-5 14-5-14-14-5 14-5z" fill="#4cc9f0" opacity=".9" />
        <path d="M330 196l4 11 11 4-11 4-4 11-4-11-11-4 11-4z" fill="#a98cff" opacity=".8" />
      </g>
    ),
  },
  cheering_on: {
    tilt: 2,
    anchor: { x: 300, y: 156, rotate: 8, scale: .92 },
    arms: (
      <>
        <path d="M124 218c-20 4-34 18-38 38" {...ARM} />
        <path d="M276 214c20-6 38-24 42-46" {...ARM} />
      </>
    ),
  },
  pointing: {
    tilt: 0,
    anchor: { x: 314, y: 186, rotate: -6, scale: .95 },
    arms: (
      <>
        <path d="M124 220c-18 6-30 20-34 40" {...ARM} />
        <path d="M276 218c18 0 34-8 46-24" {...ARM} />
      </>
    ),
    extras: (
      <g className="yv-scene__point">
        <path d="M330 176h34" stroke="#a98cff" strokeWidth="9" strokeLinecap="round" />
        <path d="M352 164l14 12-14 12" stroke="#a98cff" strokeWidth="9"
              strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </g>
    ),
  },
  waiting: {
    tilt: 4,
    anchor: { x: 292, y: 236, rotate: -14, scale: .88 },
    arms: (
      <>
        <path d="M126 222c-14 12-20 30-18 48" {...ARM} />
        <path d="M274 222c14 12 20 30 18 48" {...ARM} />
      </>
    ),
    extras: (
      <g className="yv-scene__zzz" opacity=".75">
        <path d="M300 96h26l-26 26h26" stroke="#a98cff" strokeWidth="6"
              strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M340 62h18l-18 18h18" stroke="#4cc9f0" strokeWidth="5"
              strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </g>
    ),
  },
  thinking: {
    tilt: -5,
    anchor: { x: 300, y: 210, rotate: 10, scale: .9 },
    arms: (
      <>
        <path d="M126 222c-16 10-24 26-24 46" {...ARM} />
        {/* hand to the chin — the pose the mood is named for */}
        <path d="M274 220c14 4 22 0 26-14" {...ARM} />
      </>
    ),
    extras: (
      <g className="yv-scene__thoughts">
        <circle cx="306" cy="112" r="7" fill="#a98cff" opacity=".55" />
        <circle cx="326" cy="92" r="10" fill="#a98cff" opacity=".45" />
        <circle cx="352" cy="66" r="14" fill="#4cc9f0" opacity=".35" />
      </g>
    ),
  },
}

export function YuviScene({ scene, prop = 'generic', label, className }: Props) {
  const key: SceneKey = isSceneKey(scene) ? scene : DEFAULT_SCENE
  const pose = POSES[key]
  const { x, y, rotate, scale } = pose.anchor

  return (
    <svg
      viewBox="0 0 400 320"
      className={`yv-scene yv-scene--${key}${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={label}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* A soft ground so the robot sits in a scene rather than floating. */}
      <ellipse cx="200" cy="288" rx="118" ry="17" fill="#7c6cff" opacity=".16" />
      {pose.extras}
      <g className="yv-scene__figure">
        {pose.arms}
        <Body tilt={pose.tilt} />
        <g transform={`rotate(${pose.tilt} 200 170)`}>{FACES[key]}</g>
        {/* Placed by the pose's own anchor — not a shared drop-point. */}
        <g transform={`translate(${x} ${y}) rotate(${rotate}) scale(${scale})`}>
          {PROPS[prop]}
        </g>
      </g>
    </svg>
  )
}
