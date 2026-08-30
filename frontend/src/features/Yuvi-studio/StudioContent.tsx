// @ts-nocheck
/* eslint-disable */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { useResponsive } from '../../hooks/useResponsive'
import { LearnerAppBar } from '../../components/LearnerAppBar'
import { Icon } from '../../components/primitives'
import { YuviAvatar3D, type YuviPlacing } from './YuviAvatar3D'
import { assetsForSlot, getThumbnails, type YuviAsset } from './YuviAssets'
import type { YuviColors, YuviSlot, YuviVariant } from './YuviDesign'
import type { StudioDesign } from './useStudioDesign'
import { useRoomDesign } from './useRoomDesign'
import { getRoomThumbnails, ROOM_CATEGORIES, itemsInCategory, roomItemSpec, type RoomItemCategory } from './RoomCatalog'
import { MAX_ROOM_ITEMS, MOODS, ROOM_STYLES, WALL_STYLES, type StationId } from './RoomDesign'
import { roomStandingSpot } from './YuviLabRoom'
import { StationPanel } from './panel/StationPanel'
import { SegmentedNav } from './panel/SegmentedNav'
import { ItemCard } from './panel/ItemCard'
import { ContextBar } from './panel/ContextBar'
import { PropMenu, type PropMenuState } from './panel/PropMenu'
import { StudioTutorial, type TutorialStepView } from './panel/StudioTutorial'
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
type RoomTab = RoomItemCategory | 'floor' | 'wallStyle' | 'mood'
const ROOM_STYLE_TABS: Array<{ id: Exclude<RoomTab, RoomItemCategory>; labelKey: string; icon: string }> = [
  { id: 'floor', labelKey: 'YuviStudio.room.floor', icon: 'sofa' },
  { id: 'wallStyle', labelKey: 'YuviStudio.room.wall', icon: 'image' },
  { id: 'mood', labelKey: 'YuviStudio.room.mood', icon: 'lightbulb' },
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

// ── Room-design walkthrough ───────────────────────────────────────────────
// The first lesson of the room is that the room is furniture: the two stations
// can be picked up, put down and turned. Teaching it on the bench means the
// learner has already done every gesture the panel will ask of them later.
//
// The corner is pulled far enough off the walls that the bench's doorway — the
// floor in front of it — stays inside the room at every orientation, so no
// legal-looking drop is ever refused. The disc is wide because a child aiming
// at a patch of floor across a hall this big should not have to be precise.
const TUTORIAL_CORNER = { x: -8, z: -8, radius: 2.6 }
// Facing the middle of the room from the back-left corner.
const TUTORIAL_BENCH_ROT = Math.PI / 4
// The bench is handed over facing the walls, so there is a real turn to make.
const TUTORIAL_BENCH_START_ROT = TUTORIAL_BENCH_ROT + Math.PI
// Four presses of the turn button land exactly on the target.
const TUTORIAL_TURN_STEP = Math.PI / 4
const TUTORIAL_ROT_TOLERANCE = 0.44

type TutorialStep = 'benchPlace' | 'benchTurn' | 'platformPlace' | 'done'
const TUTORIAL_ORDER: TutorialStep[] = ['benchPlace', 'benchTurn', 'platformPlace']

/** Shortest signed distance between two angles, so 359° and 1° are 2° apart. */
function angleGap(a: number, b: number): number {
  let delta = (a - b) % (Math.PI * 2)
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  return Math.abs(delta)
}

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
  const { isTouch } = useResponsive()
  // Four hints name a mouse the learner may not have. On a school tablet they
  // described a wheel, arrow keys and a right-click — including inside the
  // walkthrough, which is the one screen that has to be followable.
  const hint = (key: string) => t(isTouch ? `${key}.touch` : key)
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
  const requestedStationRef = useRef<'avatar' | 'room' | null>(null)
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
    saving, dirty, isLocked, isPropLocked, requirementFor, equip, setVariant, setColor, reset, save,
    wallet, priceOf, buy, buying,
  } = studio

  // ── Walkthrough ──
  // Runs once per learner, the first time they open the studio. Everything it
  // asks for is a real edit to their real room, so there is nothing to undo
  // when it finishes — they simply end up with a room they placed themselves.
  const [tutorial, setTutorial] = useState<TutorialStep | null>(null)
  const tutorialArmed = useRef(false)
  const stations = roomState.room.stations
  /** The layout as the current step found it, so a step cannot pass for free. */
  const stepStart = useRef<{ room: typeof stations.room; avatar: typeof stations.avatar } | null>(null)

  useEffect(() => {
    if (!roomState.loaded || tutorialArmed.current) return
    tutorialArmed.current = true
    if (roomState.room.tutorialDone) return
    setTutorial('benchPlace')
  }, [roomState.loaded, roomState.room.tutorialDone])

  // Snapshot first, so the step that just started measures against where the
  // room actually was rather than against the previous step's baseline.
  useEffect(() => {
    stepStart.current = tutorial
      ? { room: { ...stations.room }, avatar: { ...stations.avatar } }
      : null
    // Only on a step change: mid-step edits are exactly what is being measured.
  }, [tutorial])

  // Each step watches the room itself rather than the click that changed it, so
  // reaching the goal any other way still counts. A learner whose room already
  // looks right still has to perform the gesture — otherwise someone who has
  // decorated before would open the walkthrough on its last step.
  useEffect(() => {
    if (!tutorial) return
    const from = stepStart.current
    if (!from) return
    const shifted = (a: { x: number; z: number }, b: { x: number; z: number }) =>
      Math.hypot(a.x - b.x, a.z - b.z) > 0.05

    if (tutorial === 'benchPlace') {
      if (!shifted(stations.room, from.room)) return
      const gap = Math.hypot(stations.room.x - TUTORIAL_CORNER.x, stations.room.z - TUTORIAL_CORNER.z)
      if (gap <= TUTORIAL_CORNER.radius) setTutorial('benchTurn')
      return
    }
    if (tutorial === 'benchTurn') {
      if (Math.abs(stations.room.rot - from.room.rot) < 0.01) return
      if (angleGap(stations.room.rot, TUTORIAL_BENCH_ROT) <= TUTORIAL_ROT_TOLERANCE) setTutorial('platformPlace')
      return
    }
    if (tutorial === 'platformPlace') {
      if (shifted(stations.avatar, from.avatar)) setTutorial('done')
    }
  }, [tutorial, stations])

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

  // ── Walkthrough actions ──
  const endTutorial = async () => {
    setTutorial(null)
    setPlacing(null)
    avatarRef.current?.focus('roam')
    await roomState.completeTutorial()
  }
  const carryStation = (id: StationId, rot: number) => {
    setPropMenu(null)
    setPlacing({ kind: `station:${id}`, station: id, rot, rot0: rot })
  }
  const carrying = (id: StationId) => placing?.station === id

  /** The lit patch of floor for the current step. `null` means "anywhere". */
  const placeTarget = tutorial === 'benchPlace'
    ? TUTORIAL_CORNER
    : tutorial === 'benchTurn'
      ? { ...TUTORIAL_CORNER, aim: TUTORIAL_BENCH_ROT }
      : null

  const tutorialStep: TutorialStepView | null = useMemo(() => {
    if (!tutorial) return null
    const stepNo = (id: TutorialStep) => TUTORIAL_ORDER.indexOf(id) + 1
    const counter = (id: TutorialStep) => t('YuviStudio.tut.step')
      .replace('{n}', String(stepNo(id)))
      .replace('{total}', String(TUTORIAL_ORDER.length))
    const skip = { label: t('YuviStudio.tut.skip'), icon: 'close', onClick: () => void endTutorial() }

    if (tutorial === 'benchPlace') {
      return {
        id: tutorial,
        icon: 'home',
        title: t('YuviStudio.tut.bench.title'),
        status: counter(tutorial),
        statusState: 'active',
        what: t('YuviStudio.tut.bench.what'),
        why: t('YuviStudio.tut.bench.why'),
        how: t(carrying('room') ? 'YuviStudio.tut.bench.howDrop' : 'YuviStudio.tut.bench.howPick'),
        tip: t('YuviStudio.tut.bench.tip'),
        primary: carrying('room')
          ? { label: t('YuviStudio.tut.bench.waiting'), icon: 'target', onClick: () => {}, disabled: true }
          : { label: t('YuviStudio.tut.bench.pick'), icon: 'expand', onClick: () => carryStation('room', TUTORIAL_BENCH_START_ROT) },
        secondary: skip,
      }
    }
    if (tutorial === 'benchTurn') {
      return {
        id: tutorial,
        icon: 'reflect',
        title: t('YuviStudio.tut.turn.title'),
        status: counter(tutorial),
        statusState: 'active',
        what: t('YuviStudio.tut.turn.what'),
        why: t('YuviStudio.tut.turn.why'),
        how: t('YuviStudio.tut.turn.how'),
        tip: hint('YuviStudio.tut.turn.tip'),
        primary: {
          label: t('YuviStudio.tut.turn.action'),
          icon: 'reflect',
          onClick: () => roomState.rotateStation('room', TUTORIAL_TURN_STEP),
        },
        secondary: skip,
      }
    }
    if (tutorial === 'platformPlace') {
      return {
        id: tutorial,
        icon: 'spark',
        title: t('YuviStudio.tut.platform.title'),
        status: counter(tutorial),
        statusState: 'active',
        what: t('YuviStudio.tut.platform.what'),
        why: t('YuviStudio.tut.platform.why'),
        how: t(carrying('avatar') ? 'YuviStudio.tut.platform.howDrop' : 'YuviStudio.tut.platform.howPick'),
        tip: t('YuviStudio.tut.platform.tip'),
        primary: carrying('avatar')
          ? { label: t('YuviStudio.tut.platform.waiting'), icon: 'target', onClick: () => {}, disabled: true }
          : { label: t('YuviStudio.tut.platform.pick'), icon: 'expand', onClick: () => carryStation('avatar', stations.avatar.rot) },
        secondary: skip,
      }
    }
    return {
      id: 'done',
      icon: 'check',
      title: t('YuviStudio.tut.done.title'),
      status: t('YuviStudio.tut.status.done'),
      statusState: 'done',
      what: t('YuviStudio.tut.done.what'),
      why: t('YuviStudio.tut.done.why'),
      how: t('YuviStudio.tut.done.how'),
      tip: t('YuviStudio.tut.done.tip'),
      primary: { label: t('YuviStudio.tut.done.action'), icon: 'check', onClick: () => void endTutorial() },
    }
  }, [tutorial, placing, stations.avatar.rot, t])


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
    setPlacing(null)
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
            footer={footerFor('room')}
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
            footer={footerFor('avatar')}
          >
            {activeTab === 'colors' ? (              <ColorsPanel design={design} onPick={setColor} t={t} />
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
              firstPerson={firstPerson && mode === 'roam' && !tutorial}
              onZoneChange={handleZoneChange}
              onStationIntentChange={(station) => { requestedStationRef.current = station }}
              roomItems={visibleRoomItems}
              stations={roomState.room.stations}
              roomStyle={roomStyle}
              placing={placing}
              placeTarget={placeTarget}
              onPlaceAt={handlePlaceAt}
              onItemMenu={mode === 'room' && !placing ? setPropMenu : undefined}
              lockRoam={mode !== 'roam' || Boolean(tutorial)}
              label={t('YuviStudio.avatarAlt')}
            />
          )}
        </div>
        <div className="ys-hint">
          {savedNow
            ? t('YuviStudio.saved')
            : tutorial
              ? t('YuviStudio.tut.hint')
              : placing
                ? t(placing.uid || placing.station ? 'YuviStudio.room.moveHint' : 'YuviStudio.room.placeHint')
                : mode === 'room'
                  ? hint('YuviStudio.room.menuHint')
                  : mode === 'roam'
                    ? firstPerson ? t('YuviStudio.fpv.hint') : hint('YuviStudio.roam.hint')
                    : hint('YuviStudio.hint')}
        </div>
        {mode === 'roam' && !firstPerson && !tutorial && (
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
          </div>
        )}
        {/* Out of the studio, and sound: the only two controls the bay itself
           owns now that saving lives in the panel doing the changing. */}
        <div className="ys-stage-tools">
          {/* Behind Yuvi's eyes you walk with the arrow keys and nothing else —
             the floor tap is deliberately dead there. Offering it on a tablet
             is offering a room the learner cannot leave. */}
          {mode === 'roam' && !tutorial && !isTouch && (
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
        {mode === 'roam' && anyDirty && !tutorial && (
          // No panel is open out here, so unsaved work needs its own way home.
          <div className="ys-stage-save">
            <span>{t('YuviStudio.unsaved')}</span>
            <button type="button" className="ys-btn ys-btn--primary ys-btn--sm" onClick={saveAll} disabled={busy}>
              {t('YuviStudio.save')}
            </button>
          </div>
        )}
        {tutorialStep && (
          <StudioTutorial
            key={tutorialStep.id}
            step={tutorialStep}
            headings={{
              what: t('YuviStudio.tut.q.what'),
              why: t('YuviStudio.tut.q.why'),
              how: t('YuviStudio.tut.q.how'),
            }}
            moreLabel={t('YuviStudio.tut.more')}
            closeLabel={t('YuviStudio.tut.skip')}
            onClose={() => void endTutorial()}
          />
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
          onRotate={menuStation
            ? () => roomState.rotateStation(menuStation, Math.PI / 8)
            : () => roomState.rotate(menuItem!.uid, Math.PI / 4)}
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
  const selectedSpec = selected ? roomItemSpec(selected.kind) : null
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
  const spinGhost = (delta: number) => {
    if (!placing) return
    setPlacing({ ...placing, rot: (placing.rot ?? 0) + delta })
  }

  const activeStyle = category === 'floor'
    ? { key: 'floor', options: ROOM_STYLES, value: room.floor, set: state.setFloor }
    : category === 'wallStyle'
      ? { key: 'wall', options: WALL_STYLES, value: room.wall, set: state.setWall }
      : category === 'mood'
        ? { key: 'mood', options: MOODS, value: room.mood, set: state.setMood }
        : null

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
                <button type="button" className="ys-btn ys-btn--ghost ys-btn--sm" onClick={() => spinGhost(Math.PI / 8)}>
                  {t('YuviStudio.room.rotate')}
                </button>
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

      {activeStyle && <section className="ys-section">
        <div className="ys-section__head">
          <h2 className="ys-section__title">{t(`YuviStudio.room.${activeStyle.key}`)}</h2>
        </div>
        <div className="ys-chips">
          {activeStyle.options.map((id) => (
            <button
              key={id}
              type="button"
              className={`ys-chip${activeStyle.value === id ? ' is-active' : ''}`}
              onClick={() => activeStyle.set(id)}
            >
              {t(`YuviStudio.room.${activeStyle.key}.${id}`)}
            </button>
          ))}
        </div>
      </section>}

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
                thumb={roomThumbnails[item.kind]}
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
