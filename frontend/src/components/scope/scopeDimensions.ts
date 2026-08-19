/* Which parts of a teacher's scope a screen actually honours.
 *
 * The scope bar offers class, sub-group and subject portal-wide. Not every
 * screen means all three — a student's profile is about one child, so a
 * sub-group filter there is nonsense, and the task review screen reads one task
 * the whole class already has.
 *
 * A dimension a screen cannot honour is HIDDEN rather than disabled: a control
 * that is visible and does nothing is the failure this file exists to prevent.
 * `/groups/{id}/snapshot` used to declare a `subject` query parameter and drop
 * it on the floor — the two most-used screens sent a filter nowhere, and it
 * survived review because it was invisible while the subject was always null.
 *
 * **The standing rule this encodes:** no `subject` or `subgroup` may be passed
 * to a service call whose endpoint has no such parameter, and no dimension may
 * be offered for a route that does not narrow by it. If you add a route, add it
 * here and to `tests/scope-dimensions.test.ts` in the same change.
 *
 * JSX-free on purpose so `node --test` can import it directly, the same reason
 * `actionKey.ts` is its own module.
 */

export interface ScopeDimensions {
  /** The class picker. Off only where the screen is not about a class at all. */
  class: boolean
  /** The sub-group picker. */
  subgroup: boolean
  /** The subject picker. */
  subject: boolean
}

/* Nothing. The admin console and every non-teacher route. */
const NONE: ScopeDimensions = { class: false, subgroup: false, subject: false }

/* One class, and no way to slice it. */
const CLASS_ONLY: ScopeDimensions = { class: true, subgroup: false, subject: false }

const CLASS_AND_SUBGROUP: ScopeDimensions = { class: true, subgroup: true, subject: false }

/* Ordered exactly like `pageForRoute` in `app/App.tsx`, and for the same
   reason: `/teacher/student/` must be tested before `/teacher/students`, and
   both before the bare `/teacher`, or every route resolves to Home's answer. */
const ROUTES: [prefix: string, dimensions: ScopeDimensions][] = [
  /* One child. The class and the sub-group they belong to are facts about
     them, not filters on them — but every panel on this page reads a subject,
     so that one dimension is the whole scope here. */
  ['/teacher/student/', { class: false, subgroup: false, subject: true }],

  ['/teacher/students', CLASS_AND_SUBGROUP],
  ['/teacher/goals', CLASS_AND_SUBGROUP],
  ['/teacher/calendar', CLASS_AND_SUBGROUP],

  /* Learnings: the listing narrows by subject exactly, and by sub-group only
     approximately — the analytics fold is class-wide, so the screen says so in
     a line rather than pretending. The drill-down takes its class from the URL
     so a link survives a reload, and reads one lesson, so no subject.

     `subject: false` on the listing is TEMPORARY: the screen still owns its own
     subject chips, and two controls for one filter is worse than one control in
     the wrong place. Flips to `true` in the commit that deletes those chips. */
  ['/teacher/learnings/', { class: true, subgroup: true, subject: false }],
  ['/teacher/learnings', { class: true, subgroup: true, subject: false }],

  ['/teacher/messages', CLASS_AND_SUBGROUP],

  /* Tasks. `/review` is handled above — the class is context there and there is
     no cohort to narrow. Tracking is one task's cohort, so sub-group but never
     subject: the task already has a subject.

     The list narrows by subject too; `false` here is TEMPORARY for the same
     reason as learnings, and flips when its own `'all'` chip row is deleted. */
  ['/teacher/tasks/', { class: true, subgroup: true, subject: false }],
  ['/teacher/tasks', { class: true, subgroup: true, subject: false }],

  ['/teacher', CLASS_AND_SUBGROUP],

  /* The control plane borrows the teacher chrome, but it is about who is
     connected to whom across every group. Nothing to narrow. */
  ['/admin', NONE],
]

/** The tail of `/teacher/tasks/...`, or null when this is the task list. */
function taskTail(pathname: string): string | null {
  if (!pathname.startsWith('/teacher/tasks/')) return null
  const rest = pathname.slice('/teacher/tasks/'.length)
  return rest ? (rest.split('/')[1] ?? '') : null
}

/**
 * What the scope bar may offer on `pathname`.
 *
 * Takes the path only. Scope travels in path segments and is adopted into the
 * provider; the query string stays transient screen state, so a query parameter
 * can never change which controls appear.
 */
export function dimensionsFor(pathname: string): ScopeDimensions {
  const path = (pathname || '').split(/[?#]/)[0].replace(/\/+$/, '') || '/'

  /* One task, before anyone has it. The class is the context the task was
     written for; there is no cohort on this screen to filter. */
  if (taskTail(path) === 'review') return CLASS_ONLY

  /* Prefix match only, never a trailing-slash-tolerant one: `/teacher/student`
     with no id renders Home in `pageForRoute`, so it must answer like Home and
     not like a profile. Each `…/` prefix has its bare sibling listed after it
     wherever both are real routes. */
  for (const [prefix, dimensions] of ROUTES) {
    if (path === prefix || path.startsWith(prefix)) return dimensions
  }

  /* Not a teacher route at all — the bar is not mounted, and asking is
     harmless.

     Note that nothing under `/teacher` reaches here: the bare `/teacher` entry
     catches it, exactly as `pageForRoute` falls through to Home. That is the
     honest answer — an unlisted `/teacher/x` RENDERS Home, so it should offer
     Home's controls — but it means this file cannot be its own guard against a
     forgotten route. `tests/scope-dimensions.test.ts` is: it reads the prefixes
     out of `App.tsx` and fails when one has no row here. */
  return NONE
}
