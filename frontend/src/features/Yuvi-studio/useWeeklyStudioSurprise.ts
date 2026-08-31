import { useEffect, useState } from 'react'
import { apiGet } from '../../services/api'

export interface WeeklyStudioSurprise {
  available: boolean
  week: string
  state?: 'covered' | 'revealed'
  goal?: { title: string }
  reward_kind?: string
}

export function useWeeklyStudioSurprise(reloadKey?: string, enabled = false) {
  const [surprise, setSurprise] = useState<WeeklyStudioSurprise | null>(null)

  useEffect(() => {
    let active = true
    setSurprise(null)
    if (!enabled) return () => { active = false }
    void apiGet<WeeklyStudioSurprise>('/api/studio/weekly-surprise')
      .then((next) => { if (active) setSurprise(next) })
      .catch(() => { if (active) setSurprise({ available: false, week: '' }) })
    return () => { active = false }
  }, [reloadKey, enabled])

  return surprise
}