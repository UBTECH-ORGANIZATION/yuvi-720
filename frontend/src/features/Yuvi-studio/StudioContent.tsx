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
import { MAX_ROOM_ITEMS, MOODS, ROOM_STYLES, WALL_STYLES, type StationId } from './RoomDesign'
import { roomStandingSpot } from './YuviLabRoom'
import { StationPanel } from './panel/StationPanel'
import { SegmentedNav } from './panel/SegmentedNav'
import { ItemCard } from './panel/ItemCard'
import { ContextBar } from './panel/ContextBar'
import { PropMenu, type PropMenuState } from './panel/PropMenu'
import '../../styles/Yuvi-studio.css'

type Tab = YuviSlot | 'colors'
const TABS: Tab[] = ['headTop', 'face', 'body', 'handR', 'back', 'colors']
const TAB_ICONS: Record<Tab, string> = {
  headTop: 'hat', face: 'face', body: 'shirt', handR: 'hand', back: 'backpack', colors: 'palette',
}
const ROOM_ICONS: Record<RoomItemCategory, string> = {
  seating: 'sofa', desk: 'book', play: 'gamepad', nature: 'leaf',
  light: 'lightbulb', tech: 'chip', wall: 'image',
}

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
  // Right-clicking a prop opens its own menu over it, Sims-style.
  const [propMenu, setPropMenu] = useState<PropMenuState | null>(null)
  const roomState = useRoomDesign()
  // A stable identity: the 3D room only restyles when one of the three actually
  // changes, not on every keystroke elsewhere in the studio.
  const roomStyle = useMemo(
    () => ({ floor: roomState.room.floor, wall: roomState.room.wall, mood: roomState.room.mood }),
    [roomState.room.floor, roomState.room.wall, roomState.room.mood],
  )
  // A prop being carried is drawn as the ghost under the cursor, so the room
  // must not also draw it standing at the spot it is being moved from.
  const movingUid = placing?.uid ?? null
  const visibleRoomItems = useMemo(
    () => (movingUid ? roomState.items.filter((item) => item.uid !== movingUid) : roomState.items),
    [roomState.items, movingUid],
  )
  const menuItem = propMenu ? roomState.items.find((item) => item.uid === propMenu.uid) ?? null : null
  // Stations are addressed through the same menu, under a reserved uid.
  const menuStation: StationId | null = propMenu?.uid.startsWith('station:')
    ? (propMenu.uid.slice(8) as StationId)
    : null
  const {
    avatarRef, loaded, design, activeTab, setActiveTab, muted, setMuted, justSaved,
    saving, dirty, isLocked, equip, setVariant, setColor, reset, save,
    wallet, priceOf, buy, buying,
  } = studio

  // Unsaved work is unsaved work, whether it is a hat or a sofa.
  const anyDirty = dirty || roomState.dirty
  const busy = saving || roomState.saving
  const savedNow = justSaved || roomState.justSaved
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
    setPropMenu(null)
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
    setPropMenu(null)
    avatarRef.current?.walkTo(STEP_OFF[0], STEP_OFF[1])
  }

  /** The learner clicked the floor while holding a prop. */
  const handlePlaceAt = (x: number, z: number, valid: boolean) => {
    if (!placing || !valid) return
    if (placing.station) {
      roomState.moveStation(placing.station, x, z)
    } else if (placing.uid) {
      // Putting a carried prop back down: it keeps whatever rotation it was
      // spun to while it was in the air.
      roomState.move(placing.uid, x, z)
      if (placing.rot !== placing.rot0) roomState.rotate(placing.uid, (placing.rot ?? 0) - (placing.rot0 ?? 0))
      roomState.setSelectedUid(placing.uid)
    } else {
      roomState.place(placing.kind, x, z, placing.rot ?? 0)
    }
    setPlacing(null)
  }

  /** "Move" on the prop menu picks the prop — or the whole station — up. */
  const startMove = (uid: string) => {
    setPropMenu(null)
    if (uid.startsWith('station:')) {
      setPlacing({ kind: uid, station: uid.slice(8) as StationId, rot: 0, rot0: 0 })
      return
    }
    const item = roomState.items.find((entry) => entry.uid === uid)
    if (!item) return
    roomState.setSelectedUid(null)
    setPlacing({ kind: item.kind, tint: item.tint, rot: item.rot, rot0: item.rot, uid })
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

  // Save sits with the thing it saves, so both stations share one footer.
  const panelFooter = (
    <>
      <span className={`ys-panel__state${savedNow ? ' is-saved' : anyDirty ? ' is-dirty' : ''}`}>
        {savedNow ? t('YuviStudio.saved') : anyDirty ? t('YuviStudio.unsaved') : t('YuviStudio.allSaved')}
      </span>
      <button type="button" className="ys-btn ys-btn--primary ys-btn--sm" onClick={saveAll} disabled={busy || !anyDirty}>
        {t('YuviStudio.save')}
      </button>
      <button type="button" className="ys-btn ys-btn--ghost ys-btn--sm" onClick={resetAll} disabled={busy}>
        {t('YuviStudio.reset')}
      </button>
    </>
  )

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
            footer={panelFooter}
            t={t}
          />
        )}
        {mode === 'avatar' && (
          <StationPanel
            title={t('YuviStudio.title')}
            closeLabel={t('YuviStudio.station.leave')}
            onClose={leaveStation}
            wallet={wallet && (
              <p className="ys-wallet">
                <Icon name="spark" size={15} />
                <strong>{wallet.balance}</strong>
                <span>{t('rewards.currency')}</span>
              </p>
            )}
            nav={(
              <SegmentedNav
                label={t('YuviStudio.title')}
                items={TABS.map((tab) => ({ id: tab, label: t(`YuviStudio.tab.${tab}`), icon: TAB_ICONS[tab] }))}
                value={activeTab as Tab}
                onChange={goToTab}
              />
            )}
            context={preview && (
              <ContextBar
                tag={t('YuviStudio.preview.tag')}
                title={t(preview.labelKey)}
                note={priceOf(preview.id) === null && preview.requirementKey ? t(preview.requirementKey) : undefined}
                aside={priceOf(preview.id) !== null && (
                  <span className="ys-ctx__price">
                    <Icon name="spark" size={13} />
                    {priceOf(preview.id)}
                  </span>
                )}
                actions={(
                  <>
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
                  </>
                )}
              />
            )}
            footer={panelFooter}
          >
            {activeTab === 'colors' ? (
              <ColorsPanel design={design} onPick={setColor} t={t} />
            ) : (
              <>
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
                <section className="ys-section">
                  <div className="ys-section__head">
                    <h2 className="ys-section__title">{t(`YuviStudio.category.${activeTab}`)}</h2>
                    <span className="ys-section__count">
                      {t('YuviStudio.itemCount').replace('{count}', String(slotAssets.length))}
                    </span>
                  </div>
                  <div className="ys-toggles" role="group" aria-label={t(`YuviStudio.category.${activeTab}`)}>
                    {FILTERS.map((key) => (
                      <button
                        key={key}
                        type="button"
                        className={`ys-toggle${filter === key ? ' is-active' : ''}`}
                        aria-pressed={filter === key}
                        onClick={() => setFilter(key)}
                      >
                        {t(`YuviStudio.filter.${key}`)}
                      </button>
                    ))}
                  </div>
                  <div className="ys-grid">
                    {filter === 'all' && (
                      <ItemCard
                        selected={design.equipped[activeTab as YuviSlot] === null && !preview}
                        onClick={() => { clearPreview(); equip(activeTab as YuviSlot, null) }}
                        label={t('YuviStudio.none')}
                        none
                      />
                    )}
                    {visibleAssets.map((asset) => {
                      const locked = PREVIEW_ALL ? false : isLocked(asset)
                      const price = locked ? priceOf(asset.id) : null
                      return (
                        <ItemCard
                          key={asset.id}
                          selected={!preview && design.equipped[asset.slot] === asset.id}
                          previewing={preview?.id === asset.id}
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
                            // context bar carries the buy action.
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
                </section>
              </>
            )}
          </StationPanel>
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
              roomItems={visibleRoomItems}
              stations={roomState.room.stations}
              roomStyle={roomStyle}
              placing={placing}
              onPlaceAt={handlePlaceAt}
              onItemMenu={mode === 'room' && !placing ? setPropMenu : undefined}
              lockRoam={mode !== 'roam'}
              label={t('YuviStudio.avatarAlt')}
            />
          )}
        </div>
        <div className="ys-hint">
          {savedNow
            ? t('YuviStudio.saved')
            : placing
              ? t(placing.uid || placing.station ? 'YuviStudio.room.moveHint' : 'YuviStudio.room.placeHint')
              : mode === 'room'
                ? t('YuviStudio.room.menuHint')
                : mode === 'roam'
                  ? t('YuviStudio.roam.hint')
                  : t('YuviStudio.hint')}
        </div>
        {mode === 'roam' && (
          // Two doors, always visible: dress Yuvi, or build the room.
          <div className="ys-stations">
            <button
              type="button"
              className="ys-station"
              onClick={() => avatarRef.current?.walkTo(roomState.room.stations.avatar.x, roomState.room.stations.avatar.z)}
            >
              <Icon name="spark" size={16} />
              <span>{t('YuviStudio.zone.avatar')}</span>
            </button>
            <button
              type="button"
              className="ys-station"
              onClick={() => {
                const spot = roomStandingSpot(roomState.room.stations.room)
                avatarRef.current?.walkTo(spot.x, spot.z)
              }}
            >
              <Icon name="home" size={16} />
              <span>{t('YuviStudio.zone.room')}</span>
            </button>
          </div>
        )}
        {/* Out of the studio, and sound: the only two controls the bay itself
           owns now that saving lives in the panel doing the changing. */}
        <div className="ys-stage-tools">
          <button
            type="button"
            className={`ys-iconbtn${muted ? ' is-off' : ''}`}
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? t('YuviStudio.sound.off') : t('YuviStudio.sound.on')}
            title={muted ? t('YuviStudio.sound.off') : t('YuviStudio.sound.on')}
          >
            <Icon name={muted ? 'mute' : 'sound'} size={18} />
          </button>
          <button
            type="button"
            className="ys-iconbtn ys-iconbtn--exit"
            onClick={requestClose}
            disabled={busy}
            aria-label={t('YuviStudio.back')}
            title={t('YuviStudio.back')}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        {mode === 'roam' && anyDirty && (
          // No panel is open out here, so unsaved work needs its own way home.
          <div className="ys-stage-save">
            <span>{t('YuviStudio.unsaved')}</span>
            <button type="button" className="ys-btn ys-btn--primary ys-btn--sm" onClick={saveAll} disabled={busy}>
              {t('YuviStudio.save')}
            </button>
          </div>
        )}
      </section>
      </div>
      {propMenu && (menuItem || menuStation) && (
        <PropMenu
          at={propMenu}
          label={menuStation
            ? t(`YuviStudio.zone.${menuStation}`)
            : t(`YuviStudio.room.item.${menuItem!.kind}`)}
          onMove={() => startMove(propMenu.uid)}
          onRotate={menuStation ? undefined : () => roomState.rotate(menuItem!.uid, Math.PI / 4)}
          onRemove={menuStation ? undefined : () => { setPropMenu(null); roomState.remove(menuItem!.uid) }}
          onClose={() => setPropMenu(null)}
          t={t}
        />
      )}
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
        <section key={key} className="ys-section">
          <div className="ys-section__head">
            <h2 className="ys-section__title">{t(`YuviStudio.color.${key}`)}</h2>
          </div>
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
        </section>
      ))}
    </>
  )
}

