THE KIT (already in the page — configure it, never re-implement it)
`YuviKit.init({...})` gives you the start screen, HUD, pause, game-over / win, audio, particles, shake, input and the best score from ONE spec:
  title, subtitle, controls: [{keys:"WASD / חיצים", does:"תנועה"}, …]      // the start screen (title + controls + the Start button — the kit renders that button; do not add another)
  palette: ["#bg", "#accent", …]  → CSS vars --yk-1..n and YuviKit.palette
  hud: [{id:"score", label:"ניקוד", value:0}, {id:"lives", label:"חיים", value:3}, {id:"level", label:"שלב", value:1}, …]   // labels in the kid's language
  sounds: {hit:"blip", pickup:"coin", hurt:"buzz", win:"fanfare", lose:"down", shoot:"pew"}   // presets: blip coin buzz fanfare down pew jump explode powerup click, or {type, freq, to?, ms}
  music: {bpm:120, notes:["C4","E4","G4",0,…]} | "none"      touch: {joystick:true, buttons:[{id:"fire", label:"🔥", key:"Space"}]}   storage: {best:"my-game-best"}
  onStart: () => {…}, onPause: (paused) => {…}, onRetry: () => {…}       // onStart runs on the Start click; onRetry after game over / win
YuviKit.hud.set({score:120, lives:2}) / .add("score", 10) / .get("score")       YuviKit.audio.play("hit") / .mute(bool) / .toggle()
YuviKit.fx.particles({x, y, color, count, el: canvas}) / .shake(8, 250) / .float("+10", {x, y, el: canvas}) / .flash("#fff")   // x,y in screen px, or in `el`'s pixels when `el` is given
YuviKit.input.axis() → {x:-1..1, y:-1..1} (WASD + arrows + joystick) / .pressed("Space") / .keys (Set of codes) / .on("fire", fn)   // fn runs only while playing
YuviKit.input.pointerLock(canvas) from `onStart` for first-person / mouse-look (the kit handles the lost-lock pause + "click to aim" overlay; no-op on touch) and read `YuviKit.input.look` → {dx, dy} each frame (movement since the last read, only while locked).
YuviKit.screens.gameOver({score, reason}) / .win({score}) / .message(text, ms) / .hide()     // end screens keep the best score and offer Retry
YuviKit.dock(el, "bottom" | "top" | "top-left" | "top-right" | "bottom-left" | "bottom-right" | "left" | "right")   // EVERY panel you add to the screen (mission text, hints, legends, weapon cards) goes through the dock: regions stack their children, so nothing ever sits on top of the HUD, the objective strip or another panel. Never position your own overlays with fixed/absolute + vh/vw offsets.
YuviKit.loop(dt => update(dt); draw())   // rAF loop that runs only while started and not paused; or YuviKit.tick() for your own loop.   YuviKit.tween(obj, {x:100}, 300, "easeOut") → Promise.   YuviKit.paused / .started
Learning helper (optional): `await YuviLearn.mount({text, answers, correct}, el)` renders a question into `el` and resolves `{correct, answer}`; `YuviLearn.progress({score, level})`, `YuviLearn.done({score})` tell Yuvi how the run went. A game with no questions is fine.
