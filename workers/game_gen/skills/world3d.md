# YuviWorld3D — 3D worlds (only when the game needs 3D)

Use when the brief says shooter, explore, adventure, race, first-/third-person, or "3D world". Otherwise stay 2D.
`YuviWorld3D` is a classic script already injected after YuviKit. One call builds a designed **biome**: sky gradient with a
sun/moon disc (stars at night), fog, hemisphere + one sun, a terrain with hills (`W.groundY`), optional water, a backdrop ring
of mountains/skyline, drifting clouds, weather particles, birds/fish. `W.decorate()` lays the scene out (clearing, landmark,
path, clusters, edge wall). `W.props.character()` builds humans / robots / animals with faces, clothes and limb animation;
`W.player.avatar()` moves one with a follow camera. Plus an FPS rig, patrol/chase enemies, pooled projectiles, hit bursts, a
minimap and an objective strip. Everything is primitives + Lambert + `InstancedMesh`, built synchronously: the checker renders
WebGL in software at 640×360 and fails a canvas that stays flat after Start. No textures, no GLTF, no other CDN.
You import Three.js yourself (module build, exact allow-listed URL) and pass the module in. Build the WHOLE world before
`YuviKit.init`; `onStart` only flips state. Kit rules hold: the kit owns Start/pause/HUD/end screens/audio.

## Biomes — a starting point, override any field

`desert forest space lab ocean city night snow jungle volcano ruins farm`. Pick the one that fits the brief (pirates → `ocean`, a lab escape → `lab`, a night rescue → `night`), then vary `seed`, `palette`, `terrain`, `water`, `ambient`,
`clouds`, `backdrop` — two games on the same biome must not look the same. `ocean` is an island with a beach and water;
`volcano` has lava pools (water in a lava colour) and embers; `night`/`space` are dark: windows, lamps and campfires glow.

## API

