import { LearnerMappingPage } from '../features/learner-mapping/LearnerMappingPage'
import { ResultsPage } from '../features/results/ResultsPage'
import { StudentDashboardPage } from '../features/student-dashboard/StudentDashboardPage'
import { TeacherViewPage } from '../features/teacher-view/TeacherViewPage'
import { MentoringPage } from '../features/mentoring/MentoringPage'
import { LearningPortalPage } from '../features/learning-portal/LearningPortalPage'
import { LessonPage } from '../features/learning-lesson/LessonPage'
import { LomdaCreatorPage } from '../features/learning-create/LomdaCreatorPage'
import { LandingLoginPage } from '../features/landing-login/LandingLoginPage'
import { YuviStudioPage } from '../features/Yuvi-studio/YuviStudioPage'
import { useStudioTransition } from '../features/Yuvi-studio/StudioTransitionProvider'
import { CompanionChat } from '../components/CompanionChat'
import { YuviCompanionDock } from '../components/YuviCompanionDock'
import { SparkToast } from '../components/SparkToast'
import { useEffect } from 'react'
import { ErrorState, LoadingState } from '../components/primitives'
import { useI18n } from '../i18n/I18nProvider'
import { useAuth } from '../providers/AuthProvider'
import { useCompanion } from '../providers/CompanionProvider'
import { STAGE_ROUTE, useOnboarding } from '../providers/OnboardingProvider'
import { navigate, useRoute } from './router'

/* Route guarding lives here because the router is a 19-line pushState wrapper
   with no loader/guard concept. A protected route with no session renders the
   landing page with sign-in already open — deliberately WITHOUT navigating, so
   the URL survives and authenticating drops the user where they were headed. */
const PROTECTED_ROUTES = [
  '/learner-mapping',
  '/results',
  '/yuvi-studio',
  '/student-dashboard',
  '/mentoring',
  '/learning'
]
const TEACHER_ROUTES = ['/teacher-view']

/* Routes a learner may reach before onboarding is finished. Everything else
   (dashboard, learning world, mentoring, studio) is gated until mapping and
   profile verification are done — otherwise those surfaces render against a
   half-built brain. */
const ONBOARDING_ROUTES = ['/learner-mapping', '/results']

function isOnboardingRoute(pathname: string) {
  return ONBOARDING_ROUTES.some((route) => pathname.startsWith(route))
}

/* The mapping questionnaire is a one-time step. Results stay reachable (the
   dashboard links back to the profile summary), but re-answering the
   questionnaire would overwrite a finished mapping, so it is closed for good. */
function isMappingRoute(pathname: string) {
  return pathname.startsWith('/learner-mapping')
}

function isProtected(pathname: string) {
  return PROTECTED_ROUTES.some((route) => pathname.startsWith(route))
}

function isTeacherRoute(pathname: string) {
  return TEACHER_ROUTES.some((route) => pathname.startsWith(route))
}

function isLandingRoute(pathname: string) {
  return pathname === '/' || pathname === ''
}

/* Accounts often carry both roles, so the learner dashboard is home unless this
   account can only teach. */
function homeRoute(roles: string[]) {
  return roles.includes('learner') ? '/student-dashboard' : '/teacher-view'
}

function pageForRoute(pathname: string) {
  if (pathname === '/' || pathname === '') return <LandingLoginPage />
  if (pathname.startsWith('/learner-mapping')) return <LearnerMappingPage />
  if (pathname.startsWith('/results')) return <ResultsPage />
  if (pathname.startsWith('/yuvi-studio')) return <YuviStudioPage />
  if (pathname.startsWith('/student-dashboard')) return <StudentDashboardPage />
  if (pathname.startsWith('/teacher-view')) return <TeacherViewPage />
  if (pathname.startsWith('/mentoring')) return <MentoringPage />
  if (pathname.startsWith('/learning/lesson')) return <LessonPage />
  if (pathname.startsWith('/learning/create')) return <LomdaCreatorPage />
  if (pathname.startsWith('/learning')) return <LearningPortalPage />
  return <LandingLoginPage />
}

// The floating Coach begins only once the learner reaches the dashboard. Mapping
// and results are one guided onboarding flow, so showing a second companion there
// would compete with Yuvi's profile-verification experience.
function isLearnerRoute(pathname: string) {
  return (
    pathname.startsWith('/student-dashboard') ||
    pathname.startsWith('/mentoring') ||
    pathname.startsWith('/learning')
  )
}