/**
 * The room-building station. Pick a prop, drop it on the floor, then keep
 * adjusting it — the room is the learner's, so nothing here is one-shot.
 */
function RoomPanel({
  state, placing, setPlacing, onLeave, footer, t,
}: {
  state: import('./useRoomDesign').RoomDesignState
  placing: YuviPlacing | null
  setPlacing: (next: YuviPlacing | null) => void
  onLeave: () => void
  footer: React.ReactNode
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

  const styleGroups = [
    { key: 'floor', options: ROOM_STYLES, value: room.floor, set: state.setFloor },
    { key: 'wall', options: WALL_STYLES, value: room.wall, set: state.setWall },
    { key: 'mood', options: MOODS, value: room.mood, set: state.setMood },
  ] as const

  return (
    <StationPanel
      title={t('YuviStudio.room.title')}
      closeLabel={t('YuviStudio.station.leave')}
      onClose={onLeave}
      nav={(
        <SegmentedNav
          label={t('YuviStudio.room.title')}
          items={ROOM_CATEGORIES.map((id) => ({
            id, label: t(`YuviStudio.room.category.${id}`), icon: ROOM_ICONS[id],
          }))}
          value={category}
          onChange={setCategory}
        />
      )}
      context={placing
        ? (
          <ContextBar
            tag={t(placing.uid || placing.station ? 'YuviStudio.room.move' : 'YuviStudio.room.placing')}
            title={placing.station
              ? t(`YuviStudio.zone.${placing.station}`)
              : t(`YuviStudio.room.item.${placing.kind}`)}
            note={t(placing.uid || placing.station ? 'YuviStudio.room.moveHint' : 'YuviStudio.room.placeHint')}
            actions={(
              <>
                {!placing.station && (
                  <button type="button" className="ys-btn ys-btn--ghost ys-btn--sm" onClick={() => spinGhost(Math.PI / 8)}>
                    {t('YuviStudio.room.rotate')}
                  </button>
                )}
                <button type="button" className="ys-btn ys-btn--ghost ys-btn--sm" onClick={() => setPlacing(null)}>
                  {t('YuviStudio.room.cancel')}
                </button>
              </>
            )}
          />
        )
        : selected
          ? (
            <ContextBar
              tag={t('YuviStudio.room.selected')}
              title={t(`YuviStudio.room.item.${selected.kind}`)}
              aside={selectedSpec?.tintable ? (
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
              ) : undefined}
              actions={(
                <>
                  <button type="button" className="ys-btn ys-btn--ghost ys-btn--sm" onClick={() => state.rotate(selected.uid, Math.PI / 8)}>
                    {t('YuviStudio.room.rotate')}
                  </button>
                  <button type="button" className="ys-btn ys-btn--ghost ys-btn--sm" onClick={() => state.remove(selected.uid)}>
                    {t('YuviStudio.room.remove')}
                  </button>
                  <button type="button" className="ys-btn ys-btn--ghost ys-btn--sm" onClick={() => setSelectedUid(null)}>
                    {t('YuviStudio.room.done')}
                  </button>
                </>
              )}
            />
          )
          : null}
      footer={footer}
    >
      <section className="ys-section">
        <div className="ys-section__head">
          <h2 className="ys-section__title">{t(`YuviStudio.room.category.${category}`)}</h2>
          <span className="ys-section__count">
            {t('YuviStudio.room.count')
              .replace('{count}', String(items.length))
              .replace('{max}', String(MAX_ROOM_ITEMS))}
          </span>
        </div>

        {full && <p className="ys-note">{t('YuviStudio.room.full')}</p>}

        <div className="ys-grid">
          {itemsInCategory(category).map((spec) => (
            <ItemCard
              key={spec.id}
              label={t(`YuviStudio.room.item.${spec.id}`)}
              dot={spec.tint ?? 'var(--ys-accent)'}
              selected={!placing?.uid && placing?.kind === spec.id}
              disabled={full}
              onClick={() => pick(spec.id)}
            />
          ))}
        </div>
      </section>

      {/* Style is the fastest way to make the room feel like yours, so it stays
         in the same scroll as the props. Chips, not cards: a setting is not a
         thing you own. */}
      <section className="ys-section">
        <div className="ys-section__head">
          <h2 className="ys-section__title">{t('YuviStudio.room.style')}</h2>
        </div>
        {styleGroups.map((group) => (
          <div key={group.key}>
            <h3 className="ys-subhead">{t(`YuviStudio.room.${group.key}`)}</h3>
            <div className="ys-chips">
              {group.options.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`ys-chip${group.value === id ? ' is-active' : ''}`}
                  onClick={() => group.set(id)}
                >
                  {t(`YuviStudio.room.${group.key}.${id}`)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      {items.length > 0 && (
        <section className="ys-section">
          <div className="ys-section__head">
            <h2 className="ys-section__title">{t('YuviStudio.room.placed')}</h2>
            <button type="button" className="ys-toggle" onClick={state.clear}>
              {t('YuviStudio.room.clear')}
            </button>
          </div>
          <div className="ys-grid">
            {items.map((item) => (
              <ItemCard
                key={item.uid}
                label={t(`YuviStudio.room.item.${item.kind}`)}
                dot={item.tint ?? roomItemSpec(item.kind)?.tint ?? 'var(--ys-accent)'}
                selected={selected?.uid === item.uid}
                onClick={() => { setPlacing(null); setSelectedUid(item.uid) }}
              />
            ))}
          </div>
        </section>
      )}
    </StationPanel>
  )
}
