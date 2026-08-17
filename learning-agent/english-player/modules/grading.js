/* The one path an answer takes to be marked.
 *
 * Every question type ends here, and the round-trip is not an implementation
 * detail: the answer key never reaches the browser, so a verdict cannot be read
 * out of the payload or forged from the console. A renderer's job is to collect
 * a response string and to show what came back — never to decide anything.
 *
 * Imports only `context`, so the question modules can import this without any
 * module importing them back. A cycle here is a silent `undefined` at boot.
 */

import { CATEGORY, componentId, hooks, itemObject, launch, state } from './context.js';
import { el, icon } from './dom.js';
import { pick, t } from './i18n.js';
import { toast } from './toast.js';
import { report } from './xapi.js';

export const answerKey = (item, question) => `${item.id}|${question.questionId}`;

/** One miss is a normal part of learning, so a wrong answer buys a second go.
 *  Two is the limit: past that, "try again" stops being thinking and becomes
 *  guessing down the list, which teaches nothing and tells us less. */
export const MAX_ATTEMPTS = 2;

export const attemptsOn = (key) => state.answered.get(key)?.attempts || 0;

/** May this question be answered again? */
export function canRetry(key) {
  const entry = state.answered.get(key);
  return Boolean(entry) && entry.correct === false && attemptsOn(key) < MAX_ATTEMPTS;
}

/** Mark one response. Records it, reports it, and unlocks "continue". */
export async function grade(item, question, response) {
  const key = answerKey(item, question);
  let verdict;
  try {
    const reply = await fetch(`/content/player/${encodeURIComponent(componentId)}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: launch.auth },
      body: JSON.stringify({
        itemId: item.id, questionId: question.questionId, response,
      }),
    });
    verdict = await reply.json();
  } catch {
    verdict = { correct: null, feedback: {} };
  }
  if (verdict?.correct == null) {
    // Offline, or the token expired mid-screen. This is NOT a wrong answer:
    // recording it as one would put a dropped connection into the learner's
    // mastery record and report `success: false` to the LRS, where nothing
    // downstream could ever tell it apart from a genuine mistake. Nothing is
    // stored and nothing is sent — the learner is asked to try again.
    return { correct: null, feedback: {} };
  }
  const correct = verdict.correct === true;
  const prior = state.answered.get(key);
  const attempts = (prior?.attempts || 0) + 1;
  state.answered.set(key, {
    correct, feedback: verdict.feedback, detail: verdict.detail || null, response, attempts,
    // What the learner knew before being told anything. The component verdict is
    // built from THIS, not from the final state: if a second go counted the same
    // as a first, a learner could miss every question, retry every question, and
    // still be routed past the alternative representation that exists for them.
    firstCorrect: prior ? prior.firstCorrect : correct,
  });
  report('answered', {
    // `…/{item}/q{N}` — both our analytics and Kata's parse the tail as
    // `^q(\d+)$`, so an answer with any other object id is invisible to the LRS.
    object: `${itemObject(item)}/${question.questionId}`,
    result: {
      response,
      success: correct,
      score: { scaled: correct ? 1 : 0 },
      // Both attempts are reported, because both happened. The mastery model
      // folds each one as its own piece of evidence, so a miss-then-hit reads as
      // exactly that — weaker than getting it right first time, and it is meant
      // to. The attempt number is here so analytics never has to guess.
      extensions: { [`${CATEGORY}attempt`]: attempts },
    },
  });
  hooks.refreshFooter();
  return verdict;
}

/** Everything in the panel except the retry button, which the panel owns for
 *  its whole life and `sync` alone shows or hides. */
export function setFeedbackMessage(feedback, children) {
  feedback.querySelectorAll(':scope > :not(.lp-retry)').forEach((node) => node.remove());
  const retry = feedback.querySelector(':scope > .lp-retry');
  children.filter(Boolean).forEach((child) => feedback.insertBefore(child, retry));
}

/** Take a marked question back to a blank one, for a second go. The record
 *  stays — the miss happened and is already reported. */
export function clearVerdict(block, feedback) {
  delete block.dataset.verdict;
  delete feedback.dataset.verdict;
  feedback.hidden = true;
  setFeedbackMessage(feedback, []);
}

/** The "try again" control. It lives INSIDE the feedback panel — the message
 *  and the way out of it are one surface, not two stacked boxes — so it is
 *  appended here, once, and the shape renderers never place it. */
export function retryControl(item, question, feedback, reset) {
  const key = answerKey(item, question);
  const button = el('button', { class: 'lp-btn lp-btn--ghost lp-retry', type: 'button' }, [
    icon('retry'), el('span', { text: t('nav.retry') }),
  ]);
  const sync = () => {
    button.hidden = !canRetry(key);
    // An author may leave the feedback sentence empty; the panel still has to
    // surface while it holds a live way to try again.
    if (!button.hidden) feedback.hidden = false;
  };
  button.addEventListener('click', () => {
    button.hidden = true;
    reset();
  });
  feedback.append(button);
  sync();
  return { sync };
}

/** Did the answer actually get marked? A `null` verdict means "ask again". */
export const isGraded = (verdict) => verdict?.correct != null;

/** Paint a verdict: the sentence the author wrote, and nothing numeric. */
export function showVerdict(block, feedback, verdict) {
  if (!isGraded(verdict)) {
    // Nothing was recorded — this is about the connection, not the answer, so
    // it surfaces as a passing toast rather than becoming part of the page.
    toast(t('error.grade'));
    return;
  }
  const mark = verdict.correct ? 'correct' : 'incorrect';
  const text = pick(verdict.feedback);
  // One glyph per verdict: the check confirms; a wrong answer's only icon is
  // the one on the retry button itself.
  setFeedbackMessage(feedback, [
    verdict.correct ? icon('check') : null,
    el('span', { class: 'lp-feedback__msg', text }),
  ]);
  // The panel shows when there is a sentence to read OR a retry to offer —
  // call order varies between shapes, so check the button rather than assume.
  feedback.hidden = !text && !feedback.querySelector(':scope > .lp-retry:not([hidden])');
  feedback.dataset.verdict = mark;
  block.dataset.verdict = mark;
  // On the smallest screens a long board can push the response below the fold,
  // and a learner who does not see it concludes nothing happened. `nearest`
  // means this does nothing at all when it is already in view.
  if (!feedback.hidden) feedback.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
