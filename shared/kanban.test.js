// Run with: npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseBoard, serializeBoard, cloneBoard, isBoardContent, newProjectContent, rulesOf, moveCard, setCardStatus, addCard, laneNamed,
  cardTask, cardDetails, setDescription, addChecklistItem, editChecklistItem, removeChecklistItem, renameLane, setRules, archiveCard,
  restoreCard, applyStatusRules, addCardToText, moveCardInText, laneOfTask, findCard,
} from './kanban.js'
import { parseNote } from './parse.js'

const today = '2026-10-15'

const SAMPLE = `---
kanban-plugin: board
---

## To do

- [ ] Write the brief #design 📅 2026-10-20
	Some notes
	- [ ] Ask Sam
	- [x] Find the old one
- [ ] Second

## Doing

## Done

**Complete**
- [x] Set up the repo ✅ 2026-10-14

***

## Archive

- [x] Old card

%% kanban:settings
\`\`\`
{"kanban-plugin":"board","list-collapse":[false]}
\`\`\`
%%
`

test('a board reads into lists and cards, and writes back as it was', () => {
  const b = parseBoard(SAMPLE)
  assert.deepEqual(b.lanes.map((l) => l.title), ['To do', 'Doing', 'Done'])
  assert.equal(b.lanes[0].items.length, 2)
  assert.deepEqual(b.lanes[0].items[0].extra, ['\tSome notes', '\t- [ ] Ask Sam', '\t- [x] Find the old one'])
  assert.equal(b.lanes[2].complete, true)
  assert.equal(b.archive.length, 1)
  assert.deepEqual(b.settings, { 'kanban-plugin': 'board', 'list-collapse': [false] })
  assert.equal(serializeBoard(b), SAMPLE)
})

test('card lines are the note’s own line numbers', () => {
  const b = parseBoard(SAMPLE)
  const lines = SAMPLE.split('\n')
  for (const lane of b.lanes) for (const c of lane.items) assert.ok(lines[c.line].endsWith(c.text), c.text)
  assert.equal(lines[b.lanes[1].line], '## Doing')
})

test('nested list items stay with their card instead of becoming cards', () => {
  const b = parseBoard('---\nkanban-plugin: board\n---\n\n## A\n\n- [ ] Card\n    - [ ] sub\n\n        more\n- [ ] Next\n')
  assert.equal(b.lanes[0].items.length, 2)
  assert.deepEqual(b.lanes[0].items[0].extra, ['    - [ ] sub', '', '        more'])
})

test('Windows line endings survive', () => {
  const crlf = SAMPLE.replace(/\n/g, '\r\n')
  assert.equal(serializeBoard(parseBoard(crlf)), crlf)
})

test('isBoardContent reads the front matter', () => {
  assert.ok(isBoardContent(SAMPLE))
  assert.ok(isBoardContent('---\r\nkanban-plugin: basic\r\n---\r\n'))
  assert.ok(!isBoardContent('---\ntitle: x\n---\n\n## kanban-plugin: no\n'))
  assert.ok(!isBoardContent('# Note\n'))
})

test('a new project has To do, Doing and Done, and rules for them', () => {
  const text = newProjectContent()
  assert.ok(isBoardContent(text))
  const b = parseBoard(text)
  assert.deepEqual(b.lanes.map((l) => l.title), ['To do', 'Doing', 'Done'])
  assert.ok(rulesOf(b).length >= 6)
  // the settings block hides from the index like any comment, and has no tasks
  assert.equal(parseNote(text).tasks.length, 0)
})

test('moving a card into Done marks it done; out of Done, open again; into Doing, in progress', () => {
  const b = parseBoard(newProjectContent())
  const [todo, doing, done] = b.lanes
  const { card } = addCard(b, todo, 'Ship it', {}, { today })
  moveCard(b, card, done, null, { today })
  assert.equal(card.status, 'x')
  assert.match(card.text, /✅ 2026-10-15/)
  moveCard(b, card, doing, null, { today })
  assert.equal(card.status, '/')
  assert.doesNotMatch(card.text, /✅/)
  moveCard(b, card, todo, null, { today })
  assert.equal(card.status, ' ')
})

test('ticking a card moves it to the top of Done; unticking moves it back to To do', () => {
  const b = parseBoard(newProjectContent())
  const [todo, , done] = b.lanes
  addCard(b, done, 'Already there', { status: 'x' }, { today })
  const { card } = addCard(b, todo, 'Pay rent', {}, { today })
  setCardStatus(b, card, 'x', { today })
  assert.equal(done.items[0], card)
  assert.equal(todo.items.length, 0)
  setCardStatus(b, card, ' ', { today })
  assert.ok(todo.items.includes(card))
})

