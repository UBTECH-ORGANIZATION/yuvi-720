/* The material zone: one renderer per kind of screen.
 *
 * `renderBody` is the dispatch. A kind with no renderer returns null and the
 * screen falls back to its brief plus its questions, which is why an item with
 * no `presentation.kind` still works — it just says less than it could.
 */

import { componentId, itemObject, lang, launch, state } from './context.js';
import { el, icon, setButtonLabel } from './dom.js';
import { pick, t } from './i18n.js';
import { assessSpeech, speak, stopSpeaking } from './speech.js';
import { renderChoices } from './questions.js';
import { report } from './xapi.js';

function renderAudio(item) {
  const p = item.presentation;
  const wrap = el('div', { class: 'lp-audio' });
  let slow = false;
  let playing = false;

  const button = el('button', {
    class: 'lp-play', type: 'button', 'data-playing': 'false',
  });
  setButtonLabel(button, 'play', t('audio.play'));
  const play = () => {
    if (playing) {
      stopSpeaking();
      playing = false;
      button.dataset.playing = 'false';
      setButtonLabel(button, 'play', t('audio.play'));
      report('paused', { object: itemObject(item) });
      return;
    }
    playing = true;
    button.dataset.playing = 'true';
    setButtonLabel(button, 'stop', t('audio.stop'));
    report('played', { object: itemObject(item) });
    speak(p.script, {
      locale: p.language || 'en-US',
      rate: (p.rate || 1) * (slow ? 0.7 : 1),
      onEnd: () => {
        playing = false;
        button.dataset.playing = 'false';
        setButtonLabel(button, 'play', t('audio.play'));
      },
    });
  };
  button.addEventListener('click', play);
  wrap.append(button);

  const slower = el('button', {
    class: 'lp-chip', type: 'button', 'aria-pressed': 'false',
  }, [icon('slower'), el('span', { text: t('audio.slow') })]);
  slower.addEventListener('click', () => {
    slow = !slow;
    slower.setAttribute('aria-pressed', String(slow));
    if (playing) { playing = false; play(); }
  });
  wrap.append(slower);

  const block = el('div', { class: 'lp-q' }, [wrap]);

  if (p.transcriptAvailable) {
    const transcript = el('p', { class: 'lp-note lp-en', text: p.script, hidden: true });
    const toggle = el('button', {
      class: 'lp-chip', type: 'button', 'aria-pressed': 'false',
    }, [icon('transcript'), el('span', { text: t('audio.transcript') })]);
    toggle.addEventListener('click', () => {
      const show = transcript.hasAttribute('hidden');
      transcript.toggleAttribute('hidden', !show);
      toggle.setAttribute('aria-pressed', String(show));
      if (show) report('requested', { object: itemObject(item), category: 'transcript' });
    });
    wrap.append(toggle);
    block.append(transcript);
  }
  if (p.support && pick(p.support)) {
    block.append(el('p', { class: 'lp-support', text: pick(p.support) }));
  }
  return block;
}

/* One reading line, drawn as the thing it is.
 *
 * These texts are not prose — they are an invitation, a school notice, a message
 * thread. Rendering every line as the same grey paragraph turned a poster title
 * into shouting, a `---` into literal punctuation on screen, and a conversation
 * into a block of names. The content says which is which; this draws it.
 */
function lineContent(line) {
  const text = line.text;
  if (line.role === 'field' || line.role === 'speaker') {
    const at = text.indexOf(':');
    return [
      el('span', { class: `lp-line__${line.role === 'field' ? 'label' : 'who'}`, text: text.slice(0, at) }),
      el('span', { class: 'lp-line__value', text: text.slice(at + 1).trim() }),
    ];
  }
  return [el('span', { class: 'lp-line__value', text })];
}

/** The visible promise that a line speaks. Clicking the line always did this —
 *  but a bare block of text does not LOOK like it will, and a learner who has
 *  to discover it by accident mostly never does. Decorative to a screen reader:
 *  the whole line is the button, and it already announces its text. */
const lineSpeaker = () =>
  el('span', { class: 'lp-line__play', 'aria-hidden': 'true' }, [icon('sound')]);

