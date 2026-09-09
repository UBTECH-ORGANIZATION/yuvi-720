// @ts-nocheck
/* eslint-disable */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getLearnerState, updateLearnerState } from '../../services/api'
import {
  DEFAULT_ROOM, MAX_ROOM_ITEMS, cloneRoom, newItemUid, normalizeRoom, resetRoom, sameRoom, switchRoomWorld, syncActiveWorld,
  type MoodId, type RoomDesign, type RoomItem, type RoomStyleId, type StationId, type WallAnchor, type WallStyleId,
} from './RoomDesign'
import { roomItemSpec } from './RoomCatalog'
import { reconcileItemsForLayout, reconcileStationsForLayout, roomLayout, wallAnchorAt, type RoomLayoutId } from './RoomLayouts.ts'

const ROOM_PROP_SCALE = 1.75

/**
 * The learner's own room: what they placed, where, and how the space is lit.
 *
 * Mirrors `useStudioDesign` on purpose — same `baseline`/`dirty` contract and
 * the same boolean `save()` — so the studio's one exit guard can watch both the
 * avatar and the room without special cases.
 */
export function useRoomDesign(autoLoad = true, reloadKey?: string) {
  const [loaded, setLoaded] = useState(false)
  const [room, setRoom] = useState<RoomDesign>(() => cloneRoom(DEFAULT_ROOM))
  const [baseline, setBaseline] = useState<RoomDesign>(() => cloneRoom(DEFAULT_ROOM))
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  // `completeTutorial` is reached from a memoised card, so it must not read the
  // room out of a closure that may be a few edits behind.
  const roomRef = useRef(room)
  useEffect(() => { roomRef.current = room }, [room])

  const load = useCallback(async () => {
    setLoaded(false)
    try {
      const state = await getLearnerState()
      const stored = normalizeRoom(state.room)
      setRoom(stored)
      setBaseline(cloneRoom(stored))
    } catch { /* an empty room is a perfectly good starting point */ }
    setLoaded(true)
  }, [reloadKey])

  useEffect(() => { if (autoLoad) void load() }, [autoLoad, load])

  const full = room.items.length >= MAX_ROOM_ITEMS

  /** Drop a new prop on the floor and select it, so it can be adjusted at once. */
  const place = (kind: string, x: number, z: number, rot = 0, wallAnchor?: WallAnchor) => {
    const spec = roomItemSpec(kind)
    if (!spec || full) return null
    const uid = newItemUid()
    setRoom((prev) => ({
      ...prev,
      items: [...prev.items, { uid, kind, x, z, rot, ...(spec.placement === 'wall' ? { wallAnchor: wallAnchor ?? wallAnchorAt(roomLayout(prev.activeLayoutId), { x, z }) } : {}), tint: spec.tintable ? spec.tint : undefined }],
    }))
    setSelectedUid(uid)
    return uid
  }

  const patchItem = (uid: string, patch: Partial<RoomItem>) => {
    setRoom((prev) => ({
      ...prev,
      items: prev.items.map((item) => (item.uid === uid ? { ...item, ...patch } : item)),
    }))
  }

  const move = (uid: string, x: number, z: number, wallAnchor?: WallAnchor) => {
    const item = roomRef.current.items.find((entry) => entry.uid === uid)
    patchItem(uid, {
      x,
      z,
      ...(item && roomItemSpec(item.kind)?.placement === 'wall'
        ? { wallAnchor: wallAnchor ? { ...wallAnchor, height: item.wallAnchor?.height ?? wallAnchor.height } : wallAnchorAt(roomLayout(roomRef.current.activeLayoutId), { x, z }, item.wallAnchor?.height ?? 0) }
        : {}),
    })
  }
  const rotate = (uid: string, delta: number) => {
    setRoom((prev) => ({
      ...prev,
      items: prev.items.map((item) => (item.uid === uid ? { ...item, rot: item.rot + delta } : item)),
    }))
  }
  const tint = (uid: string, hex: string) => patchItem(uid, { tint: hex })
  const remove = (uid: string) => {
    setRoom((prev) => ({ ...prev, items: prev.items.filter((item) => item.uid !== uid) }))
    setSelectedUid((prev) => (prev === uid ? null : prev))
  }
  const clear = () => {
    setRoom((prev) => ({ ...prev, items: [], storedItems: [] }))
    setSelectedUid(null)
  }

  /** A teacher-approved Studio reward becomes ordinary furniture exactly once. */
  const materializeWeeklyReward = async (uid: string, kind: string, x: number, z: number, rot = 0) => {
    if (roomRef.current.items.some((item) => item.uid === uid) || !roomItemSpec(kind)) return true
    const spec = roomItemSpec(kind)!
    const next = cloneRoom(roomRef.current)
    next.items.push({ uid, kind, x, z, rot, tint: spec.tintable ? spec.tint : undefined })
    roomRef.current = next
    setRoom(next)
    return save(next)
  }

  const setFloor = (floor: RoomStyleId) => setRoom((prev) => ({ ...prev, floor }))
  const setWall = (wall: WallStyleId) => setRoom((prev) => ({ ...prev, wall }))
  const setMood = (mood: MoodId) => setRoom((prev) => ({ ...prev, mood }))

  /** Each world restores its own design; stations and surprise rewards travel. */
  const setActiveLayout = async (activeLayoutId: RoomLayoutId) => {
    const current = cloneRoom(roomRef.current)
    if (current.activeLayoutId === activeLayoutId) return { ok: true, relocatedUids: [] as string[], hiddenItems: [] as RoomItem[] }
    const switched = switchRoomWorld(current, activeLayoutId)
    const reconciliation = reconcileItemsForLayout(roomLayout(activeLayoutId), switched.items, switched.storedItems, {
      radiusFor: (item) => (roomItemSpec(item.kind)?.radius ?? 0.5) * ROOM_PROP_SCALE,
      isWallItem: (item) => roomItemSpec(item.kind)?.placement === 'wall',
      sourceLayout: roomLayout(activeLayoutId),
    })
    const stationReconciliation = reconcileStationsForLayout(roomLayout(activeLayoutId), current.stations, reconciliation.items, {
      radiusFor: () => 1.6,
      itemRadiusFor: (item) => (roomItemSpec(item.kind)?.radius ?? 0.5) * ROOM_PROP_SCALE,
      isWallItem: (item) => roomItemSpec(item.kind)?.placement === 'wall',
    })
    const next = {
      ...switched,
      items: reconciliation.items,
      storedItems: reconciliation.storedItems,
      stations: stationReconciliation.stations,
    }
    roomRef.current = next
    setRoom(next)
    const ok = await save(next)
    if (!ok) {
      roomRef.current = current
      setRoom(current)
    }
    return { ok, relocatedUids: reconciliation.relocatedUids, hiddenItems: reconciliation.hiddenItems }
  }

  /** Stations are furniture too: the learner decides where their room's doors are. */
  const moveStation = (id: StationId, x: number, z: number, rot?: number) => {
    setRoom((prev) => ({
      ...prev,
      stations: {
        ...prev.stations,
        [id]: { x, z, rot: rot ?? prev.stations[id].rot, placed: true },
      },
    }))
  }
  const rotateStation = (id: StationId, delta: number) => {
    setRoom((prev) => ({
      ...prev,
      stations: {
        ...prev.stations,
        [id]: { ...prev.stations[id], rot: prev.stations[id].rot + delta },
      },
    }))
  }

  const reset = () => {
    setRoom(resetRoom)
    setSelectedUid(null)
  }

  const save = async (next?: RoomDesign) => {
    if (saving) return false
    const payload = syncActiveWorld(next ?? room)
    setSaving(true)
    let ok = false
    try {
      const state = await updateLearnerState({ room: payload })
      const stored = normalizeRoom(state.room ?? payload)
      setRoom(stored)
      setBaseline(cloneRoom(stored))
      setJustSaved(true)
      window.setTimeout(() => setJustSaved(false), 1600)
      ok = true
    } catch { /* nothing destructive */ }
    finally { setSaving(false) }
    return ok
  }

  /**
   * The walkthrough is over. It is written straight through rather than left
   * for the next save, because a learner who skips it and walks away must not
   * be handed the same tutorial again on their next visit.
   */
  const completeTutorial = async () => {
    const next = { ...cloneRoom(roomRef.current), tutorialDone: true }
    setRoom(next)
    return save(next)
  }

  /** The welcome sequence is remembered separately from the room tutorial. */
  const completeIntro = async (nextRoom?: RoomDesign) => {
    const next = { ...cloneRoom(nextRoom ?? roomRef.current), introDone: true }
    setRoom(next)
    return save(next)
  }

  /** True while the room on screen is not the room on the server. */
  const dirty = loaded && !sameRoom(room, baseline)
  const selected = room.items.find((item) => item.uid === selectedUid) ?? null

  return {
    loaded, room, items: room.items, full, dirty, saving, justSaved,
    selectedUid, setSelectedUid, selected,
    place, move, rotate, tint, remove, clear, materializeWeeklyReward,
    setFloor, setWall, setMood, setActiveLayout, moveStation, rotateStation, completeTutorial, completeIntro, reset, save, load,
  }
}

export type RoomDesignState = ReturnType<typeof useRoomDesign>
