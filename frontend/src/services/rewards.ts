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

export function getWallet() {
  return apiGet<SparkWallet>('/api/rewards/wallet')
}

export function getShop() {
  return apiGet<{ items: ShopItem[]; wallet: SparkWallet }>('/api/rewards/catalog')
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
