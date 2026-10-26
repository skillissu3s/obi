import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanPin, parseCalendar, pinOn, nextOccurrence, upcomingPins, daysBetween } from './pins.js'

const pin = (p) => ({ id: 'abcdef12', title: 'Launch day', emoji: '🚀', color: 'violet', date: '2026-11-15', ...p })

test('a pin is cleaned up, and nonsense is dropped', () => {
  assert.equal(cleanPin({ date: 'soon', title: 'x' }), null)
  assert.equal(cleanPin({ date: '2026-11-15', title: '   ' }), null)
  const p = cleanPin({ id: 'abcdef12', date: '2026-11-15', title: '  Launch   day ', emoji: '🚀🚀🚀🚀🚀🚀', color: 'chartreuse', repeat: 'often', until: '2026-11-01' })
  assert.deepEqual(p, { id: 'abcdef12', date: '2026-11-15', title: 'Launch day', emoji: '🚀🚀🚀🚀', color: 'gray' })
})

test('the file reads back only real pins', () => {
  assert.deepEqual(parseCalendar('not json'), { pins: [] })
  assert.equal(parseCalendar(JSON.stringify({ pins: [pin(), { title: 'no date' }, pin({ id: undefined })] })).pins.length, 1)
})

test('which days a pin marks', () => {
  assert.ok(pinOn(pin(), '2026-11-15'))
  assert.ok(!pinOn(pin(), '2026-11-16'))
  const trip = pin({ until: '2026-11-18' })
  assert.ok(pinOn(trip, '2026-11-17') && !pinOn(trip, '2026-11-19'))
  const bday = pin({ date: '2000-02-29', repeat: 'yearly' })
  assert.ok(pinOn(bday, '2027-02-28') && !pinOn(bday, '2028-02-28') && pinOn(bday, '2028-02-29'))
  assert.ok(!pinOn(bday, '1999-02-28'))
})

test('the next time a pin comes round, and the countdown', () => {
  assert.equal(nextOccurrence(pin(), '2026-11-01'), '2026-11-15')
  assert.equal(nextOccurrence(pin(), '2026-12-01'), null)
  assert.equal(nextOccurrence(pin({ date: '1990-03-02', repeat: 'yearly' }), '2026-03-03'), '2027-03-02')
  assert.equal(nextOccurrence(pin({ date: '2028-03-02', repeat: 'yearly' }), '2026-03-03'), '2028-03-02')
  assert.equal(nextOccurrence(pin({ until: '2026-11-20' }), '2026-11-17'), '2026-11-17')
  assert.deepEqual(upcomingPins([pin({ id: 'later123', date: '2026-12-01' }), pin()], '2026-11-01').map((x) => x.date), ['2026-11-15', '2026-12-01'])
  assert.equal(daysBetween('2026-10-26', '2026-11-15'), 20)
})
