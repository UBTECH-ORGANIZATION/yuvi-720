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

const VERB = 'https://lxp.education.gov.il/xapi/moe/verbs/';
const OBJECT = 'https://yuvilab.spark/xapi/content/';
const CATEGORY = 'https://yuvilab.spark/xapi/categories/';

const DEFAULT_BREAK_MINUTES = 10;

/* ── strings ────────────────────────────────────────────────────────────── */
const STR = {
  he: {
    'nav.back': 'חזרה', 'nav.next': 'ממשיכים', 'nav.finish': 'סיימתי',
    'nav.start': 'מתחילים', 'nav.check': 'בדיקה',
    'step.of': 'שלב {n} מתוך {total}',
    'audio.play': 'השמעה', 'audio.stop': 'עצירה', 'audio.slow': 'לאט יותר',
    'audio.transcript': 'תמליל',
    'read.aloud': 'הקראה', 'read.stop': 'הפסקת הקראה',
    'a11y.text': 'גודל טקסט', 'a11y.contrast': 'ניגודיות גבוהה',
    'break.title': 'עבדתם יפה כבר כמה דקות. רוצים הפסקה קצרה?',
    'break.take': 'הפסקה של דקה', 'break.continue': 'ממשיכים',
    'break.back': 'חוזרים ללמידה',
    'help.who': 'תקועים? יובי כאן, ואפשר גם לפנות למורה שלכם.',
    'write.saved': 'נשמר. אפשר להמשיך.',
    'write.checklist': 'לפני שממשיכים, בדקו את עצמכם:',
    'speak.model': 'לחצו על שורה כדי לשמוע אותה, ואז אמרו אותה בקול.',
    'speak.check': 'איך הלך?',
    'speak.your_turn': 'עכשיו אתם',
    'speak.record': 'לדבר',
    'speak.retry': 'לדבר שוב',
    'speak.listening': 'מקשיבים…',
    'speak.again': 'לא שמענו כלום. נסו שוב, קצת יותר קרוב למיקרופון.',
    'speak.nomic': 'המיקרופון לא זמין כרגע. אפשר להמשיך — הקריאו את המשפט בקול לעצמכם.',
    'summary.done': 'סיימתם את השלב הזה',
    'error.load': 'לא הצלחנו לטעון את התוכן. רעננו את הדף.',
    'error.auth': 'הקישור הזה כבר לא בתוקף. חזרו לשיעור ופתחו אותו שוב.',
    'reflect.thanks': 'תודה — זה עוזר לנו להתאים לכם את ההמשך.',
    'glossary.title': 'מילים שיעזרו',
  },
  ar: {
    'nav.back': 'رجوع', 'nav.next': 'متابعة', 'nav.finish': 'أنهيت',
    'nav.start': 'لنبدأ', 'nav.check': 'تحقّق',
    'step.of': 'المرحلة {n} من {total}',
    'audio.play': 'تشغيل', 'audio.stop': 'إيقاف', 'audio.slow': 'أبطأ',
    'audio.transcript': 'النص المكتوب',
    'read.aloud': 'قراءة بصوت', 'read.stop': 'إيقاف القراءة',
    'a11y.text': 'حجم النص', 'a11y.contrast': 'تباين عالٍ',
    'break.title': 'تعملون منذ عدّة دقائق. هل تريدون استراحة قصيرة؟',
    'break.take': 'استراحة دقيقة', 'break.continue': 'نتابع',
    'break.back': 'نعود إلى التعلّم',
    'help.who': 'عالقون؟ يوفي هنا، ويمكنكم أيضاً التوجّه إلى معلّمكم.',
    'write.saved': 'تمّ الحفظ. يمكنكم المتابعة.',
    'write.checklist': 'قبل المتابعة، تحقّقوا من أنفسكم:',
    'speak.model': 'اضغطوا على سطر لسماعه، ثم قولوه بصوت مسموع.',
    'speak.check': 'كيف سار الأمر؟',
    'speak.your_turn': 'الآن دوركم',
    'speak.record': 'تكلّموا',
    'speak.retry': 'تكلّموا مرّة أخرى',
    'speak.listening': 'نستمع…',
    'speak.again': 'لم نسمع شيئاً. حاولوا مجدداً وأقرب قليلاً من الميكروفون.',
    'speak.nomic': 'الميكروفون غير متاح الآن. يمكنكم المتابعة — اقرأوا الجملة بصوت مسموع لأنفسكم.',
    'summary.done': 'أنهيتم هذه المرحلة',
    'error.load': 'لم نتمكّن من تحميل المحتوى. أعيدوا تحميل الصفحة.',
    'error.auth': 'هذا الرابط لم يعد صالحاً. عودوا إلى الدرس وافتحوه من جديد.',
    'reflect.thanks': 'شكراً — هذا يساعدنا على ملاءمة التتمّة لكم.',
    'glossary.title': 'كلمات تساعدكم',
  },
  en: {
    'nav.back': 'Back', 'nav.next': 'Continue', 'nav.finish': 'I am done',
    'nav.start': 'Start', 'nav.check': 'Check',
    'step.of': 'Step {n} of {total}',
    'audio.play': 'Play', 'audio.stop': 'Stop', 'audio.slow': 'Slower',
    'audio.transcript': 'Transcript',
    'read.aloud': 'Read aloud', 'read.stop': 'Stop reading',
    'a11y.text': 'Text size', 'a11y.contrast': 'High contrast',
    'break.title': 'You have been working for a few minutes. Want a short break?',
    'break.take': 'One minute break', 'break.continue': 'Keep going',
    'break.back': 'Back to learning',
    'help.who': 'Stuck? Yuvi is here, and you can also ask your teacher.',
    'write.saved': 'Saved. You can continue.',
    'write.checklist': 'Before you continue, check yourself:',
    'speak.model': 'Tap a line to hear it, then say it out loud.',
    'speak.check': 'How did it go?',
    'speak.your_turn': 'Now your turn',
    'speak.record': 'Speak',
    'speak.retry': 'Speak again',
    'speak.listening': 'Listening…',
    'speak.again': 'We did not hear anything. Try again, a little closer to the microphone.',
    'speak.nomic': 'The microphone is not available right now. You can carry on — read the sentence out loud to yourself.',
    'summary.done': 'You finished this step',
    'error.load': 'We could not load the content. Please refresh the page.',
    'error.auth': 'This link has expired. Go back to the lesson and open it again.',
    'reflect.thanks': 'Thanks — this helps us fit what comes next to you.',
    'glossary.title': 'Words that help',
  },
};

