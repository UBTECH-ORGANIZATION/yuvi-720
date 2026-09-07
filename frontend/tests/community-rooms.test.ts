import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const studio = readFileSync(join(SRC, 'features/Yuvi-studio/StudioContent.tsx'), 'utf8')
const panel = readFileSync(join(SRC, 'features/Yuvi-studio/community/FriendsRoomsPanel.tsx'), 'utf8')

test('a community room visit uses the Studio stage without editing hooks', () => {
  assert.match(studio, /const activeDesign = design/)
  assert.match(studio, /avatarRef\.current\?\.setVisitorHost\(visitorDesign\)/)
  assert.match(studio, /onZoneChange=\{!visitorRoom \? handleZoneChange : undefined\}/)
  assert.match(studio, /onPlaceAt=\{!visitorRoom \? handlePlaceAt : undefined\}/)
  assert.match(studio, /onItemMenu=\{!visitorRoom && !placing \? showPropMenu : undefined\}/)
  assert.match(studio, /lockRoam=\{\(!visitorRoom && mode !== 'roam'\)/)
})

test('community cards expose a private like without peer counts', () => {
  assert.match(panel, /liked_by_me/)
  assert.match(panel, /onLike/)
  assert.match(panel, /name="thumbUp"/)
  assert.match(studio, /getCommunityRoom\(ownerId\)/)
  assert.match(panel, /ys-friends__toggle--top/)
  assert.doesNotMatch(panel, /YuviStudio\.community\.subtitle/)
  assert.doesNotMatch(panel, /YuviStudio\.community\.tabMine/)
  assert.match(panel, /function FriendRoomCard/)
  assert.match(panel, /normalizeDesign\(room\.yuvi_design\)/)
  assert.match(panel, /ys-friends__yuvi-face/)
  assert.match(panel, /design\.equipped\.face/)
  assert.match(panel, /YuviStudio\.community\.preparing/)
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