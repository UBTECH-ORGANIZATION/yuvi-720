/* The Game Lab panel's pure half: ordering, merging and reading state.
 *
 * JSX-free so `node --test` can load it (`tests/game-lab-model.test.ts`), and
 * the import spells its extension out because Node's type stripping resolves
 * paths literally (see tsconfig `allowImportingTsExtensions`).
 */

import {
  GAME_BUSY_STATUSES,
  type GameFrame,
  type GameGenre,
  type GameStatus,
  type LearnerGame,
  type PickerComponent,
  type PickerObjective,
  type PickerSubject,
} from '../../../services/games.ts'

export type GameLabTab = 'mine' | 'create'

/** One glyph per genre — a tile placeholder until games carry a thumbnail. */
export const GENRE_ICONS: Record<GameGenre, string> = {
  open: '🎮',
  shooter: '🚀',
  runner: '🏃',
  platformer: '🪜',
  puzzle: '🧩',
  boss: '👾',
  tower: '🏰',
  surprise: '🎲',
}

const INSPIRATION_ICONS: Record<string, string> = { '3d': '🧊', story: '📖', world: '🗺️' }

export function genreIcon(genre: string): string {
  return GENRE_ICONS[genre as GameGenre] ?? INSPIRATION_ICONS[genre] ?? '🎮'
}

/** The kid's brief: the one real design input, so it gets room. */
export const VIBE_MAX = 600
/** The kid's own game name; the model titles the game when it is empty. */
export const TITLE_MAX = 40

export type StatusTone = 'busy' | 'ready' | 'failed'

export function statusTone(status: GameStatus | string): StatusTone {
  if (status === 'ready') return 'ready'
  if (status === 'failed') return 'failed'
  return 'busy'
}

export function isBusyStatus(status: GameStatus | string): boolean {
  return GAME_BUSY_STATUSES.includes(status as GameStatus)
}

/** Deep link from the lesson page: `?station=gamelab&objective=&component=`. */
export interface GameLabPreselect {
  open: boolean
  objective: string | null
  component: string | null
}

export function readPreselect(search: string): GameLabPreselect {
  const params = new URLSearchParams(search)
  const open = params.get('station') === 'gamelab'
  return {
    open,
    objective: open ? (params.get('objective') || null) : null,
    component: open ? (params.get('component') || null) : null,
  }
}

/**
 * Visited objectives first, the rest of the catalog after — and nothing else
 * moves: the server's own order inside each half is the curriculum order, and
 * a child scanning the list expects it to stay put between visits.
 */
export function orderObjectives(objectives: PickerObjective[]): PickerObjective[] {
  return [...objectives.filter((row) => row.visited), ...objectives.filter((row) => !row.visited)]
}

/** Same rule inside an objective: the components the learner has seen lead. */
export function orderComponents(components: PickerComponent[]): PickerComponent[] {
  return [...components.filter((row) => row.visited), ...components.filter((row) => !row.visited)]
}

export function findObjective(subjects: PickerSubject[], objectiveId: string | null): PickerObjective | null {
  if (!objectiveId) return null
  for (const subject of subjects) {
    const hit = subject.objectives.find((row) => row.id === objectiveId)
    if (hit) return hit
  }
  return null
}

export function findComponent(objective: PickerObjective | null, componentId: string | null): PickerComponent | null {
  if (!objective || !componentId) return null
  return objective.components.find((row) => row.id === componentId) ?? null
}

/** Newest first, one row per game: a created game lands on top, a refetched one replaces itself in place. */
export function upsertGame(list: LearnerGame[], game: LearnerGame): LearnerGame[] {
  const index = list.findIndex((row) => row.game_id === game.game_id)
  if (index === -1) return [game, ...list]
  const next = list.slice()
  next[index] = game
  return next
}

/** A realtime frame carries status and the step in flight, never the whole game. */
export function applyFrame(game: LearnerGame, frame: GameFrame): LearnerGame {
  if (frame.game_id !== game.game_id) return game
  const status = frame.status || game.status
  const current_version = typeof frame.v === 'number' && frame.v > game.current_version ? frame.v : game.current_version
  if (status === game.status && current_version === game.current_version) return game
  return { ...game, status, current_version }
}

/** Something learnt at a moment on this device's clock — so sources compare without server skew. */
export interface Stamped<T> { value: T; at: number }

/**
 * Fold what the studio learnt while the panel was closed — polled snapshots
 * and live frames — into the list the panel is showing.
 *
 * Order is by arrival: `freshAt` says when each row was last fetched, and
 * only what arrived after that may touch it. A snapshot is a whole game and
 * replaces the row (and becomes its fetch time); a frame only moves status.
 * Without the stamps a `building` frame that arrived before the list was
 * reloaded would drag a card that already says `ready` back to `building`.
 * A game the list has not loaded is left alone: it belongs to a page the
 * learner has not scrolled to.
 */
export function mergeUpdates(
  list: LearnerGame[],
  snapshots: Record<string, Stamped<LearnerGame>>,
  frames: Record<string, Stamped<GameFrame>>,
  freshAt: Record<string, number>,
): { list: LearnerGame[]; freshAt: Record<string, number> } {
  let changed = false
  let stamps = freshAt
  const next = list.map((game) => {
    let row = game
    let fetchedAt = freshAt[game.game_id] ?? 0
    const snapshot = snapshots[game.game_id]
    if (snapshot && snapshot.at > fetchedAt) {
      row = snapshot.value
      fetchedAt = snapshot.at
      if (stamps === freshAt) stamps = { ...freshAt }
      stamps[game.game_id] = fetchedAt
    }
    const frame = frames[game.game_id]
    if (frame && frame.at > fetchedAt) row = applyFrame(row, frame.value)
    if (row !== game) changed = true
    return row
  })
  return { list: changed ? next : list, freshAt: stamps }
}

/** The locale key for a create failure — the daily cap gets a friendly line, the rest a generic one. */
export function createErrorKey(error: unknown): string {
  const status = (error as { status?: number } | null)?.status
  if (status === 429) return 'studio.gamelab.error.cap'
  if (status === 422) return 'studio.gamelab.error.blocked'
  return 'studio.gamelab.error.create'
}
