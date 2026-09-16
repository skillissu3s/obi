import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { APP_SECRET } from './config.js'

const scrypt = promisify(crypto.scrypt)
const N = 16384, R = 8, P = 1, KEYLEN = 64

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = await scrypt(password, salt, KEYLEN, { N, r: R, p: P })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifyPassword(password, stored) {
  try {
    const [algo, n, r, p, saltB64, hashB64] = stored.split('$')
    if (algo !== 'scrypt') return false
    const expected = Buffer.from(hashB64, 'base64')
    const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(n), r: Number(r), p: Number(p),
    })
    return crypto.timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url')
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

const ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789'
export function newId(len = 12) {
  const bytes = crypto.randomBytes(len)
  let s = ''
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length]
  return s
}

const KEY = crypto.createHash('sha256').update('obi-token-key:' + APP_SECRET).digest()

export function encrypt(plain) {
  if (plain == null || plain === '') return null
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv)
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

export function decrypt(blob) {
  if (!blob) return null
  try {
    const [v, ivB, tagB, encB] = blob.split(':')
    if (v !== 'v1') return null
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(encB, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

const COLORS = ['#2f9e78', '#d1703f', '#b8604f', '#c0913a', '#2a93a3', '#5566cf', '#96549e', '#7f9a44', '#c26a8a', '#7c776d']
export const randomColor = () => COLORS[crypto.randomInt(COLORS.length)]

// Simple sliding-window rate limiter (in-memory)
const buckets = new Map()
export function rateLimit(key, max, windowMs) {
  const t = Date.now()
  let b = buckets.get(key)
  if (!b || t - b.start > windowMs) {
    b = { start: t, count: 0 }
    buckets.set(key, b)
  }
  b.count++
  if (buckets.size > 10000) {
    for (const [k, v] of buckets) if (t - v.start > windowMs) buckets.delete(k)
  }
  return b.count <= max
}
export function resetRateLimit(key) {
  buckets.delete(key)
}
