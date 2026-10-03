// Run with: npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTask, editTaskLine, toggleTaskLine, applyTaskEdit, appendTask, newTaskLine, parseRecurrence, nextOccurrence,
  addDays, addMonths, daysBetween, weekdayOf, isIsoDate, bucketOf, compareTasks, priorityRank, TaskChangedError,
} from './tasks.js'

const today = '2026-10-03' // a Saturday

test('dates: arithmetic stays within a day, month and year', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29')
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15')
  assert.equal(daysBetween('2026-10-03', '2026-10-10'), 7)
  assert.equal(weekdayOf(today), 6)
  assert.ok(isIsoDate('2026-02-28') && !isIsoDate('2026-02-30') && !isIsoDate('2026-2-3') && !isIsoDate(null))
})

test('parse: the fields of a task, and the title that is left', () => {
  const t = parseTask('  - [ ] Pay rent #home/bills 🔼 🔁 every month 🛫 2026-10-25 ⏳ 2026-10-28 📅 2026-11-01 ^blk')
  assert.deepEqual(t, {
    text: 'Pay rent #home/bills', status: ' ', checked: false, indent: 2,
    priority: 'medium', recurrence: 'every month', start: '2026-10-25', scheduled: '2026-10-28', due: '2026-11-01', tags: ['home/bills'],
  })
})

test('parse: done, cancelled and in-progress; plain tasks stay small', () => {
  assert.equal(parseTask('- [x] Ship it ✅ 2026-10-02').checked, true)
  assert.equal(parseTask('- [X] Ship it').checked, true)
  assert.equal(parseTask('1. [/] Half way').status, '/')
  assert.deepEqual(parseTask('- [-] Dropped ❌ 2026-10-01'), { text: 'Dropped', status: '-', checked: false, indent: 0, cancelled: '2026-10-01' })
  assert.deepEqual(parseTask('- [ ] Just this'), { text: 'Just this', status: ' ', checked: false, indent: 0 })
  assert.equal(parseTask('- [ ]'). text, '')
  assert.equal(parseTask('- not a task'), null)
  assert.equal(parseTask('- [link](x) is not a task'), null)
  assert.equal(parseTask('- [ ] windows line ending 📅 2026-10-05\r').due, '2026-10-05')
})

test('parse: the older and Dataview date forms, and the variation selector', () => {
  assert.equal(parseTask('- [ ] a due:: 2026-10-05').due, '2026-10-05')
  assert.equal(parseTask('- [ ] a [due:: 2026-10-05] b').text, 'a b')
  assert.equal(parseTask('- [ ] a @due(2026-10-05)').due, '2026-10-05')
  assert.equal(parseTask('- [ ] a 📅️ 2026-10-05').due, '2026-10-05')
  assert.equal(parseTask('- [ ] a 🗓️ 2026-10-05').due, '2026-10-05')
  assert.equal(parseTask('- [ ] it was overdue: 2026-10-05').due, undefined, '"overdue:" is not a due date')
})

test('edit: a date is replaced in place, added at the end, or removed', () => {
  assert.equal(editTaskLine('- [ ] Call Sam 📅 2026-10-05 #work', { due: '2026-10-09' }).line, '- [ ] Call Sam 📅 2026-10-09 #work')
  assert.equal(editTaskLine('- [ ] Call Sam', { due: '2026-10-09', priority: 'high' }).line, '- [ ] Call Sam 📅 2026-10-09 ⏫')
  assert.equal(editTaskLine('- [ ] Call Sam 📅 2026-10-05 #work', { due: null }).line, '- [ ] Call Sam #work')
  assert.equal(editTaskLine('- [ ] a [due:: 2026-10-05]', { due: '2026-10-06' }).line, '- [ ] a [due:: 2026-10-06]', 'keeps the style it was written in')
  assert.equal(editTaskLine('- [ ] a ⏫ 📅 2026-10-05', { priority: 'low' }).line, '- [ ] a 🔽 📅 2026-10-05')
  assert.equal(editTaskLine('- [ ] a 🔁 every week 📅 2026-10-05', { recurrence: 'every 2 weeks' }).line, '- [ ] a 🔁 every 2 weeks 📅 2026-10-05')
  assert.equal(editTaskLine('- [ ] a ^id1', { due: '2026-10-05' }).line, '- [ ] a 📅 2026-10-05 ^id1', 'a block id stays last')
  assert.equal(editTaskLine('\t- [ ] a\r', { priority: 'highest' }).line, '\t- [ ] a 🔺\r')
})

test('edit: a new title keeps the fields', () => {
  assert.equal(editTaskLine('- [ ] Call Sam 📅 2026-10-05 ⏫', { title: 'Call Samantha' }).line, '- [ ] Call Samantha 📅 2026-10-05 ⏫')
})

