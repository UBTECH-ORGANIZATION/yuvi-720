/* Sparks (F5 → F4): the learner-facing reward currency earned by advancing
   mentoring goals and spent on Yuvi Studio cosmetics. Balances and prices are
   server-authoritative — this module never computes or sends an amount. */

import { apiGet, apiPost } from './api'

export interface SparkWallet {
  balance: number
  lifetimeEarned: number
  lifetimeSpent: number
  dailyEarned: number
  dailyCap: number
  dailyGoals?: number
  dailyGoalCap?: number
  /** How earning works. Goal payouts are per-goal (Yuvi prices each goal), so
      what is fixed is the split across stages and the flat help reward. */
  rules?: SparkRules
}

export type RewardStage = 'started' | 'progressed' | 'summarized'

export interface SparkRules {
  stageShares: Record<string, number>
  help: number
  goalValueRange: [number, number]
}

/** Default share split, used only until the wallet (with the real rules) loads. */
const FALLBACK_SHARES: Record<string, number> = { started: 0.25, progressed: 0.25, summarized: 0.5 }
const FALLBACK_GOAL_VALUE = 30

/** Display-only mirror of the server split, so a goal card can say what the
    next move pays. The server stays the only authority on what is granted. */
export function stageAmount(goalValue: number | undefined, stage: RewardStage, rules?: SparkRules): number {
  const share = (rules?.stageShares || FALLBACK_SHARES)[stage]
  if (!share) return 0
  return Math.max(1, Math.round((goalValue || FALLBACK_GOAL_VALUE) * share))
}

/** One shop row. `price` comes from the server catalog, never from the client. */
export interface ShopItem {
  id: string
  price: number
  slot: string
  tier: number
  owned: boolean
}

/** Outcome of a grant, attached to mentoring responses so the UI can celebrate. */
export interface RewardGrant {
  granted: number
  reason?: string
  capped?: boolean
  duplicate?: boolean
  wallet?: SparkWallet
}

export interface LedgerEntry {
  kind: 'earn' | 'spend' | 'unlock'
  amount: number
  reason: string
  at: string
}

/** One earned-cosmetic row: what exists, what it costs in effort, what is held. */
export interface UnlockRow {
  id: string
  kind: 'avatar' | 'prop'
  /** Locale key describing the badge or streak that grants it. */
  requirementKey: string
  owned: boolean
}

export function getWallet() {
  return apiGet<SparkWallet>('/api/rewards/wallet')
}

export function getShop() {
  return apiGet<{
    items: ShopItem[]
    wallet: SparkWallet
    unlocks: UnlockRow[]
    roomUnlocks: string[]
    /** Current consecutive-day learning streak. */
    streak: number
    newlyUnlocked: string[]
  }>('/api/rewards/catalog')
}

export function getLedger(limit = 20) {
  return apiGet<{ entries: LedgerEntry[] }>(`/api/rewards/ledger?limit=${limit}`)
}

export interface PurchaseResult {
  ok: boolean
  reason?: 'not_for_sale' | 'owned' | 'insufficient' | 'unlock_failed'
  missing?: number
  assetId?: string
  price?: number
  wallet?: SparkWallet
}

/** Buy one cosmetic. Only the id is sent; the server resolves and charges the price. */
export function purchaseAsset(assetId: string) {
  return apiPost<PurchaseResult>('/api/rewards/purchase', { assetId })
}
