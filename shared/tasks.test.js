// Run with: npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTask, editTaskLine, toggleTaskLine, applyTaskEdit, appendTask, newTaskLine, parseRecurrence, nextOccurrence,
  addDays, addMonths, daysBetween, weekdayOf, isIsoDate, bucketOf, compareTasks, priorityRank, TaskChangedError,
  addSubtask, boardColumns, columnOf, columnFields, dateKeyOf, dropPatch, undoPatch, taskTree, splitTags, joinTags,
  hasTag, matchTask, previewEdit, cleanTag, weekStartOf, monthDays,
} from './tasks.js'
import { parseNote } from './parse.js'

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
  assert.equal(weekStartOf(today, 1), '2026-09-28')
  assert.equal(weekStartOf('2026-10-04', 0), '2026-10-04')
  const oct = monthDays(today, 1)
  assert.deepEqual([oct[0], oct.at(-1), oct.length], ['2026-09-28', '2026-11-01', 35])
  assert.equal(monthDays('2027-02-10', 1).length, 28, 'a February that fits four weeks')
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

test('new tasks can start in progress', () => {
  assert.equal(newTaskLine('Draft', { status: '/', priority: 'high' }), '- [/] Draft ⏫')
  assert.equal(newTaskLine('Draft', { status: 'x' }), '- [ ] Draft', 'only open or in progress')
})

test('applyTaskEdit: taking back the completion of a repeating task takes its next occurrence with it', () => {
  const note = '- [ ] Pay rent 🔁 every month 📅 2026-10-01\n- [ ] three\n'
  const done = applyTaskEdit(note, { line: 0, title: 'Pay rent', patch: { status: 'x' }, today })
  const back = applyTaskEdit(done.text, { line: 0, title: 'Pay rent', patch: { status: ' ' }, today, dropNext: true })
  assert.equal(back.text, '- [ ] Pay rent 🔁 every month 📅 2026-10-01\n- [ ] three\n')
  // without it the reopened task would sit beside the copy
  assert.ok(applyTaskEdit(done.text, { line: 0, title: 'Pay rent', patch: { status: ' ' }, today }).text.includes('2026-11-01'))
  // a line that is not that copy stays
  const other = '- [x] Pay rent 🔁 every month 📅 2026-10-01 ✅ 2026-10-03\n- [ ] Pay rent 🔁 every week 📅 2026-10-08\n'
  assert.equal(applyTaskEdit(other, { line: 0, title: 'Pay rent', patch: { status: ' ' }, today, dropNext: true }).text.split('\n').length, 3)
})

test('subtasks: go under their task, after what is already nested there', () => {
  const sub = (note, line, title = null) => addSubtask(note, { line, title }, '- [ ] new')
  assert.deepEqual(sub('- [ ] a\n- [ ] b\n', 0), { text: '- [ ] a\n  - [ ] new\n- [ ] b\n', line: 1 })
  assert.equal(sub('- [ ] a\n  - [ ] one\n    - [ ] deep\n  note text\n- [ ] b\n', 0).text, '- [ ] a\n  - [ ] one\n    - [ ] deep\n  note text\n  - [ ] new\n- [ ] b\n')
  assert.equal(sub('- [ ] a\n    - [ ] one\n', 0).text, '- [ ] a\n    - [ ] one\n    - [ ] new\n', 'indented like the others')
  assert.equal(sub('1. [ ] a\n\n- [ ] b', 0).text, '1. [ ] a\n   - [ ] new\n\n- [ ] b', 'inside a numbered item, past its marker')
  assert.equal(sub('\t- [ ] a\r\n\t- [ ] b\r\n', 0).text, '\t- [ ] a\r\n\t\t- [ ] new\r\n\t- [ ] b\r\n')
  assert.equal(sub('x\n- [ ] a', 0, 'a').line, 2, 'found by its title when the line has moved')
  assert.throws(() => sub('- [ ] a', 0, 'b'), TaskChangedError)
})

