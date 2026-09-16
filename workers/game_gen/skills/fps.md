# YuviFPS — first-person shooters (only with YuviWorld3D)

Use when the brief says shooter / FPS / "guns" / "enemies that shoot back". `YuviFPS` is a classic script injected after
`yuvi_world3d.js`; every world already has **`W.fps`**. It gives you AAA-feel from primitives: stylised **blasters** that fire
glowing bolts and paint (kid-safe: enemies *power down* and dissolve — no blood, tension not horror), a viewmodel rig with FOV
separation, sway, bob, spring recoil, reload keyframes, ADS (right mouse / `KeyF`), weapon switch (`1..9`, wheel, `KeyQ`),
crosshair with live spread, hit markers, damage direction, low-health vignette, muzzle flash, shells, tracers, paint splats;
enemies with a real FSM (patrol → alert → engage bursts / cover-peek → search / retreat), six archetypes, squads, player hp/armor
on the kit HUD, pickups and objectives. Build everything before `YuviKit.init`; `W.run()` already steps `W.fps.update` (it is
registered in the world's animated list). Fire = left mouse (also `YuviKit.input.on('fire')` and a held `fireKey`, default `KeyJ`,
for touch buttons), reload `KeyR`. Never draw your own HUD: give `YuviKit.init` hud ids `hp`, `armor`, `ammo` and the module fills them.

## API

| Call | Args | Returns |
|---|---|---|
| `W.fps.weapon(kind, o)` | kinds `blaster` (pistol, bolts) `pulseRifle` (auto) `scatterGun` (8 pellets) `smg` `railGun` (charge, 70 dmg) `launcher` (arc + splash) `beam` (continuous); `o = {seed, accent:'#7cf0ff', skin:'matte'\|'camo'\|'chrome'\|'neon', name, damage, rate, spread, mag, reserve, reloadS, range, speed, splash, auto}` — 3 visual variants per kind via `seed` | `w = {kind, group, config, sockets:{muzzle, eject, scope, grip}, parts:{mag, slide, bolt, pump, cell…}, mag, ammo, state:'idle'\|'firing'\|'charging'\|'reloading'\|'empty'\|'switching', fire(), reload(), canFire(), refill(n), update(dt)}` |
| `W.fps.arms(ctrl, o)` | `ctrl` from `W.player.fps()`; `o = {weapons:['blaster','pulseRifle','scatterGun'] (kinds or weapon objects, first is equipped), fov=55, fireKey='KeyJ', adsKey='KeyF', seed, style:{skin, accent}}` | `rig = {weapons, current, index, spread (deg), adsK (0..1), sprinting, stats:{shots, hits}, fire(), reload(), equip(i\|kind), next(±1), last(), ads(on), add(kind\|w), hitMarker(ko), overlay}` — the viewmodel renders after the world in its own camera; touch: map kit buttons to ids `fire`, `reload`, `ads`, `switch` |
| `W.fps.player(ctrl, o)` | `o = {hp=100, armor=0, maxArmor=100, regen=0 (hp/s after 5 s calm), onDamage(n, p), onDead(p), deadText}` — without `onDead` the kit's game-over screen shows | `p = {hp, armor, maxHp, dead, kills, damage(n, from), heal(n), addArmor(n), pickup(kind, amount), respawn(pos), update(dt)}` — shake, vignette, direction wedge, `hurt` sound, HUD ids `hp` / `armor` |
| `W.fps.soldier(o)` | `o = {arch:'grunt'\|'heavy'\|'sniper'\|'drone'\|'turret'\|'boss', pos:[x,0,z], waypoints:[[x,0,z]…], weapon (kind), accent, seed, hp, speed, sight, fov, range:[min,max], reaction=.5 (s before the first shot), hunt=6 (s of patrol without seeing the player before walking toward them; `false` = pure patrol), accuracy=1, damage, character:{role, hat, top…} (→ `props.character`, `role:'soldier'` = guard + gear), drop=auto (pickup on power-down), cover=true / retreat=true (false pins a scripted enemy in place), onSee(s), onShoot(s), onHurt(s, n), onDown(s), onPhase(s, n) (boss)}` | `s = {arch, mesh (character), pos, state:'patrol'\|'alert'\|'engage'\|'cover'\|'search'\|'retreat'\|'down', hp, maxHp, alive, sees, awareness, weapon, takeDamage(n, point), powerDown(), kill(), setState(s)}` — also listed in `W.enemies` (minimap, `W.projectiles` targets) |
| `W.fps.squad(n, o)` | `o = {arch: kind \| [kinds…] (cycled), area: r \| [cx, cz, r], waypoints?, seed, …soldier options}` — a patrol group around an area with a shared route | `soldier[]` |
| `W.fps.pickups.spawn(kind, pos, o)` | `kind:'ammo'\|'health'\|'armor'\|'weapon'`; `o = {amount, weapon:'railGun'}` — spinning, glowing, magnet pull, `pickup` sound | `{kind, mesh, remove()}`; `pickups.list`, `pickups.clear()` |
| `W.fps.objectives` | `.add(text, {id, count, onDone})`, `.progress(id, n=1)`, `.complete(id)`, `.text()`, `.current`, `.onAll = fn`, `.clear()` — renders through `W.objective` ("text 2/6") | objective objects |
| `W.fps.setDifficulty('easy'\|'normal'\|'hard')` | scales enemy damage, aim error, burst pauses and player damage | `W.fps` |
| `W.fps.fx.splat(point, normal, color) / sparks(point, color, n) / tracer(a, b, color) / splash(point, r, dmg, color)` | manual effects (pooled) | — |
| `W.fps.update(dt)` | already run by `W.update` / `W.run()` — call only with your own loop | — |
| `W.fps.rig` / `W.fps.hero` / `W.fps.soldiers` / `W.fps.kinds` / `W.fps.archetypes` | the rig and player once created, live soldiers, weapon kinds, archetypes | — |

