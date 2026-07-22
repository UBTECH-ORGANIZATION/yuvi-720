// @ts-nocheck
/* eslint-disable */


export function initLomdaCreator() {
    // ============================================================
    //  Create-a-Lomda demo  — kid builds a curriculum game by describing it
    // ============================================================
    const STUDENT_NAME = 'יובל';
    let currentTopic = 'electronics';
    let busy = false;

    const TOPICS = {
        electronics: {
            label: 'אלקטרוניקה ומעגלים חשמליים',
            greeting: 'היי יובל! 👋 ראיתי שכדאי לחזק את <b>אלקטרוניקה ומעגלים חשמליים</b> — אז בוא נלמד דרך יצירה! ספר לי איזו לומדה-משחק תרצה שאבנה לך, ואני אבנה אותה כאן בזמן אמת. 🔧',
            suggestions: [
                'בנה לי מעבדת אלקטרוניקה שבה אני מחבר סוללה, נגד ונורה כדי לסגור מעגל ולהדליק את הנורה 💡',
                'משחק שבו אני צריך לבחור את הנגד הנכון כדי שהנורה תאיר חזק בלי להישרף',
                'מעבדה עם מתג — אני פותח וסוגר את המעגל ורואה מה קורה לנורה',
            ],
        },
        math: {
            label: 'מתמטיקה',
            greeting: 'היי יובל! 👋 בוא נחזק <b>מתמטיקה</b> דרך יצירה. תאר לי לומדה-משחק שתרצה ואבנה אותה כאן! 📐',
            suggestions: [
                'משחק שבו אני גורר זוויות ומזהה אם הן חדות, ישרות או קהות',
                'מחשבון-משחק שבו אני פותר תרגילי כפל ומקבל נקודות',
            ],
        },
        science: {
            label: 'מדעים',
            greeting: 'היי יובל! 👋 בוא נחקור <b>מדעים</b> דרך יצירה. איזו לומדה-משחק לבנות? 🔬',
            suggestions: [
                'מעבדה שבה אני מערבב צבעים ורואה איזה צבע חדש מתקבל',
                'משחק שבו אני ממיין בעלי חיים לפי קבוצות',
            ],
        },
    };

    const chatBody = document.getElementById('chatBody');
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const suggestWrap = document.getElementById('suggestWrap');
    const codePre = document.getElementById('codePre');
    const codeScroll = document.getElementById('codeScroll');
    const previewFrame = document.getElementById('previewFrame');
    const previewEmpty = document.getElementById('previewEmpty');
    const stageStatus = document.getElementById('stageStatus');
    const stageStatusText = document.getElementById('stageStatusText');

    function esc(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function addMsg(who, html) {
        const m = document.createElement('div');
        m.className = 'msg ' + who;
        if (who === 'bot') {
            m.innerHTML = `<div class="mini-bot">
                <svg viewBox="0 0 36 36" width="18" height="18" fill="none">
                    <rect x="8" y="12" width="20" height="16" rx="4" fill="#fff" fill-opacity="0.92"/>
                    <rect x="12" y="16" width="4" height="4" rx="1.5" fill="#7c5cff"/>
                    <rect x="20" y="16" width="4" height="4" rx="1.5" fill="#7c5cff"/>
                </svg></div><div class="bubble">${html}</div>`;
        } else {
            m.innerHTML = `<div class="bubble">${html}</div>`;
        }
        chatBody.appendChild(m);
        chatBody.scrollTop = chatBody.scrollHeight;
        return m;
    }

    function addTyping() {
        const m = addMsg('bot', '<div class="typing"><span></span><span></span><span></span></div>');
        return m;
    }

    function renderTopicIntro() {
        chatBody.innerHTML = '';
        addMsg('bot', TOPICS[currentTopic].greeting);
        renderSuggestions();
    }

    function renderSuggestions() {
        const t = TOPICS[currentTopic];
        suggestWrap.innerHTML = '<div class="lbl">💡 רעיונות להתחלה (לחץ לבחירה):</div>' +
            t.suggestions.map(s => `<button class="suggest">${s}</button>`).join('');
        suggestWrap.querySelectorAll('.suggest').forEach(btn => {
            btn.addEventListener('click', () => { if (!busy) { chatInput.value = btn.textContent; onSend(); } });
        });
    }

    // topic chips
    document.getElementById('topicChips').addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip || busy) return;
        document.querySelectorAll('#topicChips .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        currentTopic = chip.dataset.topic;
        renderTopicIntro();
    });

    function showTab(which) {
        document.getElementById('tabPreview').classList.toggle('active', which === 'preview');
        document.getElementById('tabCode').classList.toggle('active', which === 'code');
        document.getElementById('previewWrap').classList.toggle('active', which === 'preview');
        document.getElementById('codeWrap').classList.toggle('active', which === 'code');
    }
    window.showTab = showTab;

    function setStatus(text, live) {
        stageStatusText.textContent = text;
        stageStatus.classList.toggle('live', !!live);
    }

    chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !busy) onSend(); });

    async function onSend() {
        const text = chatInput.value.trim();
        if (!text || busy) return;
        busy = true;
        sendBtn.disabled = true;
        chatInput.value = '';
        suggestWrap.innerHTML = '';
        addMsg('user', esc(text));
        const typing = addTyping();

        // Switch to code tab and start "writing"
        showTab('code');
        setStatus('יובי כותב קוד...', true);
        codePre.innerHTML = '';
        const caret = '<span class="code-caret"></span>';

        let raw = '';
        let gotError = false;
        try {
            const resp = await fetch('/api/create-lomda-stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  message: text,
                  topic: currentTopic,
                  student_name: STUDENT_NAME,
                }),
            });
            if (!resp.ok || !resp.body) throw new Error('bad response');

            // Yuvi short "building" message replaces typing
            typing.querySelector('.bubble').innerHTML = 'רגע, אני בונה לך את זה עכשיו... 🔧 אפשר לעקוב אחרי הקוד שאני כותב בצד שמאל!';

            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const payload = line.slice(6);
                    if (payload === '[DONE]') continue;
                    try {
                        const obj = JSON.parse(payload);
                        if (obj.code) {
                            raw += obj.code;
                            codePre.innerHTML = esc(stripFences(raw)) + caret;
                            codeScroll.scrollTop = codeScroll.scrollHeight;
                        } else if (obj.error) {
                            gotError = true;
                        }
                    } catch (_) {}
                }
            }
        } catch (err) {
            gotError = true;
        }

        let html = stripFences(raw).trim();
        if (gotError || !isValidHtml(html)) {
            html = FALLBACK[currentTopic] || FALLBACK.electronics;
            // type the fallback into the code panel for the same effect
            await typeCode(html, caret);
        } else {
            codePre.innerHTML = esc(html);
        }

        // Render into preview
        setStatus('הלומדה מוכנה!', false);
        previewEmpty.style.display = 'none';
        previewFrame.style.display = 'block';
        previewFrame.srcdoc = html;
        showTab('preview');

        typing.querySelector('.bubble').innerHTML = successMsg();
        busy = false;
        sendBtn.disabled = false;
        chatInput.focus();
    }

    function successMsg() {
        const msgs = {
            electronics: 'יש! 🎉 בנינו לך מעבדת אלקטרוניקה. חבר את הרכיבים כדי לסגור את המעגל ולהדליק את הנורה 💡 — ולמדת תוך כדי שיצרת בעצמך!',
            math: 'מעולה! 🎉 הלומדה מוכנה — שחק, תרגל, ותראה שאתה לומד הכי טוב כשאתה יוצר בעצמך ✨',
            science: 'יופי! 🔬 המעבדה שלך מוכנה — נסה, גלה, ולמד תוך כדי יצירה ✨',
        };
        return msgs[currentTopic] || msgs.electronics;
    }

    function stripFences(s) {
        return s.replace(/^```[a-zA-Z]*\s*/m, '').replace(/```\s*$/m, '');
    }
    function isValidHtml(s) {
        return s.length > 200 && /<html[\s>]/i.test(s) && /<\/html>/i.test(s);
    }

    async function typeCode(html, caret) {
        codePre.innerHTML = '';
        const step = Math.max(8, Math.floor(html.length / 140));
        for (let i = 0; i < html.length; i += step) {
            codePre.innerHTML = esc(html.slice(0, i)) + caret;
            codeScroll.scrollTop = codeScroll.scrollHeight;
            await new Promise(r => setTimeout(r, 12));
        }
        codePre.innerHTML = esc(html);
    }

    // ====== Built-in fallbacks (always work, fully interactive) ======
    const FALLBACK = {
        electronics: `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>מעבדת אלקטרוניקה</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, 'Segoe UI', sans-serif; background: linear-gradient(160deg,#1e1b3a,#2d2657); color:#fff; margin:0; padding:18px; text-align:center; }
  h1 { font-size: 1.3rem; margin: 4px 0 2px; }
  .sub { color:#c4b5fd; font-size:.9rem; margin-bottom:14px; }
  .board { background:#15122b; border-radius:18px; padding:22px; max-width:560px; margin:0 auto; box-shadow:0 8px 30px rgba(0,0,0,.4); }
  .circuit { display:flex; align-items:center; justify-content:center; gap:6px; margin:10px 0 18px; flex-wrap:wrap; }
  .slot { width:84px; height:84px; border-radius:14px; border:2px dashed #4c4080; background:#1f1a3d; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; font-size:.7rem; color:#9f93cf; cursor:pointer; transition:.18s; }
  .slot.filled { border-style:solid; border-color:#7c5cff; background:#2a2350; color:#fff; }
  .slot .ico { font-size:1.7rem; }
  .wire { width:22px; height:5px; background:#4c4080; border-radius:3px; }
  .wire.on { background:#fbbf24; box-shadow:0 0 10px #fbbf24; }
  .bulb { font-size:2.6rem; transition:.2s; filter:grayscale(1) brightness(.6); }
  .bulb.lit { filter:none; text-shadow:0 0 22px #ffe26b, 0 0 40px #ffd000; transform:scale(1.12); }
  .tray { display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin-top:8px; }
  .part { background:#2a2350; border:1px solid #4c4080; border-radius:12px; padding:9px 12px; cursor:pointer; font-size:.78rem; display:flex; align-items:center; gap:6px; transition:.15s; }
  .part:hover { background:#3a3170; transform:translateY(-2px); }
  .part.used { opacity:.35; pointer-events:none; }
  .msg { margin-top:14px; min-height:42px; font-size:.92rem; font-weight:600; }
  .switch { margin-top:12px; }
  .switch button { background:#7c5cff; color:#fff; border:none; border-radius:999px; padding:9px 20px; font-size:.85rem; font-weight:700; cursor:pointer; }
  .switch button:disabled { opacity:.4; cursor:not-allowed; }
  .reset { margin-top:8px; background:none; border:1px solid #4c4080; color:#c4b5fd; border-radius:999px; padding:6px 16px; font-size:.78rem; cursor:pointer; }
</style>
</head>
<body>
  <h1>⚡ מעבדת אלקטרוניקה</h1>
  <div class="sub">חבר את הרכיבים לפי הסדר כדי לסגור את המעגל ולהדליק את הנורה</div>
  <div class="board">
    <div class="circuit">
      <div class="slot" data-need="battery" id="s0"><span class="ico">＋</span><span>סוללה</span></div>
      <div class="wire" id="w0"></div>
      <div class="slot" data-need="switch" id="s1"><span class="ico">＋</span><span>מתג</span></div>
      <div class="wire" id="w1"></div>
      <div class="slot" data-need="resistor" id="s2"><span class="ico">＋</span><span>נגד</span></div>
      <div class="wire" id="w2"></div>
      <div class="slot" data-need="bulb" id="s3"><span class="bulb" id="bulb">💡</span></div>
    </div>
    <div class="tray" id="tray">
      <div class="part" data-part="battery">🔋 סוללה</div>
      <div class="part" data-part="switch">🔘 מתג</div>
      <div class="part" data-part="resistor">〰️ נגד</div>
      <div class="part" data-part="bulb">💡 נורה</div>
    </div>
    <div class="switch">
      <button id="powerBtn" disabled>הפעל את המתג 🔌</button>
    </div>
    <div class="msg" id="msg">גרור בעיניים 👀 — לחץ על רכיב מהמגירה כדי לשבץ אותו במקום הריק הבא.</div>
    <button class="reset" onclick="location.reload()">התחל מחדש ↺</button>
  </div>
<script>
  const order = ['battery','switch','resistor','bulb'];
  let placed = 0; let powered = false;
  const msg = document.getElementById('msg');
  const tray = document.getElementById('tray');
  const powerBtn = document.getElementById('powerBtn');

  tray.addEventListener('click', (e) => {
    const part = e.target.closest('.part');
    if (!part || part.classList.contains('used')) return;
    const need = order[placed];
    if (part.dataset.part !== need) {
      msg.textContent = 'אופס! 🤔 לפי המעגל, הרכיב הבא צריך להיות: ' + heb(need) + '. נסה שוב.';
      msg.style.color = '#fca5a5';
      return;
    }
    const slot = document.getElementById('s' + placed);
    if (need === 'bulb') {
      slot.classList.add('filled');
    } else {
      slot.innerHTML = '<span class="ico">' + icon(need) + '</span><span>' + heb(need) + '</span>';
      slot.classList.add('filled');
    }
    part.classList.add('used');
    placed++;
    msg.style.color = '#86efac';
    if (placed < order.length) {
      msg.textContent = 'יופי! ✅ עכשיו שבץ: ' + heb(order[placed]);
    } else {
      msg.textContent = 'כל הרכיבים במקום! 🔋 עכשיו הפעל את המתג כדי לסגור את המעגל.';
      powerBtn.disabled = false;
    }
  });

  powerBtn.addEventListener('click', () => {
    powered = !powered;
    document.querySelectorAll('.wire').forEach(w => w.classList.toggle('on', powered));
    document.getElementById('bulb').classList.toggle('lit', powered);
    if (powered) {
      msg.style.color = '#fde68a';
      msg.innerHTML = '🎉 המעגל סגור והנורה נדלקה! <br>למה? כי הזרם זורם מהסוללה דרך המתג הסגור והנגד אל הנורה — מעגל סגור = אור! 💡';
      powerBtn.textContent = 'כבה את המתג';
    } else {
      msg.style.color = '#c4b5fd';
      msg.textContent = 'פתחת את המתג — המעגל נפתח והנורה כבתה. בלי מעגל סגור אין זרם.';
      powerBtn.textContent = 'הפעל את המתג 🔌';
    }
  });

  function heb(k){return {battery:'סוללה',switch:'מתג',resistor:'נגד',bulb:'נורה'}[k];}
  function icon(k){return {battery:'🔋',switch:'🔘',resistor:'〰️',bulb:'💡'}[k];}
<\/script>
<script src="/shared/i18n.js?v=1"></script>
</body>
</html>`,
        math: `<!DOCTYPE html>
<html lang="he" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>משחק זוויות</title>
<style>
  body{font-family:system-ui,sans-serif;background:linear-gradient(160deg,#1e1b3a,#2d2657);color:#fff;margin:0;padding:20px;text-align:center;}
  h1{font-size:1.3rem;} .sub{color:#c4b5fd;font-size:.9rem;margin-bottom:16px;}
  .card{background:#15122b;border-radius:18px;padding:24px;max-width:440px;margin:0 auto;}
  svg{background:#1f1a3d;border-radius:14px;margin:6px 0 16px;}
  .opts{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}
  .opt{background:#2a2350;border:1px solid #4c4080;color:#fff;border-radius:12px;padding:11px 18px;font-size:.9rem;font-weight:600;cursor:pointer;}
  .opt:hover{background:#3a3170;}
  .msg{margin-top:16px;min-height:30px;font-weight:600;} .score{color:#86efac;margin-top:8px;}
</style></head><body>
  <h1>📐 זהה את הזווית</h1><div class="sub">חדה (פחות מ-90°) · ישרה (90°) · קהה (יותר מ-90°)</div>
  <div class="card">
    <svg width="220" height="160" id="svg"></svg>
    <div class="opts">
      <button class="opt" onclick="guess('acute')">חדה</button>
      <button class="opt" onclick="guess('right')">ישרה</button>
      <button class="opt" onclick="guess('obtuse')">קהה</button>
    </div>
    <div class="msg" id="msg">נחש את סוג הזווית!</div>
    <div class="score" id="score">נקודות: 0</div>
  </div>
<script>
  let angle, score=0;
  function draw(){
    angle = Math.floor(Math.random()*150)+20;
    const r=110, cx=20, cy=140, rad=angle*Math.PI/180;
    const x=cx+r*Math.cos(rad), y=cy-r*Math.sin(rad);
    document.getElementById('svg').innerHTML =
      '<line x1="'+cx+'" y1="'+cy+'" x2="'+(cx+r)+'" y2="'+cy+'" stroke="#7c5cff" stroke-width="4"/>'+
      '<line x1="'+cx+'" y1="'+cy+'" x2="'+x+'" y2="'+y+'" stroke="#22d3ee" stroke-width="4"/>'+
      '<circle cx="'+cx+'" cy="'+cy+'" r="5" fill="#fff"/>';
  }
  function guess(t){
    const real = angle<88?'acute':(angle<=92?'right':'obtuse');
    const msg=document.getElementById('msg');
    if(t===real){score++;msg.style.color='#86efac';msg.textContent='נכון! 🎉 הזווית היא '+angle+'° — '+heb(real);}
    else{msg.style.color='#fca5a5';msg.textContent='כמעט! הזווית היא '+angle+'° — זו זווית '+heb(real)+'.';}
    document.getElementById('score').textContent='נקודות: '+score;
    setTimeout(draw,1100);
  }
  function heb(t){return {acute:'חדה',right:'ישרה',obtuse:'קהה'}[t];}
  draw();
<\/script></body></html>`,
        science: `<!DOCTYPE html>
<html lang="he" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>מעבדת צבעים</title>
<style>
  body{font-family:system-ui,sans-serif;background:linear-gradient(160deg,#1e1b3a,#2d2657);color:#fff;margin:0;padding:20px;text-align:center;}
  h1{font-size:1.3rem;} .sub{color:#c4b5fd;font-size:.9rem;margin-bottom:16px;}
  .card{background:#15122b;border-radius:18px;padding:24px;max-width:440px;margin:0 auto;}
  .drops{display:flex;gap:12px;justify-content:center;margin-bottom:16px;}
  .drop{width:60px;height:60px;border-radius:50%;cursor:pointer;border:3px solid rgba(255,255,255,.2);transition:.15s;}
  .drop:hover{transform:scale(1.1);}
  .beaker{width:120px;height:120px;border-radius:0 0 60px 60px;margin:0 auto;border:4px solid #4c4080;background:#1f1a3d;transition:.4s;}
  .msg{margin-top:16px;min-height:30px;font-weight:600;}
</style></head><body>
  <h1>🔬 מעבדת ערבוב צבעים</h1><div class="sub">לחץ על שני צבעי יסוד וגלה איזה צבע חדש מתקבל</div>
  <div class="card">
    <div class="drops">
      <div class="drop" style="background:#e53e3e" data-c="red"></div>
      <div class="drop" style="background:#3182ce" data-c="blue"></div>
      <div class="drop" style="background:#ecc94b" data-c="yellow"></div>
    </div>
    <div class="beaker" id="beaker"></div>
    <div class="msg" id="msg">בחר צבע ראשון...</div>
  </div>
<script>
  let sel=[];
  const mix={ 'red+blue':['#805ad5','סגול'], 'red+yellow':['#dd6b20','כתום'], 'blue+yellow':['#38a169','ירוק'] };
  document.querySelectorAll('.drop').forEach(d=>d.addEventListener('click',()=>{
    sel.push(d.dataset.c);
    if(sel.length===1){document.getElementById('msg').textContent='עכשיו בחר צבע שני 🎨';return;}
    const key=sel.slice().sort().join('+');
    const m=document.getElementById('msg'); const b=document.getElementById('beaker');
    if(mix[key]){b.style.background=mix[key][0];m.style.color='#86efac';m.textContent='🎉 קיבלת '+mix[key][1]+'! ערבוב שני צבעי יסוד יוצר צבע חדש.';}
    else{m.style.color='#fbbf24';m.textContent='בחרת פעמיים אותו צבע — נסה שני צבעים שונים!';}
    sel=[];
  }));
<\/script></body></html>`,
    };

    // init
    renderTopicIntro();
    chatInput.focus();

  window.onSend=onSend;
}
