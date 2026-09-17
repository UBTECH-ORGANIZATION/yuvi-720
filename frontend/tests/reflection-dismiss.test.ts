/* A reflection the ministry heard `initialized` must hear how it ended.
 *
 *   node --test frontend/tests/
 *
 * Source-level: the panel closes an open, unsent flow from its unmount
 * cleanup — the ×, "continue", leaving the lesson all end there.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const panel = readFileSync(path.join(here, '../src/features/learning-lesson/ReflectionPanel.tsx'), 'utf8')
const agents = readFileSync(path.join(here, '../src/services/agents.ts'), 'utf8')

describe('reflection dismiss', () => {
  it('the service posts to the dismiss route', () => {
    assert.match(agents, /export function dismissReflection\(reflectionId: string\)/)
    assert.match(agents, /\/api\/agent\/reflection\/\$\{reflectionId\}\/dismiss/)
  })

  it('the panel dismisses an open, unsent flow on unmount and never after send', () => {
    assert.match(panel, /useEffect\(\(\) => \(\) => \{[\s\S]*?dismissReflection\(open\)/)
    assert.match(panel, /if \(open && !sentRef\.current\)/)
    assert.match(panel, /reflectionIdRef\.current = flow\.reflection_id/)
    // send() marks the flow as sent before it starts reporting answers.
    assert.match(panel, /setBusy\(true\)\n\s+sentRef\.current = true/)
  })
})
