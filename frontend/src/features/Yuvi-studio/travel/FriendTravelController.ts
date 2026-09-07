import gsap from 'gsap'
import { TravelStateMachine, type TravelPhase } from './TravelStateMachine'

export interface TravelTimelineHandlers {
  onPhase: (phase: TravelPhase) => void
  onWorldSwap: () => void
  onComplete: () => void
  onFailure?: () => void
}

/** One interruptible capsule-teleport timeline for either direction of a room trip. */
export class FriendTravelController {
  private readonly machine = new TravelStateMachine()
  private timeline: gsap.core.Timeline | null = null

  get busy() { return this.machine.phase !== 'idle' }

  /** Backwards-compatible entry point for callers that still describe this as a visit. */
  play(handlers: TravelTimelineHandlers, destinationReady?: Promise<unknown>) {
    return this.startTeleport(handlers, destinationReady)
  }

  startTeleport(handlers: TravelTimelineHandlers, destinationReady?: Promise<unknown>) {
    if (this.busy) return false
    let destinationLoaded = !destinationReady
    const move = (phase: TravelPhase) => {
      if (this.machine.move(phase)) handlers.onPhase(phase)
    }
    const clock = { value: 0 }
    this.timeline = gsap.timeline({
      paused: true,
      onComplete: () => {
        this.machine.reset()
        this.timeline = null
        handlers.onPhase('idle')
        handlers.onComplete()
      },
    })
    if (destinationReady) {
      void destinationReady.then(() => {
        destinationLoaded = true
        if (this.timeline?.paused()) this.timeline.play()
      }, () => this.cooldown(handlers))
    }
    move('portalOpening')
    this.timeline.to(clock, { value: 1, duration: 0.38, ease: 'power2.out' })
    this.playPhaseShift(move, clock)
    this.shrinkIntoPortal(move, handlers, () => destinationLoaded, clock)
    this.materializeFromPortal(move, clock)
    this.finishTeleport(move, clock)
    this.timeline.play()
    return true
  }

  /** Brief independent-body phase shift before Yuvi collapses into the capsule. */
  playPhaseShift(move: (phase: TravelPhase) => void, clock: { value: number }) {
    this.timeline
      ?.call(() => move('yobiEntering'))
      .to(clock, { value: 2, duration: 0.82, ease: 'power2.inOut' })
  }

  /** Hide Yuvi at the capsule centre, waiting for the destination room when necessary. */
  shrinkIntoPortal(move: (phase: TravelPhase) => void, handlers: TravelTimelineHandlers, destinationLoaded: () => boolean, clock: { value: number }) {
    this.timeline
      ?.to(clock, { value: 2.2, duration: 0.28, ease: 'power3.in' })
      .call(() => {
        if (!destinationLoaded()) this.timeline?.pause()
      })
      .call(() => move('worldSwap'))
      .call(handlers.onWorldSwap)
  }

  /** Reassemble Yuvi from the destination capsule. */
  materializeFromPortal(move: (phase: TravelPhase) => void, clock: { value: number }) {
    this.timeline
      ?.to(clock, { value: 2.3, duration: 0.06, ease: 'none' })
      .call(() => move('yobiExiting'))
      .to(clock, { value: 3, duration: 0.7, ease: 'power3.out' })
      .call(() => move('landing'))
      .to(clock, { value: 4, duration: 0.26, ease: 'back.out(1.3)' })
  }

  /** Collapse the destination portal after the landing settles. */
  finishTeleport(move: (phase: TravelPhase) => void, clock: { value: number }) {
    this.timeline
      ?.call(() => move('portalClosing'))
      .to(clock, { value: 5, duration: 0.42, ease: 'power2.in' })
  }

  private cooldown(handlers: TravelTimelineHandlers) {
    if (!this.timeline || this.machine.phase === 'portalCooldown') return
    this.timeline.kill()
    this.timeline = gsap.timeline({
      onComplete: () => {
        this.machine.reset()
        this.timeline = null
        handlers.onPhase('idle')
        handlers.onFailure?.()
      },
    })
    if (this.machine.move('portalCooldown')) handlers.onPhase('portalCooldown')
    this.timeline.to({}, { duration: 0.42, ease: 'power2.out' })
  }

  cancel(handlers?: Pick<TravelTimelineHandlers, 'onPhase'>) {
    this.timeline?.kill()
    this.timeline = null
    this.machine.reset()
    handlers?.onPhase('idle')
  }

  dispose() {
    this.cancel()
  }
}