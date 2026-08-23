/* The one way a duration in seconds becomes text on a teacher screen.
 *
 * "747 שנ׳" is unreadable — above a minute the number rolls over to minutes
 * (whole when round, m:ss otherwise). Below a minute the existing seconds key
 * keeps its wording. New surfaces should use this instead of rolling their
 * own ladder (several screens still do; migrate as they are touched). */

type Translate = (key: string, params?: Record<string, string | number>) => string

export function formatSeconds(seconds: number, t: Translate): string {
  const whole = Math.max(0, Math.round(seconds))
  if (whole < 60) return t('tch.learnings.seconds', { n: whole })
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  if (!rest) return t('tch.time.minutes', { m: minutes })
  return t('tch.time.minutesSeconds', { m: minutes, ss: String(rest).padStart(2, '0') })
}
