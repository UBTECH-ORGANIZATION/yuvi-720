import type { ReactNode } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { mapProse, trimIncompleteBlocks } from './richText/blocks.ts'
import { renderRichText } from './richText/RichText'

/* Yuvi's replies on the learner side (the floating companion and the
   learning-map topic chat).

   Blocks — paragraphs, headings, lists, tables, quotes, diagrams — are parsed
   by the shared renderer that the teacher's assistant uses too. What lives
   here is the learner's own inline layer (bold, inline code, KaTeX) and the
   text clean-ups only a model talking to a child needs. */

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

/** Models often emit list items inline ("a. - b. - c.") instead of on their own
 * lines. Put a real newline before a bullet/number marker that follows sentence
 * punctuation, so it renders as a proper list. Prose dashes ("10 - 15") and
 * ranges are untouched (they lack the preceding sentence break). */
function normalizeInlineMarkers(md: string): string {
  return md
    .replace(/([.!?׃:：])[ \t]+(?=[-•*][ \t]\S)/g, '$1\n')
    .replace(/([.!?׃:：])[ \t]+(?=\d+[.)][ \t]\S)/g, '$1\n')
}

/** A semicolon joining two clauses reads clunky in Yuvi's short Hebrew/Arabic
 * messages (nudges especially). Present such joins as two sentences instead.
 * Only "clause; clause" style joins (a non-semicolon char, then `; ` + text) are
 * touched — HTML entities have no trailing space, and any rare math renders
 * best-effort (KaTeX is throwOnError:false). */
function splitClauseSemicolons(md: string): string {
  return md.replace(/([^\s;])\s*;[ \t]+/g, '$1. ')
}

/* Yuvi answers only in Hebrew / Arabic / English (plus math + emoji). The model
 * occasionally leaks a stray CJK/Japanese/Korean token mid-sentence (e.g. a
 * Chinese gloss of the adjacent Hebrew word). Those scripts are never legitimate
 * here, so drop any run of them and heal the whitespace. Hebrew (U+0590–5FF),
 * Arabic (U+0600–6FF), Latin, Greek, punctuation, and emoji are all outside
 * these ranges and untouched. */
const FOREIGN_SCRIPTS = /[\u1100-\u11ff\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af\uff00-\uffef]+/g

function stripForeignScripts(md: string): string {
  return md.replace(FOREIGN_SCRIPTS, '').replace(/[ \t]{2,}/g, ' ')
}

/** Render one Yuvi reply.
 *
 * `streaming` holds back a table or a diagram payload the model has not
 * finished writing, so neither ever flashes as raw syntax on its way in. */
export function CoachMarkdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  // Every clean-up below rewrites prose and would happily edit the JSON inside
  // a diagram fence — so the fences are held out of their way.
  const safeText = mapProse(
    streaming ? trimIncompleteBlocks(text) : text,
    (segment) => splitClauseSemicolons(stripForeignScripts(normalizeInlineMarkers(segment)))
  ).trim()
  if (!safeText) return null
  return (
    <div className="sp-companion__prose" dir="auto">
      {renderRichText(safeText, inlineContent)}
    </div>
  )
}
