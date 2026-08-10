import { LearnerMappingPage } from '../features/learner-mapping/LearnerMappingPage'
import { ResultsPage } from '../features/results/ResultsPage'
import { StudentDashboardPage } from '../features/student-dashboard/StudentDashboardPage'
import { TeacherHomePage } from '../features/teacher-app/home/TeacherHomePage'
import { TeacherStudentsPage } from '../features/teacher-app/students/TeacherStudentsPage'
import { TeacherStudentPage } from '../features/teacher-app/student/TeacherStudentPage'
import { TeacherGoalsPage } from '../features/teacher-app/goals/TeacherGoalsPage'
import { TeacherLearningsPage } from '../features/teacher-app/learnings/TeacherLearningsPage'
import { LearningDetailPage } from '../features/teacher-app/learnings/LearningDetailPage'
import { TeacherMessagesPage } from '../features/teacher-app/messages/TeacherMessagesPage'
import { AdminConsolePage } from '../features/admin/AdminConsolePage'
import { TeacherAppBar } from '../components/TeacherAppBar'
import { AssistantDock } from '../features/teacher-app/assistant/AssistantDock'
import { TeacherScopeProvider } from '../providers/TeacherScopeProvider'
import { TeacherRosterProvider } from '../providers/TeacherRosterProvider'
import { TeacherLiveProvider } from '../providers/TeacherLiveProvider'
import { TourProvider } from '../components/tour/TourProvider'
import { getGroupSnapshot, listGroups } from '../services/teacher'
import { MentoringPage } from '../features/mentoring/MentoringPage'
import { LearningPortalPage } from '../features/learning-portal/LearningPortalPage'
import { LessonPage } from '../features/learning-lesson/LessonPage'
import { LomdaCreatorPage } from '../features/learning-create/LomdaCreatorPage'
import { LandingLoginPage } from '../features/landing-login/LandingLoginPage'
import { YuviStudioPage } from '../features/Yuvi-studio/YuviStudioPage'
import { BadgesPage } from '../features/badges/BadgesPage'
import { CompanionChat } from '../components/CompanionChat'
import { YuviCompanionDock } from '../components/YuviCompanionDock'
import { SparkToast } from '../components/SparkToast'
import { useCallback, useEffect } from 'react'
import { ErrorState, LoadingState } from '../components/primitives'
import { useI18n } from '../i18n/I18nProvider'
import { useAuth } from '../providers/AuthProvider'
import { useCompanion } from '../providers/CompanionProvider'
import { STAGE_ROUTE, useOnboarding } from '../providers/OnboardingProvider'
import { consumeLoginIntent, navigate, useRoute } from './router'

/* Route guarding lives here because the router is a 19-line pushState wrapper
   with no loader/guard concept. A protected route with no session REDIRECTS to
   the landing page — the URL really changes. An earlier version kept the URL
   so login could drop you where you were headed, but the stale address
   outlived logout: signing back in through either landing button walked you
   into the previous session's screen, wrong role and all. Post-login routing
   is by account role (the landing-route effect below), not by leftover URL. */
const PROTECTED_ROUTES = [
  '/learner-mapping',
  '/results',
  '/yuvi-studio',
  '/student-dashboard',
  '/mentoring',
  '/learning',
  '/badges'
]
const TEACHER_ROUTES = ['/teacher']   // covers /teacher and the legacy /teacher-view
/* The control plane. Guarded separately from the teacher lane: every teacher may
   see their own groups, only an admin may change who is connected to whom.
   The role here is the cheap client-side gate — the backend re-checks the live
   `org_admins` grant on every request, so a revoked admin gets 403s regardless
   of what their 12-hour token still claims. */
const ADMIN_ROUTES = ['/admin']

/* Routes a learner may reach before onboarding is finished. Everything else
   (dashboard, learning world, mentoring, studio) is gated until mapping and
   profile verification are done — otherwise those surfaces render against a
   half-built brain. */
