/* A subject, in the teacher's language — and never as a dotted key.
 *
 * `t()` (I18nProvider.tsx:110-119) returns the KEY when it misses, so
 * `t('tch.subject.english')` printed the literal string `tch.subject.english`
 * on the learnings screen the moment live content shipped a subject the locale
 * files had not caught up with. Six call sites did the same lookup inline, so
 * one missing translation leaked in six places.
 *
 * The catalogue's own subjects are a closed set today (`kata_client
 * .subject_from_objective` → science / math / other) but the *events* carry
 * whatever the content vendor tags, which is where `english` came from. So the
 * table can always fall behind the data, and the fallback has to be readable
 * rather than correct-or-nothing: a capitalised raw value is a word a teacher
 * can read, and a dotted key is not.
 *
 * JSX-free so `node --test` can import it — see `actionKey.ts` for why that
 * matters.
 */

type Translate = (key: string, params?: Record<string, string | number>) => string

/** "english" → "English", "language_arts" → "Language Arts". Hebrew and Arabic
 *  have no case, so `toUpperCase` on their letters is the identity — the same
 *  code path is safe for a raw value in any script. */
function humanize(raw: string): string {
  return raw
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * The label for a subject.
 *
 * Returns `''` for a missing subject so call sites can keep using
 * `.filter(Boolean)` on their meta lists instead of a ternary each.
 */
export function subjectLabel(subject: string | null | undefined, t: Translate): string {
  const raw = (subject ?? '').trim()
  if (!raw) return ''
  const key = `tch.subject.${raw.toLowerCase()}`
  const translated = t(key)
  // The miss behaviour: `t()` hands back the key it could not resolve.
  return translated === key ? humanize(raw) : translated
}
