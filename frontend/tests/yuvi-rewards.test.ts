/* The mapping page names a section's reward without importing the Yuvi-studio
 * asset catalog, because that catalog builds Three.js geometry and would land
 * the whole renderer on the questionnaire's critical path. The two therefore
 * have to agree by convention rather than by reference, and this guards it:
 * every phase reward must exist in the catalog, and the label key the mapping
 * page derives must be the label key the catalog declares. */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { PHASE_REWARDS, rewardLabelKey } from '../src/features/Yuvi-studio/yuviRewards.ts'

const catalogSource = readFileSync(
  fileURLToPath(new URL('../src/features/Yuvi-studio/YuviAssets.ts', import.meta.url)),
  'utf8',
)

/** id → labelKey for every entry declared in the asset catalog. */
function catalogLabelKeys(): Map<string, string> {
  const entries = new Map<string, string>()
  for (const match of catalogSource.matchAll(/id: '([^']+)'[^\n]*?labelKey: '([^']+)'/g)) {
    entries.set(match[1], match[2])
  }
  return entries
}

test('the catalog is parseable and non-trivial', () => {
  assert.ok(catalogLabelKeys().size > 10)
})

test('every phase reward is a real catalog item with a matching label key', () => {
  const catalog = catalogLabelKeys()
  for (const [partIndex, assetId] of Object.entries(PHASE_REWARDS)) {
    const declared = catalog.get(assetId)
    assert.ok(declared, `part ${partIndex} rewards '${assetId}', which is not in the catalog`)
    assert.equal(
      rewardLabelKey(assetId), declared,
      `the mapping page would name '${assetId}' with the wrong key`,
    )
  }
})

test('the derived key convention holds for the whole catalog', () => {
  for (const [id, labelKey] of catalogLabelKeys()) {
    assert.equal(rewardLabelKey(id), labelKey, `catalog item '${id}' breaks the key convention`)
  }
})
