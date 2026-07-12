// @ts-nocheck
/* eslint-disable */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getLearnerState, updateLearnerState } from '../../services/api'
import type { YubiAvatarHandle } from './YubiAvatar3D'
import {
  DEFAULT_DESIGN, cloneDesign, normalizeDesign,
  type YubiColors, type YubiDesign, type YubiSlot, type YubiVariant,
} from './yubiDesign'
import { type YubiAsset } from './yubiAssets'
import { useYubiDesign } from './YubiDesignProvider'

/**
 * Shared studio state + design mutations, used by both the routed studio page
 * and the animated overlay so the two never diverge.
 */
export function useStudioDesign(autoLoad = true) {
  const {
    refresh: refreshSavedDesign,
    applySavedDesign,
  } = useYubiDesign()
  const avatarRef = useRef<YubiAvatarHandle | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [design, setDesign] = useState<YubiDesign>(() => cloneDesign(DEFAULT_DESIGN))
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(() => new Set())
  const [activeTab, setActiveTab] = useState<YubiSlot | 'colors'>('headTop')
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

  const isLocked = (asset: YubiAsset) => Boolean(asset.requirementKey) && !unlockedIds.has(asset.id)

  const equip = (slot: YubiSlot, id: string | null) => {
    setDesign((prev) => ({ ...prev, equipped: { ...prev.equipped, [slot]: id } }))
    avatarRef.current?.equip(slot, id, true)
  }
  const setVariant = (variant: YubiVariant) => {
    setDesign((prev) => ({ ...prev, variant }))
    avatarRef.current?.setVariant(variant, true)
  }
  const setColor = (key: keyof YubiColors, hex: string) => {
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
