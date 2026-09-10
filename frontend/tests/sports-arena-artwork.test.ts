import assert from 'node:assert/strict'
import test from 'node:test'
import { SPORTS_ARENA_ARTWORKS } from '../src/features/Yuvi-studio/SportsArtwork.ts'
import { createLoftFabrication } from '../src/features/Yuvi-studio/LoftFabrication.ts'

test('eight distinct original Sports Arena artworks are defined', () => {
  assert.deepEqual(SPORTS_ARENA_ARTWORKS, ['basketball', 'soccer', 'runners', 'olympic', 'padel', 'tennis', 'strength', 'cycling'])
})

for (const rich of [true, false]) {
  test(`Sports Arena artwork prints share resources and dispose (rich=${rich})`, () => {
    const context = new Proxy({ createLinearGradient: () => ({ addColorStop() {} }), measureText: () => ({ width: 100 }) }, {
      get(target, property) { return property in target ? target[property as keyof typeof target] : () => undefined },
    })
    const original = Object.getOwnPropertyDescriptor(globalThis, 'document')
    const documentStub = { createElement: () => ({ width: 0, height: 0, getContext: () => context }), documentElement: { dir: 'ltr' } }
    Object.defineProperty(globalThis, 'document', { value: documentStub, configurable: true })
    const factory = createLoftFabrication(rich)
    try {
      const prints = SPORTS_ARENA_ARTWORKS.map((id) => factory.print(id))
      const sign = factory.print('gymSign', 'YuviStudio.room.gymSign.title')
      assert.equal(sign, factory.print('gymSign', 'YuviStudio.room.gymSign.title'))
      const version = sign.map!.version
      factory.setLabels(() => "Yubi's Gym")
      assert.ok(sign.map!.version > version)
      assert.ok(Math.abs(sign.map!.image.width / sign.map!.image.height - 5.7 / 2.4) < 0.02)
      SPORTS_ARENA_ARTWORKS.forEach((id, index) => {
        assert.equal(factory.print(id), prints[index])
        const image = prints[index].map!.image
        assert.ok(Math.abs(image.width / image.height - 600 / 468) < 0.01)
      })
      let disposed = 0
      for (const material of prints) material.map!.addEventListener('dispose', () => { disposed += 1 })
      sign.map!.addEventListener('dispose', () => { disposed += 1 })
      factory.dispose()
      assert.equal(disposed, 9)
    } finally {
      factory.dispose()
      if (original) Object.defineProperty(globalThis, 'document', original)
      else Reflect.deleteProperty(globalThis, 'document')
    }
  })
}