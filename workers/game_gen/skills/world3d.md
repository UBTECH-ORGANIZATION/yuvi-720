# YuviWorld3D — 3D worlds (only when the game needs 3D)

Use when the brief says shooter, explore, adventure, race, first-/third-person, or "3D world". Otherwise stay 2D.
`YuviWorld3D` is a classic script already injected after YuviKit. It builds a lit low-poly world from a preset
(sky gradient, fog, hemisphere + one sun, rolling two-tone ground), instanced props from primitives, an FPS or
follow camera wired to `YuviKit.input`, patrol/chase enemies, pooled projectiles, 3D hit bursts, a minimap and an
objective strip. Materials are Lambert, props are `InstancedMesh`, no shadows unless asked, no post-processing:
the checker renders WebGL in software at 640×360 and fails a canvas that stays flat after Start.
You import Three.js yourself (module build, exact allow-listed URL) and pass the module in. No textures, no GLTF,
no other CDN. Build the WHOLE world synchronously before `YuviKit.init`; `onStart` only flips state.
Kit rules still hold: the kit owns Start/pause/HUD/end screens/audio; never add your own Start button.

## API

| Call | Args | Returns |
|---|---|---|
| `YuviWorld3D.world(THREE, o)` | `o = {preset, seed, size=120, palette?[6 hex], fog?:false|{near,far}, shadows?:false, el?}` presets: `desert forest space lab ocean city night` | `W` (below). Canvas is appended to body at 100%/100%; resize is automatic |
| `W.scene / camera / renderer / ground / sky / sun / hemi` | — | Three objects (camera far ≥ 400) |
| `W.palette` | — | 6 hex: `[ground, stone, foliage/accent, light, dark/wood, highlight]` |
| `W.rand()` | — | seeded PRNG in [0,1) — use it for every random decision |
| `W.add(obj) / W.remove(obj)` | Object3D | same obj |
| `W.props.scatter(kind, count, o)` | kinds `tree bush rock crate barrel building cactus pipe barrier lamp fence crystal actor`; `o = {area: r \| [cx,cz,hw,hd] \| {x,z,w,d}, seed, scale, avoid: [{x,z,r}], color?}` (centre 5 u always free) | `{kind, positions: [{x,y,z,r,s}], meshes, remove()}` — one InstancedMesh per part |
| `W.props.make(kind, o)` | `o = {scale, color (highlight part), colors: {roleIdx: hex}, pos, add=true}` | a single `Group` (use for the player avatar / enemies) |
| `W.player.fps(o)` | `o = {speed=6, jump=7, height=1.7, sprint=1.6, crouch=true, bob=.05, sway=true, gravity=22, bounds: n \| {minX,maxX,minZ,maxZ}, pos:[x,0,z], obstacles, sensitivity}` | `ctrl = {object (rig), camera, pos, vel, yaw, pitch, onGround, obstacles, update(dt), lookAt(v), enable(b), requestLook(), collide(handle\|positions), forward(), eye()}` — WASD/arrows + `YuviKit.input.axis()`, mouse look from `YuviKit.input.look`, Shift sprint, C/Ctrl crouch, Space jump, circle/AABB push-out |
| `W.player.thirdPerson(mesh, o)` | `o = {distance=7, height=3.5, lag=.12}` | `ctrl = {object (camera), target, pos, update(dt), enable(b), collide()}` — you move `mesh`; camera follows behind `mesh.rotation.y` |
| `W.enemy(mesh, o)` | `o = {waypoints: [[x,0,z]…], speed=3, sightRange=14, fov=120, target: () => pos (default: player), reach=1.3, reachEvery=1, loseTime=1.5, searchTime=2.5, cover: [[x,0,z]…], coverTime=2, onSee(e), onLose(e), onReach(e)}` | `e = {state: 'patrol'\|'detect'\|'chase'\|'cover'\|'search'\|'dead', pos, mesh, sees, update(dt), kill(), takeCover(), setState(s)}` |
| `W.projectiles(o)` | `o = {speed=30, gravity=9.8, life=3, radius=.15, pool=24, color, targets: () => [mesh \| enemy], onHit(target, point, data), onMiss(point, data)}` | `sys = {fire(from?, dir?, {speed, color, data}) → mesh, update(dt), count}` — `from`/`dir` default to the player's eye/forward |
| `W.fx.hit(point, o)` | `o = {color, count=14, spread=5, life=.55, size=.14}` | instanced 3D burst (max 240 live) |
| `W.fx.flashLight(ms=120, mul=3)` | — | brightens the hemisphere light briefly |
| `W.minimap(el, o)` | `el`: a canvas, a container, or `null` (a 20vmin canvas in the kit layer); `o = {scale (px per unit), markers: () => [{pos, color, r}], side, enemyColor, playerColor}` | `{el, update(), remove()}` — props, enemies, markers, player arrow |
| `W.objective(text)` | kid-language text; `''` hides | the strip element (direction from `YuviKit.dir`) |
| `W.raycast(from?, dir?, maxDist=200)` | Vector3 / `[x,y,z]` / `{x,y,z}`; defaults: player eye + forward | `{point, distance, object, instanceId, normal}` or `null` (sky, fx, projectiles are skipped) |
| `W.update(dt)` | seconds | steps player, enemies, projectiles, fx, minimap (props are static) |
| `W.render()` / `W.run()` | — | one frame / `YuviKit.loop(dt => { W.update(dt); W.render(); })` for you |
| `W.resize()` / `W.dispose()` | — | automatic on `resize`; dispose frees GPU memory and removes the canvas |
| `W.stats` | — | `{objects, drawCalls, triangles, enemies, props, fx}` |