test('turning a rule off stops it; a board with no rules does nothing', () => {
  const b = parseBoard(newProjectContent())
  const [todo, , done] = b.lanes
  setRules(b, rulesOf(b).map((r) => (r.on === 'into' && r.list === 'Done' ? { ...r, off: true } : r)))
  const { card } = addCard(b, todo, 'Draft', {}, { today })
  moveCard(b, card, done, null, { today })
  assert.equal(card.status, ' ')
  setRules(b, [])
  setCardStatus(b, card, 'x', { today })
  assert.ok(done.items.includes(card))
  const again = parseBoard(serializeBoard(b))
  assert.deepEqual(rulesOf(again), [])
})

test('rules do not set off other rules', () => {
  const b = parseBoard(newProjectContent())
  const [todo, doing, done] = b.lanes
  const { card } = addCard(b, done, 'Done thing', { status: 'x' }, { today })
  // out of Done → open (a status change, which would move it to To do if rules chained)
  moveCard(b, card, doing, null, { today })
  assert.ok(doing.items.includes(card))
  assert.equal(card.status, '/')
  assert.ok(!todo.items.includes(card))
})

test('a board made in Obsidian gets rules from its list names', () => {
  const b = parseBoard('---\nkanban-plugin: basic\n---\n\n## Backlog\n\n- [ ] A\n\n## In progress\n\n## Done\n\n')
  const card = b.lanes[0].items[0]
  moveCard(b, card, laneNamed(b, 'done'), null, { today })
  assert.equal(card.status, 'x')
})

test('renaming a list renames it in the rules', () => {
  const b = parseBoard(newProjectContent())
  renameLane(b, b.lanes[2], 'Shipped')
  assert.ok(rulesOf(b).some((r) => r.to === 'Shipped'))
  assert.ok(!rulesOf(b).some((r) => r.to === 'Done' || r.list === 'Done'))
})

test('a card’s description and checklist', () => {
  const b = parseBoard(SAMPLE)
  const c = b.lanes[0].items[0]
  const d = cardDetails(c)
  assert.equal(d.description, 'Some notes')
  assert.deepEqual(d.checklist.map((t) => [t.text, t.status, t.depth]), [['Ask Sam', ' ', 0], ['Find the old one', 'x', 0]])
  setDescription(c, 'First line\n\nSecond paragraph')
  addChecklistItem(c, 'Book the room')
  assert.deepEqual(c.extra, ['\tFirst line', '', '\tSecond paragraph', '\t- [ ] Ask Sam', '\t- [x] Find the old one', '\t- [ ] Book the room'])
  // read again, the blank line inside the card is still the card's
  const again = parseBoard(serializeBoard(b))
  assert.equal(cardDetails(again.lanes[0].items[0]).description, 'First line\n\nSecond paragraph')
  editChecklistItem(c, 3, { status: 'x' }, { today })
  assert.match(c.extra[3], /^\t- \[x\] Ask Sam ✅/)
  removeChecklistItem(c, 3)
  assert.equal(c.extra.length, 5)
  setDescription(c, '')
  assert.deepEqual(c.extra, ['\t- [x] Find the old one', '\t- [ ] Book the room'])
})

test('a card is a task: fields, and tags', () => {
  const b = parseBoard(SAMPLE)
  const t = cardTask(b.lanes[0].items[0])
  assert.equal(t.due, '2026-10-20')
  assert.deepEqual(t.tags, ['design'])
})

test('archiving and restoring', () => {
  const b = parseBoard(SAMPLE)
  const c = b.lanes[0].items[1]
  archiveCard(b, c)
  assert.equal(b.archive.length, 2)
  restoreCard(b, c, b.lanes[1])
  assert.ok(b.lanes[1].items.includes(c))
  assert.ok(findCard(cloneBoard(b), c.id))
})

test('on the server: a card ticked from the Tasks page moves to Done', () => {
  const text = newProjectContent().replace('## To do\n', '## To do\n\n- [x] Pay rent ✅ 2026-10-15\n')
  const line = text.split('\n').findIndex((l) => l.includes('Pay rent'))
  const out = applyStatusRules(text, [{ line, status: 'x' }], { today })
  const b = parseBoard(out.text)
  assert.equal(b.lanes[0].items.length, 0)
  assert.equal(b.lanes[2].items[0].text, 'Pay rent ✅ 2026-10-15')
  assert.ok(out.text.split('\n')[out.lines[0]].includes('Pay rent'))
  // a change no rule cares about leaves the text alone
  assert.equal(applyStatusRules(text, [{ line: 0, status: 'x' }], { today }).text, text)
  assert.equal(applyStatusRules('# not a board\n- [x] a\n', [{ line: 1, status: 'x' }], { today }).text, '# not a board\n- [x] a\n')
})

