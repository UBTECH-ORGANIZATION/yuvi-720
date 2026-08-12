/* The rendering half of the Hebrew+math contract.
 *
 * React elements, never an HTML string. Every field this renders is
 * model-generated, and `dangerouslySetInnerHTML` over model output is one
 * missed escape away from an injection — React escapes by construction, so the
 * question of whether the sanitizer caught everything never arises.
 *
 * `unicode-bidi: isolate` is the whole fix, and it must be `isolate` — not
 * `embed`, not `override`. It stops the formula joining the paragraph's bidi
 * run, so `x² - 5x + 6 = 0` keeps its own operators in order inside Hebrew
 * text. The trailing full stop sits OUTSIDE the span, or it lands at the wrong
 * end of the formula.
 */

import { toRenderParts, type MathSegment } from './mathSegments'

interface Props {
  content: string | MathSegment[] | null | undefined
  /** Wrap in a block element instead of a span. A heading is a real option:
   *  a slide title is a heading, and rendering it as a <p> to keep this
   *  union short would flatten the document outline for a screen reader.
   *  `strong`, `small` and `cite` are here for the same reason one step down —
   *  a grid tile's term, a figure's caption and a quote's attribution are
   *  those elements, and rendering all three as spans would say nothing. */
  as?: 'span' | 'p' | 'div' | 'h2' | 'h3' | 'h4' | 'strong' | 'small' | 'cite'
  className?: string
}

export function MathText({ content, as: Tag = 'span', className }: Props) {
  const parts = toRenderParts(content)
  if (!parts.length) return null

  return (
    <Tag className={className} dir="auto">
      {parts.map((part, index) => (
        part.kind === 'math' ? (
          <span key={index}>
            <span className="yv-math" dir="ltr">{part.value}</span>
            {part.punctuation}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        )
      ))}
    </Tag>
  )
}