function renderLines(item) {
  const p = item.presentation;
  const list = el('ul', { class: 'lp-lines' });
  (p.lines || []).forEach((raw) => {
    // A line is a bare string, or an object that declares its role.
    const line = typeof raw === 'string' ? { text: raw } : raw;

    if (line.role === 'divider') {
      // A rule between two documents. There is nothing here to read aloud, so
      // it is not a button and screen readers step over it.
      list.append(el('li', { class: 'lp-lines__gap' }, [el('hr', { 'aria-hidden': 'true' })]));
      return;
    }

    const button = el('button', {
      class: `lp-line lp-en${line.role ? ` lp-line--${line.role}` : ''}`,
      type: 'button',
    }, [...lineContent(line), lineSpeaker()]);
    button.addEventListener('click', () => {
      list.querySelectorAll('[data-speaking]').forEach((node) => node.removeAttribute('data-speaking'));
      button.dataset.speaking = 'true';
      report('read', { object: itemObject(item) });
      speak(line.text, {
        locale: p.language || 'en-US',
        rate: p.rate || 1,
        onEnd: () => button.removeAttribute('data-speaking'),
      });
    });
    list.append(el('li', {}, [button]));
  });

  const block = el('div', { class: 'lp-q' }, [list]);
  if (p.glossary?.length) {
    block.append(el('p', { class: 'lp-kicker', text: t('glossary.title') }));
    block.append(el('ul', { class: 'lp-glossary' }, p.glossary.map((entry) =>
      el('li', { text: `${entry.word} — ${entry[lang] || entry.he || ''}` }))));
  }
  return block;
}

function renderReflection(item) {
  return renderChoices(item, item.presentation.choices || [], 'isUnderstood');
}

function renderWriting(item) {
  const p = item.presentation;
  const block = el('div', { class: 'lp-write' });
  const area = el('textarea', {
    class: 'lp-en',
    rows: '6',
    placeholder: pick(p.placeholder) || '',
    'aria-label': pick(p.prompt),
  });
  area.value = state.written.get(item.id) || '';
  area.addEventListener('input', () => state.written.set(item.id, area.value));
  block.append(area);

  const boxes = [];
  if (p.checklist?.length) {
    block.append(el('p', { class: 'lp-kicker', text: t('write.checklist') }));
    block.append(el('ul', { class: 'lp-checklist' }, p.checklist.map((entry) => {
      const box = el('input', { type: 'checkbox' });
      boxes.push(box);
      return el('li', {}, [el('label', {}, [box, el('span', { text: pick(entry) })])]);
    })));
  }

  const saved = el('p', { class: 'lp-feedback', hidden: true, text: t('write.saved') });
  // Formative feedback on the text itself: what works, and one next step. Words
  // only — the coach never returns a score for a piece of writing.
  const coach = el('div', { class: 'lp-coach', hidden: true });
  const submit = el('button', { class: 'lp-btn lp-btn--ghost', type: 'button', text: t('nav.check') });
  submit.addEventListener('click', async () => {
    const text = (area.value || '').trim();
    if (!text) return;
    saved.hidden = false;
    // Open writing is submitted, not auto-scored — the response goes to the
    // platform, and the teacher/agent read it there. It must stay out of the
    // component score, which only reflects what was actually graded.
    report('submitted', { object: itemObject(item), result: { response: text.slice(0, 1000) } });
    await requestWritingFeedback({ item, text, coach, submit, boxes });
  });
  block.append(submit, saved, coach);
  return block;
}