const RTL = new Set(['he', 'ar']);

/* ── launch context ─────────────────────────────────────────────────────── */
const url = new URL(window.location.href);
const componentId = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
const lang = ['he', 'ar', 'en'].includes(url.searchParams.get('lang')) ? url.searchParams.get('lang') : 'he';
const t = (key, vars) =>
  Object.entries(vars || {}).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, value),
    (STR[lang] || STR.he)[key] || key,
  );
const pick = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return value[lang] || value.en || value.he || '';
};

let launch = null;
try {
  launch = JSON.parse(url.searchParams.get('slxapi') || 'null');
} catch { launch = null; }

document.documentElement.lang = lang;
document.documentElement.dir = RTL.has(lang) ? 'rtl' : 'ltr';

const root = document.getElementById('root');

/* ── xAPI transport ──────────────────────────────────────────────────────
 * Fire-and-forget, retried, and never in the learner's way. Statements go out
 * CONCURRENTLY: our ingest folds each one into the brain and forwards it to the
 * MoE LRS before answering, so a strictly serial queue fell seconds behind a
 * learner who was still clicking — and a component completion that has not left
 * the page yet is a component completion that can be lost on close. Order does
 * not need the queue: every statement carries its own timestamp, and the
 * platform's position clock is what resolves them.
 */
const MAX_IN_FLIGHT = 4;
const queue = [];
let inFlight = 0;

function report(verb, { object, result, extensions, category } = {}) {
  if (!launch?.endpoint || !launch?.auth) return;
  const statement = {
    actor: launch.actor,
    verb: { id: `${VERB}${verb}` },
    object: { id: object || `${OBJECT}${componentId}` },
    timestamp: new Date().toISOString(),
  };
  if (result) statement.result = result;
  const context = {};
  if (extensions) context.extensions = extensions;
  if (category) context.contextActivities = { category: [{ id: `${CATEGORY}${category}` }] };
  if (Object.keys(context).length) statement.context = context;
  queue.push({ statement, tries: 0 });
  pump();
}

function pump() {
  while (inFlight < MAX_IN_FLIGHT && queue.length) {
    const job = queue.shift();
    inFlight += 1;
    send(job).finally(() => { inFlight -= 1; pump(); });
  }
}

