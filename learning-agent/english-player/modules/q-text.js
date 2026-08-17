/* Type the answer — no options to choose from, and nothing to guess between.
 *
 * This is the one question shape where a learner cannot arrive at the right
 * answer by elimination, which is exactly why it is worth having and why it is
 * used sparingly: it is the productive end of a vocabulary goal, not the way to
 * ask everything.
 *
 * The field is `lang="en" dir="ltr"` regardless of the surrounding interface —
 * a Hebrew learner typing an English word inside an RTL page otherwise watches
 * the caret jump to the wrong end of what they are writing.
 */

import { state } from './context.js';
import { el, icon } from './dom.js';
import { t } from './i18n.js';
import { answerKey, canRetry, clearVerdict, grade, isGraded, retryControl, setFeedbackMessage, showVerdict } from './grading.js';

export function renderText(item, question, block, feedback) {
  const key = answerKey(item, question);
  const previous = state.answered.get(key);

  const field = el('input', {
    class: 'lp-text__input lp-en',
    type: 'text',
    lang: 'en',
    dir: 'ltr',
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    placeholder: t('text.placeholder'),
    'aria-label': question.questionText || t('text.how'),
    value: previous ? previous.response : '',
    disabled: Boolean(previous),
  });

  const check = el('button', { class: 'lp-btn', type: 'button' }, [
    icon('check'), el('span', { text: t('nav.check') }),
  ]);
  check.disabled = Boolean(previous);

  // A second go leaves what they wrote in the box and puts the caret at the end:
  // a typed answer is usually nearly right, and clearing it would make them
  // retype the part that was fine.
  const retry = retryControl(item, question, feedback, () => {
    clearVerdict(block, feedback);
    field.disabled = false;
    check.disabled = false;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  });

  const submit = async () => {
    if (!canRetry(key) && state.answered.has(key)) return;
    const typed = field.value.trim();
    if (!typed) {
      // Not marked as wrong: an empty box is a learner who has not answered
      // yet, and recording that as a mistake would be a lie to the LRS.
      setFeedbackMessage(feedback, [el('span', { class: 'lp-feedback__msg', text: t('text.empty') })]);
      feedback.hidden = false;
      field.focus();
      return;
    }
    field.disabled = true;
    check.disabled = true;
    const verdict = await grade(item, question, typed);
    if (!isGraded(verdict)) {
      field.disabled = false;
      check.disabled = false;
    }
    showVerdict(block, feedback, verdict);
    retry.sync();
  };

  check.addEventListener('click', submit);
  field.addEventListener('keydown', (event) => {
    // Enter is what a learner reaches for, and on a phone keyboard it is often
    // the only submit control visible above the keyboard.
    if (event.key === 'Enter') { event.preventDefault(); submit(); }
  });

  if (previous) showVerdict(block, feedback, previous);
  return el('div', { class: 'lp-text' }, [
    el('p', { class: 'lp-text__how', text: t('text.how') }),
    el('div', { class: 'lp-text__row' }, [field, check]),
  ]);
}
