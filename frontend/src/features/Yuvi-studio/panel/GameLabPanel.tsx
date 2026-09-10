import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import { navigate } from '../../../app/router'
import { useAuth } from '../../../providers/AuthProvider'
import {
  GAME_INSPIRATIONS, createGame, deleteGame, gamePlayPath, gameThumbUrl, getPicker, listGames,
  type GameInspiration, type LearnerGame, type PickerComponent, type PickerObjective, type PickerSubject, prepareGame } from '../../../services/games'
import { subjectLabel } from '../../teacher-app/shared/subjectLabel'
import { StationPanel } from './StationPanel'
import { SegmentedNav } from './SegmentedNav'
import {
  TITLE_MAX, VIBE_MAX, createErrorKey, findComponent, findObjective, genreIcon, isBusyStatus, mergeUpdates,
  orderComponents, orderObjectives, statusTone, upsertGame, type GameLabPreselect, type GameLabTab,
} from './gameLabModel'
import type { GameLabActivity } from '../useGameLabActivity'

/** Admin bake-off choices; empty means the deployment default. */
const GAME_MODELS = ['claude-sonnet-5', 'claude-opus-5', 'gpt-5.6-sol', 'claude-opus-4.8']

const PAGE_SIZE = 12

/**
 * The Game Lab station: the games a learner has made, and the three-step
 * wizard that makes a new one. Every game is a learning game — the wizard
 * starts from a learning component, not from a genre, and says so.
 */
export function GameLabPanel({
  onLeave, isTouch, activity, preselect,
}: {
  onLeave: () => void
  isTouch: boolean
  activity: GameLabActivity
  preselect: GameLabPreselect | null
}) {
  const { t } = useI18n()
  const [tab, setTab] = useState<GameLabTab>(preselect?.open && preselect.objective ? 'create' : 'mine')

  return (
    <StationPanel
      title={t('studio.gamelab.title')}
      closeLabel={t('YuviStudio.station.leave')}
      onClose={onLeave}
      nav={(
        <SegmentedNav<GameLabTab>
          label={t('studio.gamelab.title')}
          items={[
            { id: 'mine', label: t('studio.gamelab.tab.mine'), icon: 'gamepad' },
            { id: 'create', label: t('studio.gamelab.tab.create'), icon: 'wand' },
          ]}
          value={tab}
          onChange={setTab}
        />
      )}
    >
      {tab === 'mine'
        ? <MyGames activity={activity} onCreate={() => setTab('create')} />
        : (
          <CreateWizard
            isTouch={isTouch}
            preselect={preselect}
            onCreated={(game) => { activity.noteGame(game); setTab('mine') }}
          />
        )}
    </StationPanel>
  )
}

// ── My games ────────────────────────────────────────────────────────────────

/** The poster, with a soft shimmer until the image is in. A thumbnail that
 *  pops in late over an empty tile reads as a glitch; the shimmer says
 *  "loading" without a spinner. */
function CardThumb({ src }: { src: string }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <span className={`ys-gamelab-card__thumbwrap${loaded ? ' is-loaded' : ''}`}>
      <img className="ys-gamelab-card__thumb" src={src} alt="" loading="lazy" onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} />
    </span>
  )
}

