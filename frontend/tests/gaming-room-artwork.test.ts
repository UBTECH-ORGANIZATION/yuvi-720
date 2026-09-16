import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { GAMING_ROOM_POSTERS, PACMAN_MAZE } from '../src/features/Yuvi-studio/GamingRoomArtwork.ts'
import { createLoftFabrication } from '../src/features/Yuvi-studio/LoftFabrication.ts'

test('eight unique game posters and complete maze are defined', () => {
  assert.deepEqual(GAMING_ROOM_POSTERS, ['pacman', 'spaceInvaders', 'donkeyKong', 'tekken', 'jazzJackrabbit', 'nflBlitz', 'airHockey', 'destroyScreen'])
  assert.equal(PACMAN_MAZE.length, 31)
  assert.ok(PACMAN_MAZE.every((row) => row.length === 28))
  assert.equal(PACMAN_MAZE[0], '#'.repeat(28))
  assert.equal(PACMAN_MAZE.at(-1), '#'.repeat(28))
  assert.equal(PACMAN_MAZE.join('').match(/o/g)?.length, 4)
})

for (const rich of [true, false]) {
  test(`posters and neon redraw all locales, share textures, and dispose (rich=${rich})`, () => {
    const textCalls: string[] = []
    let drawingCalls = 0
    const context = new Proxy({
      measureText: (text: string) => ({ width: text.length * 20 }),
      fillText: (text: string) => textCalls.push(text),
      createLinearGradient: () => ({ addColorStop() {} }),
    }, {
      get(target, property) { return property in target ? target[property as keyof typeof target] : () => { drawingCalls += 1 } },
    })
    const original = Object.getOwnPropertyDescriptor(globalThis, 'document')
    const documentStub = { createElement: () => ({ width: 0, height: 0, getContext: () => context }), documentElement: { dir: 'ltr' } }
    Object.defineProperty(globalThis, 'document', { value: documentStub, configurable: true })
    const factory = createLoftFabrication(rich)
    try {
      const posters = GAMING_ROOM_POSTERS.map((id) => factory.print(id, `YuviStudio.loft.poster.${id}`))
      const title = factory.print('neonTitle', 'YuviStudio.loft.title')
      for (const language of ['en', 'he', 'ar']) {
        const messages = JSON.parse(readFileSync(new URL(`../../locales/${language}.json`, import.meta.url), 'utf8'))
        documentStub.documentElement.dir = language === 'en' ? 'ltr' : 'rtl'
        factory.setLabels((key) => { assert.equal(typeof messages[key], 'string', `${language}: ${key}`); return messages[key] })
        GAMING_ROOM_POSTERS.forEach((id, index) => {
          assert.ok(textCalls.includes(messages[`YuviStudio.loft.poster.${id}`]))
          assert.equal(factory.print(id, `YuviStudio.loft.poster.${id}`), posters[index])
          const image = posters[index].map!.image
          assert.ok(Math.abs(image.width / image.height - 600 / 468) < 0.01)
        })
        assert.ok(textCalls.includes(messages['YuviStudio.loft.title']))
        assert.equal(messages['YuviStudio.loft.title'], messages['YuviStudio.worlds.creatorLoft.title'])
        const count = textCalls.length
        factory.setLabels((key) => messages[key])
        assert.equal(textCalls.length, count)
      }
      assert.ok(drawingCalls > 3000)
      assert.equal(title.transparent, true)
      assert.equal(title.depthWrite, false)
      let disposed = 0
      for (const material of [...posters, title]) material.map!.addEventListener('dispose', () => { disposed += 1 })
      factory.dispose()
      assert.equal(disposed, 9)
    } finally {
      factory.dispose()
      if (original) Object.defineProperty(globalThis, 'document', original)
      else Reflect.deleteProperty(globalThis, 'document')
    }
  })
}