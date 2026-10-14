// Run with: npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { syncRepo } from './git.js'

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

// a bare "GitHub" and a working copy that has pushed to it once
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'obi-git-'))
  const remote = path.join(root, 'remote.git')
  const work = path.join(root, 'work')
  git(root, 'init', '-q', '--bare', '-b', 'main', remote)
  fs.mkdirSync(work)
  git(work, 'init', '-q', '-b', 'main')
  git(work, 'remote', 'add', 'origin', remote)
  fs.writeFileSync(path.join(work, 'a.md'), 'one\n')
  git(work, 'add', '-A')
  git(work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'first')
  git(work, 'push', '-q', 'origin', 'main')
  return { root, remote, work, opts: { url: remote, branch: 'main', authorName: 't', authorEmail: 't@t' } }
}

test('a save that changed nothing commits nothing and does not touch the remote', async () => {
  const { work, remote, opts } = setup()
  const before = git(remote, 'rev-parse', 'main')
  const r = await syncRepo(work, { ...opts, message: () => 'never', skipIfClean: true })
  assert.equal(r.clean, true)
  assert.equal(r.pushed, false)
  assert.deepEqual(r.committed, [])
  assert.equal(git(remote, 'rev-parse', 'main'), before)
  assert.equal(git(work, 'rev-list', '--count', 'HEAD'), '1')
})

test('a real change is committed with a message naming only what changed, and pushed', async () => {
  const { work, remote, opts } = setup()
  fs.writeFileSync(path.join(work, 'a.md'), 'one\ntwo\n')
  fs.writeFileSync(path.join(work, 'b.md'), 'new\n')
  let named = null
  const r = await syncRepo(work, { ...opts, message: (files) => ((named = files), `Update ${files.join(', ')}`), skipIfClean: true })
  assert.equal(r.clean, false)
  assert.equal(r.pushed, true)
  assert.deepEqual([...named].sort(), ['a.md', 'b.md'])
  assert.equal(git(remote, 'log', '-1', '--format=%s', 'main'), 'Update a.md, b.md')
  // and syncing again, with nothing new, pushes nothing
  const again = await syncRepo(work, { ...opts, message: () => 'never', skipIfClean: true })
  assert.equal(again.clean, true)
  assert.equal(git(remote, 'rev-list', '--count', 'main'), '2')
})

test('without skipIfClean (a pull), nothing to commit still fetches what others pushed', async () => {
  const { root, work, remote, opts } = setup()
  const other = path.join(root, 'other')
  git(root, 'clone', '-q', remote, other)
  fs.writeFileSync(path.join(other, 'c.md'), 'theirs\n')
  git(other, 'add', '-A')
  git(other, '-c', 'user.name=o', '-c', 'user.email=o@o', 'commit', '-q', '-m', 'theirs')
  git(other, 'push', '-q', 'origin', 'HEAD:main')
  const r = await syncRepo(work, { ...opts, message: () => 'never' })
  assert.equal(r.clean, false)
  assert.ok(fs.existsSync(path.join(work, 'c.md')))
  assert.deepEqual(r.changed, ['c.md'])
})
