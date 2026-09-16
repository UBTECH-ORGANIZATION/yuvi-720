/* The whole teacher lane behind one lazy import.
 *
 * Every teacher page, the shell chrome, its three providers and the assistant
 * dock used to ride in the main chunk, so a child opening the dashboard on a
 * school PC parsed the teacher app first. `App.tsx` keeps the route switch
 * (tests pin the prefixes there) but takes every page and the shell from this
 * module, so they all resolve from one chunk that a learner never fetches. */
import { TeacherHomePage } from '../features/teacher-app/home/TeacherHomePage'
import { TeacherStudentsPage } from '../features/teacher-app/students/TeacherStudentsPage'
import { TeacherStudentPage } from '../features/teacher-app/student/TeacherStudentPage'
import { TeacherCalendarPage } from '../features/teacher-app/calendar/TeacherCalendarPage'
import { TeacherGoalsPage } from '../features/teacher-app/goals/TeacherGoalsPage'
import { TeacherLearningsPage } from '../features/teacher-app/learnings/TeacherLearningsPage'
import { LearningDetailPage } from '../features/teacher-app/learnings/LearningDetailPage'
import { TeacherMessagesPage } from '../features/teacher-app/messages/TeacherMessagesPage'
import { TeacherTasksPage } from '../features/teacher-app/tasks/TeacherTasksPage'
import { TaskReviewPage } from '../features/teacher-app/tasks/TaskReviewPage'
import { TaskTrackingPage } from '../features/teacher-app/tasks/TaskTrackingPage'
export {
  TeacherHomePage, TeacherStudentsPage, TeacherStudentPage, TeacherCalendarPage, TeacherGoalsPage,
  TeacherLearningsPage, LearningDetailPage, TeacherMessagesPage, TeacherTasksPage, TaskReviewPage, TaskTrackingPage,
}
import { TeacherAppBar } from '../components/TeacherAppBar'
import { ScopeNotice } from '../components/scope/ScopeNotice'
import { AssistantDock } from '../features/teacher-app/assistant/AssistantDock'
import { TeacherScopeProvider } from '../providers/TeacherScopeProvider'
import { TeacherRosterProvider } from '../providers/TeacherRosterProvider'
import { TeacherLiveProvider } from '../providers/TeacherLiveProvider'

/* Teacher shell — the chrome + scope provider every teacher screen sits in.
   Mirrors `sp-learner-shell`, and like it, this is mounted ABOVE the keyed
   route div (see App). That placement is load-bearing, not cosmetic:
   inside the keyed div every navigation remounts it, which reset the selected
   class back to the first group and wiped the assistant conversation the moment
   a teacher clicked a student reference in the chat. State that must survive
   navigation lives above the key. */
export function TeacherShell({ children }: { children: React.ReactNode }) {
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