## Canonical usage — night compound, three weapons, a squad that shoots back, pickups, an objective, a learning hook

```html
<script type="module">
import * as THREE from '<the exact Three.js URL from the allow-list>';
const W = YuviWorld3D.world(THREE, { preset: 'night', seed: 21, size: 110, ambient: 'rain', fog: { near: 18, far: 70 } });
const dec = W.decorate({ density: .8, seed: 4 });                                  // lamps, crates, barriers = cover for both sides
const crates = W.props.scatter('crate', 14, { area: [0, -18, 14, 8], seed: 2 });
const ctrl = W.player.fps({ speed: 6.5, sprint: 1.7, pos: [0, 0, 14] }).collide(dec).collide(crates);
const rig = W.fps.arms(ctrl, { weapons: ['pulseRifle', 'blaster', 'scatterGun'], style: { skin: 'neon', accent: '#7cf0ff' } });
const hero = W.fps.player(ctrl, { hp: 100, armor: 25, regen: 3, onDead: () => YuviKit.screens.gameOver({ reason: 'הסוללה נגמרה — נסו שוב' }) });
const goal = W.fps.objectives.add('כבו את 6 השומרים', { id: 'guards', count: 6 });
W.fps.objectives.onAll = () => YuviKit.screens.win({ score: YuviKit.hud.get('score') });
const squad = W.fps.squad(6, { arch: ['grunt', 'grunt', 'heavy', 'sniper', 'drone', 'turret'], area: [0, -22, 12], seed: 7,
  onSee: () => YuviKit.screens.message('ראו אותך!', 700),
  onDown: async s => {                                                            // the learning hook: a question buys the next pickup
    YuviKit.hud.add('score', 10); W.fps.objectives.progress('guards');
    const q = await YuviUI.ask({ text: 'משקל ברוטו 12 ק"ג, אריזה 2 ק"ג. נטו?', answers: ['10', '12', '14'], correct: 0 });   // YuviUI when the game has it; else YuviLearn.mount
    if (q.correct) W.fps.pickups.spawn('armor', s.pos); else W.fps.pickups.spawn('ammo', s.pos);
  } });
W.fps.pickups.spawn('health', [6, 0, 8]); W.fps.pickups.spawn('weapon', [-6, 0, 6], { weapon: 'railGun' });
W.minimap(null, {});
YuviKit.init({
  title: 'מתחם הלילה', subtitle: 'כבו את השומרים — הם יורים בחזרה', palette: ['#0b1030', '#7cf0ff'],
  controls: [{ keys: 'WASD', does: 'תנועה' }, { keys: 'עכבר', does: 'כיוון וירי' }, { keys: 'Shift / C', does: 'ריצה / התכופפות' }, { keys: 'R · 1 2 3 · F', does: 'טעינה · נשק · כיוון מדויק' }],
  hud: [{ id: 'hp', label: 'חיים', value: 100 }, { id: 'armor', label: 'מגן', value: 25 }, { id: 'ammo', label: 'תחמושת', value: '' }, { id: 'score', label: 'ניקוד', value: 0 }],
  sounds: { shoot: 'pew', hurt: 'buzz', pickup: 'coin' }, music: { bpm: 96, notes: ['C3', 0, 'G3', 0, 'Eb3', 0, 'Bb2', 0] },
  touch: { joystick: true, buttons: [{ id: 'fire', label: '🔥', key: 'KeyJ' }, { id: 'reload', label: '⟳', key: 'KeyR' }, { id: 'ads', label: '◎', key: 'KeyF' }] },
  onStart: () => { ctrl.requestLook(); W.fps.setDifficulty('normal'); }
});
W.run();                                                                            // W.update steps fps: weapons, enemies, bolts, pickups, HUD
</script>
```

