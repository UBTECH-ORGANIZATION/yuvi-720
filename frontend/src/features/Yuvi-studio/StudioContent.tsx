// @ts-nocheck
/* eslint-disable */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { LearnerAppBar } from '../../components/LearnerAppBar'
import { Icon } from '../../components/primitives'
import { YuviAvatar3D, type YuviPlacing } from './YuviAvatar3D'
import { assetsForSlot, getThumbnails, type YuviAsset } from './YuviAssets'
import type { YuviColors, YuviSlot, YuviVariant } from './YuviDesign'
import type { StudioDesign } from './useStudioDesign'
import { useRoomDesign } from './useRoomDesign'
import { ROOM_CATEGORIES, itemsInCategory, roomItemSpec, type RoomItemCategory } from './RoomCatalog'
import { MAX_ROOM_ITEMS, MOODS, ROOM_STYLES, WALL_STYLES } from './RoomDesign'
import '../../styles/Yuvi-studio.css'

type Tab = YuviSlot | 'colors'
const TABS: Tab[] = ['headTop', 'face', 'body', 'handR', 'back', 'colors']

/**
 * The studio is a room, not a form. Yuvi walks around it freely; standing on a
 * station is what opens that station's panel.
 */
type StudioMode = 'roam' | 'avatar' | 'room'

// Where Yuvi is sent when the learner closes a station panel — clear of every
// station ring and of the three fixed lab props.
const STEP_OFF: [number, number] = [0, 3]

// Anything the learner can recolour uses the same friendly palette.
const ITEM_TINTS = ['#7C6BFF', '#4eeef0', '#ff5d73', '#ffd166', '#5ce67e', '#ff8fd0', '#4cc9f0', '#ff7a3d', '#f3ecdd', '#9a6b40']

// Picking a category glides the lab camera to the part being edited.
const FOCUS_BY_TAB: Record<Tab, string> = {
  headTop: 'head',
  face: 'face',
  body: 'body',
  handR: 'hand',
  back: 'back',
  colors: 'full',
}

type Filter = 'all' | 'owned' | 'new' | 'special'
const FILTERS: Filter[] = ['all', 'owned', 'new', 'special']

// Locked items are real again: they are bought with sparks or earned at a
// milestone, which is the whole point of the reward loop.
const PREVIEW_ALL = false

const COLOR_OPTIONS: Record<keyof YuviColors, string[]> = {
  body: ['#F1F2FB', '#9cc1e8', '#ff9ec4', '#b5f2c9', '#ffd27a', '#c9b6ff', '#8ee6f2', '#ff8f8f', '#9ad0ff'],
  eyes: ['#4eeef0', '#7c5cff', '#ff5d73', '#ffd166', '#5ce67e', '#ff8fd0'],
  smile: ['#74f7ff', '#7c5cff', '#ff5d73', '#3fd9e0', '#ffd166', '#ff8fd0'],
  glow: ['#7C6BFF', '#3fd9e0', '#ff5d73', '#ffd166', '#aef7ff'],
}

/**
 * Presentational studio UI. `robotHidden` keeps the stage robot mounted (and
 * warming up) but invisible while the flight overlay animates onto its spot.
 */