| Call | Args | Returns |
|---|---|---|
| `YuviWorld3D.world(THREE, o)` | `o = {preset, seed, size=120, palette?[6 hex], fog?:false\|{near,far}, shadows?:false, terrain?:{hills:0..1, amplitude, island}, water?:{level, color, waves}\|false, backdrop?:'mountain'\|'skyline'\|'dunes'\|'rock'\|false, clouds?:n, ambient?:'dust'\|'snow'\|'rain'\|'fireflies'\|'embers'\|false, birds?:n, fish?:n, el?}` | `W`. Canvas appended to body at 100%/100%; resize automatic |
| `W.groundY(x, z)` | — | terrain height; controllers, enemies, props, projectiles already use it |
| `W.decorate(o)` | `o = {density=1, seed, landmark=true, edge=true}` — the biome's layout: centre 9 u free, a landmark (`dec.landmark`, a `Group`), a path from the spawn to it, clusters, scatter, an edge wall; counts scale with `density` and world area | `dec = {sets, positions (solid props → `ctrl.collide(dec)`), landmark, path, remove()}` — you can still scatter your own on top |
| `W.props.character(o)` | `o = {kind:'human'\|'robot'\|'animal', role:'hero'\|'villager'\|'guard'\|'scientist'\|'pirate'\|'astronaut'\|'farmer'\|'kid', animal:'dog'\|'cat'\|'horse'\|'bird'\|'crab'\|'fish'\|'sheep', seed, size, pos, skin, hair, hairStyle, top, bottom, shoes, hat:'none'\|'cap'\|'helmet'\|'hat'\|'crown', hatColor, accessory:'none'\|'backpack'\|'glasses'\|'scarf', style (robot: 'biped'\|'wheel'\|'tread'), colors:{…}, add=true}` — role sets clothes/hat/accessory defaults, `seed` picks body type, height, head shape, skin, hair; animals have their own bodies and gaits | `char` (`Group`, faces +z) with `char.parts = {body, head, face:{eyes, brows, mouth}, hair, torso, armL, armR, legL, legR, hat, accessory, tail…}` and `char.anim = {walk(dt, speed), run(dt), idle(dt), wave(), jump(), hit(), die(), talk(on), update(dt)}` — automatic under `player.avatar` and `W.enemy` |
| `W.props.actor(o)` | same as `character({role:'villager', …o})` | a simple human |
| `W.props.scatter(kind, count, o)` | kinds `tree(variant: pine\|round\|palm) bush grass flower rock crate barrel building tower column stall boat sign campfire streetlight cactus pipe barrier lamp fence crystal path actor`; `o = {area: r \| [cx,cz,hw,hd] \| {x,z,w,d}, seed, scale, variant, avoid: [{x,z,r}], color?, colors:{roleIdx: hex}, lights=3}` (centre 5 u always free; props sit on the terrain, `boat` floats, nothing spawns under water) | `{kind, positions: [{x,y,z,r,s}], meshes, remove()}` — one InstancedMesh per part; `campfire`/`streetlight`/`lamp` add a few point lights (10 max per world) |
| `W.props.place(kind, positions, o)` | `positions: [[x,z] \| {x,z,s,rot}]` — explicit spots (a row, a ring, a road) | same handle |
| `W.props.make(kind, o)` | `o = {scale, variant, color, colors, pos (snaps to the ground), add=true}` | a single `Group` |
| `W.player.avatar(char, o)` | `o = {speed=6, run=1.6 (Shift), jump=7, gravity=22, camera:'follow'\|'shoulder'\|'iso'\|'top', distance, height, lag=.12, turn=10, bounds, obstacles, pos, sensitivity}` — WASD/arrows/joystick relative to the camera, turns toward the movement, jumps on Space, follows the terrain, drives `char.anim`; mouse look orbits `follow`/`shoulder` after `ctrl.requestLook()` | `ctrl = {object, pos, vel, yaw, camYaw, onGround, moving, running, update(dt), enable(b), collide(handle\|dec\|positions), teleport(v), lookAt(v), requestLook(), forward(), eye()}` |
| `W.player.fps(o)` | `o = {speed=6, jump=7, height=1.7, sprint=1.6, crouch=true, bob=.05, sway=true, gravity=22, bounds, pos:[x,0,z], obstacles, sensitivity}` | `ctrl = {object (rig), camera, pos, vel, yaw, pitch, onGround, update(dt), lookAt(v), enable(b), requestLook(), collide(), teleport(v), forward(), eye()}` — mouse look from `YuviKit.input.look`, Shift sprint, C crouch, Space jump |
| `W.player.thirdPerson(mesh, o)` | `o = {distance=7, height=3.5, lag=.12}` — camera only, YOU move `mesh`; for a visible hero use `avatar` | `ctrl = {object (camera), target, pos, update(dt), enable(b), collide()}` |
| `W.enemy(mesh, o)` | `o = {waypoints: [[x,0,z]…], speed=3, sightRange=14, fov=120, target: () => pos (default: player), reach=1.3, reachEvery=1, loseTime=1.5, searchTime=2.5, cover: [[x,0,z]…], coverTime=2, fly, hover, onSee(e), onLose(e), onReach(e)}` — a `character` walks/runs with animation and falls on `kill()` | `e = {state: 'patrol'\|'detect'\|'chase'\|'cover'\|'search'\|'dead', pos, mesh, sees, update(dt), kill(), takeCover(), setState(s)}` |
| `W.projectiles(o)` | `o = {speed=30, gravity=9.8, life=3, radius=.15, pool=24, color, targets: () => [mesh \| enemy], onHit(target, point, data), onMiss(point, data)}` | `sys = {fire(from?, dir?, {speed, color, data}) → mesh, update(dt), count}` — defaults: the player's eye/forward |
| `W.fx.hit(point, o)` / `W.fx.flashLight(ms=120, mul=3)` | `o = {color, count=14, spread=5, life=.55, size=.14}` | instanced 3D burst (max 240 live) / brief hemisphere flash |
| `W.minimap(el, o)` | `el`: a canvas, a container, or `null`; `o = {scale, markers: () => [{pos, color, r}], side, enemyColor, playerColor}` | `{el, update(), remove()}` — props, enemies, markers, player arrow |
| `W.objective(text)` | kid-language text; `''` hides | the strip element (direction from `YuviKit.dir`) |
| `W.raycast(from?, dir?, maxDist=200)` | defaults: player eye + forward | `{point, distance, object, instanceId, normal}` or `null` |
| `W.update(dt)` / `W.render()` / `W.run()` | — | step player, enemies, projectiles, water, clouds, weather, flocks, fx, minimap / one frame / `YuviKit.loop(dt => { W.update(dt); W.render(); })` |
| `W.scene / camera / renderer / ground / water / sky / sun / hemi / lights / palette / biome / rand() / add(o) / remove(o) / resize() / dispose() / stats` | — | Three objects; `palette` = 6 hex `[ground, stone, foliage/accent, light, dark/wood, highlight]`; `rand()` seeded — use it for every random decision |

## Canonical usage