test('edit: refuses what is not a date, a priority or a repeat rule', () => {
  assert.throws(() => editTaskLine('- [ ] a', { due: '5 Oct' }), RangeError)
  assert.throws(() => editTaskLine('- [ ] a', { due: '2026-02-30' }), RangeError)
  assert.throws(() => editTaskLine('- [ ] a', { priority: 'urgent' }), RangeError)
  assert.throws(() => editTaskLine('- [ ] a', { recurrence: 'sometimes' }), RangeError)
  assert.equal(editTaskLine('not a task', { due: '2026-10-05' }), null)
})

test('status: done stamps the day, reopening takes it off', () => {
  assert.equal(toggleTaskLine('- [ ] Ship it 📅 2026-10-05', { today }).line, '- [x] Ship it 📅 2026-10-05 ✅ 2026-10-03')
  assert.equal(toggleTaskLine('- [x] Ship it ✅ 2026-10-03', { today }).line, '- [ ] Ship it')
  assert.equal(toggleTaskLine('- [/] Half way', { today }).line, '- [x] Half way ✅ 2026-10-03')
  assert.equal(toggleTaskLine('- [-] Dropped ❌ 2026-10-01', { today }).line, '- [ ] Dropped')
  assert.equal(editTaskLine('- [ ] a', { status: '-' }, { today }).line, '- [-] a ❌ 2026-10-03')
  assert.equal(editTaskLine('- [x] a ✅ 2026-10-01', { status: '/' }, { today }).line, '- [/] a')
  // already done: the stamp is not touched by an unrelated edit
  assert.equal(editTaskLine('- [x] a ✅ 2026-10-01', { priority: 'low' }, { today }).line, '- [x] a ✅ 2026-10-01 🔽')
  assert.equal(toggleTaskLine('plain', { today }), null)
})

test('recurrence: the rules we understand', () => {
  assert.deepEqual(parseRecurrence('every day'), { n: 1, unit: 'day', whenDone: false })
  assert.deepEqual(parseRecurrence('Every 2 Weeks'), { n: 2, unit: 'week', whenDone: false })
  assert.deepEqual(parseRecurrence('every month when done'), { n: 1, unit: 'month', whenDone: true })
  assert.deepEqual(parseRecurrence('weekly'), { n: 1, unit: 'week', whenDone: false })
  assert.deepEqual(parseRecurrence('every weekday').weekdays, [1, 2, 3, 4, 5])
  assert.deepEqual(parseRecurrence('every monday and friday').weekdays, [1, 5])
  assert.deepEqual(parseRecurrence('every week on sunday').weekdays, [0])
  assert.equal(parseRecurrence('whenever'), null)
  assert.equal(parseRecurrence(''), null)
})

test('recurrence: the next date', () => {
  assert.equal(nextOccurrence(parseRecurrence('every 3 days'), '2026-10-30'), '2026-11-02')
  assert.equal(nextOccurrence(parseRecurrence('every month'), '2026-01-31'), '2026-02-28')
  assert.equal(nextOccurrence(parseRecurrence('every year'), '2028-02-29'), '2029-02-28')
  assert.equal(nextOccurrence(parseRecurrence('every weekday'), '2026-10-02'), '2026-10-05', 'Friday → Monday')
  assert.equal(nextOccurrence(parseRecurrence('every monday and friday'), '2026-10-05'), '2026-10-09')
})

test('completing a repeating task produces its next occurrence', () => {
  const r = toggleTaskLine('- [ ] Pay rent 🔁 every month 📅 2026-10-01', { today })
  assert.equal(r.line, '- [x] Pay rent 🔁 every month 📅 2026-10-01 ✅ 2026-10-03')
  assert.equal(r.next, '- [ ] Pay rent 🔁 every month 📅 2026-11-01')
})

test('a repeating task moves all its dates by the same distance, and counts from the day done if asked', () => {
  const r = toggleTaskLine('- [ ] Report 🔁 every week 🛫 2026-10-01 ⏳ 2026-10-02 📅 2026-10-05', { today })
  assert.equal(r.next, '- [ ] Report 🔁 every week 🛫 2026-10-08 ⏳ 2026-10-09 📅 2026-10-12')
  const w = toggleTaskLine('- [ ] Water plants 🔁 every 3 days when done 📅 2026-09-20', { today })
  assert.equal(w.next, '- [ ] Water plants 🔁 every 3 days when done 📅 2026-10-06')
})

