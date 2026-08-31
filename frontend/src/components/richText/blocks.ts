/* One block grammar for both of Yuvi's chats.
 *
 * The learner's companion and the teacher's assistant used to parse answers
 * separately: one knew tables and math, the other knew clickable students. A
 * rendering bug had to be fixed twice, and each surface was missing whatever
 * the other had. This module owns the block level for both — paragraphs,
 * headings, lists, tables, quotes, rules and diagrams — and knows nothing
 * about what goes *inside* a run of text. That inline layer stays per-surface,
 * which is how the teacher keeps student chips and the learner keeps KaTeX.
 *
 * JSX-free so `node --test` can exercise it directly.
 */

import { AGENDA_LANGUAGE, parseAgendaSpec, type AgendaSpec } from './agenda.ts'
import { DIAGRAM_LANGUAGE, parseDiagramSpec, type DiagramSpec } from './diagram.ts'

export type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'quote'; text: string }
  | { kind: 'rule' }
  | { kind: 'diagram'; spec: DiagramSpec }
  | { kind: 'agenda'; spec: AgendaSpec }

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/
const BLOCK_STARTER = /^\s*(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+|>\s?|\||```)/
const FENCE = /^\s*```\s*([A-Za-z0-9_-]*)\s*$/
const HEADING = /^(#{1,6})\s+(.*)$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const BULLET = /^\s*[-*+•]\s+/
const NUMBERED = /^\s*\d+[.)]\s+/
const QUOTE = /^\s*>\s?/

/** A fenced diagram or agenda, matched whole — for holding it out of text
 *  clean-up that would otherwise edit its JSON. */
export const DIAGRAM_FENCE = new RegExp(
  '```[ \\t]*(?:' + DIAGRAM_LANGUAGE + '|' + AGENDA_LANGUAGE + ')[ \\t]*\\n[\\s\\S]*?```',
  'g'
)

function tableCells(line: string): string[] {
  let row = line.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|')) row = row.slice(0, -1)
  return row.split('|').map((cell) => cell.trim())
}

export function parseBlocks(source: string): Block[] {
  const lines = (source || '').split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i += 1; continue }

    const fence = line.match(FENCE)
    if (fence) {
      const body: string[] = []
      i += 1
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      i += 1 // the closing fence, or the end of the text
      // Every other fence is stripped, as it always has been: a code block is
      // not something either of these two chats has any business showing.
      if (fence[1] === DIAGRAM_LANGUAGE) {
        const spec = parseDiagramSpec(body.join('\n'))
        if (spec) blocks.push({ kind: 'diagram', spec })
      } else if (fence[1] === AGENDA_LANGUAGE) {
        const spec = parseAgendaSpec(body.join('\n'))
        if (spec) blocks.push({ kind: 'agenda', spec })
      }
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      blocks.push({ kind: 'heading', level: Math.min(heading[1].length, 4), text: heading[2].trim() })
      i += 1
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' })
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
      blocks.push({ kind: 'table', header, rows })
      continue
    }

    if (BULLET.test(line) || NUMBERED.test(line)) {
      const ordered = !BULLET.test(line)
      const marker = ordered ? NUMBERED : BULLET
      const items: string[] = []
      while (i < lines.length && marker.test(lines[i])) {
        const item: string[] = [lines[i].replace(marker, '').trim()]
        i += 1
        while (i < lines.length && lines[i].trim() && !marker.test(lines[i])) {
          if (BLOCK_STARTER.test(lines[i]) || TABLE_SEPARATOR.test(lines[i])) break
          item.push(lines[i].trim())
          i += 1
        }
        items.push(item.join(' '))

        if (i < lines.length && !lines[i].trim()) {
          let next = i
          while (next < lines.length && !lines[next].trim()) next += 1
          if (next < lines.length && marker.test(lines[next])) i = next
        }
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) {
        quoted.push(lines[i].replace(QUOTE, ''))
        i += 1
      }
      blocks.push({ kind: 'quote', text: quoted.join(' ') })
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
      blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
    } else {
      // A block-looking line that matched no block (a lone "|", say) — plain text.
      blocks.push({ kind: 'paragraph', text: line })
      i += 1
    }
  }
  return blocks
}

/** Hold back block markup the stream has not finished writing.
 *
 * Same discipline the assistant already applies to a half-written
 * `{{student:` marker, extended to blocks: a table arriving one chunk at a
 * time must never flash as a row of broken pipes, and a diagram payload must
 * never appear as raw JSON on its way in. Costs a few characters of latency
 * and buys a chat that never shows its own syntax. */
export function trimIncompleteBlocks(text: string): string {
  let out = text || ''

  const fences = out.match(/```/g)
  if (fences && fences.length % 2 === 1) out = out.slice(0, out.lastIndexOf('```'))

  const lines = out.split('\n')
  // Nothing ends the last line yet, so a pipe in it is a cell mid-word.
  if (lines.length && lines[lines.length - 1].includes('|')) lines.pop()

  // Walk back over the trailing run of pipe lines. Until the separator row has
  // arrived, that run is not a table — it is pipes.
  let end = lines.length
  while (end > 0 && !lines[end - 1].trim()) end -= 1
  let start = end
  while (start > 0 && lines[start - 1].includes('|')) start -= 1
  if (start < end && !(end - start >= 2 && TABLE_SEPARATOR.test(lines[start + 1]))) {
    lines.length = start
  }

  return lines.join('\n')
}

/** Apply a text clean-up to the prose only, leaving diagram payloads untouched.
 *
 * The learner surface rewrites its text before parsing (stray scripts, clause
 * semicolons, run-together list markers). Every one of those rules would
 * happily edit the inside of a JSON string and turn a valid diagram into a
 * silent nothing. */
export function mapProse(text: string, clean: (segment: string) => string): string {
  let out = ''
  let cursor = 0
  DIAGRAM_FENCE.lastIndex = 0
  for (const match of (text || '').matchAll(DIAGRAM_FENCE)) {
    const index = match.index ?? 0
    out += clean(text.slice(cursor, index)) + match[0]
    cursor = index + match[0].length
  }
  return out + clean((text || '').slice(cursor))
}