test('on the server: adding a card to a list, and moving one', () => {
  const r = addCardToText(newProjectContent(), '- [ ] Call Sam 📅 2026-10-16', { list: 'doing', today })
  const b = parseBoard(r.text)
  assert.equal(b.lanes[1].items[0].status, '/') // added to Doing: in progress
  assert.equal(r.text.split('\n')[r.line].includes('Call Sam'), true)
  const m = moveCardInText(r.text, { line: r.line, title: 'Call Sam' }, 'Done', { today })
  const b2 = parseBoard(m.text)
  assert.equal(b2.lanes[2].items[0].status, 'x')
  assert.ok(m.text.split('\n')[m.line].includes('Call Sam'))
  assert.equal(moveCardInText(r.text, { line: r.line, title: 'Someone else' }, 'Done', { today }), null)
})

test('the list a task is in, from the index', () => {
  const meta = parseNote(SAMPLE)
  const t = meta.tasks.find((x) => x.text.startsWith('Set up'))
  assert.equal(laneOfTask(meta, t.line), 'Done')
})

test('colours: a card cover follows its card, labels and the board keep theirs', async () => {
  const { setCardCover, cardCover, moveCover, cardKey, editCard, setLabelColor, labelColor, setBoardColor, boardColor, deleteCard } = await import('./kanban.js')
  const b = parseBoard(newProjectContent())
  const { card } = addCard(b, b.lanes[0], 'Design the logo #brand', {}, { today })
  const { card: other } = addCard(b, b.lanes[0], 'Other', {}, { today })
  setCardCover(b, card, 'blue')
  assert.equal(cardCover(b, card), 'blue')
  // done (a ✅ stamp) or retagged, it is the same card
  setCardStatus(b, card, 'x', { today })
  assert.equal(cardCover(b, card), 'blue')
  const was = cardKey(card)
  editCard(card, { title: 'Design the new logo #brand' }, { today })
  moveCover(b, was, card)
  assert.equal(cardCover(b, card), 'blue')
  setLabelColor(b, 'Brand', 'pink')
  assert.equal(labelColor(b, 'brand'), 'pink')
  setBoardColor(b, 'purple')
  assert.equal(boardColor(b), 'purple')
  setBoardColor(b, 'not-a-colour')
  assert.equal(boardColor(b), null)
  // a cover of a card that is gone is dropped the next time covers change
  deleteCard(b, card)
  setCardCover(b, other, 'green')
  assert.deepEqual(b.settings.obi.covers, { other: 'green' })
  // and it all survives being written and read again
  const again = parseBoard(serializeBoard(b))
  assert.equal(cardCover(again, again.lanes[0].items[0]), 'green')
  assert.equal(labelColor(again, 'brand'), 'pink')
})

test('the index knows a board’s colour', () => {
  const b = parseBoard(newProjectContent())
  b.settings.obi.color = 'teal'
  assert.deepEqual(parseNote(serializeBoard(b)).board, { color: 'teal' })
  assert.equal(parseNote('# plain note\n').board, undefined)
})

test('renaming a label renames it on the board and on every card, archive too', async () => {
  const { renameLabel, boardLabels, labelColor } = await import('./kanban.js')
  const b = parseBoard(['---', 'kanban-plugin: board', '---', '', '## To do', '', '- [ ] Write #review #idea', '- [ ] Ship #Review', '- [ ] Plain', '', '***', '', '## Archive', '', '- [x] Old #review', ''].join('\n'))
  assert.equal(renameLabel(b, 'review', 'Needs review', { today }), true)
  assert.deepEqual(boardLabels(b).map((l) => l.name), ['feature', 'needs-review', 'important', 'urgent', 'idea', 'research'])
  assert.equal(labelColor(b, 'needs-review'), 'yellow')
  const text = serializeBoard(b)
  assert.match(text, /- \[ \] Write #needs-review #idea\n/)
  assert.match(text, /- \[ \] Ship #needs-review\n/)
  assert.match(text, /- \[ \] Plain\n/)
  assert.match(text, /- \[x\] Old #needs-review\n/)
  // onto a name the board has: one label, no card twice
  renameLabel(b, 'idea', 'needs-review', { today })
  assert.match(serializeBoard(b), /- \[ \] Write #needs-review\n/)
  assert.equal(renameLabel(b, 'feature', 'feature'), false)
})
