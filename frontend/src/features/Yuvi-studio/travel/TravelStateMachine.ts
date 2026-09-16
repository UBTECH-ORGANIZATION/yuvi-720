export type TravelPhase =
  | 'idle'
  | 'portalOpening'
  | 'yobiEntering'
  | 'worldSwap'
  | 'yobiExiting'
  | 'landing'
  | 'portalClosing'
  | 'portalCooldown'

const ALLOWED: Record<TravelPhase, TravelPhase[]> = {
  idle: ['portalOpening'],
  portalOpening: ['yobiEntering', 'portalCooldown', 'idle'],
  yobiEntering: ['worldSwap', 'idle'],
  worldSwap: ['yobiExiting', 'idle'],
  yobiExiting: ['landing', 'idle'],
  landing: ['portalClosing', 'idle'],
  portalClosing: ['idle'],
  portalCooldown: ['idle'],
}

/** Guards the cinematic lifecycle so a second room selection cannot overlap it. */
export class TravelStateMachine {
  phase: TravelPhase = 'idle'

  move(next: TravelPhase) {
    if (!ALLOWED[this.phase].includes(next)) return false
    this.phase = next
    return true
  }

  reset() { this.phase = 'idle' }
}