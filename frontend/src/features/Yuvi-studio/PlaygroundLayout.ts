export const PLAYGROUND_BOUNDS = { left: -24.4, right: 24.4, back: -25.8, front: 32.7 }
export const PLAYGROUND_GIFT_POSITION = { x: 3, z: 3, rot: 0 }

export const PLAYGROUND_ZONES = [
  { id: 'climbing', x: 0, z: -22.7, width: 44, depth: 5.6 },
  { id: 'traffic', x: 21.1, z: 20, width: 5.6, depth: 20 },
] as const

export type PlaygroundZoneId = typeof PLAYGROUND_ZONES[number]['id']
export const playgroundZone = (id: PlaygroundZoneId) => PLAYGROUND_ZONES.find((zone) => zone.id === id)!

export const PLAYGROUND_DECOR_BLOCKERS = PLAYGROUND_ZONES.flatMap((zone) => {
  const spacing = 1.8
  const columns = Math.ceil(zone.width / spacing)
  const rows = Math.ceil(zone.depth / spacing)
  return Array.from({ length: columns * rows }, (_, index) => ({
    x: zone.x - zone.width / 2 + (index % columns + 0.5) * zone.width / columns,
    z: zone.z - zone.depth / 2 + (Math.floor(index / columns) + 0.5) * zone.depth / rows,
    radius: 1.15,
  }))
})

export const PLAYGROUND_WALK_BARRIERS = [
  { minX: -22.2, maxX: 22.2, frontZ: -23.65 },
]

export const PLAYGROUND_WALK_SURFACES = [
  { x: 0, z: -22.7, width: 44, depth: 5.6, height: 0.24 },
]

export function playgroundGiftPosition(obstacles: Array<{ x: number; z: number; radius: number }>) {
  const blockers = [...PLAYGROUND_DECOR_BLOCKERS, ...obstacles]
  const candidates = [PLAYGROUND_GIFT_POSITION]
  for (let z = 1; z <= 29; z += 2) {
    for (let x = -21; x <= 21; x += 2) candidates.push({ x, z, rot: 0 })
  }
  candidates.sort((left, right) => Math.hypot(left.x - 3, left.z - 3) - Math.hypot(right.x - 3, right.z - 3))
  const clearance = (point: { x: number; z: number }) => Math.min(...blockers.map((blocker) => Math.hypot(point.x - blocker.x, point.z - blocker.z) - blocker.radius))
  return candidates.find((point) => clearance(point) >= 1.2)
    ?? candidates.reduce((best, point) => clearance(point) > clearance(best) ? point : best)
}