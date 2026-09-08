/* Learning Game Lab client — `/api/games` (backend/app/routes/games.py).
 *
 * A game is built asynchronously: `createGame` returns immediately with a
 * queued game; progress arrives as realtime frames `{type:'game', game_id,
 * status, event?}` on the learner's SSE stream, and completion rings the bell
 * (`game_ready` / `game_failed` / `game_edit_ready` / `game_fix_ready`).
 * The played HTML is fetched with the runtime harness already injected by the
 * server; correct answers never reach the browser — `checkAnswer` grades.
 */

// Extension spelled out: `tests/game-host-bridge.test.ts` loads this module
// under `node --test`, whose type stripping resolves imports literally.
import { apiDelete, apiGet, apiPost } from './api.ts'

export type GameStatus = 'queued' | 'planning' | 'building' | 'validating' | 'fixing' | 'ready' | 'failed'
export type GameGenre = 'open' | 'shooter' | 'runner' | 'platformer' | 'puzzle' | 'boss' | 'tower' | 'surprise'
/** Flavour chips on the create step: inspiration for Yuvi, never a constraint. */
export type GameInspiration = 'shooter' | 'runner' | 'platformer' | 'puzzle' | 'boss' | 'tower' | '3d' | 'story' | 'world'
export const GAME_INSPIRATIONS: GameInspiration[] = ['3d', 'shooter', 'runner', 'platformer', 'boss', 'puzzle', 'tower', 'story', 'world']

export interface GameVersion {
  v: number
  created_at: string | null
  source: 'create' | 'edit' | 'fix'
  summary: string
  sha256: string | null
}

export interface GameJob {
  job_id: string
  kind: 'create' | 'edit' | 'fix'
  status: 'queued' | 'running' | 'done' | 'failed'
  error_class: string | null
  started_at: number | string | null
  finished_at: number | string | null
}

export interface LearnerGame {
  game_id: string
  learner_id: string
  objective_id: string
  unit_id: string
  component_id: string
  objective_title: string
  component_title: string
  title: string
  /** Yuvi's design brief for the game, in the kid's language (may be empty). */
  description?: string
  genre: GameGenre | string
  prompt: string
  language: string
  device: string
  status: GameStatus
  current_version: number
  versions: GameVersion[]
  has_thumb: boolean
  errors_last: Array<{ message?: string; errors?: unknown[] }>
  sparks_spent: number
  created_at: string | null
  updated_at: string | null
  last_job: GameJob | null
}

export interface GameListPage {
  items: LearnerGame[]
  next_cursor: string | null
}

export interface PickerComponent {
  id: string
  /** The objective this component really belongs to (a picker card may merge several). */
  objective_id: string
  unit_id: string
  unit_title: string
  title: string
  purpose: string | null
  difficulty: string | number | null
  is_assessment: boolean
  question_count: number
  visited: boolean
}

export interface PickerObjective {
  id: string
  title: string
  topic_title: string
  visited: boolean
  components: PickerComponent[]
}

export interface PickerSubject {
  subject: string
  objectives: PickerObjective[]
}

export interface CreateGameInput {
  objective_id: string
  unit_id: string
  component_id: string
  /** Optional: defaults to "open" — Yuvi picks the form. */
  genre?: GameGenre
  inspirations?: GameInspiration[]
  vibe: string
  clarifications?: Record<string, string>
  device?: 'keyboard' | 'touch'
  deep_thinking?: boolean
}

export interface RuntimeErrorReport {
  message: string
  stack?: string
  filename?: string
  line?: number
}

/** The realtime frame the worker/backend publish on `user:{learner}`. */
export interface GameFrame {
  type: 'game'
  game_id: string
  status: GameStatus | ''
  v: number
  event?: string
  kind?: string
  detail?: string
  /** `event: 'code'` — a slice of the game as Yuvi writes it, and the total so far. */
  chunk?: string
  code_len?: number
}

