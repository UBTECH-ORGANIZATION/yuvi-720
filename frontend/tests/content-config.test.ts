/* The committed content-intelligence config stays well-formed and answer-free.
 *
 * content/context/ is written by a nightly bot and read by the coach at
 * runtime. Two things must never slip through a bad night: a shard the loader
 * would have to guess about, and — above all — a correct answer in a world-
 * readable repo. The backend loader discards bad files defensively; this test
 * is what turns "discarded defensively" into "never merged at all".
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const configDir = join(here, '..', '..', 'content', 'context')

const SCHEMA_VERSION = 1
const TEXT_KINDS: Record<string, string[]> = {
  component: ['lesson_welcome'],
  slide: ['lesson_step_intro', 'video_summary'],
  question: ['question_intro', 'hint_l1', 'explanation'],
}
// KEYS, not substrings: vendor-authored notes legitimately mention the field
// name in prose ("correctAnswers ריק כי…"). What must never exist is a key
// that CARRIES answers — the same rule the backend's find_forbidden_key walks.
const FORBIDDEN_KEYS = new Set(['correctAnswers', 'correct_answers', 'correct'])

function findForbiddenKey(node: unknown, trail: string): string | null {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) {
      const found = findForbiddenKey(node[i], `${trail}[${i}]`)
      if (found) return found
    }
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (FORBIDDEN_KEYS.has(key)) return `${trail}.${key}`
      const found = findForbiddenKey(value, `${trail}.${key}`)
      if (found) return found
    }
  }
  return null
}

function shardPaths(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...shardPaths(path))
    else if (name.endsWith('.json') && name !== 'index.json') out.push(path)
  }
  return out
}

const hasConfig = existsSync(configDir)

test('the config exists and the index names every shard exactly once', { skip: !hasConfig }, () => {
  const index = JSON.parse(readFileSync(join(configDir, 'index.json'), 'utf8'))
  const listed = new Set(index.shards.map((s: { path: string }) => s.path))
  const onDisk = new Set(
    shardPaths(configDir).map((p) => p.slice(configDir.length + 1)),
  )
  assert.deepEqual([...listed].sort(), [...onDisk].sort())
  assert.ok(index.shards.length > 0, 'an empty index means the seed run never landed')
})

test('every shard parses, versions correctly, and completes its texts', { skip: !hasConfig }, () => {
  for (const path of shardPaths(configDir)) {
    const shard = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(shard.schema_version, SCHEMA_VERSION, path)
    for (const lomda of shard.lomdot) {
      assert.ok(lomda.component_id, path)
      assert.ok(lomda.component_fingerprint, `${path}: ${lomda.component_id}`)
      const checkTexts = (texts: Record<string, any>, allowed: string[], where: string) => {
        for (const [kind, block] of Object.entries(texts ?? {})) {
          assert.ok(allowed.includes(kind), `${where}: unknown text kind ${kind}`)
          assert.ok(block.he?.trim(), `${where}/${kind}: empty body`)
          assert.ok(block.prompt_version, `${where}/${kind}: no prompt_version`)
          assert.ok(block.source_fingerprint, `${where}/${kind}: no source_fingerprint`)
        }
      }
      checkTexts(lomda.texts, TEXT_KINDS.component, lomda.component_id)
      for (const slide of lomda.slides ?? []) {
        checkTexts(slide.texts, TEXT_KINDS.slide, `${lomda.component_id}/${slide.item_id}`)
        for (const question of slide.questions ?? []) {
          checkTexts(
            question.texts, TEXT_KINDS.question,
            `${lomda.component_id}/${slide.item_id}/${question.question_id}`,
          )
        }
      }
    }
  }
})

test('no correct-answer key exists anywhere in the committed config', { skip: !hasConfig }, () => {
  for (const path of [...shardPaths(configDir), join(configDir, 'index.json')]) {
    const found = findForbiddenKey(JSON.parse(readFileSync(path, 'utf8')), '$')
    assert.equal(found, null, `${path} carries ${found}`)
  }
})
