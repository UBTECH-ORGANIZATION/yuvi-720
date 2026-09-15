/* Games stay on the lesson page.
 *
 * The chat's Games tab used to hand the learner off twice: "create" went to
 * the studio and "play" went to the game page. Now the studio's wizard renders
 * inline, preselected to the lesson's objective and component, and the game
 * plays in a dialog over the lesson. The other doors — the bell's deep link
 * and the studio's own shelf — still open the game page.
 *
 * React and iframes cannot run under `node --test`, so this pins the shape of
 * the change in source: which module does what, and which door goes where.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const read = (path: string) => readFileSync(join(SRC, path), 'utf8')

const tab = read('features/games/GamesTab.tsx')
const dialog = read('features/games/GameDialog.tsx')
const frame = read('features/games/GamePlayerFrame.tsx')
const player = read('features/games/GamePlayer.tsx')
const wizard = read('features/games/CreateGameWizard.tsx')
const panel = read('features/Yuvi-studio/panel/GameLabPanel.tsx')
const companion = read('components/CompanionChat.tsx')
const gamesCss = read('features/games/games.css')
const companionCss = read('components/companion.css')

test('the chat creates a game inline, preselected to the lesson, never in the studio', () => {
  assert.ok(tab.includes('<CreateGameWizard compact'), 'the tab renders the shared wizard in its compact skin')
  assert.ok(tab.includes('objective: objectiveId, component: componentId'), 'preselect carries the lesson context')
  assert.ok(!tab.includes('/yuvi-studio?station=gamelab'), 'no hand-off to the studio')
  assert.ok(!tab.includes('createHref'), 'the old studio link is gone')
})

test('one wizard serves the studio panel and the chat', () => {
  assert.ok(panel.includes("from '../../games/CreateGameWizard'"), 'the panel imports the shared wizard')
  assert.ok(!panel.includes('function CreateWizard'), 'the panel no longer keeps a private copy')
  assert.ok(wizard.includes('export function CreateGameWizard'))
  // The compact skin is a variant class, not a second component.
  assert.ok(wizard.includes("' ys-gamelab--compact'"))
  // A fixed context hides the step strip and the "back" chip, nothing else.
  assert.ok(wizard.includes('const locked = compact && fixedContext && step === 3'))
})

test('the chat plays in a dialog; the bell and the studio still open the game page', () => {
  assert.ok(tab.includes('<GameDialog'), 'play opens the dialog')
  assert.ok(tab.includes('onClick={() => setPlaying(game)}'), 'the card button opens the dialog, not a route')
  // The outside request (bell / studio event) keeps its route.
  assert.ok(tab.includes("navigate(gamePlayPath(openRequest.gameId, 'lesson'"))
  assert.ok(companion.includes("navigate(gamePlayPath(gameId, 'lesson', extra), { replace: true })"), 'the bell deep link routes to the page')
  assert.ok(panel.includes("navigate(gamePlayPath(game.game_id, 'studio'))"), 'the studio shelf routes to the page')
})

test('the dialog is modal for the keyboard as well as the eye', () => {
  assert.ok(dialog.includes('role="dialog"') && dialog.includes('aria-modal="true"'))
  assert.ok(dialog.includes("window.addEventListener('keydown', onKeyDown, true)"), 'keys are fenced at the capture phase')
  assert.ok(dialog.includes('event.stopPropagation()'), 'the lesson and companion handlers never see them')
  assert.ok(dialog.includes("event.key === 'Escape'") && dialog.includes('onCloseRef.current()'), 'Escape closes')
  assert.ok(dialog.includes("event.key === 'Tab'"), 'Tab is trapped')
  assert.ok(dialog.includes('returnFocusRef.current?.focus?.()'), 'focus goes back to the opener')
  // The close control comes first in the header: the reading start, right in RTL.
  const head = dialog.slice(dialog.indexOf('<header className="game-dialog__head">'))
  assert.ok(head.indexOf("aria-label={t('games.dialog.close')}") < head.indexOf('game-dialog__title'))
  // Yuvi's chat is not duplicated: the game page is one link away.
  assert.ok(dialog.includes("t('games.dialog.fullPage')") && dialog.includes('navigate(fullPagePath)'))
  assert.ok(tab.includes("fullPagePath={gamePlayPath(playing.game_id, 'lesson', playExtra())}"))
})

test('one frame serves the game page and the dialog', () => {
  assert.ok(frame.includes('export function GamePlayerFrame'))
  assert.ok(frame.includes('sandbox="allow-scripts allow-pointer-lock"') && frame.includes('srcDoc={html}'))
  assert.ok(frame.includes('onLoad={(event) => event.currentTarget.focus()}'), 'the frame takes the keyboard on load')
  assert.ok(frame.includes('createHostBridge('), 'the bridge lives with the frame')
  assert.ok(player.includes('<GamePlayerFrame') && !player.includes('<iframe'), 'the page hosts the frame, not its own iframe')
  assert.ok(dialog.includes('<GamePlayerFrame'))
})

test('dialog and build-strip motion is transform/opacity only, gentler under reduced motion', () => {
  const dialogCss = gamesCss.slice(gamesCss.indexOf('.game-dialog-backdrop {'))
  for (const frames of dialogCss.match(/@keyframes[^{]+\{[\s\S]*?\n\}/g) ?? []) {
    assert.ok(!/(box-shadow|filter|width|height|inset-block|background)\s*:/.test(frames), `${frames.split('{')[0].trim()} animates only transform/opacity`)
  }
  assert.ok(/prefers-reduced-motion: reduce\)[\s\S]*\.game-dialog \{\s*animation: game-dialog-fade/.test(dialogCss), 'reduced motion keeps a fade')
  const pulse = companionCss.match(/@keyframes sp-companion-pipe-pulse \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.ok(pulse.includes('transform: scale'), 'the pulse is a transform')
  assert.ok(!/(box-shadow|filter|width|height|background)\s*:/.test(pulse), 'and only a transform')
})
