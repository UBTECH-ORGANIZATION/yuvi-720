/* Pick one of the options — the shape most of this catalog is written in.
 *
 * Two layouts from one renderer. Word options are buttons in a grid; picture
 * options are the same buttons with the image inside them, because a seven-year
 * vocabulary gap is easier to cross with a picture than with a longer sentence.
 * The picture is never the only channel: every option keeps its word, and every
 * image keeps its alt text, so the question survives with the images off.
 */

import { state } from './context.js';
import { el } from './dom.js';
import { mediaImage } from './media.js';
import { answerKey, canRetry, clearVerdict, grade, isGraded, retryControl, showVerdict } from './grading.js';

export function renderChoice(item, question, block, feedback) {
  const key = answerKey(item, question);
  const answers = question.answers || [];
  const media = question.answerMedia || {};
  const pictorial = answers.some((answer) => media[answer]);

  // Two columns suit short answers ("grandmother", "True"). Once an option is a
  // sentence, side-by-side wrapped text is harder to read than a single clean
  // column — so the set decides its own shape from its longest member.
  const longest = answers.reduce((max, answer) => Math.max(max, String(answer).length), 0);
  const options = el('div', {
    // Options are in the target language, so they read and order LTR even here.
    class: `lp-options lp-en${pictorial ? ' lp-options--picture' : longest > 32 ? ' lp-options--long' : ''}`,
  });

  const setLocked = (value) =>
    options.querySelectorAll('button').forEach((node) => { node.disabled = value; });

  // A second go clears the marks and hands the options back — except the one
  // already ruled out, which stays greyed. Offering it again would be inviting
  // the learner to repeat an answer we have both just agreed is wrong.
  const retry = retryControl(item, question, feedback, () => {
    clearVerdict(block, feedback);
    options.querySelectorAll('button').forEach((node) => {
      if (node.dataset.verdict) return;
      node.disabled = false;
    });
  });

  const settle = (option, verdict) => {
    if (!isGraded(verdict)) {
      // Nothing was recorded, so the options must come back — otherwise a
      // dropped connection leaves the learner staring at a dead screen with
      // "continue" still locked.
      setLocked(false);
      showVerdict(block, feedback, verdict);
      return;
    }
    option.dataset.verdict = verdict.correct ? 'correct' : 'incorrect';
    setLocked(true);
    showVerdict(block, feedback, verdict);
    retry.sync();
  };

  const previous = state.answered.get(key);
  answers.forEach((answer, position) => {
    const picture = media[answer] ? mediaImage(media[answer], { sizes: '(min-width: 700px) 22vw, 40vw' }) : null;
    const option = el('button', { class: 'lp-option lp-en', type: 'button' }, [
      picture,
      // A numbered key, not a letter: the options themselves are English, the
      // surrounding page is usually Hebrew, and a digit is the one marker that
      // reads the same in both and cannot be mistaken for part of the answer.
      el('span', { class: 'lp-option__key', 'aria-hidden': 'true', text: String(position + 1) }),
      el('span', { class: 'lp-option__text', text: answer }),
    ]);
    option.addEventListener('click', async () => {
      // Settled means answered AND out of goes. Checking only "was it ever
      // answered" is the bug that made the second go unclickable: the first
      // miss stays in `answered` (it happened, and it is counted), so the
      // guard has to ask about the retry, not the record.
      if (state.answered.has(key) && !canRetry(key)) return;
      setLocked(true);  // no second click while the first is in flight
      settle(option, await grade(item, question, answer));
    });
    if (previous && answer === previous.response) settle(option, previous);
    options.append(option);
  });

  if (previous) setLocked(true);
  return el('div', { class: 'lp-choice' }, [options]);
}
