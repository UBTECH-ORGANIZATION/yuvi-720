/* A game deleted from the Game Lab stays deleted: the desk forgets it (so its
 * last snapshot cannot put the card back on the shelf), later polls and live
 * frames about it are ignored, and a 404 on delete means it is already gone.
 *
 *   node --test frontend/tests/
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (p: string) => readFileSync(path.join(here, '../src', p), 'utf8')
const activity = read('features/Yuvi-studio/useGameLabActivity.ts')
const panel = read('features/Yuvi-studio/panel/GameLabPanel.tsx')

describe('deleting a game from the Game Lab', () => {
  it('the desk forgets the game: snapshot, frame, phase and busy mark', () => {
    const forget = activity.slice(activity.indexOf('const forgetGame'))
    assert.match(forget, /goneRef\.current\.add\(gameId\)/)
    for (const setter of ['setSnapshots(drop)', 'setFrames(drop)', 'setPhases(drop)', 'mark(gameId, false)']) {
      assert.ok(forget.includes(setter), setter)
    }
  })

  it('news about a forgotten game is ignored', () => {
    const note = activity.slice(activity.indexOf('const noteGame'))
    assert.match(note.slice(0, 200), /if \(goneRef\.current\.has\(game\.game_id\)\) return/)
    assert.match(activity, /!isGameFrame\(frame\) \|\| goneRef\.current\.has\(frame\.game_id\)/)
  })

  it('the shelf tells the desk, and a 404 removes the card too', () => {
    const remove = panel.slice(panel.indexOf('const remove ='))
    assert.ok(remove.indexOf('activity.forgetGame(gameId)') < remove.indexOf('setGames('))
    const confirm = panel.slice(panel.indexOf('const confirmRemove'))
    assert.match(confirm, /status === 404\) \{ onDeleted\(\); return \}/)
  })
})
