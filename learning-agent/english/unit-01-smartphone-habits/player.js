/* =========================================================================
 *  English Lomda 01 — "What I Do Every Day"
 *  Standalone 720 content player. Vanilla JS, no dependencies, no build step.
 *
 *  Design notes
 *  ------------
 *  - No learner-facing string is hardcoded here. Everything comes from
 *    content.json -> ui[lang] or from the authored item text.
 *  - No numeric grade and no global unit progress are ever rendered.
 *    Component-internal progress dots only, per the 720 standard.
 *  - No localStorage / sessionStorage. In hosted mode the platform owns
 *    progress via xAPI; in standalone demo mode state lives in memory only.
 *  - Ordering and matching use tap-to-select, not HTML5 drag, so they work
 *    with mouse, touch and keyboard alike.
 *  - Audio is pre-generated Azure Speech MP3. If a file is missing the
 *    speaker button removes itself and the lomda keeps working.
 * ========================================================================= */

(function () {
  'use strict';

  /* ------------------------------------------------------------------ dom */

  function h(tag, props) {
    var el = document.createElement(tag);
    var p = props || {};
    Object.keys(p).forEach(function (k) {
      var v = p[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.keys(v).forEach(function (d) { el.dataset[d] = v[d]; });
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    var kids = Array.prototype.slice.call(arguments, 2);
    (function add(list) {
      list.forEach(function (k) {
        if (k === null || k === undefined || k === false) return;
        if (Array.isArray(k)) return add(k);
        el.appendChild(k.nodeType ? k : document.createTextNode(String(k)));
      });
    })(kids);
    return el;
  }

  var ICONS = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    arrowBack: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
    speaker: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    bulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6z"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v4"/>',
    rethink: '<path d="M12 8v5"/><circle cx="12" cy="16.5" r=".6" fill="currentColor"/><circle cx="12" cy="12" r="9"/>',
    book: '<path d="M4 19V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z"/><path d="M8 7h7"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="m6.3 6.3 2.8 2.8M14.9 14.9l2.8 2.8M17.7 6.3l-2.8 2.8M9.1 14.9l-2.8 2.8"/>',
    lock: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'
  };

  function icon(name, size) {
    var s = size || 18;
    return h('span', {
      'aria-hidden': 'true',
      class: 'i',
      html: '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        ICONS[name] + '</svg>'
    });
  }

  function arrowIcon() {
    var sp = icon('arrow', 17);
    sp.firstChild.classList.add('arrow');
    return sp;
  }

  /* ----------------------------------------------------------- illustration
     Everything here is inline SVG on purpose: the lomda has to stay a single
     self-contained folder that runs from file:// with no asset pipeline. */

  var PALETTE = ['#2f5bea', '#0fa795', '#7357e8', '#e0632f', '#c08c10', '#d1457e', '#3f8f3a'];

  function hueOf(seed) {
    var n = 0;
    for (var i = 0; i < seed.length; i++) n = (n * 31 + seed.charCodeAt(i)) >>> 0;
    return PALETTE[n % PALETTE.length];
  }

  /** Friendly face built from the name, so every forum voice reads as a person. */
  function avatar(name, size) {
    var s = size || 38;
    var c = hueOf(name);
    var tilt = (name.charCodeAt(0) % 3) - 1;
    var smile = name.charCodeAt(name.length - 1) % 2
      ? 'M9 15.2q3 2.6 6 0'
      : 'M9 15q3 3.2 6 0';
    return h('span', {
      class: 'avatar', 'aria-hidden': 'true',
      style: '--avatar-size:' + s + 'px;--avatar-color:' + c,
      html: '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '">' +
        '<circle cx="12" cy="12" r="12" fill="' + c + '" opacity=".16"/>' +
        '<circle cx="12" cy="12" r="9.2" fill="' + c + '" opacity=".28"/>' +
        '<g transform="rotate(' + tilt * 4 + ' 12 12)" fill="none" stroke="' + c + '" ' +
        'stroke-width="1.7" stroke-linecap="round">' +
        '<circle cx="9.2" cy="10.2" r=".9" fill="' + c + '" stroke="none"/>' +
        '<circle cx="14.8" cy="10.2" r=".9" fill="' + c + '" stroke="none"/>' +
        '<path d="' + smile + '"/></g></svg>'
    });
  }

  /* Vocabulary scenes. Keys come from each word card's `art` field. */
  var ART = {
    photo: '<rect x="4" y="8" width="16" height="11" rx="2.5"/><path d="M9 8l1.4-2.2h3.2L15 8"/><circle cx="12" cy="13.5" r="3.1"/>',
    music: '<path d="M9 17V6.5l8-1.6V15"/><circle cx="7" cy="17.4" r="2.2"/><circle cx="15" cy="15.4" r="2.2"/>',
    games: '<rect x="2.5" y="8" width="19" height="9.5" rx="4.5"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="16" cy="12" r="1"/><circle cx="18.4" cy="14" r="1"/>',
    video: '<rect x="2.5" y="6" width="14" height="12" rx="2.5"/><path d="M16.5 10.5 21.5 7.5v9l-5-3z"/><path d="M7.5 10.5l3.5 1.8-3.5 1.8z"/>',
    text: '<path d="M3.5 6.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4.5 4v-4h-1z"/><path d="M8 8.5h8M8 11.5h5"/>',
    call: '<path d="M6.2 3.6 8.6 3l2 4.2-2 1.6a10.6 10.6 0 0 0 4.6 4.6l1.6-2 4.2 2-.6 2.4a2 2 0 0 1-2.2 1.5C10.2 16.7 6 12.5 4.7 5.8a2 2 0 0 1 1.5-2.2z"/>',
    voice: '<rect x="9" y="2.8" width="6" height="10.4" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21M9 21h6"/>',
    dictionary: '<path d="M4 18.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M8 7h7M8 10.5h5"/>'
  };

  function artScene(name) {
    if (!ART[name]) return null;
    var c = hueOf(name);
    return h('span', {
      class: 'scene', 'aria-hidden': 'true', style: '--scene-color:' + c,
      html: '<svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="' + c + '" ' +
        'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + ART[name] + '</svg>'
    });
  }

  /** The unit's companion. Appears on the map and whenever a part is finished. */
  function mascot(size, mood) {
    var s = size || 84;
    var eyes = mood === 'cheer'
      ? '<path d="M25 40q4-5 8 0M47 40q4-5 8 0"/>'
      : '<circle cx="29" cy="41" r="3.4" fill="#2f5bea" stroke="none"/><circle cx="51" cy="41" r="3.4" fill="#2f5bea" stroke="none"/>';
    return h('span', {
      class: 'mascot' + (mood ? ' mascot--' + mood : ''), 'aria-hidden': 'true',
      html: '<svg viewBox="0 0 80 84" width="' + s + '" height="' + (s * 84 / 80) + '" fill="none">' +
        '<ellipse cx="40" cy="79" rx="20" ry="4" fill="#16204a" opacity=".08"/>' +
        '<path d="M40 6v9" stroke="#7357e8" stroke-width="3" stroke-linecap="round"/>' +
        '<circle cx="40" cy="6" r="4.2" fill="#c08c10"/>' +
        '<rect x="12" y="16" width="56" height="46" rx="18" fill="#e8edfe" stroke="#2f5bea" stroke-width="2.6"/>' +
        '<rect x="20" y="26" width="40" height="26" rx="13" fill="#fff"/>' +
        '<g stroke="#2f5bea" stroke-width="3" stroke-linecap="round">' + eyes + '</g>' +
        '<path d="M34 50q6 5 12 0" stroke="#0fa795" stroke-width="3" stroke-linecap="round"/>' +
        '<rect x="26" y="62" width="28" height="12" rx="6" fill="#0fa795" opacity=".2"/>' +
        '<path d="M6 34q-4 6 0 12M74 34q4 6 0 12" stroke="#7357e8" stroke-width="3" stroke-linecap="round"/>' +
        '</svg>'
    });
  }

  /* ---------------------------------------------------------------- state */

  var state = {
    lang: 'he',
    content: null,
    view: 'map',
    componentId: null,
    itemIndex: 0,
    answers: {},     // questionId -> { response, correct, attempts, checked }
    drafts: {},      // questionId -> working (unchecked) response
    hinted: {},      // questionId -> true
    seen: {},        // itemId -> true
    completed: {},   // componentId -> { passed: bool|null }
    selfCheck: {},   // goalId -> 'yes'|'partly'|'no'
    reflection: ''
  };

  var dom = {};
  var audio = { el: null, btn: null, src: null, kind: null };
  var missingAudio = {};

  /* ------------------------------------------------------------- i18n */

  function ui(key) {
    var pack = (state.content && state.content.ui && state.content.ui[state.lang]) || {};
    return pack[key] !== undefined ? pack[key] : key;
  }

  /** Pick the localized string out of {he,ar} / {en} / plain string. */
  function L(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (value[state.lang] !== undefined) return value[state.lang];
    if (value.he !== undefined) return value.he;
    if (value.en !== undefined) return value.en;
    return '';
  }

  /* --------------------------------------------------------------- xAPI */

  var XAPI = {
    cfg: null,
    queue: [],
    sending: false,

    init: function () {
      var raw = new URLSearchParams(location.search).get('slxapi');
      if (!raw) return;
      try {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.endpoint && parsed.actor) this.cfg = parsed;
      } catch (e) {
        // Malformed launch context must never break the learning flow.
        this.cfg = null;
      }
    },

    get hosted() { return !!this.cfg; },

    send: function (verb, object, extra) {
      var stmt = {
        actor: this.cfg ? this.cfg.actor : { account: { homePage: 'urn:yuvilab:standalone', name: 'demo' } },
        verb: { id: verb.id, display: { 'en-US': verb.word } },
        object: {
          id: object.id,
          definition: {
            name: { 'en-US': object.name || object.id },
            type: object.type || 'http://adlnet.gov/expapi/activities/cmi.interaction'
          }
        },
        timestamp: new Date().toISOString(),
        context: {
          contextActivities: {
            parent: [{ id: activityId(state.componentId || state.content.id) }],
            grouping: [{ id: activityId(state.content.id) }]
          },
          language: state.lang
        }
      };
      if (extra && extra.result) stmt.result = extra.result;
      if (extra && extra.category) {
        stmt.context.contextActivities.category = [{ id: extra.category }];
      }

      if (!this.cfg) {
        if (window.console && console.debug) console.debug('[lomda:xapi]', verb.word, object.id, stmt.result || '');
        return;
      }
      this.queue.push({ stmt: stmt, tries: 0 });
      this.flush();
    },

    flush: function () {
      if (this.sending || !this.queue.length || !this.cfg) return;
      this.sending = true;
      var job = this.queue[0];
      var self = this;
      fetch(this.cfg.endpoint.replace(/\/$/, '') + '/statements', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Experience-API-Version': '1.0.3',
          Authorization: this.cfg.auth
        },
        body: JSON.stringify(job.stmt),
        keepalive: true
      }).then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        self.queue.shift();
      }).catch(function () {
        job.tries += 1;
        if (job.tries >= 5) self.queue.shift();          // give up quietly
      }).then(function () {
        self.sending = false;
        if (self.queue.length) setTimeout(function () { self.flush(); }, Math.min(8000, 400 * Math.pow(2, job.tries)));
      });
    }
  };

  var VERB = {
    initialized: { id: 'http://adlnet.gov/expapi/verbs/initialized', word: 'initialized' },
    completed: { id: 'http://adlnet.gov/expapi/verbs/completed', word: 'completed' },
    answered: { id: 'http://adlnet.gov/expapi/verbs/answered', word: 'answered' },
    selected: { id: 'http://adlnet.gov/expapi/verbs/selected', word: 'selected' },
    requested: { id: 'http://id.tincanapi.com/verb/requested', word: 'requested' },
    played: { id: 'https://w3id.org/xapi/video/verbs/played', word: 'played' },
    paused: { id: 'https://w3id.org/xapi/video/verbs/paused', word: 'paused' },
    suspended: { id: 'http://adlnet.gov/expapi/verbs/suspended', word: 'suspended' },
    terminated: { id: 'http://adlnet.gov/expapi/verbs/terminated', word: 'terminated' },
    failed: { id: 'http://adlnet.gov/expapi/verbs/failed', word: 'failed' }
  };

  function activityId(id) { return 'https://yuvilab.ai/xapi/activity/' + encodeURIComponent(id); }

  function toParent(type, payload) {
    if (window.parent === window) return;
    var msg = { source: 'yuvilab-lomda', type: type, unitId: state.content ? state.content.id : null };
    Object.keys(payload || {}).forEach(function (k) { msg[k] = payload[k]; });
    window.parent.postMessage(msg, '*');
  }

  /* --------------------------------------------------------------- audio
     Two sources, in order: the recorded MP3, and — when it is absent or
     blocked — the browser's own English voice. The learner always gets sound,
     and recorded narration can be dropped in later without touching this. */

  var synth = window.speechSynthesis || null;

  function englishVoice() {
    if (!synth) return null;
    var voices = synth.getVoices() || [];
    var exact = voices.filter(function (v) { return /^en[-_]/i.test(v.lang); });
    if (!exact.length) return null;
    var preferred = exact.filter(function (v) { return /^en[-_]US/i.test(v.lang); });
    return (preferred[0] || exact[0]);
  }

  function markButton(btn, playing) {
    if (!btn) return;
    btn.dataset.playing = playing ? '1' : '0';
    btn.innerHTML = '';
    btn.appendChild(icon(playing ? 'stop' : 'speaker', playing ? 13 : 15));
  }

  function stopAudio() {
    if (audio.el) {
      audio.el.pause();
      XAPI.send(VERB.paused, { id: activityId(audio.src), name: audio.src, type: 'https://w3id.org/xapi/audio/activity-type/audio' },
        { result: { extensions: { 'https://w3id.org/xapi/video/extensions/time': audio.el.currentTime } } });
    }
    if (audio.kind === 'tts' && synth) synth.cancel();
    markButton(audio.btn, false);
    audio = { el: null, btn: null, src: null, kind: null };
  }

  function speakText(text, btn, src) {
    if (!synth || !text) { markButton(btn, false); audio = { el: null, btn: null, src: null, kind: null }; return; }
    var u = new SpeechSynthesisUtterance(text);
    var voice = englishVoice();
    if (voice) u.voice = voice;
    u.lang = voice ? voice.lang : 'en-US';
    u.rate = 0.85;
    u.onend = function () { if (audio.btn === btn) stopAudio(); };
    u.onerror = function () { if (audio.btn === btn) stopAudio(); };
    audio = { el: null, btn: btn, src: src || text, kind: 'tts' };
    markButton(btn, true);
    synth.speak(u);
    XAPI.send(VERB.played, { id: activityId(audio.src), name: 'tts', type: 'https://w3id.org/xapi/audio/activity-type/audio' });
  }

  /**
   * @param src  recorded clip path, may be absent
   * @param text English to fall back to with the browser voice
   * @param label accessible name
   */
  function speakerButton(src, text, label) {
    if (!src && !(text && synth)) return null;
    var btn = h('button', {
      type: 'button',
      class: 'spk',
      'aria-label': label ? ui('listen') + ' — ' + label : ui('listen'),
      dataset: { playing: '0' },
      onClick: function (ev) {
        ev.stopPropagation();
        var wasThis = audio.btn === btn;
        stopAudio();
        if (wasThis) return;

        if (!src || missingAudio[src]) { speakText(text, btn, src); return; }

        var a = new Audio(src);
        audio = { el: a, btn: btn, src: src, kind: 'file' };
        function fallback() {
          missingAudio[src] = true;
          if (audio.btn !== btn) return;
          audio = { el: null, btn: null, src: null, kind: null };
          speakText(text, btn, src);
        }
        a.addEventListener('error', fallback);
        a.addEventListener('ended', function () { if (audio.btn === btn) stopAudio(); });
        a.play().then(function () {
          markButton(btn, true);
          XAPI.send(VERB.played, { id: activityId(src), name: src, type: 'https://w3id.org/xapi/audio/activity-type/audio' });
        }).catch(fallback);
      }
    });
    btn.appendChild(icon('speaker', 15));
    return btn;
  }

  /* ------------------------------------------------------- content lookup */

  function components() {
    return state.content.components.slice().sort(function (a, b) {
      if (a.order !== b.order) return a.order - b.order;
      return (a.supportLane ? 1 : 0) - (b.supportLane ? 1 : 0);
    });
  }

  function componentById(id) {
    return state.content.components.filter(function (c) { return c.id === id; })[0] || null;
  }

  function itemById(id) {
    var found = null;
    state.content.components.forEach(function (c) {
      c.subContent.forEach(function (it) { if (it.id === id) found = it; });
    });
    return found;
  }

  function currentComponent() { return componentById(state.componentId); }
  function currentItem() {
    var c = currentComponent();
    return c ? c.subContent[state.itemIndex] : null;
  }

  /* ------------------------------------------------------------ answering */

  function norm(s) {
    return String(s === undefined || s === null ? '' : s)
      .toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.!?,]+$/, '');
  }

  function isAnswered(q) {
    var d = state.drafts[q.questionId];
    if (q.openEnded) return typeof d === 'string' && d.trim().length > 0;
    if (q.questionType === 'matching') {
      var need = q.answers.source.length;
      return d && Object.keys(d).length === need;
    }
    if (q.questionType === 'sequencing') {
      return Array.isArray(d) && d.length === q.answers.length;
    }
    if (q.questionType === 'fill-in') return typeof d === 'string' && d.trim().length > 0;
    return d !== undefined && d !== null && d !== '';
  }

  function grade(q) {
    var d = state.drafts[q.questionId];
    if (q.openEnded || q.assessed === false) return null;      // not graded
    switch (q.questionType) {
      case 'fill-in':
        return q.correctAnswers.some(function (c) { return norm(c) === norm(d); });
      case 'sequencing':
        return Array.isArray(d) && d.length === q.correctAnswers.length &&
          d.every(function (v, i) { return norm(v) === norm(q.correctAnswers[i]); });
      case 'matching':
        return q.correctAnswers.every(function (pair) {
          var parts = pair.split('|');
          return d && d[parts[0]] === parts[1];
        });
      default:
        return q.correctAnswers.indexOf(d) !== -1;
    }
  }

  function responseText(q) {
    var d = state.drafts[q.questionId];
    if (q.questionType === 'matching') {
      return Object.keys(d || {}).map(function (k) { return k + '|' + d[k]; }).join('[,]');
    }
    if (q.questionType === 'sequencing') return (d || []).join('[,]');
    return String(d === undefined ? '' : d);
  }

  function checkItem(item) {
    item.questions.forEach(function (q) {
      var prev = state.answers[q.questionId] || { attempts: 0 };
      var correct = grade(q);
      state.answers[q.questionId] = {
        response: state.drafts[q.questionId],
        correct: correct,
        attempts: prev.attempts + 1,
        checked: true
      };

      var obj = { id: activityId(q.questionId), name: L(q.questionText) || q.questionId };
      if (q.assessed === false) {
        XAPI.send(VERB.selected, obj, {
          category: 'https://yuvilab.ai/xapi/category/' + (q.selectedCategory || 'learningType'),
          result: { response: responseText(q) }
        });
      } else {
        XAPI.send(VERB.answered, obj, {
          result: {
            response: responseText(q),
            success: correct === null ? undefined : correct,
            score: correct === null ? undefined : { scaled: correct ? 1 : 0 },
            extensions: { 'https://yuvilab.ai/xapi/ext/attempt': state.answers[q.questionId].attempts }
          }
        });
      }
    });
    render();
  }

  function retryItem(item) {
    item.questions.forEach(function (q) {
      var a = state.answers[q.questionId];
      if (a && a.correct === false) {
        delete state.drafts[q.questionId];
        a.checked = false;
      }
    });
    render();
  }

  function itemChecked(item) {
    return item.questions.length > 0 && item.questions.every(function (q) {
      var a = state.answers[q.questionId];
      return a && a.checked;
    });
  }

  function itemHasRethink(item) {
    return item.questions.some(function (q) {
      var a = state.answers[q.questionId];
      return a && a.checked && a.correct === false;
    });
  }

  function itemReady(item) {
    return item.questions.every(isAnswered);
  }

  /* ---------------------------------------------------------- completion */

  function componentScore(comp) {
    var graded = [];
    comp.subContent.forEach(function (it) {
      it.questions.forEach(function (q) {
        if (q.assessed === false || q.openEnded) return;
        var a = state.answers[q.questionId];
        graded.push(a && a.correct === true ? 1 : 0);
      });
    });
    if (!graded.length) return null;
    return graded.reduce(function (s, v) { return s + v; }, 0) / graded.length;
  }

  function finishComponent(comp) {
    var scaled = componentScore(comp);
    var passed = null;
    if (comp.isAssessment && scaled !== null) {
      passed = scaled >= (comp.passScoreInternal || 0.7);
    } else if (scaled !== null) {
      passed = true;
    }
    state.completed[comp.id] = { passed: passed, scaled: scaled };

    // Completed is emitted only after every piece of learner-facing feedback
    // has already been shown, per the 720 standard.
    XAPI.send(VERB.completed, {
      id: activityId(comp.id),
      name: L(comp.title),
      type: 'http://adlnet.gov/expapi/activities/lesson'
    }, {
      result: {
        completion: true,
        success: passed === null ? undefined : passed,
        score: scaled === null ? undefined : { scaled: Math.round(scaled * 100) / 100 }
      }
    });

    toParent('component-completed', {
      componentId: comp.id,
      success: passed,
      scaled: scaled,
      recommendedAfterFail: passed === false ? (comp.recommendedAfterFail || []) : []
    });

    state.view = 'done';
    render();
  }

  /* ------------------------------------------------------- render: chrome */

  function unitTitle() {
    return L(state.content.titleText || state.content.title);
  }

  function setLang(lang) {
    state.lang = lang;
    var dir = ui('dir') || 'rtl';
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    dom.app.dir = dir;
    render();
  }

  function renderChrome() {
    dom.kicker.textContent = ui('unitKicker');
    dom.title.textContent = unitTitle();
    dom.langBtn.textContent = ui('langSwitch');
    document.title = unitTitle();
  }

  /* ---------------------------------------------------------- render: map */

  function renderMap() {
    var head = h('div', { class: 'map__head' },
      mascot(96),
      h('div', null,
        h('h1', { class: 'map__title' }, ui('mapTitle')),
        h('p', { class: 'map__lead' }, ui('mapLead'))
      )
    );

    var goals = h('section', { class: 'goals' },
      h('div', { class: 'goals__title' }, ui('unitGoalsTitle')),
      h('ul', { class: 'goals__list' }, state.content.goals.map(function (g) {
        return h('li', null, icon('check', 15), h('span', null, L(g)));
      }))
    );

    var CARD_ART = ['book', 'compass', 'spark', 'target', 'bulb', 'check', 'mic'];

    var cards = h('div', { class: 'cards' }, components().map(function (comp, idx) {
      var done = state.completed[comp.id];
      var cls = 'ccard' + (comp.supportLane ? ' ccard--support' : '') + (comp.isAssessment ? ' ccard--assess' : '');
      return h('button', {
        type: 'button', class: cls,
        style: '--accent:' + PALETTE[idx % PALETTE.length] + ';--i:' + idx,
        onClick: function () { openComponent(comp.id); }
      },
        h('div', { class: 'ccard__top' },
          h('span', { class: 'ccard__num' },
            icon(CARD_ART[idx % CARD_ART.length], 19),
            h('span', { class: 'ccard__step' }, String(idx + 1))
          ),
          h('span', { class: 'ccard__title' }, L(comp.title))
        ),
        h('p', { class: 'ccard__sub' }, L(comp.subtitle)),
        h('div', { class: 'ccard__foot' },
          done ? h('span', { class: 'chip chip--done' }, ui('doneChip')) : null,
          comp.supportLane ? h('span', { class: 'chip chip--support' }, ui('supportChip')) : null,
          comp.isAssessment ? h('span', { class: 'chip chip--assess' }, ui('assessChip')) : null,
          h('span', { class: 'chip' }, comp.estimatedTimeInMinutes + ' ' + ui('minutes')),
          h('span', { class: 'ccard__go' }, arrowIcon())
        )
      );
    }));

    dom.wrap.appendChild(h('div', null, head, goals, cards));
    dom.actionbar.hidden = true;
  }

  /* --------------------------------------------------- render: item kinds */

  var KIND = {};

  KIND.plan = function (item, comp) {
    var q = item.questions[0];
    var chosen = state.drafts[q.questionId];
    var answered = state.answers[q.questionId];

    return h('section', { class: 'panel' },
      h('span', { class: 'panel__label' }, icon('target', 13), ui('goalsTitle')),
      h('h2', { class: 'panel__title' }, L(item.title)),
      h('ul', { class: 'goals__list', style: 'margin-bottom:22px' },
        state.content.goals.map(function (g) {
          return h('li', null, icon('check', 15), h('span', null, L(g)));
        })
      ),
      h('p', { class: 'panel__prompt' }, L(q.questionText)),
      h('div', { class: 'opts opts--inline' }, q.answers.map(function (opt) {
        return h('button', {
          type: 'button',
          class: 'opt' + (answered && answered.checked && chosen === opt.id ? ' is-good' : ''),
          'aria-pressed': chosen === opt.id ? 'true' : 'false',
          disabled: answered && answered.checked,
          onClick: function () { state.drafts[q.questionId] = opt.id; render(); }
        },
          h('span', { class: 'opt__mark' }, chosen === opt.id ? icon('check', 13) : ''),
          h('span', { class: 'opt__label' }, L(opt))
        );
      })),
      answered && answered.checked
        ? h('div', { class: 'fb fb--neutral' }, icon('spark', 17), h('p', null, L(q.feedback.any)))
        : null
    );
  };

  KIND.wordbank = function (item) {
    return h('section', { class: 'panel' },
      h('span', { class: 'panel__label' }, icon('book', 13), ui('miniDict')),
      h('h2', { class: 'panel__title' }, L(item.title)),
      h('p', { class: 'panel__prompt' }, L(item.prompt)),
      h('div', { class: 'wordgrid' }, item.body.cards.map(function (c, i) {
        return h('div', { class: 'wordcard wordcard--art', style: '--i:' + i },
          artScene(c.art),
          h('div', { class: 'wordcard__en' }, speakerButton(c.audio, c.en, c.en), h('span', null, c.en)),
          h('div', { class: 'wordcard__gloss' }, L(c))
        );
      }))
    );
  };

  KIND.pronounce = function (item) {
    var b = item.body;
    return h('div', null,
      h('section', { class: 'panel' },
        h('span', { class: 'panel__label' }, icon('speaker', 13), ui('readItRight')),
        h('h2', { class: 'panel__title' }, L(item.title)),
        h('p', { class: 'panel__prompt' }, L(item.prompt)),
        h('div', { class: 'phoneme' },
          h('span', { class: 'phoneme__pattern' }, b.pattern),
          h('span', { class: 'phoneme__ipa' }, b.phoneme)
        ),
        h('div', { class: 'wordrow' }, b.words.map(function (w) {
          var i = w.en.toLowerCase().indexOf(b.pattern);
          var pre = i >= 0 ? w.en.slice(0, i) : w.en;
          var mid = i >= 0 ? w.en.substr(i, b.pattern.length) : '';
          var post = i >= 0 ? w.en.slice(i + b.pattern.length) : '';
          return h('div', { class: 'wordcard' },
            h('div', { class: 'wordcard__en' },
              speakerButton(w.audio, w.en, w.en),
              h('span', null, pre, mid ? h('span', { class: 'hl' }, mid) : null, post)
            )
          );
        }))
      ),
      renderQuestions(item)
    );
  };

  KIND.strategy = function (item) {
    return h('section', { class: 'panel' },
      h('span', { class: 'panel__label panel__label--strategy' }, icon('compass', 13), ui('strategyLabel')),
      h('h2', { class: 'panel__title' }, L(item.title)),
      h('p', { class: 'panel__prompt' }, L(item.prompt)),
      h('ol', { class: 'steps' }, item.body.steps.map(function (s) {
        return h('li', null, h('div', null, L(s)));
      }))
    );
  };

  KIND.rule = function (item) {
    var b = item.body;
    return h('section', { class: 'panel' },
      h('span', { class: 'panel__label panel__label--rule' }, icon('spark', 13), ui('ruleLabel')),
      h('h2', { class: 'panel__title' }, L(item.title)),
      h('p', { class: 'panel__prompt' }, L(item.prompt)),
      h('div', { class: 'rulerows' }, b.rows.map(function (r) {
        return h('div', { class: 'rulerow' },
          h('span', { class: 'rulerow__en' }, r.en),
          h('span', { class: 'rulerow__note' }, L(r.note))
        );
      })),
      b.tip ? h('div', { class: 'tipbox' }, icon('bulb', 17), h('p', null, L(b.tip))) : null
    );
  };

  KIND.solved = function (item) {
    return h('section', { class: 'panel' },
      h('span', { class: 'panel__label panel__label--rule' }, icon('compass', 13), L(item.title)),
      h('h2', { class: 'panel__title' }, L(item.prompt)),
      h('ol', { class: 'steps' }, item.body.steps.map(function (s) {
        return h('li', null, h('div', null,
          h('div', null, L(s)),
          s.en ? h('div', { class: 'steps__en' }, s.en) : null
        ));
      }))
    );
  };

  KIND.reading = function (item) {
    return h('section', { class: 'panel' },
      h('h2', { class: 'panel__title' }, L(item.title)),
      h('p', { class: 'panel__prompt' }, L(item.prompt)),
      readingBlock(item)
    );
  };

  function readingBlock(item) {
    var b = item.body;
    var spoken = [b.heading]
      .concat(b.intro ? b.intro.lines : [])
      .concat(b.replies.map(function (r) { return r.name + '. ' + r.text; }))
      .join('. ');

    return h('div', { class: 'reading' },
      h('div', { class: 'reading__bar' },
        h('span', { class: 'reading__heading' }, b.heading),
        speakerButton(b.audio, spoken, b.heading)
      ),
      h('div', { class: 'reading__body' },
        b.intro ? h('div', { class: 'reading__intro' },
          h('div', { class: 'reading__author' }, avatar(b.intro.author, 34), h('span', null, b.intro.author)),
          b.intro.lines.map(function (l) { return h('p', null, l); })
        ) : null,
        h('div', { class: 'replies' }, b.replies.map(function (r) {
          return h('div', { class: 'reply' },
            avatar(r.name, 38),
            h('span', { class: 'reply__bubble' },
              h('span', { class: 'reply__name' }, r.name),
              h('span', { class: 'reply__text' }, r.text),
              speakerButton(null, r.name + '. ' + r.text, r.name)
            )
          );
        })),
        b.sayIt ? h('div', { class: 'sayit' }, icon('mic', 17),
          h('div', null,
            h('strong', null, ui('sayIt')), ' — ', L(b.sayIt),
            h('span', { class: 'sayit__en' }, b.sayIt.en,
              speakerButton(null, b.sayIt.en, b.sayIt.en))
          )
        ) : null
      )
    );
  }

  KIND.builder = function (item) {
    var b = item.body;
    var key = item.id;
    state.drafts[key] = state.drafts[key] || { subject: null, verb: null, tail: null };
    var sel = state.drafts[key];

    function verbForm(verb) {
      if (!b.thirdPerson || !sel.subject) return { base: verb, suffix: '' };
      var word = verb.split(' ')[0];
      var rest = verb.slice(word.length);
      var suffix = /(ch|sh|s|x|o)$/.test(word) ? 'es' : 's';
      return { base: word, suffix: suffix, rest: rest };
    }

    var out = h('div', { class: 'builder__out' + (sel.subject && sel.verb ? ' is-full' : '') });
    if (sel.subject) out.appendChild(h('span', { class: 'tok tok--subject' }, sel.subject));
    if (sel.verb) {
      var vf = verbForm(sel.verb);
      out.appendChild(document.createTextNode(' '));
      out.appendChild(h('span', { class: 'tok tok--verb' }, vf.base));
      if (vf.suffix) out.appendChild(h('span', { class: 'tok--s' }, vf.suffix));
      if (vf.rest) out.appendChild(h('span', { class: 'tok tok--verb' }, vf.rest));
    }
    if (sel.tail) { out.appendChild(document.createTextNode(' ')); out.appendChild(h('span', { class: 'tok tok--tail' }, sel.tail)); }
    if (sel.subject && sel.verb) out.appendChild(document.createTextNode('.'));
    if (!sel.subject && !sel.verb) out.appendChild(h('span', { style: 'color:var(--ink-3);font-weight:400' }, ui('yourTurn')));

    function row(label, list, field) {
      return h('div', { class: 'builder__row' },
        h('span', { class: 'builder__rowlabel' }, label),
        h('div', { class: 'builder__opts' }, list.map(function (v) {
          return h('button', {
            type: 'button', class: 'tokbtn',
            'aria-pressed': sel[field] === v ? 'true' : 'false',
            onClick: function () { sel[field] = sel[field] === v ? null : v; render(); }
          }, v);
        }))
      );
    }

    return h('section', { class: 'panel' },
      h('span', { class: 'panel__label panel__label--rule' }, icon('spark', 13), ui('ruleLabel')),
      h('h2', { class: 'panel__title' }, L(item.title)),
      h('div', { class: 'rulerow', style: 'margin-bottom:18px' },
        h('span', { class: 'rulerow__en' }, b.rule.en),
        h('span', { class: 'rulerow__note' }, L(b.rule))
      ),
      h('p', { class: 'panel__prompt' }, L(item.prompt)),
      h('div', { class: 'builder' },
        out,
        row('Subject', b.subjects, 'subject'),
        row('Verb', b.verbs, 'verb'),
        row('When / where', b.tails, 'tail')
      )
    );
  };

  KIND.summary = function (item) {
    return h('section', { class: 'panel' },
      h('span', { class: 'panel__label' }, icon('book', 13), L(item.title)),
      h('h2', { class: 'panel__title' }, L(item.prompt)),
      h('div', { class: 'sumgrid' }, item.body.blocks.map(function (bl) {
        return h('div', { class: 'sumblock' },
          h('h4', null, state.lang === 'ar' ? bl.titleAr : bl.titleHe),
          h('ul', null, bl.lines.map(function (l) { return h('li', null, l); }))
        );
      }))
    );
  };

  KIND.selfcheck = function (item) {
    var opts = [
      { v: 'yes', label: ui('selfCheckYes') },
      { v: 'partly', label: ui('selfCheckPartly') },
      { v: 'no', label: ui('selfCheckNo') }
    ];
    return h('section', { class: 'panel' },
      h('span', { class: 'panel__label panel__label--strategy' }, icon('target', 13), L(item.title)),
      h('h2', { class: 'panel__title' }, L(item.prompt)),
      h('div', { class: 'selfcheck' }, state.content.goals.map(function (g) {
        return h('div', { class: 'selfcheck__row' },
          h('span', { class: 'selfcheck__goal' }, L(g)),
          h('div', { class: 'selfcheck__opts' }, opts.map(function (o) {
            return h('button', {
              type: 'button', class: 'scbtn',
              dataset: { v: o.v },
              'aria-pressed': state.selfCheck[g.id] === o.v ? 'true' : 'false',
              onClick: function () {
                state.selfCheck[g.id] = o.v;
                XAPI.send(VERB.selected, { id: activityId(item.id + '#' + g.id), name: g.id },
                  { category: 'https://yuvilab.ai/xapi/category/isUnderstood', result: { response: o.v } });
                render();
              }
            }, o.label);
          }))
        );
      }))
    );
  };

  KIND.reflect = function (item) {
    return h('section', { class: 'panel' },
      h('span', { class: 'panel__label panel__label--strategy' }, icon('bulb', 13), L(item.title)),
      h('h2', { class: 'panel__title' }, L(item.prompt)),
      h('textarea', {
        class: 'fill fill--open',
        dir: 'auto',
        placeholder: ui('reflectPlaceholder'),
        onInput: function (e) { state.reflection = e.target.value; }
      }, state.reflection)
    );
  };

  KIND.question = function (item) {
    return h('div', null,
      item.showReference ? referenceBlock(item.showReference) : null,
      renderQuestions(item)
    );
  };

  function referenceBlock(refId) {
    var ref = itemById(refId);
    if (!ref) return null;
    return h('details', { class: 'ref' },
      h('summary', null, icon('book', 14), L(ref.title)),
      readingBlock(ref)
    );
  }

  /* ----------------------------------------------------- render: questions */

  function renderQuestions(item) {
    var stickyRule = null;
    var comp = currentComponent();
    if (comp) {
      comp.subContent.forEach(function (it) {
        if (it.body && it.body.sticky) stickyRule = it;
      });
    }

    return h('section', { class: 'panel' },
      stickyRule ? h('div', { class: 'sticky-rule' }, stickyRule.body.rows.map(function (r) {
        return h('div', { class: 'rulerow' },
          h('span', { class: 'rulerow__en' }, r.en),
          h('span', { class: 'rulerow__note' }, L(r.note))
        );
      })) : null,
      h('h2', { class: 'panel__title' }, L(item.title)),
      h('p', { class: 'panel__prompt' }, L(item.prompt)),
      item.questions.map(function (q, i) { return questionBlock(q, i, item); })
    );
  }

  function questionBlock(q, index, item) {
    var rec = state.answers[q.questionId];
    var locked = rec && rec.checked;
    var body;

    switch (q.questionType) {
      case 'fill-in': body = fillIn(q, locked); break;
      case 'sequencing': body = sequencing(q, locked); break;
      case 'matching': body = matching(q, locked); break;
      default: body = choice(q, locked); break;
    }

    var fb = null;
    if (locked) {
      if (q.openEnded || q.assessed === false) {
        fb = h('div', { class: 'fb fb--neutral' }, icon('spark', 17), h('p', null, L(q.feedback.any)));
      } else if (rec.correct) {
        fb = h('div', { class: 'fb fb--good' }, icon('check', 17), h('p', null, L(q.feedback.correct)));
      } else {
        fb = h('div', { class: 'fb fb--rethink' }, icon('rethink', 17), h('p', null, L(q.feedback.incorrect)));
      }
    }

    return h('div', { class: 'qblock', style: index ? 'margin-top:26px' : '' },
      h('div', { class: 'qhead' },
        item.questions.length > 1 ? h('span', { class: 'qhead__n' }, (index + 1) + ' / ' + item.questions.length) : null,
        q.stretch ? h('span', { class: 'qhead__stretch' }, icon('spark', 11), ui('stretchLabel')) : null
      ),
      h('div', { class: 'qask' }, icon('target', 13), ui('whatIsAsked'), ' ', L(q.questionText)),
      q.questionTextEn ? h('div', { class: 'qstem' },
        speakerButton(q.audio, q.questionTextEn, q.questionTextEn),
        h('span', null, q.questionTextEn)
      ) : (q.audio ? h('div', { class: 'qstem' }, speakerButton(q.audio, q.questionTextEn, ''), h('span', null, '\u2026')) : null),
      body,
      state.hinted[q.questionId] && !locked
        ? h('div', { class: 'hintbox' }, L(q.feedback.hint))
        : null,
      fb
    );
  }

  function choice(q, locked) {
    var d = state.drafts[q.questionId];
    var rec = state.answers[q.questionId];
    var inline = q.answers.length <= 2 || q.answers.every(function (a) { return (a.en || L(a)).length < 14; });
    return h('div', { class: 'opts' + (inline ? ' opts--inline' : '') }, q.answers.map(function (opt) {
      var picked = d === opt.id;
      var cls = 'opt';
      if (locked && picked) cls += rec.correct === false ? ' is-rethink' : ' is-good';
      if (locked && !picked && rec && rec.correct === false && q.correctAnswers.indexOf(opt.id) !== -1) cls += ' is-good';
      return h('button', {
        type: 'button', class: cls,
        'aria-pressed': picked ? 'true' : 'false',
        disabled: locked,
        onClick: function () { state.drafts[q.questionId] = opt.id; render(); }
      },
        h('span', { class: 'opt__mark' }, picked || (locked && q.correctAnswers.indexOf(opt.id) !== -1) ? icon('check', 13) : ''),
        h('span', { class: 'opt__label' + (opt.en ? ' ltr' : '') }, opt.en || L(opt))
      );
    }));
  }

  function fillIn(q, locked) {
    var rec = state.answers[q.questionId];
    var cls = 'fill' + (q.openEnded ? ' fill--open' : '');
    if (locked && !q.openEnded) cls += rec.correct ? ' is-good' : ' is-rethink';
    var node = h(q.openEnded ? 'textarea' : 'input', {
      class: cls,
      type: q.openEnded ? null : 'text',
      dir: q.openEnded ? 'auto' : 'ltr',
      spellcheck: 'false',
      autocomplete: 'off',
      placeholder: q.openEnded ? ui('reflectPlaceholder') : ui('typeHint'),
      disabled: locked,
      onInput: function (e) { state.drafts[q.questionId] = e.target.value; updateActionBar(); }
    });
    node.value = state.drafts[q.questionId] || '';
    return h('div', null, node);
  }

  /* Deterministic, render-stable shuffle. Without it, distractor order mirrors
     the correct order and the exercise can be solved without reading. */
  var shuffleCache = {};
  function shuffled(key, arr) {
    if (shuffleCache[key]) return shuffleCache[key];
    var seed = 0;
    for (var c = 0; c < key.length; c++) seed = (seed * 31 + key.charCodeAt(c)) >>> 0;
    var out = arr.slice();
    for (var i = out.length - 1; i > 0; i--) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      var j = seed % (i + 1);
      var tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    shuffleCache[key] = out;
    return out;
  }

  function sequencing(q, locked) {
    var placed = state.drafts[q.questionId] || [];
    var rec = state.answers[q.questionId];
    var lineCls = 'seq__line';
    if (locked) lineCls += rec.correct ? ' is-good' : ' is-rethink';

    return h('div', { class: 'seq' },
      h('div', { class: lineCls }, placed.length ? placed.map(function (tok, i) {
        return h('button', {
          type: 'button', class: 'seq__tok seq__tok--placed', disabled: locked,
          onClick: function () {
            var next = placed.slice(); next.splice(i, 1);
            state.drafts[q.questionId] = next; render();
          }
        }, tok);
      }) : h('span', { style: 'color:var(--ink-3)' }, ui('orderHint'))),
      h('div', { class: 'seq__bank' }, shuffled('seq:' + q.questionId, q.answers).map(function (tok) {
        var used = placed.indexOf(tok) !== -1;
        return h('button', {
          type: 'button',
          class: 'seq__tok' + (used ? ' seq__tok--used' : ''),
          disabled: locked || used,
          onClick: function () { state.drafts[q.questionId] = placed.concat([tok]); render(); }
        }, tok);
      }))
    );
  }

  function matching(q, locked) {
    var links = state.drafts[q.questionId] || {};
    var pending = state.drafts['__pending__' + q.questionId] || null;
    var rec = state.answers[q.questionId];
    var order = Object.keys(links);

    function pairIndex(src) { return order.indexOf(src) + 1; }

    function srcClass(src) {
      var c = 'match__item';
      if (pending === src) c += ' is-linked';
      else if (links[src]) c += ' is-linked';
      if (locked) {
        var ok = q.correctAnswers.indexOf(src + '|' + links[src]) !== -1;
        c = 'match__item ' + (ok ? 'is-good' : 'is-rethink');
      }
      return c;
    }

    return h('div', { class: 'match' },
      h('div', { class: 'match__col' },
        h('div', { class: 'builder__rowlabel' }, ui('matchHint')),
        q.answers.source.map(function (src) {
          return h('button', {
            type: 'button', class: srcClass(src),
            'aria-pressed': pending === src ? 'true' : 'false',
            disabled: locked,
            onClick: function () {
              if (links[src]) { delete links[src]; state.drafts[q.questionId] = links; }
              state.drafts['__pending__' + q.questionId] = pending === src ? null : src;
              render();
            }
          },
            h('span', { class: 'match__pair', hidden: !links[src] }, links[src] ? String(pairIndex(src)) : ''),
            h('span', { class: 'match__en' }, src)
          );
        })
      ),
      h('div', { class: 'match__col' },
        h('div', { class: 'builder__rowlabel' }, '\u00a0'),
        shuffled('match:' + q.questionId, q.answers.target).map(function (t) {
          var owner = Object.keys(links).filter(function (s) { return links[s] === t.id; })[0];
          var cls = 'match__item' + (owner ? ' is-linked' : '');
          if (locked && owner) {
            cls = 'match__item ' + (q.correctAnswers.indexOf(owner + '|' + t.id) !== -1 ? 'is-good' : 'is-rethink');
          }
          return h('button', {
            type: 'button', class: cls, disabled: locked,
            onClick: function () {
              if (!pending) return;
              Object.keys(links).forEach(function (s) { if (links[s] === t.id) delete links[s]; });
              links[pending] = t.id;
              state.drafts[q.questionId] = links;
              state.drafts['__pending__' + q.questionId] = null;
              render();
            }
          },
            h('span', { class: 'match__pair', hidden: !owner }, owner ? String(pairIndex(owner)) : ''),
            h('span', { class: t.en ? 'match__en' : '' }, t.en || L(t))
          );
        })
      )
    );
  }

  /* ------------------------------------------------- render: component view */

  function renderComponent() {
    var comp = currentComponent();
    var item = currentItem();
    if (!state.seen[item.id]) {
      state.seen[item.id] = true;
      XAPI.send(VERB.initialized, { id: activityId(item.id), name: L(item.title) });
    }

    var crumbs = h('div', { class: 'crumbs' },
      h('button', { type: 'button', class: 'ghostbtn', onClick: backToMap }, icon('arrowBack', 15), ui('backToMap')),
      h('span', { class: 'crumbs__title' }, L(comp.title)),
      h('div', { class: 'dots', role: 'tablist', 'aria-label': ui('mapTitle') },
        comp.subContent.map(function (it, i) {
          return h('button', {
            type: 'button', class: 'dot', role: 'tab',
            'aria-label': String(i + 1),
            'aria-current': i === state.itemIndex ? 'step' : null,
            dataset: { seen: state.seen[it.id] ? '1' : '0' },
            onClick: function () { goToItem(i); }
          });
        })
      )
    );

    var renderer = KIND[item.kind] || KIND.question;
    dom.wrap.appendChild(h('div', { class: 'screen' }, crumbs, renderer(item, comp)));
    renderActionBar(item, comp);
  }

  function renderDone() {
    var comp = currentComponent();
    var idx = components().map(function (c) { return c.id; }).indexOf(comp.id);
    var next = components()[idx + 1];
    var rec = state.completed[comp.id] || {};

    var text;
    if (rec.passed === false) {
      text = ui('doneTextSupport');
      var supportId = (comp.recommendedAfterFail || [])[0];
      next = supportId ? componentById(supportId) : next;
    } else {
      text = ui('doneTextOk');
    }

    dom.wrap.appendChild(h('section', { class: 'panel done' },
      h('div', { class: 'done__confetti', 'aria-hidden': 'true' },
        [0, 1, 2, 3, 4, 5, 6, 7].map(function (n) {
          return h('i', { style: '--i:' + n + ';--c:' + PALETTE[n % PALETTE.length] });
        })
      ),
      mascot(108, rec.passed === false ? null : 'cheer'),
      h('h2', { class: 'done__title' }, ui('componentDone')),
      h('p', { class: 'done__text' }, text),
      h('div', { class: 'done__actions' },
        h('button', { type: 'button', class: 'btn btn--quiet', onClick: backToMap }, ui('backToMap')),
        h('button', { type: 'button', class: 'btn btn--quiet', onClick: function () { openComponent(comp.id); } }, ui('again')),
        next ? h('button', {
          type: 'button', class: 'btn btn--primary',
          onClick: function () { openComponent(next.id); }
        }, ui('openNext'), arrowIcon()) : null
      )
    ));
    dom.actionbar.hidden = true;
  }

  /* --------------------------------------------------------- action bar */

  function renderActionBar(item, comp) {
    var bar = dom.actionbarInner;
    bar.innerHTML = '';
    dom.actionbar.hidden = false;

    var isLast = state.itemIndex === comp.subContent.length - 1;
    var hasQ = item.questions.length > 0;
    var checked = itemChecked(item);

    bar.appendChild(h('button', {
      type: 'button', class: 'btn btn--quiet',
      disabled: state.itemIndex === 0,
      onClick: function () { goToItem(state.itemIndex - 1); }
    }, ui('back')));

    bar.appendChild(h('span', { class: 'actionbar__spacer' }));

    if (hasQ && !checked) {
      var hintQ = item.questions.filter(function (q) {
        return q.feedback && q.feedback.hint && !state.hinted[q.questionId];
      })[0];
      if (hintQ) {
        bar.appendChild(h('button', {
          type: 'button', class: 'btn btn--quiet',
          onClick: function () {
            state.hinted[hintQ.questionId] = true;
            XAPI.send(VERB.requested, { id: activityId(hintQ.questionId), name: 'hint' },
              { result: { response: 'hint' } });
            render();
          }
        }, icon('bulb', 16), ui('hint')));
      }
      bar.appendChild(h('button', {
        type: 'button', class: 'btn btn--primary', id: 'checkBtn',
        disabled: !itemReady(item),
        onClick: function () { checkItem(item); }
      }, ui('check')));
      return;
    }

    if (hasQ && checked && itemHasRethink(item)) {
      bar.appendChild(h('button', {
        type: 'button', class: 'btn btn--quiet',
        onClick: function () { retryItem(item); }
      }, ui('retry')));
    }

    bar.appendChild(h('button', {
      type: 'button', class: 'btn btn--primary',
      onClick: function () {
        if (isLast) finishComponent(comp);
        else goToItem(state.itemIndex + 1);
      }
    }, isLast ? ui('componentDone') : ui('next'), isLast ? icon('check', 17) : arrowIcon()));
  }

  function updateActionBar() {
    var item = currentItem();
    if (!item) return;
    var btn = document.getElementById('checkBtn');
    if (btn) btn.disabled = !itemReady(item);
  }

  /* ------------------------------------------------------------ navigation */

  function openComponent(id) {
    stopAudio();
    state.componentId = id;
    state.itemIndex = 0;
    state.view = 'component';
    var comp = componentById(id);
    XAPI.send(VERB.initialized, {
      id: activityId(comp.id), name: L(comp.title),
      type: 'http://adlnet.gov/expapi/activities/lesson'
    });
    toParent('component-opened', { componentId: id });
    render();
  }

  function goToItem(i) {
    var comp = currentComponent();
    if (i < 0 || i >= comp.subContent.length) return;
    stopAudio();
    state.itemIndex = i;
    render();
  }

  function backToMap() {
    stopAudio();
    state.view = 'map';
    render();
  }

  /* ----------------------------------------------------------- idle watch */

  var idleTimer = null;
  function resetIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      if (state.view !== 'component') return;
      var item = currentItem();
      XAPI.send(VERB.suspended, { id: activityId(item ? item.id : state.content.id), name: 'inactivity' },
        { result: { extensions: { 'https://yuvilab.ai/xapi/ext/idleSeconds': 120 } } });
    }, 120000);
  }

  /* --------------------------------------------------------------- render */

  function render() {
    dom.wrap.innerHTML = '';
    renderChrome();
    if (state.view === 'map') renderMap();
    else if (state.view === 'done') renderDone();
    else renderComponent();
    resetIdle();
  }

  /* ----------------------------------------------------------------- boot */

  function fatal(message) {
    document.getElementById('wrap').appendChild(
      h('section', { class: 'panel' }, h('p', null, message))
    );
  }

  function boot() {
    dom.app = document.getElementById('app');
    dom.wrap = document.getElementById('wrap');
    dom.kicker = document.getElementById('topKicker');
    dom.title = document.getElementById('topTitle');
    dom.langBtn = document.getElementById('langBtn');
    dom.actionbar = document.getElementById('actionbar');
    dom.actionbarInner = document.getElementById('actionbarInner');

    XAPI.init();
    if (synth) synth.getVoices(); // Chrome populates the list asynchronously on first touch

    var params = new URLSearchParams(location.search);
    var lang = params.get('lang');
    state.lang = (lang === 'ar' || lang === 'he') ? lang : 'he';

    var startedAt = Date.now();
    var slowTimer = setTimeout(function () {
      XAPI.send(VERB.suspended, { id: activityId('content.json'), name: 'slow-load' },
        { result: { extensions: { 'https://yuvilab.ai/xapi/ext/loadMs': 5000 } } });
    }, 5000);

    fetch('content.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      })
      .then(function (data) {
        clearTimeout(slowTimer);
        state.content = data;
        XAPI.send(VERB.initialized, {
          id: activityId(data.id), name: data.title,
          type: 'http://adlnet.gov/expapi/activities/course'
        }, { result: { extensions: { 'https://yuvilab.ai/xapi/ext/loadMs': Date.now() - startedAt } } });
        toParent('ready', {});
        setLang(state.lang);
      })
      .catch(function () {
        clearTimeout(slowTimer);
        XAPI.send(VERB.failed, { id: activityId('content.json'), name: 'load-failure' });
        fatal('התוכן לא נטען. נסו לרענן את העמוד.');
      });

    dom.langBtn.addEventListener('click', function () {
      setLang(state.lang === 'he' ? 'ar' : 'he');
    });

    ['pointerdown', 'keydown'].forEach(function (evt) {
      window.addEventListener(evt, resetIdle, { passive: true });
    });

    window.addEventListener('pagehide', function () {
      if (!state.content) return;
      var openComp = state.componentId && !state.completed[state.componentId];
      if (openComp) {
        XAPI.send(VERB.terminated, { id: activityId(state.componentId), name: 'closed-before-completion' },
          { result: { completion: false } });
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
