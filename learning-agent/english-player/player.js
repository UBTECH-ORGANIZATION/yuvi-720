/**
 * Yuvilab lomda player.
 *
 * Standalone 720 content: launched with `slxapi`, authenticated only by that
 * token, reporting xAPI back to the endpoint it was handed. It renders content
 * and nothing else, so the same URL works inside our lesson frame and inside a
 * 720 platform's frame.
 *
 * It also owns the parts of נספח 1 §1 that belong to the content rather than to
 * the platform: opening and closing cards between items, learner-owned pace with
 * backward navigation, a break offer, resume-where-you-stopped, and read-aloud.
 */

import {
  CATEGORY, DEFAULT_BREAK_MINUTES, componentId, current, hooks, itemObject, items,
  hasNextQuestion, lang, launch, questionIndex, questionsDone, root, state, stepState, theme,
} from './modules/context.js';
import { el, flip, icon } from './modules/dom.js';
import { RTL, pick, t } from './modules/i18n.js';
import { mediaImage, preload } from './modules/media.js';
import { renderQuestion } from './modules/questions.js';
import { renderBody } from './modules/screens.js';
import { speak, stopSpeaking } from './modules/speech.js';
import { report } from './modules/xapi.js';

document.documentElement.lang = lang;
document.documentElement.dir = RTL.has(lang) ? 'rtl' : 'ltr';
if (theme) document.documentElement.dataset.theme = theme;

/* ── navigation ─────────────────────────────────────────────────────────── */
function goTo(index, { report: shouldReport = true } = {}) {
  if (index < 0 || index >= items().length) return;
  stopSpeaking();
  state.index = index;
  const item = current();
  const first = !state.visited.has(item.id);
  state.visited.add(item.id);
  // `initialized` per screen is what moves the platform's position pointer, so
  // it is also what makes resume work after a mid-task close.
  if (shouldReport) report('initialized', { object: itemObject(item) });
  if (first) maybeOfferBreak();
  render();
  // The next screen's pictures, fetched while this one is being read.
  preload(items()[index + 1]);
  // The page cannot scroll any more (see the layout law in player.css), so
  // "go to the top" means the card, on the rare screen long enough to have
  // scrolled. `render()` builds a fresh card, so this is belt and braces.
  root.querySelector('.lp-card')?.scrollTo({ top: 0 });
}

function maybeOfferBreak() {
  if (state.breakOffered) return;
  const minutes = state.payload?.component?.breakAfterMinutes || DEFAULT_BREAK_MINUTES;
  if (Date.now() - state.startedAt < minutes * 60_000) return;
  state.breakOffered = true;
  state.onBreak = true;
}

async function finish() {
  // First attempts only. A wrong answer buys a second go, but the component
  // verdict has to say what the learner could do unaided — it is what routes
  // them to the alternative representation (720 §3.3), and a score built from
  // final states would route nobody there at all.
  const graded = [...state.answered.values()]
    .map((entry) => (entry.firstCorrect === undefined ? entry.correct : entry.firstCorrect));
  const success = graded.length ? graded.filter(Boolean).length / graded.length >= 0.6 : true;
  state.finished = success ? 'success' : 'retry';
  // One sitting reports one completion. Re-reading the closing card must not
  // look to the platform like the learner finished the component again.
  if (!state.reported) {
    state.reported = true;
    report('completed', {
      result: {
        completion: true,
        success,
        // Collected for routing and analysis, never shown to the learner.
        score: graded.length ? { scaled: graded.filter(Boolean).length / graded.length } : undefined,
      },
      extensions: { [`${CATEGORY}isAssessment`]: !!state.payload?.component?.isAssessment },
    });
    // The host listens for the *provider* message shape, not a Yuvilab-private
    // one: `source: 'content-provider'` plus `event: 'component-completed'` is
    // what `LessonPage.handleProviderMessage` gates on. A message in any other
    // shape is dropped silently, which is what happened to this one — completion
    // still landed, but only via the SSE trigger and the 5s catalog poll, so the
    // celebration lagged for no reason anybody could see.
    window.parent?.postMessage(
      { source: 'content-provider', event: 'component-completed', componentId, success },
      '*',
    );
  }
  render();
}

