/* Picking between a singular and a plural locale key.
 *
 * `t()` is plain `{param}` interpolation with no plural engine, deliberately —
 * so "הצבה ל-{count} תלמידים" renders "הצבה ל-1 תלמידים" when the count is one,
 * which is broken Hebrew and reached a teacher's screen.
 *
 * This is NOT a plural engine either, and must not grow into one. It knows a
 * single fact: one is different from not-one. That covers Hebrew, Arabic and
 * English for every count-carrying label in the teacher app, because the
 * plural forms all use numerals ("2 תלמידים" is correct) and only the singular
 * needs different words.
 *
 * Where a name is available, the singular should use it — "הצבה לדביר" beats
 * "הצבה לתלמיד אחד", and it is the difference between a teacher knowing who
 * they are about to write about and merely knowing how many.
 *
 * JSX-free so `node --test` can import it directly.
 */

/** `key` → `key.one` or `key.many`, by count. */
export function countKey(key: string, count: number): string {
  return `${key}.${count === 1 ? 'one' : 'many'}`
}
