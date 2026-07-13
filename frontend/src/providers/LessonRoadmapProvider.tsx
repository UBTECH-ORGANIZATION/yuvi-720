import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { LearningUnitDTO } from '../services/learning'

export interface LessonRoadmapSnapshot {
  unit: LearningUnitDTO
  activeComponentId: string | null
  travellingFromId: string | null
}

interface LessonRoadmapContextValue {
  snapshot: LessonRoadmapSnapshot | null
  publish: (snapshot: LessonRoadmapSnapshot) => void
  clear: () => void
}

const LessonRoadmapContext = createContext<LessonRoadmapContextValue | null>(null)

/** Shares the active evidence-backed lesson journey with the permanent Coach rail. */
export function LessonRoadmapProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<LessonRoadmapSnapshot | null>(null)
  const publish = useCallback((next: LessonRoadmapSnapshot) => setSnapshot(next), [])
  const clear = useCallback(() => setSnapshot(null), [])
  const value = useMemo(() => ({ snapshot, publish, clear }), [clear, publish, snapshot])

  return (
    <LessonRoadmapContext.Provider value={value}>
      {children}
    </LessonRoadmapContext.Provider>
  )
}

export function useLessonRoadmap() {
  const value = useContext(LessonRoadmapContext)
  if (!value) throw new Error('useLessonRoadmap must be used inside LessonRoadmapProvider')
  return value
}
