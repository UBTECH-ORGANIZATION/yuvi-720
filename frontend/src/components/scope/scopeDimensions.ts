/* Which parts of a teacher's scope a screen actually narrows by.
 *
 * The scope bar always shows class and subject, on every teacher screen. It
 * used to hide the segments a screen could not honour, and that was worse than
 * the problem it solved: a control that vanishes is indistinguishable from a
 * control that is broken, and the student profile — which hides class and
 * sub-group — disappeared entirely the moment its subject list failed to load.
 *
 * So nothing is hidden, and nothing is silently ignored either. This table says
 * which dimensions a screen's data actually narrows by, and it drives two
 * things: what the screen filters, and — when a dimension is SET and this
 * screen does not narrow by it — the one line the screen prints to say so.
 * That line is the whole point. `/groups/{id}/snapshot` used to declare a
 * `subject` query parameter and drop it on the floor, so Home and the roster
 * sent a filter nowhere; showing "maths" over class-wide figures without
 * saying so would be that same lie with a control attached to it.
 *
 * **The standing rule this encodes:** no `subject` or `subgroup` may be passed
 * to a service call whose endpoint has no such parameter, and any dimension a
 * teacher has set that a screen does not narrow by must be SAID, never merely
 * dropped. If you add a route, add it here and to
 * `tests/scope-dimensions.test.ts` in the same change.
 *
 * JSX-free on purpose so `node --test` can import it directly, the same reason
 * `actionKey.ts` is its own module.
 */

export interface ScopeDimensions {
  /** This screen's data is about the selected class. */
  class: boolean
  /** It narrows to the selected sub-group's members. */
  subgroup: boolean
  /** It narrows to the selected subject. */
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
     them, not filters on them, so the page narrows by neither — the bar still
     shows the class, and picking a different one takes the teacher to that
     class's roster, because the child they were reading is not in it. Every
     panel here reads a subject. */
  ['/teacher/student/', { class: false, subgroup: false, subject: true }],

  ['/teacher/students', CLASS_AND_SUBGROUP],
  ['/teacher/goals', CLASS_AND_SUBGROUP],
  ['/teacher/calendar', CLASS_AND_SUBGROUP],

  /* Learnings. The listing narrows by subject exactly; its own chip row is not
     a second control any more — the chips read and write the same scope, so
     arriving with maths already set lights the maths chip. It narrows by
     NOT by sub-group — the analytics fold behind it is class-wide — so a
     teacher who has narrowed to six children is told so rather than shown
     class numbers under a sub-group's name. The drill-down reads one
     lesson, so no subject, and takes its class from the URL so a link survives
     a reload. */
  ['/teacher/learnings/', { class: true, subgroup: false, subject: false }],
  ['/teacher/learnings', { class: true, subgroup: false, subject: true }],

  ['/teacher/messages', CLASS_AND_SUBGROUP],

  /* Tasks. `/review` is handled above — the class is context there and there is
     no cohort to narrow. Tracking is one task's cohort, so sub-group but never
     subject: the task already has one. The list narrows by subject through the
     same chips-bound-to-scope arrangement as learnings — but NOT by sub-group:
     a class-wide task still belongs to the sub-group's children, so a filter
     would either hide their work or hide nothing. The notice says so. */
  ['/teacher/tasks/', { class: true, subgroup: true, subject: false }],
  ['/teacher/tasks', { class: true, subgroup: false, subject: true }],

  /* Home narrows by sub-group since #450: the students band card — the page's
     centrepiece — filters to the picked sub-group client-side, and says so in
     its own subtitle while the KPIs, the live card and the gaps stay
     class-wide (they are class aggregates; recomputing them for six children
     would make the same number mean two things on one screen). The previous
     rationale rejected a partial narrowing when the only narrowable block was
     the attention inbox; a card of every student is a different trade — hiding
     the filter from the screen teachers triage on cost more than the split
     scope does, and the notice keeps the split honest (never silently
     ignore). */
  ['/teacher', { class: true, subgroup: true, subject: false }],

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
 * What `pathname` narrows by.
 *
 * Takes the path only. Scope travels in path segments and is adopted into the
 * provider; the query string stays transient screen state, so a query parameter
 * can never change what a screen claims to filter.
 */
export function narrowsBy(pathname: string): ScopeDimensions {
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
