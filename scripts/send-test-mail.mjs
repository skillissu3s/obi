// Checks the server's mail settings and sends one test message.
//
//   node scripts/send-test-mail.mjs you@example.com
//
// Run it wherever Obi runs, so it sees the same environment (on Dokploy:
// open a terminal on the container and run it from /app). It prints what it
// would use, asks the mail server whether it accepts the credentials, and only
// then sends — so a typo in the host or key shows up as a clear message rather
// than a stranger failing to receive their sign-in code.
import { mailInfo, verifyMail, sendMail } from '../server/mail.js'
import { APP_NAME, PUBLIC_URL } from '../server/config.js'

const to = process.argv[2]
const info = mailInfo()

console.log('Mail settings')
console.log('  from:   ', info.from)
console.log('  host:   ', info.host ? `${info.host}${info.port ? ':' + info.port : ''}` : '(none)')
console.log('  user:   ', info.user || '(none)')
console.log('  app url:', PUBLIC_URL || '(PUBLIC_URL not set — emails will not name your site)')
if (info.logOnly) console.log('  note:    MAIL_LOG_CODES=1 — codes are printed to the log, nothing is sent')
console.log('')

if (!to) {
  console.log('Give an address to send a test to:  node scripts/send-test-mail.mjs you@example.com')
  process.exit(info.enabled ? 0 : 1)
}

try {
  await verifyMail()
  console.log('The mail server accepted our credentials.')
} catch (e) {
  console.error('The mail server refused us:', e.message)
  console.error('\nCheck SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS. With Brevo the user is the')
  console.error('login it shows you (like 9xxxxx001@smtp-brevo.com), not your own email address.')
  process.exit(1)
}

try {
  await sendMail({
    to,
    subject: `${APP_NAME} test message`,
    text: `This is a test from ${APP_NAME}. If it reached you, sign-up and sign-in codes will too.\n\nSent from ${info.from}${PUBLIC_URL ? ` for ${PUBLIC_URL}` : ''}.`,
    html: `<p>This is a test from ${APP_NAME}. If it reached you, sign-up and sign-in codes will too.</p><p style="color:#777;font-size:13px">Sent from ${info.from}${PUBLIC_URL ? ` for ${PUBLIC_URL}` : ''}.</p>`,
  })
  console.log(`Sent to ${to}. Open it and check it is in the inbox, not spam.`)
  console.log('In Gmail: ⋮ → "Show original" — SPF, DKIM and DMARC should all say PASS.')
} catch (e) {
  console.error('Sending failed:', e.message)
  process.exit(1)
}
