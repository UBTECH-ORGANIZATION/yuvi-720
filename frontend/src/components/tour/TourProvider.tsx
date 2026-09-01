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
import { useOnboarding } from '../../providers/OnboardingProvider'
import { SpotlightOverlay } from './SpotlightOverlay'
import { TourGuide } from './TourGuide'
import { TourStepCard } from './TourStepCard'
import { TEACHER_TOUR_ID, canTakeTeacherTour, teacherTour } from './steps/teacherTour'
import { LEARNER_TOUR_ID, canTakeLearnerTour, learnerTour } from './steps/learnerTour'
import {
  needsStudentParam, routeForStep, type TourDefinition, type TourStep,
} from './steps/types'
import { useTargetRect } from './useTargetRect'

interface TourParams {
  studentId?: string | null
  /** Interpolated into the step strings — today just the learner's name. */
  values?: Record<string, string | number>
}

interface TourValue {
  isActive: boolean
  /** Yuvi is out flying the tour, so the dock must not render a second one. */
  isGuideFlying: boolean
  hasCompleted: (tourId: string) => boolean
  startTour: (tourId: string, params?: TourParams) => void
}

const TourContext = createContext<TourValue | null>(null)

const TOURS: Record<string, TourDefinition> = {
  [TEACHER_TOUR_ID]: teacherTour,
  [LEARNER_TOUR_ID]: learnerTour,
}

const DEFAULT_PADDING = 10

/* Yuvi greets a child the way a person would. A display name carries a family
   name the learner never uses about themselves. */
