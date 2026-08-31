// @ts-nocheck
/* eslint-disable */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { useResponsive } from '../../hooks/useResponsive'
import { useAuth } from '../../providers/AuthProvider'
import { LearnerAppBar } from '../../components/LearnerAppBar'
import { Icon } from '../../components/primitives'
import { YuviAvatar3D, type YuviPlacing } from './YuviAvatar3D'
import { assetsForSlot, getThumbnails, type YuviAsset } from './YuviAssets'
import type { YuviColors, YuviSlot } from './YuviDesign'
import type { StudioDesign } from './useStudioDesign'
import { useRoomDesign } from './useRoomDesign'
import { getRoomThumbnails, ROOM_CATEGORIES, WEEKLY_SURPRISE_COVERED, itemsInCategory, roomItemSpec, type RoomItemCategory } from './RoomCatalog'
import { MAX_ROOM_ITEMS, MOODS, ROOM_STYLES, WALL_STYLES, type StationId } from './RoomDesign'
import { useWeeklyStudioSurprise } from './useWeeklyStudioSurprise'
import { roomStandingSpot } from './YuviLabRoom'
import { StationPanel } from './panel/StationPanel'
import { SegmentedNav } from './panel/SegmentedNav'
import { ItemCard } from './panel/ItemCard'
import { ContextBar } from './panel/ContextBar'
import { PropMenu, type PropMenuState } from './panel/PropMenu'
import { StudioHelp, type StudioHelpTopic } from './panel/StudioHelp'
import { StudioWelcome } from './panel/StudioWelcome'
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
type RoomTab = RoomItemCategory | 'general'
const ROOM_STYLE_TABS: Array<{ id: Exclude<RoomTab, RoomItemCategory>; labelKey: string; icon: string }> = [
  { id: 'general', labelKey: 'YuviStudio.room.general', icon: 'home' },
]

/**
 * The studio is a room, not a form. Yuvi walks around it freely; standing on a
 * station is what opens that station's panel.
 */
type StudioMode = 'roam' | 'avatar' | 'room'

// Where Yuvi is sent when the learner closes a station panel — clear of every
// station ring and of the three fixed lab props.
const STEP_OFF: [number, number] = [0, 4.5]

// Anything the learner can recolour uses the same friendly palette.
const ITEM_TINTS = ['#7C6BFF', '#4eeef0', '#ff5d73', '#ffd166', '#5ce67e', '#ff8fd0', '#4cc9f0', '#ff7a3d', '#f3ecdd', '#9a6b40']
const WEEKLY_SURPRISE_POSITION = { x: -8.2, z: -10.2, rot: 0 }

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

const COLOR_OPTIONS: Record<keyof YuviColors, string[]> = {
  body: ['#F1F2FB', '#9cc1e8', '#ff9ec4', '#b5f2c9', '#ffd27a', '#c9b6ff', '#8ee6f2', '#ff8f8f', '#9ad0ff'],
  eyes: ['#4eeef0', '#7c5cff', '#ff5d73', '#ffd166', '#5ce67e', '#ff8fd0'],
  smile: ['#74f7ff', '#7c5cff', '#ff5d73', '#3fd9e0', '#ffd166', '#ff8fd0'],
  glow: ['#7C6BFF', '#3fd9e0', '#ff5d73', '#ffd166', '#aef7ff'],
}

