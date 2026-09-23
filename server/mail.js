import nodemailer from 'nodemailer'
import { APP_NAME, PUBLIC_URL } from './config.js'

// Mail goes out over SMTP, configured from the environment:
//   SMTP_URL                     e.g. smtps://user:pass@smtp.example.com
// or
//   SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (1 for port 465),
//   SMTP_USER, SMTP_PASS
//   MAIL_FROM                    e.g. "Obi <no-reply@example.com>"
// Without SMTP, MAIL_LOG_CODES=1 prints messages to the server log instead —
// for local development only.
const env = process.env

let transport = null
if (env.SMTP_URL) transport = nodemailer.createTransport(env.SMTP_URL)
else if (env.SMTP_HOST) {
  const port = Number(env.SMTP_PORT || 587)
  transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === '1' || env.SMTP_SECURE === 'true' : port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS || '' } : undefined,
  })
}
const LOG_ONLY = !transport && env.MAIL_LOG_CODES === '1'
const FROM = env.MAIL_FROM || env.SMTP_USER || `no-reply@localhost`

/** Whether this server can send email at all */
export const mailEnabled = !!transport || LOG_ONLY

export async function sendMail({ to, subject, text, html }) {
  if (LOG_ONLY) {
    console.log(`[mail] to ${to} — ${subject}\n${text}\n`)
    return
  }
  if (!transport) throw new Error('Email is not configured on this server')
  await transport.sendMail({ from: FROM, to, subject, text, html })
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

const WHY = {
  signup: 'to confirm your email and finish creating your account',
  login: 'to sign in',
  email: 'to confirm your new email address',
  reset: 'to choose a new password',
}

export async function sendCode(to, code, purpose) {
  const why = WHY[purpose] || 'to continue'
  const where = PUBLIC_URL ? ` at ${PUBLIC_URL}` : ''
  const text = `Your ${APP_NAME} code is ${code}\n\nEnter it ${why}${where}. It expires in 10 minutes.\n\nIf you didn't ask for this, you can ignore this email.`
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:440px;margin:0 auto;padding:24px;color:#222">
<p style="margin:0 0 16px">Your ${esc(APP_NAME)} code:</p>
<p style="font-size:32px;letter-spacing:8px;font-weight:600;margin:0 0 16px;font-family:ui-monospace,monospace">${esc(code)}</p>
<p style="margin:0 0 8px">Enter it ${esc(why)}${esc(where)}. It expires in 10 minutes.</p>
<p style="margin:0;color:#777;font-size:13px">If you didn't ask for this, you can ignore this email.</p></div>`
  await sendMail({ to, subject: `${code} is your ${APP_NAME} code`, text, html })
}
