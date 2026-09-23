export function remainingTestSeconds(startedAt: string | null | undefined, minutes: number, now: number): number | null {
  if (!startedAt || !Number.isFinite(minutes) || minutes <= 0) return null
  const start = Date.parse(startedAt)
  if (!Number.isFinite(start)) return null
  const duration = Math.ceil(minutes * 60)
  return Math.max(0, Math.min(duration, Math.ceil((start + minutes * 60_000 - now) / 1000)))
}

export function formatTestTime(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}