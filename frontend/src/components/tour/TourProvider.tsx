/* Tour state: which step, on which route, and whether this user has seen it.
 *
 * Two things carry all the weight here.
 *
 * **Skipping is normal, not exceptional.** A step whose panel never mounts — an
 * empty roster, a group with no live students, a slow fetch — is stepped over in
 * whichever direction the teacher was already travelling. That is why the tour
 * can point at panels that only exist when there is data to fill them, and why
 * `routeForStep` returning `null` (no student to open) is handled the same way
 * as a missing DOM node.
 *
 * **Completion is server-side.** `preferences.tours_completed` already arrives
 * with `/api/auth/me`, so the decision to auto-open is made on the first render
 * with no extra fetch and no flash of a tour that was already dismissed. Storing
 * it in localStorage is a project rule violation and would also mean the tour
 * reappears on every new device, which is exactly the annoying behaviour this
 * preference exists to prevent.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import { navigate, useRoute } from '../../app/router'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../providers/AuthProvider'
import { SpotlightOverlay } from './SpotlightOverlay'
import { TourStepCard } from './TourStepCard'
import {
  TEACHER_TOUR_ID, canTakeTeacherTour, routeForStep, teacherTourSteps, type TourStep,
} from './steps/teacherTour'
import { useTargetRect } from './useTargetRect'

interface TourParams { studentId?: string | null }

interface TourValue {
  isActive: boolean
  hasCompleted: (tourId: string) => boolean
  startTour: (tourId: string, params?: TourParams) => void
}

const TourContext = createContext<TourValue | null>(null)

const TOURS: Record<string, TourStep[]> = { [TEACHER_TOUR_ID]: teacherTourSteps }

const DEFAULT_PADDING = 10

interface ProviderProps {
  children: ReactNode
  /** Supplies the ids the steps need (today: one student to open a profile on).
      Kept as a prop rather than read from TeacherScopeProvider so this module
      stays generic — the learner app will need its own resolver, not this one. */
  resolveParams?: () => Promise<TourParams>
}

