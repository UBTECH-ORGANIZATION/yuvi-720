/* Launch context and run state — the one module every other module may import.
 *
 * It deliberately imports NOTHING, so the dependency graph stays acyclic: the
 * player is a set of small modules loaded straight from `/content/player-assets`
 * with no bundler, and a cycle there is a silent `undefined` at boot rather than
 * a build error.
 */

export const VERB = 'https://lxp.education.gov.il/xapi/moe/verbs/';
export const OBJECT = 'https://yuvilab.spark/xapi/content/';
export const CATEGORY = 'https://yuvilab.spark/xapi/categories/';

export const DEFAULT_BREAK_MINUTES = 10;

/* ── launch context ─────────────────────────────────────────────────────── */
const url = new URL(window.location.href);
export const componentId = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
export const lang = ['he', 'ar', 'en'].includes(url.searchParams.get('lang')) ? url.searchParams.get('lang') : 'he';

/** Forces a theme instead of following the device. Absent means "follow the
 *  device", which is what a learner gets; the gallery pins it to review both. */
export const theme = ['light', 'dark'].includes(url.searchParams.get('theme'))
  ? url.searchParams.get('theme')
  : null;

export let launch = null;
try {
  launch = JSON.parse(url.searchParams.get('slxapi') || 'null');
} catch { launch = null; }

export const root = document.getElementById('root');

/* ── state ──────────────────────────────────────────────────────────────── */
export const state = {
  payload: null,
  index: 0,
  visited: new Set(),
  // `${itemId}|${questionId}` -> {correct, feedback, response}. Kept whole so a
  // learner who walks back to a finished screen sees what they answered and
  // what they were told, instead of a blank question (720 §1.5).
  answered: new Map(),
  written: new Map(),
  // itemId -> which of that screen's questions is on show. A screen with three
  // questions is three cards' worth of options; asking them one at a time is
  // what keeps a screen inside the viewport, and it is how the material this
  // replaces already reads.
  questionAt: new Map(),
  startedAt: Date.now(),
  breakOffered: false,
  onBreak: false,
  scale: 'normal',
  contrast: false,
  readingAloud: false,
  reported: false,
};

export const items = () => state.payload?.items || [];
export const current = () => items()[state.index];
export const itemObject = (item) => `${OBJECT}${item.id}`;

export function questionsDone(item) {
  return (item.questions || []).every((q) => state.answered.has(`${item.id}|${q.questionId}`));
}

/** Which question of this screen is on show, clamped to what exists. */
export function questionIndex(item) {
  const total = (item.questions || []).length;
  return Math.min(state.questionAt.get(item.id) || 0, Math.max(total - 1, 0));
}

/** Answered the one on show, but the screen has more? Then "continue" advances
 *  within the screen before it advances to the next one. */
export function hasNextQuestion(item) {
  const questions = item.questions || [];
  if (questions.length < 2) return false;
  const at = questionIndex(item);
  if (at >= questions.length - 1) return false;
  return state.answered.has(`${item.id}|${questions[at].questionId}`);
}

/** Every screen the learner has finished with, for the progress strip. */
export function stepState(index) {
  if (index === state.index) return 'current';
  const item = items()[index];
  return state.visited.has(item.id) && questionsDone(item) ? 'done' : 'todo';
}

/* The one edge that would otherwise point backwards: a graded answer has to
   unlock "continue", which lives in the chrome. The entry module fills this in
   at boot rather than the question renderer importing the chrome. */
export const hooks = { refreshFooter: () => {} };
