import { LearnerMappingPage } from '../features/learner-mapping/LearnerMappingPage'
import { ResultsPage } from '../features/results/ResultsPage'
import { StudentDashboardPage } from '../features/student-dashboard/StudentDashboardPage'
import { TeacherHomePage } from '../features/teacher-app/home/TeacherHomePage'
import { TeacherStudentsPage } from '../features/teacher-app/students/TeacherStudentsPage'
import { TeacherStudentPage } from '../features/teacher-app/student/TeacherStudentPage'
import { TeacherCalendarPage } from '../features/teacher-app/calendar/TeacherCalendarPage'
import { TeacherGoalsPage } from '../features/teacher-app/goals/TeacherGoalsPage'
import { TeacherLearningsPage } from '../features/teacher-app/learnings/TeacherLearningsPage'
import { LearningDetailPage } from '../features/teacher-app/learnings/LearningDetailPage'
import { TeacherMessagesPage } from '../features/teacher-app/messages/TeacherMessagesPage'
import { AdminConsolePage } from '../features/admin/AdminConsolePage'
import { TeacherAppBar } from '../components/TeacherAppBar'
import { ScopeNotice } from '../components/scope/ScopeNotice'
import { AssistantDock } from '../features/teacher-app/assistant/AssistantDock'
import { TeacherScopeProvider } from '../providers/TeacherScopeProvider'
import { TeacherRosterProvider } from '../providers/TeacherRosterProvider'
import { TeacherLiveProvider } from '../providers/TeacherLiveProvider'
import { TourProvider } from '../components/tour/TourProvider'
import { getGroupSnapshot, listGroups } from '../services/teacher'
import { MentoringPage } from '../features/mentoring/MentoringPage'
import { LearningPortalPage } from '../features/learning-portal/LearningPortalPage'
import { LessonPage } from '../features/learning-lesson/LessonPage'
import { WorkshopPage } from '../features/workshop/WorkshopPage'
import { LandingLoginPage } from '../features/landing-login/LandingLoginPage'
/* The studio is a 3D room editor: it owns the avatar renderer, the lab room and
   the asset catalog. Loading it with the rest of the app put Three.js on every
   learner's and teacher's first paint, for a route most sessions never open. */
const YuviStudioPage = lazy(() =>
  import('../features/Yuvi-studio/YuviStudioPage').then((m) => ({ default: m.YuviStudioPage })))
import { BadgesPage } from '../features/badges/BadgesPage'
import { MyTasksPage } from '../features/student-tasks/MyTasksPage'
import { SolveTaskPage } from '../features/student-tasks/SolveTaskPage'
import { TeacherTasksPage } from '../features/teacher-app/tasks/TeacherTasksPage'
import { TaskReviewPage } from '../features/teacher-app/tasks/TaskReviewPage'
import { TaskTrackingPage } from '../features/teacher-app/tasks/TaskTrackingPage'
import { ReportIssueDialog } from '../features/support/ReportIssueDialog'
import { LearnerMessageToast } from '../components/LearnerMessageToast'
import { CheckinGate } from '../features/checkin/CheckinDialog'
import { PublicReportPage } from '../features/support/PublicReportPage'
import { useStudioTransition } from '../features/Yuvi-studio/StudioTransitionProvider'
import { CompanionChat } from '../components/CompanionChat'
import { YuviCompanionDock } from '../components/YuviCompanionDock'
import { SparkToast } from '../components/SparkToast'
import { lazy, Suspense, useCallback, useEffect } from 'react'
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
  '/badges',
  '/tasks'
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

function isAdminRoute(pathname: string) {
  return ADMIN_ROUTES.some((route) => pathname.startsWith(route))
}

function isLandingRoute(pathname: string) {
  return pathname === '/' || pathname === ''
}

/* Every route `pageForRoute` can actually render. Anything else is a typo or a
   dead link, and rendering *something* there leaves a lying address bar — the
   same disease the auth guard cures.
 *
 * Kept as data so this and `pageForRoute` cannot drift apart silently, which
 * they had already done twice, in both directions:
 *
 *   - `/teacher` sat here as a bare PREFIX, so every mistyped teacher URL was
 *     a "known" route. The redirect below never fired, and `pageForRoute`'s
 *     `/teacher` catch-all quietly rendered the teacher home under an address
 *     that said `/teacher/nonsense`. The learner lane never showed this
 *     because its screens are leaves; the teacher lane has a home page behind
 *     the same prefix as seven others.
 *   - `/report` was missing entirely, so the public report page — deliberately
 *     outside the auth guard so that somebody locked out can still reach it —
 *     was redirected to the landing page before it could render.
 *
 * A trailing segment is only "under" a route at a `/` boundary, so
 * `/studentsomething` is not `/students`. `pathname` carries the query string
 * (see `useRoute`), which is stripped before matching — `?compose=1` is not
 * part of the address in the sense that matters here. */
const KNOWN_ROUTES = [
  '/report', '/learner-mapping', '/results', '/yuvi-studio', '/student-dashboard',
  '/badges', '/tasks', '/admin', '/mentoring', '/learning',
  // The teacher lane, screen by screen rather than by its shared prefix.
  '/teacher/student', '/teacher/students', '/teacher/goals', '/teacher/calendar',
  '/teacher/learnings', '/teacher/messages', '/teacher/tasks',
]

/** `/teacher` IS a screen — the home page — but only exactly. */
const TEACHER_HOME = '/teacher'

