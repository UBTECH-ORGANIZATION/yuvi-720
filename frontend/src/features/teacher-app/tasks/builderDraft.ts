/* The task builder's unsent form, kept across an accidental close.
 *
 * ## Why localStorage here, when the project rule says no
 *
 * The rule (`docs/architecture/shared-learning-brain.md`) is about *learner
 * state*: a child's progress, mastery and preferences belong to the brain, on
 * the server, because they follow the child to another device and because the
 * brain reasons over them. None of that is true of a half-typed form. This is
 * an unsent draft on one teacher's own machine — it is worth nothing to any
 * other device, it is never read by anything but this dialog, and sending it
 * to the server would mean writing a row for every keystroke of work a teacher
 * may well abandon.
 *
 * ## Scoped, and expiring
 *
 * The key carries the teacher AND the class, because "the task I was writing
 * for ז'2" must not reappear while looking at ז'3, and a shared machine in a
 * staff room must not hand one teacher another's draft.
 *
 * Drafts expire. A form restored a fortnight later is not help — the teacher
 * has forgotten the intent, the class has moved on, and the restored text is
 * more confusing than an empty dialog.
 */

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000

const PREFIX = 'yuvi.teacher.taskDraft'

/** Anything the dialog wants restored. Deliberately unconstrained here: the
 *  dialog validates what it reads back, because a stored shape survives a
 *  deploy that changes the form. */
export type BuilderDraft = Record<string, unknown>

interface Envelope {
  at: number
  draft: BuilderDraft
}

function keyFor(teacherId: string, groupId: string): string {
  return `${PREFIX}:${teacherId}:${groupId}`
}

export function loadDraft(teacherId: string, groupId: string): BuilderDraft | null {
  if (!teacherId || !groupId) return null
  try {
    const raw = window.localStorage.getItem(keyFor(teacherId, groupId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Envelope
    if (!parsed || typeof parsed !== 'object' || typeof parsed.at !== 'number') return null
    if (Date.now() - parsed.at > DRAFT_TTL_MS) {
      clearDraft(teacherId, groupId)
      return null
    }
    return parsed.draft && typeof parsed.draft === 'object' ? parsed.draft : null
  } catch {
    // A quota error, a private-browsing refusal, or JSON someone else wrote.
    // Losing a draft is a disappointment; a dialog that will not open is a bug.
    return null
  }
}

export function saveDraft(teacherId: string, groupId: string, draft: BuilderDraft): void {
  if (!teacherId || !groupId) return
  try {
    window.localStorage.setItem(
      keyFor(teacherId, groupId), JSON.stringify({ at: Date.now(), draft }),
    )
  } catch {
    /* see above */
  }
}

export function clearDraft(teacherId: string, groupId: string): void {
  if (!teacherId || !groupId) return
  try {
    window.localStorage.removeItem(keyFor(teacherId, groupId))
  } catch {
    /* see above */
  }
}

/** True when the draft holds anything a teacher would mind losing.
 *
 *  An untouched form is stored as readily as a filled one — the alternative is
 *  a save path that has to know which defaults are defaults — so the *restore*
 *  side is where an empty draft is recognised and ignored.
 */
export function isEmptyDraft(draft: BuilderDraft | null): boolean {
  if (!draft) return true
  const text = ['title', 'topic', 'notes']
    .map((field) => String(draft[field] ?? '').trim())
    .join('')
  const source = draft.source as { component_id?: string } | null | undefined
  return text.length === 0 && !source?.component_id
}