const ONBOARDING_ROUTES = ['/learner-mapping', '/results']

function isOnboardingRoute(pathname: string) {
  return ONBOARDING_ROUTES.some((route) => pathname.startsWith(route))
}

function isProtected(pathname: string) {
  return PROTECTED_ROUTES.some((route) => pathname.startsWith(route))
}

function isTeacherRoute(pathname: string) {
  return TEACHER_ROUTES.some((route) => pathname.startsWith(route))
}

function isAdminRoute(pathname: string) {
  return ADMIN_ROUTES.some((route) => pathname.startsWith(route))
}

function isLandingRoute(pathname: string) {
  return pathname === '/' || pathname === ''
}

/* Every prefix pageForRoute can actually render. Anything else is a typo or a
   dead link, and rendering the landing page there would leave a lying address
   bar — the same disease the auth guard cures. Kept as data so the unknown-
   route effect and pageForRoute cannot drift apart silently. */
const KNOWN_ROUTES = [
  '/learner-mapping', '/results', '/yuvi-studio', '/student-dashboard',
  '/badges', '/teacher', '/admin', '/mentoring', '/learning',
]

function isKnownRoute(pathname: string) {
  return isLandingRoute(pathname) || KNOWN_ROUTES.some((route) => pathname.startsWith(route))
}

/* The most specific home this account can open. An admin who cannot teach must
   not be sent to /teacher, where the teacher guard would immediately refuse
   them; same reasoning as the landing-route redirect. */
function homeFor(user: { roles: string[] }) {
  return user.roles.includes('learner')
    ? '/student-dashboard'
    : user.roles.includes('teacher') ? '/teacher' : '/admin'
}

/* Teacher shell — the chrome + scope provider every teacher screen sits in.
   Mirrors `sp-learner-shell`, and like it, this is mounted ABOVE the keyed
   route div (see App below). That placement is load-bearing, not cosmetic:
   inside the keyed div every navigation remounts it, which reset the selected
   class back to the first group and wiped the assistant conversation the moment
   a teacher clicked a student reference in the chat. State that must survive
   navigation lives above the key. */
function TeacherShell({ children }: { children: React.ReactNode }) {
  return (
    <TeacherScopeProvider>
      {/* Names for every class, fetched once and held above the route key. A
          per-group name map is what turned a named student in the chat back
          into a raw id whenever the class picker moved. */}
      <TeacherRosterProvider>
      {/* Live inside the scope provider: the stream is per selected group, so it
          has to be able to read (and re-subscribe on) the current group id. */}
      <TeacherLiveProvider>
        <div className="sp-teacher-shell">
          <TeacherAppBar />
          {/* Two-column workspace: pages scroll in their own column while the
              assistant holds the full height of the other — the same "the
              companion is always beside you" contract as the student's chat
              panel, not a launcher hiding in a corner (A8). */}
          <div className="sp-teacher-shell__work">
            <main className="sp-teacher-shell__main">{children}</main>
            <AssistantDock />
          </div>
        </div>
      </TeacherLiveProvider>
      </TeacherRosterProvider>
    </TeacherScopeProvider>
  )
}

