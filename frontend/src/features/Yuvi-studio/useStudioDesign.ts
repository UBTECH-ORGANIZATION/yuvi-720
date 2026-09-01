// @ts-nocheck
/* eslint-disable */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getLearnerState, updateLearnerState } from '../../services/api'
import { getShop, purchaseAsset, type PurchaseResult, type ShopItem } from '../../services/rewards'
import { useRewards } from '../../providers/RewardsProvider'
import type { YuviAvatarHandle } from './YuviAvatar3D'
import {
  DEFAULT_DESIGN, cloneDesign, normalizeDesign,
  type YuviColors, type YuviDesign, type YuviSlot,
} from './YuviDesign'
import type { YuviAsset } from './YuviAssets'
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
  const { wallet, setWallet } = useRewards()
  const avatarRef = useRef<YuviAvatarHandle | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [design, setDesign] = useState<YuviDesign>(() => cloneDesign(DEFAULT_DESIGN))
  // The last design that is actually stored on the server. Anything the learner
  // does after that is unsaved work we must not throw away silently.
  const [baseline, setBaseline] = useState<YuviDesign>(() => cloneDesign(DEFAULT_DESIGN))
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(() => new Set())
  const [propUnlocks, setPropUnlocks] = useState<Set<string>>(() => new Set())
  // id -> locale key naming the badge or streak that grants it.
  const [requirements, setRequirements] = useState<Record<string, string>>({})
  const [streak, setStreak] = useState(0)
  const [shop, setShop] = useState<Record<string, ShopItem>>({})
  const [buying, setBuying] = useState<string | null>(null)
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
      setBaseline(cloneDesign(savedDesign))
      setUnlockedIds(new Set(Array.isArray(state.avatar_unlocks) ? state.avatar_unlocks : []))
    } catch { /* keep default */ }
    try {
      // The shop is the only source of prices — the client never sets one.
      // The same read settles any badge/streak grant the learner has earned,
      // so opening the studio is when a new reward becomes real.
      const catalog = await getShop()
      setShop(Object.fromEntries(catalog.items.map((item) => [item.id, item])))
      setWallet(catalog.wallet)
      setPropUnlocks(new Set(catalog.roomUnlocks ?? []))
      setStreak(catalog.streak ?? 0)
      setRequirements(Object.fromEntries((catalog.unlocks ?? []).map((row) => [row.id, row.requirementKey])))
      // A cosmetic granted by this very request would otherwise stay locked
      // until the next reload, since the state read above happened first.
      for (const row of catalog.unlocks ?? []) {
        if (row.kind === 'avatar' && row.owned) setUnlockedIds((prev) => new Set(prev).add(row.id))
      }
    } catch { /* shop simply stays unavailable */ }
    setLoaded(true)
  }, [refreshSavedDesign, setWallet])

  useEffect(() => { if (autoLoad) void load() }, [autoLoad, load])

  const isLocked = (asset: YuviAsset) => Boolean(asset.requirementKey) && !unlockedIds.has(asset.id)
  /** True when this room prop has to be earned and has not been. */
  const isPropLocked = (kind: string) => kind in requirements && !propUnlocks.has(kind)
  /** Locale key naming what earns an item, for the lock tooltip. */
  const requirementFor = (id: string): string | undefined => requirements[id]
  /** Sparks price for a locked item, or null when it can only be earned. */
  const priceOf = (assetId: string): number | null => shop[assetId]?.price ?? null
  const canAfford = (assetId: string) => {
    const price = priceOf(assetId)
    return price !== null && (wallet?.balance ?? 0) >= price
  }

  /** Spend sparks on one item; the server charges and grants, we mirror it. */
  const buy = async (assetId: string): Promise<PurchaseResult | null> => {
    if (buying) return null
    setBuying(assetId)
    try {
      const result = await purchaseAsset(assetId)
      setWallet(result.wallet)
      if (result.ok) {
        setUnlockedIds((prev) => new Set(prev).add(assetId))
      }
      return result
    } catch {
      return null
    } finally {
      setBuying(null)
    }
  }

  const equip = (slot: YuviSlot, id: string | null) => {
    setDesign((prev) => ({ ...prev, equipped: { ...prev.equipped, [slot]: id } }))
    avatarRef.current?.equip(slot, id, true)
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
    if (saving) return false
    setSaving(true)
    let ok = false
    try {
      const state = await updateLearnerState({ yuvi_design: design })
      const stored = normalizeDesign(state.yuvi_design ?? design)
      applySavedDesign(stored)
      setBaseline(cloneDesign(stored))
      setJustSaved(true)
      window.setTimeout(() => setJustSaved(false), 1600)
      ok = true
    } catch { /* nothing destructive */ }
    finally { setSaving(false) }
    return ok
  }

  /** True while the stage shows something the learner has not stored yet. */
  const dirty = loaded && JSON.stringify(design) !== JSON.stringify(baseline)

  return {
    avatarRef, loaded, design, unlockedIds, activeTab, setActiveTab,
    muted, setMuted, justSaved, saving, dirty,
    isLocked, isPropLocked, requirementFor, streak,
    equip, setColor, reset, save, load,
    wallet, priceOf, canAfford, buy, buying,
  }
}

export type StudioDesign = ReturnType<typeof useStudioDesign>
