import type { ReactNode } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

/* Lightweight markdown renderer for Yuvi's replies (both the floating companion
   and the learning-map topic chat). Supports headings, paragraphs, unordered /
   ordered lists, tables, blockquotes, and horizontal rules, with inline bold,
   inline code, and KaTeX math preserved. No external markdown dependency — a
   block splitter over the existing inline tokenizer, so math never breaks. */

const FENCED_BLOCK = /```[^\n]*\n?[\s\S]*?```/g
const INLINE_FORMAT = /(\\\([^]*?\\\)|\\\[[^]*?\\\]|\$\$[^]*?\$\$|\$[^$\n]+\$|\*\*[^*]+\*\*|`[^`\n]+`)/g

function inlineContent(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let cursor = 0
  for (const match of text.matchAll(INLINE_FORMAT)) {
    const index = match.index ?? 0
    if (index > cursor) nodes.push(text.slice(cursor, index))
    const token = match[0]
    if (token.startsWith('\\(') || token.startsWith('\\[') || token.startsWith('$')) {
      const displayMode = token.startsWith('\\[') || token.startsWith('$$')
      const delimiterLength = token.startsWith('$$') || token.startsWith('\\') ? 2 : 1
      const formula = token.slice(delimiterLength, -delimiterLength).trim()
      nodes.push(
        <span
          className={`sp-companion__math${displayMode ? ' sp-companion__math--display' : ''}`}
          dir="ltr"
          key={`${index}-${token}`}
          dangerouslySetInnerHTML={{
            __html: katex.renderToString(formula, {
              displayMode,
              output: 'htmlAndMathml',
              strict: 'ignore',
              throwOnError: false,
              trust: false,
            }),
          }}
        />
      )
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={`${index}-${token}`}>{token.slice(2, -2)}</strong>)
    } else {
      nodes.push(
        <bdi className="sp-companion__math" dir="ltr" key={`${index}-${token}`}>
          {token.slice(1, -1)}
        </bdi>
      )
    }
    cursor = index + token.length
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/
const BLOCK_STARTER = /^\s*(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+|>\s?|\|)/

/** Models often emit list items inline ("a. - b. - c.") instead of on their own
 * lines. Put a real newline before a bullet/number marker that follows sentence
 * punctuation, so it renders as a proper list. Prose dashes ("10 - 15") and
 * ranges are untouched (they lack the preceding sentence break). */
function normalizeInlineMarkers(md: string): string {
  return md
    .replace(/([.!?׃:：])[ \t]+(?=[-•*][ \t]\S)/g, '$1\n')
    .replace(/([.!?׃:：])[ \t]+(?=\d+[.)][ \t]\S)/g, '$1\n')
}

function tableCells(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((cell) => cell.trim())
}

function parseBlocks(md: string): ReactNode[] {
  const lines = md.split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i += 1; continue }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      const level = Math.min(heading[1].length, 4)
      blocks.push(
        <p className={`sp-md-heading sp-md-heading--${level}`} key={key++} dir="auto">
          {inlineContent(heading[2].trim())}
        </p>
      )
      i += 1
      continue
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<hr className="sp-md-hr" key={key++} />)
      i += 1
      continue
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1])) {
      const header = tableCells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        rows.push(tableCells(lines[i]))
        i += 1
      }
      blocks.push(
        <div className="sp-md-tablewrap" key={key++}>
          <table className="sp-md-table">
            <thead>
              <tr>{header.map((cell, ci) => <th key={ci} dir="auto">{inlineContent(cell)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>{header.map((_, ci) => <td key={ci} dir="auto">{inlineContent(row[ci] ?? '')}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(
          <li key={items.length} dir="auto">
            <span className="sp-md-li-body">{inlineContent(lines[i].replace(/^\s*[-*+]\s+/, ''))}</span>
          </li>
        )
        i += 1
      }
      blocks.push(<ul className="sp-md-list" key={key++}>{items}</ul>)
      continue
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(
          <li key={items.length} dir="auto">
            <span className="sp-md-li-body">{inlineContent(lines[i].replace(/^\s*\d+[.)]\s+/, ''))}</span>
          </li>
        )
        i += 1
      }
      blocks.push(<ol className="sp-md-list sp-md-list--ordered" key={key++}>{items}</ol>)
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const quoted: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s*>\s?/, ''))
        i += 1
      }
      blocks.push(<blockquote className="sp-md-quote" key={key++} dir="auto">{inlineContent(quoted.join(' '))}</blockquote>)
      continue
    }

    const paragraph: string[] = []
    while (
      i < lines.length && lines[i].trim()
      && !BLOCK_STARTER.test(lines[i]) && !TABLE_SEPARATOR.test(lines[i])
    ) {
      paragraph.push(lines[i])
      i += 1
    }
    if (paragraph.length) {
      blocks.push(<p key={key++} dir="auto">{inlineContent(paragraph.join(' '))}</p>)
    } else {
      // A block-looking line that matched no block (e.g. a lone "|") — plain text.
      blocks.push(<p key={key++} dir="auto">{inlineContent(line)}</p>)
      i += 1
    }
  }
  return blocks
}

/** Render one Yuvi reply as markdown. Fenced code blocks (used internally to
 * carry diagram specs) are stripped first, matching the prior behavior. */
export function CoachMarkdown({ text }: { text: string }) {
  const safeText = normalizeInlineMarkers(text.replace(FENCED_BLOCK, '')).trim()
  if (!safeText) return null
  return (
    <div className="sp-companion__prose" dir="auto">
      {parseBlocks(safeText)}
    </div>
  )
}