/** Presentational studio UI. */
export function StudioContent({
  studio,
  onClose,
}: {
  studio: StudioDesign
  onClose: () => void
}) {
  const { t } = useI18n()
  const { user } = useAuth()
  const { isTouch } = useResponsive()
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
  // Reset throws away a room a child may have spent weeks on. It is undoable
  // only by leaving without saving, which is not a thing a child knows. Holds
  // the station being reset, because each one resets only its own work.
  const [resetAsk, setResetAsk] = useState<'avatar' | 'room' | null>(null)
  // Walking is the default state of the studio; panels are something you step
  // into, and step out of.
  const [mode, setMode] = useState<StudioMode>('roam')
  // Walking the hall from behind Yuvi's eyes. It is a way of moving, not a
  // place to be, so every station the learner walks into hands the camera back.
  const [firstPerson, setFirstPerson] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [activeHelpTopic, setActiveHelpTopic] = useState<StudioHelpTopic | null>(null)
  const helpRef = useRef<HTMLDivElement | null>(null)
  const requestedStationRef = useRef<'avatar' | 'room' | null>(null)
  const [placing, setPlacing] = useState<YuviPlacing | null>(null)
  // Hovering a prop opens its own menu over it.
  const [propMenu, setPropMenu] = useState<PropMenuState | null>(null)
  const propMenuCloseTimer = useRef<number | null>(null)
  const [colorPicker, setColorPicker] = useState<{ uid: string; kind: string } | null>(null)
  const [surpriseNotice, setSurpriseNotice] = useState(false)
  const roomState = useRoomDesign(true, user?.user_id)
  const weeklySurprise = useWeeklyStudioSurprise(user?.user_id, roomState.loaded && roomState.room.introDone)
  // A stable identity: the 3D room only restyles when one of the three actually
  // changes, not on every keystroke elsewhere in the studio.
  const roomStyle = useMemo(
    () => ({ floor: roomState.room.floor, wall: roomState.room.wall, mood: roomState.room.mood }),
    [roomState.room.floor, roomState.room.wall, roomState.room.mood],
  )
  // A prop being carried is drawn as the ghost under the cursor, so the room
  // must not also draw it standing at the spot it is being moved from.
  const movingUid = placing?.uid ?? null
  const weeklyUid = weeklySurprise?.week ? `weekly-surprise:${weeklySurprise.week}` : ''
  useEffect(() => {
    if (weeklySurprise?.state !== 'revealed' || !weeklySurprise.reward_kind || !weeklyUid) return
    void roomState.materializeWeeklyReward(weeklyUid, weeklySurprise.reward_kind, WEEKLY_SURPRISE_POSITION.x, WEEKLY_SURPRISE_POSITION.z, WEEKLY_SURPRISE_POSITION.rot)
  }, [weeklySurprise?.state, weeklySurprise?.reward_kind, weeklyUid, roomState.materializeWeeklyReward])
  const visibleRoomItems = useMemo(() => {
    const userItems = movingUid ? roomState.items.filter((item) => item.uid !== movingUid) : roomState.items
    if (weeklySurprise?.available && weeklySurprise.state === 'covered') {
      return [...userItems, { uid: weeklyUid, kind: WEEKLY_SURPRISE_COVERED, ...WEEKLY_SURPRISE_POSITION }]
    }
    return userItems
  }, [roomState.items, movingUid, weeklySurprise, weeklyUid])
  const menuItem = propMenu ? roomState.items.find((item) => item.uid === propMenu.uid) ?? null : null
  // Stations are addressed through the same menu, under a reserved uid.
  const menuStation: StationId | null = propMenu?.uid.startsWith('station:')
    ? (propMenu.uid.slice(8) as StationId)
    : null
  const clearPropMenuClose = () => {
    if (propMenuCloseTimer.current) window.clearTimeout(propMenuCloseTimer.current)
    propMenuCloseTimer.current = null
  }
  const showPropMenu = (menu: PropMenuState | null) => {
    clearPropMenuClose()
    if (menu?.uid === weeklyUid) {
      setSurpriseNotice(true)
      setPropMenu(null)
      return
    }
    setSurpriseNotice(false)
    setPropMenu((current) => menu && current?.uid === menu.uid ? current : menu)
  }
  const deferPropMenuClose = () => {
    clearPropMenuClose()
    propMenuCloseTimer.current = window.setTimeout(() => setPropMenu(null), 350)
  }
  useEffect(() => () => clearPropMenuClose(), [])
  useEffect(() => {
    if (!helpOpen) return
    const closeOutsideHelp = (event: PointerEvent) => {
      if (event.target instanceof Node && !helpRef.current?.contains(event.target)) {
        setHelpOpen(false)
        setActiveHelpTopic(null)
      }
    }
    document.addEventListener('pointerdown', closeOutsideHelp)
    return () => document.removeEventListener('pointerdown', closeOutsideHelp)
  }, [helpOpen])
  const {
    avatarRef, loaded, design, activeTab, setActiveTab, muted, setMuted, justSaved,
    saving, dirty, isLocked, isPropLocked, requirementFor, equip, setColor, reset, save,
    wallet, priceOf, buy, buying,
  } = studio

  const [introScene, setIntroScene] = useState<number | null>(null)
  const [introAvatarChanged, setIntroAvatarChanged] = useState(false)
  const [introCheckFailed, setIntroCheckFailed] = useState(false)
  const [introSaveFailed, setIntroSaveFailed] = useState(false)
  const tutorialArmed = useRef(false)

  useEffect(() => {
    tutorialArmed.current = false
    setIntroScene(null)
    setIntroAvatarChanged(false)
    setIntroCheckFailed(false)
    setIntroSaveFailed(false)
  }, [user?.user_id])

  const stations = roomState.room.stations
  useEffect(() => {
    if (!roomState.loaded || tutorialArmed.current) return
    tutorialArmed.current = true
    if (!roomState.room.introDone) { setIntroScene(0); return }
  }, [roomState.loaded, roomState.room.introDone, roomState.room.tutorialDone])

  useEffect(() => {
    if (introScene === null) return
    if (introScene === 1) {
      setMode('roam')
      avatarRef.current?.focus('roam')
    } else if (introScene === 2) {
      setActiveTab('colors')
      goToStation('avatar')
    } else {
      setMode('roam')
      avatarRef.current?.focus('roam')
    }
  }, [introScene, avatarRef, setActiveTab])

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
  /**
   * Reset belongs to the station the learner is standing at. Clearing the room
   * used to take Yuvi's hat with it, which is not what anyone tidying up a
   * floor is asking for.
   */
  const resetScope = (scope: 'avatar' | 'room') => {
    setResetAsk(null)
    if (scope === 'avatar') {
      // The design is being replaced, so a previewed item has nothing to sit on.
      setPreview(null)
      reset()
      return
    }
    setPlacing(null)
    setPropMenu(null)
    roomState.reset()
  }

  const requestClose = () => {
    if (anyDirty) { setExitError(false); setExitAsk(true) }
    else onClose()
  }

  /** Stepping onto a station opens it; stepping off closes it again. */
  const handleZoneChange = (zone: 'avatar' | 'room' | null) => {
    if (requestedStationRef.current && zone !== requestedStationRef.current) return
    if (zone === requestedStationRef.current) requestedStationRef.current = null
    setPropMenu(null)
    if (zone === 'avatar') {
      setPlacing(null)
      setFirstPerson(false)
      setMode('avatar')
      avatarRef.current?.focus(FOCUS_BY_TAB[activeTab])
      return
    }
    if (zone === 'room') {
      setFirstPerson(false)
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
  const goToStation = (station: 'avatar' | 'room') => {
    requestedStationRef.current = station
    setPlacing(null)
    setPropMenu(null)
    setFirstPerson(false)
    setMode(station)
    if (station === 'avatar') {
      avatarRef.current?.focus(FOCUS_BY_TAB[activeTab])
      avatarRef.current?.walkTo(
        roomState.room.stations.avatar.x,
        roomState.room.stations.avatar.z,
        station,
      )
      return
    }
    const spot = roomStandingSpot(roomState.room.stations.room)
    avatarRef.current?.focus('room')
    avatarRef.current?.walkTo(spot.x, spot.z, station)
  }

  const endIntro = async () => {
    setIntroSaveFailed(false)
    const saved = await saveAll()
    const completed = await roomState.completeIntro()
    if (!saved || !completed) {
      setIntroSaveFailed(true)
      return
    }
    setIntroScene(null)
    setMode('roam')
    avatarRef.current?.focus('roam')
  }
  const continueIntro = () => {
    if (introScene === null) return
    if (introScene === 0) {
      setIntroCheckFailed(false)
      setIntroScene(1)
      carryStation('room', stations.room.rot)
      return
    }
    if (introScene === 1) {
      if (!stations.room.placed || !stations.avatar.placed) { setIntroCheckFailed(true); return }
      setIntroCheckFailed(false)
      setIntroAvatarChanged(false)
      setIntroScene(2)
      return
    }
    if (introScene === 2) {
      if (!introAvatarChanged) { setIntroCheckFailed(true); return }
      setIntroCheckFailed(false)
      setIntroScene(3)
      return
    }
    void endIntro()
  }
  const carryStation = (id: StationId, rot: number) => {
    setPropMenu(null)
    setPlacing({ kind: `station:${id}`, station: id, rot, rot0: rot })
  }
  const carrying = (id: StationId) => placing?.station === id

  /** The learner clicked the floor while holding a prop. */
  const handlePlaceAt = (x: number, z: number, valid: boolean) => {
    if (!placing || !valid) return
    if (placing.station) {
      roomState.moveStation(placing.station, x, z, placing.rot ?? 0)
    } else if (placing.uid) {
      // Putting a carried prop back down: it keeps whatever rotation it was
      // spun to while it was in the air.
      roomState.move(placing.uid, x, z)
      if (placing.rot !== placing.rot0) roomState.rotate(placing.uid, (placing.rot ?? 0) - (placing.rot0 ?? 0))
      roomState.setSelectedUid(placing.uid)
    } else {
      roomState.place(placing.kind, x, z, placing.rot ?? 0)
    }
    if (introScene === 1 && placing.station === 'room') {
      const avatar = roomState.room.stations.avatar
      setPlacing({ kind: 'station:avatar', station: 'avatar', rot: avatar.rot, rot0: avatar.rot })
    } else {
      setPlacing(null)
    }
    setIntroCheckFailed(false)
  }

  /** "Move" on the prop menu picks the prop — or the whole station — up. */
  const startMove = (uid: string) => {
    setPropMenu(null)
    if (uid.startsWith('station:')) {
      const id = uid.slice(8) as StationId
      const at = roomState.room.stations[id]
      setPlacing({ kind: uid, station: id, rot: at.rot, rot0: at.rot })
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

  // Escape is also the way back out of Yuvi's eyes.
  useEffect(() => {
    if (!firstPerson) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setFirstPerson(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [firstPerson])

  const clearPreview = (worn: YuviAsset | null = preview) => {
    if (!worn) return
    avatarRef.current?.equip(worn.slot, design.equipped[worn.slot] ?? null, true)
    setPreview(null)
  }
  // Trying something on only exists inside the panel offering to sell it. Off
  // the station there is no buy button and no cancel, so a borrowed hat would
  // stay on Yuvi's head over a footer cheerfully reporting "all saved".
  useEffect(() => {
    if (mode !== 'avatar') clearPreview()
  }, [mode])
  const goToTab = (tab: Tab) => {
    clearPreview()
    setActiveTab(tab)
    setFilter('all')
    avatarRef.current?.focus(FOCUS_BY_TAB[tab])
  }

  // Frame the current category as soon as the WebGL controller is alive.
  const framedRef = useRef(false)
  useEffect(() => {
    // Both the room and the avatar have to be loaded before the opening shot is
    // chosen, because the walkthrough wants the floor plan and everyone else
    // wants the establishing shot.
    if (!loaded || !roomState.loaded || framedRef.current) return
    framedRef.current = true
    const view = roomState.room.tutorialDone ? 'roam' : 'room'
    const id = window.setTimeout(() => avatarRef.current?.focus(view), 260)
    return () => window.clearTimeout(id)
  }, [loaded, roomState.loaded, roomState.room.tutorialDone, avatarRef])

  const slotAssets = activeTab === 'colors' ? [] : assetsForSlot(activeTab as YuviSlot)
  const visibleAssets = slotAssets.filter((asset) => {
    const locked = isLocked(asset)
    if (filter === 'owned') return !locked
    if (filter === 'new') return Boolean(asset.isNew)
    if (filter === 'special') return Boolean(asset.requirementKey)
    return true
  })

  // Save sits with the thing it saves, so both stations share one footer. Save
  // stays whole — storing everything is never destructive — but Reset is per
  // station, and says which one it is before it is pressed.
  const footerFor = (scope: 'avatar' | 'room') => (
    <>
      <span className={`ys-panel__state${savedNow ? ' is-saved' : anyDirty ? ' is-dirty' : ''}`}>
        {savedNow ? t('YuviStudio.saved') : anyDirty ? t('YuviStudio.unsaved') : t('YuviStudio.allSaved')}
      </span>
      <button type="button" className="ys-btn ys-btn--primary ys-btn--sm" onClick={saveAll} disabled={busy || !anyDirty}>
        {t('YuviStudio.save')}
      </button>
      <button type="button" className="ys-btn ys-btn--ghost ys-btn--sm" onClick={() => setResetAsk(scope)} disabled={busy}>
        {t(`YuviStudio.reset.${scope}`)}
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
            footer={introScene === 1 ? undefined : footerFor('room')}
            isPropLocked={isPropLocked}
            requirementFor={requirementFor}
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
            footer={introScene === 2 ? undefined : footerFor('avatar')}
          >
            {activeTab === 'colors' ? (
              <ColorsPanel
                design={design}
                onPick={(key, hex) => {
                  setColor(key, hex)
                  if (introScene === 2) {
                    setIntroAvatarChanged(true)
                    setIntroCheckFailed(false)
                  }
                }}
                t={t}
              />
            ) : (
              <>
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
                      const locked = isLocked(asset)
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
        <div className="ys-stage__canvas">
          {loaded && (
            <YuviAvatar3D
              ref={avatarRef}
              initialDesign={design}
              muted={muted}
              orbit
              stage
              roam
              firstPerson={firstPerson && mode === 'roam'}
              onZoneChange={handleZoneChange}
              onStationIntentChange={(station) => { requestedStationRef.current = station }}
              roomItems={visibleRoomItems}
              stations={roomState.room.stations}
              roomStyle={roomStyle}
              placing={placing}
              presenting={introScene !== null && introScene !== 3}
              presentingSide="left"
              onPlaceAt={handlePlaceAt}
              onItemMenu={!placing ? showPropMenu : undefined}
              onItemMenuLeave={!placing ? () => { deferPropMenuClose(); setSurpriseNotice(false) } : undefined}
              onNearRoomItem={(uid) => { if (uid === weeklyUid) setSurpriseNotice(true) }}
              lockRoam={mode !== 'roam' || introScene !== null}
              label={t('YuviStudio.avatarAlt')}
            />
          )}
        </div>
        {introScene !== null && (
          <StudioWelcome
            scene={introScene}
            copy={{
              title: t('YuviStudio.intro.title'),
              body: t(
                introSaveFailed
                  ? 'YuviStudio.intro.saveFailed'
                  : introScene === 1
                    ? !stations.room.placed
                      ? 'YuviStudio.intro.station.room'
                      : !stations.avatar.placed
                        ? 'YuviStudio.intro.station.avatar'
                        : introCheckFailed ? 'YuviStudio.intro.station.missing' : 'YuviStudio.intro.station.done'
                    : introScene === 2
                      ? introAvatarChanged ? 'YuviStudio.intro.avatar.done' : introCheckFailed ? 'YuviStudio.intro.avatar.missing' : 'YuviStudio.intro.avatar.pick'
                      : `YuviStudio.intro.scene${introScene}`,
              ),
              avatar: t('YuviStudio.zone.avatar'),
              room: t('YuviStudio.zone.room'),
              action: introScene === 0
                ? t('YuviStudio.intro.continue')
                : introScene === 1
                  ? t('YuviStudio.intro.next')
                  : introScene === 2
                    ? t('YuviStudio.intro.next')
                  : t('YuviStudio.intro.finish'),
            }}
            onContinue={continueIntro}
          />
        )}
        {mode === 'roam' && !firstPerson && introScene === null && (
          // Two doors, always visible: dress Yuvi, or build the room.
          <div className="ys-stations">
            <button
              type="button"
              className="ys-station"
              onClick={() => goToStation('avatar')}
            >
              <Icon name="spark" size={16} />
              <span>{t('YuviStudio.zone.avatar')}</span>
            </button>
            <button
              type="button"
              className="ys-station"
              onClick={() => goToStation('room')}
            >
              <Icon name="home" size={16} />
              <span>{t('YuviStudio.zone.room')}</span>
            </button>
            <div className="ys-help" ref={helpRef}>
              <button
                type="button"
                className="ys-station ys-station--help"
                onClick={() => { setActiveHelpTopic(null); setHelpOpen((open) => !open) }}
                aria-expanded={helpOpen}
                aria-controls="yuvi-studio-help"
              >
                <Icon name="help" size={16} />
                <span>{t('YuviStudio.tut.help')}</span>
              </button>
              {helpOpen && (
                <StudioHelp
                  activeTopic={activeHelpTopic}
                  onClose={() => { setHelpOpen(false); setActiveHelpTopic(null) }}
                  onSelectTopic={setActiveHelpTopic}
                  onCloseTopic={() => setActiveHelpTopic(null)}
                  t={t}
                />
              )}
            </div>
          </div>
        )}
        {/* Out of the studio, and sound: the only two controls the bay itself
           owns now that saving lives in the panel doing the changing. */}
        <div className="ys-stage-tools">
          {/* Behind Yuvi's eyes you walk with the arrow keys and nothing else —
             the floor tap is deliberately dead there. Offering it on a tablet
             is offering a room the learner cannot leave. */}
          {mode === 'roam' && !isTouch && (
            <button
              type="button"
              className={`ys-iconbtn${firstPerson ? ' is-on' : ''}`}
              onClick={() => setFirstPerson((on) => !on)}
              aria-pressed={firstPerson}
              aria-label={t(firstPerson ? 'YuviStudio.fpv.off' : 'YuviStudio.fpv.on')}
              title={t(firstPerson ? 'YuviStudio.fpv.off' : 'YuviStudio.fpv.on')}
            >
              <Icon name={firstPerson ? 'orbit' : 'eye'} size={18} />
            </button>
          )}
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
        {surpriseNotice && weeklySurprise?.state === 'covered' && (
          <aside className="ys-surprise-notice" role="status">
            <button type="button" className="ys-help__close" onClick={() => setSurpriseNotice(false)} aria-label={t('YuviStudio.surprise.close')} title={t('YuviStudio.surprise.close')}>
              <Icon name="close" size={15} />
            </button>
            <div className="ys-surprise-notice__head">
              <span className="ys-surprise-notice__spark" aria-hidden="true"><Icon name="spark" size={21} /></span>
              <strong>{t('YuviStudio.surprise.title')}</strong>
            </div>
            <div className="ys-surprise-notice__goal">
              <span><Icon name="target" size={14} />{t('YuviStudio.surprise.goal')}</span>
              <bdi dir="auto">{weeklySurprise.goal?.title ?? ''}</bdi>
            </div>
            <p>{t('YuviStudio.surprise.notice')}</p>
          </aside>
        )}
      </section>
      </div>
      {propMenu && (menuItem || menuStation) && (
        <PropMenu
          at={propMenu}
          label={menuStation
            ? t(`YuviStudio.zone.${menuStation}`)
            : t(`YuviStudio.room.item.${menuItem!.kind}`)}
          primaryAction={menuStation === 'avatar'
            ? { label: t('YuviStudio.zone.avatar'), icon: 'spark', onClick: () => { setPropMenu(null); goToStation('avatar') } }
            : undefined}
          onMove={menuStation === 'avatar' ? undefined : () => startMove(propMenu.uid)}
          onRotate={menuStation === 'avatar' ? undefined : menuStation
            ? () => roomState.rotateStation(menuStation, Math.PI / 8)
            : () => roomState.rotate(menuItem!.uid, Math.PI / 4)}
          onRemove={menuStation ? undefined : () => { setPropMenu(null); roomState.remove(menuItem!.uid) }}
          colors={!menuStation && roomItemSpec(menuItem!.kind)?.tintable ? ITEM_TINTS.slice(0, 5) : undefined}
          onTint={!menuStation && roomItemSpec(menuItem!.kind)?.tintable
            ? (hex) => roomState.tint(menuItem!.uid, hex)
            : undefined}
          onMoreColors={!menuStation && roomItemSpec(menuItem!.kind)?.tintable
            ? () => { setColorPicker({ uid: menuItem!.uid, kind: menuItem!.kind }); setPropMenu(null) }
            : undefined}
          onClose={() => { clearPropMenuClose(); setPropMenu(null) }}
          onHoverStart={clearPropMenuClose}
          onHoverEnd={deferPropMenuClose}
          t={t}
        />
      )}
      {colorPicker && (
        <RoomColorDialog
          item={roomState.items.find((item) => item.uid === colorPicker.uid) ?? null}
          t={t}
          onPick={(hex) => roomState.tint(colorPicker.uid, hex)}
          onClose={() => setColorPicker(null)}
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
                disabled={busy}
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
      {resetAsk && (
        <div className="ys-shop-backdrop" role="presentation" onClick={() => setResetAsk(null)}>
          <div
            className="ys-shop ys-shop--confirm"
            role="alertdialog"
            aria-modal="true"
            aria-label={t(`YuviStudio.reset.${resetAsk}.title`)}
            onClick={(event) => event.stopPropagation()}
          >
            <h2>{t(`YuviStudio.reset.${resetAsk}.title`)}</h2>
            <p className="ys-shop__balance">{t(`YuviStudio.reset.${resetAsk}.body`)}</p>
            <div className="ys-shop__actions">
              <button type="button" className="ys-btn ys-btn--primary" onClick={() => resetScope(resetAsk)}>
                {t('YuviStudio.reset.confirm')}
              </button>
              <button type="button" className="ys-btn ys-btn--ghost" onClick={() => setResetAsk(null)}>
                {t('YuviStudio.reset.cancel')}
              </button>
            </div>
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

function RoomColorDialog({
  item, t, onPick, onClose,
}: {
  item: import('./RoomDesign').RoomItem | null
  t: (key: string) => string
  onPick: (hex: string) => void
  onClose: () => void
}) {
  if (!item) return null
  return (
    <div className="ys-shop-backdrop" role="presentation" onClick={onClose}>
      <div className="ys-shop ys-room-color-dialog" role="dialog" aria-modal="true" aria-label={t('YuviStudio.room.colors')} onClick={(event) => event.stopPropagation()}>
        <h2>{t('YuviStudio.room.colors')}</h2>
        <div className="ys-room-color-dialog__swatches">
          {ITEM_TINTS.map((hex) => (
            <button
              key={hex}
              type="button"
              className={`ys-swatch${item.tint?.toLowerCase() === hex.toLowerCase() ? ' is-active' : ''}`}
              style={{ background: hex }}
              aria-label={hex}
              onClick={() => onPick(hex)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * The room-building station. Pick a prop, drop it on the floor, then keep
 * adjusting it — the room is the learner's, so nothing here is one-shot.
 */
function RoomPanel({
  state, placing, setPlacing, onLeave, footer, isPropLocked, requirementFor, t,
}: {
  state: import('./useRoomDesign').RoomDesignState
  placing: YuviPlacing | null
  setPlacing: (next: YuviPlacing | null) => void
  onLeave: () => void
  footer: React.ReactNode
  /** Furniture that has to be earned, and what earns it. */
  isPropLocked: (kind: string) => boolean
  requirementFor: (id: string) => string | undefined
  t: (key: string) => string
}) {
  const [category, setCategory] = useState<RoomTab>('seating')
  const { room, items, full, selected, setSelectedUid } = state
  const isItemCategory = ROOM_CATEGORIES.includes(category as RoomItemCategory)
  const categoryItems = useMemo(
    () => (isItemCategory ? itemsInCategory(category as RoomItemCategory) : []),
    [category, isItemCategory],
  )
  const roomThumbnails = useMemo(() => getRoomThumbnails(categoryItems), [categoryItems])

  const pick = (kind: string) => {
    if (full || isPropLocked(kind)) return
    const spec = roomItemSpec(kind)
    if (!spec) return
    setSelectedUid(null)
    setPlacing({ kind, tint: spec.tintable ? spec.tint : undefined, rot: 0 })
  }

  const generalStyles = [
    { key: 'floor', options: ROOM_STYLES, value: room.floor, set: state.setFloor },
    { key: 'wall', options: WALL_STYLES, value: room.wall, set: state.setWall },
    { key: 'mood', options: MOODS, value: room.mood, set: state.setMood },
  ]

  return (
    <StationPanel
      title={t('YuviStudio.room.title')}
      closeLabel={t('YuviStudio.station.leave')}
      onClose={onLeave}
      nav={(
        <SegmentedNav
          label={t('YuviStudio.room.title')}
          items={[
            ...ROOM_CATEGORIES.map((id) => ({
              id, label: t(`YuviStudio.room.category.${id}`), icon: ROOM_ICONS[id],
            })),
            ...ROOM_STYLE_TABS.map((tab) => ({ id: tab.id, label: t(tab.labelKey), icon: tab.icon })),
          ]}
          value={category}
          onChange={setCategory}
        />
      )}
      context={!placing && selected
          ? (
            <ContextBar
              tag={t('YuviStudio.room.selected')}
              title={t(`YuviStudio.room.item.${selected.kind}`)}
            />
          )
          : null}
      footer={footer}
    >
      {isItemCategory && <section className="ys-section">
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
          {categoryItems.map((spec) => {
            const locked = isPropLocked(spec.id)
            return (
              <ItemCard
                key={spec.id}
                label={t(`YuviStudio.room.item.${spec.id}`)}
                thumb={roomThumbnails[spec.id]}
                dot={spec.tint ?? 'var(--ys-accent)'}
                selected={!placing?.uid && placing?.kind === spec.id}
                locked={locked}
                tip={locked ? t(requirementFor(spec.id) ?? 'YuviStudio.unlock.achievement') : undefined}
                disabled={full || locked}
                onClick={() => pick(spec.id)}
              />
            )
          })}
        </div>
      </section>}

      {category === 'general' && (
        <section className="ys-section">
          {generalStyles.map((style) => (
            <div key={style.key} className="ys-general-style">
              <h2 className="ys-section__title">{t(`YuviStudio.room.${style.key}`)}</h2>
              <div className="ys-chips">
                {style.options.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={`ys-chip${style.value === id ? ' is-active' : ''}`}
                    onClick={() => style.set(id)}
                  >
                    {t(`YuviStudio.room.${style.key}.${id}`)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

    </StationPanel>
  )
}
