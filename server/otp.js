import crypto from 'node:crypto'
import { one, run, now } from './db.js'
import { newId, sha256 } from './security.js'
import { sendCode } from './mail.js'
import { HttpError } from './fsutil.js'

const TTL = 10 * 60 * 1000
const MAX_TRIES = 5

const hashCode = (id, code) => sha256(`${id}:${code}`)

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/
export const normEmail = (e) => String(e || '').trim().toLowerCase()

/** a***@example.com — enough to recognise, not enough to harvest */
export function maskEmail(email) {
  const [name, domain] = String(email).split('@')
  if (!domain) return ''
  return `${name[0]}${'*'.repeat(Math.max(2, Math.min(6, name.length - 1)))}@${domain}`
}

/**
 * Makes a 6-digit code for (purpose, subject), replacing any earlier one, and
 * emails it. Returns the ticket the client sends back with the code.
 * With `background`, the email goes out without waiting, so the response takes
 * the same time whether or not an account exists.
 */
export async function issueCode({ purpose, subject, email, background = false }) {
  run('DELETE FROM otp_codes WHERE expires_at < ?', now())
  run('DELETE FROM otp_codes WHERE purpose = ? AND subject = ?', purpose, subject)
  const id = newId(24)
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  const t = now()
  run('INSERT INTO otp_codes (id, purpose, subject, email, code_hash, created_at, expires_at) VALUES (?,?,?,?,?,?,?)', id, purpose, subject, email, hashCode(id, code), t, t + TTL)
  const sending = sendCode(email, code, purpose.replace(/\d+$/, ''))
  if (background) sending.catch((e) => console.error('[mail] could not send code:', e.message))
  else {
    try {
      await sending
    } catch (e) {
      console.error('[mail] could not send code:', e.message)
      run('DELETE FROM otp_codes WHERE id = ?', id)
      throw new HttpError(502, "We couldn't send the email. Please try again in a moment.")
    }
  }
  return id
}

/** Checks a code; on success the code is used up and its row returned. */
export function checkCode(ticket, code, purposes) {
  const row = one('SELECT * FROM otp_codes WHERE id = ?', String(ticket || ''))
  const bad = new HttpError(400, 'That code is wrong or has expired')
  if (!row || !purposes.includes(row.purpose)) throw bad
  if (row.expires_at < now()) {
    run('DELETE FROM otp_codes WHERE id = ?', row.id)
    throw new HttpError(400, 'That code has expired. Ask for a new one.')
  }
  const given = Buffer.from(hashCode(row.id, String(code || '').replace(/\D/g, '')))
  const ok = crypto.timingSafeEqual(given, Buffer.from(row.code_hash))
  if (!ok) {
    if (row.attempts + 1 >= MAX_TRIES) {
      run('DELETE FROM otp_codes WHERE id = ?', row.id)
      throw new HttpError(400, 'Too many wrong codes. Ask for a new one.')
    }
    run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', row.id)
    throw bad
  }
  run('DELETE FROM otp_codes WHERE id = ?', row.id)
  return row
}
