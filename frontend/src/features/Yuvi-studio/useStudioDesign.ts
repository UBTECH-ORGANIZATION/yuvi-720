// @ts-nocheck
/* eslint-disable */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getLearnerState, updateLearnerState } from '../../services/api'
import type { YuviAvatarHandle } from './YuviAvatar3D'
import {
  DEFAULT_DESIGN, cloneDesign, normalizeDesign,
  type YuviColors, type YuviDesign, type YuviSlot, type YuviVariant,
} from './YuviDesign'
import { type YuviAsset } from './YuviAssets'
import { useYuviDesign } from './YuviDesignProvider'

/**
 * Shared studio state + design mutations, used by both the routed studio page
 * and the animated overlay so the two never diverge.
 */
export function useStudioDesign(autoLoad = true) {
  const {
    refresh: refreshSavedDesign,
    applySavedDesign,
  } = useYuviDesign()
  const avatarRef = useRef<YuviAvatarHandle | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [design, setDesign] = useState<YuviDesign>(() => cloneDesign(DEFAULT_DESIGN))
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(() => new Set())
  const [activeTab, setActiveTab] = useState<YuviSlot | 'colors'>('headTop')
  const [muted, setMuted] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const [state, savedDesign] = await Promise.all([
        getLearnerState(),
        refreshSavedDesign(),
      ])
      setDesign(savedDesign)
      setUnlockedIds(new Set(Array.isArray(state.avatar_unlocks) ? state.avatar_unlocks : []))
    } catch { /* keep default */ }
    setLoaded(true)
  }, [refreshSavedDesign])

  useEffect(() => { if (autoLoad) void load() }, [autoLoad, load])

  const isLocked = (asset: YuviAsset) => Boolean(asset.requirementKey) && !unlockedIds.has(asset.id)

  const equip = (slot: YuviSlot, id: string | null) => {
    setDesign((prev) => ({ ...prev, equipped: { ...prev.equipped, [slot]: id } }))
    avatarRef.current?.equip(slot, id, true)
  }
  const setVariant = (variant: YuviVariant) => {
    setDesign((prev) => ({ ...prev, variant }))
    avatarRef.current?.setVariant(variant, true)
  }
  const setColor = (key: keyof YuviColors, hex: string) => {
    setDesign((prev) => {
      const colors = { ...prev.colors, [key]: hex }
      avatarRef.current?.setColors(colors, false)
      return { ...prev, colors }
    })
  }
  const reset = () => {
    const next = cloneDesign(DEFAULT_DESIGN)
    setDesign(next)
    avatarRef.current?.applyDesign(next, false)
  }
  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      const state = await updateLearnerState({ avatar: design })
      applySavedDesign(normalizeDesign(state.avatar ?? design))
      setJustSaved(true)
      window.setTimeout(() => setJustSaved(false), 1600)
    } catch { /* nothing destructive */ }
    finally { setSaving(false) }
  }

  return {
    avatarRef, loaded, design, unlockedIds, activeTab, setActiveTab,
    muted, setMuted, justSaved, saving, isLocked, equip, setVariant, setColor, reset, save, load,
  }
}

export type StudioDesign = ReturnType<typeof useStudioDesign>