test('a repeating task with no date gets its next one as a due date; a block id stays last', () => {
  assert.equal(toggleTaskLine('- [ ] Stretch 🔁 every day', { today }).next, '- [ ] Stretch 🔁 every day 📅 2026-10-04')
  assert.equal(toggleTaskLine('- [ ] Stretch 🔁 every day 📅 2026-10-03 ^s1', { today }).next, '- [ ] Stretch 🔁 every day 📅 2026-10-04 ^s1')
})

test('cancelling, reopening or editing a repeating task does not repeat it', () => {
  assert.equal(editTaskLine('- [ ] a 🔁 every day 📅 2026-10-03', { status: '-' }, { today }).next, null)
  assert.equal(editTaskLine('- [x] a 🔁 every day 📅 2026-10-03 ✅ 2026-10-03', { status: ' ' }, { today }).next, null)
  assert.equal(editTaskLine('- [ ] a 🔁 every day 📅 2026-10-03', { priority: 'low' }, { today }).next, null)
  assert.equal(toggleTaskLine('- [ ] a 🔁 gibberish 📅 2026-10-03', { today }).next, null)
})

test('applyTaskEdit: edits the line, inserts the next occurrence under it', () => {
  const note = '# Plan\n\n- [ ] one\n- [ ] Pay rent 🔁 every month 📅 2026-10-01\n- [ ] three\n'
  const r = applyTaskEdit(note, { line: 3, title: 'Pay rent', patch: { status: 'x' }, today })
  assert.equal(r.text, '# Plan\n\n- [ ] one\n- [x] Pay rent 🔁 every month 📅 2026-10-01 ✅ 2026-10-03\n- [ ] Pay rent 🔁 every month 📅 2026-11-01\n- [ ] three\n')
  assert.equal(r.line, 3)
  assert.equal(r.task.checked, true)
  assert.equal(r.next.due, '2026-11-01')
})

test('applyTaskEdit: a task that moved is found by its title; a changed one is refused', () => {
  const moved = '# Plan\n\nnew paragraph\n\n- [ ] one\n- [ ] two\n'
  assert.equal(applyTaskEdit(moved, { line: 2, title: 'two', patch: { due: '2026-10-09' }, today }).line, 5)
  assert.throws(() => applyTaskEdit(moved, { line: 2, title: 'three', patch: { status: 'x' }, today }), TaskChangedError)
  const twins = '- [ ] same\n- [ ] same\n'
  assert.equal(applyTaskEdit(twins, { line: 1, title: 'same', patch: { status: 'x' }, today }).line, 1)
  assert.throws(() => applyTaskEdit(twins, { line: 7, title: 'same', patch: { status: 'x' }, today }), TaskChangedError)
})

test('new tasks: appended after their siblings, or after a blank line', () => {
  assert.equal(appendTask('', '- [ ] a'), '- [ ] a\n')
  assert.equal(appendTask('# Day\n', '- [ ] a'), '# Day\n\n- [ ] a\n')
  assert.equal(appendTask('- [ ] x\n- [x] y\n', '- [ ] a'), '- [ ] x\n- [x] y\n- [ ] a\n')
  assert.equal(newTaskLine('  Buy   milk ', { due: '2026-10-04', priority: 'low' }), '- [ ] Buy milk 📅 2026-10-04 🔽')
})

test('lists: which part of the day a task belongs to, and the order within it', () => {
  const t = (extra) => ({ status: ' ', line: 0, ...extra })
  assert.equal(bucketOf(t({ due: '2026-10-02' }), today), 'overdue')
  assert.equal(bucketOf(t({ due: today }), today), 'today')
  assert.equal(bucketOf(t({ due: '2026-10-04' }), today), 'tomorrow')
  assert.equal(bucketOf(t({ due: '2026-10-10' }), today), 'week')
  assert.equal(bucketOf(t({ due: '2026-10-11' }), today), 'later')
  assert.equal(bucketOf(t({}), today), 'none')
  assert.equal(bucketOf(t({ scheduled: today }), today), 'today', 'a scheduled day counts when there is no due date')
  assert.equal(bucketOf(t({ status: 'x', due: '2026-10-02' }), today), 'done')
  assert.equal(bucketOf(t({ status: '-' }), today), 'done')
  assert.ok(priorityRank('highest') > priorityRank('high') && priorityRank('medium') > priorityRank(undefined) && priorityRank(undefined) > priorityRank('low'))
  const sorted = [t({ path: 'b', line: 1, due: '2026-10-05' }), t({ path: 'a', line: 2 }), t({ path: 'a', line: 1, due: '2026-10-05', priority: 'high' }), t({ status: 'x', due: '2026-10-01' })].sort(compareTasks)
  assert.deepEqual(sorted.map((x) => `${x.path || '-'}${x.line}`), ['a1', 'b1', 'a2', '-0'])
})
