export function formatStudioClock(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60
  return [minutes, remainingSeconds].map((value) => String(value).padStart(2, '0')).join(':')
}