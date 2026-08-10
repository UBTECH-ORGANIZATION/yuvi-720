/* Parsing for `{{student:<learner_id>}}` markers.
 *
 * Deliberately JSX-free and dependency-free so `node --test` can import it
 * directly — this is the client half of the PII boundary and it deserves real
 * tests, not tests of a component wrapper.
 *
 * The contract: tools never return a student's name, so the model writes an id
 * inside a marker and the name is substituted here, from the roster already in
 * the teacher's browser.
 */

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'student'; learnerId: string }

/* Student markers, plus `**bold**`.
 *
 * The bold half is not a markdown renderer and must not become one. Chat models
 * reach for `**` reflexively when listing findings, and asking them not to in
 * the prompt works only most of the time — the residue renders as literal
 * asterisks in a teacher's face. Emphasis is the one marker worth honouring;
 * anything else stays literal text, which is the safe direction. */
const TOKEN = /\{\{student:([^}]*)\}\}|\*\*([^*\n]+)\*\*/g

export function parseStudentRefs(text: string): Segment[] {
  const segments: Segment[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  const push = (segment: Segment) => {
    const previous = segments[segments.length - 1]
    // Coalesce adjacent literals so an empty marker does not fragment the run.
    if (segment.kind === 'text' && previous?.kind === 'text') previous.text += segment.text
    else segments.push(segment)
  }

  // A module-level regex with /g carries state between calls.
  TOKEN.lastIndex = 0
  while ((match = TOKEN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      push({ kind: 'text', text: text.slice(lastIndex, match.index) })
    }

    if (match[2] !== undefined) {
      push({ kind: 'bold', text: match[2] })
    } else {
      const learnerId = (match[1] ?? '').trim()
      // An empty marker is text, not a reference to nobody.
      if (learnerId) push({ kind: 'student', learnerId })
      else push({ kind: 'text', text: match[0] })
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    push({ kind: 'text', text: text.slice(lastIndex) })
  }
  return segments
}

/** What the teacher sees for a reference: the name, or the inert id. */
export function labelFor(learnerId: string, name: string | null | undefined): string {
  return (name || '').trim() || learnerId
}

/* ── blocks ────────────────────────────────────────────────────────────────
 *
 * The answer used to be one `<p>` with `white-space: pre-wrap`, which was
 * honest when answers were dumps. Now that the assistant writes a paragraph and
 * occasionally a short list, a list has to *look* like a list.
 *
 * Still not a markdown renderer, and still must not become one: paragraphs and
 * `-` bullets are the entire grammar, because they are the entire grammar the
 * prompt permits. Anything else the model emits stays literal — visible, ugly,
 * and fixable in the prompt, which beats silently swallowing it.
 */

/** Hide a marker the stream has not finished writing yet.
 *
 * Streaming renders every keystroke, so without this the teacher watches
 * `{{student:demo-t` type itself out before snapping to a name. Dropping the
 * unterminated tail costs a few characters of latency and buys a chat that
 * never shows its own template syntax. */
export function trimPartialMarkers(text: string): string {
  const open = text.lastIndexOf('{{')
  let out = open >= 0 && text.indexOf('}}', open) === -1 ? text.slice(0, open) : text
  // An odd count of `**` means the last one is an opener still waiting to close.
  const bolds = out.match(/\*\*/g)
  if (bolds && bolds.length % 2 === 1) out = out.slice(0, out.lastIndexOf('**'))
  return out
}

export type Block =
  | { kind: 'paragraph'; segments: Segment[] }
  | { kind: 'list'; items: Segment[][] }

const BULLET = /^\s*[-•]\s+/

export function parseAnswerBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []
  let items: string[] = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push({ kind: 'paragraph', segments: parseStudentRefs(paragraph.join('\n')) })
    paragraph = []
  }
  const flushList = () => {
    if (!items.length) return
    blocks.push({ kind: 'list', items: items.map(parseStudentRefs) })
    items = []
  }

  for (const line of (text || '').split('\n')) {
    if (!line.trim()) {
      flushList()
      flushParagraph()
      continue
    }
    if (BULLET.test(line)) {
      flushParagraph()
      items.push(line.replace(BULLET, ''))
      continue
    }
    flushList()
    paragraph.push(line)
  }
  flushList()
  flushParagraph()
  return blocks
}
