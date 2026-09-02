/* The learner's first-lesson tour, as data.
 *
 * The dashboard tour answers "where is everything". This one answers the only
 * question that matters once a child is actually inside a lesson: when this
 * gets hard, what do I do? So the route is the lesson stage, then Yuvi, then
 * the three ways out of being stuck — a hint, an explanation, or a real person.
 *
 * Two constraints shape the step list, and both are worth knowing before
 * editing it:
 *
 * **The lesson itself is a cross-origin iframe.** Individual questions cannot
 * be spotlit, measured, or clicked from here, so the stage is introduced as one
 * region. Anything more granular would need the provider to cooperate.
 *
 * **The help buttons are conditional.** `hint` and `explain` only render on a
 * question screen the learner has not already asked about. On an intro or video
 * screen they are simply absent, and the provider skips the step in silence —
 * which is why the chat step carries the "ask in your own words" message too:
 * the one path that is always open is never the one that can vanish.
 *
 * Deliberately no JSX in this file: the parity test imports it directly under
 * `node --test`, which cannot parse JSX.
 */

import type { TourDefinition, TourStep } from './types.ts'

/* Versioned, for the same reason as the learner tour: completion is permanent
   and there is no un-complete API, so a redesigned tour has to ask about a new
   name. Costs one line here and one in the backend's TOUR_SLUGS. */
export const LESSON_TOUR_ID = 'lesson.v1'

/** The lesson route this tour narrates, matched on pathname only. */
export const LESSON_ROUTE = '/learning/lesson'

/**
 * Who this tour is for.
 *
 * Same guard as the dashboard tour: teachers preview lessons through their own
 * screens, and narrating a child's help buttons to them would be wrong on both
 * counts — they are not the ones who get stuck here, and the raise-hand calls
 * a teacher, which is them.
 */
export function canTakeLessonTour(roles: string[] | undefined): boolean {
  return Boolean(roles?.includes('learner'))
}

export const lessonTourSteps: TourStep[] = [
  {
    id: 'welcome',
    target: null,
    route: LESSON_ROUTE,
    titleKey: 'tour.lesson.welcome.title',
    bodyKey: 'tour.lesson.welcome.body',
    placement: 'center',
  },
  {
    /* One region, not many: the questions live inside the provider's frame and
       cannot be reached from out here. See the file header. */
    id: 'stage',
    target: 'learner.lessonStage',
    route: LESSON_ROUTE,
    titleKey: 'tour.lesson.stage.title',
    bodyKey: 'tour.lesson.stage.body',
    placement: 'top',
  },
  {
    /* The closed-panel fallback, and normally invisible.
       The lesson coach greets proactively, so by the time the tour arrives the
       chat is usually already open — the dock is hidden behind it and this step
       skips itself, which is right: there is nothing to teach about opening
       something that is open. When the greeting does not land the panel stays
       shut, and without this step every remaining step would target elements
       inside a closed panel and the child would be told nothing at all about
       how to get help. `awaitTarget` advances on their own press. */
    id: 'door',
    target: 'learner.companion',
    route: LESSON_ROUTE,
    awaitTarget: 'learner.lessonAsk',
    titleKey: 'tour.lesson.door.title',
    bodyKey: 'tour.lesson.door.body',
    placement: 'top',
    padding: 6,
    interactive: true,
  },
  {
    id: 'ask',
    target: 'learner.lessonAsk',
    route: LESSON_ROUTE,
    titleKey: 'tour.lesson.ask.title',
    bodyKey: 'tour.lesson.ask.body',
    placement: 'top',
    padding: 6,
  },
  {
    /* Skipped in silence on a screen with nothing to hint about — see header. */
    id: 'help',
    target: 'learner.lessonHelp',
    route: LESSON_ROUTE,
    titleKey: 'tour.lesson.help.title',
    bodyKey: 'tour.lesson.help.body',
    placement: 'top',
    padding: 6,
  },
  {
    /* Named plainly as "call the teacher". A child who is stuck past what Yuvi
       can do should know the way to a person is one press, not a last resort. */
    id: 'hand',
    target: 'learner.lessonHand',
    route: LESSON_ROUTE,
    titleKey: 'tour.lesson.hand.title',
    bodyKey: 'tour.lesson.hand.body',
    placement: 'top',
    padding: 8,
  },
  {
    id: 'path',
    target: 'learner.lessonTabs',
    route: LESSON_ROUTE,
    titleKey: 'tour.lesson.path.title',
    bodyKey: 'tour.lesson.path.body',
    placement: 'bottom',
    padding: 6,
  },
  {
    /* Ends on Yuvi's own stage inside the open panel rather than on the dock:
       the dock is hidden while the panel is up, so landing there would leave the
       last step pointing at nothing. `landing` hands the guide back to the
       panel's avatar, keeping one WebGL context alive.
       Below, not beside: the stage sits in the panel's top corner, so a card
       placed to its side had nowhere to go and the viewport clamp parked it on
       top of Yuvi — hiding the one thing this step exists to point at. */
    id: 'stay',
    target: 'learner.lessonYuvi',
    route: LESSON_ROUTE,
    titleKey: 'tour.lesson.stay.title',
    bodyKey: 'tour.lesson.stay.body',
    placement: 'bottom',
    padding: 8,
    landing: true,
  },
]

export const lessonTour: TourDefinition = {
  id: LESSON_TOUR_ID,
  steps: lessonTourSteps,
  guide: 'flying',
  /* Not skippable, like the dashboard tour: this is the one moment a child is
     told how to get unstuck, and the children most likely to skip it are the
     ones most likely to need it. */
  dismissible: false,
}
