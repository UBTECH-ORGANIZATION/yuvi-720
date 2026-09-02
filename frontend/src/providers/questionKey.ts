/**
 * The Coach's "which question" key is `component|item|question`, built by the
 * server from the learner's event-derived position. Two signals carry it to the
 * client: the instant `screen_change` push (always names a screen) and the
 * reconciling support-state poll, which reports whatever the brain holds —
 * including NOTHING, when an unmapped page id has cleared the pointer.
 */

export interface QuestionKeyParts {
  component: string
  item: string
  question: string
}

export function parseQuestionKey(key: string | null | undefined): QuestionKeyParts {
  const parts = (key || '').split('|')
  return { component: parts[0] || '', item: parts[1] || '', question: parts[2] || '' }
}

/**
 * A poll that names no screen while the client is on one has LOST the screen,
 * not moved the learner off it. Kata cannot send the learner back to a lesson's
 * cover once they are inside, and the server itself grounds an unknown position
 * on the last recorded screen. Adopting the empty key here re-filed the next
 * message under the Introduction one second after question 1 was introduced
 * (2026-09-02, COMPL-00001: an unknown CET page id in the load burst cleared
 * the pointer). Keep the thread where the learner is until a key that names a
 * screen — or a different lesson — arrives.
 */
export function pollLosesScreen(incoming: string | null | undefined, current: string | null | undefined): boolean {
  const next = parseQuestionKey(incoming)
  const now = parseQuestionKey(current)
  if (!now.item || next.item) return false
  return !next.component || next.component === now.component
}
