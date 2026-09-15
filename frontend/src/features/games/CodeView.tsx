/* The code as Yuvi writes it, the way vibe-coding-kids shows it: numbered
 * rows, Catppuccin-style colours, and its own scroller that follows the tail
 * while the kid watches.
 *
 * The writing has to *feel* like writing at 7 frames a second: every row
 * that landed since the last paint slides in with a short glow, the row
 * being written carries a shimmer and a caret, its line number pulses, and
 * a new function / class / script block sends a spark up as it starts. All
 * of it is CSS on a class; React only tags the rows.
 */

import { useEffect, useRef } from 'react'
import { highlightLines } from './codeHighlight'

/** A row that opens a new block gets a spark: the moments a game grows a limb. */
const BLOCK_START = /^\s*(?:(?:async\s+)?function\b|class\b|<script\b|<style\b|<canvas\b|const\s+\w+\s*=\s*(?:\(|async|function)|\w+\s*\([^)]*\)\s*\{\s*$)/

export function CodeView({ code, label, changed = [], focusLine = null, live = false }: {
  code: string
  label: string
  /** Line ranges (1-based, inclusive) an edit just touched: highlighted. */
  changed?: [number, number][]
  /** The line to bring into view when an edit lands; null follows the tail. */
  focusLine?: number | null
  /** True while the worker is still writing: caret, shimmer and sparks. */
  live?: boolean
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  // Follow the tail while it grows. Only the kid's own scrolling changes the
  // decision: scrolling up releases the follow, scrolling back to the bottom
  // re-arms it. Checking "near the bottom" after a render would lose the
  // follow every time a big chunk pushed the bottom away.
  const followRef = useRef(true)
  const programmaticRef = useRef(false)
  const rows = highlightLines(code)
  // Rows at or past this index arrived since the previous paint: they get
  // the entrance animation. Read during render, advanced after commit.
  const seenRef = useRef(0)
  const freshFrom = live ? seenRef.current : rows.length

  useEffect(() => {
    seenRef.current = live ? Math.max(0, rows.length - 1) : rows.length
  })

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    if (focusLine) {
      // An edit: bring the changed place into view, a little above centre.
      const row = box.querySelector<HTMLElement>(`[data-line="${focusLine}"]`)
      if (row) {
        programmaticRef.current = true
        box.scrollTop = Math.max(0, row.offsetTop - box.clientHeight * 0.4)
      }
      return
    }
    if (!followRef.current) return
    programmaticRef.current = true
    box.scrollTop = box.scrollHeight
  }, [code, focusLine])

  const isChanged = (line: number) => changed.some(([a, b]) => line >= a && line <= b)

  const onScroll = () => {
    const box = boxRef.current
    if (!box) return
    if (programmaticRef.current) { programmaticRef.current = false; return }
    followRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 48
  }

  const last = rows.length - 1
  return (
    <div ref={boxRef} className={`code-view${live ? ' is-live' : ''}`} dir="ltr" role="region" aria-label={label} onScroll={onScroll}>
      {rows.map((tokens, index) => {
        const isLast = index === last
        const fresh = live && index >= freshFrom && !isLast
        const text = fresh ? tokens.map((token) => token[1]).join('') : ''
        const spark = fresh && BLOCK_START.test(text)
        const cls = `code-view__row${isLast ? ' is-last' : ''}${fresh ? ' is-fresh' : ''}${isChanged(index + 1) ? ' is-changed' : ''}`
        return (
          <div key={index} data-line={index + 1} className={cls}>
            <span className="code-view__n">{index + 1}</span>
            <span className="code-view__l">
              {tokens.map((token, i) => (
                token[0] === 'txt' ? token[1] : <span key={i} className={`cv-${token[0]}`}>{token[1]}</span>
              ))}
              {live && isLast && <span className="code-view__caret" aria-hidden="true" />}
              {spark && <i className="code-view__spark" aria-hidden="true">✨</i>}
            </span>
          </div>
        )
      })}
    </div>
  )
}
