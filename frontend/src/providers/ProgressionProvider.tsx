import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode
} from 'react'
import {
  getProgressionLedger, getProgressionStatus, LEVEL_REWARD_EVENT, XP_AWARD_EVENT, type ProgressionStatus,
  type XpAwardBatch, type XpAwardReceipt
} from '../services/progression'
import { useAuth } from './AuthProvider'
import { useRewards } from './RewardsProvider'

interface ProgressionContextValue {
  status: ProgressionStatus | null
  isLoading: boolean
  pendingAwards: XpAwardBatch[]
  applyAward: (receipt: XpAwardReceipt | null | undefined) => void
  dismissAward: () => void
  refresh: () => void
}

const ProgressionContext = createContext<ProgressionContextValue | null>(null)

export function ProgressionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { refresh: refreshRewards } = useRewards()
  const isLearner = Boolean(user?.roles.includes('learner'))
  const [status, setStatus] = useState<ProgressionStatus | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [pendingAwards, setPendingAwards] = useState<XpAwardBatch[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const seenLedgerIds = useRef<Set<string> | null>(null)

  const announceLevelRewards = useCallback((receipts: XpAwardReceipt[]) => {
    const rewards = receipts.flatMap((receipt) => receipt.levelRewards ?? [])
    if (!rewards.length) return
    window.dispatchEvent(new CustomEvent(LEVEL_REWARD_EVENT, { detail: rewards }))
    if (rewards.some((reward) => reward.sparks > 0)) refreshRewards()
  }, [refreshRewards])

  const refresh = useCallback(() => setReloadKey((key) => key + 1), [])
  const applyAward = useCallback((receipt: XpAwardReceipt | null | undefined) => {
    if (!receipt) return
    setStatus(receipt.progression)
    if (receipt.awarded > 0 && !receipt.duplicate) {
      setPendingAwards((current) => [...current, { receipts: [receipt], sparks: 0 }])
    }
  }, [])
  const dismissAward = useCallback(() => {
    setPendingAwards((current) => current.slice(1))
  }, [])

  useEffect(() => {
    if (!isLearner) {
      setStatus(null)
      setPendingAwards([])
      return
    }
    const controller = new AbortController()
    setIsLoading(true)
    getProgressionStatus(controller.signal)
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setIsLoading(false))
    return () => controller.abort()
  }, [isLearner, reloadKey])

  useEffect(() => {
    if (!isLearner) return
    const onAward = (event: Event) => {
      const batch = (event as CustomEvent<XpAwardBatch>).detail
      const receipts = (batch?.receipts ?? []).filter(
        (receipt) => receipt.awarded > 0 && !receipt.duplicate
      )
      if (!receipts.length) return
      if (seenLedgerIds.current) {
        receipts.forEach((receipt) => {
          if (receipt.entry?.id) seenLedgerIds.current?.add(receipt.entry.id)
        })
      }
      setStatus(receipts[receipts.length - 1].progression)
      announceLevelRewards(receipts)
      if (Number(batch.sparks) > 0) refreshRewards()
      setPendingAwards((current) => [
        ...current, { receipts, sparks: Math.max(0, Number(batch.sparks) || 0) }
      ])
    }
    window.addEventListener(XP_AWARD_EVENT, onAward)
    return () => window.removeEventListener(XP_AWARD_EVENT, onAward)
  }, [announceLevelRewards, isLearner, refreshRewards])

  useEffect(() => {
    if (!isLearner) {
      seenLedgerIds.current = null
      return
    }
    let active = true
    const read = async () => {
      try {
        const result = await getProgressionLedger(50)
        if (!active) return
        const known = seenLedgerIds.current
        if (known === null) {
          seenLedgerIds.current = new Set(result.entries.map((entry) => entry.id))
          return
        }
        const fresh = result.entries.filter((entry) => !known.has(entry.id)).reverse()
        result.entries.forEach((entry) => known.add(entry.id))
        if (!fresh.length) return
        setStatus(result.progression)
        const receipts = fresh.map((entry) => ({
          awarded: entry.amount,
          duplicate: false,
          entry,
          progression: result.progression,
          levelRewards: entry.levelRewards ?? []
        }))
        announceLevelRewards(receipts)
        setPendingAwards((current) => [
          ...current,
          {
            sparks: 0,
            receipts
          }
        ])
      } catch {
        /* A later poll catches up from the durable ledger. */
      }
    }
    void read()
    const timer = window.setInterval(() => { void read() }, 5_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [announceLevelRewards, isLearner])

  return (
    <ProgressionContext.Provider value={{
      status, isLoading, pendingAwards, applyAward, dismissAward, refresh
    }}>
      {children}
    </ProgressionContext.Provider>
  )
}

export function useProgression() {
  const value = useContext(ProgressionContext)
  if (!value) throw new Error('useProgression must be used inside ProgressionProvider')
  return value
}