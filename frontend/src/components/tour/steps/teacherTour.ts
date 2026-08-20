/* The teacher tour, as data.
 *
 * Steps are keyed by `data-tour` attributes rather than component refs, so
 * adding a step costs one attribute on the target and one entry here — no
 * component has to know it is part of a tour, and a target that never mounts is
 * skipped rather than fatal.
 *
 * Deliberately no JSX in this file: the parity test imports it directly under
 * `node --test`, which cannot parse JSX.
 *
 * The order is the order a teacher actually works: what needs you now, then the
 * class, then the depth, then the tools, then one student. It ends on the
 * evidence drawer because "every number opens to its datum" is the product's
 * whole claim (A11 #5), and a tour should finish on the thing you want
 * remembered.
 */

export type Placement = 'top' | 'bottom' | 'start' | 'end' | 'center'

export interface TourStep {
  id: string
  /** `data-tour` value of the element to spotlight; `null` centres the card. */
  target: string | null
  /** Route to be on for this step. Omitted means "wherever we already are". */
  route?: string
  titleKey: string
  bodyKey: string
  placement: Placement
  /** Extra px of breathing room around the cutout. */
  padding?: number
  /** Let clicks through to the target (for steps that ask you to try it). */
  interactive?: boolean
}

/** Routes containing this token are resolved against the tour's params. */
export const STUDENT_TOKEN = ':studentId'

export const TEACHER_TOUR_ID = 'teacher'

/**
 * Who this tour is for.
 *
 * Must match the `/teacher` route guard in App.tsx, which tests `isTeacher`
 * alone: an admin-only account reaching `/teacher` gets an error page, so
 * offering it a tour of that app — or auto-opening one over the error — walks
 * someone through screens they cannot open. Admins who also teach hold both
 * roles and are unaffected.
 */
export function canTakeTeacherTour(roles: string[] | undefined): boolean {
  return Boolean(roles?.includes('teacher'))
}

export const teacherTourSteps: TourStep[] = [
  {
    id: 'welcome',
    target: null,
    route: '/teacher',
    titleKey: 'tour.teacher.welcome.title',
    bodyKey: 'tour.teacher.welcome.body',
    placement: 'center',
  },
  {
    id: 'live',
    target: 'teacher.liveNow',
    // The live strip moved to the roster a round ago and this step kept
    // pointing at /teacher, so it silently did nothing: an unresolved target is
    // skipped without an error. It now points at the roster's live KPI, which
    // is where "who is in a lesson right now" actually lives.
    route: '/teacher/students',
    titleKey: 'tour.teacher.live.title',
    bodyKey: 'tour.teacher.live.body',
    placement: 'bottom',
  },
  {
    id: 'attention',
    target: 'teacher.attentionInbox',
    route: '/teacher',
    titleKey: 'tour.teacher.attention.title',
    bodyKey: 'tour.teacher.attention.body',
    placement: 'bottom',
  },
  {
    id: 'pulse',
    target: 'teacher.pulse',
    route: '/teacher',
    titleKey: 'tour.teacher.pulse.title',
    bodyKey: 'tour.teacher.pulse.body',
    placement: 'bottom',
  },
  {
    id: 'gaps',
    target: 'teacher.gaps',
    route: '/teacher',
    titleKey: 'tour.teacher.gaps.title',
    bodyKey: 'tour.teacher.gaps.body',
    placement: 'top',
  },
  {
    id: 'scope',
    target: 'teacher.scope',
    titleKey: 'tour.teacher.scope.title',
    bodyKey: 'tour.teacher.scope.body',
    placement: 'bottom',
    padding: 6,
  },
  {
    id: 'bell',
    target: 'notifications.bell',
    titleKey: 'tour.teacher.bell.title',
    bodyKey: 'tour.teacher.bell.body',
    placement: 'bottom',
    padding: 6,
  },
  {
    id: 'assistant',
    target: 'teacher.assistant',
    titleKey: 'tour.teacher.assistant.title',
    bodyKey: 'tour.teacher.assistant.body',
    placement: 'top',
  },
  {
    id: 'roster',
    target: 'teacher.rosterFilters',
    // The students screen lands on the LIVE view now (#249); the filters this
    // step points at exist only in manage mode, which the query opens.
    route: '/teacher/students?view=table',
    titleKey: 'tour.teacher.roster.title',
    bodyKey: 'tour.teacher.roster.body',
    placement: 'bottom',
  },
  {
    id: 'profile',
    target: 'teacher.studentHero',
    route: `/teacher/student/${STUDENT_TOKEN}`,
    titleKey: 'tour.teacher.profile.title',
    bodyKey: 'tour.teacher.profile.body',
    placement: 'bottom',
  },
  {
    id: 'goals',
    target: 'teacher.subjectProgress',
    route: `/teacher/student/${STUDENT_TOKEN}`,
    titleKey: 'tour.teacher.goals.title',
    bodyKey: 'tour.teacher.goals.body',
    placement: 'top',
  },
  {
    id: 'evidence',
    target: 'teacher.recommendations',
    route: `/teacher/student/${STUDENT_TOKEN}`,
    titleKey: 'tour.teacher.evidence.title',
    bodyKey: 'tour.teacher.evidence.body',
    placement: 'top',
  },
]

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
export function physicalSide(placement: Placement, isRtl: boolean): 'top' | 'bottom' | 'left' | 'right' | 'center' {
  if (placement === 'start') return isRtl ? 'right' : 'left'
  if (placement === 'end') return isRtl ? 'left' : 'right'
  return placement
}

/** Every locale key the tour needs — the parity test asserts on exactly this. */
export function tourLocaleKeys(steps: TourStep[] = teacherTourSteps): string[] {
  return steps.flatMap((step) => [step.titleKey, step.bodyKey])
}