## Canonical usage

```html
<script type="module">
import * as THREE from '<the exact Three.js URL from the allow-list>';
const W = YuviWorld3D.world(THREE, { preset: 'desert', seed: 42, size: 120 });
// world FIRST, all of it, before Start:
const cacti = W.props.scatter('cactus', 80, { area: 55 });
const rocks = W.props.scatter('rock', 40);
const crates = W.props.scatter('crate', 12, { area: 30 });
const ctrl = W.player.fps({ speed: 7, jump: 8, pos: [0, 0, 8] }).collide(cacti).collide(rocks).collide(crates);
const enemies = [];
for (let i = 0; i < 4; i++) {
  const bot = W.props.make('actor', { color: W.palette[5], pos: [W.rand() * 40 - 20, 0, -10 - i * 8] });
  enemies.push(W.enemy(bot, {
    waypoints: [[bot.position.x - 6, 0, bot.position.z], [bot.position.x + 6, 0, bot.position.z]],
    speed: 3, sightRange: 16,
    onSee: () => YuviKit.screens.message('ראו אותך!', 800),
    onReach: () => { YuviKit.hud.add('lives', -1); YuviKit.fx.shake(); YuviKit.audio.play('hurt'); if (YuviKit.hud.get('lives') <= 0) YuviKit.screens.gameOver(); }
  }));
}
const guns = W.projectiles({
  speed: 40, gravity: 6, targets: () => enemies,
  onHit: (e, p) => { e.kill(); W.fx.hit(p, { color: '#ffcc00', count: 24 }); YuviKit.audio.play('explode'); YuviKit.hud.add('score', 10);
    if (enemies.every(x => !x.alive)) YuviKit.screens.win(); }
});
W.minimap(null, { markers: () => enemies.filter(e => e.alive).map(e => ({ pos: e.pos, color: '#f55' })) });
W.objective('מצאו את 4 הרובוטים');
YuviKit.init({
  title: 'מדבר הרובוטים', subtitle: '…', palette: ['#1e1e2e', '#ffb347'],
  controls: [{ keys: 'WASD', does: 'תנועה' }, { keys: 'עכבר', does: 'כיוון' }, { keys: 'קליק / רווח', does: 'ירי' }],
  hud: [{ id: 'score', label: 'ניקוד', value: 0 }, { id: 'lives', label: 'חיים', value: 3 }],
  onStart: () => { ctrl.requestLook(); },            // pointer lock: only here, inside the click
  onRetry: () => { /* reset state; the world already exists */ }
});
YuviKit.input.on('Space', () => { guns.fire(); YuviKit.audio.play('shoot'); });
W.renderer.domElement.addEventListener('pointerdown', () => { if (YuviKit.started && !YuviKit.paused) guns.fire(); });
W.run();                                                // = YuviKit.loop(dt => { W.update(dt); W.render(); })
</script>
```

## WRONG → RIGHT

| Wrong | Right |
|---|---|
| `for (…) scene.add(new THREE.Mesh(coneGeo, mat))` per tree | `W.props.scatter('tree', 80)` — one InstancedMesh per part |
| `YuviKit.input.pointerLock(canvas)` at load / in the module body | `ctrl.requestLook()` inside `onStart` (a click) — locks at load are refused |
| building the scene inside `onStart` | build everything in the module body; `onStart` only flips state — the first frame after Start is checked |
| own `resize` handler setting `camera.aspect` | nothing — `W.resize()` runs on `resize`; camera and canvas follow the frame |
| `TextureLoader` / `GLTFLoader` / `OrbitControls` imports | primitives + `W.palette`; only the Three.js core module URL is reachable |
| `new THREE.Vector3()` / `new THREE.Color()` every frame | reuse module-level vectors; `W.update` allocates nothing |
| black sky, no lights, `MeshStandardMaterial` everywhere | the preset lights + Lambert; pick `night`/`space` for dark moods (they still light the ground) |
| a second Start / "click to play" overlay of your own | the kit's Start screen; put the story in `subtitle`, keys in `controls` |
| `requestAnimationFrame(loop)` of your own + `renderer.render` | `W.run()` (or `YuviKit.loop(dt => { W.update(dt); W.render(); })`) — pauses with the kit |
| enemies teleport / hit test with `Box3.setFromObject` each frame | `W.enemy` FSM + `W.projectiles({targets})` (cached bounding spheres) |
| `shadows: true` with many lights | at most the preset sun; shadows only for a small world (≤ 60 units) |
| HUD text drawn in 3D (sprites, TextGeometry) | `YuviKit.hud`, `W.objective(text)`, `YuviKit.screens.message` |