export function StudioContent({
  studio,
  onClose,
  robotHidden = false,
}: {
  studio: StudioDesign
  onClose: () => void
  robotHidden?: boolean
}) {
  const { t } = useI18n()
  const thumbnails = useMemo(() => getThumbnails(), [])
  const [pending, setPending] = useState<YuviAsset | null>(null)
  const [purchaseError, setPurchaseError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  // Try-before-you-buy: a locked item can be worn on the stage without being
  // owned, so sparks are never spent on a guess.
  const [preview, setPreview] = useState<YuviAsset | null>(null)
  // Leaving with unsaved work is the one destructive action in the studio, so it
  // is confirmed rather than prevented.
  const [exitAsk, setExitAsk] = useState(false)
  const [exitError, setExitError] = useState(false)
  // Walking is the default state of the studio; panels are something you step
  // into, and step out of.
  const [mode, setMode] = useState<StudioMode>('roam')
  const [placing, setPlacing] = useState<YuviPlacing | null>(null)
  const roomState = useRoomDesign()
  // A stable identity: the 3D room only restyles when one of the three actually
  // changes, not on every keystroke elsewhere in the studio.
  const roomStyle = useMemo(
    () => ({ floor: roomState.room.floor, wall: roomState.room.wall, mood: roomState.room.mood }),
    [roomState.room.floor, roomState.room.wall, roomState.room.mood],
  )
  const {
    avatarRef, loaded, design, activeTab, setActiveTab, muted, setMuted, justSaved,
    saving, dirty, isLocked, equip, setVariant, setColor, reset, save,
    wallet, priceOf, buy, buying,
  } = studio

  // Unsaved work is unsaved work, whether it is a hat or a sofa.
  const anyDirty = dirty || roomState.dirty
  const busy = saving || roomState.saving
  const saveAll = async () => {
    const results = await Promise.all([
      dirty ? save() : Promise.resolve(true),
      roomState.dirty ? roomState.save() : Promise.resolve(true),
    ])
    return results.every(Boolean)
  }
  const resetAll = () => {
    setPlacing(null)
    reset()
    roomState.reset()
  }

  const requestClose = () => {
    if (anyDirty) { setExitError(false); setExitAsk(true) }
    else onClose()
  }

  /** Stepping onto a station opens it; stepping off closes it again. */
  const handleZoneChange = (zone: 'avatar' | 'room' | null) => {
    if (zone === 'avatar') {
      setPlacing(null)
      setMode('avatar')
      avatarRef.current?.focus(FOCUS_BY_TAB[activeTab])
      return
    }
    if (zone === 'room') {
      setMode('room')
      avatarRef.current?.focus('room')
      return
    }
    setPlacing(null)
    setMode('roam')
    avatarRef.current?.focus('roam')
  }
  const leaveStation = () => {
    setPlacing(null)
    avatarRef.current?.walkTo(STEP_OFF[0], STEP_OFF[1])
  }

  /** The learner clicked the floor while holding a prop. */
  const handlePlaceAt = (x: number, z: number, valid: boolean) => {
    if (!placing || !valid) return
    roomState.place(placing.kind, x, z, placing.rot ?? 0)
    setPlacing(null)
  }

  // Escape drops whatever is on the cursor before it drops the studio.
  useEffect(() => {
    if (!placing) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPlacing(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [placing])

  const clearPreview = (worn: YuviAsset | null = preview) => {
    if (!worn) return
    avatarRef.current?.equip(worn.slot, design.equipped[worn.slot] ?? null, true)
    setPreview(null)
  }
  const goToTab = (tab: Tab) => {
    clearPreview()
    setActiveTab(tab)
    setFilter('all')
    avatarRef.current?.focus(FOCUS_BY_TAB[tab])
  }

  // Frame the current category as soon as the WebGL controller is alive.
  const framedRef = useRef(false)
  useEffect(() => {
    if (!loaded || framedRef.current) return
    framedRef.current = true
    // Arriving in the room means seeing the room, not a close-up of a hat.
    const id = window.setTimeout(() => avatarRef.current?.focus('roam'), 260)
    return () => window.clearTimeout(id)
  }, [loaded, avatarRef])

  const slotAssets = activeTab === 'colors' ? [] : assetsForSlot(activeTab as YuviSlot)
  const visibleAssets = slotAssets.filter((asset) => {
    const locked = PREVIEW_ALL ? false : isLocked(asset)
    if (filter === 'owned') return !locked
    if (filter === 'new') return Boolean(asset.isNew)
    if (filter === 'special') return Boolean(asset.requirementKey)
    return true
  })

  return (
    <div className={`Yuvi-studio ys-mode-${mode}`}>
      <LearnerAppBar />
      <div className="ys-body">
        {mode === 'room' && (
          <RoomPanel
            state={roomState}
            placing={placing}
            setPlacing={setPlacing}
            onLeave={leaveStation}
            t={t}
          />
        )}
        {mode === 'avatar' && (
        <aside className="ys-drawer">
        <div className="ys-drawer__head">
          <h1>{t('YuviStudio.title')}</h1>
          <p>{t('YuviStudio.subtitle')}</p>
          <button type="button" className="ys-station-leave" onClick={leaveStation}>
            <Icon name="close" size={14} />
            <span>{t('YuviStudio.station.leave')}</span>
          </button>
          {wallet && (
            <p className="ys-wallet">
              <Icon name="spark" size={15} />
              <strong>{wallet.balance}</strong>
              <span>{t('rewards.currency')}</span>
            </p>
          )}
        </div>

        <div className="ys-tabs" role="tablist" aria-label={t('YuviStudio.title')}>
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={`ys-tab${activeTab === tab ? ' is-active' : ''}`}
              onClick={() => goToTab(tab)}
            >
              {t(`YuviStudio.tab.${tab}`)}
            </button>
          ))}
        </div>

        <div className="ys-panels">
          {activeTab === 'colors' ? (
            <ColorsPanel design={design} onPick={setColor} t={t} />
          ) : (
            <>
              <div className="ys-cat">
                <h2>{t(`YuviStudio.category.${activeTab}`)}</h2>
                <span className="ys-cat__count">
                  {t('YuviStudio.itemCount').replace('{count}', String(slotAssets.length))}
                </span>
              </div>
              <div className="ys-filters" role="group" aria-label={t(`YuviStudio.category.${activeTab}`)}>
                {FILTERS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`ys-filter${filter === key ? ' is-active' : ''}`}
                    aria-pressed={filter === key}
                    onClick={() => setFilter(key)}
                  >
                    {t(`YuviStudio.filter.${key}`)}
                  </button>
                ))}
              </div>
              {activeTab === 'headTop' && (
                <div className="ys-variant-row">
                  {(['classic', 'girl'] as YuviVariant[]).map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={`ys-variant${design.variant === v ? ' is-active' : ''}`}
                      onClick={() => setVariant(v)}
                    >
                      {t(`YuviStudio.variant.${v}`)}
                    </button>
                  ))}
                </div>
              )}
              <div className="ys-grid">
                {filter === 'all' && (
                  <Card
                    equipped={design.equipped[activeTab as YuviSlot] === null && !preview}
                    onClick={() => { clearPreview(); equip(activeTab as YuviSlot, null) }}
                    label={t('YuviStudio.none')}
                    none
                  />
                )}
                {visibleAssets.map((asset) => {
                  const locked = PREVIEW_ALL ? false : isLocked(asset)
                  const price = locked ? priceOf(asset.id) : null
                  const previewing = preview?.id === asset.id
                  return (
                    <Card
                      key={asset.id}
                      equipped={!preview && design.equipped[asset.slot] === asset.id}
                      previewing={previewing}
                      locked={locked}
                      isNew={Boolean(asset.isNew)}
                      price={price}
                      thumb={thumbnails[asset.id]}
                      label={t(asset.labelKey)}
                      tip={locked && asset.requirementKey ? t(asset.requirementKey) : undefined}
                      onClick={() => {
                        if (!locked) {
                          clearPreview()
                          return equip(asset.slot, asset.id)
                        }
                        // Locked items are worn first and paid for after — the
                        // preview bar carries the buy action.
                        clearPreview()
                        avatarRef.current?.equip(asset.slot, asset.id, true)
                        avatarRef.current?.focus(FOCUS_BY_TAB[asset.slot as Tab])
                        setPreview(asset)
                      }}
                    />
                  )
                })}
                {visibleAssets.length === 0 && filter !== 'all' && (
                  <p className="ys-empty">{t('YuviStudio.filter.empty')}</p>
                )}
              </div>
            </>
          )}
        </div>

        {preview && (
          <div className="ys-preview">
            <span className="ys-preview__tag">{t('YuviStudio.preview.tag')}</span>
            <div className="ys-preview__info">
              <strong>{t(preview.labelKey)}</strong>
              {priceOf(preview.id) !== null ? (
                <span className="ys-preview__price">
                  <Icon name="spark" size={13} />
                  {priceOf(preview.id)}
                </span>
              ) : (
                <span className="ys-preview__earn">
                  {preview.requirementKey ? t(preview.requirementKey) : ''}
                </span>
              )}
            </div>
            <div className="ys-preview__actions">
              {priceOf(preview.id) !== null && (
                <button
                  type="button"
                  className="ys-btn ys-btn--primary ys-btn--sm"
                  onClick={() => { setPurchaseError(null); setPending(preview) }}
                >
                  {t('YuviStudio.preview.buy')}
                </button>
              )}
              <button type="button" className="ys-btn ys-btn--ghost ys-btn--sm" onClick={() => clearPreview()}>
                {t('YuviStudio.preview.cancel')}
              </button>
            </div>
          </div>
        )}
      </aside>
      )}

      <section className="ys-stage">
        <div className="ys-stage__backdrop" aria-hidden />
        <div className={`ys-stage__canvas${robotHidden ? ' is-flight-hidden' : ''}`}>
          {loaded && (
            <YuviAvatar3D
              ref={avatarRef}
              initialDesign={design}
              muted={muted}
              orbit
              stage
              roam
              onZoneChange={handleZoneChange}
              roomItems={roomState.items}
              roomStyle={roomStyle}
              placing={placing}
              onPlaceAt={handlePlaceAt}
              lockRoam={mode !== 'roam'}
              label={t('YuviStudio.avatarAlt')}
            />
          )}
        </div>
        <div className="ys-hint">
          {justSaved || roomState.justSaved
            ? t('YuviStudio.saved')
            : placing
              ? t('YuviStudio.room.placeHint')
              : mode === 'roam'
                ? t('YuviStudio.roam.hint')
                : t('YuviStudio.hint')}
        </div>
        {mode === 'roam' && (
          // Two doors, always visible: dress Yuvi, or build the room.
          <div className="ys-stations">
            <button type="button" className="ys-station" onClick={() => avatarRef.current?.recenter()}>
              <Icon name="spark" size={16} />
              <span>{t('YuviStudio.zone.avatar')}</span>
            </button>
            <button type="button" className="ys-station" onClick={() => avatarRef.current?.walkTo(-2.2, 2.4)}>
              <Icon name="home" size={16} />
              <span>{t('YuviStudio.zone.room')}</span>
            </button>
          </div>
        )}
        {/* Leaving the studio is a top-level action, so it gets its own solid
           button at the top of the bay instead of hiding at the end of a row
           of ghost buttons where learners could not find it. */}
        <button type="button" className="ys-exit" onClick={requestClose} disabled={busy}>
          <Icon name="close" size={16} />
          <span>{t('YuviStudio.back')}</span>
        </button>
        <div className="ys-toolbar">
          <button type="button" className="ys-btn ys-btn--primary" onClick={saveAll} disabled={busy}>{t('YuviStudio.save')}</button>
          <button type="button" className="ys-btn ys-btn--ghost" onClick={resetAll} disabled={busy}>{t('YuviStudio.reset')}</button>
          <button type="button" className="ys-btn ys-btn--mute" onClick={() => setMuted((m) => !m)}>
            {muted ? t('YuviStudio.sound.off') : t('YuviStudio.sound.on')}
          </button>
        </div>
      </section>
      </div>
      {pending && (
        <PurchaseDialog
          asset={pending}
          price={priceOf(pending.id) ?? 0}
          balance={wallet?.balance ?? 0}
          busy={buying === pending.id}
          error={purchaseError}
          thumb={thumbnails[pending.id]}
          t={t}
          onCancel={() => { setPending(null); setPurchaseError(null) }}
          onConfirm={async () => {
            const result = await buy(pending.id)
            if (result?.ok) {
              setPreview(null)
              equip(pending.slot, pending.id)
              setPending(null)
              return
            }
            setPurchaseError(result?.reason ?? 'unlock_failed')
          }}
        />
      )}
      {exitAsk && (
        <div className="ys-shop-backdrop" role="presentation" onClick={() => setExitAsk(false)}>
          <div
            className="ys-shop ys-shop--confirm"
            role="alertdialog"
            aria-modal="true"
            aria-label={t('YuviStudio.exit.title')}
            onClick={(event) => event.stopPropagation()}
          >
            <h2>{t('YuviStudio.exit.title')}</h2>
            <p className="ys-shop__balance">{t('YuviStudio.exit.body')}</p>
            {exitError && <p className="ys-shop__hint">{t('YuviStudio.exit.error')}</p>}
            <div className="ys-shop__actions">
              <button
                type="button"
                className="ys-btn ys-btn--primary"
                disabled={busy}
                onClick={async () => {
                  const ok = await saveAll()
                  if (ok) { setExitAsk(false); onClose() }
                  else setExitError(true)
                }}
              >
                {t('YuviStudio.exit.save')}
              </button>
              <button
                type="button"
                className="ys-btn ys-btn--ghost"
                disabled={saving}
                onClick={() => { setExitAsk(false); onClose() }}
              >
                {t('YuviStudio.exit.discard')}
              </button>
            </div>
            <button
              type="button"
              className="ys-btn ys-btn--ghost ys-btn--sm ys-shop__stay"
              onClick={() => setExitAsk(false)}
            >
              {t('YuviStudio.exit.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* Buying is deliberately a two-step, confirmed action: sparks are scarce and a
   mis-tap should never spend a week of effort. */
function PurchaseDialog({
  asset, price, balance, busy, error, thumb, t, onCancel, onConfirm,
}: {
  asset: YuviAsset
  price: number
  balance: number
  busy: boolean
  error: string | null
  thumb?: string
  t: (key: string) => string
  onCancel: () => void
  onConfirm: () => void
}) {
  const missing = Math.max(0, price - balance)
  const affordable = missing === 0
  return (
    <div className="ys-shop-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="ys-shop"
        role="dialog"
        aria-modal="true"
        aria-label={t('rewards.shop.title')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ys-shop__item">
          {thumb && <img src={thumb} alt="" />}
          <div>
            <h2>{t(asset.labelKey)}</h2>
            <p className="ys-shop__price">
              <Icon name="spark" size={14} />
              <strong>{price}</strong>
              <span>{t('rewards.currency')}</span>
            </p>
          </div>
        </div>
        <p className="ys-shop__balance">
          {t('rewards.shop.balance').replace('{count}', String(balance))}
        </p>
        {!affordable && (
          <p className="ys-shop__hint">
            {t('rewards.shop.missing').replace('{count}', String(missing))}
          </p>
        )}
        {error && error !== 'insufficient' && (
          <p className="ys-shop__hint">{t(`rewards.shop.error.${error}`)}</p>
        )}
        <div className="ys-shop__actions">
          <button
            type="button"
            className="ys-btn ys-btn--primary"
            disabled={!affordable || busy}
            onClick={onConfirm}
          >
            {t('rewards.shop.confirm')}
          </button>
          <button type="button" className="ys-btn ys-btn--ghost" onClick={onCancel} disabled={busy}>
            {t('rewards.shop.cancel')}
          </button>
        </div>
        <p className="ys-shop__earn">{t('rewards.shop.howToEarn')}</p>
      </div>
    </div>
  )
}

function Card({
  equipped, previewing, locked, isNew, price, thumb, label, tip, none, onClick,
}: {
  equipped?: boolean
  previewing?: boolean
  locked?: boolean
  isNew?: boolean
  price?: number | null
  thumb?: string
  label: string
  tip?: string
  none?: boolean
  onClick: () => void
}) {
  const buyable = Boolean(locked) && typeof price === 'number'
  const classes = [
    'ys-card',
    equipped ? 'is-equipped' : '',
    previewing ? 'is-previewing' : '',
    locked ? 'is-locked' : '',
    buyable ? 'is-buyable' : '',
  ].filter(Boolean).join(' ')
  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      aria-pressed={equipped}
      disabled={Boolean(locked) && !buyable && !tip}
    >
      <span className="ys-card__thumb">
        {none ? <span className="ys-card__none" /> : thumb ? <img src={thumb} alt={label} /> : <span className="ys-card__none" />}
      </span>
      <span className="ys-card__label">{label}</span>
      {equipped && <span className="ys-card__check" aria-hidden><Icon name="check" size={12} /></span>}
      {isNew && !locked && !equipped && <span className="ys-card__new" aria-hidden />}
      {buyable && (
        <span className="ys-card__price">
          <Icon name="spark" size={13} />
          {price}
        </span>
      )}
      {locked && !buyable && <span className="ys-card__lock" aria-hidden><Icon name="lock" size={13} /></span>}
      {locked && !buyable && tip && <span className="ys-card__tip" role="tooltip">{tip}</span>}
    </button>
  )
}

function ColorsPanel({
  design, onPick, t,
}: {
  design: import('./YuviDesign').YuviDesign
  onPick: (key: keyof YuviColors, hex: string) => void
  t: (key: string) => string
}) {
  return (
    <>
      {(Object.keys(COLOR_OPTIONS) as (keyof YuviColors)[]).map((key) => (
        <div key={key} className="ys-swatch-group">
          <h3>{t(`YuviStudio.color.${key}`)}</h3>
          <div className="ys-swatches">
            {COLOR_OPTIONS[key].map((hex) => (
              <button
                key={hex}
                type="button"
                aria-label={hex}
                className={`ys-swatch${design.colors[key].toLowerCase() === hex.toLowerCase() ? ' is-active' : ''}`}
                style={{ background: hex }}
                onClick={() => onPick(key, hex)}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

/**
 * The room-building station. Pick a prop, drop it on the floor, then keep
 * adjusting it — the room is the learner's, so nothing here is one-shot.
 */
function RoomPanel({
  state, placing, setPlacing, onLeave, t,
}: {
  state: import('./useRoomDesign').RoomDesignState
  placing: YuviPlacing | null
  setPlacing: (next: YuviPlacing | null) => void
  onLeave: () => void
  t: (key: string) => string
}) {
  const [category, setCategory] = useState<RoomItemCategory>('seating')
  const { room, items, full, selected, setSelectedUid } = state
  const selectedSpec = selected ? roomItemSpec(selected.kind) : null

  const pick = (kind: string) => {
    if (full) return
    const spec = roomItemSpec(kind)
    if (!spec) return
    setSelectedUid(null)
    setPlacing({ kind, tint: spec.tintable ? spec.tint : undefined, rot: 0 })
  }
  const spinGhost = (delta: number) => {
    if (!placing) return
    setPlacing({ ...placing, rot: (placing.rot ?? 0) + delta })
  }

  return (
    <aside className="ys-drawer ys-drawer--room">
      <div className="ys-drawer__head">
        <h1>{t('YuviStudio.room.title')}</h1>
        <p>{t('YuviStudio.room.subtitle')}</p>
        <button type="button" className="ys-station-leave" onClick={onLeave}>
          <Icon name="close" size={14} />
          <span>{t('YuviStudio.station.leave')}</span>
        </button>
      </div>

      <div className="ys-tabs ys-tabs--room" role="tablist" aria-label={t('YuviStudio.room.title')}>
        {ROOM_CATEGORIES.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={category === id}
            className={`ys-tab${category === id ? ' is-active' : ''}`}
            onClick={() => setCategory(id)}
          >
            {t(`YuviStudio.room.category.${id}`)}
          </button>
        ))}
      </div>

      <div className="ys-panels">
        <div className="ys-cat">
          <h2>{t(`YuviStudio.room.category.${category}`)}</h2>
          <span className="ys-cat__count">
            {t('YuviStudio.room.count')
              .replace('{count}', String(items.length))
              .replace('{max}', String(MAX_ROOM_ITEMS))}
          </span>
        </div>

        {full && <p className="ys-room-note">{t('YuviStudio.room.full')}</p>}

        <div className="ys-room-grid">
          {itemsInCategory(category).map((spec) => (
            <button
              key={spec.id}
              type="button"
              className={`ys-room-card${placing?.kind === spec.id ? ' is-active' : ''}`}
              disabled={full}
              onClick={() => pick(spec.id)}
            >
              <span className="ys-room-card__dot" style={{ background: spec.tint ?? 'var(--ys-accent, #7C6BFF)' }} />
              <span className="ys-room-card__name">{t(`YuviStudio.room.item.${spec.id}`)}</span>
            </button>
          ))}
        </div>

        {/* Style is the fastest way to make the room feel like yours, so it
           lives in the same panel as the props rather than behind a setting. */}
        <div className="ys-room-style">
          <div className="ys-swatch-group">
            <h3>{t('YuviStudio.room.floor')}</h3>
            <div className="ys-room-chips">
              {ROOM_STYLES.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`ys-room-chip${room.floor === id ? ' is-active' : ''}`}
                  onClick={() => state.setFloor(id)}
                >
                  {t(`YuviStudio.room.floor.${id}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="ys-swatch-group">
            <h3>{t('YuviStudio.room.wall')}</h3>
            <div className="ys-room-chips">
              {WALL_STYLES.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`ys-room-chip${room.wall === id ? ' is-active' : ''}`}
                  onClick={() => state.setWall(id)}
                >
                  {t(`YuviStudio.room.wall.${id}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="ys-swatch-group">
            <h3>{t('YuviStudio.room.mood')}</h3>
            <div className="ys-room-chips">
              {MOODS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`ys-room-chip${room.mood === id ? ' is-active' : ''}`}
                  onClick={() => state.setMood(id)}
                >
                  {t(`YuviStudio.room.mood.${id}`)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {items.length > 0 && (
          <div className="ys-room-list">
            <h3>{t('YuviStudio.room.placed')}</h3>
            <div className="ys-room-chips">
              {items.map((item) => (
                <button
                  key={item.uid}
                  type="button"
                  className={`ys-room-chip${selected?.uid === item.uid ? ' is-active' : ''}`}
                  onClick={() => { setPlacing(null); setSelectedUid(item.uid) }}
                >
                  {t(`YuviStudio.room.item.${item.kind}`)}
                </button>
              ))}
            </div>
            <button type="button" className="ys-btn ys-btn--ghost ys-btn--sm" onClick={state.clear}>
              {t('YuviStudio.room.clear')}
            </button>
          </div>
        )}
      </div>

      {placing && (
        <div className="ys-preview">
          <span className="ys-preview__tag">{t('YuviStudio.room.placing')}</span>
          <div className="ys-preview__info">
            <strong>{t(`YuviStudio.room.item.${placing.kind}`)}</strong>
            <span className="ys-preview__earn">{t('YuviStudio.room.placeHint')}</span>
          </div>
          <div className="ys-preview__actions">
            <button type="button" className="ys-btn ys-btn--ghost ys-btn--sm" onClick={() => spinGhost(Math.PI / 8)}>
              {t('YuviStudio.room.rotate')}
            </button>
            <button type="button" className="ys-btn ys-btn--ghost ys-btn--sm" onClick={() => setPlacing(null)}>
              {t('YuviStudio.room.cancel')}
            </button>
          </div>
        </div>
      )}

      {selected && !placing && (
        <div className="ys-preview">
          <span className="ys-preview__tag">{t('YuviStudio.room.selected')}</span>
          <div className="ys-preview__info">
            <strong>{t(`YuviStudio.room.item.${selected.kind}`)}</strong>
            {selectedSpec?.tintable && (
              <div className="ys-swatches">
                {ITEM_TINTS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    aria-label={hex}
                    className={`ys-swatch${(selected.tint ?? '').toLowerCase() === hex.toLowerCase() ? ' is-active' : ''}`}
                    style={{ background: hex }}
                    onClick={() => state.tint(selected.uid, hex)}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="ys-preview__actions">
            <button type="button" className="ys-btn ys-btn--ghost ys-btn--sm" onClick={() => state.rotate(selected.uid, Math.PI / 8)}>
              {t('YuviStudio.room.rotate')}
            </button>
            <button type="button" className="ys-btn ys-btn--ghost ys-btn--sm" onClick={() => state.remove(selected.uid)}>
              {t('YuviStudio.room.remove')}
            </button>
            <button type="button" className="ys-btn ys-btn--ghost ys-btn--sm" onClick={() => setSelectedUid(null)}>
              {t('YuviStudio.room.done')}
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
