/* The agenda payload, and what it refuses.
 *
 *   node --test frontend/tests/
 *
 * The model authors this JSON, so the validator is the boundary between "a
 * schedule" and "whatever came back". Every rule here exists because the
 * failure it prevents is silent: a card that renders an Invalid Date, an item
 * at an hour nobody scheduled, a day out of order that reads as a week.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseAgendaSpec, AGENDA_KINDS } from '../src/components/richText/agenda.ts'
import { parseBlocks } from '../src/components/richText/blocks.ts'

const fence = (json: string) => '```yuvi-agenda\n' + json + '\n```'

describe('an agenda the model wrote', () => {

  it('is a day with things on it', () => {
    const spec = parseAgendaSpec(JSON.stringify({
      days: [{ date: '2026-08-20', items: [
        { kind: 'test', title: 'מבחן בשברים', time: '09:00' },
      ] }],
    }))
    assert.equal(spec?.days.length, 1)
    assert.equal(spec?.days[0].items[0].kind, 'test')
    assert.equal(spec?.days[0].items[0].time, '09:00')
    assert.equal(spec?.days[0].items[0].who, null)
  })

  it('reaches the renderer through its own fence', () => {
    const blocks = parseBlocks('לפניך השבוע:\n' + fence(JSON.stringify({
      days: [{ date: '2026-08-20', items: [{ title: 'מבחן' }] }],
    })))
    assert.deepEqual(blocks.map((block) => block.kind), ['paragraph', 'agenda'])
  })

  it('is dropped whole rather than rendered broken', () => {
    // The same trade the diagram makes: the sentences around it still stand.
    for (const bad of ['', 'not json', '{}', '{"days":[]}', '[]',
                       '{"days":[{"date":"2026-08-20","items":[]}]}']) {
      assert.equal(parseAgendaSpec(bad), null, bad)
    }
  })
})

describe('what it will not take on trust', () => {

  it('refuses a day that is not a real date', () => {
    // `2026-02-31` matches the pattern and is not a day. Rendering it puts
    // "Invalid Date" at the top of a card.
    for (const date of ['2026-02-31', '2026-13-01', '20-08-2026', 'next tuesday', '']) {
      assert.equal(parseAgendaSpec(JSON.stringify({
        days: [{ date, items: [{ title: 'x' }] }],
      })), null, date)
    }
  })

  it('drops a made-up time instead of repairing it', () => {
    // An item that reads as all-day is a smaller error than one at an hour
    // nobody scheduled.
    for (const time of ['25:00', '9:00', 'בבוקר', '09:70']) {
      const spec = parseAgendaSpec(JSON.stringify({
        days: [{ date: '2026-08-20', items: [{ title: 'x', time }] }],
      }))
      assert.equal(spec?.days[0].items[0].time, null, time)
    }
  })

  it('falls back to a neutral kind rather than an empty slot', () => {
    const spec = parseAgendaSpec(JSON.stringify({
      days: [{ date: '2026-08-20', items: [{ title: 'x', kind: 'assembly' }] }],
    }))
    assert.equal(spec?.days[0].items[0].kind, 'event')
    assert.ok(AGENDA_KINDS.includes(spec!.days[0].items[0].kind))
  })

  it('skips an item with no title, keeping the rest of the day', () => {
    const spec = parseAgendaSpec(JSON.stringify({
      days: [{ date: '2026-08-20', items: [{ time: '09:00' }, { title: 'מבחן' }] }],
    }))
    assert.equal(spec?.days[0].items.length, 1)
    assert.equal(spec?.days[0].items[0].title, 'מבחן')
  })
})

describe('what it fixes without being asked', () => {

  it('puts the days in order', () => {
    // A schedule out of order is worse than no schedule, and sorting is free.
    const spec = parseAgendaSpec(JSON.stringify({
      days: [
        { date: '2026-08-25', items: [{ title: 'c' }] },
        { date: '2026-08-20', items: [{ title: 'a' }] },
        { date: '2026-08-21', items: [{ title: 'b' }] },
      ],
    }))
    assert.deepEqual(spec?.days.map((day) => day.date),
                     ['2026-08-20', '2026-08-21', '2026-08-25'])
  })

  it('caps a month down to something a chat message can hold', () => {
    const spec = parseAgendaSpec(JSON.stringify({
      days: Array.from({ length: 40 }, (_, index) => ({
        date: `2026-09-${String((index % 28) + 1).padStart(2, '0')}`,
        items: Array.from({ length: 10 }, (_, n) => ({ title: `item ${n}` })),
      })),
    }))
    assert.ok(spec!.days.length <= 14)
    for (const day of spec!.days) assert.ok(day.items.length <= 6)
    const total = spec!.days.reduce((sum, day) => sum + day.items.length, 0)
    assert.ok(total <= 30, `${total} items is more than a message should carry`)
  })
})
