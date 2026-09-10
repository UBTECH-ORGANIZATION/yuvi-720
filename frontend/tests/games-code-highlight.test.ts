/* The build console's tokenizer: html, then css inside <style>, then js
   inside <script>, each line coloured by the mode the tags put it in. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { highlightLines } from '../src/features/games/codeHighlight.ts'

const kinds = (tokens: [string, string][]) => tokens.filter((t) => t[0] !== 'txt').map((t) => t[0])

test('html tags, attributes and strings', () => {
  const [row] = highlightLines('<div class="hud" id=\'top\'>')
  assert.deepEqual(kinds(row), ['tag', 'attr', 'str', 'attr', 'str', 'tag'])
})

test('style block switches to css and back', () => {
  const rows = highlightLines('<style>\n.hud{color:#fff;width:12px}\n</style>\n<p>hi</p>')
  assert.deepEqual(kinds(rows[1]), ['tag', 'punct', 'attr', 'punct', 'num', 'punct', 'attr', 'punct', 'num', 'punct'])
  assert.deepEqual(kinds(rows[3]), ['tag', 'tag', 'tag', 'tag'])
})

test('script block colours keywords, strings, numbers, comments and calls', () => {
  const rows = highlightLines('<script>\nconst n = say("hi", 3) // go\n</script>')
  assert.deepEqual(kinds(rows[1]), ['kw', 'punct', 'fn', 'punct', 'str', 'punct', 'num', 'punct', 'cmt'])
})

test('a partial last line still renders', () => {
  const rows = highlightLines('<script>\nlet s = "unterminated')
  assert.equal(rows.length, 2)
  assert.deepEqual(kinds(rows[1]), ['kw', 'punct', 'str'])
})
