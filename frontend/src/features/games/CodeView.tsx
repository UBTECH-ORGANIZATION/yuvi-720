/* The code as Yuvi writes it, the way vibe-coding-kids shows it: numbered
 * rows, Catppuccin-style colours, and its own scroller that follows the tail
 * while the kid watches.
 */

import { useEffect, useRef } from 'react'
import { highlightLines } from './codeHighlight'

export function CodeView({ code, label }: { code: string; label: string }) {
  const boxRef = useRef<HTMLDivElement>(null)
  // Follow the tail while it grows. Only the kid's own scrolling changes the
  // decision: scrolling up releases the follow, scrolling back to the bottom
  // re-arms it. Checking "near the bottom" after a render would lose the
  // follow every time a big chunk pushed the bottom away.
  const followRef = useRef(true)
  const programmaticRef = useRef(false)
  const rows = highlightLines(code)

  useEffect(() => {
    const box = boxRef.current
    if (!box || !followRef.current) return
    programmaticRef.current = true
    box.scrollTop = box.scrollHeight
  }, [code])

  const onScroll = () => {
    const box = boxRef.current
    if (!box) return
    if (programmaticRef.current) { programmaticRef.current = false; return }
    followRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 48
  }

  return (
    <div ref={boxRef} className="code-view" dir="ltr" role="region" aria-label={label} onScroll={onScroll}>
      {rows.map((tokens, index) => (
        <div key={index} className={`code-view__row${index === rows.length - 1 ? ' is-last' : ''}`}>
          <span className="code-view__n">{index + 1}</span>
          <span className="code-view__l">
            {tokens.map((token, i) => (
              token[0] === 'txt' ? token[1] : <span key={i} className={`cv-${token[0]}`}>{token[1]}</span>
            ))}
          </span>
        </div>
      ))}
    </div>
  )
}