export function isGameFrame(frame: unknown): frame is GameFrame {
  return !!frame && typeof frame === 'object' && (frame as { type?: unknown }).type === 'game'
}

export async function listGames(params: { component?: string; objective?: string; cursor?: string | null; limit?: number } = {}): Promise<GameListPage> {
  const q = new URLSearchParams()
  if (params.component) q.set('component', params.component)
  if (params.objective) q.set('objective', params.objective)
  if (params.cursor) q.set('cursor', params.cursor)
  if (params.limit) q.set('limit', String(params.limit))
  const qs = q.toString()
  // The route answers `{games, next_cursor}`; keep the client on `items`.
  const page = await apiGet<{ games?: LearnerGame[]; items?: LearnerGame[]; next_cursor?: string | null }>(`/api/games${qs ? `?${qs}` : ''}`)
  return { items: page.items ?? page.games ?? [], next_cursor: page.next_cursor ?? null }
}

export function getGame(gameId: string) {
  return apiGet<LearnerGame>(`/api/games/${encodeURIComponent(gameId)}`)
}

export function getPicker() {
  return apiGet<{ subjects: PickerSubject[] }>('/api/games/objectives')
}

export function createGame(input: CreateGameInput) {
  return apiPost<LearnerGame>('/api/games', input)
}

/** One message from the player's chat: the change, plus any errors the frame caught. */
export function editGame(gameId: string, instruction: string, errors: RuntimeErrorReport[] = []) {
  return apiPost<{ job_id: string; status: string }>(`/api/games/${encodeURIComponent(gameId)}/edit`, { instruction, errors })
}

export function reportBug(gameId: string, errors: RuntimeErrorReport[], note = '') {
  return apiPost<{ job_id: string; status: string }>(`/api/games/${encodeURIComponent(gameId)}/report-bug`, { errors, note })
}

/** A question about the game, answered without a rebuild. */
export function askGame(gameId: string, question: string) {
  return apiPost<{ answer: string }>(`/api/games/${encodeURIComponent(gameId)}/ask`, { question })
}

/** The card's tile: the validator's screenshot of the current version. */
export function gameThumbUrl(game: Pick<LearnerGame, 'game_id' | 'current_version'>) {
  return `/api/games/${encodeURIComponent(game.game_id)}/thumb?v=${game.current_version}`
}

/** Every door to a game goes through the game page. */
export function gamePlayPath(gameId: string, from: 'studio' | 'lesson' | 'bell', extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ game: gameId, from, ...extra })
  return `/games/play?${q.toString()}`
}

export function checkAnswer(gameId: string, questionId: string, answer: string | number) {
  return apiPost<{ correct: boolean; correct_answer: string | null; feedback: string | null }>(
    `/api/games/${encodeURIComponent(gameId)}/check`, { question_id: questionId, answer },
  )
}

export function revertGame(gameId: string, v: number) {
  return apiPost<LearnerGame>(`/api/games/${encodeURIComponent(gameId)}/revert`, { v })
}

export function deleteGame(gameId: string) {
  return apiDelete<{ ok: boolean }>(`/api/games/${encodeURIComponent(gameId)}`)
}

/** URL of the served game (harness injected server-side). Same-origin, cookie auth. */
export function gameHtmlUrl(gameId: string, v?: number) {
  return `/api/games/${encodeURIComponent(gameId)}/html${v ? `?v=${v}` : ''}`
}

/** Fetch the HTML for `srcdoc` (the iframe is sandboxed without same-origin, so it cannot fetch itself). */
export async function fetchGameHtml(gameId: string, v?: number): Promise<string> {
  const res = await fetch(gameHtmlUrl(gameId, v), { credentials: 'include' })
  if (!res.ok) throw new Error(`game html ${res.status}`)
  return res.text()
}

export const GAME_BUSY_STATUSES: GameStatus[] = ['queued', 'planning', 'building', 'validating', 'fixing']

export function isBusy(game: Pick<LearnerGame, 'status'>) {
  return GAME_BUSY_STATUSES.includes(game.status)
}