test('boards: the columns of a grouping, and where a task is', () => {
  assert.deepEqual(boardColumns('status').map((c) => c.id), ['todo', 'doing', 'done'])
  assert.deepEqual(boardColumns('date', { done: false }).map((c) => c.id), ['overdue', 'today', 'tomorrow', 'week', 'later', 'none'])
  assert.deepEqual(boardColumns('priority').map((c) => c.id), ['highest', 'high', 'medium', 'low', 'lowest', 'none', 'done'])
  const t = (extra) => ({ status: ' ', line: 0, ...extra })
  assert.equal(columnOf(t({}), 'status', today), 'todo')
  assert.equal(columnOf(t({ status: '/' }), 'status', today), 'doing')
  assert.equal(columnOf(t({ status: '-' }), 'status', today), 'done', 'cancelled sits with done')
  assert.equal(columnOf(t({ due: '2026-10-02' }), 'date', today), 'overdue')
  assert.equal(columnOf(t({ status: 'x', due: '2026-10-02' }), 'date', today), 'done')
  assert.equal(columnOf(t({ priority: 'low' }), 'priority', today), 'low')
  assert.equal(columnOf(t({}), 'priority', today), 'none')
})

test('boards: dropping a card on a column changes the field the column is about', () => {
  const task = (line) => ({ ...parseTask(line), line: 0 })
  const apply = (line, group, column) => {
    const patch = dropPatch(task(line), group, column, today)
    return patch && editTaskLine(line, patch, { today })
  }
  assert.equal(apply('- [ ] a', 'status', 'doing').line, '- [/] a')
  assert.equal(apply('- [/] a', 'status', 'done').line, '- [x] a ✅ 2026-10-03')
  assert.equal(apply('- [x] a ✅ 2026-10-01', 'status', 'todo').line, '- [ ] a')
  assert.equal(apply('- [ ] a', 'status', 'todo'), null, 'already there')
  assert.equal(apply('- [ ] a 📅 2026-10-20', 'date', 'today').line, '- [ ] a 📅 2026-10-03')
  assert.equal(apply('- [ ] a', 'date', 'tomorrow').line, '- [ ] a 📅 2026-10-04')
  assert.equal(apply('- [ ] a 📅 2026-10-03', 'date', 'week').line, '- [ ] a 📅 2026-10-05')
  assert.equal(apply('- [ ] a', 'date', 'later').line, '- [ ] a 📅 2026-11-03')
  assert.equal(apply('- [ ] a ⏳ 2026-10-20', 'date', 'tomorrow').line, '- [ ] a ⏳ 2026-10-04', 'moves the date it sits on')
  assert.equal(apply('- [ ] a 🛫 2026-10-01 ⏳ 2026-10-02 📅 2026-10-20', 'date', 'none').line, '- [ ] a')
  assert.equal(apply('- [ ] a', 'date', 'overdue'), null, 'a past date is not something to drop on')
  assert.equal(apply('- [x] a ✅ 2026-10-01', 'date', 'today').line, '- [ ] a 📅 2026-10-03', 'out of Done: open again')
  assert.equal(apply('- [ ] a', 'priority', 'high').line, '- [ ] a ⏫')
  assert.equal(apply('- [ ] a ⏫', 'priority', 'none').line, '- [ ] a')
  assert.equal(apply('- [ ] a ⏫', 'priority', 'done').line, '- [x] a ⏫ ✅ 2026-10-03')
  // finishing goes through the same status logic as the checkbox, so a repeating task repeats
  assert.equal(apply('- [ ] a 🔁 every day 📅 2026-10-03', 'status', 'done').next, '- [ ] a 🔁 every day 📅 2026-10-04')
  assert.equal(columnFields('priority', 'low', today).priority, 'low')
  assert.equal(dateKeyOf({}), 'due')
  assert.equal(dateKeyOf({ start: today }), 'start')
})

