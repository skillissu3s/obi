// The task endpoints, against a real server on a scratch data directory.
// Run with: npm test
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let child
let dir
let base
let alice // a session cookie
let bob // another person, who is not in alice's workspace
let ws

const call = async (cookie, method, url, body) => {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-obi': '1', ...(cookie && { cookie }) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let data = text
  try {
    data = JSON.parse(text)
  } catch {}
  return { status: res.status, data, cookie: res.headers.getSetCookie?.()[0]?.split(';')[0] }
}
const put = (p, content) => call(alice, 'PUT', `/api/workspaces/${ws}/note`, { path: p, content })
const read = async (p) => (await call(alice, 'GET', `/api/workspaces/${ws}/note?path=${encodeURIComponent(p)}`)).data.content
const many = (cookie, body) => call(cookie, 'POST', `/api/workspaces/${ws}/tasks/update-many`, body)
const one = (body) => call(alice, 'POST', `/api/workspaces/${ws}/tasks/update`, body)

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'obi-tasks-'))
  const port = await freePort()
  base = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: root, env: { ...process.env, DATA_DIR: dir, PORT: String(port), NODE_ENV: 'test' }, stdio: 'ignore' })
  for (let i = 0; ; i++) {
    if (i > 100) throw new Error('the server did not start')
    try {
      if ((await fetch(`${base}/healthz`)).ok) break
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  const setup = await call(null, 'POST', '/api/auth/setup', { username: 'alice', password: 'password123', displayName: 'Alice', email: 'alice@example.com' })
  assert.equal(setup.status, 200)
  alice = setup.cookie
  await call(alice, 'POST', '/api/admin/users', { username: 'bob', password: 'password123', displayName: 'Bob', email: 'bob@example.com' })
  bob = (await call(null, 'POST', '/api/auth/login', { identifier: 'bob@example.com', password: 'password123' })).cookie
  assert.ok(bob, 'bob can sign in')
  ws = (await call(alice, 'GET', '/api/workspaces')).data.workspaces[0].id
})

