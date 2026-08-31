// @ts-nocheck
/* eslint-disable */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getLearnerState, updateLearnerState } from '../../services/api'
import {
  DEFAULT_ROOM, MAX_ROOM_ITEMS, cloneRoom, newItemUid, normalizeRoom, resetRoom, sameRoom,
  type MoodId, type RoomDesign, type RoomItem, type RoomStyleId, type StationId, type WallStyleId,
} from './RoomDesign'
import { roomItemSpec } from './RoomCatalog'

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
  const place = (kind: string, x: number, z: number, rot = 0) => {
    const spec = roomItemSpec(kind)
    if (!spec || full) return null
    const uid = newItemUid()
    setRoom((prev) => ({
      ...prev,
      items: [...prev.items, { uid, kind, x, z, rot, tint: spec.tintable ? spec.tint : undefined }],
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

  const move = (uid: string, x: number, z: number) => patchItem(uid, { x, z })
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
    setRoom((prev) => ({ ...prev, items: [] }))
    setSelectedUid(null)
  }

  const setFloor = (floor: RoomStyleId) => setRoom((prev) => ({ ...prev, floor }))
  const setWall = (wall: WallStyleId) => setRoom((prev) => ({ ...prev, wall }))
  const setMood = (mood: MoodId) => setRoom((prev) => ({ ...prev, mood }))
  /** Stations are furniture too: the learner decides where their room's doors are. */
  const moveStation = (id: StationId, x: number, z: number, rot?: number) => {
    setRoom((prev) => ({
      ...prev,
      stations: {
        ...prev.stations,
        [id]: { x, z, rot: rot ?? prev.stations[id].rot },
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
    const payload = next ?? room
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
  const completeIntro = async () => {
    const next = { ...cloneRoom(roomRef.current), introDone: true }
    setRoom(next)
    return save(next)
  }

  /** True while the room on screen is not the room on the server. */
  const dirty = loaded && !sameRoom(room, baseline)
  const selected = room.items.find((item) => item.uid === selectedUid) ?? null

  return {
    loaded, room, items: room.items, full, dirty, saving, justSaved,
    selectedUid, setSelectedUid, selected,
    place, move, rotate, tint, remove, clear,
    setFloor, setWall, setMood, moveStation, rotateStation, completeTutorial, completeIntro, reset, save, load,
  }
}

export type RoomDesignState = ReturnType<typeof useRoomDesign>