async function send(job) {
  try {
    const response = await fetch(`${launch.endpoint.replace(/\/$/, '')}/statements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: launch.auth },
      body: JSON.stringify(job.statement),
      // Survives the tab closing mid-flight — a completion must not depend on
      // the learner staying on the page long enough for us to finish.
      keepalive: true,
    });
    if (!response.ok && response.status >= 500) throw new Error(String(response.status));
  } catch {
    job.tries += 1;
    if (job.tries > 5) return;
    // Mandated retry policy: back off, stay invisible to the learner.
    await new Promise((resolve) => setTimeout(resolve, Math.min(15000, 800 * 2 ** job.tries)));
    queue.push(job);
  }
}

/* ── speech (read-aloud + listening items) ──────────────────────────────── */
const synth = window.speechSynthesis;
let speaking = null;

function speak(text, { locale = 'en-US', rate = 1, onEnd } = {}) {
  stopSpeaking();
  if (!synth || !text) { onEnd?.(); return; }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = locale;
  utterance.rate = rate;
  utterance.onend = () => { speaking = null; onEnd?.(); };
  utterance.onerror = () => { speaking = null; onEnd?.(); };
  speaking = utterance;
  synth.speak(utterance);
}

function stopSpeaking() {
  if (synth?.speaking || synth?.pending) synth.cancel();
  speaking = null;
}

/* ── DOM helpers ────────────────────────────────────────────────────────── */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  });
  (Array.isArray(children) ? children : [children]).filter(Boolean).forEach((child) => node.append(child));
  return node;
}

/* ── state ──────────────────────────────────────────────────────────────── */
const state = {
  payload: null,
  index: 0,
  visited: new Set(),
  // `${itemId}|${questionId}` -> {correct, feedback, response}. Kept whole so a
  // learner who walks back to a finished screen sees what they answered and
  // what they were told, instead of a blank question (720 §1.5).
  answered: new Map(),
  written: new Map(),
  startedAt: Date.now(),
  breakOffered: false,
  onBreak: false,
  scale: 'normal',
  contrast: false,
  readingAloud: false,
  reported: false,
};

const items = () => state.payload?.items || [];
const current = () => items()[state.index];
const itemObject = (item) => `${OBJECT}${item.id}`;

function questionsDone(item) {
  return (item.questions || []).every((q) => state.answered.has(`${item.id}|${q.questionId}`));
}

/** Every screen the learner has finished with, for the progress strip. */
function stepState(index) {
  if (index === state.index) return 'current';
  const item = items()[index];
  return state.visited.has(item.id) && questionsDone(item) ? 'done' : 'todo';
}

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
  root.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function maybeOfferBreak() {
  if (state.breakOffered) return;
  const minutes = state.payload?.component?.breakAfterMinutes || DEFAULT_BREAK_MINUTES;
  if (Date.now() - state.startedAt < minutes * 60_000) return;
  state.breakOffered = true;
  state.onBreak = true;
}

async function finish() {
  const graded = [...state.answered.values()].map((entry) => entry.correct);
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
    window.parent?.postMessage({ type: 'yuvilab:component-complete', componentId, success }, '*');
  }
  render();
}

/* ── renderers ──────────────────────────────────────────────────────────── */
function renderAudio(item) {
  const p = item.presentation;
  const wrap = el('div', { class: 'lp-audio' });
  let slow = false;
  let playing = false;

  const button = el('button', {
    class: 'lp-play', type: 'button', 'data-playing': 'false',
    text: `▶  ${t('audio.play')}`,
  });
  const play = () => {
    if (playing) {
      stopSpeaking();
      playing = false;
      button.dataset.playing = 'false';
      button.textContent = `▶  ${t('audio.play')}`;
      report('paused', { object: itemObject(item) });
      return;
    }
    playing = true;
    button.dataset.playing = 'true';
    button.textContent = `■  ${t('audio.stop')}`;
    report('played', { object: itemObject(item) });
    speak(p.script, {
      locale: p.language || 'en-US',
      rate: (p.rate || 1) * (slow ? 0.7 : 1),
      onEnd: () => {
        playing = false;
        button.dataset.playing = 'false';
        button.textContent = `▶  ${t('audio.play')}`;
      },
    });
  };
  button.addEventListener('click', play);
  wrap.append(button);

  const slower = el('button', {
    class: 'lp-chip', type: 'button', 'aria-pressed': 'false', text: t('audio.slow'),
  });
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
      class: 'lp-chip', type: 'button', 'aria-pressed': 'false', text: t('audio.transcript'),
    });
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

function renderLines(item) {
  const p = item.presentation;
  const list = el('ul', { class: 'lp-lines' });
  (p.lines || []).forEach((line) => {
    const button = el('button', { class: 'lp-line lp-en', type: 'button', text: line });
    button.addEventListener('click', () => {
      list.querySelectorAll('[data-speaking]').forEach((node) => node.removeAttribute('data-speaking'));
      button.dataset.speaking = 'true';
      report('read', { object: itemObject(item) });
      speak(line, {
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

function renderQuestion(item, question) {
  const key = `${item.id}|${question.questionId}`;
  const previous = state.answered.get(key);
  const block = el('div', { class: 'lp-q' });
  block.append(el('p', { class: 'lp-q__text lp-en', text: question.questionText }));

  const feedback = el('p', { class: 'lp-feedback', hidden: true });
  const options = el('div', { class: 'lp-options' });

  const settle = (option, verdict, response) => {
    const correct = verdict.correct === true;
    state.answered.set(key, { correct, feedback: verdict.feedback, response });
    option.dataset.verdict = correct ? 'correct' : 'incorrect';
    options.querySelectorAll('button').forEach((node) => { node.disabled = true; });
    feedback.textContent = pick(verdict.feedback);
    feedback.dataset.verdict = correct ? 'correct' : 'incorrect';
    feedback.hidden = !feedback.textContent;
  };

  (question.answers || []).forEach((answer) => {
    const option = el('button', { class: 'lp-option lp-en', type: 'button', text: answer });
    option.addEventListener('click', async () => {
      if (state.answered.has(key)) return;
      let verdict;
      try {
        const response = await fetch(`/content/player/${encodeURIComponent(componentId)}/answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: launch.auth },
          body: JSON.stringify({ itemId: item.id, questionId: question.questionId, response: answer }),
        });
        verdict = await response.json();
      } catch {
        verdict = { correct: null, feedback: {} };
      }
      settle(option, verdict, answer);
      report('answered', {
        object: `${itemObject(item)}/${question.questionId}`,
        result: { response: answer, success: verdict.correct === true, score: { scaled: verdict.correct === true ? 1 : 0 } },
      });
      renderFooter();
    });
    if (previous && answer === previous.response) settle(option, previous, answer);
    options.append(option);
  });

  if (previous) options.querySelectorAll('button').forEach((node) => { node.disabled = true; });

  block.append(options, feedback);
  return block;
}