export function App() {
  const routePath = useRoute()
  const { t, language, direction } = useI18n()
  const { user, isTeacher } = useAuth()
  const { stage } = useOnboarding()
  const { isOpen, isOpening, isClosing, panelWidth } = useCompanion()
  const studioTransition = useStudioTransition()
  /* The animated studio overlay owns the /yuvi-studio URL while it is up (so a
     reload reopens the studio). The app underneath keeps rendering the route the
     learner came from, which also means closing the overlay remounts nothing. */
  const pathname =
    studioTransition?.isOpen && studioTransition.backgroundPath
      ? studioTransition.backgroundPath
      : routePath
  const isStudioRoute = pathname.startsWith('/yuvi-studio')
  const isActiveTaskRoute = pathname.startsWith('/learning/lesson')
  const isLearningWorldRoute = pathname === '/learning' || pathname.startsWith('/learning?')
  // While signed out the guard renders the landing page, so the learner shell
  // and its companion must not wrap it.
  const learnerRoute = isLearnerRoute(pathname) && Boolean(user)

  // Send an unfinished learner back to the step their saved state says they are
  // on. Done as an effect (not during render) so the URL actually changes —
  // rendering another page would leave a lying address bar.
  useEffect(() => {
    if (!user || stage === 'loading' || stage === 'done') return
    if (isTeacherRoute(pathname) && isTeacher) return   // teacher lane is separate
    if (!isProtected(pathname)) return
    // Mapping and results hand off to each other; don't fight that flow.
    if (isOnboardingRoute(pathname)) return
    const target = STAGE_ROUTE[stage]
    if (!pathname.startsWith(target)) navigate(target)
  }, [user, stage, pathname, isTeacher])

  // The landing page is for visitors. A signed-in user who reaches it (typed the
  // root URL, opened a bookmark, hit Back) goes straight into the product — the
  // onboarding effect above then moves them on if their setup isn't finished.
  // Accounts often carry both roles, so the learner dashboard is home unless
  // this account can only teach.
  useEffect(() => {
    if (!user || !isLandingRoute(pathname)) return
    navigate(homeRoute(user.roles), { replace: true })
  }, [user, pathname])

  // A learner who already finished the mapping questionnaire cannot open it
  // again by typing /learner-mapping — send them home instead of re-asking the
  // 31 questions and overwriting their saved mapping.
  useEffect(() => {
    if (!user || stage !== 'done' || !isMappingRoute(pathname)) return
    navigate(homeRoute(user.roles), { replace: true })
  }, [user, stage, pathname])

  const guarded = (() => {
    const needsAuth = isProtected(pathname) || isTeacherRoute(pathname)
    if (needsAuth && !user) return <LandingLoginPage initialDialog={isTeacherRoute(pathname) ? 'teacher' : 'student'} />
    // Hold the frame it takes the redirect effect above to leave the landing page.
    if (user && isLandingRoute(pathname)) return <LoadingState title={t('auth.guard.resuming')} />
    if (isTeacherRoute(pathname) && !isTeacher) {
      return <ErrorState title={t('auth.guard.teacherOnly')} />
    }
    // Hold the frame it takes the effect above to leave the finished questionnaire.
    // Also held while the stage is still being read, so a learner who is done
    // never sees a flash of the questionnaire before the redirect.
    if (user && isMappingRoute(pathname) && (stage === 'done' || stage === 'loading')) {
      return <LoadingState title={t('auth.guard.resuming')} />
    }
    // Onboarding incomplete and this route isn't part of it: hold the old page
    // for the one frame it takes the effect above to redirect.
    if (user && stage !== 'loading' && stage !== 'done' && isProtected(pathname) && !isOnboardingRoute(pathname)) {
      return <LoadingState title={t('auth.guard.resuming')} />
    }
    return pageForRoute(pathname)
  })()

  const routePage = <div key={`${language}:${pathname}`}>{guarded}</div>

  return (
    <>
      {/* Keying by language forces every migrated route to remount and re-fetch
          content (and re-run its localization) whenever the language changes. */}
      {learnerRoute ? (
        <div
          className={`sp-learner-shell${isActiveTaskRoute ? ' is-task-route' : ''}${isLearningWorldRoute ? ' is-world-route' : ''}${isOpen && !isOpening && !isClosing ? ' is-companion-open' : ''}${isOpening ? ' is-companion-opening' : ''}${isClosing ? ' is-companion-closing' : ''}`}
          style={{ '--sp-companion-width': `${panelWidth}px` } as React.CSSProperties}
        >
          <CompanionChat />
          <div className="sp-learner-shell__content" dir={direction}>{routePage}</div>
        </div>
      ) : routePage}
      {learnerRoute && !isStudioRoute && !isActiveTaskRoute && !isLearningWorldRoute && <YuviCompanionDock />}
      {learnerRoute && <SparkToast />}
    </>
  )
}