after(() => {
  child?.kill()
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const today = '2026-10-03'

test('update-many: the tasks of several notes in one request, each answered', async () => {
  await put('a.md', '# A\n\n- [ ] one 📅 2026-10-01\n- [ ] two 🔁 every week 📅 2026-10-03\n  - [x] two a ✅ 2026-10-01\n- [ ] three\n')
  await put('b.md', '- [ ] four\n- [ ] five 📅 2026-09-01\n')
  const r = await many(alice, {
    today,
    items: [
      { path: 'a.md', line: 2, title: 'one', patch: { due: today } },
      { path: 'a.md', line: 3, title: 'two', patch: { status: 'x' } },
      { path: 'b.md', line: 1, title: 'five', patch: { due: today } },
      { path: 'b.md', line: 0, title: 'four', patch: { priority: 'high' } },
    ],
  })
  assert.equal(r.status, 200)
  assert.equal(r.data.results.length, 4)
  assert.ok(r.data.results.every((x) => !x.error))
  assert.deepEqual(r.data.results.map((x) => x.line), [2, 3, 1, 0])
  assert.equal(r.data.results[1].next.due, '2026-10-10')
  assert.equal(await read('a.md'), `# A\n\n- [ ] one 📅 ${today}\n- [x] two 🔁 every week 📅 2026-10-03 ✅ ${today}\n  - [x] two a ✅ 2026-10-01\n- [ ] two 🔁 every week 📅 2026-10-10\n  - [ ] two a\n- [ ] three\n`)
  assert.equal(await read('b.md'), `- [ ] four ⏫\n- [ ] five 📅 ${today}\n`)
  // the server says where each task is now: this is what taking the change back goes by
  const back = await many(alice, {
    today,
    items: [
      { path: 'a.md', line: 2, title: 'one', patch: { due: '2026-10-01' } },
      { path: 'a.md', line: 3, title: 'two', patch: { status: ' ' }, dropNext: true },
    ],
  })
  assert.deepEqual(back.data.results.map((x) => x.dropped), [undefined, true])
  assert.equal(await read('a.md'), '# A\n\n- [ ] one 📅 2026-10-01\n- [ ] two 🔁 every week 📅 2026-10-03\n  - [x] two a ✅ 2026-10-01\n- [ ] three\n')
})

test('update-many: what cannot be done is said, the rest is done', async () => {
  await put('c.md', '- [ ] ok 📅 2026-10-01\n- [ ] changed\n')
  const r = await many(alice, {
    today,
    items: [
      { path: 'c.md', line: 0, title: 'ok', patch: { due: today } },
      { path: 'c.md', line: 1, title: 'was something else', patch: { status: 'x' } }, // the note changed
      { path: 'c.md', line: 0, title: 'ok', patch: { due: 'tomorrow' } }, // not a date
      { path: 'c.md', line: -1, title: 'ok', patch: {} }, // not a line
      { path: 'c.md', line: 0, title: 'ok' }, // no change
      { path: '../c.md', line: 0, title: 'ok', patch: {} }, // not a path in the workspace
      { path: '.hidden/c.md', line: 0, title: 'ok', patch: {} },
      { path: 'missing.md', line: 0, title: 'ok', patch: { status: 'x' } },
      null,
      'c.md',
    ],
  })
  assert.equal(r.status, 200)
  assert.deepEqual(
    r.data.results.map((x) => x.status ?? 'done'),
    ['done', 409, 400, 400, 400, 400, 400, 404, 400, 400],
  )
  assert.ok(r.data.results.every((x) => x.status === undefined || typeof x.error === 'string'))
  assert.equal(await read('c.md'), `- [ ] ok 📅 ${today}\n- [ ] changed\n`)
})

test('update-many: the request itself is checked', async () => {
  const bad = (body) => many(alice, body).then((r) => r.status)
  assert.equal(await bad({}), 400)
  assert.equal(await bad({ items: [] }), 400)
  assert.equal(await bad({ items: 'a.md' }), 400)
  assert.equal(await bad({ items: Array.from({ length: 1001 }, () => ({ path: 'a.md', line: 0, patch: {} })) }), 400)
  assert.equal(await bad({ today: 'yesterday', items: [{ path: 'a.md', line: 0, patch: {} }] }), 400)
  // as many as it may take
  await put('d.md', Array.from({ length: 1000 }, (_, i) => `- [ ] task ${i}`).join('\n') + '\n')
  const r = await many(alice, { today, items: Array.from({ length: 1000 }, (_, i) => ({ path: 'd.md', line: i, title: `task ${i}`, patch: { due: today } })) })
  assert.equal(r.status, 200)
  assert.ok(r.data.results.every((x) => !x.error))
  assert.equal((await read('d.md')).split('\n').filter((l) => l.endsWith(`📅 ${today}`)).length, 1000)
  // not signed in
  assert.equal((await many(null, { items: [{ path: 'a.md', line: 0, patch: {} }] })).status, 401)
})

test('update-many: somebody who cannot edit a note cannot change its tasks this way either', async () => {
  await put('e.md', '- [ ] mine 📅 2026-10-01\n')
  const r = await many(bob, { today, items: [{ path: 'e.md', line: 0, title: 'mine', patch: { due: today } }] })
  assert.equal(r.status, 200)
  assert.deepEqual(r.data.results.map((x) => x.status), [404], 'the note is not there, as far as he can tell')
  assert.equal(await read('e.md'), '- [ ] mine 📅 2026-10-01\n')
})

test('update: taking back a completion leaves a next occurrence that was changed, and says so', async () => {
  const note = '- [ ] w 🔁 every week 📅 2026-10-03\n  - [ ] sub\n- [ ] other\n'
  await put('f.md', note)
  const done = await one({ path: 'f.md', line: 0, title: 'w', patch: { status: 'x' }, today })
  assert.equal(done.status, 200)
  assert.equal(done.data.dropped, undefined)
  assert.equal(await read('f.md'), `- [x] w 🔁 every week 📅 2026-10-03 ✅ ${today}\n  - [ ] sub\n- [ ] w 🔁 every week 📅 2026-10-10\n  - [ ] sub\n- [ ] other\n`)
  // as it was written: it goes
  const undo = { path: 'f.md', line: 0, title: 'w', patch: { status: ' ' }, today, dropNext: true }
  const back = await one(undo)
  assert.equal(back.data.dropped, true)
  assert.equal(await read('f.md'), note)
  // changed since: it stays
  await one({ path: 'f.md', line: 0, title: 'w', patch: { status: 'x' }, today })
  await put('f.md', (await read('f.md')).replace('2026-10-10', '2026-10-20'))
  const kept = await one(undo)
  assert.equal(kept.data.dropped, false)
  assert.equal(await read('f.md'), '- [ ] w 🔁 every week 📅 2026-10-03\n  - [ ] sub\n- [ ] w 🔁 every week 📅 2026-10-20\n  - [ ] sub\n- [ ] other\n')
})

test('update: only what the index reads as a task is edited, wherever the line number points', async () => {
  await put('g.md', '```\n- [ ] example\n```\n\n- [ ] real\n')
  assert.equal((await one({ path: 'g.md', line: 1, title: 'example', patch: { status: 'x' }, today })).status, 409)
  assert.equal((await one({ path: 'g.md', line: 40, title: 'example', patch: { status: 'x' }, today })).status, 409)
  assert.equal((await one({ path: 'g.md', line: 40, title: 'real', patch: { status: 'x' }, today })).data.line, 4)
  assert.equal(await read('g.md'), `\`\`\`\n- [ ] example\n\`\`\`\n\n- [x] real ✅ ${today}\n`)
})
