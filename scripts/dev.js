// Runs the API server and the Vite dev server together: npm run dev
import { spawn } from 'node:child_process'

const procs = []
const run = (name, cmd, args, env = {}) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', env: { ...process.env, ...env } })
  const prefix = `\x1b[${name === 'api' ? 36 : 35}m[${name}]\x1b[0m `
  const pipe = (stream) => stream.on('data', (d) => process.stdout.write(String(d).replace(/^/gm, prefix).replace(new RegExp(`${prefix}$`), '')))
  pipe(p.stdout)
  pipe(p.stderr)
  p.on('exit', (code) => {
    console.log(`${prefix}exited with ${code}`)
    shutdown()
  })
  procs.push(p)
  return p
}

function shutdown() {
  for (const p of procs) if (!p.killed) p.kill()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

run('api', 'node', ['--watch', '--disable-warning=ExperimentalWarning', 'server/index.js'], { DATA_DIR: process.env.DATA_DIR || './data', PORT: '3000' })
run('web', 'npx', ['vite'], { OBI_API: 'http://localhost:3000' })

console.log('\nObi dev server → http://localhost:5173\n')