export function TourProvider({ children, resolveParams }: ProviderProps) {
  const { user, updatePreferences } = useAuth()
  const { direction } = useI18n()
  const route = useRoute()

  const [tourId, setTourId] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [params, setParams] = useState<TourParams>({})
  // Until the resolver settles we do not yet know whether a student-scoped step
  // is unreachable — skipping on a slow fetch would drop the profile steps for
  // no reason. `true` when there is nothing to wait for.
  const [paramsReady, setParamsReady] = useState(true)
  // Direction of travel, so a run of missing targets is skipped *past* rather
  // than bounced between.
  const stride = useRef(1)

  const completed = useMemo(
    () => new Set(user?.preferences?.tours_completed ?? []), [user])

  const steps = tourId ? TOURS[tourId] ?? [] : []
  const step: TourStep | null = steps[index] ?? null

  const startTour = useCallback((id: string, next: TourParams = {}) => {
    if (!TOURS[id]) return
    setParams(next)
    stride.current = 1
    setIndex(0)
    setTourId(id)
    // Resolved in the background: the first steps do not need it, and blocking
    // the tour on a roster fetch would put a spinner in front of a welcome card.
    // If it never resolves, the profile steps skip themselves.
    if (!next.studentId && resolveParams) {
      setParamsReady(false)
      void resolveParams()
        .then((resolved) => setParams((current) => ({ ...current, ...resolved })))
        .catch(() => undefined)
        .finally(() => setParamsReady(true))
    } else {
      setParamsReady(true)
    }
  }, [resolveParams])

  const finish = useCallback((id: string | null) => {
    setTourId(null)
    setIndex(0)
    if (!id) return
    // Fire-and-forget: a failed write means the tour offers itself again, which
    // is a far better failure than blocking the teacher behind a spinner.
    void updatePreferences({ tours_completed: [id] }).catch(() => undefined)
  }, [updatePreferences])

  // Route the step needs. `undefined` = stay put, `null` = unresolvable → skip.
  const wantedRoute = step ? routeForStep(step, params) : undefined

  const advance = useCallback((by: number) => {
    stride.current = by
    setIndex((current) => current + by)
  }, [])

  // Land on the step's route before measuring, or the target is guaranteed
  // missing and every cross-route step would skip itself.
  useEffect(() => {
    if (!step || !wantedRoute) return
    if (route.split('?')[0] !== wantedRoute) navigate(wantedRoute)
  }, [step, wantedRoute, route])

  /* Both signals, because they mean different things: the stored preference is
     a choice made inside the product, the media query is the one made at OS
     level. Either is enough to stop the tour animating. */
  const reducedMotion = Boolean(user?.preferences?.reduced_motion)
    || (typeof window !== 'undefined'
        && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

  const onRoute = !wantedRoute || route.split('?')[0] === wantedRoute
  const rect = useTargetRect(step && onRoute ? step.target : null, reducedMotion)

  // Past the end (or before the start) means the tour is over.
  useEffect(() => {
    if (!tourId) return
    if (index >= steps.length) finish(tourId)
    else if (index < 0) setIndex(0)
  }, [index, steps.length, tourId, finish])

  // A step that cannot be shown gets stepped over in the current direction.
  useEffect(() => {
    if (!step) return
    if (wantedRoute === null) {
      if (paramsReady) advance(stride.current || 1)
      return
    }
    if (step.target && onRoute && rect === 'missing') advance(stride.current || 1)
  }, [step, wantedRoute, onRoute, rect, paramsReady, advance])

  // Auto-start once, on a teacher's first arrival in the teacher app.
  const autoStarted = useRef(false)
  useEffect(() => {
    if (autoStarted.current || !user) return
    if (!route.startsWith('/teacher')) return
    /* The teacher role, not "teacher or admin" — App.tsx guards `/teacher` on
       exactly `isTeacher`, so an admin-only account lands on an error page
       there. Auto-starting a tour on top of that would walk them through
       screens they cannot open. Admins who also teach (the normal case) still
       get it, because they hold both roles. */
    if (!canTakeTeacherTour(user.roles)) return
    if (completed.has(TEACHER_TOUR_ID)) return
    autoStarted.current = true
    startTour(TEACHER_TOUR_ID)
  }, [user, route, completed, startTour])

  const value = useMemo<TourValue>(() => ({
    isActive: tourId !== null,
    hasCompleted: (id: string) => completed.has(id),
    startTour,
  }), [tourId, completed, startTour])

  const measured = rect && rect !== 'missing' ? rect : null
  /* Show the card as soon as we are on the right route, even while the target
     is still being measured — it simply starts centred with nothing spotlit and
     slides onto the panel when the rect arrives. Gating on `measured` instead
     produced a dead screen for the whole lookup window, which is what made a
     short (and therefore step-skipping) timeout feel necessary. */
  const showing = step !== null && onRoute

  return (
    <TourContext.Provider value={value}>
      {children}
      {showing && step ? (
        <>
          <SpotlightOverlay
            rect={measured}
            padding={step.padding ?? DEFAULT_PADDING}
            interactive={Boolean(step.interactive)}
            reducedMotion={reducedMotion}
            onDismiss={() => finish(tourId)}
          />
          <TourStepCard
            titleKey={step.titleKey}
            bodyKey={step.bodyKey}
            placement={step.placement}
            rect={measured}
            index={index}
            total={steps.length}
            isRtl={direction === 'rtl'}
            onBack={() => advance(-1)}
            onNext={() => advance(1)}
            onSkip={() => finish(tourId)}
          />
        </>
      ) : null}
    </TourContext.Provider>
  )
}

export function useTour(): TourValue {
  const value = useContext(TourContext)
  // A no-op outside the provider: the learner app mounts no tour today, and a
  // shared button should not have to know which shell it is in.
  return value ?? { isActive: false, hasCompleted: () => true, startTour: () => undefined }
}
