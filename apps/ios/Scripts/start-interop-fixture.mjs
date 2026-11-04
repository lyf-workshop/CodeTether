import { spawn } from 'node:child_process'
import { chmod, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const appDirectory = resolve(scriptDirectory, '..')
const repository = resolve(appDirectory, '../..')
const configPath = resolve(appDirectory, 'Tests/Support/InteropFixture.json')
const fixturePath = resolve(repository, 'packages/supervisor-mobile/tests/interop-fixture.mjs')
const child = spawn(process.execPath, [fixturePath], {
  cwd: repository,
  env: { HOME: process.env.HOME, PATH: process.env.PATH },
  stdio: ['pipe', 'pipe', 'ignore'],
})

let pending = ''
let ready = false
let stopping = false

child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  if (ready) return
  pending += chunk
  if (pending.length > 16_384) return stop('fixture_setup_too_large')
  const newline = pending.indexOf('\n')
  if (newline < 0) return
  try {
    const setup = JSON.parse(pending.slice(0, newline))
    void writeFile(configPath, `${JSON.stringify(setup)}\n`, { encoding: 'utf8', mode: 0o600 })
      .then(() => chmod(configPath, 0o600))
      .then(() => {
        ready = true
        process.stdout.write('IOS_INTEROP_FIXTURE_READY\n')
      })
      .catch(() => stop('fixture_setup_write_failed'))
  } catch {
    void stop('fixture_setup_invalid')
  }
})

child.once('error', () => void stop('fixture_start_failed'))
child.once('exit', () => {
  if (!ready && !stopping) void stop('fixture_start_failed')
})

process.once('SIGTERM', () => void stop())
process.once('SIGINT', () => void stop())

async function stop(reason) {
  if (stopping) return
  stopping = true
  if (reason) process.stderr.write(`${reason}\n`)
  child.stdin.end()
  if (child.exitCode === null && child.signalCode === null) {
    const hardStop = setTimeout(() => child.kill('SIGKILL'), 1_500)
    await new Promise((done) => child.once('exit', done))
    clearTimeout(hardStop)
  }
  await unlink(configPath).catch(() => {})
  process.exit(reason ? 1 : 0)
}
