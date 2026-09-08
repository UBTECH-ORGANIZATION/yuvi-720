/* The Games tab of the lesson companion.
 *
 * Games made for this component first, then the rest of the objective. A card
 * is a title, a status, the version and what it cost; Play / Edit / "report a
 * bug" appear only once the game is ready. Cards move on their own: the
 * worker's `{type:'game'}` frames land on the learner's stream and update the
 * matching card, and a frame about a game the list has never seen (one just
 * created in the studio) refetches the list.
 *
 * The player opens from three doors: a card, the studio's `yuvilab:open-game`
 * event, and the `?game=` param on the lesson route (the bell's deep link).
 * The companion turns the last two into an `openRequest` prop; this tab only
 * has to fetch the game and show it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { navigate } from '../../app/router'
import { Icon, StatusPill, type StatusTone } from '../../components/primitives'
import { subscribe } from '../../services/realtime'
import {
  getGame, isBusy, isGameFrame, listGames,
  type GameFrame, type LearnerGame,
} from '../../services/games'
import { GamePlayer, type PlayerPanel } from './GamePlayer'

export interface GameOpenRequest {
  gameId: string
  /** Bumped per request so the same game can be asked for twice in a row. */
  seq: number
}

interface GamesTabProps {
  componentId: string | null
  objectiveId: string | null
  unitId: string | null
  openRequest: GameOpenRequest | null
}

interface Playing {
  game: LearnerGame
  panel: PlayerPanel | null
}

function toneOf(game: LearnerGame): StatusTone {
  if (game.status === 'ready') return 'strong'
  if (game.status === 'failed') return 'support'
  return 'steady'
}

