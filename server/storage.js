// Works out whether DATA_DIR will survive a redeploy.
// Inside a container, /proc/self/mountinfo tells us what backs the directory:
//   named volume   → .../volumes/<name>/_data          (persistent)
//   unnamed volume → .../volumes/<64 hex chars>/_data  (a new one per container — lost on redeploy)
//   bind mount     → a host path                        (persistent)
//   no mount       → the container's own filesystem    (lost on redeploy)
import fs from 'node:fs'
import path from 'node:path'
import { one, run, now } from './db.js'

function inContainer() {
  if (fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv')) return true
  try {
    return /docker|containerd|kubepods|libpod/.test(fs.readFileSync('/proc/1/cgroup', 'utf8'))
  } catch {
    return false
  }
}

const unescape = (s) => s.replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))

export function inspectStorage(dataDir) {
  const dir = path.resolve(dataDir)
  const base = { dataDir: dir }
  if (process.platform !== 'linux' || !inContainer()) return { ...base, kind: 'host', persistent: true }

  let mounts
  try {
    mounts = fs
      .readFileSync('/proc/self/mountinfo', 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const f = line.split(' ')
        return { root: unescape(f[3]), point: unescape(f[4]) }
      })
  } catch {
    return { ...base, kind: 'unknown', persistent: true }
  }

  // the most specific mount that contains the data directory
  const mount = mounts
    .filter((m) => m.point !== '/' && (dir === m.point || dir.startsWith(m.point + '/')))
    .sort((a, b) => b.point.length - a.point.length)[0]

  if (!mount) return { ...base, kind: 'none', persistent: false, source: 'container filesystem' }

  const vol = /\/volumes\/([^/]+)\/_data$/.exec(mount.root)
  if (vol) {
    const anonymous = /^[0-9a-f]{64}$/.test(vol[1])
    return { ...base, kind: anonymous ? 'anonymous' : 'named', persistent: !anonymous, source: anonymous ? `unnamed volume ${vol[1].slice(0, 12)}…` : vol[1] }
  }
  return { ...base, kind: 'bind', persistent: true, source: mount.root }
}

// Remembers when this data directory was first initialised, so a wipe is obvious in the admin console.
export function dataCreatedAt() {
  let row = one("SELECT value FROM app_settings WHERE key = 'data_created_at'")
  if (!row) {
    const earliest = one('SELECT MIN(created_at) AS t FROM users')?.t || now()
    run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('data_created_at', ?)", String(earliest))
    row = { value: String(earliest) }
  }
  return Number(row.value)
}

export function storageReport(dataDir) {
  return { ...inspectStorage(dataDir), createdAt: dataCreatedAt() }
}

export function warnIfEphemeral(dataDir) {
  const s = inspectStorage(dataDir)
  if (s.persistent) {
    console.log(`[storage] ${s.dataDir} → ${s.kind}${s.source ? ` (${s.source})` : ''}`)
    return s
  }
  const bar = '!'.repeat(78)
  console.warn(
    [
      bar,
      `!! STORAGE IS NOT PERSISTENT — ${s.dataDir} is on ${s.source}.`,
      '!! Users, workspaces and online notes will be LOST on the next redeploy.',
      '!! Fix: mount a named volume or host directory at /data.',
      '!!   Dokploy Application → Advanced → Mounts → Volume Mount, name "obi-data", path "/data"',
      '!!   or deploy with the docker-compose.yml in this repo (it declares the volume).',
      bar,
    ].join('\n'),
  )
  return s
}
