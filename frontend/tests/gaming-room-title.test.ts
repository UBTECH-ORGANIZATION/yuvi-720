import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { GAMING_ROOM_TITLE_IDS, normalizeRoom } from '../src/features/Yuvi-studio/RoomDesign.ts'

const root = fileURLToPath(new URL('../', import.meta.url))
const studio = readFileSync(`${root}src/features/Yuvi-studio/StudioContent.tsx`, 'utf8')
const avatar = readFileSync(`${root}src/features/Yuvi-studio/YuviAvatar3D.tsx`, 'utf8')

test('the gaming room accepts only the three supported saved title choices', () => {
  assert.deepEqual(GAMING_ROOM_TITLE_IDS, ['gaming', 'babylon', 'playground'])
  for (const gamingRoomTitle of GAMING_ROOM_TITLE_IDS) {
    const room = normalizeRoom({ version: 7, worlds: { creatorLoft: { gamingRoomTitle } } })
    assert.equal(room.worlds.creatorLoft.gamingRoomTitle, gamingRoomTitle)
  }
  const invalid = normalizeRoom({ version: 7, worlds: { creatorLoft: { gamingRoomTitle: 'anything-else' } } })
  assert.equal(invalid.worlds.creatorLoft.gamingRoomTitle, undefined)
})

test('every Creator Loft stage arrival presents a title-facing, persisted choice', () => {
  assert.match(avatar, /activeLayout\.id === 'creatorLoft'/)
  assert.match(avatar, /onGamingRoomAreaChangeRef\.current\?\.\(nearGamingRoomArea\)/)
  assert.match(avatar, /walkToGamingRoomTitle/)
  assert.match(avatar, /walkTo\(0, -22\.4, null/)
  assert.match(avatar, /yawTarget = Math\.PI/)
  assert.match(avatar, /roomLabelOverridesRef\.current\?\.\[key\]/)
  assert.match(studio, /roomState\.setGamingRoomTitle\(title\)/)
  assert.match(studio, /onGamingRoomAreaChange=\{!visitorRoom/)
  assert.doesNotMatch(studio, /near && !roomState\.room\.worlds\.creatorLoft\.gamingRoomTitle/)
  assert.match(studio, /avatarRef\.current\?\.walkToGamingRoomTitle/)
  assert.match(studio, /setGamingRoomTitleGuiding\(true\)/)
  assert.match(studio, /gamingRoomTitleGuiding \|\| gamingRoomTitlePrompt/)
  assert.match(studio, /YuviStudio\.gamingRoom\.choose\.title/)
  assert.match(studio, /GAMING_ROOM_TITLE_IDS\.map/)
  assert.match(studio, /ys-gaming-title-picker/)
  assert.match(studio, /roomLabelOverrides=\{roomLabelOverrides\}/)
})

test('all title prompt strings are translated', () => {
  for (const language of ['he', 'ar', 'en']) {
    const messages = JSON.parse(readFileSync(`${root}../locales/${language}.json`, 'utf8'))
    for (const key of ['YuviStudio.gamingRoom.choose.title', 'YuviStudio.gamingRoom.choose.body']) assert.equal(typeof messages[key], 'string', `${language}: ${key}`)
    for (const title of GAMING_ROOM_TITLE_IDS) assert.equal(typeof messages[`YuviStudio.gamingRoom.name.${title}`], 'string', `${language}: ${title}`)
  }
})