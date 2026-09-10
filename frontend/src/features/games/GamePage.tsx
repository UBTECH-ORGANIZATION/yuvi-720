/* The game page: `/games/play?game=<id>&from=studio|lesson|bell`.
 *
 * One door for every way a game opens — the studio shelf, the lesson's Games
 * tab, the bell — so opening a game never detours through the lesson screen.
 * The page is a normal learner page: the app bar on top, the platform theme,
 * and the player underneath with its own back button.
 */

import { useEffect, useMemo, useState } from 'react'
import { LearnerAppBar } from '../../components/LearnerAppBar'
import { Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { navigate, useRoute } from '../../app/router'
import { getGame, type LearnerGame } from '../../services/games'
import { GamePlayer } from './GamePlayer'
import './games.css'

function readParams(route: string) {
  const params = new URLSearchParams(route.split('?')[1] ?? '')
  return {
    gameId: params.get('game') ?? '',
    from: params.get('from') ?? '',
    unit: params.get('unit') ?? '',
    component: params.get('component') ?? '',
  }
}

export function GamePage() {
  const { t } = useI18n()
  // The route, not a one-time read: the bell can open another game while a
  // game page is already up (same pathname, new query), and that must be a
  // fresh page for the new game, never the old one with a new title.
  const route = useRoute()
  const params = useMemo(() => readParams(route), [route])
  const [game, setGame] = useState<LearnerGame | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setGame(null)
    setFailed(false)
    if (!params.gameId) { setFailed(true); return }
    let active = true
    getGame(params.gameId)
      .then((row) => { if (active) setGame(row) })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [params.gameId])

  // Back goes where the kid came from. The lesson keeps its unit/component so
  // it reopens on the same screen; anything else lands on the studio shelf.
  const backTo = params.from === 'lesson' && params.unit ? 'lesson' : 'studio'
  const back = () => {
    if (backTo === 'lesson') {
      const q = new URLSearchParams({ unit: params.unit })
      if (params.component) q.set('component', params.component)
      navigate(`/learning/lesson?${q.toString()}`)
      return
    }
    navigate('/yuvi-studio?station=gamelab')
  }

  return (
    <div className="game-page">
      <LearnerAppBar />
      {game ? (
        <GamePlayer key={game.game_id} game={game} onBack={back} backTo={backTo} />
      ) : (
        <main className="game-page__state" role={failed ? 'alert' : 'status'}>
          {failed ? (
            <>
              <Icon name="alert" size={28} />
              <p>{t('games.player.loadError')}</p>
              <button type="button" className="sp-btn" onClick={back}>{t(backTo === 'lesson' ? 'games.player.backLesson' : 'games.player.back')}</button>
            </>
          ) : (
            <p>{t('games.player.loading')}</p>
          )}
        </main>
      )}
    </div>
  )
}
