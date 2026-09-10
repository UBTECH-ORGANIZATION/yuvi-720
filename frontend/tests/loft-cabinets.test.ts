import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { createLoftFabrication } from '../src/features/Yuvi-studio/LoftFabrication.ts'
import { buildLoftCabinet, LOFT_CABINET_BOUNDS } from '../src/features/Yuvi-studio/LoftCabinets.ts'
import { buildLoftPrize, type LoftPrize } from '../src/features/Yuvi-studio/LoftPrizes.ts'

const textCalls: string[] = []
const context = new Proxy({ measureText: (text: string) => ({ width: text.length * 12 }), fillText: (text: string) => textCalls.push(text) }, {
  get(target, property) { return property in target ? target[property as keyof typeof target] : () => undefined },
})
const documentStub = { createElement: () => ({ width: 0, height: 0, getContext: () => context }), documentElement: { dir: 'ltr' } }
Object.defineProperty(globalThis, 'document', { value: undefined, writable: true, configurable: true })

for (const rich of [true, false]) {
  test(`detailed cabinets fit their placement limits and carry their own parts (rich=${rich})`, (testContext) => {
    testContext.mock.property(globalThis, 'document', documentStub)
    const factory = createLoftFabrication(rich)
    for (const [kind, limit] of Object.entries(LOFT_CABINET_BOUNDS)) {
      const root = buildLoftCabinet(factory, kind, new THREE.Color('#427c87'), () => new THREE.Group())
      const requestedLabels: string[] = []
      factory.setLabels((key) => { requestedLabels.push(key); return key })
      assert.deepEqual(requestedLabels, [], `${kind} has physical lettering`)
      const bounds = new THREE.Box3().setFromObject(root)
      assert.ok(bounds.min.y >= -0.01, `${kind} below floor`)
      assert.ok(bounds.max.y <= limit.height + 0.001, `${kind} too tall`)
      assert.ok(Math.hypot(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)), Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z))) <= limit.radius + 0.001, `${kind} outside footprint`)
      assert.ok(root.children.length > 12, `${kind} missing assembly details`)
      assert.ok(bounds.max.y > 0.8, `${kind} unexpectedly small`)
      const before = root.position.clone()
      root.userData.update?.(2)
      assert.deepEqual(root.position, before)
      root.position.set(7, 0, 9); root.rotation.y = Math.PI / 2
      const moved = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3())
      assert.ok(moved.x > 5 && moved.z > 7, `${kind} detached pieces`)
    }
    factory.dispose()
  })
}

test('all added prize categories contain nonempty detailed geometry', (testContext) => {
  testContext.mock.property(globalThis, 'document', documentStub)
  const factory = createLoftFabrication(true)
  for (const kind of ['phone', 'watch', 'headphones', 'plush', 'figure', 'vrHeadset', 'controller'] as LoftPrize[]) {
    const prize = buildLoftPrize(factory, kind)
    assert.ok(prize.children.length >= 4, kind)
    assert.equal(new THREE.Box3().setFromObject(prize).isEmpty(), false)
  }
  factory.dispose()
})

test('printed surfaces redraw translations without replacing shared materials', (testContext) => {
  testContext.mock.property(globalThis, 'document', documentStub)
  const factory = createLoftFabrication(true)
  const material = factory.print('marquee', 'test-label')
  textCalls.length = 0
  factory.setLabels(() => 'First label')
  factory.setLabels(() => 'Second label')
  assert.deepEqual(textCalls, ['First label', 'Second label'])
  assert.equal(factory.print('marquee', 'test-label'), material)
  factory.dispose()
})