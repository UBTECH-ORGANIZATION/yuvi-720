/* The block grammar both chats now share, and the diagram payload.
 *
 *   node --test frontend/tests/
 *
 * Two things are worth guarding here. A table has to survive arriving one
 * chunk at a time — the failure it replaces is a learner watching a row of
 * broken pipes assemble itself. And a diagram payload has to be *data*: the
 * model writes JSON, this code decides whether it is drawable, and anything
 * that is not renders nothing at all rather than a broken picture.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseBlocks, trimIncompleteBlocks, mapProse } from '../src/components/richText/blocks.ts'
import { layoutDiagram, parseDiagramSpec } from '../src/components/richText/diagram.ts'

const diagram = (payload: unknown) => '```yuvi-diagram\n' + JSON.stringify(payload) + '\n```'

describe('blocks a reply is made of', () => {
  it('reads a comparison table with its header and rows', () => {
    const blocks = parseBlocks(
      'הנה ההבדל:\n\n| מצב | דוגמה |\n| --- | --- |\n| מוצק | קרח |\n| נוזל | מים |'
    )
    assert.deepEqual(blocks.map((b) => b.kind), ['paragraph', 'table'])
    assert.ok(blocks[1].kind === 'table')
    assert.deepEqual(blocks[1].header, ['מצב', 'דוגמה'])
    assert.deepEqual(blocks[1].rows, [['מוצק', 'קרח'], ['נוזל', 'מים']])
  })

  it('pads a short row rather than shifting the columns', () => {
    const blocks = parseBlocks('| א | ב |\n| --- | --- |\n| רק אחד |')
    assert.ok(blocks[0].kind === 'table')
    assert.equal(blocks[0].rows[0].length, 1)
  })

  it('keeps a lone pipe as text instead of pretending it is a table', () => {
    assert.deepEqual(parseBlocks('|').map((b) => b.kind), ['paragraph'])
  })

  it('tells an ordered list from a bulleted one', () => {
    const blocks = parseBlocks('1. ראשון\n2. שני')
    assert.ok(blocks[0].kind === 'list')
    assert.equal(blocks[0].ordered, true)
  })

  it('drops a code block, which neither chat has any business showing', () => {
    assert.deepEqual(parseBlocks('לפני\n```python\nprint(1)\n```\nאחרי').map((b) => b.kind),
      ['paragraph', 'paragraph'])
  })
})

describe('a reply arriving one chunk at a time', () => {
  it('holds back a table until it is a table', () => {
    assert.equal(trimIncompleteBlocks('כך זה נראה:\n| מצב | דוג'), 'כך זה נראה:')
    assert.equal(trimIncompleteBlocks('כך זה נראה:\n| מצב | דוגמה |\n'), 'כך זה נראה:')
  })

  it('releases it once the separator row lands', () => {
    const text = 'כך זה נראה:\n| מצב | דוגמה |\n| --- | --- |\n'
    assert.equal(trimIncompleteBlocks(text), text)
  })

  it('holds back a diagram payload rather than showing raw JSON', () => {
    assert.equal(trimIncompleteBlocks('מים בטבע:\n```yuvi-diagram\n{"kind":"cyc'), 'מים בטבע:\n')
  })

  it('leaves ordinary prose exactly as it is', () => {
    const text = 'כן, בדיוק כך.'
    assert.equal(trimIncompleteBlocks(text), text)
  })
})

describe('prose clean-ups kept away from a diagram payload', () => {
  it('rewrites the sentences and not the JSON', () => {
    const text = `לפני; אחרי\n${diagram({ kind: 'cycle', nodes: [{ label: 'א; ב' }, { label: 'ג' }] })}`
    const cleaned = mapProse(text, (segment) => segment.replace(/;[ \t]+/g, '. '))
    assert.ok(cleaned.startsWith('לפני. אחרי'))
    assert.ok(cleaned.includes('"א; ב"'))
  })
})

describe('a diagram is data, not code', () => {
  it('accepts a flow and keeps its edges', () => {
    const spec = parseDiagramSpec(JSON.stringify({
      kind: 'flow',
      nodes: [{ id: 'a', label: 'שאלה' }, { id: 'b', label: 'ניסוי' }, { id: 'c', label: 'מסקנה' }],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', label: 'תוצאה' }],
    }))
    assert.equal(spec?.kind, 'flow')
    assert.equal(spec?.edges.length, 2)
    assert.equal(spec?.edges[1].label, 'תוצאה')
  })

  it('closes a cycle from the node order, which no model has to get right', () => {
    const spec = parseDiagramSpec(JSON.stringify({
      kind: 'cycle', nodes: [{ label: 'אידוי' }, { label: 'עיבוי' }, { label: 'משקעים' }],
    }))
    assert.equal(spec?.edges.length, 3)
    assert.deepEqual(spec?.edges.map((edge) => `${edge.from}>${edge.to}`),
      ['n1>n2', 'n2>n3', 'n3>n1'])
  })

  it('renders nothing for a payload that is not JSON', () => {
    assert.equal(parseDiagramSpec('kind: flow, nodes: a -> b'), null)
  })

  it('refuses a flow that loops, because that is not a flow', () => {
    assert.equal(parseDiagramSpec(JSON.stringify({
      kind: 'flow',
      nodes: [{ id: 'a', label: 'א' }, { id: 'b', label: 'ב' }],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
    })), null)
  })

  it('refuses an edge pointing at a node that does not exist', () => {
    assert.equal(parseDiagramSpec(JSON.stringify({
      kind: 'flow',
      nodes: [{ id: 'a', label: 'א' }, { id: 'b', label: 'ב' }],
      edges: [{ from: 'a', to: 'ghost' }],
    })), null)
  })

  it('refuses a node the process never touches', () => {
    assert.equal(parseDiagramSpec(JSON.stringify({
      kind: 'flow',
      nodes: [{ id: 'a', label: 'א' }, { id: 'b', label: 'ב' }, { id: 'c', label: 'ג' }],
      edges: [{ from: 'a', to: 'b' }],
    })), null)
  })

  it('refuses an unknown kind rather than guessing at one', () => {
    assert.equal(parseDiagramSpec(JSON.stringify({
      kind: 'mindmap', nodes: [{ label: 'א' }, { label: 'ב' }],
    })), null)
  })

  it('refuses a single node, and a wall of them', () => {
    assert.equal(parseDiagramSpec(JSON.stringify({ kind: 'cycle', nodes: [{ label: 'א' }] })), null)
    assert.equal(parseDiagramSpec(JSON.stringify({
      kind: 'cycle', nodes: Array.from({ length: 20 }, (_, i) => ({ label: `n${i}` })),
    })), null)
  })

  it('drops an invalid payload from the reply without taking the sentences with it', () => {
    const blocks = parseBlocks('מים בטבע:\n```yuvi-diagram\n{"kind":"flow"}\n```\nוזה המחזור.')
    assert.deepEqual(blocks.map((b) => b.kind), ['paragraph', 'paragraph'])
  })

  it('renders a valid payload as a diagram block', () => {
    const blocks = parseBlocks(`מים בטבע:\n${diagram({
      kind: 'cycle', nodes: [{ label: 'אידוי' }, { label: 'עיבוי' }],
    })}`)
    assert.deepEqual(blocks.map((b) => b.kind), ['paragraph', 'diagram'])
  })
})

describe('where a diagram puts things', () => {
  const flow = parseDiagramSpec(JSON.stringify({
    kind: 'flow',
    nodes: [{ id: 'a', label: 'שאלה' }, { id: 'b', label: 'ניסוי' }, { id: 'c', label: 'מסקנה' }],
    edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }],
  }))!

  it('stacks a flow downward, so it fits a phone-width bubble', () => {
    const layout = layoutDiagram(flow, true)
    const [first, ...rest] = layout.nodes
    assert.ok(rest.every((node) => node.y > first.y))
  })

  it('mirrors the branch order for a right-to-left reader', () => {
    const rtl = layoutDiagram(flow, true)
    const ltr = layoutDiagram(flow, false)
    const branch = (layout: typeof rtl) => layout.nodes.filter((node) => node.id !== 'a')
    assert.notDeepEqual(branch(rtl).map((n) => n.id), branch(ltr).map((n) => n.id))
  })

  it('draws one arrow per edge and never leaves a node unplaced', () => {
    const layout = layoutDiagram(flow, false)
    assert.equal(layout.edges.length, 2)
    assert.ok(layout.edges.every((edge) => edge.head.split(' ').length === 3))
    assert.ok(layout.nodes.every((node) => node.w > 0 && node.h > 0))
  })

  it('keeps every box inside the canvas it reports', () => {
    for (const rtl of [true, false]) {
      const layout = layoutDiagram(flow, rtl)
      assert.ok(layout.nodes.every((node) =>
        node.x >= 0 && node.y >= 0
        && node.x + node.w <= layout.width && node.y + node.h <= layout.height))
    }
  })

  it('marks a Hebrew label right-to-left and an English one left-to-right', () => {
    const mixed = parseDiagramSpec(JSON.stringify({
      kind: 'cycle', nodes: [{ label: 'אידוי' }, { label: 'Condensation' }],
    }))!
    const layout = layoutDiagram(mixed, true)
    assert.deepEqual(layout.nodes.map((node) => node.rtl), [true, false])
  })
})
