/* Dates, written the way this product's users read them.
 *
 * `toLocaleDateString()` with no locale follows the BROWSER, not the page — so
 * a Hebrew screen on a machine configured for US English renders `8/12/2026`
 * for the 12th of August. Numeric dates are therefore one format, everywhere,
 * in every language: dd/mm/yyyy, zero-padded, always LTR (`⁦…⁩` isolates it,
 * or a Hebrew sentence ending in a date will reorder its own parts).
 */

/** The isolate around a number that sits inside right-to-left prose. */
const LTR = (text: string) => `⁦${text}⁩`

function parse(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** `12/08/2026`. The default for any date shown as numbers. */
export function formatDay(value: string | number | Date | null | undefined): string {
  const date = parse(value)
  if (!date) return ''
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return LTR(`${day}/${month}/${date.getFullYear()}`)
}

/** `12/08/2026, 14:02` — 24-hour, because 2pm is not a thing here either. */
export function formatDayTime(value: string | number | Date | null | undefined): string {
  const date = parse(value)
  if (!date) return ''
  const time = `${String(date.getHours()).padStart(2, '0')}:${
    String(date.getMinutes()).padStart(2, '0')}`
  return LTR(`${formatDay(date).slice(1, -1)}, ${time}`)
}
