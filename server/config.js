import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'

const env = process.env

export const DATA_DIR = path.resolve(env.DATA_DIR || './data')
export const WORKSPACES_DIR = path.join(DATA_DIR, 'workspaces')
export const PORT = Number(env.PORT || 3000)
// the desktop app runs this server privately for one person
export const DESKTOP = env.OBI_DESKTOP === '1'
export const HOST = env.HOST || (DESKTOP ? '127.0.0.1' : '0.0.0.0')
export const IS_PROD = env.NODE_ENV === 'production'
export const ALLOW_FILE_REMOTES = env.ALLOW_FILE_REMOTES === '1'
export const SESSION_DAYS = Number(env.SESSION_DAYS || 30)
export const MAX_UPLOAD_MB = Number(env.MAX_UPLOAD_MB || 50)
export const APP_NAME = env.APP_NAME || 'Obi'

fs.mkdirSync(WORKSPACES_DIR, { recursive: true })

function loadSecret() {
  if (env.APP_SECRET && env.APP_SECRET.length >= 16) return env.APP_SECRET
  const file = path.join(DATA_DIR, 'secret.key')
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch {
    const s = crypto.randomBytes(48).toString('base64url')
    fs.writeFileSync(file, s, { mode: 0o600 })
    return s
  }
}

export const APP_SECRET = loadSecret()

// Who may create an account: 'open' (anyone, confirmed by an emailed code),
// 'invite' (invite links from an admin only) or 'closed'.
export const REGISTRATION = ['open', 'invite', 'closed'].includes(env.REGISTRATION) ? env.REGISTRATION : 'open'
// How a code fits into signing in: 'either' (password or an emailed code),
// 'always' (password, then a code) or 'off' (password only).
export const LOGIN_CODE = ['either', 'always', 'off'].includes(env.LOGIN_CODE) ? env.LOGIN_CODE : 'either'
// Where the desktop app's installers are published, as owner/repo on GitHub.
// /download/<platform> sends people to the latest release's asset.
export const DOWNLOAD_REPO = (env.DOWNLOAD_REPO || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/+$/, '')
// Public address of this server, used in emails
export const PUBLIC_URL = (env.PUBLIC_URL || '').replace(/\/+$/, '')
