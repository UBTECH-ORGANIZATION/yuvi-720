/* The Games tab of the lesson companion.
 *
 * Games made for this component first, then the rest of the objective. A card
 * is a title, a status, what it cost and — while Yuvi builds — the step the
 * build is at; Play appears once the game is ready. Nothing here leaves the
 * lesson: "create" opens the studio's wizard inline, already set to this
 * screen's objective and component, and Play opens the game in a dialog over
 * the lesson (GameDialog). The game page is still one link away, from the
 * dialog's header.
 *
 * Cards move on their own through the Game Lab activity feed
 * (useGameLabActivity — the same feed the studio desk reads): the worker's
 * `{type:'game'}` frames and the fallback poll land on the matching card, and
 * a frame about a game the list has never seen (one made in the studio)
 * refetches the list.
 *
 * Requests from outside the tab (the bell's old deep link, the studio's
 * `yuvilab:open-game`) still go to the game page, as before.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { navigate } from '../../app/router'
import { Icon, StatusPill, type StatusTone } from '../../components/primitives'
import { useResponsive } from '../../hooks/useResponsive'
import { gamePlayPath, gameThumbUrl, isBusy, listGames, type LearnerGame } from '../../services/games'
import { BUILD_PIPE, STAGE_ICON, mergeUpdates, upsertGame } from '../Yuvi-studio/panel/gameLabModel'
import { cardStage, useGameLabActivity } from '../Yuvi-studio/useGameLabActivity'
import { CreateGameWizard } from './CreateGameWizard'
import { GameDialog } from './GameDialog'

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
  const { isTouch } = useResponsive()
  const [games, setGames] = useState<LearnerGame[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const [view, setView] = useState<'list' | 'create'>('list')
  const [playing, setPlaying] = useState<LearnerGame | null>(null)
  const handledRequest = useRef<number>(0)
  // When each row was last fetched, so an older live frame cannot overwrite it.
  const freshAt = useRef<Record<string, number>>({})
  const activity = useGameLabActivity(Boolean(componentId || objectiveId))

  useEffect(() => {
    if (!componentId && !objectiveId) { setGames([]); setLoading(false); return }
    let active = true
    setLoading(true)
    setFailed(false)
    // The request's start: anything that arrives after it is newer than the list.
    const startedAt = Date.now()
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
          freshAt.current[game.game_id] = startedAt
          activity.noteGame(game, startedAt)
        }
        setGames(merged)
      })
      .catch(() => { if (active) setFailed(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
    // `activity.noteGame` is stable (useCallback on nothing that changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [componentId, objectiveId, reload])

  // Live cards: whatever the feed learnt lands on the matching row. A frame
  // about an unknown game is a game that did not exist when the list loaded:
  // a refetch is the honest way to learn its title.
  const unknownSeenAt = useRef(0)
  useEffect(() => {
    setGames((current) => {
      const merged = mergeUpdates(current, activity.snapshots, activity.frames, freshAt.current)
      freshAt.current = merged.freshAt
      return merged.list
    })
    let newest = unknownSeenAt.current
    let refetch = false
    for (const [gameId, frame] of Object.entries(activity.frames)) {
      if (frame.at <= unknownSeenAt.current) continue
      newest = Math.max(newest, frame.at)
      if (games.some((game) => game.game_id === gameId)) continue
      const live = frame.value
      if (live.status === 'ready' || live.status === 'failed' || live.kind) refetch = true
    }
    unknownSeenAt.current = newest
    if (refetch) setReload((value) => value + 1)
    // `games` is read, not followed: a list change alone must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity.snapshots, activity.frames])

  const playExtra = useCallback(() => ({
    ...(unitId ? { unit: unitId } : {}), ...(componentId ? { component: componentId } : {}),
  }), [unitId, componentId])

  // A request from outside the tab (the bell's old deep link, the studio)
  // goes to the game page; the request is cleared so it cannot replay.
  useEffect(() => {
    if (!openRequest || openRequest.seq === handledRequest.current) return
    handledRequest.current = openRequest.seq
    onRequestHandled?.(openRequest.seq)
    navigate(gamePlayPath(openRequest.gameId, 'lesson', playExtra()))
  }, [openRequest, onRequestHandled, playExtra])

  // The wizard's context is this screen; the chat never sends the learner to
  // the studio to pick it again.
  const preselect = { open: true, objective: objectiveId, component: componentId }
  const created = (game: LearnerGame) => {
    const at = Date.now()
    freshAt.current[game.game_id] = at
    setGames((current) => upsertGame(current, game))
    activity.noteGame(game, at)
    setView('list')
  }

  const mine = games.filter((game) => game.component_id === componentId)
  const others = games.filter((game) => game.component_id !== componentId)

  const card = (game: LearnerGame) => {
    const busy = isBusy(game)
    const ready = game.status === 'ready'
    const stage = busy ? cardStage(game, activity) : null
    const stageAt = stage ? BUILD_PIPE.indexOf(stage) : -1
    return (
      <article key={game.game_id} className={`sp-companion__game${busy ? ' is-busy' : ''}`} data-status={game.status}>
        {game.has_thumb && (
          <img className="sp-companion__game-thumb" src={gameThumbUrl(game)} alt="" loading="lazy" />
        )}
        <div className="sp-companion__game-head">
          <strong className="sp-companion__game-title" dir="auto">{game.title || t('studio.gamelab.untitled')}</strong>
          <span className={`sp-companion__game-status${busy ? ' is-busy' : ''}`}>
            <StatusPill tone={toneOf(game)}>{t(`games.status.${game.status}`)}</StatusPill>
          </span>
        </div>
        <p className="sp-companion__game-meta">
          <span><Icon name="spark" size={12} aria-hidden="true" />{t('games.card.sparks', { count: game.sparks_spent })}</span>
          {game.component_id !== componentId && <span dir="auto">{game.component_title}</span>}
        </p>
        {/* Where the build is, without words: the strip lights the step Yuvi is at. */}
        {busy && stage && (
          <ol className="sp-companion__game-pipe" aria-label={t('studio.gamelab.pipe.label')}>
            {BUILD_PIPE.map((step, i) => {
              const state = i < stageAt ? 'done' : i === stageAt ? 'now' : 'next'
              return (
                <li key={step} className={`is-${state}`} aria-current={state === 'now' ? 'step' : undefined}>
                  <i aria-hidden>{state === 'done' ? '✓' : STAGE_ICON[step]}</i>
                  <span>{t(`studio.gamelab.pipe.${step}`)}</span>
                </li>
              )
            })}
          </ol>
        )}
        {/* Changing and fixing live on the game page: the card only plays. */}
        {ready && (
          <div className="sp-companion__game-actions">
            <button type="button" className="sp-companion__game-btn is-primary" onClick={() => setPlaying(game)}>
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
        <h3 dir="auto">{t(view === 'create' ? 'games.tab.create' : 'games.tab.title')}</h3>
        {view === 'create' ? (
          <button type="button" className="sp-companion__games-create is-back" onClick={() => setView('list')}>
            <Icon name="chevronLeft" size={15} />
            <span>{t('games.tab.createBack')}</span>
          </button>
        ) : (
          <button type="button" className="sp-companion__games-create" onClick={() => setView('create')}>
            <Icon name="plus" size={15} />
            <span>{t('games.tab.create')}</span>
          </button>
        )}
      </div>

      {view === 'create' ? (
        <div className="sp-companion__wizard">
          <CreateGameWizard compact isTouch={isTouch} preselect={preselect} onCreated={created} />
        </div>
      ) : loading ? (
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
        <GameDialog
          game={playing}
          fullPagePath={gamePlayPath(playing.game_id, 'lesson', playExtra())}
          onClose={() => setPlaying(null)}
        />
      )}
    </div>
  )
}