/** Ask the server to comment on a written text, then render the reply. */
async function requestWritingFeedback({ item, text, coach, submit, boxes }) {
  setButtonLabel(submit, 'pen', t('write.checking'));
  submit.disabled = true;
  let review = null;
  try {
    const response = await fetch(`/content/player/${encodeURIComponent(componentId)}/writing-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: launch.auth },
      body: JSON.stringify({ itemId: item.id, text: text.slice(0, 2000), lang }),
    });
    if (response.ok) review = await response.json();
  } catch {
    review = null;
  }
  submit.disabled = false;
  setButtonLabel(submit, 'retry', t('write.again'));
  if (!review) { coach.hidden = true; return; }

  // Only lines the server could VERIFY are ticked; an undecidable line
  // ("I read it again") stays for the learner to answer.
  (review.checklist || []).forEach((row) => {
    const box = boxes[row.index];
    if (box && row.met === true) box.checked = true;
  });

  coach.replaceChildren(
    el('p', { class: 'lp-coach__praise', text: review.praise || '' }),
    el('p', { class: 'lp-coach__next' }, [
      icon('tip'),
      el('span', { text: review.next_step || '' }),
    ]),
    ...(review.ai_generated ? [el('p', { class: 'lp-coach__ai', text: t('write.ai') })] : []),
  );
  coach.hidden = false;
}

function renderMediation(item) {
  const p = item.presentation;
  const block = el('div', { class: 'lp-write' });
  // The text to be carried across is in the learner's own language — Hebrew
  // for a Hebrew learner, Arabic for an Arabic one. `pick` is what makes the
  // alternative representation stop doubling as a language switch.
  block.append(el('div', { class: 'lp-source', dir: 'auto', text: pick(p.source) }));
  return el('div', {}, [block, renderWriting(item)]);
}

function renderSpeaking(item) {
  const p = item.presentation;
  const block = el('div', { class: 'lp-q' });
  block.append(el('p', { class: 'lp-kicker', text: t('speak.model') }));

  const lines = Array.isArray(p.referenceText) ? p.referenceText : [p.referenceText].filter(Boolean);
  const list = el('ul', { class: 'lp-lines' });
  lines.forEach((line) => {
    const button = el('button', { class: 'lp-line lp-en', type: 'button' }, [
      el('span', { class: 'lp-line__value', text: line }),
      lineSpeaker(),
    ]);
    button.addEventListener('click', () => {
      list.querySelectorAll('[data-speaking]').forEach((node) => node.removeAttribute('data-speaking'));
      button.dataset.speaking = 'true';
      report('played', { object: itemObject(item) });
      speak(line, {
        locale: p.language || 'en-US',
        rate: p.rate || 0.9,
        onEnd: () => button.removeAttribute('data-speaking'),
      });
    });
    list.append(el('li', {}, [button]));
  });
  block.append(list);

  if (p.support && pick(p.support)) {
    block.append(el('p', { class: 'lp-support', text: pick(p.support) }));
  }

  // ── your turn ──
  const reference = lines.join(' ');
  const feedback = el('div', { class: 'lp-feedback', hidden: true });
  const status = el('p', { class: 'lp-note', text: '' });
  const mic = el('button', { class: 'lp-play lp-mic', type: 'button' });
  setButtonLabel(mic, 'mic', t('speak.record'));
  let busy = false;

  const paintWords = (accuracy) => {
    list.querySelectorAll('.lp-line').forEach((node) => {
      const spoken = (node.textContent || '').split(/\s+/).map((word) => {
        const key = word.replace(/[^A-Za-z']/g, '').toLowerCase();
        const score = accuracy[key];
        const span = el('span', { class: 'lp-word', text: word + ' ' });
        // A tint, never a number — the learner sees which word to try, not a mark.
        if (score != null) span.dataset.said = score < 65 ? 'retry' : 'good';
        return span;
      });
      node.replaceChildren(...spoken);
    });
  };

  mic.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    mic.dataset.playing = 'true';
    setButtonLabel(mic, 'mic', t('speak.listening'));
    status.textContent = '';
    try {
      const assessment = await assessSpeech(reference);
      const response = await fetch(`/content/player/${encodeURIComponent(componentId)}/pronunciation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: launch.auth },
        body: JSON.stringify({
          assessment, language: lang, referenceText: reference,
          itemId: item.id, questionId: 'speaking',
        }),
      });
      const verdict = await response.json();
      const words = verdict.feedback?.wordAccuracy || {};
      paintWords(Object.fromEntries(Object.entries(words).map(([k, v]) => [k.toLowerCase(), v])));
      feedback.replaceChildren(
        el('p', { text: verdict.feedback?.headline || '' }),
        ...(verdict.feedback?.notes || []).map((note) => el('p', { class: 'lp-note', text: note })),
        el('p', { class: 'lp-kicker', text: verdict.feedback?.nextStep || '' }),
      );
      feedback.dataset.verdict = verdict.feedback?.band === 'strong' ? 'correct' : '';
      feedback.hidden = false;
      // `/q1`, not `/speaking`: the platform parses an answer object as
      // `{item}/q{N}` (see `events.resolve_item_question`). A non-numeric tail
      // parses to no item and no question, so every spoken answer was stored
      // with `sub_item_id: null` — invisible to the question summary, to the
      // hard-question rows a teacher reads, and to the questionId the MoE LRS
      // expects. Speaking items carry no authored questions, so `q1` is free.
      report('answered', {
        object: `${itemObject(item)}/q1`,
        result: { response: reference, success: verdict.feedback?.band !== 'developing' },
      });
    } catch (error) {
      // Speaking must never be a dead end: if the mic or the service is not
      // available the learner keeps going, and says so in their own words.
      status.textContent = error?.message === 'no_speech' ? t('speak.again') : t('speak.nomic');
    } finally {
      busy = false;
      mic.dataset.playing = 'false';
      setButtonLabel(mic, 'retry', t('speak.retry'));
    }
  });

  block.append(el('p', { class: 'lp-kicker', text: t('speak.your_turn') }), mic, status, feedback);

  if (p.selfCheck?.length) {
    block.append(el('p', { class: 'lp-kicker', text: t('speak.check') }));
    // Saying it out loud is also a self-report, which 720 models as `selected`.
    block.append(renderChoices(item, p.selfCheck, 'isUnderstood'));
  }
  return block;
}

export function renderBody(item) {
  const kind = item.presentation?.kind;
  if (kind === 'listening') return renderAudio(item);
  if (kind === 'reading') return renderLines(item);
  if (kind === 'speaking') return renderSpeaking(item);
  if (kind === 'reflection') return renderReflection(item);
  if (kind === 'writing') return renderWriting(item);
  if (kind === 'mediation') return renderMediation(item);
  return null;
}