```html
<script type="module">
import * as THREE from '<the exact Three.js URL from the allow-list>';
const W = YuviWorld3D.world(THREE, { preset: 'ocean', seed: 42, size: 120, terrain: { hills: .4 }, ambient: 'dust', birds: 5 });
const dec = W.decorate({ density: 1, seed: 7 });                       // beach, palms, boats, a lighthouse landmark + path
const chests = W.props.scatter('crate', 8, { area: 40, avoid: [{ x: dec.landmark.position.x, z: dec.landmark.position.z, r: 6 }] });
const hero = W.props.character({ role: 'kid', seed: 3, hat: 'cap', top: '#ffd23f', pos: [0, 0, 5] });
const ctrl = W.player.avatar(hero, { camera: 'follow', speed: 7, jump: 8 }).collide(dec).collide(chests);
const enemies = [];
for (let i = 0; i < 3; i++) {
  const pirate = W.props.character({ role: 'pirate', seed: 10 + i, pos: [W.rand() * 40 - 20, 0, -14 - i * 8] });
  enemies.push(W.enemy(pirate, {
    waypoints: [[pirate.position.x - 6, 0, pirate.position.z], [pirate.position.x + 6, 0, pirate.position.z]],
    speed: 3, sightRange: 14,
    onSee: () => YuviKit.screens.message('ראו אותך!', 800),
    onReach: () => { YuviKit.hud.add('lives', -1); YuviKit.fx.shake(); hero.anim.hit(); YuviKit.audio.play('hurt'); if (YuviKit.hud.get('lives') <= 0) YuviKit.screens.gameOver(); }
  }));
}
const dog = W.props.character({ animal: 'dog', seed: 2, pos: [3, 0, 4] });
W.enemy(dog, { waypoints: [[3, 0, 4], [-4, 0, 8]], speed: 2.5, target: () => hero, reach: 1.2, onReach: () => dog.anim.wave() });   // a companion: same FSM, never hurts
const shells = W.projectiles({
  speed: 32, gravity: 6, targets: () => enemies,
  onHit: (e, p) => { e.kill(); W.fx.hit(p, { color: '#ffcc00', count: 24 }); YuviKit.audio.play('explode'); YuviKit.hud.add('score', 10);
    if (enemies.every(x => !x.alive)) YuviKit.screens.win(); }
});
W.minimap(null, { markers: () => [{ pos: dec.landmark.position, color: '#ffd23f', r: 4 }] });
W.objective('הגיעו למגדלור — 3 פיראטים בדרך');
YuviKit.init({
  title: 'אי הפיראטים', subtitle: '…', palette: ['#12405a', '#ffb347'],
  controls: [{ keys: 'WASD / חיצים', does: 'תנועה' }, { keys: 'Shift', does: 'ריצה' }, { keys: 'רווח', does: 'קפיצה' }, { keys: 'קליק', does: 'ירי' }],
  hud: [{ id: 'score', label: 'ניקוד', value: 0 }, { id: 'lives', label: 'חיים', value: 3 }],
  onStart: () => { ctrl.requestLook(); hero.anim.wave(); },     // pointer lock only here (a click); on touch it is a no-op
  onRetry: () => { ctrl.teleport([0, 0, 5]); /* reset state; the world already exists */ }
});
W.renderer.domElement.addEventListener('pointerdown', () => { if (YuviKit.started && !YuviKit.paused) { shells.fire(ctrl.eye(), ctrl.forward()); YuviKit.audio.play('shoot'); } });
W.run();                                                // = YuviKit.loop(dt => { W.update(dt); W.render(); })
</script>
```

## WRONG → RIGHT

| Wrong | Right |
|---|---|
| every character is `props.make('actor')` (the same capsule with a ball head) | `props.character({role, seed})` — a hero, villagers, guards, pirates, robots, a dog; vary `seed`, `hat`, `top`; `actor` is only a stand-in |
| moving the mesh yourself with `thirdPerson` (it slides, no legs move) | `player.avatar(char, {camera:'follow'})` — camera-relative movement, turning, jumping, terrain, walk/run/idle animation |
| a flat plane and a blue sky is the world | `decorate()` + `terrain`/`water`/`backdrop`/`clouds`/`ambient`/`birds` — the biome already has a sun, mountains, weather |
| the same preset every game / the defaults untouched | pick the biome that fits the brief; change `seed`, `palette`, `terrain.hills`, `ambient`, `clouds`; add props of your own on top of `decorate()` |
| `for (…) scene.add(new THREE.Mesh(coneGeo, mat))` per tree | `W.props.scatter('tree', 80, {variant:'round'})` — one InstancedMesh per part |
| a still crowd: NPCs standing frozen | `W.enemy(npc, {waypoints, target: () => hero, reach})` walks them with animation; `npc.anim.talk(true)` while a dialogue shows |
| `YuviKit.input.pointerLock(canvas)` at load | `ctrl.requestLook()` inside `onStart` (a click) |
| building the scene inside `onStart` | build everything in the module body; `onStart` only flips state — the first frame after Start is checked |
| `TextureLoader` / `GLTFLoader` / `OrbitControls` imports | primitives + `W.palette`; only the Three.js core module URL is reachable |
| `new THREE.Vector3()` / `new THREE.Color()` every frame | reuse module-level vectors; `W.update` allocates nothing |
| black sky, no lights, `MeshStandardMaterial` everywhere | the biome lights + Lambert; `night`/`space`/`volcano` are dark by design and still light the ground |
| your own `requestAnimationFrame` loop | `W.run()` — pauses with the kit |
| enemies teleport / hit test with `Box3.setFromObject` each frame | `W.enemy` FSM + `W.projectiles({targets})` (cached bounding spheres) |
| `shadows: true` with many lights / `size` 300 | at most the biome sun; shadows only for a small world (≤ 60 units); `size` 80–160 |
| HUD text drawn in 3D (sprites, TextGeometry) | `YuviKit.hud`, `W.objective(text)`, `YuviKit.screens.message` |