## WRONG → RIGHT

| Wrong | Right |
|---|---|
| a box on a stick as the gun, `W.projectiles` spheres as bullets | `W.fps.arms(ctrl, {weapons})` — real viewmodels with recoil, reload, muzzle flash, shells, tracers, splats |
| enemies from `W.enemy` that only walk at the player | `W.fps.soldier` / `W.fps.squad` — they see, take cover, peek, burst-fire bolts that damage `W.fps.player` |
| your own `mousedown` listener that fires | the rig owns the trigger (mouse, kit `fire` action, `fireKey`); call `rig.fire()` only for scripted shots |
| an HTML top bar with hp / ammo | `hud: [{id:'hp'}, {id:'armor'}, {id:'ammo'}]` in `YuviKit.init` — the module fills them; crosshair / vignette / hit markers are already DOM |
| `soldier.mesh.position.set(...)` each frame, `hp` tracked in your own object | `soldier.takeDamage(n)`, `soldier.state`, `onDown`; movement is the FSM's |
| a red blood burst / bodies lying around | the default: sparks + the character powers down, shrinks into the ground, sometimes drops a pickup |
| game over inside `onDown` counting kills yourself | `W.fps.objectives.add(text, {count})` + `progress()`; `onAll` ends the game |
| `W.fps.update(dt)` in your own loop next to `W.run()` | `W.run()` alone — it already steps the module |
| every enemy a `boss` with `hp: 5000` | mostly `grunt`, one `heavy`, a `sniper` on a roof, a `drone` or `turret` for variety; `setDifficulty('easy')` for young kids |
| pointer lock at load / firing on the Start click | `ctrl.requestLook()` inside `onStart`; the rig ignores clicks on kit buttons and before Start |
| `onRetry` kills the squad with `s.kill()` — every `onDown` fires, the "all guards down" branch opens the question the moment the kid retries | `onRetry: () => { W.fps.reset(); level = 1; spawnWave(); }` — `reset()` removes soldiers silently (no callbacks, no drops), clears pickups and respawns the hero; `s.remove()` does it for one soldier |
