/* Starting a task somewhere other than the tasks screen.
 *
 * A gap in the class panel — "1 of 2 who tried it are stuck on mass and
 * volume" — is a finding with an obvious next move, and the move is a task
 * about that objective for exactly those children. The builder lives on
 * another screen, so something has to carry the intent across the navigation:
 * what the task is about, and who it turned out to be for.
 *
 * ## Why sessionStorage, when the project rule says no
 *
 * The rule is about *learner state*: a child's progress and preferences belong
 * to the brain, on the server, because they follow the child to another device.
 * None of that applies here. This is one teacher's click, in one tab, consumed
 * by the very next screen and then gone — the same reasoning that lets the
 * builder keep its unsent draft locally, with a shorter life still. Sending it
 * to the server would mean a row per abandoned intention.
 *
 * `sessionStorage` rather than `localStorage` deliberately: a seed that
 * outlived the tab would reopen the builder days later with a gap the class has
 * since closed.
 *
 * ## Two halves, because they are consumed at different moments
 *
 * The **seed** is read once, by the builder, the moment it opens. The
 * **audience** is read much later, by the launch dialog on the review screen —
 * after generation, which takes minutes — so it is keyed by task id and left in
 * place until the task is actually sent. Reading it is not destructive: a
 * teacher who opens the send dialog, closes it and opens it again must find the
 * same children ticked.
 */

const SEED_KEY = 'yuvi.teacher.taskSeed'
const AUDIENCE_PREFIX = 'yuvi.teacher.taskAudience'
const ORIGIN_PREFIX = 'yuvi.teacher.taskOrigin'

export interface TaskSeed {
  /** What the task is provisionally called. The teacher edits it. */
  title: string
  /** The subject matter, in words — the objective this came from. */
  topic: string
  /** The Kata objective, so the builder can find the lesson and the subject. */
  objectiveId?: string | null
  /** Who the finding was about. A suggestion for the send dialog, never a send. */
  learnerIds: string[]
  /* The review screen's "back to settings" carries the WHOLE spec, so changing
     one detail of a generated task is not typing the form again (#486). All
     optional: a gap-row seed still sends only title/topic/audience. */
  difficulty?: 'easy' | 'medium' | 'hard'
  notes?: string
  components?: string[]
  counts?: { presentation?: number; practice?: number; test?: number }
  /* Where cancelling this builder lands. A builder opened from a profile goes
     BACK to that profile; one reopened by "back to settings" goes back to the
     task it was reopened from — the teacher has a finished task on the other
     side of that button, and a cancel that hid it behind the profile read as
     the task having vanished (#486, QA rounds 2 and 3). */
  returnTo?: string
  /* The profile the whole chain started from, carried to the task the
     builder creates so ITS "back to settings" still knows the way home. Falls
     back to `returnTo` when the builder was opened from the profile itself. */
  origin?: string
}

function audienceKey(taskId: string): string {
  return `${AUDIENCE_PREFIX}:${taskId}`
}

function originKey(taskId: string): string {
  return `${ORIGIN_PREFIX}:${taskId}`
}

/** The profile a task was started from, kept by task id so a revised version
 *  built from this task's "back to settings" inherits it. Same life as the
 *  audience — one tab, until the task is sent. */
export function putOrigin(taskId: string, path: string | undefined): void {
  if (!taskId || !path || !path.startsWith('/')) return
  try {
    window.sessionStorage.setItem(originKey(taskId), path)
  } catch {
    /* see above */
  }
}

export function readOrigin(taskId: string): string | undefined {
  if (!taskId) return undefined
  try {
    const path = window.sessionStorage.getItem(originKey(taskId))
    return path && path.startsWith('/') ? path : undefined
  } catch {
    return undefined
  }
}

export function putSeed(seed: TaskSeed): void {
  try {
    window.sessionStorage.setItem(SEED_KEY, JSON.stringify(seed))
  } catch {
    // Private browsing, or a full quota. The teacher lands on the tasks screen
    // with an empty builder, which is the same screen one click away.
  }
}

/** Read and clear. A seed is an intention, and an intention acted on is spent —
 *  left in place it would re-open the builder on the next visit to the list. */
export function takeSeed(): TaskSeed | null {
  try {
    const raw = window.sessionStorage.getItem(SEED_KEY)
    if (!raw) return null
    window.sessionStorage.removeItem(SEED_KEY)
    const parsed = JSON.parse(raw) as Partial<TaskSeed>
    if (!parsed || typeof parsed !== 'object') return null
    const title = String(parsed.title ?? '').trim()
    const topic = String(parsed.topic ?? '').trim()
    if (!title && !topic) return null
    return {
      title,
      topic,
      objectiveId: parsed.objectiveId ? String(parsed.objectiveId) : null,
      learnerIds: Array.isArray(parsed.learnerIds)
        ? parsed.learnerIds.filter((id): id is string => typeof id === 'string')
        : [],
      ...(parsed.difficulty === 'easy' || parsed.difficulty === 'medium' || parsed.difficulty === 'hard'
        ? { difficulty: parsed.difficulty } : {}),
      ...(typeof parsed.notes === 'string' && parsed.notes ? { notes: parsed.notes } : {}),
      ...(Array.isArray(parsed.components)
        ? { components: parsed.components.filter((c): c is string => typeof c === 'string') }
        : {}),
      ...(parsed.counts && typeof parsed.counts === 'object' ? { counts: parsed.counts } : {}),
      ...(typeof parsed.returnTo === 'string' && parsed.returnTo.startsWith('/')
        ? { returnTo: parsed.returnTo } : {}),
      ...(typeof parsed.origin === 'string' && parsed.origin.startsWith('/')
        ? { origin: parsed.origin } : {}),
    }
  } catch {
    return null
  }
}

export function putAudience(taskId: string, learnerIds: string[]): void {
  if (!taskId || !learnerIds.length) return
  try {
    window.sessionStorage.setItem(audienceKey(taskId), JSON.stringify(learnerIds))
  } catch {
    /* see above */
  }
}

/** Who this task was built for, if it was built for anyone in particular.
 *  Non-destructive — the launch dialog may be opened and closed several times
 *  before a teacher commits. */
export function readAudience(taskId: string): string[] {
  if (!taskId) return []
  try {
    const raw = window.sessionStorage.getItem(audienceKey(taskId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** Once it has been sent, the suggestion has been answered. A second opening is
 *  a new decision, and pre-ticking the first opening's children would make it
 *  look like a decision already taken. */
export function clearAudience(taskId: string): void {
  try {
    window.sessionStorage.removeItem(audienceKey(taskId))
  } catch {
    /* see above */
  }
}
