/* Matching — pair each item on the left with the one that goes with it.
 *
 * The base interaction is TAP-TO-PAIR, not drag: tap an item, then tap what goes
 * with it. That single model is already everything accessibility asks for — the
 * pieces are real `<button>`s, so a keyboard tabs to them and Enter activates
 * them, a switch device works it, and a learner with unsteady hands is never
 * asked to hold a contact across the screen. Dragging is layered on top for the
 * learners who reach for it, and nothing depends on it working.
 *
 * The pairing itself is never marked here. The response is canonicalised to
 * `p1=answer|p2=answer` and sent; the server owns the key.
 */

import { state } from './context.js';
import { el, icon } from './dom.js';
import { pick, t } from './i18n.js';
import { mediaImage } from './media.js';
import { answerKey, clearVerdict, grade, isGraded, retryControl, showVerdict } from './grading.js';

/** `p1=a|p2=b` → Map. The response format is a set of pairs, so the order a
 *  learner happens to build them in never changes the verdict. */
function parsePairs(response) {
  const pairs = new Map();
  String(response || '').split('|').forEach((chunk) => {
    const at = chunk.indexOf('=');
    if (at > 0) pairs.set(chunk.slice(0, at), chunk.slice(at + 1));
  });
  return pairs;
}

export function renderMatch(item, question, block, feedback) {
  const key = answerKey(item, question);
  const prompts = question.prompts || [];
  const answers = question.answers || [];
  const previous = state.answered.get(key);

  const pairs = previous ? parsePairs(previous.response) : new Map();
  let held = null;   // the prompt id waiting for its answer, or an answer chip
  let locked = Boolean(previous);
  // Per-pair marks. Read from the record on a revisit and replaced when the
  // board is marked, so a freshly checked board and a returned-to one render
  // through exactly the same path.
  let marks = previous?.detail || null;

  const board = el('div', { class: 'lp-match' });
  const how = el('p', { class: 'lp-match__how', text: t('match.how') });
  // Two different jobs, so two elements. The visible line is a running count,
  // which is what a sighted learner needs; the announcement of an individual
  // pair is only useful to someone who cannot see the row fill in, so it goes to
  // a region that is read out and not drawn.
  const status = el('p', { class: 'lp-match__status' });
  const live = el('p', { class: 'lp-sr', 'aria-live': 'polite', role: 'status' });
  const column = el('ul', { class: 'lp-match__prompts' });
  const pool = el('div', { class: 'lp-match__pool lp-en' });
  const check = el('button', { class: 'lp-btn lp-match__check', type: 'button' });

  // `alt` is a trilingual object, not a string — an image-only prompt whose
  // label was taken raw would announce itself as "[object Object]".
  const promptLabel = (prompt) => prompt.text || pick(prompt.media?.alt) || prompt.id;
  const unpaired = () => prompts.filter((p) => !pairs.get(p.id));

  /* ── the two operations ──────────────────────────────────────────────── */

  function pair(promptId, answer) {
    if (locked) return;
    // One answer belongs to one prompt: taking it from where it was is what a
    // learner expects, and it keeps the pool honest about what is left.
    for (const [id, value] of pairs) if (value === answer) pairs.delete(id);
    pairs.set(promptId, answer);
    held = null;
    draw();
    const prompt = prompts.find((p) => p.id === promptId);
    say(t('match.paired', { prompt: promptLabel(prompt), answer }));
  }

  function unpair(promptId) {
    if (locked || !pairs.has(promptId)) return;
    pairs.delete(promptId);
    held = null;
    draw();
    say(t('match.left', { n: unpaired().length }));
  }

  const say = (message) => { live.textContent = message; };

  /* ── drawing ─────────────────────────────────────────────────────────── */

  function draw() {
    column.replaceChildren();
    prompts.forEach((prompt) => {
      const answer = pairs.get(prompt.id);
      const active = held?.kind === 'prompt' && held.id === prompt.id;
      const row = el('button', {
        class: 'lp-match__prompt',
        type: 'button',
        disabled: locked,
        'aria-pressed': active ? 'true' : 'false',
        'aria-label': answer
          ? t('match.paired', { prompt: promptLabel(prompt), answer })
          : t('match.pick', { prompt: promptLabel(prompt) }),
      }, [
        prompt.media ? mediaImage(prompt.media, { sizes: '(min-width: 700px) 18vw, 33vw' }) : null,
        prompt.text ? el('span', { class: 'lp-match__label lp-en', text: prompt.text }) : null,
        el('span', {
          class: `lp-match__slot lp-en${answer ? ' lp-match__slot--filled' : ''}`,
          text: answer || '',
        }),
      ]);
      row.dataset.prompt = prompt.id;
      if (active) row.dataset.active = '';
      // Only after marking, and only per pair: which rows to look at again,
      // never what the right pairing would have been.
      const mark = marks?.[prompt.id];
      if (locked && mark != null) row.dataset.verdict = mark ? 'correct' : 'incorrect';

      row.addEventListener('click', () => {
        if (locked) return;
        if (held?.kind === 'answer') return pair(prompt.id, held.answer);
        if (pairs.has(prompt.id)) return unpair(prompt.id);
        held = active ? null : { kind: 'prompt', id: prompt.id };
        draw();
        if (held) say(t('match.pick', { prompt: promptLabel(prompt) }));
      });
      column.append(el('li', {}, [row]));
    });

    pool.replaceChildren();
    answers.forEach((answer) => {
      const used = [...pairs.values()].includes(answer);
      const active = held?.kind === 'answer' && held.answer === answer;
      const chip = el('button', {
        class: 'lp-match__chip lp-en',
        type: 'button',
        text: answer,
        disabled: locked || used,
        'aria-pressed': active ? 'true' : 'false',
      });
      chip.dataset.answer = answer;
      if (active) chip.dataset.active = '';
      if (used) chip.dataset.used = '';
      chip.addEventListener('click', () => {
        if (locked || used) return;
        if (held?.kind === 'prompt') return pair(held.id, answer);
        held = active ? null : { kind: 'answer', answer };
        draw();
      });
      enableDrag(chip, answer);
      pool.append(chip);
    });

    const ready = unpaired().length === 0;
    check.disabled = locked || !ready;
    check.replaceChildren(icon('check'), el('span', { text: t('nav.check') }));
    // Once the board is marked the pool is spent and the button is dead, and
    // between them they hold the room the feedback needs. A marked screen is a
    // result, not a task, so it stops showing the tools of one.
    pool.hidden = locked;
    check.hidden = locked;
    // …and so do the instructions: on a marked board they describe a task the
    // learner has already finished, and one of them ("tap to undo") would be
    // telling them to do something that no longer works.
    how.hidden = locked;
    status.hidden = locked;
    status.textContent = ready ? t('match.ready') : t('match.left', { n: unpaired().length });
  }

  /* ── drag, as an enhancement ─────────────────────────────────────────── */

  function enableDrag(chip, answer) {
    chip.addEventListener('pointerdown', (event) => {
      if (locked || event.button > 0) return;
      const from = { x: event.clientX, y: event.clientY };
      let dragging = false;
      let ghost = null;

      const move = (moveEvent) => {
        const far = Math.hypot(moveEvent.clientX - from.x, moveEvent.clientY - from.y) > 8;
        if (!dragging && !far) return;   // below this, it is still a tap
        if (!dragging) {
          dragging = true;
          chip.setPointerCapture(moveEvent.pointerId);
          ghost = el('div', { class: 'lp-match__ghost lp-en', text: answer });
          document.body.append(ghost);
          chip.dataset.dragging = '';
        }
        ghost.style.transform =
          `translate(calc(${moveEvent.clientX}px - 50%), calc(${moveEvent.clientY}px - 50%))`;
        const over = dropTarget(moveEvent);
        column.querySelectorAll('.lp-match__prompt').forEach((row) => {
          row.toggleAttribute('data-over', row === over);
        });
      };

      const finish = (upEvent) => {
        chip.removeEventListener('pointermove', move);
        chip.removeEventListener('pointerup', finish);
        chip.removeEventListener('pointercancel', finish);
        ghost?.remove();
        delete chip.dataset.dragging;
        if (!dragging) return;           // a tap: the click handler takes it
        const target = dropTarget(upEvent);
        if (target?.dataset.prompt) pair(target.dataset.prompt, answer);
        else draw();
      };

      chip.addEventListener('pointermove', move);
      chip.addEventListener('pointerup', finish);
      chip.addEventListener('pointercancel', finish);
    });
  }

  const dropTarget = (event) => {
    // The ghost follows the pointer, so it would otherwise be what is under it.
    const under = document.elementFromPoint(event.clientX, event.clientY);
    return under?.closest?.('.lp-match__prompt') || null;
  };

  /* ── marking ─────────────────────────────────────────────────────────── */

  // A second go keeps the pairs that held up and frees only the ones that did
  // not. Sweeping a nearly-right board clean would punish the three rows the
  // learner got right in order to let them fix the one they did not.
  const retry = retryControl(item, question, feedback, () => {
    clearVerdict(block, feedback);
    Object.entries(marks || {}).forEach(([promptId, right]) => {
      if (!right) pairs.delete(promptId);
    });
    marks = null;
    locked = false;
    draw();
  });

  check.addEventListener('click', async () => {
    if (locked || unpaired().length) return;
    locked = true;
    draw();
    const response = prompts.map((p) => `${p.id}=${pairs.get(p.id)}`).join('|');
    const verdict = await grade(item, question, response);
    if (!isGraded(verdict)) {
      locked = false;                    // nothing was recorded — let them retry
      draw();
      showVerdict(block, feedback, verdict);
      return;
    }
    marks = verdict.detail || null;
    draw();
    showVerdict(block, feedback, verdict);
    retry.sync();
  });

  draw();
  if (previous) showVerdict(block, feedback, previous);
  board.append(how, column, status, pool, check, live);
  return board;
}
