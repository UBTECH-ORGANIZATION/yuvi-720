/* The task zone: the frame every graded question shares, and the ungraded
 * self-report row.
 *
 * What is common lives here — the counter, the question itself, its picture, and
 * the one line of feedback underneath. What differs is a renderer per shape, and
 * each of those only ever collects a response string: marking is a server
 * round-trip in `grading.js`, because the answer key never reaches the browser.
 */

import { itemObject, state } from './context.js';
import { el } from './dom.js';
import { pick, t } from './i18n.js';
import { mediaImage } from './media.js';
import { renderChoice } from './q-choice.js';
import { renderMatch } from './q-match.js';
import { renderText } from './q-text.js';
import { report } from './xapi.js';

/** How to collect an answer of this shape. Anything unrecognised falls back to
 *  options, which is what all but a handful of this catalog is written in. */
const RENDERERS = {
  match: renderMatch,
  'text-entry': renderText,
};

export function renderQuestion(item, question, index = 0, total = 1, { hoistImage = false } = {}) {
  const block = el('div', { class: 'lp-q lp-qcard' });
  block.append(el('p', {
    class: 'lp-qnum',
    text: total > 1 ? t('q.of', { n: index + 1, total }) : t('q.one'),
  }));

  // A picture the question is ABOUT normally lives in the card's media pane —
  // the card hoists it there (`hoistImage`) so the question sits beside its
  // picture instead of under it. It renders here only when the pane is already
  // taken by a screen picture. Option pictures always stay in their buttons.
  if (!hoistImage) {
    const picture = mediaImage(question.image, { sizes: '(min-width: 700px) 40vw, 90vw' });
    if (picture) block.append(el('figure', { class: 'lp-q__figure' }, [picture]));
  }

  if (question.questionText) {
    block.append(el('p', { class: 'lp-q__text lp-en', text: question.questionText }));
  }

  const feedback = el('div', { class: 'lp-feedback', hidden: true });
  const render = RENDERERS[question.questionType] || renderChoice;
  block.append(render(item, question, block, feedback), feedback);
  return block;
}

/** A self-report row (reflection / speaking self-check) — chosen once, and still
 *  visibly chosen if the learner walks back to the screen. */
export function renderChoices(item, choices, category) {
  const key = `${item.id}|${category}`;
  const done = el('p', { class: 'lp-feedback', hidden: !state.written.has(key), text: t('reflect.thanks') });
  // No numbered keys here: these are a choice about oneself, not answers to be
  // enumerated, and numbering them would imply one of them is the right one.
  const options = el('div', { class: 'lp-options lp-options--choice' });
  choices.forEach((choice) => {
    const option = el('button', { class: 'lp-option', type: 'button', text: pick(choice.label) });
    const settle = () => {
      options.querySelectorAll('button').forEach((node) => { node.disabled = true; });
      option.dataset.verdict = 'correct';
      done.hidden = false;
    };
    option.addEventListener('click', () => {
      if (state.written.has(key)) return;
      state.written.set(key, choice.id);
      settle();
      // A self-report, not an assessed answer — 720 models that as `selected`.
      report('selected', { object: itemObject(item), result: { response: choice.id }, category });
    });
    if (state.written.get(key) === choice.id) settle();
    options.append(option);
  });
  if (state.written.has(key)) options.querySelectorAll('button').forEach((node) => { node.disabled = true; });
  return el('div', { class: 'lp-q' }, [options, done]);
}
