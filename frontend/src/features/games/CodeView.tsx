/* The code as Yuvi writes it, the way vibe-coding-kids shows it: numbered
 * rows, Catppuccin-style colours, and its own scroller that follows the tail
 * while the kid watches.
 */

import { useEffect, useRef } from 'react'
import { highlightLines } from './codeHighlight'

export function CodeView({ code, label }: { code: string; label: string }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const rows = highlightLines(code)

  // Follow the tail while it grows; a kid who scrolled up stays put.
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 160
    if (nearBottom) box.scrollTop = box.scrollHeight
  }, [code])

  return (
    <div ref={boxRef} className="code-view" dir="ltr" role="region" aria-label={label}>
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
