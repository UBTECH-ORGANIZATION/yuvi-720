/* Thumbnails for a list of catalog items, rendered off the critical path.
 *
 * The cards render immediately with their colour-dot fallback; misses are
 * filled three at a time on idle callbacks, with one state update per chunk,
 * so opening a panel never blocks the studio's own frame. Items already in
 * the module cache appear on the first render. */
import { useEffect, useState } from 'react'

const CHUNK = 3

type Idle = (cb: () => void, options?: { timeout: number }) => number
type CancelIdle = (handle: number) => void

const idle: Idle = typeof window !== 'undefined' && 'requestIdleCallback' in window
  ? (cb, options) => window.requestIdleCallback(cb, options)
  : (cb) => window.setTimeout(cb, 0)
const cancelIdle: CancelIdle = typeof window !== 'undefined' && 'cancelIdleCallback' in window
  ? (handle) => window.cancelIdleCallback(handle)
  : (handle) => window.clearTimeout(handle)

export function useThumbnails<T extends { id: string }>(
  items: T[],
  render: (item: T) => Promise<string | null>,
  cache: Record<string, string>,
): Record<string, string> {
  const [thumbs, setThumbs] = useState<Record<string, string>>(() => ({ ...cache }))

  useEffect(() => {
    const missing = items.filter((item) => !cache[item.id])
    // Same identity when nothing is missing: the grid should not re-render.
    setThumbs((prev) => (items.every((item) => prev[item.id] === cache[item.id]) ? prev : { ...cache }))
    if (!missing.length) return
    let cancelled = false
    let handle = 0
    let index = 0
    const step = () => {
      handle = idle(async () => {
        const chunk = missing.slice(index, index + CHUNK)
        index += CHUNK
        // A render that outlives the panel still lands in the cache — it is
        // exactly what the next open wants — but must not set state on it.
        await Promise.all(chunk.map((item) => render(item).catch(() => null)))
        if (cancelled) return
        setThumbs({ ...cache })
        if (index < missing.length) step()
      }, { timeout: 800 })
    }
    step()
    return () => {
      cancelled = true
      cancelIdle(handle)
    }
  }, [items, render, cache])

  return thumbs
}
