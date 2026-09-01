/* The studio on a school tablet.
 *
 * Every verb in the room was a mouse verb. The prop menu was `contextmenu`
 * only — which iOS Safari does not fire on a canvas at all — so "move this
 * sofa" simply did not exist on touch. Zoom was the wheel, panning was a
 * right-drag, walking was the arrow keys. And with no `touch-action` the
 * browser treated a drag as a scroll and cancelled the gesture mid-way,
 * without anyone listening for `pointercancel` to clean up after it.
 *
 * Worst of it landed on the walkthrough: step one asks the child to tap a lit
 * patch of floor, and the tap test allowed six pixels of travel — less than a
 * finger wobbles. A learner could be stuck on the first instruction.
 *
 * WebGL and pointer gestures cannot run here, so this pins the shape of the
 * fix; the gestures themselves are checked by hand on a touch device.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

const avatar = read('frontend/src/features/Yuvi-studio/YuviAvatar3D.tsx')
const studio = read('frontend/src/features/Yuvi-studio/StudioContent.tsx')
const propMenu = read('frontend/src/features/Yuvi-studio/panel/PropMenu.tsx')
const roomDesign = read('frontend/src/features/Yuvi-studio/RoomDesign.ts')
const roomState = read('frontend/src/features/Yuvi-studio/useRoomDesign.ts')
const welcome = read('frontend/src/features/Yuvi-studio/panel/StudioWelcome.tsx')
const itemCard = read('frontend/src/features/Yuvi-studio/panel/ItemCard.tsx')
const labRoom = read('frontend/src/features/Yuvi-studio/YuviLabRoom.ts')
const studioHelp = read('frontend/src/features/Yuvi-studio/panel/StudioHelp.tsx')
const css = read('frontend/src/styles/Yuvi-studio.css')
const he = JSON.parse(read('locales/he.json')) as Record<string, string>

test('only the studio takes the browser gestures away', () => {
  // The same component draws the floating companion inside scrollable pages.
  // A blanket `touch-action: none` would trap the page under a small robot.
  assert.match(avatar, /if \(orbit\) \{[\s\S]{0,300}touchAction = 'none'/)
})

test('press and hold opens the furniture menu on touch', () => {
  assert.match(avatar, /holdTimer = window\.setTimeout/)
  // Touch keeps a deliberate alternative to mouse hover.
  assert.match(avatar, /openMenuAt\(pressX, pressY\)/)
  // A hold that became a drag is not a hold.
  assert.match(avatar, /if \(holdTimer && Math\.hypot[\s\S]{0,80}cancelHold\(\)/)
})

test('hovering furniture opens its menu and leaving it begins dismissal', () => {
  assert.match(avatar, /const onPropHover = \(event: PointerEvent\) => \{[\s\S]{0,160}openMenuAt\(event\.clientX, event\.clientY\)/)
  assert.match(avatar, /addEventListener\('pointermove', onPropHover/)
  assert.match(avatar, /addEventListener\('pointerleave', onPropHoverLeave\)/)
  assert.match(studio, /onItemMenu=\{!placing \? showPropMenu : undefined\}/)
  assert.match(studio, /onItemMenuLeave=\{!placing \? \(\) => \{ deferPropMenuClose\(\); setSurpriseNotice\(false\) \} : undefined\}/)
  assert.match(studio, /onHoverStart=\{clearPropMenuClose\}/)
  assert.match(studio, /setTimeout\(\(\) => setPropMenu\(null\), 350\)/)
  assert.match(propMenu, /onMouseEnter=\{onHoverStart\}/)
})

test('tintable furniture offers colours only through its hover menu', () => {
  assert.match(studio, /ITEM_TINTS\.slice\(0, 5\)/)
  assert.match(studio, /<RoomColorDialog/)
  assert.doesNotMatch(studio, /guidePlacementTint/)
  assert.doesNotMatch(studio, /onPlacementTint/)
  assert.equal(he['YuviStudio.room.moreColors'], 'צבעים נוספים')
})

test('hovering Yuvi station offers only the Design Yuvi action', () => {
  assert.match(studio, /primaryAction=\{menuStation === 'avatar'/)
  assert.match(studio, /onMove=\{menuStation === 'avatar' \? undefined/)
  assert.match(studio, /onRotate=\{menuStation === 'avatar' \? undefined/)
  assert.match(propMenu, /primaryAction\?: \{ label: string; icon: string; onClick: \(\) => void \}/)
})

test('only the visible Yuvi podium, not its light pool, opens the station menu', () => {
  assert.match(labRoom, /raycaster\.intersectObject\(podium, true\)/)
  assert.doesNotMatch(labRoom, /raycaster\.intersectObject\(platform, true\)/)
})

test('globe and mission furniture open hover menus with move and rotate only', () => {
  assert.match(roomDesign, /StationId = 'avatar' \| 'room' \| 'explore' \| 'mission'/)
  assert.match(labRoom, /raycaster\.intersectObject\(explore, true\).*return 'explore'/s)
  assert.match(labRoom, /raycaster\.intersectObject\(mission, true\).*return 'mission'/s)
  assert.match(studio, /onRemove=\{menuStation \? undefined/)
  assert.equal(he['YuviStudio.zone.explore'], 'עמדת הגלובוס')
  assert.equal(he['YuviStudio.zone.mission'], 'עמדת המשימות')
})

test('room styles share the General Room tab', () => {
  assert.match(studio, /type RoomTab = RoomItemCategory \| 'general' \| 'surprises'/)
  assert.match(studio, /YuviStudio\.room\.general/)
  assert.match(studio, /category === 'general'/)
  assert.match(studio, /key: 'floor', options: ROOM_STYLES/)
  assert.match(studio, /key: 'wall', options: WALL_STYLES/)
  assert.match(studio, /key: 'mood', options: MOODS/)
  assert.equal(he['YuviStudio.room.general'], 'חדר כללי')
})

test('an approved gift opens only from a deliberate item tap', () => {
  assert.match(avatar, /const tappedItem = pickRoomItemAt\(event\.clientX, event\.clientY\)/)
  assert.match(avatar, /onRoomItemTapRef\.current\?\.\(tappedItem\)/)
  assert.match(studio, /weeklySurprise\.state === 'ready' \? WEEKLY_SURPRISE_READY : WEEKLY_SURPRISE_COVERED/s)
  assert.match(studio, /onRoomItemTap=\{\(uid\) => \{/)
  assert.match(studio, /claimWeeklySurprise\(\)/)
})

test('a first visit gets a four-step in-world welcome without reopening the old practical tutorial', () => {
  assert.match(roomDesign, /introDone: false/)
  assert.match(roomDesign, /const introDone = record\.introDone === true/)
  assert.match(roomDesign, /base\.introDone = introDone/)
  assert.match(roomState, /const completeIntro = async \(\) => \{[\s\S]{0,180}introDone: true/)
  assert.match(roomState, /export function useRoomDesign\(autoLoad = true, reloadKey\?: string\)/)
  assert.match(roomState, /setLoaded\(false\)[\s\S]{0,360}\}, \[reloadKey\]\)/)
  assert.match(studio, /const \{ user \} = useAuth\(\)/)
  assert.match(studio, /useRoomDesign\(true, user\?\.user_id\)/)
  assert.match(studio, /tutorialArmed\.current = false[\s\S]{0,260}\[user\?\.user_id\]/)
  assert.match(studio, /if \(!roomState\.room\.introDone\) \{ setIntroScene\(0\); return \}/)
  assert.doesNotMatch(studio, /setTutorial\(/)
  assert.match(studio, /lockRoam=\{mode !== 'roam' \|\| introScene !== null\}/)
  assert.match(studio, /<StudioWelcome/)
  assert.match(studio, /await roomState\.completeIntro\(\)/)
  assert.match(studio, /const \[introAvatarChanged, setIntroAvatarChanged\] = useState\(false\)/)
  assert.match(roomDesign, /placed: false/)
  assert.match(roomState, /\[id\]: \{ x, z, rot: rot \?\? prev\.stations\[id\]\.rot, placed: true \}/)
  assert.match(labRoom, /platform\.visible = stations\.avatar\.placed/)
  assert.match(labRoom, /bench\.visible = stations\.room\.placed/)
  assert.match(studio, /carryStation\('room', stations\.room\.rot\)/)
  assert.match(studio, /if \(!stations\.room\.placed \|\| !stations\.avatar\.placed\)/)
  assert.match(studio, /placing\.station === 'room'/)
  assert.match(studio, /station: 'avatar'/)
  assert.match(studio, /goToStation\('avatar'\)/)
  assert.match(studio, /const saved = await saveAll\(\)[\s\S]{0,100}await roomState\.completeIntro\(\)/)
  assert.doesNotMatch(studio, /introBeanbag|INTRO_ROOM_ITEM/)
  assert.match(studio, /YuviStudio\.intro\.station\.room/)
  assert.match(studio, /YuviStudio\.intro\.station\.avatar/)
  assert.match(studio, /YuviStudio\.intro\.station\.done/)
  assert.match(studio, /if \(introScene === 2\) \{[\s\S]{0,100}setIntroAvatarChanged\(true\)/)
  assert.match(studio, /YuviStudio\.tut\.help/)
  assert.match(itemCard, /highlighted \? 'is-highlighted' : ''/)
  assert.match(welcome, /role="dialog"/)
  assert.equal(he['YuviStudio.intro.continue'], 'יאללה, בונים')
  assert.match(he['YuviStudio.intro.station.room'], /שולחן עיצוב החדר/)
  assert.equal(he['YuviStudio.intro.station.done'], 'מעולה, שני הרהיטים בחדר, אפשר להמשיך.')
  assert.match(he['YuviStudio.intro.avatar.done'], /עיצוב יובי/)
  assert.equal(he['YuviStudio.intro.finish'], 'יוצאים לשחק')
})

test('placing a station shows a hologram of it as well as its valid placement ring', () => {
  assert.match(labRoom, /const ghostStationHolder = new THREE\.Group\(\)/)
  // The carried preview is re-skinned in the lab's additive glow — the faded
  // half-opacity clone was invisible against the busy room (intro feedback).
  assert.match(labRoom, /const makeHologram = \(object: THREE\.Object3D\) => \{[\s\S]{0,900}obj\.material = ghostOkMat/)
  // An unplaced station's mesh is hidden and a clone inherits that; the intro
  // carries exactly such stations, so the hologram must force itself visible.
  assert.match(labRoom, /const makeHologram = \(object: THREE\.Object3D\) => \{[\s\S]{0,400}object\.visible = true/)
  assert.match(labRoom, /const ghostWireOkMat = track\(new THREE\.MeshBasicMaterial\(\{\s*\n?\s*color: CYAN, wireframe: true/)
  assert.match(labRoom, /station === 'avatar'[\s\S]{0,180}platform\.clone\(true\)/)
  assert.match(labRoom, /station === 'room' \? makeHologram\(bench\.clone\(true\)\)/)
  // Validity recolours the WHOLE hologram, not only the ring.
  assert.match(labRoom, /ghostRing\.material = valid \? ghostRingOkMat : ghostRingBadMat/)
  assert.match(labRoom, /for \(const mesh of ghostSolids\) mesh\.material = mat/)
  assert.match(labRoom, /for \(const wire of ghostWires\) wire\.material = wireMat/)
  // The body blends normally — additive stacking made the shape "swell" into a
  // washed-out mass against walls; the additive glow lives only in the thin
  // wireframe and the floor ring, where fragments cannot pile up.
  assert.doesNotMatch(labRoom, /const ghostOkMat = track\(new THREE\.MeshBasicMaterial\(\{[^}]*AdditiveBlending/)
})

test('the Yuvi-Girl selector is not offered in the studio', () => {
  assert.doesNotMatch(studio, /YuviStudio\.variant\.girl/)
  assert.doesNotMatch(studio, /YuviVariant/)
})

test('Help presents all topics and anchors an independently dismissible explanation at Help', () => {
  assert.match(studio, /const \[helpOpen, setHelpOpen\] = useState\(false\)/)
  assert.match(studio, /const \[activeHelpTopic, setActiveHelpTopic\] = useState<StudioHelpTopic \| null>\(null\)/)
  assert.match(studio, /const helpRef = useRef<HTMLDivElement \| null>\(null\)/)
  assert.match(studio, /if \(!helpOpen\) return[\s\S]{0,360}document\.addEventListener\('pointerdown', closeOutsideHelp\)/)
  assert.match(studio, /!helpRef\.current\?\.contains\(event\.target\)[\s\S]{0,120}setHelpOpen\(false\)/)
  assert.match(studio, /removeEventListener\('pointerdown', closeOutsideHelp\)/)
  assert.match(studio, /className="ys-help" ref=\{helpRef\}/)
  assert.doesNotMatch(studio, /className="ys-station ys-station--help"\s+onClick=\{startTutorial\}/)
  assert.match(studio, /<StudioHelp/)
  assert.match(studioHelp, /const TOPICS: StudioHelpTopic\[\] = \['start', 'move', 'furniture', 'change', 'yuvi'\]/)
  assert.doesNotMatch(studioHelp, /ys-help__more|ys-help__guide|onStartTutorial/)
  assert.match(studioHelp, /onCloseTopic/)
  assert.match(css, /\.ys-help__menu \{ position: absolute;[\s\S]{0,120}inline-size: 278px/)
  assert.match(studioHelp, /ys-help__topic-anchor\$\{activeTopic === topic \? ' is-active' : ''\}/)
  assert.match(studioHelp, /activeTopic === topic && \([\s\S]{0,80}<aside className="ys-help__bubble"/)
  assert.match(css, /\.ys-help__topic-anchor:nth-child\(5\) \{ --x: -81px; --y: -179px; --help-color: #c28a36/)
  assert.match(css, /\.ys-help__bubble \{[\s\S]{0,300}inset-inline-start: calc\(100% \+ 10px\)[\s\S]{0,300}background: var\(--help-color\)/)
  assert.match(css, /@keyframes ys-help-fan-in/)
  assert.match(css, /\.ys-help__bubble strong \{[^}]*color: #fff/)
  assert.match(css, /\.ys-help__bubble p \{[^}]*color: #fff/)
  for (const topic of ['start', 'move', 'furniture', 'change', 'yuvi']) {
    assert.ok(he[`YuviStudio.help.topic.${topic}`], `YuviStudio.help.topic.${topic} is missing`)
    assert.ok(he[`YuviStudio.help.body.${topic}`], `YuviStudio.help.body.${topic} is missing`)
  }
  assert.match(studioHelp, /onOpenRoomDesign/)
  assert.match(studioHelp, /onOpenYuviDesign/)
  assert.match(studio, /onOpenRoomDesign=\{\(\) => \{ setHelpOpen\(false\); setActiveHelpTopic\(null\); goToStation\('room'\) \}\}/)
})

test('two fingers zoom and pan', () => {
  assert.match(avatar, /livePointers\.size === 2/)
  assert.match(avatar, /userZoom = THREE\.MathUtils\.clamp\(userZoom \* \(pinchDistance/)
  assert.match(avatar, /userPanX = THREE\.MathUtils\.clamp\(userPanX - \(centre\.x/)
})

test('a cancelled gesture does not strand the drag', () => {
  assert.match(avatar, /addEventListener\('pointercancel', onPointerCancel\)/)
  assert.match(avatar, /removeEventListener\('pointercancel', onPointerCancel\)/)
})

test('the tap test allows for a finger, not a mouse', () => {
  assert.match(avatar, /TAP_SLOP_TOUCH = 1\d/)
  assert.match(avatar, /travelled > tapSlop/)
})

test('a gesture that became something else does not also walk Yuvi', () => {
  // Pinching or holding used to end in a `pointerup` that read as a tap.
  assert.match(avatar, /if \(consumed \|\| !wasOrbit/)
})

test('touch help and furniture guidance avoid desktop-only instructions', () => {
  for (const key of ['YuviStudio.hint', 'YuviStudio.roam.hint', 'YuviStudio.room.menuHint']) {
    assert.ok(he[`${key}.touch`], `${key}.touch is missing from the source locale`)
    assert.ok(!/ימנית|בחצים|לגלגל/.test(he[`${key}.touch`]), `${key}.touch still names a mouse`)
  }
})

test('Help explains the desktop and touch furniture menu', () => {
  assert.match(he['YuviStudio.help.body.change'], /מרחפים על פריט.*לחיצה ארוכה/)
})

test('first person is not offered where it cannot be driven', () => {
  // In first person the floor tap is deliberately dead and the arrow keys are
  // the only way to move, so on a tablet the button is a room with no exit.
  assert.match(studio, /mode === 'roam' && !isTouch/)
})

test('the prop menu rows are finger-sized on touch', () => {
  assert.match(css, /@media \(pointer: coarse\) \{\s*\.ys-propmenu__item \{ min-block-size: 44px; \}/)
})