/* ── chrome ─────────────────────────────────────────────────────────────── */
function renderHead() {
  const total = items().length;
  const strip = el('div', { class: 'lp-steps', role: 'group', 'aria-label': t('step.of', { n: state.index + 1, total }) });
  items().forEach((item, index) => {
    const step = el('button', {
      class: 'lp-step', type: 'button', 'data-state': stepState(index),
      'aria-label': t('step.of', { n: index + 1, total }),
      // 720 §1.5 — going BACK to finished content is always allowed; jumping
      // ahead is the platform's decision, not a click.
      disabled: index > state.index && !state.visited.has(item.id),
    });
    step.addEventListener('click', () => goTo(index));
    strip.append(step);
  });

  const tools = el('div', { class: 'lp-tools' });

  const aloud = el('button', {
    class: 'lp-tool', type: 'button', 'aria-pressed': String(state.readingAloud),
    'aria-label': t('read.aloud'), title: t('read.aloud'),
  }, [icon('sound')]);
  aloud.addEventListener('click', () => {
    if (state.readingAloud) { stopSpeaking(); state.readingAloud = false; aloud.setAttribute('aria-pressed', 'false'); return; }
    state.readingAloud = true;
    aloud.setAttribute('aria-pressed', 'true');
    const item = current();
    // The screen is two languages: instructions in the learner's, material in
    // English. One utterance in one voice made the other half unintelligible —
    // so each half is read by a voice that actually speaks it, in screen order.
    const instructions = [pick(item.presentation?.prompt), pick(item.presentation?.goal)]
      .filter(Boolean).join('. ');
    const material = [item.presentation?.script,
      ...(item.questions || []).map((q) => q.questionText)].filter(Boolean).join('. ');
    const done = () => { state.readingAloud = false; aloud.setAttribute('aria-pressed', 'false'); };
    const speakMaterial = () => speak(material, { locale: 'en-US', rate: 0.95, onEnd: done });
    report('requested', { object: itemObject(item), category: 'read-aloud' });
    if (instructions) speak(instructions, { locale: lang, onEnd: material ? speakMaterial : done });
    else if (material) speakMaterial();
    else done();
  });

  const size = el('button', {
    class: 'lp-tool', type: 'button', 'aria-label': t('a11y.text'), title: t('a11y.text'),
  }, [icon('textsize')]);
  size.addEventListener('click', () => {
    state.scale = { normal: 'large', large: 'xlarge', xlarge: 'normal' }[state.scale];
    root.dataset.scale = state.scale;
  });

  const contrast = el('button', {
    class: 'lp-tool', type: 'button', 'aria-pressed': String(state.contrast),
    'aria-label': t('a11y.contrast'), title: t('a11y.contrast'),
  }, [icon('contrast')]);
  contrast.addEventListener('click', () => {
    state.contrast = !state.contrast;
    contrast.setAttribute('aria-pressed', String(state.contrast));
    root.dataset.contrast = state.contrast ? 'high' : '';
  });

  tools.append(aloud, size, contrast);

  return el('header', { class: 'lp-head' }, [
    el('h1', { class: 'lp-head__title' }, [
      // The component title is an internal English label for authors; the unit
      // carries the learner-facing translations.
      el('span', { text: pick(state.payload.unit.titles) || state.payload.unit.title || '' }),
      el('small', { text: t('step.of', { n: state.index + 1, total }) }),
    ]),
    tools,
    strip,
  ]);
}

function renderFooter() {
  const existing = root.querySelector('.lp-foot');
  const item = current();
  const questions = item.questions || [];
  const at = questionIndex(item);
  // More questions waiting on THIS screen: continue moves within the screen
  // first. The progress strip still counts screens, so the learner's sense of
  // "where am I" does not change.
  const more = hasNextQuestion(item);
  const last = state.index === items().length - 1 && !more;
  const blocked = questions.length > 0
    && !state.answered.has(`${item.id}|${questions[at].questionId}`);

  const back = el('button', {
    class: 'lp-btn lp-btn--ghost', type: 'button', text: t('nav.back'),
    disabled: state.index === 0,
  });
  back.addEventListener('click', () => goTo(state.index - 1));

  const next = el('button', {
    class: 'lp-btn', type: 'button',
    disabled: blocked,
  }, [
    // "Start" belongs on a framing card, not on a screen that already asks
    // something — there the learner is continuing, not starting.
    el('span', {
      text: last ? t('nav.finish')
        : (item.presentation?.kind === 'intro' ? t('nav.start') : t('nav.next')),
    }),
    last ? icon('check') : flip(icon('next')),
  ]);
  next.addEventListener('click', () => {
    if (more) {
      // Same screen, next question — no `initialized`, because the learner has
      // not moved: the platform's position pointer is per screen, and reporting
      // one here would make the roadmap think they had.
      state.questionAt.set(item.id, at + 1);
      render();
      return;
    }
    if (last) { finish(); return; }
    goTo(state.index + 1);
  });

  // Back at the inline-start corner, primary at the inline-end corner. The
  // primary stays the literal last child: the harnesses (and a keyboard user
  // tabbing forward) rely on that.
  const foot = el('footer', { class: 'lp-foot' }, [back, next]);
  if (existing) existing.replaceWith(foot);
  return foot;
}

