import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const studio = readFileSync(join(SRC, 'features/Yuvi-studio/StudioContent.tsx'), 'utf8')
const panel = readFileSync(join(SRC, 'features/Yuvi-studio/community/FriendsRoomsPanel.tsx'), 'utf8')
const loader = readFileSync(join(SRC, 'features/Yuvi-studio/StudioLoadingExperience.tsx'), 'utf8')
const roomLike = readFileSync(join(SRC, 'features/Yuvi-studio/community/RoomLikeButton.tsx'), 'utf8')

test('a community room visit uses the Studio stage without editing hooks', () => {
  assert.match(studio, /const activeDesign = design/)
  assert.match(studio, /avatarRef\.current\?\.setVisitorHost\(visitorDesign\)/)
  assert.match(studio, /onZoneChange=\{!visitorRoom \? handleZoneChange : undefined\}/)
  assert.match(studio, /onPlaceAt=\{!visitorRoom \? handlePlaceAt : undefined\}/)
  assert.match(studio, /onItemMenu=\{!visitorRoom && !placing \? showPropMenu : undefined\}/)
  assert.match(studio, /lockRoam=\{\(!visitorRoom && mode !== 'roam'\)/)
})

test('Friends rooms use a named circular avatar button without a visible visit label', () => {
  assert.match(studio, /getCommunityRoom\(ownerId\)/)
  assert.match(panel, /ys-friends__toggle--top/)
  assert.doesNotMatch(panel, /YuviStudio\.community\.subtitle/)
  assert.doesNotMatch(panel, /YuviStudio\.community\.tabMine/)
  assert.match(panel, /function FriendRoomCard/)
  assert.match(panel, /normalizeDesign\(room\.yuvi_design\)/)
  assert.match(panel, /ys-friends__yuvi-face/)
  assert.match(panel, /design\.equipped\.face/)
  assert.match(panel, /aria-label=\{t\('YuviStudio\.community\.visit'\)\}/)
  assert.doesNotMatch(panel, /pending \? t\('YuviStudio\.community\.preparing'\)/)
  assert.doesNotMatch(panel, /appreciation_count|acknowledgement_count|like_count|most liked/i)
})

test('Friends room journeys use the cinematic state machine, swap once, and land on each world', () => {
  assert.match(studio, /const FRIEND_ROOM_LANDING: \[number, number\] = \[0, 0\]/)
  assert.match(studio, /new FriendTravelController\(\)/)
  assert.match(studio, /controller\.play\(\{[\s\S]{0,500}onWorldSwap/)
  assert.match(studio, /setVisitorRoom\(destination\)[\s\S]{0,120}teleportTo\(FRIEND_ROOM_LANDING/)
  assert.match(studio, /const FRIENDS_STATION_RETURN: \[number, number\] = \[5\.6, -0\.7\]/)
  assert.match(studio, /avatarRef\.current\?\.walkTo\(friendStation\.x, friendStation\.z, 'mission', \(\) => \{/)
  assert.match(studio, /const \[returning, setReturning\] = useState\(false\)/)
  assert.match(studio, /if \(!visitorRoom \|\| travelPhase !== 'idle' \|\| returning\) return/)
  assert.match(studio, /setVisitorRoom\(null\)[\s\S]{0,200}teleportTo\(FRIENDS_STATION_RETURN/)
  assert.match(studio, /travelPhase=\{travelPhase\}/)
  assert.match(studio, /lockRoam=\{\(!visitorRoom && mode !== 'roam'\)[\s\S]{0,100}travelPhase !== 'idle'/)
})

test('personal world changes use the same capsule transition and save only at world swap', () => {
  assert.match(studio, /const chooseWorld = async \(layoutId: 'lab' \| 'dome' \| 'triangularObservatory'\) => \{[\s\S]{0,280}travelPhase !== 'idle'/)
  assert.match(studio, /controller\.play\(\{[\s\S]{0,500}void roomState\.setActiveLayout\(layoutId\)/)
  assert.match(studio, /onFailure: \(\) => \{[\s\S]{0,180}setWorldPickerOpen\(true\)/)
})

test('Studio opens through a cinematic loader after data and the first WebGL frame are ready', () => {
  assert.match(studio, /const \[stageRendered, setStageRendered\] = useState\(false\)/)
  assert.match(studio, /onReady=\{\(\) => setStageRendered\(true\)\}/)
  assert.match(studio, /ready=\{loaded && roomState\.loaded && stageRendered\}/)
  assert.match(studio, /<StudioLoadingExperience[\s\S]{0,120}design=\{activeDesign\}/)
  assert.match(loader, /new THREE\.WebGLRenderer/)
  assert.match(loader, /const portalSystem = new THREE\.Group\(\)/)
  assert.match(loader, /portalSystem\.add\(portal\)/)
  assert.match(loader, /portalSystem\.add\(particles\)/)
  assert.match(loader, /<YuviAvatar3D key=\{designKey\(design\)\} initialDesign=\{design\} label="" performanceMode="low"/)
  assert.match(loader, /ys-loading__portal-system[\s\S]{0,300}ys-loading__yuvi/)
  assert.doesNotMatch(loader, /new THREE\.SphereGeometry\(0\.46/)
  assert.match(loader, /portal\.scale\.setScalar\(1\)/)
  assert.match(loader, /\}, \[design\]\)/)
  assert.match(loader, /new THREE\.Points/)
  assert.match(loader, /new THREE\.TorusGeometry/)
  assert.match(loader, /prefers-reduced-motion: reduce/)
})

test('a visited room removes the Capsule Olam panel and exposes an animated in-stage Like control', () => {
  assert.match(studio, /ys-visiting-friend/)
  assert.match(studio, /mode === 'friends' && !visitorRoom/)
  assert.match(studio, /<div className="ys-stage-tools">[\s\S]{0,1300}<RoomLikeButton liked=\{visitorRoom\.liked_by_me\}/)
  assert.match(roomLike, /import gsap from 'gsap'/)
  assert.match(roomLike, /scale: 1\.3, y: -10/)
  assert.match(roomLike, /to\(glow, \{ opacity: 1, duration: 0\.12/)
  assert.match(roomLike, /scale: 2\.15, opacity: 0/)
  assert.match(roomLike, /y: -34, scale: 1\.08, opacity: 0/)
  assert.match(roomLike, /lockedRef\.current/)
})