function MyGames({ activity, onCreate }: { activity: GameLabActivity; onCreate: () => void }) {
  const { t } = useI18n()
  const [games, setGames] = useState<LearnerGame[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const loadingRef = useRef(false)
  // When each row was last fetched, so older live frames cannot overwrite it.
  const freshAt = useRef<Record<string, number>>({})
  const stamp = (rows: LearnerGame[], at: number) => { for (const row of rows) freshAt.current[row.game_id] = at }

  const load = async (after: string | null) => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setLoadError(false)
    // The request's start: anything that arrives after it is newer than the page.
    const startedAt = Date.now()
    try {
      const page = await listGames({ cursor: after, limit: PAGE_SIZE })
      stamp(page.items, startedAt)
      setGames((current) => after ? page.items.reduce(upsertGameAtEnd, current) : page.items)
      setCursor(page.next_cursor)
      for (const game of page.items) activity.noteGame(game, startedAt)
    } catch {
      setLoadError(true)
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }
  const mounted = useRef(false)
  useEffect(() => {
    if (mounted.current) return
    mounted.current = true
    void load(null)
  })

  // Whatever the desk learnt — a poll, a live frame, a game created on the
  // other tab — lands on the cards. A game newer than the top of the list goes
  // on top; one the list has not paged to yet is left for its page.
  useEffect(() => {
    setGames((current) => {
      const merged = mergeUpdates(current, activity.snapshots, activity.frames, freshAt.current)
      freshAt.current = merged.freshAt
      let next = merged.list
      const newest = next[0]?.created_at ?? ''
      for (const snapshot of Object.values(activity.snapshots)) {
        const game = snapshot.value
        if (next.some((row) => row.game_id === game.game_id)) continue
        if (newest && (game.created_at ?? '') <= newest) continue
        freshAt.current[game.game_id] = snapshot.at
        next = upsertGame(next, game)
      }
      return next
    })
  }, [activity.snapshots, activity.frames])

  const remove = (gameId: string) => setGames((current) => current.filter((row) => row.game_id !== gameId))
  const replace = (game: LearnerGame) => {
    const at = Date.now()
    freshAt.current[game.game_id] = at
    setGames((current) => upsertGame(current, game))
    activity.noteGame(game, at)
  }

  return (
    <section className="ys-section ys-gamelab">
      {/* No heading here: the tab strip above already names this view. */}
      {loadError && (
        <p className="ys-note" role="alert">
          {t('studio.gamelab.error.load')}{' '}
          <button type="button" className="ys-gamelab-link" onClick={() => void load(null)}>{t('studio.gamelab.retry')}</button>
        </p>
      )}
      {!loading && !loadError && games.length === 0 && (
        <div className="ys-gamelab-empty">
          <span className="ys-gamelab-empty__glyph" aria-hidden>🕹️</span>
          <strong>{t('studio.gamelab.empty.title')}</strong>
          <p>{t('studio.gamelab.empty.body')}</p>
          <button type="button" className="ys-btn ys-btn--primary ys-btn--sm" onClick={onCreate}>
            <Icon name="wand" size={15} />
            {t('studio.gamelab.empty.cta')}
          </button>
        </div>
      )}
      {games.length > 0 && (
        <ul className="ys-gamelab-list">
          {games.map((game) => (
            <GameCard
              key={game.game_id}
              game={game}
              event={activity.frames[game.game_id]?.value.event}
              onDeleted={() => remove(game.game_id)}
            />
          ))}
        </ul>
      )}
      {loading && games.length === 0 && <p className="ys-empty">{t('studio.gamelab.loading')}</p>}
      {cursor && (
        <button type="button" className="ys-btn ys-btn--ghost ys-btn--sm ys-gamelab-more" onClick={() => void load(cursor)} disabled={loading}>
          {t('studio.gamelab.loadMore')}
        </button>
      )}
    </section>
  )
}

/** Pagination appends; a row already on screen keeps its place. */
function upsertGameAtEnd(list: LearnerGame[], game: LearnerGame): LearnerGame[] {
  return list.some((row) => row.game_id === game.game_id) ? list : [...list, game]
}

/** A game on the shelf: its name, objective, state and cost. Changing and
 * fixing happen inside the player, so the card only plays or deletes. */
function GameCard({
  game, event, onDeleted,
}: {
  game: LearnerGame
  event: string | undefined
  onDeleted: () => void
}) {
  const { t } = useI18n()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const busy = isBusyStatus(game.status)
  const tone = statusTone(game.status)
  const playable = game.current_version > 0
  // A building game opens too: the page shows Yuvi's live console (thinking
  // pulse, then the code as it streams), which is half the fun of making one.
  const openable = playable || busy
  // Only steps with words of their own; the code stream and tool pings stay quiet.
  const stepKey = event && ['plan', 'build', 'validate', 'fix', 'judge'].includes(event) ? `games.step.${event}` : ''
  const stepLabel = stepKey ? t(stepKey) : ''

  // Straight to the game page — never through the lesson screen.
  const play = () => navigate(gamePlayPath(game.game_id, 'studio'))

  const confirmRemove = async () => {
    if (deleteBusy) return
    setDeleteBusy(true)
    try {
      await deleteGame(game.game_id)
      onDeleted()
    } catch {
      setDeleteBusy(false)
      setConfirmDelete(false)
    }
  }

  return (
    <li className={`ys-gamelab-card is-${tone}${busy ? ' is-building' : ''}`}>
      <div
        className={`ys-gamelab-card__tile${openable ? ' is-openable' : ''}`}
        onClick={openable ? play : undefined}
        role={openable ? 'button' : undefined}
        tabIndex={openable ? 0 : undefined}
        onKeyDown={openable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play() } } : undefined}
        aria-label={openable ? t(busy ? 'studio.gamelab.action.watch' : 'studio.gamelab.action.play') : undefined}
      >
        {game.has_thumb
          ? <CardThumb src={gameThumbUrl(game)} />
          : genreIcon(game.genre)}
        {/* While Yuvi builds, the tile becomes a small workshop: bars of code
            rising and a scan line, over the last thumbnail when there is one.
            The title and the rest of the card stay readable beside it. */}
        {busy && (
          <div className="ys-gamelab-build">
            <span className="ys-gamelab-build__scan" />
            <span className="ys-gamelab-build__bars">
              {[0, 1, 2, 3, 4, 5].map((n) => <i key={n} style={{ animationDelay: `${n * 0.18}s` }} />)}
            </span>
            <span className="ys-gamelab-build__icon"><Icon name="wand" size={16} /></span>
          </div>
        )}
      </div>
      <div className="ys-gamelab-card__main">
        <h3 className="ys-gamelab-card__title">
          <bdi dir="auto">{game.title || t('studio.gamelab.untitled')}</bdi>
        </h3>
        <div className="ys-gamelab-card__chips">
          {game.objective_title && (
            <span className="ys-gamelab-chip" title={t('studio.gamelab.chip.objective')}>
              <Icon name="target" size={12} />
              <bdi dir="auto">{game.objective_title}</bdi>
            </span>
          )}
        </div>
        <div className="ys-gamelab-card__meta">
          <span className={`ys-gamelab-status is-${tone}`} role="status">
            {busy && <i className="ys-gamelab-status__shimmer" aria-hidden />}
            {t(`studio.gamelab.status.${game.status}`)}
            {busy && stepLabel && <em><bdi dir="auto">{stepLabel}</bdi></em>}
          </span>
          <span className="ys-gamelab-card__stat">
            <Icon name="spark" size={12} />
            {game.sparks_spent} {t('rewards.currency')}
            <em className="ys-gamelab-card__usd">${(game.sparks_spent / 100).toFixed(2)}</em>
          </span>
        </div>
        {!confirmDelete && (
          <div className="ys-gamelab-card__actions">
            <button type="button" className="ys-btn ys-btn--primary ys-btn--sm" onClick={play} disabled={!openable}>
              <Icon name={busy ? 'eye' : 'play'} size={14} />
              {t(busy ? 'studio.gamelab.action.watch' : 'studio.gamelab.action.play')}
            </button>
            <button
              type="button"
              className="ys-btn ys-btn--ghost ys-btn--sm ys-gamelab-danger"
              onClick={() => setConfirmDelete(true)}
              aria-label={t('studio.gamelab.action.delete')}
              title={t('studio.gamelab.action.delete')}
            >
              <Icon name="trash" size={15} />
            </button>
          </div>
        )}
        {confirmDelete && (
          <div className="ys-gamelab-confirm" role="alertdialog" aria-label={t('studio.gamelab.delete.confirm')}>
            <span>{t('studio.gamelab.delete.confirm')}</span>
            <div className="ys-gamelab-confirm__actions">
              <button type="button" className="ys-btn ys-btn--primary ys-btn--sm ys-gamelab-danger-fill" onClick={() => void confirmRemove()} disabled={deleteBusy}>
                {t('studio.gamelab.delete.yes')}
              </button>
              <button type="button" className="ys-btn ys-btn--ghost ys-btn--sm" onClick={() => setConfirmDelete(false)} disabled={deleteBusy}>
                {t('studio.gamelab.delete.no')}
              </button>
            </div>
          </div>
        )}
      </div>
    </li>
  )
}