function renderBreak() {
  const banner = el('div', { class: 'lp-break' }, [el('p', { text: t('break.title') })]);
  const take = el('button', { class: 'lp-btn lp-btn--ghost', type: 'button', text: t('break.take') });
  take.addEventListener('click', () => {
    banner.replaceChildren(el('p', { text: t('break.back') }), back);
  });
  const back = el('button', { class: 'lp-btn', type: 'button', text: t('break.back') });
  back.addEventListener('click', () => { state.onBreak = false; state.startedAt = Date.now(); render(); });
  const cont = el('button', { class: 'lp-btn', type: 'button', text: t('break.continue') });
  cont.addEventListener('click', () => { state.onBreak = false; state.startedAt = Date.now(); render(); });
  banner.append(take, cont);
  return banner;
}

/* Each kind of screen names itself, so the learner can tell at a glance whether
   this is something to listen to, to read, or to say out loud. */
const STAGE_ICON = {
  listening: 'headphones', reading: 'book', speaking: 'mic',
  writing: 'pen', mediation: 'pen', reflection: 'think',
};

function renderStage(kind, body) {
  // Always a real `.lp-stage` wrapper, even for kinds without a label: the
  // card's inner grid places zones by named area, so a bare body would have
  // no cell to land in.
  const stage = el('div', { class: 'lp-stage', 'data-kind': kind });
  if (STAGE_ICON[kind]) {
    stage.append(el('p', { class: 'lp-stage__label' }, [icon(STAGE_ICON[kind]), el('span', { text: t(`stage.${kind}`) })]));
  }
  stage.append(body);
  return stage;
}

function renderCard() {
  const item = current();
  const p = item.presentation || {};
  const card = el('section', { class: 'lp-card', 'data-kind': p.kind || '', 'aria-label': item.title || '' });
  // The card itself is the frame's surface and its one allowed scroller (see
  // LAYOUT LAW in player.css). Everything visible lives in this inner wrapper,
  // whose auto block margins center a sparse screen and collapse to nothing on
  // a dense one — so short content sits mid-frame and long content top-aligns
  // and scrolls, with no measurement code involved.
  const inner = el('div', { class: 'lp-card__inner' });
  card.append(inner);

  // Zone 1 — what to do, in the learner's language. The authored item `title`
  // is an internal English label for authors and the agent; the learner's
  // heading is the localized prompt.
  const brief = el('div', { class: 'lp-brief' });
  // A framing screen carries no material, so it says what it is instead.
  if (p.kind === 'intro' || p.kind === 'summary') {
    const minutes = state.payload?.component?.estimatedMinutes;
    const parts = [t(`stage.${p.kind}`)];
    if (p.kind === 'intro' && minutes) parts.push(t('meta.minutes', { n: minutes }));
    brief.append(el('p', { class: 'lp-kicker', text: parts.join(' · ') }));
  }
  if (pick(p.prompt)) brief.append(el('h2', { class: 'lp-prompt', text: pick(p.prompt) }));
  if (pick(p.goal)) brief.append(el('p', { class: 'lp-note', text: pick(p.goal) }));
  if (pick(p.strategy)) {
    brief.append(el('p', { class: 'lp-tip' }, [
      icon('tip'),
      el('span', {}, [el('strong', { text: `${t('tip')}: ` }), document.createTextNode(pick(p.strategy))]),
    ]));
  }

  // The closing card's outcome text is part of the brief — every child of the
  // inner wrapper must own a named grid area, so nothing floats loose.
  if (p.kind === 'summary') {
    const outcome = state.finished === 'retry' ? p.onRetry : p.onSuccess;
    brief.append(el('h2', { class: 'lp-prompt', text: pick(outcome) || t('summary.done') }));
    if (pick(p.nextHint)) brief.append(el('p', { class: 'lp-note', text: pick(p.nextHint) }));
  }
  if (brief.childNodes.length) inner.append(brief);

  // Zone 2 — the media pane. One reserved slot per screen: the screen picture
  // when there is one, otherwise the current question's picture, hoisted out of
  // the task so text and image sit side by side instead of stacking. A picture
  // that belongs to an answer option is not media — it stays with its option.
  const questions = item.questions || [];
  const at = questionIndex(item);
  const question = questions[at];
  const hoistImage = !p.image && !!question?.image;
  const media = mediaImage(p.image, { sizes: '(min-width: 720px) 38vw, 92vw' })
    || (hoistImage ? mediaImage(question.image, { sizes: '(min-width: 720px) 38vw, 92vw' }) : null);
  if (media) inner.append(el('figure', { class: 'lp-media' }, [media]));

  // Zone 3 — the English material, on its own surface.
  const body = renderBody(item);
  if (body) inner.append(renderStage(p.kind, body));

  // Zone 4 — the task, one question at a time. Rendering all of a screen's
  // questions at once is what pushed a card past the viewport (two four-option
  // questions are ~800px on their own, against ~550px of room on a laptop), and
  // a wall of eight options is harder to read than the one being asked.
  if (question) {
    inner.append(el('div', { class: 'lp-task' }, [
      renderQuestion(item, question, at, questions.length, { hoistImage }),
    ]));
  }

  // The stylesheet lays the zones out by which ones exist — a task beside its
  // material, a picture in its own pane — so the card names what it carries.
  // The classes are hints; the grid still decides from the shell's own width.
  if (media) card.classList.add('lp-card--media');
  if (body) card.classList.add('lp-card--stage');
  if (question) card.classList.add('lp-card--task');
  return card;
}