test('boards: undoing a change restores the line', () => {
  for (const [line, group, column] of [
    ['- [x] a ✅ 2026-10-01 📅 2026-10-02', 'status', 'doing'],
    ['- [ ] a ⏫ 📅 2026-10-20', 'date', 'none'],
    ['- [ ] a ⏳ 2026-10-20', 'date', 'today'],
    ['- [-] a ❌ 2026-10-01', 'priority', 'low'],
    ['- [ ] a ⏫', 'status', 'done'],
  ]) {
    const task = { ...parseTask(line), line: 0 }
    const patch = dropPatch(task, group, column, today)
    const moved = editTaskLine(line, patch, { today }).line
    assert.notEqual(moved, line)
    assert.equal(parseTask(editTaskLine(moved, undoPatch(task, patch), { today }).line).text, task.text)
    assert.deepEqual(parseTask(editTaskLine(moved, undoPatch(task, patch), { today }).line), parseTask(line), line)
  }
  assert.deepEqual(undoPatch({ text: 'old', due: '2026-10-05' }, { title: 'new', due: '2026-10-09', priority: 'low' }), { title: 'old', due: '2026-10-05', priority: null })
})

test('checklists: what is nested under a task, and how far along it is', () => {
  const note = '- [ ] Trip\n  - [x] Flights\n  - [ ] Hotel\n    - [-] Ask Sam\n- [ ] Rent\n\n- [ ] Lonely'
  const { roots, lists } = taskTree(parseNote(note).tasks)
  assert.deepEqual(roots.map((t) => t.text), ['Trip', 'Rent', 'Lonely'])
  const trip = lists.get(0)
  assert.deepEqual(trip.items.map((i) => [i.task.text, i.depth]), [['Flights', 1], ['Hotel', 1], ['Ask Sam', 2]])
  assert.deepEqual([trip.done, trip.total], [2, 3], 'cancelled counts as finished')
  assert.equal(lists.get(4), undefined)
})

test('tags: the ones that end a title, and filters', () => {
  assert.deepEqual(splitTags('Pay rent #home/bills #monthly'), { title: 'Pay rent', tags: ['home/bills', 'monthly'] })
  assert.deepEqual(splitTags('Call #sam about it'), { title: 'Call #sam about it', tags: [] })
  assert.deepEqual(splitTags('#only'), { title: '#only', tags: [] })
  assert.equal(joinTags('Pay rent', ['a', 'b']), 'Pay rent #a #b')
  assert.equal(joinTags('Pay rent', []), 'Pay rent')
  assert.equal(cleanTag(' #Home Office! '), 'Home-Office')
  assert.equal(cleanTag('home/'), 'home')
  assert.equal(cleanTag('2026'), '', 'a number is not a tag')
  assert.equal(cleanTag('  #  '), '')
  const t = { text: 'Pay rent #Home/Bills', tags: ['Home/Bills'], priority: 'high', path: 'Daily/2026-10-03.md' }
  assert.ok(hasTag(t, 'home') && hasTag(t, 'home/bills') && !hasTag(t, 'hom'))
  assert.ok(matchTask(t, {}) && matchTask(t, { q: ' RENT ' }) && matchTask(t, { q: 'daily' }) && !matchTask(t, { q: 'milk' }))
  assert.ok(matchTask(t, { tags: ['work', 'home'] }) && !matchTask(t, { tags: ['work'] }), 'any of the tags')
  assert.ok(matchTask(t, { priority: 'high' }) && !matchTask(t, { priority: 'low' }) && !matchTask(t, { priority: 'none' }) && matchTask({ text: 'x' }, { priority: 'none' }))
})

test('preview: a change worked out without the note is the change the note gets', () => {
  const lines = ['  - [ ] Ship #work 🔼 🔁 every week 🛫 2026-10-01 ⏳ 2026-10-02 📅 2026-10-05', '- [/] Half way', '- [x] Done ✅ 2026-10-01 📅 2026-09-30']
  for (const line of lines) {
    const task = { ...parseTask(line), line: 7, parent: 3 }
    for (const patch of [{ status: 'x' }, { status: ' ' }, { due: null, priority: 'low' }, { title: 'Renamed #x' }, { recurrence: 'every day' }]) {
      const want = parseTask(editTaskLine(line, patch, { today }).line)
      assert.deepEqual(previewEdit(task, patch, { today }), { ...want, line: 7, parent: 3 }, `${line} ← ${JSON.stringify(patch)}`)
    }
  }
})
