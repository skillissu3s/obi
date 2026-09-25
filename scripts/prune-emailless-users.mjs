// Removes accounts that cannot sign in any more.
//
//   node scripts/prune-emailless-users.mjs          # list them, change nothing
//   node scripts/prune-emailless-users.mjs --yes    # delete them
//
// Signing in is by email address, so an account without one is unreachable —
// typically a leftover from before, or a test account. Deleting a user takes
// their workspaces with them, files included, so this lists first and only acts
// when told to. It refuses to leave the server without a usable administrator.
import { one, all, run } from '../server/db.js'
import { revokeUserSessions } from '../server/auth.js'
import { disposeRuntime } from '../server/runtime.js'

const go = process.argv.includes('--yes')
const users = all('SELECT id, username, display_name, email, is_admin, created_at, last_login_at FROM users ORDER BY created_at')
const doomed = users.filter((u) => !u.email)
const survivingAdmins = users.filter((u) => u.is_admin && u.email)

const when = (t) => (t ? new Date(t).toISOString().slice(0, 10) : 'never')
console.log(`${users.length} account(s); ${doomed.length} without an email address:\n`)
for (const u of doomed) {
  const ws = all('SELECT id, name FROM workspaces WHERE owner_id = ?', u.id)
  console.log(`  @${u.username}${u.is_admin ? ' (admin)' : ''} — created ${when(u.created_at)}, last signed in ${when(u.last_login_at)}`)
  for (const w of ws) console.log(`      workspace "${w.name}" and its files would go too`)
}
if (!doomed.length) process.exit(0)

if (!survivingAdmins.length) {
  console.error('\nRefusing: no administrator has an email address, so deleting these would lock you out.')
  console.error('Set ADMIN_EMAIL (and restart) to give your admin an address first.')
  process.exit(1)
}
if (!go) {
  console.log(`\nNothing was changed. Run again with --yes to delete ${doomed.length} account(s).`)
  console.log(`Administrators that would remain: ${survivingAdmins.map((u) => '@' + u.username).join(', ')}`)
  process.exit(0)
}

for (const u of doomed) {
  revokeUserSessions(u.id)
  for (const w of all('SELECT id FROM workspaces WHERE owner_id = ?', u.id)) await disposeRuntime(w.id, { removeFiles: true })
  run('DELETE FROM users WHERE id = ?', u.id)
  console.log(`deleted @${u.username}`)
}
console.log(`\nDone. ${one('SELECT COUNT(*) AS n FROM users').n} account(s) left.`)
process.exit(0)
