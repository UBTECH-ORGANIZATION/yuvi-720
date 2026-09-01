/* What a tour is, independent of who it is for.
 *
 * Split out of `teacherTour.ts` when the learner tour arrived: both step lists
 * need these shapes, and a learner module importing from a teacher module would
 * be a lie about the dependency.
 *
 * Deliberately no JSX in this file: the parity test imports it directly under
 * `node --test`, which cannot parse JSX.
 */

export type Placement = 'top' | 'bottom' | 'start' | 'end' | 'center'

export interface TourStep {
  id: string
  /** `data-tour` value of the element to spotlight; `null` centres the card. */
  target: string | null
  /** Route to be on for this step. Omitted means "wherever we already are". */
  route?: string
  /** This step is finished by the learner NAVIGATING here themselves. Until
      they do, the step's own `route` is not enforced — otherwise the click the
      step asked for would be undone the instant they made it. */
  awaitRoute?: string
  titleKey: string
  bodyKey: string
  placement: Placement
  /** Extra px of breathing room around the cutout. */
  padding?: number
  /** Let clicks through to the target (for steps that ask you to try it). */
  interactive?: boolean
  /** The flying guide stands down here and the real dock Yuvi takes over, so
      the two are never on screen at once (nor two WebGL contexts). */
  landing?: boolean
}

/**
 * How the tour presents itself.
 *
 * `card` is the original: a panel with Yuvi's head in its corner. `flying` adds
 * the travelling guide — Yuvi himself hovers beside each spotlight and arcs to
 * the next one. Opt-in per tour rather than global, so turning it on for one
 * audience cannot silently change the other's screens (or its browser checks).
 */
export type TourGuideStyle = 'card' | 'flying'

export interface TourDefinition {
  id: string
  steps: TourStep[]
  guide: TourGuideStyle
  /** Can it be walked out of? A teacher is at work and may need the screen
      back. A child's first run cannot be dismissed — no skip, no close, and the
      scrim ignores clicks — because seeing the product once is the point. */
  dismissible: boolean
}

/** Routes containing this token are resolved against the tour's params. */
export const STUDENT_TOKEN = ':studentId'

/** Does this tour need a subject learner resolved before it can run? */
export function needsStudentParam(steps: TourStep[]): boolean {
  return steps.some((step) => step.route?.includes(STUDENT_TOKEN))
}

/**
 * Resolve a step's route against the tour params.
 *
 * Returns `null` when the step needs a student and none was resolved — the
 * provider treats that exactly like a missing DOM target and skips the step,
 * so a teacher with an empty roster still gets a complete, coherent tour.
 */
export function routeForStep(
  step: TourStep,
  params: { studentId?: string | null },
): string | null | undefined {
  if (!step.route) return undefined
  if (!step.route.includes(STUDENT_TOKEN)) return step.route
  if (!params.studentId) return null
  return step.route.replace(STUDENT_TOKEN, encodeURIComponent(params.studentId))
}

/**
 * Which side the card sits on, mirrored for right-to-left.
 *
 * `top`/`bottom` are unaffected — vertical placement has no direction — but
 * `start`/`end` are logical, so they resolve to opposite physical sides in he/ar
 * and in en. Doing this here rather than in CSS keeps it unit-testable.
 */
export function physicalSide(
  placement: Placement, isRtl: boolean,
): 'top' | 'bottom' | 'left' | 'right' | 'center' {
  if (placement === 'start') return isRtl ? 'right' : 'left'
  if (placement === 'end') return isRtl ? 'left' : 'right'
  return placement
}

/** Every locale key a tour needs — the parity test asserts on exactly this. */
export function tourLocaleKeys(steps: TourStep[]): string[] {
  return steps.flatMap((step) => [step.titleKey, step.bodyKey])
}
