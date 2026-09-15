## Materials & textures

Surfaces are generated, never loaded: `W.textures` paints seeded, tileable canvas textures and `W.materials` builds shader presets on the core's Lambert/Phong, so lights, fog and instancing keep working. Everything is cached per world and made on first use — a prop stays a flat colour until you ask for a texture. Use a texture where flat colour reads as unfinished (floors, walls, crates, machines) and a preset where the game needs a *state* (shield up, enemy dissolving, lava that glows). Animated presets tick from `W.update`.

| Call | Args | Returns |
|---|---|---|
| texture names | `metal metalDark metalBrushed rust concrete concreteDark brick brickRed wood woodDark plank sand grass dirt gravel asphalt tile plaster camo camoDesert panel panelLit hazard grid fabric leather bark leaves snow lava water scales canvas` — `panelLit`/`lava` glow, most carry a bump map | — |
| `props.scatter/place/make(kind, n, {texture, textures})` | `texture: name` textures every lit part; `textures: {roleIdx: name}` per palette role; a `props.define` part takes `t: name` | the usual handle |
| `W.textures.get(name, o)` | `o = {seed (world seed), size: 256\|512, colors: [hex…] (recipe palette, positional), repeat: [x, y] \| n}` | `THREE.Texture` (repeat, sRGB) |
| `W.textures.maps(name, o)` | same | `{map, bumpMap?, bumpScale?, emissiveMap?, emissive?}` for your own material |
| `W.textures.set(name, src)` | `src = {recipe: 'panelLit', colors: ['#3a4a6a', '#20242a', '#ff9f1c'], seed}` — a recoloured variant under a new name, usable as `texture: name` anywhere; or a `THREE.Texture` / `{map…}` | — |
| `W.materials.make(preset, o)` | presets `metal rust concrete wood brick glass hologram forcefield lava neon toon dissolve crystal water chrome` (or a texture name → Lambert with it). `o = {color, texture: name\|false, repeat, seed, colors, opacity, side: 'double', flat, intensity}` + `glass {rim}`, `hologram {lines}`, `forcefield {scale}`, `lava {glow, hot, speed}`, `neon {pulse, rate}`, `toon {steps: 3}`, `dissolve {edge, width, progress}`, `crystal {glow}`, `water {highlight, speed}`, `chrome {mix}` | `THREE.Material`; shader presets expose `mat.userData.uniforms` (`progress`, `color`, `intensity`, shared `time`); `forcefield` has `mat.userData.hit(point)` |
| `W.materials.apply(obj, preset\|material, {recursive=true})` | a character, a `props.make` group, an InstancedMesh | the material |
| `W.materials.outline(obj, {color='#0b0d12', thickness=.025})` | cel outline (inverted hull) under every mesh, InstancedMesh included | `{meshes, remove()}` |
| `W.materials.ground(name \| o)` | `o = {texture, repeat (size/4), tint, blend: [name2, 'slope'\|'height'] (rock on steep slopes, snow above a height; `{texture, mask, lo, hi}` for thresholds), triplanar: true (no stretching on cliffs)}` | the ground material |

```js
const W = YuviWorld3D.world(THREE, { preset: 'lab', seed: 12, size: 100 });
W.materials.ground({ texture: 'concreteDark', blend: ['gravel', 'slope'] });
W.textures.set('labPanel', { recipe: 'panelLit', colors: ['#5b6675', '#20242a', '#22d3ee'] });   // the lab's own panel look
const walls = W.props.scatter('barrier', 24, { area: 40, texture: 'labPanel' });
const crates = W.props.scatter('crate', 10, { area: 30, textures: { 2: 'plank', 5: 'hazard' }, colors: { 2: '#ffffff' } });
W.props.define('reactor', { r: 1.5, jit: [1, 1], parts: [{ g: 'cyl', a: [1.2, 1.4, 2.2, 12], p: [0, 1.1, 0], c: 1, t: 'metalBrushed' }, { g: 'box', a: [.6, .3, .6], p: [0, 2.35, 0], c: 5, t: 'panelLit' }] });
const reactor = W.props.make('reactor', { pos: [0, 0, -12] });
const core = new THREE.Mesh(new THREE.SphereGeometry(.8, 16, 12), W.materials.make('lava', { intensity: 1.4 }));
core.position.set(0, 2.9, -12); W.add(core);
const shield = new THREE.Mesh(new THREE.SphereGeometry(2.6, 24, 16), W.materials.make('forcefield', { color: '#4fc3ff' }));
shield.position.set(0, 1.6, -12); W.add(shield);
const guide = W.props.character({ kind: 'robot', seed: 4, pos: [5, 0, -6] });
W.materials.apply(guide, 'hologram', { color: '#7cf0c8' });                           // a projected guide; lights + fog still apply
const hero = W.props.character({ role: 'scientist', seed: 3, pos: [0, 0, 4] });
W.materials.outline(hero, { thickness: .03 });                                       // cel look for the player only
const shots = W.projectiles({ speed: 30, targets: () => [shield], onHit: (t, p) => shield.material.userData.hit(p) });
const fade = W.materials.make('dissolve', { color: '#ff5555', edge: '#ffb347' });    // on a kill: W.materials.apply(e.mesh, fade); then per frame fade.userData.uniforms.progress.value += dt * .6
```

| Wrong | Right |
|---|---|
| `TextureLoader().load('brick.jpg')` / any image URL | `W.textures.get('brick', { repeat: [4, 2] })` — generated, cached, tileable |
| `new THREE.ShaderMaterial({…})` for a glow, a shield, a hologram | `make('neon' \| 'forcefield' \| 'hologram')` — fog, lights, instancing handled |
| `MeshStandardMaterial({ metalness: 1 })` — black without an env map | `make('metal')` / `make('chrome')` — Phong + a fake reflection, cheap in software GL |
| rusty crates in a lush forest | textures match the biome: `plank`/`bark`/`leaves` there; `rust`/`panel`/`hazard` in a lab or a base |
| a textured prop looks dark and muddy | the part's palette colour tints the map (once) — a dark role darkens it; pass `colors: { roleIdx: '#ffffff' }` or a light tint next to `texture` |
| `size: 1024` on every surface | the defaults (512² hero / 256² rest) — the checker renders at 640×360 |
| `uniforms.time.value += dt` in your loop | `W.update` already advances `time`; set only your own (`progress`, `intensity`) |
| `blend: ['snow', 'height']` on a flat world | blends need relief: `terrain: { hills: .6 }` in `world()` |
