/* The learner's first-run tour, as data.
 *
 * The order is the page, read the way a child reads it: straight down the
 * dashboard, panel after panel, then up to the studio button, then across to
 * the badges. Yuvi flies the route himself (`guide: 'flying'`), so the sequence
 * is also a path — steps that jump around the screen look like a bug.
 *
 * The studio is spotlit but never entered. It is a lazy Three.js route behind a
 * transition overlay that takes ownership of the URL, so walking a tour into it
 * would hand the tour's navigation to something else mid-flight.
 *
 * Deliberately no JSX in this file: the parity test imports it directly under
 * `node --test`, which cannot parse JSX.
 */

import type { TourDefinition, TourStep } from './types.ts'

/* Versioned. Completion is permanent and there is no un-complete API, so the
   only way to offer a redesigned tour to people who already took the old one is
   to ask about a different name. `learner.v2` costs one line here and one in
   the backend's TOUR_SLUGS. */
export const LEARNER_TOUR_ID = 'learner.v1'

/**
 * Who this tour is for.
 *
 * Every step lives behind the learner guard in App.tsx, and a teacher-only
 * account that reached `/student-dashboard` is bounced by it — so offering them
 * this tour would narrate screens they are being redirected away from.
 */
export function canTakeLearnerTour(roles: string[] | undefined): boolean {
  return Boolean(roles?.includes('learner'))
}

export const learnerTourSteps: TourStep[] = [
  {
    id: 'welcome',
    target: null,
    route: '/student-dashboard',
    titleKey: 'tour.learner.welcome.title',
    bodyKey: 'tour.learner.welcome.body',
    placement: 'center',
  },
  {
    id: 'next',
    target: 'learner.hero',
    route: '/student-dashboard',
    titleKey: 'tour.learner.next.title',
    bodyKey: 'tour.learner.next.body',
    placement: 'bottom',
  },
  {
    /* Interactive because the map already answers questions on hover — every
       emblem carries what moved, why, and a way to ask Yuvi about it. The scrim
       was swallowing exactly the gesture this step is about. */
    id: 'map',
    target: 'learner.activeness',
    route: '/student-dashboard',
    titleKey: 'tour.learner.map.title',
    bodyKey: 'tour.learner.map.body',
    placement: 'bottom',
    interactive: true,
  },
  {
    id: 'subjects',
    target: 'learner.subjects',
    route: '/student-dashboard',
    titleKey: 'tour.learner.subjects.title',
    bodyKey: 'tour.learner.subjects.body',
    placement: 'top',
  },
  {
    id: 'goals',
    target: 'learner.goals',
    route: '/student-dashboard',
    titleKey: 'tour.learner.goals.title',
    bodyKey: 'tour.learner.goals.body',
    placement: 'top',
  },
  {
    // Spotlit, not opened: see the file header.
    id: 'studio',
    target: 'learner.studio',
    route: '/student-dashboard',
    titleKey: 'tour.learner.studio.title',
    bodyKey: 'tour.learner.studio.body',
    placement: 'bottom',
    padding: 6,
  },
  {
    /* The badges live behind the avatar menu — there is no direct nav button —
       so the child opens it themselves rather than being teleported. `Next` on
       the card still works, so this is never a dead end for someone who does
       not want to click. */
    id: 'badgesDoor',
    target: 'learner.profileMenu',
    route: '/student-dashboard',
    awaitRoute: '/badges',
    titleKey: 'tour.learner.badgesDoor.title',
    bodyKey: 'tour.learner.badgesDoor.body',
    placement: 'bottom',
    padding: 6,
    interactive: true,
  },
  {
    id: 'badges',
    target: 'learner.badges',
    route: '/badges',
    titleKey: 'tour.learner.badges.title',
    bodyKey: 'tour.learner.badges.body',
    placement: 'top',
  },
  {
    /* Ends on the dock, and Yuvi's own flight lands him on it: the last thing a
       child should remember is where to find help, shown rather than told. */
    id: 'companion',
    target: 'learner.companion',
    route: '/badges',
    titleKey: 'tour.learner.companion.title',
    bodyKey: 'tour.learner.companion.body',
    placement: 'top',
    padding: 6,
    landing: true,
  },
]

export const learnerTour: TourDefinition = {
  id: LEARNER_TOUR_ID,
  steps: learnerTourSteps,
  guide: 'flying',
  /* Not skippable. A child gets one first run, and every screen this tour names
     is one they would otherwise have to find by guessing. */
  dismissible: false,
}
