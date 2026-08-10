/* Per-message timestamps, shared by every conversation surface.
 *
 * Always Israel time (Asia/Jerusalem) regardless of the device clock — the 720
 * audience is Israeli, and a tablet left on a foreign timezone must not make a
 * message look like it arrived tomorrow. Today shows the time only; any other
 * day prefixes the date in dd/mm/yy. "Same day" is evaluated in Israel time too,
 * so a late-evening UTC message does not read as yesterday.
 *
 * Lifted out of `CompanionChat` when the teacher thread needed the same clock:
 * two implementations of "when was this said" would have drifted apart, and the
 * teacher's copy is describing the very messages the learner is reading.
 */

const ISRAEL_TZ = 'Asia/Jerusalem'

export function israelYMD(date: Date): string {
  // en-CA yields YYYY-MM-DD, easy to compare and to slice for dd/mm/yy.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ISRAEL_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

export function formatMessageTime(value: string, language: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const time = new Intl.DateTimeFormat(language, {
    timeZone: ISRAEL_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
  const ymd = israelYMD(date)
  if (ymd === israelYMD(new Date())) return time
  const [y, m, d] = ymd.split('-')
  return `${d}/${m}/${y.slice(-2)} ${time}`
}
