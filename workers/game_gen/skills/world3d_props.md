## Prop library (yuvi_world3d_props.js)

98 themed kinds in six sets with named `variant`s (metres), instanced like every kind: `scatter(kind, n, {variant, area, avoid, colors, scale, lights})`, `place(kind, [[x,z] | {x,z,rot,s}], o)`, `make(kind, {variant, pos})`.
Parts carry textures and glow (`e:'dark'` windows light up in dark biomes; `light` kinds add a point light for the first 3 instances — 10 per world, `lights: 0` saves them).
A brief has a theme — build it from the matching set, not from `crate` + `tree`. `W.props.set('industrial')` → kind names; `W.props.variants` → `{kind: [names]}`.

| Set | Kind — variants |
|---|---|
| industrial | `container` red·blue·green·open (cover) · `generator` yellow·military·rusty · `tank` water·fuel·tower · `catwalk` segment·stairs·platform · `ladder` metal·wood·tall·rusty · `wallSegment` concrete·metal·chainlink·brick · `door` rolling·steel·open · `vent` ac·pipe·duct · `antenna` mast·dish·radar · `dumpster` green·blue·open·rusty · `sandbag` wall·ring·corner·desert (cover) · `tire` stack·single·pile·tall · `pallet` crates·empty·stack·sacks · `spool` standing·flat·small · `forklift` yellow·orange·green · `truck` box·tanker·flatbed·military · `crane` tower·mobile·gantry (landmark) · `chimney` brick·metal·twin (landmark) · `powerLine` pylon·pole·transformer · `hazardBarrel` yellow·toxic·red·leaking · `console` dark·lit·bank·broken · `floodlightTower` single·quad·trailer·off (light) · `scaffold` two·tall·tarp·one · `conveyor` flat·empty·loaded·incline · `valve` red·blue·rusty·stand · `pipeJunction` cross·rusty·elbow·gauge · `road` asphalt·line·crossing·dirt·gravel·stone·panel (soft tile) · `warehouse` steel·brick·concrete·open |
| urban | `car` sedan·van·pickup·red·blue·white·yellow·black·police · `bench` wood·metal·stone·park · `trashcan` metal·green·blue·overflowing · `mailbox` blue·green·pillar·post · `hydrant` red·yellow·blue·silver · `busStop` glass·metal·lit·simple · `kiosk` red·blue·green·news · `billboard` single·lit·double·small (landmark) · `trafficCone` orange·striped·drum·lime · `fenceChain` plain·barbed·gate·low · `streetSign` blue·stop·arrow·warning · `bridge` concrete·wood·stone·steel · `phoneBooth` red·blue·modern·green · `vending` red·blue·lit·dark |
| nature | `logPile` three·stack·cut·single · `stump` plain·axe·mossy·hollow · `mushroom` red·brown·glow·cluster · `boulderMossy` mossy·bare·cracked·pile · `well` stone·wood·ruined·dry · `windmill` stone·wood·white·dutch (landmark) · `haystack` round·bale·stack·square · `scarecrow` plain·hat·crow·field · `barn` red·wood·grey·stable · `cart` empty·hay·crates·barrels · `treeDead` bare·broken·burnt·fallen · `treeBirch` green·autumn·bare·snowy · `treeBaobab` leafy·bare·young·twin · `bamboo` green·dry·dense·young · `lilypad` plain·flower·large·pair (floats) · `reed` cattail·grass·tall·dry |
| scifi | `podium` cyan·magenta·amber·tall (light) · `hologramPad` globe·pyramid·figure·off (light) · `capsule` standing·dark·lying·open · `reactor` cyan·orange·green·offline (landmark, light) · `droneDock` withDrone·empty·charging·hover · `serverRack` lit·dark·row·damaged · `teleporter` arch·magenta·ring·offline (light) · `solarPanel` single·row·flat·tall · `dome` metal·glass·habitat·dark · `satelliteDish` white·dark·large·rusty |
| medieval | `wallRuin` low·tall·corner·mossy · `arch` stone·ruined·double·tall (landmark) · `statue` stone·bronze·broken·knight · `brazier` iron·stone·tall·unlit (light) · `gate` closed·open·iron·ruined · `tent` canvas·red·large·striped · `banner` red·blue·gold·tattered · `anvil` onStump·iron·withHammer·hot · `barrelStack` pyramid·row·big·single · `wagon` covered·open·hay·cargo |
| interior | `table` dining·coffee·desk·round · `chair` wood·office·stool·armchair · `sofa` red·blue·leather·corner · `bookshelf` full·half·empty·tall · `book` red·blue·green·stack (a platform when giant) · `lampInterior` floor·desk·ceiling·neon (light) · `bed` single·double·bunk·crib · `plant` pot·fern·cactus·tall · `cup` mug·glass·teapot·bottle · `rug` round·rect·runner·patterned (flat, soft) · `tv` flat·old·monitor·arcade (glow screen) · `fridge` white·steel·retro·open · `cabinet` kitchen·wardrobe·drawer·safe · `toy` ball·blocks·car·teddy · `pillow` square·round·long·heart (soft) · `pictureFrame` landscape·portrait·mirror·clock (wall-hung, soft — `place` with `y`) · `staircase` wood·stone·spiral·short (landmark) · `wallInterior` plain·wallpaper·brick·tiles (4 m segments, `rot`) · `doorway` open·closed·arch·glass (4 m, fills a wall slot) · `window` square·wide·round·curtain (daylight glow, wall-hung, soft) |
| core, upgraded | `crate` wood·metal·military·glow · `barrel` rusty·blue·toxic·wood · `building` office·apartment·shop·house (lit windows) — default looks unchanged |