// ── Create ──────────────────────────────────────────────────────────────────

function CreateWizard({
  isTouch, preselect, onCreated,
}: {
  isTouch: boolean
  preselect: GameLabPreselect | null
  onCreated: (game: LearnerGame) => void
}) {
  const { t } = useI18n()
  const { user } = useAuth()
  // The model select is an admin's bake-off tool; the server ignores the
  // field for anyone else, so it is not even shown to them.
  const isAdmin = Boolean(user?.roles.includes('admin'))
  const [subjects, setSubjects] = useState<PickerSubject[] | null>(null)
  const [subject, setSubject] = useState<string | null>(null)
  const [pickerError, setPickerError] = useState(false)
  const [objective, setObjective] = useState<PickerObjective | null>(null)
  const [component, setComponent] = useState<PickerComponent | null>(null)
  const [inspirations, setInspirations] = useState<GameInspiration[]>([])
  const [vibe, setVibe] = useState('')
  const [name, setName] = useState('')
  const [deep, setDeep] = useState(false)
  const [model, setModel] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const preselected = useRef(false)

  useEffect(() => {
    let active = true
    setPickerError(false)
    getPicker()
      .then((result) => { if (active) setSubjects(result.subjects) })
      .catch(() => { if (active) setPickerError(true) })
    return () => { active = false }
  }, [])

  // The lesson page's "make a game for this" arrives with the objective and
  // component already chosen; land the learner on the genre step.
  useEffect(() => {
    if (!subjects || preselected.current || !preselect?.objective) return
    preselected.current = true
    const found = findObjective(subjects, preselect.objective)
    if (!found) return
    setObjective(found)
    const part = findComponent(found, preselect.component)
    if (part) { setComponent(part); prepareGame(part.id).catch(() => {}) }
  }, [subjects, preselect])

  const step = !objective ? 1 : !component ? 2 : 3
  const shownSubject = subjects?.find((row) => row.subject === subject) ?? subjects?.[0] ?? null

  const toggleInspiration = (chip: GameInspiration) => {
    setInspirations((current) => current.includes(chip) ? current.filter((c) => c !== chip) : [...current, chip])
  }

  const create = async () => {
    if (!objective || !component || creating) return
    setCreating(true)
    setCreateError(null)
    try {
      const game = await createGame({
        // A picker card may merge several catalog objectives with one title;
        // the component knows which one it belongs to.
        objective_id: component.objective_id || objective.id,
        unit_id: component.unit_id,
        component_id: component.id,
        inspirations,
        vibe: vibe.trim(),
        title: name.trim().slice(0, TITLE_MAX),
        device: isTouch ? 'touch' : 'keyboard',
        deep_thinking: deep,
        ...(isAdmin && model ? { model } : {}),
      })
      onCreated(game)
    } catch (error) {
      setCreateError(t(createErrorKey(error)))
      setCreating(false)
    }
  }

  return (
    <section className="ys-section ys-gamelab">
      <ol className="ys-gamelab-steps" aria-label={t('studio.gamelab.steps')}>
        {[1, 2, 3].map((n) => (
          <li
            key={n}
            className={n === step ? 'is-current' : n < step ? 'is-done' : ''}
            aria-current={n === step ? 'step' : undefined}
          >
            <span className="ys-gamelab-steps__n" aria-hidden>{n < step ? <Icon name="check" size={12} /> : n}</span>
            <span>{t(`studio.gamelab.step.${n}`)}</span>
          </li>
        ))}
      </ol>

      {step === 1 && (
        <>
          <h2 className="ys-section__title">{t('studio.gamelab.pick.objective')}</h2>
          {pickerError && <p className="ys-note" role="alert">{t('studio.gamelab.error.picker')}</p>}
          {!subjects && !pickerError && <p className="ys-empty">{t('studio.gamelab.loading')}</p>}
          {subjects && subjects.length === 0 && <p className="ys-empty">{t('studio.gamelab.pick.none')}</p>}
          {subjects && subjects.length > 1 && (
            <div className="ys-gamelab-subjects" role="tablist" aria-label={t('studio.gamelab.pick.subject')}>
              {subjects.map((row) => (
                <button
                  key={row.subject}
                  type="button"
                  role="tab"
                  aria-selected={row.subject === shownSubject?.subject}
                  className={`ys-chip${row.subject === shownSubject?.subject ? ' is-active' : ''}`}
                  onClick={() => setSubject(row.subject)}
                >
                  {subjectLabel(row.subject, t)}
                </button>
              ))}
            </div>
          )}
          {shownSubject && (
            <ul className="ys-gamelab-picks">
              {orderObjectives(shownSubject.objectives).map((row) => (
                <li key={row.id}>
                  <button type="button" className="ys-gamelab-pick" onClick={() => { setObjective(row); setComponent(null) }}>
                    <span className="ys-gamelab-pick__title"><bdi dir="auto">{row.title}</bdi></span>
                    {row.topic_title && <span className="ys-gamelab-pick__sub"><bdi dir="auto">{row.topic_title}</bdi></span>}
                    {row.visited && <span className="ys-gamelab-badge">{t('studio.gamelab.visited')}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {step === 2 && objective && (
        <>
          <ChosenBar
            back={() => setObjective(null)}
            backLabel={t('studio.gamelab.back.objective')}
            lines={[objective.title]}
          />
          <h2 className="ys-section__title">{t('studio.gamelab.pick.component')}</h2>
          <ul className="ys-gamelab-picks">
            {orderComponents(objective.components).map((row) => (
              <li key={row.id}>
                <button type="button" className="ys-gamelab-pick" onClick={() => { setComponent(row); prepareGame(row.id).catch(() => {}) }}>
                  <span className="ys-gamelab-pick__title"><bdi dir="auto">{row.title}</bdi></span>
                  {row.unit_title && <span className="ys-gamelab-pick__sub"><bdi dir="auto">{row.unit_title}</bdi></span>}
                  {row.purpose && <span className="ys-gamelab-pick__purpose"><bdi dir="auto">{row.purpose}</bdi></span>}
                  {row.visited && (
                    <span className="ys-gamelab-pick__foot">
                      <span className="ys-gamelab-badge">{t('studio.gamelab.visited')}</span>
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {step === 3 && objective && component && (
        <>
          <ChosenBar
            back={() => setComponent(null)}
            backLabel={t('studio.gamelab.back.component')}
            lines={[objective.title, component.title]}
          />
          <h2 className="ys-section__title">{t('studio.gamelab.pick.brief')}</h2>
          <p className="ys-gamelab-lead">{t('studio.gamelab.brief.lead')}</p>
          <div className="ys-gamelab-field ys-gamelab-field--name">
            <input
              id="ys-gamelab-name"
              className="ys-gamelab-input"
              type="text"
              maxLength={TITLE_MAX}
              value={name}
              aria-label={t('studio.gamelab.name.label')}
              placeholder={t('studio.gamelab.name.placeholder')}
              onChange={(change) => setName(change.target.value.slice(0, TITLE_MAX))}
            />
            <span className="ys-gamelab-counter" aria-live="polite">{name.length}/{TITLE_MAX}</span>
          </div>
          <div className="ys-gamelab-field">
            <textarea
              id="ys-gamelab-vibe"
              className="ys-gamelab-textarea ys-gamelab-textarea--brief"
              rows={5}
              maxLength={VIBE_MAX}
              value={vibe}
              aria-label={t('studio.gamelab.pick.brief')}
              placeholder={t('studio.gamelab.brief.placeholder')}
              onChange={(change) => setVibe(change.target.value.slice(0, VIBE_MAX))}
            />
            <span className="ys-gamelab-counter" aria-live="polite">{vibe.length}/{VIBE_MAX}</span>
          </div>

          {/* Flavour only: Yuvi owns genre, engine and form. */}
          <p className="ys-subhead">{t('studio.gamelab.inspire.label')}</p>
          <div className="ys-chips" role="group" aria-label={t('studio.gamelab.inspire.label')}>
            {GAME_INSPIRATIONS.map((id) => (
              <button
                key={id}
                type="button"
                className={`ys-chip ys-gamelab-genre${inspirations.includes(id) ? ' is-active' : ''}`}
                aria-pressed={inspirations.includes(id)}
                onClick={() => toggleInspiration(id)}
              >
                <span aria-hidden>{genreIcon(id)}</span>
                {t(`studio.gamelab.inspire.${id}`)}
              </button>
            ))}
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={deep}
            className={`ys-gamelab-switch${deep ? ' is-on' : ''}`}
            onClick={() => setDeep((on) => !on)}
          >
            <span className="ys-gamelab-switch__track" aria-hidden><span className="ys-gamelab-switch__knob" /></span>
            <span className="ys-gamelab-switch__text">
              <strong>{t('studio.gamelab.deep.label')}</strong>
              <small>{t('studio.gamelab.deep.hint')}</small>
            </span>
          </button>

          {isAdmin && (
            <label className="ys-gamelab-field">
              <span className="ys-subhead">{t('studio.gamelab.model')}</span>
              <select className="ys-gamelab-input" value={model} onChange={(change) => setModel(change.target.value)}>
                <option value="">{t('studio.gamelab.model.auto')}</option>
                {GAME_MODELS.map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
            </label>
          )}

          <p className="ys-gamelab-hint">
            <Icon name={isTouch ? 'hand' : 'chip'} size={14} />
            {t(isTouch ? 'studio.gamelab.device.touch' : 'studio.gamelab.device.keyboard')}
          </p>
          <p className="ys-gamelab-rule">
            <Icon name="lightbulb" size={14} />
            {t('studio.gamelab.rule')}
          </p>

          {createError && <p className="ys-note" role="alert">{createError}</p>}
          <button type="button" className="ys-btn ys-btn--primary ys-gamelab-create" onClick={() => void create()} disabled={creating}>
            <Icon name="wand" size={16} />
            {t(creating ? 'studio.gamelab.creating' : 'studio.gamelab.create')}
          </button>
        </>
      )}
    </section>
  )
}

/** What has been chosen so far, with one step back. */
function ChosenBar({ back, backLabel, lines }: { back: () => void; backLabel: string; lines: string[] }) {
  return (
    <div className="ys-gamelab-chosen">
      <div className="ys-gamelab-chosen__lines">
        {lines.map((line, index) => (
          <span key={index} className={index === lines.length - 1 ? 'is-last' : ''}><bdi dir="auto">{line}</bdi></span>
        ))}
      </div>
      <button type="button" className="ys-chip" onClick={back}>{backLabel}</button>
    </div>
  )
}
