import type { ReactNode } from 'react'
import { AgendaView } from './AgendaView'
import { DiagramView } from './DiagramView'
import { parseBlocks, type Block } from './blocks.ts'

/* The block half of both chats. What goes *inside* a run of text is the one
   thing that genuinely differs between the two surfaces — the learner needs
   KaTeX, the teacher needs clickable students — so it arrives as a function.
   Everything above that line is written once. */

export type InlineRenderer = (text: string) => ReactNode

export interface RichTextOptions {
  /** Appended to the surface-neutral classes, so each chat keeps its spacing. */
  paragraphClass?: string
  listClass?: string
}

function classNames(...parts: (string | undefined)[]): string | undefined {
  const joined = parts.filter(Boolean).join(' ')
  return joined || undefined
}

export function renderBlock(
  block: Block, inline: InlineRenderer, key: number, options: RichTextOptions
): ReactNode {
  switch (block.kind) {
    case 'heading':
      return (
        <p className={`sp-md-heading sp-md-heading--${block.level}`} key={key} dir="auto">
          {inline(block.text)}
        </p>
      )
    case 'rule':
      return <hr className="sp-md-hr" key={key} />
    case 'quote':
      return (
        <blockquote className="sp-md-quote" key={key} dir="auto">
          {inline(block.text)}
        </blockquote>
      )
    case 'list': {
      const className = classNames(
        'sp-md-list', block.ordered ? 'sp-md-list--ordered' : undefined, options.listClass
      )
      const items = block.items.map((item, index) => (
        <li key={index} dir="auto">
          <span className="sp-md-li-body">{inline(item)}</span>
        </li>
      ))
      return block.ordered
        ? <ol className={className} key={key}>{items}</ol>
        : <ul className={className} key={key}>{items}</ul>
    }
    case 'table':
      return (
        // Its own scroll box: a wide table on a phone scrolls here and never
        // widens the bubble it sits in.
        <div className="sp-md-tablewrap" key={key}>
          <table className="sp-md-table">
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th key={index} dir="auto">{inline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {block.header.map((_, index) => (
                    <td key={index} dir="auto">{inline(row[index] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'diagram':
      return <DiagramView key={key} spec={block.spec} />
    case 'agenda':
      // The one block that renders its own text through the inline layer:
      // an item can name a child, and a student reference must become the
      // same chip inside a card as it is inside a sentence.
      return <AgendaView key={key} spec={block.spec} inline={inline} />
    default:
      return (
        <p className={classNames(options.paragraphClass)} key={key} dir="auto">
          {inline(block.text)}
        </p>
      )
  }
}

export function renderRichText(
  text: string, inline: InlineRenderer, options: RichTextOptions = {}
): ReactNode[] {
  return parseBlocks(text).map((block, index) => renderBlock(block, inline, index, options))
}