### Themed compounds — `W.props.layout(name, o)` instead of `W.decorate()`

`name` ∈ `industrialNight harbour village scifiBase ruins city house classroom`; `o = {seed, radius (half−6), density=1, edge, landmark}`. A perimeter wall with a gate on the far (−z) side, a straight avenue
from the spawn to it plus a cross street, a landmark by the avenue's end, axis-aligned buildings, lamps along the road, cover clusters and dressing — all off the roads and the spawn.
Same handle as `decorate`: `{sets, positions (→ ctrl.collide(handle)), landmark, path, remove()}`. One per world; add your own props with `avoid: handle.positions`.

Two of them are INTERIORS (the brief happens inside — a home, a school): a `wallInterior` ring with a `doorway`, windows and pictures on the walls, furniture in clusters, the spawn (0,0) left clear.
- `house` — `{rooms: ['living','kitchen','bedroom','library'] (default all four, one per quadrant), giant: false, wall: 'wallpaper'}`: a rug-tiled floor, sofa + tv + coffee table, a kitchen corner with fridge and dining table, a bed nook, a bookshelf wall; the staircase is the landmark. `giant: true` scales the whole plan ×8 (a number → ×6–×10, capped so it fits `radius`; a 120 world gives ×6.5, fewer `rooms` allow more) — a tiny hero sees books as cliffs and a table as a plateau ("tiny robot in a giant house").
- `classroom` — `{cols: 4 (≤5), rows: 3 (≤3), giant, wall: 'plain'}`: desks in rows with chairs and a book on each, the teacher's desk, a green board (`pictureFrame` tinted) and a smart board (`tv`, the landmark) on the −z wall, windows on −x, a closed door on +x.

```html
<script type="module">
import * as THREE from 'https://…/three.module.js';
const W = YuviWorld3D.world(THREE, { preset: 'night', seed: 21, size: 120, fill: .5, ambient: 'dust' });
const yard = W.props.layout('industrialNight', { seed: 4 });                         // walls, gate, roads, warehouses, floodlights, containers…
const guardPost = W.props.make('console', { variant: 'lit', pos: [6, 0, -12] });      // a hero prop with its own light
const crates = W.props.scatter('crate', 10, { variant: 'metal', area: 30, avoid: yard.positions });
W.props.place('sandbag', [[-4, -20], { x: 4, z: -20, rot: Math.PI / 2 }], { variant: 'ring' });   // cover to duck behind
const hero = W.props.character({ role: 'guard', seed: 3, pos: [0, 0, 5] });
const ctrl = W.player.avatar(hero, { camera: 'shoulder', speed: 6 }).collide(yard).collide(crates);
const truck = W.props.make('truck', { variant: 'flatbed', pos: [-14, 0, -30] }); truck.rotation.y = Math.PI / 2;
W.minimap(null, { markers: () => [{ pos: yard.landmark.position, color: '#ffb347', r: 4 }] });
W.objective('הגיעו לארובה — בלי שהשומרים יראו');
YuviKit.init({ title: 'המתחם', subtitle: 'לילה', palette: ['#0a1020', '#ffb347'], hud: [{ id: 'score', label: 'ניקוד', value: 0 }], onStart: () => ctrl.requestLook() });
W.run();
</script>
```

| Wrong | Right |
|---|---|
| an "industrial compound" from `crate` + `barrel` + pine `tree` | `W.props.layout('industrialNight')` or the `industrial` set: `container`, `warehouse`, `tank`, `catwalk`, `floodlightTower`, `sandbag` |
| `W.decorate({layout: 'city'})` — decorate has no `layout` option | `W.props.layout('city', {seed})`; `decorate()` is for biome clearings |
| every prop the default variant, one colour | a `variant` per call and several calls (`car` red / van / white), `colors: {5: hex}`, `scale`; size + tint already jitter per instance |
| a wall from 100 `crate`s, a fence by hand | `place('wallSegment', ring, {variant: 'concrete'})` (4 m segments, `rot` per side) + one `door`/`gate` — or let `layout` do it |
| a house from `building` boxes or a `village` layout when the brief is INSIDE a home | `W.props.layout('house', {giant: true})` + the `interior` set (`book`, `table`, `bookshelf`, `staircase`, `lampInterior`…) — the hero is tiny, the furniture is the terrain |
| a school scene from crates | `W.props.layout('classroom')`, then `table` desk / `chair` / `book` / `pictureFrame` for what the brief adds |
| a landmark from 30 boxes of your own | `make('chimney' \| 'crane' \| 'reactor' \| 'windmill' \| 'arch' \| 'billboard', {scale: 1.3, pos})` |
| lights on every lamp (`floodlightTower` × 12) | `lights: 3` on the set that matters, `lights: 0` elsewhere — 10 point lights per world |
