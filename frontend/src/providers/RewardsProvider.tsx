import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { getWallet, type RewardGrant, type SparkWallet } from '../services/rewards'
import { useAuth } from './AuthProvider'

/* RewardsProvider — one shared view of the learner's spark wallet.

   The balance is never computed on the client: surfaces either read the wallet
   the server returned with a grant (`applyGrant`) or refetch. `lastGrant` lets
   whichever surface is mounted celebrate a fresh earn exactly once. */

interface RewardsContextValue {
  wallet: SparkWallet | null
  isLoading: boolean
  /** Newest grant worth announcing (>0 sparks), cleared by `acknowledgeGrant`. */
  lastGrant: RewardGrant | null
  /** Adopt the wallet a mutation already returned — avoids a second round trip. */
  applyGrant: (grant: RewardGrant | undefined | null) => void
  setWallet: (wallet: SparkWallet | undefined | null) => void
  acknowledgeGrant: () => void
  refresh: () => void
}

const RewardsContext = createContext<RewardsContextValue | null>(null)

export function RewardsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  // Anyone with a learner role has a wallet — demo/staff accounts often carry
  // both roles, and a teacher-only account simply has no learner surfaces.
  const isLearner = Boolean(user?.roles.includes('learner'))
  const [wallet, setWalletState] = useState<SparkWallet | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [lastGrant, setLastGrant] = useState<RewardGrant | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const seenGrant = useRef(0)

  const refresh = useCallback(() => setReloadKey((k) => k + 1), [])

  const setWallet = useCallback((next: SparkWallet | undefined | null) => {
    if (next) setWalletState(next)
  }, [])

  const applyGrant = useCallback((grant: RewardGrant | undefined | null) => {
    if (!grant) return
    if (grant.wallet) setWalletState(grant.wallet)
    if (grant.granted > 0) {
      seenGrant.current += 1
      setLastGrant(grant)
    }
  }, [])

  const acknowledgeGrant = useCallback(() => setLastGrant(null), [])

  useEffect(() => {
    if (!isLearner) {
      // Sparks are a learner-only mechanic; teachers never see a balance.
      setWalletState(null)
      return
    }
    let active = true
    setIsLoading(true)
    getWallet()
      .then((data) => {
        if (active) setWalletState(data)
      })
      .catch(() => {
        if (active) setWalletState(null)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [isLearner, reloadKey])

  return (
    <RewardsContext.Provider
      value={{ wallet, isLoading, lastGrant, applyGrant, setWallet, acknowledgeGrant, refresh }}
    >
      {children}
    </RewardsContext.Provider>
  )
}

export function useRewards() {
  const value = useContext(RewardsContext)
  if (!value) throw new Error('useRewards must be used inside RewardsProvider')
  return value
}