/** A self-report row (reflection / speaking self-check) — chosen once, and still
 *  visibly chosen if the learner walks back to the screen. */
function renderChoices(item, choices, category) {
  const key = `${item.id}|${category}`;
  const done = el('p', { class: 'lp-feedback', hidden: !state.written.has(key), text: t('reflect.thanks') });
  const options = el('div', { class: 'lp-options' });
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

  if (p.checklist?.length) {
    block.append(el('p', { class: 'lp-kicker', text: t('write.checklist') }));
    block.append(el('ul', { class: 'lp-checklist' }, p.checklist.map((entry) =>
      el('li', {}, [el('label', {}, [el('input', { type: 'checkbox' }), el('span', { text: pick(entry) })])]))));
  }

  const saved = el('p', { class: 'lp-feedback', hidden: true, text: t('write.saved') });
  const submit = el('button', { class: 'lp-btn lp-btn--ghost', type: 'button', text: t('nav.check') });
  submit.addEventListener('click', () => {
    const text = (area.value || '').trim();
    if (!text) return;
    saved.hidden = false;
    // Open writing is submitted, not auto-scored — the response goes to the
    // platform, and the teacher/agent read it there. It must stay out of the
    // component score, which only reflects what was actually graded.
    report('submitted', { object: itemObject(item), result: { response: text.slice(0, 1000) } });
  });
  block.append(submit, saved);
  return block;
}

function renderMediation(item) {
  const p = item.presentation;
  const block = el('div', { class: 'lp-write' });
  block.append(el('div', { class: 'lp-support', text: p.source || '' }));
  return el('div', {}, [block, renderWriting(item)]);
}

/* ── speaking (mic + pronunciation assessment) ──────────────────────────── */
let sdkPromise = null;

/** The Azure Speech browser SDK is vendored, not fetched from a CDN — this page
 *  is meant to run inside someone else's platform, where an external script may
 *  simply be blocked. Loaded on demand so a reading item never pays for it. */
