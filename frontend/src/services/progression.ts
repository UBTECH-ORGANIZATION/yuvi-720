import { apiGet, apiPost } from './api'

export interface ProgressionStatus {
  level: number
  totalXp: number
  currentLevelXp: number
  xpToNext: number | null
  nextLevel: number | null
  nextLevelTotalXp: number | null
  progress: number
  rulesVersion: number
  extraHintTokens: number
  claimedLevelRewards: number[]
}

export interface XpLedgerEntry {
  id: string
  amount: number
  reason: string
  source: Record<string, unknown>
  totalAfter: number
  levelBefore: number
  levelAfter: number
  at: string
  levelRewards?: XpLevelReward[]
}

export interface XpLevelReward {
  level: number
  sparks: number
  extraHintTokens: number
  avatarUnlocks: string[]
  roomUnlocks: string[]
}

export interface XpAwardReceipt {
  awarded: number
  duplicate: boolean
  entry?: XpLedgerEntry
  progression: ProgressionStatus
  levelRewards?: XpLevelReward[]
}

export function getProgressionStatus(signal?: AbortSignal) {
  return apiGet<ProgressionStatus>(
    '/api/progression/status', signal ? { signal } : undefined
  )
}

export function getProgressionLedger(limit = 20, signal?: AbortSignal) {
  return apiGet<{ entries: XpLedgerEntry[]; progression: ProgressionStatus }>(
    `/api/progression/ledger?limit=${limit}`, signal ? { signal } : undefined
  )
}

export function useExtraHintToken(componentId: string, questionId: string) {
  return apiPost<{ ok: true; remaining: number; questionKey: string }>(
    '/api/progression/hint-token/use', { componentId, questionId }
  )
}

export interface XpAwardBatch {
  receipts: XpAwardReceipt[]
  sparks: number
}

export const XP_AWARD_EVENT = 'spark:xp-award'
export const LEVEL_REWARD_EVENT = 'spark:level-reward'