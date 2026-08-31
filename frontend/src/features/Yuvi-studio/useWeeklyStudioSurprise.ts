import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost } from '../../services/api'

export interface WeeklyStudioSurprise {
  available: boolean
  week: string
  state?: 'covered' | 'ready' | 'claimed'
  goal?: { title: string }
  reward_kind?: string
}

export function useWeeklyStudioSurprise(reloadKey?: string, enabled = false) {
  const [surprise, setSurprise] = useState<WeeklyStudioSurprise | null>(null)
  const [claimedRewards, setClaimedRewards] = useState<string[]>([])

  useEffect(() => {
    let active = true
    setSurprise(null)
    setClaimedRewards([])
    if (!enabled) return () => { active = false }
    void Promise.all([
      apiGet<WeeklyStudioSurprise>('/api/studio/weekly-surprise'),
      apiGet<{ items: string[] }>('/api/studio/surprise-rewards'),
    ]).then(([next, rewards]) => {
      if (!active) return
      setSurprise(next)
      setClaimedRewards(rewards.items)
    }).catch(() => { if (active) setSurprise({ available: false, week: '' }) })
    return () => { active = false }
  }, [reloadKey, enabled])

  const claim = useCallback(async () => {
    const claimed = await apiPost<{ week: string; state: 'claimed'; reward_kind: string }>('/api/studio/weekly-surprise/claim', {})
    setSurprise({ available: false, week: claimed.week, state: 'claimed' })
    setClaimedRewards((current) => current.includes(claimed.reward_kind) ? current : [...current, claimed.reward_kind])
    return claimed.reward_kind
  }, [])

  return { surprise, claimedRewards, claim }
}