function loadSpeechSdk() {
  if (window.SpeechSDK) return Promise.resolve(window.SpeechSDK);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/content/player-assets/vendor/speech-sdk.js';
      script.onload = () => (window.SpeechSDK ? resolve(window.SpeechSDK) : reject(new Error('sdk')));
      script.onerror = () => reject(new Error('sdk'));
      document.head.append(script);
    }).catch((error) => { sdkPromise = null; throw error; });
  }
  return sdkPromise;
}

async function speechToken() {
  const response = await fetch(`/content/player/${encodeURIComponent(componentId)}/speech-token`, {
    method: 'POST',
    headers: { Authorization: launch.auth },
  });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

/** Record one utterance and score it against the reference sentence.
 *  The audio goes from this page straight to Azure — it never reaches our
 *  servers and is never stored. Only the score sheet comes back. */
async function assessSpeech(referenceText) {
  const [SDK, { token, region }] = await Promise.all([loadSpeechSdk(), speechToken()]);
  const speechConfig = SDK.SpeechConfig.fromAuthorizationToken(token, region);
  speechConfig.speechRecognitionLanguage = 'en-US';
  const pa = new SDK.PronunciationAssessmentConfig(
    referenceText,
    SDK.PronunciationAssessmentGradingSystem.HundredMark,
    SDK.PronunciationAssessmentGranularity.Phoneme,
    true,
  );
  if (pa.enableProsodyAssessment) pa.enableProsodyAssessment = true;

  const recognizer = new SDK.SpeechRecognizer(speechConfig, SDK.AudioConfig.fromDefaultMicrophoneInput());
  pa.applyTo(recognizer);
  try {
    const result = await new Promise((resolve, reject) =>
      recognizer.recognizeOnceAsync(resolve, reject));
    if (result.reason !== SDK.ResultReason.RecognizedSpeech) throw new Error('no_speech');
    const scores = SDK.PronunciationAssessmentResult.fromResult(result);
    const detail = JSON.parse(result.properties.getProperty(
      SDK.PropertyId.SpeechServiceResponse_JsonResult) || '{}');
    const best = (detail.NBest || [])[0] || {};
    return {
      accuracyScore: scores.accuracyScore,
      fluencyScore: scores.fluencyScore,
      completenessScore: scores.completenessScore,
      prosodyScore: scores.prosodyScore,
      pronunciationScore: scores.pronunciationScore,
      // Azure reports duration in 100-nanosecond ticks; this is the billing unit.
      durationSeconds: result.duration ? result.duration / 10_000_000 : undefined,
      words: (best.Words || []).map((w) => ({
        word: w.Word,
        accuracyScore: (w.PronunciationAssessment || {}).AccuracyScore,
        errorType: (w.PronunciationAssessment || {}).ErrorType,
      })),
    };
  } finally {
    recognizer.close();
  }
}

function renderSpeaking(item) {
  const p = item.presentation;
  const block = el('div', { class: 'lp-q' });
  block.append(el('p', { class: 'lp-kicker', text: t('speak.model') }));

  const lines = Array.isArray(p.referenceText) ? p.referenceText : [p.referenceText].filter(Boolean);
  const list = el('ul', { class: 'lp-lines' });
  lines.forEach((line) => {
    const button = el('button', { class: 'lp-line lp-en', type: 'button', text: line });
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
  const mic = el('button', { class: 'lp-play lp-mic', type: 'button', text: `🎤  ${t('speak.record')}` });
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
    mic.textContent = `● ${t('speak.listening')}`;
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
      report('answered', {
        object: `${itemObject(item)}/speaking`,
        result: { response: reference, success: verdict.feedback?.band !== 'developing' },
      });
    } catch (error) {
      // Speaking must never be a dead end: if the mic or the service is not
      // available the learner keeps going, and says so in their own words.
      status.textContent = error?.message === 'no_speech' ? t('speak.again') : t('speak.nomic');
    } finally {
      busy = false;
      mic.dataset.playing = 'false';
      mic.textContent = `🎤  ${t('speak.retry')}`;
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

function renderBody(item) {
  const kind = item.presentation?.kind;
  if (kind === 'listening') return renderAudio(item);
  if (kind === 'reading') return renderLines(item);
  if (kind === 'speaking') return renderSpeaking(item);
  if (kind === 'reflection') return renderReflection(item);
  if (kind === 'writing') return renderWriting(item);
  if (kind === 'mediation') return renderMediation(item);
  return null;
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
    'aria-label': t('read.aloud'), title: t('read.aloud'), text: '🔊',
  });
  aloud.addEventListener('click', () => {
    if (state.readingAloud) { stopSpeaking(); state.readingAloud = false; aloud.setAttribute('aria-pressed', 'false'); return; }
    state.readingAloud = true;
    aloud.setAttribute('aria-pressed', 'true');
    const item = current();
    const text = [pick(item.presentation?.prompt), pick(item.presentation?.goal), item.presentation?.script,
      ...(item.questions || []).map((q) => q.questionText)].filter(Boolean).join('. ');
    report('requested', { object: itemObject(item), category: 'read-aloud' });
    speak(text, { locale: 'en-US', rate: 0.95, onEnd: () => { state.readingAloud = false; aloud.setAttribute('aria-pressed', 'false'); } });
  });

  const size = el('button', {
    class: 'lp-tool', type: 'button', 'aria-label': t('a11y.text'), title: t('a11y.text'), text: 'A',
  });
  size.addEventListener('click', () => {
    state.scale = { normal: 'large', large: 'xlarge', xlarge: 'normal' }[state.scale];
    root.dataset.scale = state.scale;
  });

  const contrast = el('button', {
    class: 'lp-tool', type: 'button', 'aria-pressed': String(state.contrast),
    'aria-label': t('a11y.contrast'), title: t('a11y.contrast'), text: '◐',
  });
  contrast.addEventListener('click', () => {
    state.contrast = !state.contrast;
    contrast.setAttribute('aria-pressed', String(state.contrast));
    root.dataset.contrast = state.contrast ? 'high' : '';
  });

  tools.append(aloud, size, contrast);

  return el('header', { class: 'lp-head' }, [
    el('h1', { class: 'lp-head__title' }, [
      document.createTextNode(state.payload.component.title || ''),
      el('small', { text: t('step.of', { n: state.index + 1, total }) }),
    ]),
    strip,
    tools,
  ]);
}

function renderFooter() {
  const existing = root.querySelector('.lp-foot');
  const item = current();
  const last = state.index === items().length - 1;
  const blocked = (item.questions || []).length > 0 && !questionsDone(item);

  const back = el('button', {
    class: 'lp-btn lp-btn--ghost', type: 'button', text: t('nav.back'),
    disabled: state.index === 0,
  });
  back.addEventListener('click', () => goTo(state.index - 1));

  const next = el('button', {
    class: 'lp-btn', type: 'button',
    // "Start" belongs on a framing card, not on a screen that already asks
    // something — there the learner is continuing, not starting.
    text: last ? t('nav.finish')
      : (item.presentation?.kind === 'intro' ? t('nav.start') : t('nav.next')),
    disabled: blocked,
  });
  next.addEventListener('click', () => (last ? finish() : goTo(state.index + 1)));

  const foot = el('footer', { class: 'lp-foot' }, [
    back,
    el('p', { class: 'lp-help', text: t('help.who') }),
    el('div', { class: 'lp-foot__spacer' }),
    next,
  ]);
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

function renderCard() {
  const item = current();
  const p = item.presentation || {};
  const card = el('section', { class: 'lp-card', 'aria-label': item.title || '' });

  // The authored item `title` is an internal English label for authors and the
  // agent — the learner's heading is the localized prompt.
  if (pick(p.prompt)) card.append(el('h2', { class: 'lp-prompt', text: pick(p.prompt) }));
  if (pick(p.goal)) card.append(el('p', { class: 'lp-note', text: pick(p.goal) }));
  if (pick(p.strategy)) card.append(el('p', { class: 'lp-support', text: pick(p.strategy) }));

  if (p.kind === 'summary') {
    const outcome = state.finished === 'retry' ? p.onRetry : p.onSuccess;
    card.append(el('h2', { class: 'lp-prompt', text: pick(outcome) || t('summary.done') }));
    if (pick(p.nextHint)) card.append(el('p', { class: 'lp-note', text: pick(p.nextHint) }));
  }

  const body = renderBody(item);
  if (body) card.append(body);
  (item.questions || []).forEach((question) => card.append(renderQuestion(item, question)));
  return card;
}

function render() {
  root.replaceChildren();
  root.dataset.scale = state.scale;
  if (state.contrast) root.dataset.contrast = 'high';
  root.append(renderHead());
  if (state.onBreak) { root.append(renderBreak()); return; }
  root.append(renderCard(), renderFooter());
}

function fail(messageKey) {
  root.replaceChildren(el('div', { class: 'lp-error', text: t(messageKey) }));
}

/* ── boot ───────────────────────────────────────────────────────────────── */
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
