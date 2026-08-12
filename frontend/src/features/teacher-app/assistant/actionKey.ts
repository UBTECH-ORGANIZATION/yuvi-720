/* Which action, on which message.
 *
 * JSX-free and dependency-free for the same reason `studentRefs.ts` is: so
 * `node --test` can import it directly. A guard that is only exercised by
 * rendering a component is a guard nobody checks.
 *
 * The bug this exists to prevent: an action's `id` is `{tool}:{index}`,
 * assigned per TURN by `teacher_assistant._run_tools`. The first goal offered
 * in turn 1 and the first goal offered in turn 3 are therefore BOTH
 * "draft_goal:0". The dock held one `openAction` string and compared it to
 * every message's actions, so opening one goal chip opened the form on every
 * earlier turn that shared the id — and a teacher could confirm inside the
 * wrong one, assigning a goal they were not looking at, for children they had
 * not chosen.
 *
 * Outcomes were never affected: the server stores them per message id, which
 * is why a reloaded thread showed the receipt on the right row. Only the open
 * state was global, and only in the browser.
 */

/** The separator. Two characters, so a single `:` inside an action id — which
 *  every id has — cannot be mistaken for the boundary. */
const SEPARATOR = '::'

export function actionKey(messageId: string, actionId: string): string {
  return `${messageId}${SEPARATOR}${actionId}`
}

/** The bare action id, which is what the server stores an outcome under. */
export function actionIdOf(key: string, messageId: string): string {
  return key.slice(messageId.length + SEPARATOR.length)
}
