import { useCallback, useEffect, useRef, useState } from 'react'
import { getGame, isBusy, isGameFrame, listGames, type GameFrame, type LearnerGame } from '../../services/games'
import { subscribe } from '../../services/realtime'
import type { Stamped } from './panel/gameLabModel'
import type { GameLabState } from './YuviLabRoom'

/**
 * What the Game Lab desk knows while the studio is open, panel or no panel.
 *
 * A game takes minutes to build and the child walks away from the desk long
 * before it is done, so the desk itself has to carry the news: the logo pulses
 * while anything is building and flashes when something finishes. The panel
 * reads the same feed, which is how a card updates inline without owning a
 * second stream.
 *
 * Sources, in order of trust: the learner's realtime stream (the worker
 * publishes `{type:'game'}` frames as it goes), a 15 s poll of every game we
 * believe is busy (the fallback when a frame is missed), and whatever the
 * panel reports through `noteGame` after it created or refetched a game.
 */
export interface GameLabActivity {
  state: GameLabState
  /** Bumps once per completed build — the desk flashes on each bump. */
  flashKey: number
  /** Whole games learnt from polls and from the panel, keyed by id, stamped with arrival time. */
  snapshots: Record<string, Stamped<LearnerGame>>
  /** The latest live frame per game, keyed by id, stamped with arrival time. */
  frames: Record<string, Stamped<GameFrame>>
  busyIds: string[]
  /** `at`: when the game was fetched (defaults to now) — a page's request start, for a list. */
  noteGame: (game: LearnerGame, at?: number) => void
}

const POLL_MS = 15_000

export function useGameLabActivity(enabled: boolean): GameLabActivity {
  const [busyIds, setBusyIds] = useState<string[]>([])
  const [snapshots, setSnapshots] = useState<Record<string, Stamped<LearnerGame>>>({})
  const [frames, setFrames] = useState<Record<string, Stamped<GameFrame>>>({})
  const [flashKey, setFlashKey] = useState(0)
  const busyRef = useRef(new Set<string>())

  const mark = useCallback((gameId: string, busy: boolean) => {
    const has = busyRef.current.has(gameId)
    if (busy === has) return
    if (busy) busyRef.current.add(gameId)
    else busyRef.current.delete(gameId)
    setBusyIds([...busyRef.current])
  }, [])

  const noteGame = useCallback((game: LearnerGame, at: number = Date.now()) => {
    const wasBusy = busyRef.current.has(game.game_id)
    setSnapshots((current) => {
      const known = current[game.game_id]
      return known && known.at > at ? current : { ...current, [game.game_id]: { value: game, at } }
    })
    const busy = isBusy(game)
    mark(game.game_id, busy)
    if (wasBusy && !busy && game.status === 'ready') setFlashKey((key) => key + 1)
  }, [mark])

  // Seed: a build started on a previous visit should already be pulsing.
  useEffect(() => {
    if (!enabled) return
    let active = true
    listGames({ limit: 20 })
      .then((page) => {
        if (!active) return
        for (const game of page.items) if (isBusy(game)) mark(game.game_id, true)
      })
      .catch(() => { /* the desk simply idles until a frame or the panel says otherwise */ })
    return () => { active = false }
  }, [enabled, mark])

  // Live frames share the learner's one stream with the bell.
  useEffect(() => {
    if (!enabled) return
    return subscribe('learner-triggers', () => '/api/agent/triggers/subscribe', (frame) => {
      if (!isGameFrame(frame)) return
      setFrames((current) => ({ ...current, [frame.game_id]: { value: frame, at: Date.now() } }))
      if (!frame.status) return
      const busy = isBusy({ status: frame.status })
      mark(frame.game_id, busy)
      // A ready frame is a completion whether or not we were tracking the build.
      if (frame.status === 'ready') setFlashKey((key) => key + 1)
    })
  }, [enabled, mark])

  // Fallback poll for the games we believe are busy.
  useEffect(() => {
    if (!enabled || busyIds.length === 0) return
    const tick = async () => {
      for (const gameId of [...busyRef.current]) {
        try {
          noteGame(await getGame(gameId))
        } catch (error) {
          // Gone (deleted elsewhere) is an answer; anything else waits for the next tick.
          if ((error as { status?: number }).status === 404) mark(gameId, false)
        }
      }
    }
    const id = window.setInterval(() => { void tick() }, POLL_MS)
    return () => window.clearInterval(id)
  }, [enabled, busyIds.length, noteGame, mark])

  return {
    state: busyIds.length ? 'building' : 'idle',
    flashKey,
    snapshots,
    frames,
    busyIds,
    noteGame,
  }
}