function pageForRoute(pathname: string) {
  if (pathname === '/' || pathname === '') return <LandingLoginPage />
  if (pathname.startsWith('/learner-mapping')) return <LearnerMappingPage />
  if (pathname.startsWith('/results')) return <ResultsPage />
  if (pathname.startsWith('/yuvi-studio')) return <YuviStudioPage />
  if (pathname.startsWith('/student-dashboard')) return <StudentDashboardPage />
  if (pathname.startsWith('/badges')) return <BadgesPage />
  // Teacher lane. Order matters: the student detail prefix must be tested
  // before the bare `/teacher` prefix or every route resolves to Home.
  if (pathname.startsWith('/teacher/student/')) {
    const learnerId = decodeURIComponent(pathname.split('/teacher/student/')[1] ?? '').split(/[/?#]/)[0]
    return <TeacherStudentPage learnerId={learnerId} />
  }
  if (pathname.startsWith('/teacher/students')) {
    return <TeacherStudentsPage />
  }
  if (pathname.startsWith('/teacher/goals')) {
    return <TeacherGoalsPage />
  }
  if (pathname.startsWith('/teacher/learnings/')) {
    // /teacher/learnings/:groupId/:componentId — the group travels in the URL
    // so a drill-down is linkable and survives a reload without guessing scope.
    const [rawGroup, ...rest] = pathname
      .slice('/teacher/learnings/'.length)
      .split('?')[0]
      .split('/')
    const componentId = decodeURIComponent(rest.join('/'))
    if (rawGroup && componentId) {
      return (
        <LearningDetailPage
          groupId={decodeURIComponent(rawGroup)}
          componentId={componentId}
        />
      )
    }
    return <TeacherLearningsPage />
  }
  if (pathname.startsWith('/teacher/learnings')) {
    return <TeacherLearningsPage />
  }
  if (pathname.startsWith('/teacher/messages')) {
    return <TeacherMessagesPage />
  }
  if (pathname.startsWith('/teacher')) {
    return <TeacherHomePage />
  }
  // The control plane shares the teacher chrome deliberately: an admin moves
  // between "who is connected to whom" and the dashboard constantly, and the
  // group switcher above is already unlocked to every group for them.
  if (pathname.startsWith('/admin')) {
    return <AdminConsolePage />
  }
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
    pathname.startsWith('/learning') ||
    pathname.startsWith('/badges')
  )
}

export function App() {
  const pathname = useRoute()
  const { t, language, direction } = useI18n()
  const { user, isTeacher } = useAuth()
  const isAdmin = Boolean(user?.roles.includes('admin'))
  const { stage } = useOnboarding()
  const { isOpen, isOpening, isClosing, panelWidth } = useCompanion()
  const isStudioRoute = pathname.startsWith('/yuvi-studio')
  const isActiveTaskRoute = pathname.startsWith('/learning/lesson')
  const isLearningWorldRoute = pathname === '/learning' || pathname.startsWith('/learning?')
  // While signed out the guard renders the landing page, so the learner shell
  // and its companion must not wrap it.
  const learnerRoute = isLearnerRoute(pathname) && Boolean(user)
  /* Same rule for the teacher chrome, plus the role: an account that fails the
     teacher/admin guard gets an ErrorState, and wrapping that in the shell
     would put a class switcher and an assistant around a refusal. */
  const teacherShellRoute =
    (isTeacherRoute(pathname) && isTeacher) || (isAdminRoute(pathname) && isAdmin)

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

  // Signed out on a protected URL → go to the landing page for real. As an
  // effect (not during render) so the address bar actually changes; `replace`
  // so Back does not return to a page that would just bounce again. Safe on a
  // hard refresh while logged in: AuthProvider renders nothing until /me
  // resolves, so `user === null` here always means genuinely signed out —
  // which is also what makes this fire right after logout, wherever it happens.
  useEffect(() => {
    if (user) return
    const needsAuth = isProtected(pathname) || isTeacherRoute(pathname) || isAdminRoute(pathname)
    if (needsAuth) navigate('/', { replace: true })
  }, [user, pathname])

  // The landing page is for visitors. A signed-in user who reaches it (typed the
  // root URL, opened a bookmark, hit Back) goes straight into the product — the
  // onboarding effect above then moves them on if their setup isn't finished.
  // Accounts often carry both roles, so the learner dashboard is home unless
  // this account can only teach.
  useEffect(() => {
    if (!user || !isLandingRoute(pathname)) return
    /* The landing button the user clicked outranks role priority — a
       teacher+learner account entering through the teacher door must land on
       /teacher, not on the student dashboard the role order would pick. The
       hint is consumed (read-once): it must never outlive this navigation, or
       a later bookmark visit to '/' would replay a stale door choice.

       Routing lives HERE, not in the login dialog, on hard-won grounds: the
       dialog used to navigate itself after login, but navigate()'s synthetic
       popstate flushes at discrete-event priority, so the pathname committed
       one render BEFORE the user did — and the auth guard above read that
       frame as "signed out on /teacher" and bounced the login to '/'. An
       effect keyed on `user` cannot run before the user exists. */
    const intent = consumeLoginIntent()
    const target = intent === 'teacher' && user.roles.includes('teacher')
      ? '/teacher'
      : intent === 'student' && user.roles.includes('learner')
        ? '/student-dashboard'
        : homeFor(user)
    navigate(target, { replace: true })
  }, [user, pathname])

  // A URL nothing renders (typo, dead link) goes where this account belongs:
  // their role home when signed in, the landing page when not. A redirect
  // rather than a 404 screen — the product has no public content URLs, so a
  // "not found" page would only ever be a dead end a child has to escape from.
  useEffect(() => {
    if (isKnownRoute(pathname)) return
    navigate(user ? homeFor(user) : '/', { replace: true })
  }, [user, pathname])

  const guarded = (() => {
    const teacherLane = isTeacherRoute(pathname) || isAdminRoute(pathname)
    const needsAuth = isProtected(pathname) || teacherLane
    // The redirect effect above is already moving us to '/'. Render the landing
    // page for that one frame — it IS the destination, so there is no flicker.
    // No initialDialog: the URL that implied a role is stale by definition here.
    if (needsAuth && !user) return <LandingLoginPage />
    // Hold the frame it takes the redirect effect above to leave the landing page.
    if (user && isLandingRoute(pathname)) return <LoadingState title={t('auth.guard.resuming')} />
    // Same hold for an unknown URL: the effect above is already replacing it.
    if (!isKnownRoute(pathname)) return <LoadingState title={t('auth.guard.resuming')} />
    if (isAdminRoute(pathname) && !isAdmin) {
      return <ErrorState title={t('auth.guard.adminOnly')} />
    }
    if (isTeacherRoute(pathname) && !isTeacher) {
      return <ErrorState title={t('auth.guard.teacherOnly')} />
    }
    // Onboarding incomplete and this route isn't part of it: hold the old page
    // for the one frame it takes the effect above to redirect.
    if (user && stage !== 'loading' && stage !== 'done' && isProtected(pathname) && !isOnboardingRoute(pathname)) {
      return <LoadingState title={t('auth.guard.resuming')} />
    }
    return pageForRoute(pathname)
  })()

  const routePage = <div key={`${language}:${pathname}`}>{guarded}</div>

  /* Which student the tour opens a profile on. Fetched here rather than read
     from TeacherScopeProvider: the tour wraps the whole tree, including the
     teacher shell that owns that provider, so the context is not in reach from
     here. One extra request, only when a tour actually starts. */
  const resolveTourParams = useCallback(async () => {
    const { groups } = await listGroups()
    const first = groups?.[0]
    if (!first) return {}
    const snapshot = await getGroupSnapshot(first.id, language)
    return { studentId: snapshot.students?.[0]?.learner_id ?? null }
  }, [language])

  return (
    /* Above `routePage` on purpose. That div is keyed by pathname, so every
       navigation remounts everything inside it — a tour mounted in there would
       reset to step 1 the moment it moved from Home to the roster, and the
       welcome step's own route would bounce it straight back. Learned the hard
       way: the symptom was a tour that looped forever between steps 1 and 8. */
    <TourProvider resolveParams={resolveTourParams}>
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
      ) : teacherShellRoute ? (
        /* The selected class and the assistant conversation belong to the
           session, not to the page — so the shell wraps the keyed div rather
           than living inside it. */
        <TeacherShell>{routePage}</TeacherShell>
      ) : routePage}
      {learnerRoute && !isStudioRoute && !isActiveTaskRoute && !isLearningWorldRoute && <YuviCompanionDock />}
      {learnerRoute && <SparkToast />}
    </TourProvider>
  )
}