function isKnownRoute(pathname: string) {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/'
  if (isLandingRoute(path)) return true
  if (path === TEACHER_HOME) return true
  return KNOWN_ROUTES.some(
    (route) => path === route || path.startsWith(`${route}/`))
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
            {/* Above every page, never inside one: a screen that does not narrow
                by a filter the teacher has set must say so, and a new screen
                must not be able to forget to. */}
            <main className="sp-teacher-shell__main">
              <ScopeNotice />
              {children}
            </main>
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
  // Deliberately outside PROTECTED_ROUTES: someone locked out must still reach it.
  if (pathname.startsWith('/report')) return <PublicReportPage />
  if (pathname.startsWith('/learner-mapping')) return <LearnerMappingPage />
  if (pathname.startsWith('/results')) return <ResultsPage />
  if (pathname.startsWith('/yuvi-studio')) {
    return <Suspense fallback={null}><YuviStudioPage /></Suspense>
  }
  if (pathname.startsWith('/student-dashboard')) return <StudentDashboardPage />
  if (pathname.startsWith('/badges')) return <BadgesPage />
  // Solve before list, or `/tasks/:id` resolves to the list — the same
  // ordering trap the teacher lane below documents.
  if (pathname.startsWith('/tasks/')) {
    const taskId = decodeURIComponent(pathname.slice('/tasks/'.length)).split(/[/?#]/)[0]
    return taskId ? <SolveTaskPage taskId={taskId} /> : <MyTasksPage />
  }
  if (pathname.startsWith('/tasks')) return <MyTasksPage />
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
  if (pathname.startsWith('/teacher/calendar')) {
    return <TeacherCalendarPage />
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
  if (pathname.startsWith('/teacher/tasks/')) {
    const rest = decodeURIComponent(pathname.slice('/teacher/tasks/'.length)).split(/[?#]/)[0]
    const [taskId, tail] = rest.split('/')
    // `/review` is the pre-launch screen, `/{id}` alone is tracking. They are
    // different jobs on the same task: reading what Yuvi wrote before anyone
    // has it, versus reading what the class did with it afterwards.
    if (taskId && tail === 'review') return <TaskReviewPage taskId={taskId} />
    if (taskId) return <TaskTrackingPage taskId={taskId} />
    return <TeacherTasksPage />
  }
  if (pathname.startsWith('/teacher/tasks')) {
    return <TeacherTasksPage />
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
  if (pathname.startsWith('/learning/create')) return <WorkshopPage />
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
    pathname.startsWith('/badges') ||
    /* Both task screens sit in the learner shell. The solve screen is a focus
       surface, and `isActiveTaskRoute` collapses the chrome around it — the
       same arrangement a lesson already uses, rather than a second one. */
    pathname.startsWith('/tasks')
  )
}

export function App() {
  const routePath = useRoute()
  const { t, language, direction } = useI18n()
  const { user, isTeacher } = useAuth()
  const isAdmin = Boolean(user?.roles.includes('admin'))
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
  /* Focus surfaces: a lesson, and now solving a task. Both are screens where
     the surrounding chrome is a way to lose work, so the shell collapses. */
  const isActiveTaskRoute = pathname.startsWith('/learning/lesson')
    || pathname.startsWith('/tasks/')
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
    // A dead link stays in the lane it was in. `homeFor` picks the account's
    // most specific home, which for a teacher who is ALSO a learner is the
    // student dashboard — so a teacher mistyping a teacher URL would land in
    // the child's product, having asked for nothing of the sort.
    const home = !user ? '/'
      : isTeacherRoute(pathname) && isTeacher ? '/teacher'
        : isAdminRoute(pathname) && isAdmin ? '/admin'
          : homeFor(user)
    navigate(home, { replace: true })
  }, [user, pathname, isTeacher, isAdmin])

  // A learner who already finished the mapping questionnaire cannot open it
  // again by typing /learner-mapping — send them home instead of re-asking the
  // 31 questions and overwriting their saved mapping.
  useEffect(() => {
    if (!user || stage !== 'done' || !isMappingRoute(pathname)) return
    navigate(homeFor(user), { replace: true })
  }, [user, stage, pathname])

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
          className={`sp-learner-shell${isActiveTaskRoute ? ' is-task-route' : ''}${isOpen && !isOpening && !isClosing ? ' is-companion-open' : ''}${isOpening ? ' is-companion-opening' : ''}${isClosing ? ' is-companion-closing' : ''}`}
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
      {learnerRoute && !isStudioRoute && !isActiveTaskRoute && <YuviCompanionDock />}
      {learnerRoute && <SparkToast />}
      {learnerRoute && <LearnerMessageToast />}
      {/* Learner-scoped ON PURPOSE (never `user &&`): a teacher must not be
          asked how they feel today. Mounted on ALL learner routes — the day's
          first landing may be a deep link into a lesson, and the ask belongs
          to the day, not to the dashboard. Outside the keyed div, like its
          neighbours, so navigation does not re-run the gate. */}
      {learnerRoute && <CheckinGate />}
      {/* Teachers report faults from their own lane too, so this is not learner-scoped.
          It is also the only floating helper left in the teacher lane: the
          support chat used to ride in the same bottom-left corner as the
          assistant's launcher, two floating buttons stacked on one another
          over the page. Reporting a fault covers the same need without
          standing on the screen. */}
      {user && <ReportIssueDialog />}
    </TourProvider>
  )
}