function firstNameOf(name: string) {
  return name.trim().split(/\s+/)[0] || name
}

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
  const { stage, verified } = useOnboarding()
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

  const steps = tourId ? TOURS[tourId]?.steps ?? [] : []
  const step: TourStep | null = steps[index] ?? null
  const guideStyle = tourId ? TOURS[tourId]?.guide ?? 'card' : 'card'
  const dismissible = tourId ? TOURS[tourId]?.dismissible ?? true : true

  const startTour = useCallback((id: string, next: TourParams = {}) => {
    const definition = TOURS[id]
    if (!definition) return
    /* The name is filled in here rather than at each call site: every entry
       point wants the same greeting, and a caller that forgets would render a
       raw `{name}` at a child. */
    const values = {
      name: firstNameOf(user?.display_name ?? ''),
      ...(next.values ?? {}),
    }
    setParams({ ...next, values })
    stride.current = 1
    setIndex(0)
    setTourId(id)
    /* Only tours that actually name a student pay for the lookup. The resolver
       reads the teacher roster, so firing it for the learner tour would have a
       child's browser call two endpoints their account is forbidden from. */
    if (!next.studentId && resolveParams && needsStudentParam(definition.steps)) {
      setParamsReady(false)
      void resolveParams()
        .then((resolved) => setParams((current) => ({ ...current, ...resolved })))
        .catch(() => undefined)
        .finally(() => setParamsReady(true))
    } else {
      setParamsReady(true)
    }
  }, [resolveParams, user])

  /* Record a tour as seen. Append-only and slug-validated on the server, so
     calling it twice is free and calling it early is safe. Retried once,
     because the entire "shown exactly once" guarantee rests on this write
     landing — a dropped request means the tour greets the child again on their
     next login, which is the failure this whole preference exists to prevent. */
  const markSeen = useCallback((id: string) => {
    void updatePreferences({ tours_completed: [id] })
      .catch(() => new Promise((resolve) => window.setTimeout(resolve, 2000))
        .then(() => updatePreferences({ tours_completed: [id] })))
      .catch(() => undefined)
  }, [updatePreferences])

  const finish = useCallback((id: string | null) => {
    setTourId(null)
    setIndex(0)
    if (!id) return
    markSeen(id)
  }, [markSeen])

  // Route the step needs. `undefined` = stay put, `null` = unresolvable → skip.
  const wantedRoute = step ? routeForStep(step, params) : undefined

  const advance = useCallback((by: number) => {
    stride.current = by
    setIndex((current) => current + by)
  }, [])

  /* A step the learner completes by going somewhere themselves. While they are
     on the awaited route the step's own route is NOT enforced below, or the
     click the step just asked for would be undone in the same commit. */
  const arrived = Boolean(step?.awaitRoute)
    && route.split('?')[0] === step?.awaitRoute

  useEffect(() => {
    if (arrived) advance(1)
  }, [arrived, advance])

  // Land on the step's route before measuring, or the target is guaranteed
  // missing and every cross-route step would skip itself.
  // Matched on PATHNAME only, both sides: a step may carry a query
  // (`?view=table` opens the roster in manage mode) that the address bar will
  // not echo back — comparing it verbatim would re-navigate every render,
  // which is the exact loop the route-remount comment in App.tsx records.
  useEffect(() => {
    if (!step || !wantedRoute || arrived) return
    if (route.split('?')[0] !== wantedRoute.split('?')[0]) navigate(wantedRoute)
  }, [step, wantedRoute, route, arrived])

  /* Both signals, because they mean different things: the stored preference is
     a choice made inside the product, the media query is the one made at OS
     level. Either is enough to stop the tour animating. */
  const reducedMotion = Boolean(user?.preferences?.reduced_motion)
    || (typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

  const onRoute = !wantedRoute || route.split('?')[0] === wantedRoute.split('?')[0]
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

  // Auto-start once per tour, on the first arrival in the app it belongs to.
  // A Set rather than one flag: an account that both teaches and learns must be
  // able to receive each tour on its own lane, and a single latch would give
  // whichever lane they opened first and silently swallow the other.
  const autoStarted = useRef(new Set<string>())

  useEffect(() => {
    if (!user || autoStarted.current.has(TEACHER_TOUR_ID)) return
    if (!route.startsWith('/teacher')) return
    /* The teacher role, not "teacher or admin" — App.tsx guards `/teacher` on
       exactly `isTeacher`, so an admin-only account lands on an error page
       there. Auto-starting a tour on top of that would walk them through
       screens they cannot open. Admins who also teach (the normal case) still
       get it, because they hold both roles. */
    if (!canTakeTeacherTour(user.roles)) return
    if (completed.has(TEACHER_TOUR_ID)) return
    autoStarted.current.add(TEACHER_TOUR_ID)
    startTour(TEACHER_TOUR_ID)
  }, [user, route, completed, startTour])

  useEffect(() => {
    if (!user || autoStarted.current.has(LEARNER_TOUR_ID)) return
    if (!route.startsWith('/student-dashboard')) return
    if (!canTakeLearnerTour(user.roles)) return
    /* Onboarding owns the screen until mapping and profile verification are
       done, and it is already a Yuvi-led flow. A tour opening over it would put
       two companions on one screen — and the dashboard it narrates is not even
       reachable yet.
       `verified`, not just `done`: a failed learner-state read also resolves to
       `done` so nobody is trapped, and offering the one-time tour on the back of
       a request that never answered would spend it on a network blip. */
    if (stage !== 'done' || !verified) return
    if (completed.has(LEARNER_TOUR_ID)) return
    autoStarted.current.add(LEARNER_TOUR_ID)
    /* Recorded the moment it is OFFERED, not when it is finished. What must
       happen exactly once is the offer: a child who closes the tab on step two
       has still had their first-login tour, and greeting them with it again on
       every login until they sit through the whole thing is the behaviour this
       is here to prevent. The menu keeps a way back in for anyone who wants it.
       The teacher tour deliberately still records on completion — a teacher can
       dismiss theirs, so for them "seen" really does mean "got to the end". */
    markSeen(LEARNER_TOUR_ID)
    startTour(LEARNER_TOUR_ID)
  }, [user, route, stage, verified, completed, startTour, markSeen])

  /* Yuvi cannot be in two places. While the guide is up the dock stands its own
     avatar down, and on the `landing` step the guide bows out so the dock is
     the one he arrives at — which is also why only one WebGL context is ever
     alive. */
  const guideFlying = tourId !== null && guideStyle === 'flying' && !step?.landing

  const value = useMemo<TourValue>(() => ({
    isActive: tourId !== null,
    isGuideFlying: guideFlying,
    hasCompleted: (id: string) => completed.has(id),
    startTour,
  }), [tourId, guideFlying, completed, startTour])

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
            onDismiss={dismissible ? () => finish(tourId) : undefined}
          />
          {guideFlying ? (
            <TourGuide
              rect={measured}
              placement={step.placement}
              padding={step.padding ?? DEFAULT_PADDING}
              isRtl={direction === 'rtl'}
              reducedMotion={reducedMotion}
            />
          ) : null}
          <TourStepCard
            titleKey={step.titleKey}
            bodyKey={step.bodyKey}
            values={params.values}
            placement={step.placement}
            rect={measured}
            index={index}
            total={steps.length}
            isRtl={direction === 'rtl'}
            onBack={() => advance(-1)}
            onNext={() => advance(1)}
            onSkip={dismissible ? () => finish(tourId) : undefined}
          />
        </>
      ) : null}
    </TourContext.Provider>
  )
}

export function useTour(): TourValue {
  const value = useContext(TourContext)
  // A no-op outside the provider: a shared button should not have to know which
  // shell it is in, and the landing page mounts neither.
  return value ?? {
    isActive: false,
    isGuideFlying: false,
    hasCompleted: () => true,
    startTour: () => undefined,
  }
}
