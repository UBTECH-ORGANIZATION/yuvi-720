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
  gamePlayPath, gameThumbUrl, isBusy, isGameFrame, listGames,
  type GameFrame, type LearnerGame,
} from '../../services/games'

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
  /** Called once a request has opened the player, so it is not replayed. */
  onRequestHandled?: (seq: number) => void
}

function toneOf(game: LearnerGame): StatusTone {
  if (game.status === 'ready') return 'strong'
  if (game.status === 'failed') return 'support'
  return 'steady'
}

export function GamesTab({ componentId, objectiveId, unitId, openRequest, onRequestHandled }: GamesTabProps) {
  const { t } = useI18n()
  const [games, setGames] = useState<LearnerGame[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)
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

  const play = useCallback((game: LearnerGame) => {
    navigate(gamePlayPath(game.game_id, 'lesson', {
      ...(unitId ? { unit: unitId } : {}), ...(componentId ? { component: componentId } : {}),
    }))
  }, [unitId, componentId])

  // A request from outside the tab (the bell's old deep link, the studio)
  // goes to the game page too; the request is cleared so it cannot replay.
  useEffect(() => {
    if (!openRequest || openRequest.seq === handledRequest.current) return
    handledRequest.current = openRequest.seq
    onRequestHandled?.(openRequest.seq)
    navigate(gamePlayPath(openRequest.gameId, 'lesson', {
      ...(unitId ? { unit: unitId } : {}), ...(componentId ? { component: componentId } : {}),
    }))
  }, [openRequest, onRequestHandled, unitId, componentId])

  const createHref = `/yuvi-studio?station=gamelab${objectiveId ? `&objective=${encodeURIComponent(objectiveId)}` : ''}${componentId ? `&component=${encodeURIComponent(componentId)}` : ''}${unitId ? `&unit=${encodeURIComponent(unitId)}` : ''}`

  const mine = games.filter((game) => game.component_id === componentId)
  const others = games.filter((game) => game.component_id !== componentId)

  const card = (game: LearnerGame) => {
    const busy = isBusy(game)
    const ready = game.status === 'ready'
    return (
      <article key={game.game_id} className={`sp-companion__game${busy ? ' is-busy' : ''}`} data-status={game.status}>
        {game.has_thumb && (
          <img className="sp-companion__game-thumb" src={gameThumbUrl(game)} alt="" loading="lazy" />
        )}
        <div className="sp-companion__game-head">
          <strong className="sp-companion__game-title" dir="auto">{game.title}</strong>
          <span className={`sp-companion__game-status${busy ? ' is-busy' : ''}`}>
            <StatusPill tone={toneOf(game)}>{t(`games.status.${game.status}`)}</StatusPill>
          </span>
        </div>
        <p className="sp-companion__game-meta">
          <span><Icon name="spark" size={12} aria-hidden="true" />{t('games.card.sparks', { count: game.sparks_spent })}</span>
          {game.component_id !== componentId && <span dir="auto">{game.component_title}</span>}
        </p>
        {/* Changing and fixing live in the player: the card only opens it. */}
        {ready && (
          <div className="sp-companion__game-actions">
            <button type="button" className="sp-companion__game-btn is-primary" onClick={() => play(game)}>
              <Icon name="play" size={15} />
              <span>{t('games.card.play')}</span>
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

    </div>
  )
}