/* The card is the one region allowed to scroll (see LAYOUT LAW in player.css),
 * and WCAG 2.1.1 says a region that scrolls has to be reachable by keyboard. It
 * usually is, through the buttons inside it — but the moment a question is
 * marked every one of those is disabled, and a learner navigating by keyboard is
 * left unable to scroll down to the feedback they just earned. So the card takes
 * a tab stop exactly while it overflows, and gives it back when it does not:
 * always focusable would put a stop on every screen that does not need one.
 */
function syncCardScrollFocus() {
  const card = root.querySelector('.lp-card');
  if (!card) return;
  const scrolls = card.scrollHeight > card.clientHeight + 1;
  const has = card.hasAttribute('tabindex');
  // Only ever WRITE on a change. The observer below watches attributes, and
  // setting one fires a record even when the value is identical — so an
  // unguarded write here is an infinite loop that never lets the page finish
  // loading.
  if (scrolls && !has) card.setAttribute('tabindex', '0');
  else if (!scrolls && has) card.removeAttribute('tabindex');
}

/* Content changes shape after the first paint — a verdict appears, an image
 * lands, the learner picks a bigger text size — so this is watched rather than
 * measured once. */
const watchCardOverflow = () => {
  if (!('ResizeObserver' in window)) return;
  const observer = new ResizeObserver(syncCardScrollFocus);
  new MutationObserver(() => {
    syncCardScrollFocus();
    const card = root.querySelector('.lp-card');
    if (card && card !== observer._card) {
      if (observer._card) observer.unobserve(observer._card);
      observer.observe(card);
      observer._card = card;
    }
  }).observe(root, { childList: true, subtree: true, attributes: true });
};

function render() {
  root.replaceChildren();
  root.dataset.scale = state.scale;
  if (state.contrast) root.dataset.contrast = 'high';
  root.append(renderHead());
  if (state.onBreak) { root.append(renderBreak()); return; }
  root.append(renderCard(), renderFooter());
  syncCardScrollFocus();
}

function fail(messageKey) {
  root.replaceChildren(el('div', { class: 'lp-error', text: t(messageKey) }));
}

/* ── boot ───────────────────────────────────────────────────────────────── */
// Answering a question has to unlock "continue", and the footer lives here. The
// question renderer calls this through `hooks` so the module graph keeps
// pointing one way (see `modules/context.js`).
hooks.refreshFooter = renderFooter;
watchCardOverflow();

async function boot() {
  if (!launch?.auth) { fail('error.auth'); return; }
  let payload;
  try {
    const response = await fetch(
      `/content/player/${encodeURIComponent(componentId)}/payload?lang=${lang}`,
      { headers: { Authorization: launch.auth } },
    );
    if (response.status === 401) { fail('error.auth'); return; }
    if (!response.ok) { fail('error.load'); return; }
    payload = await response.json();
  } catch {
    fail('error.load');
    return;
  }
  if (!payload.items?.length) { fail('error.load'); return; }

  state.payload = payload;
  report('enter');

  // 720 §1.7 — a reopened lesson knows what was already answered. The server
  // rebuilds this run's verdicts from the stored statements, so a reload keeps
  // every mark, keeps "continue" unlocked on settled screens, and keeps the
  // finish verdict honest instead of computing it from an empty map.
  (payload.previous || []).forEach((entry) => {
    if (!entry?.itemId || !entry?.questionId) return;
    state.answered.set(`${entry.itemId}|${entry.questionId}`, {
      correct: entry.correct === true,
      feedback: entry.feedback || {},
      detail: entry.detail || null,
      response: entry.response,
      attempts: entry.attempts || 1,
      firstCorrect: entry.firstCorrect === undefined ? entry.correct === true : entry.firstCorrect,
    });
  });

  // 720 §1.7 — reopen where the learner stopped, not at the top.
  const resumeIndex = payload.items.findIndex((item) => item.id === payload.resume?.itemId);
  payload.items.slice(0, Math.max(resumeIndex, 0)).forEach((item) => state.visited.add(item.id));
  goTo(resumeIndex > 0 ? resumeIndex : 0);
}

window.addEventListener('pagehide', () => {
  stopSpeaking();
  report('exit');
});

boot();
