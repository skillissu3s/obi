import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ALLOW_FILE_REMOTES } from './config.js'
import { isBoardPath, isLayerPath, mergeBoards } from '../shared/board.js'

export class GitError extends Error {
  constructor(message, details) {
    super(message)
    this.details = details
  }
}

export function normalizeRepoUrl(input) {
  let url = String(input || '').trim()
  if (!url) throw new GitError('Repository URL is required')
  // git@github.com:owner/repo.git -> https://github.com/owner/repo.git
  const ssh = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+?)$/.exec(url)
  if (ssh) url = `https://${ssh[1]}/${ssh[2]}`
  // owner/repo shorthand
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`
  if (/^https?:\/\//i.test(url)) {
    const u = new URL(url)
    u.username = ''
    u.password = ''
    let p = u.pathname.replace(/\/+$/, '')
    if (/github\.com$/i.test(u.hostname)) {
      const parts = p.split('/').filter(Boolean)
      if (parts.length < 2) throw new GitError('URL must look like https://github.com/owner/repo')
      p = `/${parts[0]}/${parts[1].replace(/\.git$/, '')}.git`
    }
    u.pathname = p
    return u.toString()
  }
  if (ALLOW_FILE_REMOTES && (url.startsWith('file://') || path.isAbsolute(url))) return url
  throw new GitError('Only HTTPS (or git@ SSH-style, converted to HTTPS) repository URLs are supported')
}

export function repoLabel(url) {
  const m = /github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(url || '')
  return m ? m[1] : url
}

function authEnv(token, username) {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    LANG: 'C',
    LC_ALL: 'C',
  }
  const cfg = [
    ['credential.helper', ''],
    ['core.quotepath', 'false'],
    ['core.autocrlf', 'false'],
    ['init.defaultBranch', 'main'],
    ['safe.directory', '*'],
  ]
  if (token) {
    const basic = Buffer.from(`${username || 'x-access-token'}:${token}`).toString('base64')
    cfg.push(['http.extraHeader', `Authorization: Basic ${basic}`])
  }
  env.GIT_CONFIG_COUNT = String(cfg.length)
  cfg.forEach(([k, v], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = k
    env[`GIT_CONFIG_VALUE_${i}`] = v
  })
  return env
}

function scrub(text, token) {
  if (!text) return text
  let t = text
  if (token) t = t.split(token).join('***')
  return t.replace(/Authorization: Basic [A-Za-z0-9+/=]+/g, 'Authorization: ***')
}

export function runGit(cwd, args, { token, username, timeout = 120000, buffer = false, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, env: authEnv(token, username), windowsHide: true })
    const out = []
    const err = []
    let killed = false
    const timer = setTimeout(() => {
      killed = true
      child.kill('SIGKILL')
    }, timeout)
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d) => err.push(d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new GitError(e.code === 'ENOENT' ? 'git is not installed on the server' : e.message))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const stdoutBuf = Buffer.concat(out)
      resolve({
        code: killed ? -1 : code,
        stdout: buffer ? stdoutBuf : stdoutBuf.toString('utf8'),
        stderr: scrub(Buffer.concat(err).toString('utf8'), token) + (killed ? '\n(timed out)' : ''),
      })
    })
    if (input != null) child.stdin.end(input)
    else child.stdin.end()
  })
}

function friendlyError(stderr) {
  const s = stderr || ''
  if (/Authentication failed|could not read Username|invalid username or password|403|401/i.test(s))
    return 'Authentication failed — check that the token is valid and has access to this repository (Contents: read & write).'
  if (/Repository not found|not found/i.test(s)) return 'Repository not found — check the URL and that the token can access it.'
  if (/Could not resolve host|unable to access/i.test(s)) return 'Could not reach the git host from the server.'
  if (/timed out/i.test(s)) return 'Git operation timed out.'
  const line = s.split('\n').map((l) => l.trim()).filter(Boolean).pop()
  return line || 'Git command failed'
}

async function must(cwd, args, opts) {
  const r = await runGit(cwd, args, opts)
  if (r.code !== 0) throw new GitError(friendlyError(r.stderr), r.stderr)
  return r
}

export async function lsRemote(url, token, username) {
  const r = await runGit(process.cwd(), ['ls-remote', '--symref', url], { token, username, timeout: 45000 })
  if (r.code !== 0) throw new GitError(friendlyError(r.stderr), r.stderr)
  let defaultBranch = null
  const branches = []
  for (const line of r.stdout.split('\n')) {
    const sym = /^ref: refs\/heads\/(\S+)\s+HEAD$/.exec(line)
    if (sym) defaultBranch = sym[1]
    const b = /^[0-9a-f]{40}\s+refs\/heads\/(\S+)$/.exec(line)
    if (b) branches.push(b[1])
  }
  if (!defaultBranch && branches.length) defaultBranch = branches.includes('main') ? 'main' : branches.includes('master') ? 'master' : branches[0]
  return { defaultBranch, branches, empty: branches.length === 0 }
}

async function revParse(cwd, ref) {
  const r = await runGit(cwd, ['rev-parse', '--verify', '--quiet', ref + '^{commit}'])
  return r.code === 0 ? r.stdout.trim() : null
}

export async function isRepo(dir) {
  try {
    await fs.access(path.join(dir, '.git'))
    return true
  } catch {
    return false
  }
}

export async function initRepo(dir, { url, branch }) {
  await fs.mkdir(dir, { recursive: true })
  if (!(await isRepo(dir))) {
    await must(dir, ['init', '-b', branch])
    await must(dir, ['remote', 'add', 'origin', url])
  } else if ((await runGit(dir, ['remote', 'set-url', 'origin', url])).code !== 0) {
    // an existing repository without an "origin" yet
    await must(dir, ['remote', 'add', 'origin', url])
  }
}

/** The installed git's version, or null when there is none */
export async function gitVersion() {
  try {
    const r = await runGit(process.cwd(), ['--version'], { timeout: 10000 })
    return r.code === 0 ? r.stdout.trim().replace(/^git version\s*/, '') : null
  } catch {
    return null
  }
}

export function conflictName(p) {
  const d = new Date()
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
  const dot = p.lastIndexOf('.')
  const slash = p.lastIndexOf('/')
  if (dot > slash + 1) return `${p.slice(0, dot)} (conflict ${stamp})${p.slice(dot)}`
  return `${p} (conflict ${stamp})`
}

async function showStage(dir, stage, file) {
  const r = await runGit(dir, ['show', `:${stage}:${file}`], { buffer: true })
  return r.code === 0 ? r.stdout : null
}

/**
 * Full sync cycle: commit local changes, fetch, merge (saving conflict copies), push.
 * Returns { changed: string[] | null (null = unknown/all), pushed, conflicts }
 */
export async function syncRepo(dir, { url, branch, token, username, authorName, authorEmail, message, push = true }) {
  const auth = { token, username }
  const ident = ['-c', `user.name=${authorName || 'Obi'}`, '-c', `user.email=${authorEmail || 'obi@localhost'}`]
  await runGit(dir, ['remote', 'set-url', 'origin', url])

  await must(dir, ['add', '-A'])
  const st = await must(dir, ['status', '--porcelain', '-z'])
  if (st.stdout.replace(/\0/g, '').trim()) {
    await must(dir, [...ident, 'commit', '--no-verify', '-q', '-m', message || 'Update notes'])
  }

  const before = await revParse(dir, 'HEAD')
  const remoteRef = `refs/remotes/origin/${branch}`
  const fetch = await runGit(dir, ['fetch', '--no-tags', 'origin', `+refs/heads/${branch}:${remoteRef}`], { ...auth, timeout: 180000 })
  let remoteExists = true
  if (fetch.code !== 0) {
    if (/couldn't find remote ref|no such ref/i.test(fetch.stderr)) remoteExists = false
    else throw new GitError(friendlyError(fetch.stderr), fetch.stderr)
  }
  const remoteHead = remoteExists ? await revParse(dir, remoteRef) : null
  const conflicts = []

  if (remoteHead) {
    if (!before) {
      await must(dir, ['checkout', '-q', '-B', branch, remoteRef])
    } else if (before !== remoteHead) {
      const counts = await must(dir, ['rev-list', '--left-right', '--count', `HEAD...${remoteRef}`])
      const [ahead, behind] = counts.stdout.trim().split(/\s+/).map(Number)
      if (behind > 0) {
        if (ahead === 0) {
          await must(dir, ['merge', '--ff-only', '-q', remoteRef])
        } else {
          const m = await runGit(dir, [...ident, 'merge', '--no-edit', '-q', '--allow-unrelated-histories', '-m', 'Merge remote changes', remoteRef])
          if (m.code !== 0) {
            const u = await runGit(dir, ['diff', '--name-only', '--diff-filter=U', '-z'])
            const files = u.stdout.split('\0').filter(Boolean)
            if (!files.length) {
              await runGit(dir, ['merge', '--abort'])
              throw new GitError(friendlyError(m.stderr), m.stderr)
            }
            for (const f of files) {
              const ours = await showStage(dir, 2, f)
              const theirs = await showStage(dir, 3, f)
              const abs = path.join(dir, f)
              await fs.mkdir(path.dirname(abs), { recursive: true })
              if (ours && theirs && (isBoardPath(f) || isLayerPath(f))) {
                const base = await showStage(dir, 1, f)
                const merged = mergeBoards(base ? base.toString('utf8') : '', ours.toString('utf8'), theirs.toString('utf8'))
                if (merged != null) {
                  await fs.writeFile(abs, merged)
                  await must(dir, ['add', '--', f])
                  continue
                }
              }
              if (ours && theirs) {
                const copy = conflictName(f)
                await fs.writeFile(abs, theirs)
                await fs.writeFile(path.join(dir, copy), ours)
                await must(dir, ['add', '--', f, copy])
                conflicts.push({ path: f, copy })
              } else if (ours) {
                await fs.writeFile(abs, ours)
                await must(dir, ['add', '--', f])
              } else if (theirs) {
                await fs.writeFile(abs, theirs)
                await must(dir, ['add', '--', f])
              } else {
                await runGit(dir, ['rm', '-q', '--cached', '--ignore-unmatch', '--', f])
              }
            }
            await must(dir, [...ident, 'commit', '--no-verify', '-q', '-m', `Merge remote changes (${conflicts.length} conflict copies)`])
          }
        }
      }
    }
  }

  const after = await revParse(dir, 'HEAD')
  let changed = []
  if (before && after && before !== after) {
    const d = await runGit(dir, ['diff', '--name-only', '-z', before, after])
    changed = d.stdout.split('\0').filter(Boolean)
  } else if (!before && after) {
    changed = null
  }

  let pushed = false
  if (after && push) {
    const needPush = !remoteHead || (await must(dir, ['rev-list', '--count', `${remoteRef}..HEAD`])).stdout.trim() !== '0'
    if (needPush) {
      const p = await runGit(dir, ['push', '-q', 'origin', `HEAD:refs/heads/${branch}`], { ...auth, timeout: 180000 })
      if (p.code !== 0) {
        if (/non-fast-forward|fetch first|rejected/i.test(p.stderr)) return { changed, pushed: false, conflicts, retry: true }
        throw new GitError(friendlyError(p.stderr), p.stderr)
      }
      pushed = true
      await runGit(dir, ['update-ref', remoteRef, 'HEAD'])
    }
  }
  return { changed, pushed, conflicts }
}

export async function fileHistory(dir, file, limit = 50) {
  const r = await runGit(dir, ['log', '--follow', '-n', String(limit), '--name-only', '--format=%x1e%H%x1f%an%x1f%at%x1f%s', '--', file])
  if (r.code !== 0) return []
  return r.stdout
    .split('\x1e')
    .filter((s) => s.trim())
    .map((rec) => {
      const [head, ...rest] = rec.split('\n')
      const [hash, author, at, subject] = head.split('\x1f')
      const p = rest.map((l) => l.trim()).filter(Boolean)[0] || file
      return { id: hash, author, createdAt: Number(at) * 1000, message: subject, path: p }
    })
}

export async function showFileAt(dir, hash, file) {
  if (!/^[0-9a-f]{7,40}$/.test(hash)) return null
  const r = await runGit(dir, ['show', `${hash}:${file}`], { buffer: true })
  return r.code === 0 ? r.stdout.toString('utf8') : null
}