export function GamesTab({ componentId, objectiveId, unitId, openRequest }: GamesTabProps) {
  const { t } = useI18n()
  const [games, setGames] = useState<LearnerGame[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const [playing, setPlaying] = useState<Playing | null>(null)
  const handledRequest = useRef<number>(0)

  useEffect(() => {
    if (!componentId && !objectiveId) { setGames([]); setLoading(false); return }
    let active = true
    setLoading(true)
    setFailed(false)
    const forComponent = componentId ? listGames({ component: componentId }) : Promise.resolve({ items: [] })
    const forObjective = objectiveId ? listGames({ objective: objectiveId }) : Promise.resolve({ items: [] })
    Promise.all([forComponent, forObjective])
      .then(([mine, siblings]) => {
        if (!active) return
        const seen = new Set<string>()
        const merged: LearnerGame[] = []
        for (const game of [...mine.items, ...siblings.items]) {
          if (seen.has(game.game_id)) continue
          seen.add(game.game_id)
          merged.push(game)
        }
        setGames(merged)
      })
      .catch(() => { if (active) setFailed(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [componentId, objectiveId, reload])

  // Live cards. A frame about an unknown game is a game that did not exist
  // when the list loaded: a refetch is the honest way to learn its title.
  const knownIds = useMemo(() => new Set(games.map((game) => game.game_id)), [games])
  useEffect(() => {
    return subscribe('learner-triggers', () => '/api/agent/triggers/subscribe', (frame) => {
      if (!isGameFrame(frame)) return
      const live = frame as GameFrame
      if (!knownIds.has(live.game_id)) {
        if (live.status === 'ready' || live.status === 'failed' || live.kind) setReload((value) => value + 1)
        return
      }
      setGames((current) => current.map((game) => game.game_id === live.game_id
        ? {
            ...game,
            ...(live.status ? { status: live.status } : {}),
            ...(live.status === 'ready' && live.v > game.current_version ? { current_version: live.v } : {}),
          }
        : game))
    })
  }, [knownIds])

  const patchGame = useCallback((next: Partial<LearnerGame> & { game_id: string }) => {
    setGames((current) => current.map((game) => game.game_id === next.game_id ? { ...game, ...next } : game))
  }, [])

  // The doors that arrive as a request: the bell's deep link and the studio.
  useEffect(() => {
    if (!openRequest || openRequest.seq === handledRequest.current) return
    let active = true
    const known = games.find((game) => game.game_id === openRequest.gameId)
    if (known) { handledRequest.current = openRequest.seq; setPlaying({ game: known, panel: null }); return }
    // The request is marked handled only once the fetch lands: StrictMode
    // runs this effect twice, and marking it up front would let the first
    // run's cleanup discard the game while the second run sees "done".
    getGame(openRequest.gameId)
      .then((game) => { if (active) { handledRequest.current = openRequest.seq; setPlaying({ game, panel: null }) } })
      .catch(() => { /* a game that is not theirs, or gone — the list stands */ })
    return () => { active = false }
    // `games` is read once at request time on purpose: a later list refresh
    // must not reopen the player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest])

  const closePlayer = useCallback(() => setPlaying(null), [])

  const createHref = `/yuvi-studio?station=gamelab${objectiveId ? `&objective=${encodeURIComponent(objectiveId)}` : ''}${componentId ? `&component=${encodeURIComponent(componentId)}` : ''}${unitId ? `&unit=${encodeURIComponent(unitId)}` : ''}`

  const mine = games.filter((game) => game.component_id === componentId)
  const others = games.filter((game) => game.component_id !== componentId)

  const card = (game: LearnerGame) => {
    const busy = isBusy(game)
    const ready = game.status === 'ready'
    return (
      <article key={game.game_id} className={`sp-companion__game${busy ? ' is-busy' : ''}`} data-status={game.status}>
        <div className="sp-companion__game-head">
          <strong className="sp-companion__game-title" dir="auto">{game.title}</strong>
          <span className={`sp-companion__game-status${busy ? ' is-busy' : ''}`}>
            <StatusPill tone={toneOf(game)}>{t(`games.status.${game.status}`)}</StatusPill>
          </span>
        </div>
        <p className="sp-companion__game-meta">
          <span>{t('games.card.version', { v: game.current_version })}</span>
          <span><Icon name="spark" size={12} aria-hidden="true" />{t('games.card.sparks', { count: game.sparks_spent })}</span>
          {game.component_id !== componentId && <span dir="auto">{game.component_title}</span>}
        </p>
        {ready && (
          <div className="sp-companion__game-actions">
            <button type="button" className="sp-companion__game-btn is-primary" onClick={() => setPlaying({ game, panel: null })}>
              <Icon name="play" size={15} />
              <span>{t('games.card.play')}</span>
            </button>
            <button type="button" className="sp-companion__game-btn" onClick={() => setPlaying({ game, panel: 'edit' })}>
              <Icon name="wand" size={15} />
              <span>{t('games.card.edit')}</span>
            </button>
            <button
              type="button"
              className="sp-companion__game-btn is-quiet"
              onClick={() => setPlaying({ game, panel: 'bug' })}
              aria-label={t('games.card.bug')}
              data-tooltip={t('games.card.bug')}
            >
              <Icon name="alert" size={15} />
            </button>
          </div>
        )}
      </article>
    )
  }

  return (
    <div className="sp-companion__games" role="tabpanel">
      <div className="sp-companion__games-head">
        <h3 dir="auto">{t('games.tab.title')}</h3>
        <button type="button" className="sp-companion__games-create" onClick={() => navigate(createHref)}>
          <Icon name="plus" size={15} />
          <span>{t('games.tab.create')}</span>
        </button>
      </div>

      {loading ? (
        <p className="sp-companion__games-state" role="status">{t('games.tab.loading')}</p>
      ) : failed ? (
        <div className="sp-companion__games-state" role="alert">
          <p>{t('games.tab.error')}</p>
          <button type="button" className="sp-companion__game-btn" onClick={() => setReload((value) => value + 1)}>
            {t('games.tab.retry')}
          </button>
        </div>
      ) : games.length === 0 ? (
        <div className="sp-companion__games-state">
          <Icon name="gamepad" size={30} />
          <p dir="auto">{t('games.tab.empty')}</p>
        </div>
      ) : (
        <>
          {mine.length > 0 && <div className="sp-companion__games-list">{mine.map(card)}</div>}
          {others.length > 0 && (
            <>
              <p className="sp-companion__games-label" dir="auto">{t('games.tab.fromObjective')}</p>
              <div className="sp-companion__games-list">{others.map(card)}</div>
            </>
          )}
        </>
      )}

      {playing && (
        <GamePlayer
          key={playing.game.game_id}
          game={playing.game}
          initialPanel={playing.panel}
          onClose={closePlayer}
          onGameChange={patchGame}
        />
      )}
    </div>
  )
}
