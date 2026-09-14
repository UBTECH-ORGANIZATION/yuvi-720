UI MODULE — `YuviUI` (opt-in: `NEEDS: ui`; already in the page after the kit)
Use it for EVERY question, dialogue line, timer, combo and level banner. Never build these panels by hand: hand-made prompts in Hebrew/Arabic flip math ("2:4" shows as "4:2", "3 × 4 = 12" reverses), leak the answer into the prompt, and let arrow/space keys reach the game while the kid types. YuviUI renders in the kid's language (`YuviKit.lang`), in the right direction (`YuviKit.dir`), with bidi-safe math, grades through `YuviLearn` (counters stay right), and blocks game keys while a panel is open.

| Call | Does | Returns |
|---|---|---|
| `YuviUI.math(parts)` | `parts` = string or array of `string` / `{ltr:"2:4"}` / `{text:"…"}`. Runs of digits, operators and Latin (`0-9 A-Z : + - × ÷ * / = < > ( ) . , %`) become `<bdi dir="ltr">`; plain strings are split automatically | `DocumentFragment` |
| `YuviUI.setText(el, parts)` | replaces `el`'s content with `math(parts)`, sets `dir` if missing | `el` |
| `YuviUI.ask({parts|text, kind, correct, …})` | question panel (bottom-centre overlay, or inside `el`). `kind`: `"number"` (default; 1 box, `inputmode=decimal`), `"text"`, `"choice"` (`answers:[…]`, `correct` = index or text, `shuffle:true` deterministic), `"ratio"` (two boxes `a : b`, LTR order; answer `"a:b"`; `reduce:true` accepts equivalent ratios), `"pair"` (two labelled numbers, `labels:["x","y"]`, answer `"a,b"`, `correct:"3,4"` or `[3,4]`). Options: `hint`, `placeholder`, `submitLabel`, `explain` (parts shown ~2 s on a wrong answer), `timeout` (seconds), `el`. Numbers grade tolerantly (`"12"`, `"12.0"`, `"12,0"`). Enter submits; wrong → shake + explain | `Promise<{correct, answer, elapsed}>` (+ `timedOut` / `cancelled`) |
| `YuviUI.dialogue(lines, {speaker?, ms?, el?})` | speech bubbles in sequence; each line is parts or `{speaker, parts|text}`; click / Enter / Space advances, `ms` auto-advances | `Promise` |
| `YuviUI.timer({seconds, onEnd, onTick?, hudId?})` | countdown; pauses with the kit; shows in the HUD item `hudId` (`m:ss`) or its own chip | `{start(), stop(), add(s), left}` |
| `YuviUI.combo({step?:3, max?:5})` | streak → multiplier; `hit()` floats "×2/×3…" via `YuviKit.fx.float` | `{hit(at?) → mult, miss(), value, mult}` |
| `YuviUI.banner(parts, ms?)` | level name / objective, centred, RTL-safe (default 1.8 s) | `Promise` |
| `YuviUI.hide()` | closes any open panel, banner, timer chip | — |
| `YuviUI.panel` / `.lang` / `.dir` / `.t` | the open panel element (or null); language, direction, strings (`submit`, `ok`, `bad`, `cont`) | — |

Rules: the prompt states the GIVENS only, never the answer (`"היחס הוא 2:4 — כמה זה מצומצם?"`, answer lives in `correct`). Every number, ratio or expression inside a sentence goes through `{ltr:"…"}` or a plain string that `math` splits. Use `YuviKit.paused`-aware game logic: pause your own spawning while `await YuviUI.ask(...)` is pending (the kit loop keeps running). One panel at a time: a new `ask`/`dialogue` cancels the previous one.

Canonical round (banner → ratio question → combo → timer):
```js
const combo = YuviUI.combo();
const timer = YuviUI.timer({ seconds: 60, hudId: 'time', onEnd: () => YuviKit.screens.gameOver({ reason: 'נגמר הזמן' }) });
async function round(level) {
  await YuviUI.banner(['שלב ', { ltr: String(level) }, ' — צמצום יחסים'], 1200);
  timer.start();
  const [a, b] = pick(level);                                   // e.g. [2, 4] — the givens
  const [ra, rb] = reduce(a, b);                                // the answer stays in code
  const r = await YuviUI.ask({
    parts: ['היחס במפעל הוא ', { ltr: `${a}:${b}` }, ' — כמה זה מצומצם?'],
    kind: 'ratio', correct: `${ra}:${rb}`, reduce: true,
    hint: 'חלקו את שני המספרים באותו מספר',
    explain: ['מחלקים ב-', { ltr: String(a / ra) }, ': ', { ltr: `${a}:${b} = ${ra}:${rb}` }],
    timeout: 20
  });
  if (r.correct) {
    const mult = combo.hit({ x: canvas.width / 2, y: 120, el: canvas });
    YuviKit.hud.add('score', 10 * mult);
    YuviKit.fx.particles({ x: canvas.width / 2, y: 120, el: canvas });
  } else {
    combo.miss();
    YuviKit.hud.add('lives', -1);
    if (YuviKit.hud.get('lives') <= 0) return YuviKit.screens.gameOver({ score: YuviKit.hud.get('score') });
  }
  if (level === 5) { timer.stop(); await YuviUI.dialogue([{ speaker: 'יובי', parts: ['סיימת! היחס האחרון היה ', { ltr: `${ra}:${rb}` }] }]); return YuviKit.screens.win({ score: YuviKit.hud.get('score') }); }
  return round(level + 1);
}
```

WRONG → RIGHT
| Wrong | Right |
|---|---|
| `box.innerHTML = 'היחס הוא 2:4'` (renders as 4:2 in RTL) | `YuviUI.setText(box, ['היחס הוא ', {ltr:'2:4'}])` or `YuviUI.ask({parts:[…]})` |
| `text: 'צמצמו 2:4 — התשובה היא 1:2'` (answer stated in the prompt) | prompt gives the givens only; `correct: '1:2', reduce: true` |
| `const a = prompt('כמה זה 3 × 4?')` / `alert('נכון!')` | `const r = await YuviUI.ask({text:'כמה זה 3 × 4?', correct: 12})` — feedback is built in |
| hand-made `<div class="overlay">` with a question, styles and buttons | `YuviUI.ask({kind:'choice', answers:[…], correct: 1})` |
| `<input type="number">` without `dir="ltr"` (caret and minus sign jump in RTL) | `ask` inputs are `dir="ltr"`, `inputmode="decimal"`, boxes in LTR order |
| arrows / space move the player while the kid types the answer | `ask` and `dialogue` stop keys at the document while open and clear held keys on close |
| `ctx.fillText('×3', …)` / `YuviKit.fx.float('×3')` shows "3×" | `combo.hit()` (isolated LTR float), `timer` (LTR `m:ss`), `banner` for level text |
| `setTimeout(() => gameOver(), 60000)` with a hand-drawn clock | `YuviUI.timer({seconds: 60, hudId: 'time', onEnd})` — pauses with the kit |
