import type * as THREE from 'three'

export interface PlaygroundAction {
  id: string
  label: string
  object: THREE.Object3D
  activate(): void
}

export function trafficPhase(seconds: number): 'vehicles' | 'amber' | 'clearance' | 'pedestrians' {
  if (seconds < 0 || seconds >= 13) return 'vehicles'
  if (seconds < 3) return 'amber'
  if (seconds < 5 || seconds >= 11) return 'clearance'
  return 'pedestrians'
}

export function canActivatePlayground(input: { placing: boolean; locked: boolean; consumed: boolean; distance: number; slop: number; duration: number }) {
  return !input.placing && !input.locked && !input.consumed && input.distance <= input.slop && input.duration <= 500
}

export interface PlaygroundMotion {
  actions: PlaygroundAction[]
  updates: Array<(elapsed: number) => void>
  reduced: boolean
}

export function movingPart(motion: PlaygroundMotion, object: THREE.Object3D, id: string, axis: 'x' | 'y' | 'z', amplitude: number, ambient = false) {
  object.userData.dynamic = true
  let start = -100
  let now = 0
  let initial = 0
  const action = { id, label: `YuviStudio.playground.action.${id.split('-')[0]}`, object,
    activate: () => {
      initial = object.rotation[axis]
      start = now
      if (motion.reduced) object.rotation[axis] += amplitude * 0.15
    },
  }
  motion.actions.push(action)
  motion.updates.push((elapsed) => {
    now = elapsed
    if (motion.reduced) return
    const age = elapsed - start
    object.rotation[axis] = age < 8
      ? initial * Math.exp(-age * 2) + Math.sin(age * 2.4) * amplitude * Math.exp(-age * 0.36)
      : ambient ? Math.sin(elapsed * 1.8 + object.position.x) * amplitude * 0.14 : 0
  })
}